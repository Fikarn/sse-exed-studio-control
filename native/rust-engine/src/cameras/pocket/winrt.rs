//! The Pocket's link on Windows: Windows' own Bluetooth LE through the
//! `windows` crate (WinRT, safe code). The link's thread takes the device
//! at its address, checks that Windows still holds its pairing, opens a GATT
//! session that keeps the connection (Windows connects again whenever the
//! camera is free), subscribes to the three notified characteristics and
//! hands every notification to the link's state; a press is written to the
//! Outgoing Camera Control characteristic. What fails is said in the state
//! and tried again every `RETRY`, until the link is let go. Nothing here is
//! reached by a test or a development run: `guard_bluetooth` stands before
//! this thread.
//!
//! Once each connection is made it reads the camera's protocol version,
//! writes the controller's name to the camera's Device Name characteristic
//! (D41), so the camera's Bluetooth menu names Studio Control, as the iPad's
//! app does, and then subscribes (Magic Pocket Control's order). Every
//! characteristic is looked up first, and a lookup or the version read that
//! fails (Windows has not connected yet; a camera that lacks one) is tried
//! again every `RETRY`, the reason said once in the log for as long as it
//! stays the same; the version and the characteristics' kinds are logged
//! once, when the connection stands. Nothing else is written to the camera at a
//! connection: a camera that sends no settings (one back with its last
//! controller within minutes) is left to report a setting when it changes
//! (D43, tried and withdrawn).
//!
//! What it never does: write the Camera Status characteristic (a `0x00`
//! there switches the camera off), pair (that is Setup's, `winrt_pairing.rs`),
//! or scan. `Writable` names the characteristics it may write, and the one
//! function that writes takes one of them.

use crate::cameras::pocket::characteristics::{Notified, Writable, PROTOCOL_VERSION, SERVICE};
use crate::cameras::pocket::link::{Event, Events, Inbox, Order, PocketLink, Shared};
use crate::cameras::real_link::LinkFailure;
use crate::diagnostics::{log_event, LogLevel};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::core::{Error as WinError, IInspectable, GUID};
use windows::Devices::Bluetooth::GenericAttributeProfile::{
    GattCharacteristic, GattCharacteristicProperties,
    GattClientCharacteristicConfigurationDescriptorValue, GattCommunicationStatus,
    GattDeviceService, GattProtectionLevel, GattSession, GattValueChangedEventArgs,
};
use windows::Devices::Bluetooth::{
    BluetoothAddressType, BluetoothCacheMode, BluetoothConnectionStatus, BluetoothLEDevice,
};
use windows::Foundation::TypedEventHandler;
use windows::Storage::Streams::{DataReader, DataWriter, IBuffer};

/// How often the thread looks for the camera while it is not connected, and
/// how long it waits before a session that failed is tried again.
const RETRY: Duration = Duration::from_secs(5);

/// The controller's name the camera shows (D41; up to 32 characters).
const CONTROLLER_NAME: &str = "Studio Control";

/// How a session ended.
enum Ended {
    /// Let go, or nobody holds the link any more: the thread ends.
    LetGo,
    /// It cannot go on for now; tried again after `RETRY`.
    Failed(LinkFailure),
}

/// The link's thread: a session with the camera, tried again after a
/// failure until the link is let go.
pub(crate) fn run(shared: Arc<Shared>, inbox: Inbox, events: Events) {
    loop {
        let ended = match session(&shared, &inbox, &events) {
            Ok(()) => Ended::LetGo,
            Err(failure) => Ended::Failed(failure),
        };
        match ended {
            Ended::LetGo => {
                shared.stopped();
                return;
            }
            Ended::Failed(failure) => {
                shared.fail(failure);
                if !wait_to_retry(&shared, &inbox) {
                    shared.stopped();
                    return;
                }
            }
        }
    }
}

/// Waits `RETRY` for the next try, serving the inbox meanwhile: a press is
/// refused with the failure's sentence, a stale event is dropped. `false`
/// when the link was let go or abandoned.
fn wait_to_retry(shared: &Arc<Shared>, inbox: &Inbox) -> bool {
    let until = Instant::now() + RETRY;
    loop {
        let left = until.saturating_duration_since(Instant::now());
        match inbox.recv_timeout(left) {
            Ok(Order::LetGo) | Err(RecvTimeoutError::Disconnected) => return false,
            Ok(Order::Send { reply, .. }) => {
                let _ = reply.send(Err(shared.failure_sentence()));
            }
            Ok(Order::Event(_)) => {}
            Err(RecvTimeoutError::Timeout) => return !PocketLink::abandoned(shared),
        }
    }
}

