//! CAM 1's pairing on Windows (the Pocket's link, part 5, 2026-10-06):
//! Windows' own pairing through the `windows` crate (WinRT, safe code). The
//! thread listens passively for the Pocket's advertisement (Blackmagic's
//! camera service, or the camera's name), takes the device it heard, removes
//! a pairing Windows still holds for it, and pairs with the PIN the camera
//! shows, which Setup hands over (`ProvidePin`; a camera that asks only to
//! confirm is accepted). Every wait has its deadline (`pairing.rs`). Nothing
//! here is reached by a test or a plain development run: `guard_bluetooth`
//! stands before this thread.
//!
//! What it never does: scan actively, take a device whose advertisement is
//! not the Pocket's, or write any of the camera's characteristics (that is
//! the link's, `winrt.rs`, once the camera is paired).

use crate::cameras::pocket::pairing::{
    asked, is_pocket, pairing_result, Asked, PairingInbox, PairingOrder, PairingShared,
    PairingStep, ANSWER_TIMEOUT, FIND_TIMEOUT, NOT_FOUND, NO_ANSWER, NO_PIN, OTHER_KIND,
    PIN_TIMEOUT, STOPPED,
};
use crate::cameras::real_link::BluetoothAddress;
use crate::diagnostics::{log_event, LogLevel};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::core::{Error as WinError, HSTRING};
use windows::Devices::Bluetooth::Advertisement::{
    BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher,
    BluetoothLEAdvertisementWatcherStatus, BluetoothLEScanningMode,
};
use windows::Devices::Bluetooth::{BluetoothAddressType, BluetoothLEDevice};
use windows::Devices::Enumeration::{
    DeviceInformationCustomPairing, DevicePairingKinds, DevicePairingProtectionLevel,
    DevicePairingRequestedEventArgs, DeviceUnpairingResultStatus,
};
use windows::Foundation::{Deferral, TypedEventHandler};

/// How often the thread looks at its inbox and at Windows' answer.
const TICK: Duration = Duration::from_millis(100);

/// `AsyncStatus` by its numbers (it is `windows-future`'s, which the engine
/// does not name).
const ASYNC_STARTED: i32 = 0;
const ASYNC_COMPLETED: i32 = 1;

/// Why the pairing ends before Windows has paired.
enum Stop {
    /// Forget, a new pairing, or nobody holds it any more: nothing is said.
    LetGo,
    /// It failed, and the sentence says why.
    Failed(String),
}

fn failed(sentence: &str) -> Stop {
    Stop::Failed(String::from(sentence))
}

fn windows_failed(error: &WinError) -> Stop {
    Stop::Failed(format!(
        "Windows could not pair CAM 1: {}. Press Pair CAM 1 to try again.",
        error.message()
    ))
}

/// The pairing's thread: find the camera, pair it, and say how it ended.
pub(crate) fn pair(shared: &Arc<PairingShared>, inbox: &PairingInbox, notify: &dyn Fn()) {
    let ended = find(inbox).and_then(|address| pair_with(shared, inbox, notify, address));
    let step = match ended {
        Ok(address) => PairingStep::Paired(address),
        // Nobody follows this pairing any more.
        Err(Stop::LetGo) => return,
        Err(Stop::Failed(sentence)) => PairingStep::Failed(sentence),
    };
    shared.set(step);
    notify();
}

/// Listens passively for the Pocket's advertisement, a minute at most; the
/// address of the first heard.
fn find(inbox: &PairingInbox) -> Result<BluetoothAddress, Stop> {
    let watcher = BluetoothLEAdvertisementWatcher::new().map_err(|error| windows_failed(&error))?;
    watcher
        .SetScanningMode(BluetoothLEScanningMode::Passive)
        .map_err(|error| windows_failed(&error))?;
    let (found, heard_from) = channel::<BluetoothAddress>();
    let heard = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&heard);
    let token = watcher
        .Received(&TypedEventHandler::<
            BluetoothLEAdvertisementWatcher,
            BluetoothLEAdvertisementReceivedEventArgs,
        >::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                counted.fetch_add(1, Ordering::Relaxed);
                let advertisement = args.Advertisement()?;
                let name = advertisement
                    .LocalName()
                    .map(|name| name.to_string())
                    .unwrap_or_default();
                let services: Vec<u128> = advertisement
                    .ServiceUuids()
                    .map(|list| {
                        (0..list.Size().unwrap_or(0))
                            .filter_map(|index| list.GetAt(index).ok())
                            .map(|uuid| uuid.to_u128())
                            .collect()
                    })
                    .unwrap_or_default();
                if is_pocket(&services, &name) {
                    let random = args
                        .BluetoothAddressType()
                        .is_ok_and(|kind| kind == BluetoothAddressType::Random);
                    let _ = found.send(BluetoothAddress {
                        address: args.BluetoothAddress()?,
                        random,
                    });
                }
            }
            Ok(())
        }))
        .map_err(|error| windows_failed(&error))?;
    let outcome = listen(&watcher, inbox, &heard_from);
    let _ = watcher.Stop();
    let _ = watcher.RemoveReceived(token);
    match &outcome {
        Ok(address) => log_event(
            LogLevel::Info,
            &format!("CAM 1 was heard at {}.", address.text()),
        ),
        Err(Stop::Failed(_)) => log_event(
            LogLevel::Info,
            &format!(
                "CAM 1 was not heard: {} advertisements in all, none the Pocket's.",
                heard.load(Ordering::Relaxed)
            ),
        ),
        Err(Stop::LetGo) => {}
    }
    outcome
}

