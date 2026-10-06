//! The Pocket's link on Windows: Windows' own Bluetooth LE through the
//! `windows` crate (WinRT, safe code). The link's thread takes the device
//! at its address, checks that Windows still holds its pairing, opens a GATT
//! session that keeps the connection (Windows connects again whenever the
//! camera is free), subscribes to the three notified characteristics and
//! hands every notification to the link's state; a press is written to the
//! Outgoing Camera Control characteristic. Nothing here is reached by a
//! test or a development run: `guard_bluetooth` stands before this thread.
//!
//! What it never does: write the Camera Status characteristic (a `0x00`
//! there switches the camera off), pair (that is Setup's, in the next part),
//! or scan. `Writable` names the characteristics it may write, and the one
//! function that writes takes one of them.

use crate::cameras::pocket::characteristics::{Notified, Writable, SERVICE};
use crate::cameras::pocket::link::{Event, Events, Inbox, Order, Shared};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::Duration;
use windows::core::{Error as WinError, IInspectable, GUID};
use windows::Devices::Bluetooth::GenericAttributeProfile::{
    GattCharacteristic, GattClientCharacteristicConfigurationDescriptorValue,
    GattCommunicationStatus, GattDeviceService, GattSession, GattValueChangedEventArgs,
};
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothLEDevice};
use windows::Foundation::TypedEventHandler;
use windows::Storage::Streams::{DataReader, DataWriter, IBuffer};

/// How often the thread looks for the camera while it is not connected.
const RETRY: Duration = Duration::from_secs(5);

/// The link's thread: the session with the camera, until it is let go or
/// cannot go on.
pub(crate) fn run(shared: Arc<Shared>, inbox: Inbox, events: Events) {
    match session(&shared, &inbox, &events) {
        Ok(()) => shared.stopped(),
        Err(sentence) => shared.fail(sentence),
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

    fn end(self) {
        for (characteristic, token) in self.handled {
            let _ = characteristic.RemoveValueChanged(token);
        }
    }
}

fn session(shared: &Arc<Shared>, inbox: &Inbox, events: &Events) -> Result<(), String> {
    let device = BluetoothLEDevice::FromBluetoothAddressAsync(shared.address)
        .and_then(|pending| pending.get())
        .map_err(|error| {
            format!(
                "Windows did not find CAM 1 at its Bluetooth address: {}",
                text(error)
            )
        })?;
    let paired = device
        .DeviceInformation()
        .and_then(|information| information.Pairing())
        .and_then(|pairing| pairing.IsPaired())
        .map_err(|error| {
            format!(
                "Windows could not say whether CAM 1 is paired: {}",
                text(error)
            )
        })?;
    if !paired {
        return Err(String::from(
            "Windows no longer holds CAM 1's pairing. Pair it again in Setup.",
        ));
    }
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
            if let Ok(fresh) = subscribe(&device, events) {
                subscribed = Some(fresh);
                shared.take(&Event::Connected(true));
            }
        }
        match inbox.recv_timeout(RETRY) {
            Ok(Order::LetGo) | Err(RecvTimeoutError::Disconnected) => break Ok(()),
            Ok(Order::Send(messages, reply)) => {
                let outcome = match subscribed
                    .as_ref()
                    .and_then(|subscribed| subscribed.characteristic(Writable::OutgoingControl))
                {
                    Some(outgoing) => write_all(outgoing, &messages),
                    None => Err(String::from("CAM 1 is not connected over Bluetooth.")),
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
    };

    if let Some(gone) = subscribed.take() {
        gone.end();
    }
    let _ = device.RemoveConnectionStatusChanged(connection_token);
    let _ = gatt.Close();
    let _ = device.Close();
    outcome
}

/// The camera's service and characteristics, the notified ones subscribed
/// with a handler each. `Err` while the camera cannot be reached.
fn subscribe(device: &BluetoothLEDevice, events: &Events) -> Result<Subscribed, String> {
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
    let writable = vec![(
        Writable::OutgoingControl,
        characteristic(Writable::OutgoingControl.uuid())?,
    )];
    let mut handled = Vec::with_capacity(Notified::ALL.len());
    for notified in Notified::ALL {
        let listened = characteristic(notified.uuid())?;
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
        handled.push((listened, token));
    }
    Ok(Subscribed { handled, writable })
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