fn text(error: WinError) -> String {
    error.message()
}

fn guid(uuid: u128) -> GUID {
    GUID::from_u128(uuid)
}

/// The characteristics the thread holds while connected: the ones it
/// listens to, with their handlers' tokens, and the ones it may write.
#[derive(Default)]
struct Subscribed {
    /// The camera service, held for the connection's life: Windows stops a
    /// characteristic's notifications once its service is let go.
    service: Option<GattDeviceService>,
    /// Each listened-to characteristic, its handler's token and the
    /// subscription asked for (indicate or notify).
    handled: Vec<(
        GattCharacteristic,
        i64,
        GattClientCharacteristicConfigurationDescriptorValue,
    )>,
    writable: Vec<(Writable, GattCharacteristic)>,
}

impl Subscribed {
    fn characteristic(&self, writable: Writable) -> Option<&GattCharacteristic> {
        self.writable
            .iter()
            .find(|(which, _)| *which == writable)
            .map(|(_, characteristic)| characteristic)
    }

    /// Asks for each subscription again, as it was made. A camera that kept
    /// them (a bonded camera across a drop Windows mended by itself) changes
    /// nothing; one that lost them (a power cycle in that moment) listens to
    /// the link again. `Err` when the camera does not take one.
    fn renew(&self) -> Result<(), String> {
        for (characteristic, _, wanted) in &self.handled {
            let status = characteristic
                .WriteClientCharacteristicConfigurationDescriptorWithResultAsync(*wanted)
                .and_then(|pending| pending.get())
                .and_then(|result| result.Status())
                .map_err(text)?;
            if status != GattCommunicationStatus::Success {
                return Err(format!("CAM 1 refused a subscription again: {status:?}."));
            }
        }
        Ok(())
    }

    /// Takes the handlers off and closes the service; the characteristics
    /// go with it.
    fn end(self) {
        for (characteristic, token, _) in self.handled {
            let _ = characteristic.RemoveValueChanged(token);
        }
        if let Some(service) = self.service {
            let _ = service.Close();
        }
    }
}

/// How a notified characteristic is subscribed to: as the camera offers it.
/// The Pocket indicates its Incoming Camera Control (what BlueMagic32 asks
/// for; asked for notifications, it sent nothing, 2026-10-07); a descriptor
/// asked for the wrong kind is written without an error and stays silent.
fn subscription_of(
    properties: GattCharacteristicProperties,
) -> (
    GattClientCharacteristicConfigurationDescriptorValue,
    &'static str,
) {
    if properties.contains(GattCharacteristicProperties::Indicate) {
        (
            GattClientCharacteristicConfigurationDescriptorValue::Indicate,
            "indicates",
        )
    } else {
        (
            GattClientCharacteristicConfigurationDescriptorValue::Notify,
            "notifies",
        )
    }
}

/// One session: the device, its pairing, the GATT session, then the loop
/// over the inbox until the link is let go (`Ok`) or something fails
/// (`Err`, with the sentence the operator reads). A device Windows no
/// longer holds paired is `NotPaired`: CAM 1 reads `NOT SET UP`.
fn session(shared: &Arc<Shared>, inbox: &Inbox, events: &Events) -> Result<(), LinkFailure> {
    let address = shared.address;
    let address_type = if address.random {
        BluetoothAddressType::Random
    } else {
        BluetoothAddressType::Public
    };
    let device = BluetoothLEDevice::FromBluetoothAddressWithBluetoothAddressTypeAsync(
        address.address,
        address_type,
    )
    .and_then(|pending| pending.get())
    .map_err(|_| {
        LinkFailure::Bluetooth(String::from(
            "Windows did not find CAM 1 at its Bluetooth address.",
        ))
    })?;
    let paired = device
        .DeviceInformation()
        .and_then(|information| information.Pairing())
        .and_then(|pairing| pairing.IsPaired())
        .map_err(|error| {
            LinkFailure::Bluetooth(format!(
                "Windows could not say whether CAM 1 is paired: {}",
                text(error)
            ))
        })?;
    if !paired {
        let _ = device.Close();
        return Err(LinkFailure::NotPaired(String::from(
            "Windows no longer holds CAM 1's pairing. Pair it again in Setup.",
        )));
    }
    let outcome = serve(shared, inbox, events, &device).map_err(LinkFailure::Bluetooth);
    let _ = device.Close();
    outcome
}