fn listen(
    watcher: &BluetoothLEAdvertisementWatcher,
    inbox: &PairingInbox,
    heard_from: &Receiver<BluetoothAddress>,
) -> Result<BluetoothAddress, Stop> {
    watcher.Start().map_err(|error| {
        Stop::Failed(format!(
            "Windows could not listen for CAM 1: {}. Check that Bluetooth is on.",
            error.message()
        ))
    })?;
    let until = Instant::now() + FIND_TIMEOUT;
    while Instant::now() < until {
        if let Ok(address) = heard_from.try_recv() {
            return Ok(address);
        }
        if watcher.Status().ok() == Some(BluetoothLEAdvertisementWatcherStatus::Aborted) {
            return Err(failed(
                "Windows stopped listening for CAM 1. Check that Bluetooth is on, then press Pair CAM 1 again.",
            ));
        }
        match inbox.recv_timeout(TICK) {
            Ok(PairingOrder::Cancel) | Err(RecvTimeoutError::Disconnected) => {
                return Err(Stop::LetGo)
            }
            // The runtime hands a PIN over only while one is wanted.
            Ok(PairingOrder::Pin(_)) | Err(RecvTimeoutError::Timeout) => {}
        }
    }
    Err(failed(NOT_FOUND))
}

/// Pairs the camera heard at `address` afresh.
fn pair_with(
    shared: &Arc<PairingShared>,
    inbox: &PairingInbox,
    notify: &dyn Fn(),
    address: BluetoothAddress,
) -> Result<BluetoothAddress, Stop> {
    let kind = if address.random {
        BluetoothAddressType::Random
    } else {
        BluetoothAddressType::Public
    };
    let device = BluetoothLEDevice::FromBluetoothAddressWithBluetoothAddressTypeAsync(
        address.address,
        kind,
    )
    .and_then(|pending| pending.get())
    .map_err(|_| {
        failed("Windows did not find CAM 1 at the address it heard. Press Pair CAM 1 to try again.")
    })?;
    let outcome = pair_device(shared, inbox, notify, &device);
    let _ = device.Close();
    outcome.map(|()| address)
}

/// Removes a pairing Windows holds for the device, then pairs it with the
/// PIN the operator hands over.
fn pair_device(
    shared: &Arc<PairingShared>,
    inbox: &PairingInbox,
    notify: &dyn Fn(),
    device: &BluetoothLEDevice,
) -> Result<(), Stop> {
    let pairing = device
        .DeviceInformation()
        .and_then(|information| information.Pairing())
        .map_err(|error| windows_failed(&error))?;
    if pairing.IsPaired().map_err(|error| windows_failed(&error))? {
        let status = pairing
            .UnpairAsync()
            .and_then(|pending| pending.get())
            .and_then(|result| result.Status())
            .map_err(|error| windows_failed(&error))?;
        if status != DeviceUnpairingResultStatus::Unpaired
            && status != DeviceUnpairingResultStatus::AlreadyUnpaired
        {
            return Err(failed(
                "Windows could not remove its old pairing with CAM 1. Remove CAM 1 in Windows' Bluetooth settings, then press Pair CAM 1 again.",
            ));
        }
        log_event(
            LogLevel::Info,
            "Windows' old pairing with CAM 1 was removed: CAM 1 pairs afresh.",
        );
    }
    let custom = device
        .DeviceInformation()
        .and_then(|information| information.Pairing())
        .and_then(|pairing| pairing.Custom())
        .map_err(|error| windows_failed(&error))?;
    let (requests, asked_for) = channel::<(DevicePairingRequestedEventArgs, Deferral)>();
    let token = custom
        .PairingRequested(&TypedEventHandler::<
            DeviceInformationCustomPairing,
            DevicePairingRequestedEventArgs,
        >::new(move |_, args| {
            // Windows waits for the answer until the deferral completes:
            // the thread gives it, with the operator's PIN.
            if let Some(args) = args.as_ref() {
                let deferral = args.GetDeferral()?;
                let _ = requests.send((args.clone(), deferral));
            }
            Ok(())
        }))
        .map_err(|error| windows_failed(&error))?;
    let outcome = answer(shared, inbox, notify, &custom, &asked_for);
    let _ = custom.RemovePairingRequested(token);
    outcome
}

