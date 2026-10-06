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
//! Once each connection is made it writes the controller's name to the
//! camera's Device Name characteristic (D41), so the camera's Bluetooth menu
//! names Studio Control, as the iPad's app does; a camera that does not take
//! it is a line in the log, and the link goes on.
//!
//! What it never does: write the Camera Status characteristic (a `0x00`
//! there switches the camera off), pair (that is Setup's, `winrt_pairing.rs`),
//! or scan. `Writable` names the characteristics it may write, and the one
//! function that writes takes one of them.

use crate::cameras::pocket::characteristics::{Notified, Writable, SERVICE};
use crate::cameras::pocket::link::{Event, Events, Inbox, Order, PocketLink, Shared};
use crate::cameras::real_link::LinkFailure;
use crate::diagnostics::{log_event, LogLevel};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::core::{Error as WinError, IInspectable, GUID};
use windows::Devices::Bluetooth::GenericAttributeProfile::{
    GattCharacteristic, GattClientCharacteristicConfigurationDescriptorValue,
    GattCommunicationStatus, GattDeviceService, GattSession, GattValueChangedEventArgs,
};
use windows::Devices::Bluetooth::{
    BluetoothAddressType, BluetoothConnectionStatus, BluetoothLEDevice,
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
    handled: Vec<(GattCharacteristic, i64)>,
    writable: Vec<(Writable, GattCharacteristic)>,
}

impl Subscribed {
    fn characteristic(&self, writable: Writable) -> Option<&GattCharacteristic> {
        self.writable
            .iter()
            .find(|(which, _)| *which == writable)
            .map(|(_, characteristic)| characteristic)
    }

    /// Takes the handlers off; the characteristics go with it.
    fn end(self) {
        for (characteristic, token) in self.handled {
            let _ = characteristic.RemoveValueChanged(token);
        }
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
    gatt.SetMaintainConnection(true).map_err(text)?;

    let connection_events = events.clone();
    let connection_token = device
        .ConnectionStatusChanged(&TypedEventHandler::<BluetoothLEDevice, IInspectable>::new(
            move |device, _| {
                if let Some(device) = device.as_ref() {
                    let connected =
                        device.ConnectionStatus()? == BluetoothConnectionStatus::Connected;
                    let _ = connection_events.send(Order::Event(Event::Connected(connected)));
                }
                Ok(())
            },
        ))
        .map_err(text)?;

    let mut subscribed: Option<Subscribed> = None;
    let outcome = loop {
        if subscribed.is_none() {
            // Asks Windows for the camera's service, which connects when
            // the camera is free; while it is not, this is tried again
            // every `RETRY`, and Windows connects by itself meanwhile.
            if let Ok(fresh) = subscribe(device, events) {
                subscribed = Some(fresh);
                shared.take(&Event::Connected(true));
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
                if let Some(gone) = subscribed.take() {
                    gone.end();
                }
                shared.take(&Event::Connected(false));
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
        found
            .Characteristics()
            .and_then(|list| list.GetAt(0))
            .map_err(|_| String::from("CAM 1 lacks one of the protocol's characteristics."))
    };
    subscribed.writable.push((
        Writable::OutgoingControl,
        characteristic(Writable::OutgoingControl.uuid())?,
    ));
    for notified in Notified::ALL {
        let listened = characteristic(notified.uuid())?;
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
        subscribed.handled.push((listened.clone(), token));
        let status = listened
            .WriteClientCharacteristicConfigurationDescriptorWithResultAsync(
                GattClientCharacteristicConfigurationDescriptorValue::Notify,
            )
            .and_then(|pending| pending.get())
            .and_then(|result| result.Status())
            .map_err(text)?;
        if status != GattCommunicationStatus::Success {
            return Err(format!("CAM 1 refused the notifications of {notified:?}."));
        }
    }
    // The controller's name, once each connection, after the subscriptions
    // (D41). A camera that does not take it is a line in the log, and the
    // link goes on without it.
    match characteristic(Writable::DeviceName.uuid()) {
        Ok(name) => subscribed.writable.push((Writable::DeviceName, name)),
        Err(sentence) => log_event(
            LogLevel::Warn,
            &format!("CAM 1 offers no place for Studio Control's name: {sentence}"),
        ),
    }
    if let Some(name) = subscribed.characteristic(Writable::DeviceName) {
        if let Err(sentence) = write(name, CONTROLLER_NAME.as_bytes()) {
            log_event(
                LogLevel::Warn,
                &format!("CAM 1 did not take Studio Control's name: {sentence}"),
            );
        }
    }
    Ok(())
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