/// The GATT session with a paired camera, and the loop over the inbox.
fn serve(
    shared: &Arc<Shared>,
    inbox: &Inbox,
    events: &Events,
    device: &BluetoothLEDevice,
) -> Result<(), String> {
    let gatt = device
        .BluetoothDeviceId()
        .and_then(|id| GattSession::FromDeviceIdAsync(&id))
        .and_then(|pending| pending.get())
        .map_err(|error| format!("Windows gave CAM 1 no Bluetooth session: {}", text(error)))?;
    let connection_events = events.clone();
    let prepared = gatt.SetMaintainConnection(true).and_then(|()| {
        device.ConnectionStatusChanged(&TypedEventHandler::<BluetoothLEDevice, IInspectable>::new(
            move |device, _| {
                if let Some(device) = device.as_ref() {
                    let connected =
                        device.ConnectionStatus()? == BluetoothConnectionStatus::Connected;
                    let _ = connection_events.send(Order::Event(Event::Connected(connected)));
                }
                Ok(())
            },
        ))
    });
    let connection_token = match prepared {
        Ok(token) => token,
        Err(error) => {
            // Closed on the way out, as at the loop's end.
            let _ = gatt.Close();
            return Err(text(error));
        }
    };

    let mut subscribed: Option<Subscribed> = None;
    // Why the connection could not be made, said once in the log for as
    // long as the reason stays the same: a camera that is off gives the same
    // reason every `RETRY`, and so does one that lacks a characteristic, and
    // neither fills the log (two lines a retry did, 2026-10-07).
    let mut refused: Option<String> = None;
    let outcome = loop {
        if subscribed.is_none() {
            // Asks Windows for the camera's service, which connects when
            // the camera is free; while it is not, this is tried again
            // every `RETRY`, and Windows connects by itself meanwhile.
            match subscribe(device, events) {
                Ok(fresh) => {
                    subscribed = Some(fresh);
                    refused = None;
                    shared.take(&Event::Connected(true));
                }
                Err(sentence) => {
                    if refused.as_deref() != Some(sentence.as_str()) {
                        log_event(
                            LogLevel::Info,
                            &format!(
                                "CAM 1 is not connected yet: {sentence} Tried again every {} s.",
                                RETRY.as_secs()
                            ),
                        );
                        refused = Some(sentence);
                    }
                }
            }
        }
        match inbox.recv_timeout(RETRY) {
            Ok(Order::LetGo) | Err(RecvTimeoutError::Disconnected) => break Ok(()),
            Ok(Order::Send {
                messages,
                reply,
                deadline,
            }) => {
                let outcome = if Instant::now() > deadline {
                    // The runtime stopped waiting and told the operator the
                    // camera did not answer: the press is not sent late.
                    Err(String::from(
                        "The press waited too long for CAM 1 and was not sent.",
                    ))
                } else {
                    match subscribed
                        .as_ref()
                        .and_then(|subscribed| subscribed.characteristic(Writable::OutgoingControl))
                    {
                        Some(outgoing) => write_all(outgoing, &messages),
                        None => Err(String::from("CAM 1 is not connected over Bluetooth.")),
                    }
                };
                let _ = reply.send(outcome);
            }
            Ok(Order::Event(Event::Connected(false))) => {
                // A drop Windows has already made good (the event waited in
                // the inbox while `fill` ran) is not acted on: the
                // subscriptions are asked for again, which changes nothing
                // on a camera that kept them and wakes one that lost them,
                // and the reading stands with the camera's settings in it.
                let mended = device.ConnectionStatus().ok()
                    == Some(BluetoothConnectionStatus::Connected)
                    && subscribed.as_ref().is_some_and(|live| live.renew().is_ok());
                if !mended {
                    if let Some(gone) = subscribed.take() {
                        gone.end();
                    }
                    shared.take(&Event::Connected(false));
                }
            }
            // Subscribed at the loop's top, when not already.
            Ok(Order::Event(Event::Connected(true))) => {}
            Ok(Order::Event(event)) => shared.take(&event),
            Err(RecvTimeoutError::Timeout) => {}
        }
        // On every pass, not only a quiet one: a running camera's timecode
        // keeps the inbox busy, and an abandoned link must still end.
        if PocketLink::abandoned(shared) {
            break Ok(());
        }
    };

    if let Some(gone) = subscribed.take() {
        gone.end();
    }
    let _ = device.RemoveConnectionStatusChanged(connection_token);
    let _ = gatt.Close();
    outcome
}