/// Asks Windows to pair, answers what it asks, and waits for its answer:
/// the PIN within `PIN_TIMEOUT` of the camera showing it, Windows within
/// `ANSWER_TIMEOUT` otherwise. What is left unanswered at the end is
/// refused, and a pairing still running cancelled.
fn answer(
    shared: &Arc<PairingShared>,
    inbox: &PairingInbox,
    notify: &dyn Fn(),
    custom: &DeviceInformationCustomPairing,
    asked_for: &Receiver<(DevicePairingRequestedEventArgs, Deferral)>,
) -> Result<(), Stop> {
    let operation = custom
        .PairWithProtectionLevelAsync(
            DevicePairingKinds::ProvidePin | DevicePairingKinds::ConfirmOnly,
            DevicePairingProtectionLevel::Encryption,
        )
        .map_err(|error| windows_failed(&error))?;
    // What Windows asked and is not answered yet, held by its deferral.
    let mut held: Option<(DevicePairingRequestedEventArgs, Deferral)> = None;
    let mut refused_kind = false;
    let mut deadline = Instant::now() + ANSWER_TIMEOUT;
    let mut late = NO_ANSWER;
    let outcome = loop {
        match operation.Status().map(|status| status.0) {
            Ok(ASYNC_STARTED) => {}
            Ok(ASYNC_COMPLETED) => {
                let status = operation
                    .GetResults()
                    .and_then(|result| result.Status())
                    .map_err(|error| windows_failed(&error));
                break status.and_then(|status| {
                    if refused_kind {
                        Err(failed(OTHER_KIND))
                    } else {
                        pairing_result(status.0).map_err(Stop::Failed)
                    }
                });
            }
            Ok(_) => {
                break Err(operation
                    .GetResults()
                    .err()
                    .map_or_else(|| failed(STOPPED), |error| windows_failed(&error)))
            }
            Err(error) => break Err(windows_failed(&error)),
        }
        if let Ok((args, deferral)) = asked_for.try_recv() {
            match args.PairingKind().map(|kind| asked(kind.0)) {
                Ok(Asked::Pin) => {
                    held = Some((args, deferral));
                    shared.set(PairingStep::Pin);
                    notify();
                    deadline = Instant::now() + PIN_TIMEOUT;
                    late = NO_PIN;
                }
                Ok(Asked::Confirm) => {
                    let _ = args.Accept();
                    let _ = deferral.Complete();
                    shared.set(PairingStep::Pairing);
                    notify();
                    deadline = Instant::now() + ANSWER_TIMEOUT;
                }
                // Not accepted: Windows' pairing ends refused.
                Ok(Asked::Other) | Err(_) => {
                    refused_kind = true;
                    let _ = deferral.Complete();
                }
            }
        }
        match inbox.recv_timeout(TICK) {
            Ok(PairingOrder::Pin(pin)) => {
                // The runtime reads `Pairing` already (`PocketPairing::pin`).
                if let Some((args, deferral)) = held.take() {
                    let accepted = args.AcceptWithPin(&HSTRING::from(pin.as_str()));
                    let _ = deferral.Complete();
                    if let Err(error) = accepted {
                        break Err(windows_failed(&error));
                    }
                    deadline = Instant::now() + ANSWER_TIMEOUT;
                    late = NO_ANSWER;
                }
            }
            Ok(PairingOrder::Cancel) | Err(RecvTimeoutError::Disconnected) => {
                break Err(Stop::LetGo)
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        if Instant::now() > deadline {
            break Err(failed(late));
        }
    };
    if let Some((_, deferral)) = held.take() {
        let _ = deferral.Complete();
    }
    if operation.Status().map(|status| status.0).ok() == Some(ASYNC_STARTED) {
        let _ = operation.Cancel();
    }
    outcome
}