/// The camera's service and characteristics, the notified ones subscribed
/// with a handler each. `Err` while the camera cannot be reached, with
/// whatever was subscribed taken off again.
fn subscribe(device: &BluetoothLEDevice, events: &Events) -> Result<Subscribed, String> {
    let mut subscribed = Subscribed::default();
    match fill(device, events, &mut subscribed) {
        Ok(()) => Ok(subscribed),
        Err(sentence) => {
            subscribed.end();
            Err(sentence)
        }
    }
}

/// Every characteristic of the camera's service, looked up before anything
/// is read or written.
struct Found {
    version: GattCharacteristic,
    name: GattCharacteristic,
    outgoing: GattCharacteristic,
    notified: Vec<(Notified, GattCharacteristic)>,
}

/// The camera's service and every characteristic looked up first, then the
/// version read, the controller's name written and the subscriptions made.
/// `Err` as soon as any of it fails (Windows has not connected yet; a
/// camera that lacks something): `serve` tries again every `RETRY` and says
/// why once. Before, a connection that was not yet made logged two lines
/// each retry, which would have filled a studio build's log all day with
/// the camera off (seen in the attended run, 2026-10-07).
fn fill(
    device: &BluetoothLEDevice,
    events: &Events,
    subscribed: &mut Subscribed,
) -> Result<(), String> {
    let services = device
        .GetGattServicesForUuidAsync(guid(SERVICE))
        .and_then(|pending| pending.get())
        .map_err(text)?;
    if services.Status().map_err(text)? != GattCommunicationStatus::Success {
        return Err(String::from("CAM 1's camera service did not answer."));
    }
    let service: GattDeviceService = services
        .Services()
        .and_then(|list| list.GetAt(0))
        .map_err(|_| String::from("CAM 1 offers no camera service."))?;
    subscribed.service = Some(service.clone());
    let found = look_up(&service)?;
    // The order of Magic Pocket Control's connection (an ESP32 controller
    // that gets the camera's settings at each connection): the protocol
    // version read, the controller's name written, then the subscriptions.
    // The version is required: a camera that does not answer it is not
    // connected yet, and the session is tried again.
    let version = read_version(&found.version)?;
    // The controller's name, once each connection (D41). A camera that does
    // not take the write is a line in the log, and the link goes on without
    // it; one that lacks the characteristic did not get this far.
    subscribed.writable.push((Writable::DeviceName, found.name));
    if let Some(name) = subscribed.characteristic(Writable::DeviceName) {
        if let Err(sentence) = write(name, CONTROLLER_NAME.as_bytes()) {
            log_event(
                LogLevel::Warn,
                &format!("CAM 1 did not take Studio Control's name: {sentence}"),
            );
        }
    }
    subscribed
        .writable
        .push((Writable::OutgoingControl, found.outgoing));
    let mut kinds: Vec<String> = Vec::new();
    for (notified, listened) in found.notified {
        let properties = listened.CharacteristicProperties().map_err(text)?;
        let (wanted, kind) = subscription_of(properties);
        kinds.push(format!("{notified:?} {kind} ({:#04x})", properties.0));
        let sender = events.clone();
        let token = listened
            .ValueChanged(&TypedEventHandler::<
                GattCharacteristic,
                GattValueChangedEventArgs,
            >::new(move |_, args| {
                if let Some(args) = args.as_ref() {
                    let bytes = bytes_of(&args.CharacteristicValue()?)?;
                    let event = match notified {
                        Notified::Control => Event::Control(bytes),
                        Notified::Timecode => Event::Timecode(bytes),
                        Notified::Status => Event::Status(bytes),
                    };
                    let _ = sender.send(Order::Event(event));
                }
                Ok(())
            }))
            .map_err(text)?;
        // Kept before the descriptor's write, so a write that fails still
        // takes the handler off (`Subscribed::end`).
        subscribed.handled.push((listened.clone(), token, wanted));
        let status = listened
            .WriteClientCharacteristicConfigurationDescriptorWithResultAsync(wanted)
            .and_then(|pending| pending.get())
            .and_then(|result| result.Status())
            .map_err(text)?;
        if status != GattCommunicationStatus::Success {
            return Err(format!("CAM 1 refused the notifications of {notified:?}."));
        }
    }
    // Once a connection, when it stands.
    log_event(
        LogLevel::Info,
        &format!("CAM 1's protocol version reads {version}."),
    );
    log_event(
        LogLevel::Info,
        &format!("CAM 1's characteristics: {}.", kinds.join(", ")),
    );
    Ok(())
}

/// The camera's characteristics, each asked for encryption up front: the
/// control characteristics are encrypted, and so asked Windows secures the
/// bonded link before the first descriptor write rather than after a
/// refusal. `Err` while one cannot be looked up: the camera is not connected
/// yet, or lacks it.
fn look_up(service: &GattDeviceService) -> Result<Found, String> {
    let characteristic = |uuid: u128| -> Result<GattCharacteristic, String> {
        let found = service
            .GetCharacteristicsForUuidAsync(guid(uuid))
            .and_then(|pending| pending.get())
            .map_err(text)?;
        if found.Status().map_err(text)? != GattCommunicationStatus::Success {
            return Err(String::from(
                "One of CAM 1's characteristics did not answer.",
            ));
        }
        let one = found
            .Characteristics()
            .and_then(|list| list.GetAt(0))
            .map_err(|_| String::from("CAM 1 lacks one of the protocol's characteristics."))?;
        let _ = one.SetProtectionLevel(GattProtectionLevel::EncryptionRequired);
        Ok(one)
    };
    let mut notified = Vec::with_capacity(Notified::ALL.len());
    for which in Notified::ALL {
        notified.push((which, characteristic(which.uuid())?));
    }
    Ok(Found {
        version: characteristic(PROTOCOL_VERSION)?,
        name: characteristic(Writable::DeviceName.uuid())?,
        outgoing: characteristic(Writable::OutgoingControl.uuid())?,
        notified,
    })
}

/// The camera's protocol version, read once each connection, as the log
/// writes it: `"0.1.0" (30 2E 31 2E 30 00 …)`. `Err` while the camera does
/// not answer it.
fn read_version(version: &GattCharacteristic) -> Result<String, String> {
    let read = version
        .ReadValueWithCacheModeAsync(BluetoothCacheMode::Uncached)
        .and_then(|pending| pending.get())
        .map_err(text)?;
    if read.Status().map_err(text)? != GattCommunicationStatus::Success {
        return Err(String::from("CAM 1's protocol version did not answer."));
    }
    let bytes = read
        .Value()
        .and_then(|value| bytes_of(&value))
        .map_err(text)?;
    let hex: Vec<String> = bytes.iter().map(|byte| format!("{byte:02X}")).collect();
    let shown: String = String::from_utf8_lossy(&bytes)
        .chars()
        .filter(|letter| !letter.is_control())
        .collect();
    Ok(format!("\"{}\" ({})", shown.trim(), hex.join(" ")))
}

fn bytes_of(buffer: &IBuffer) -> windows::core::Result<Vec<u8>> {
    let reader = DataReader::FromBuffer(buffer)?;
    let length = reader.UnconsumedBufferLength()?;
    let mut bytes = vec![0u8; length as usize];
    reader.ReadBytes(&mut bytes)?;
    Ok(bytes)
}

/// Writes the messages, one after another, to the one characteristic a
/// press goes to.
fn write_all(outgoing: &GattCharacteristic, messages: &[Vec<u8>]) -> Result<(), String> {
    for message in messages {
        write(outgoing, message)?;
    }
    Ok(())
}

/// The one write in this module. It is handed a characteristic from
/// `Subscribed::characteristic`, which knows only the writable ones.
fn write(characteristic: &GattCharacteristic, bytes: &[u8]) -> Result<(), String> {
    let writer = DataWriter::new().map_err(text)?;
    writer.WriteBytes(bytes).map_err(text)?;
    let buffer = writer.DetachBuffer().map_err(text)?;
    let status = characteristic
        .WriteValueWithResultAsync(&buffer)
        .and_then(|pending| pending.get())
        .and_then(|result| result.Status())
        .map_err(text)?;
    if status == GattCommunicationStatus::Success {
        Ok(())
    } else {
        Err(format!("CAM 1 did not take the message: {status:?}."))
    }
}
