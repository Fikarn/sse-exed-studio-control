//! CAM 1's pairing (D15 rule 2; the Pocket's link, part 5, 2026-10-06):
//! Setup's `Pair CAM 1` begins it, the camera shows a 6-digit PIN, the
//! operator types it in Setup, and Windows pairs. What is here is the pairing
//! as the runtime holds it (`PocketPairing`) and its pure parts: the steps and
//! their sentences, the PIN's form, what tells the Pocket's advertisement from
//! another's, and what Windows' answers mean. One thread (`cam1-pairing`)
//! speaks to Windows (`winrt_pairing.rs`; `stub.rs` where there is no
//! Windows), behind the link's own guard: no test and no plain development
//! run starts it.
//!
//! The steps: `Finding` (a passive listen for the Pocket's advertisement, a
//! minute at most), `Pin` (Windows asked for the PIN the camera shows; ninety
//! seconds at most), `Pairing` (the PIN handed over), then `Paired` with the
//! camera's address, which the runtime saves and holds, or `Failed` with the
//! sentence. A pairing is always made afresh: a pairing Windows still holds
//! for the camera it found is removed first, so the camera shows its PIN and
//! a bond the camera no longer holds cannot stand in the way. Forget leaves
//! Windows' pairing as it is. The pairing writes none of the camera's
//! characteristics.

use crate::cameras::pocket::characteristics::SERVICE;
use crate::cameras::pocket::link::guard_bluetooth;
use crate::cameras::real_link::BluetoothAddress;
use crate::cameras::snapshot::{CameraPairing, CameraPairingState};
use crate::diagnostics::{log_event, LogLevel};
use std::fmt;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(not(windows))]
use crate::cameras::pocket::stub as platform;
#[cfg(windows)]
use crate::cameras::pocket::winrt_pairing as platform;

/// How long the pairing looks for the camera.
pub(crate) const FIND_TIMEOUT: Duration = Duration::from_secs(60);
/// How long it waits for the PIN once the camera shows it.
pub(crate) const PIN_TIMEOUT: Duration = Duration::from_secs(90);
/// How long Windows may take to ask for the PIN once it has the camera, and
/// to pair once it has the PIN.
pub(crate) const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) const FINDING: &str =
    "Looking for CAM 1. Switch its Bluetooth on, with the iPad's app closed.";
pub(crate) const PIN_WANTED: &str = "CAM 1 shows a 6-digit PIN. Enter it here.";
pub(crate) const PAIRING: &str = "Pairing with CAM 1…";
pub(crate) const NOT_FOUND: &str = "CAM 1 was not found within a minute. Check that its Bluetooth is on and the iPad's app is closed, then press Pair CAM 1 again.";
pub(crate) const PIN_REFUSED: &str = "CAM 1 did not accept the PIN. Press Pair CAM 1 to try again.";
pub(crate) const NO_PIN: &str =
    "No PIN was entered within 90 seconds. Press Pair CAM 1 to try again.";
pub(crate) const NO_ANSWER: &str =
    "CAM 1 did not answer Windows' pairing. Press Pair CAM 1 to try again.";
pub(crate) const OTHER_KIND: &str = "CAM 1 asked for a kind of pairing Studio Control does not offer. Press Pair CAM 1 to try again.";
pub(crate) const STOPPED: &str = "CAM 1's pairing stopped. Press Pair CAM 1 to try again.";
/// `CAMERA_PAIRING_NOT_WANTED`.
pub(crate) const NOT_WANTED: &str =
    "CAM 1's pairing does not wait for a PIN now. Press Pair CAM 1 first.";

/// Where a pairing stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PairingStep {
    /// Looking for the camera: its Bluetooth on, nobody holding it.
    Finding,
    /// The camera shows its PIN; Setup waits for it.
    Pin,
    /// The PIN is handed over and Windows pairs.
    Pairing,
    /// It did not pair, and why. Nothing was saved.
    Failed(String),
    /// Windows paired the camera at this address: the runtime saves it and
    /// holds the camera.
    Paired(BluetoothAddress),
}

impl PairingStep {
    /// It still runs: the runtime follows it.
    pub(crate) fn running(&self) -> bool {
        matches!(self, Self::Finding | Self::Pin | Self::Pairing)
    }

    /// As Setup shows it; `None` once paired, which the runtime saves at
    /// once and shows as the camera's pairing.
    pub(crate) fn shown(&self) -> Option<CameraPairing> {
        let (state, sentence) = match self {
            Self::Finding => (CameraPairingState::Finding, FINDING),
            Self::Pin => (CameraPairingState::Pin, PIN_WANTED),
            Self::Pairing => (CameraPairingState::Pairing, PAIRING),
            Self::Failed(sentence) => {
                return Some(CameraPairing {
                    state: CameraPairingState::Failed,
                    sentence: sentence.clone(),
                })
            }
            Self::Paired(_) => return None,
        };
        Some(CameraPairing {
            state,
            sentence: String::from(sentence),
        })
    }
}

/// The PIN as Setup hands it over: six digits, with the spaces around them
/// taken away; `None` for anything else.
pub(crate) fn parse_pin(text: &str) -> Option<String> {
    let pin = text.trim();
    (pin.len() == 6 && pin.bytes().all(|byte| byte.is_ascii_digit())).then(|| pin.to_string())
}

/// How the camera's name begins as it advertises it.
const NAME_START: &str = "pocket cinema camera";

/// Whether an advertisement is the Pocket's: it names Blackmagic's camera
/// service, or the camera's own name. The pairing takes no other device.
pub(crate) fn is_pocket(services: &[u128], name: &str) -> bool {
    services.contains(&SERVICE) || name.trim().to_lowercase().starts_with(NAME_START)
}

/// What Windows asked for when it began to pair (`DevicePairingKinds`, by
/// its numbers).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Asked {
    /// The PIN the camera shows (`ProvidePin`): Setup asks the operator.
    Pin,
    /// Only to confirm (`ConfirmOnly`): accepted, as the operator pressed
    /// `Pair CAM 1` and the camera is the one found.
    Confirm,
    /// Anything else (a PIN for the camera to show, a comparison): refused.
    Other,
}

pub(crate) fn asked(kind: u32) -> Asked {
    match kind {
        4 => Asked::Pin,
        1 => Asked::Confirm,
        _ => Asked::Other,
    }
}

/// What Windows' pairing answered (`DevicePairingResultStatus`, by its
/// numbers): paired, or the sentence that says why not.
pub(crate) fn pairing_result(status: i32) -> Result<(), String> {
    let why = match status {
        // Paired, already paired.
        0 | 3 => return Ok(()),
        1 => "CAM 1 was not ready to pair.",
        4 => "CAM 1 refused the connection.",
        5 => "CAM 1 holds too many connections: close the iPad's app.",
        7 => "CAM 1 took too long to answer.",
        9 => return Err(String::from(PIN_REFUSED)),
        11 => "CAM 1 does not offer a pairing with a PIN.",
        14 => "The pairing was cancelled.",
        17 => return Err(String::from(OTHER_KIND)),
        other => {
            return Err(format!(
            "Windows could not pair CAM 1 (Windows' code {other}). Press Pair CAM 1 to try again."
        ))
        }
    };
    Err(format!("{why} Press Pair CAM 1 to try again."))
}

/// What reaches the pairing's thread.
pub(crate) enum PairingOrder {
    /// The PIN the camera shows, as the operator typed it.
    Pin(String),
    /// Forget, a new pairing: stop, and leave everything as it was.
    Cancel,
}

/// The step, shared by the thread and the runtime.
pub(crate) struct PairingShared {
    step: Mutex<PairingStep>,
}

impl PairingShared {
    fn with<T>(&self, action: impl FnOnce(&mut PairingStep) -> T) -> T {
        let mut step = self
            .step
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        action(&mut step)
    }

    pub(crate) fn step(&self) -> PairingStep {
        self.with(|step| step.clone())
    }

    /// The thread's next step; the end of a pairing is a line in the log.
    /// The thread tells the runtime to look after it, never under this lock.
    pub(crate) fn set(&self, next: PairingStep) {
        match &next {
            PairingStep::Paired(address) => log_event(
                LogLevel::Info,
                &format!("CAM 1 is paired with Windows at {}.", address.text()),
            ),
            PairingStep::Failed(sentence) => {
                log_event(LogLevel::Warn, &format!("CAM 1 did not pair: {sentence}"));
            }
            _ => {}
        }
        self.with(|step| *step = next);
    }
}

/// CAM 1's pairing, cloned freely: every clone is the same pairing.
#[derive(Clone)]
pub(crate) struct PocketPairing {
    shared: Arc<PairingShared>,
    orders: Sender<PairingOrder>,
}

impl PocketPairing {
    /// Begins a pairing behind the guard: in a test or a plain development
    /// build no thread starts and the pairing has failed with the guard's
    /// sentence. `notify` is the runtime's way of hearing that a step
    /// changed; the thread calls it after each.
    pub(crate) fn start(notify: impl Fn() + Send + 'static) -> Self {
        let (orders, inbox) = channel::<PairingOrder>();
        let shared = Arc::new(PairingShared {
            step: Mutex::new(PairingStep::Finding),
        });
        match guard_bluetooth() {
            Err(sentence) => shared.set(PairingStep::Failed(sentence)),
            Ok(()) => {
                log_event(
                    LogLevel::Info,
                    "CAM 1's pairing begins: Studio Control listens for the camera.",
                );
                let thread_shared = Arc::clone(&shared);
                let started = thread::Builder::new()
                    .name(String::from("cam1-pairing"))
                    .spawn(move || platform::pair(&thread_shared, &inbox, &notify));
                if let Err(error) = started {
                    shared.set(PairingStep::Failed(format!(
                        "CAM 1's pairing could not start its thread: {error}"
                    )));
                }
            }
        }
        Self { shared, orders }
    }

    pub(crate) fn step(&self) -> PairingStep {
        self.shared.step()
    }

    /// Hands the PIN over: the pairing reads `Pairing` at once. `false` when
    /// it does not wait for one.
    pub(crate) fn pin(&self, pin: String) -> bool {
        let wanted = self.shared.with(|step| {
            let wanted = *step == PairingStep::Pin;
            if wanted {
                *step = PairingStep::Pairing;
            }
            wanted
        });
        if wanted && self.orders.send(PairingOrder::Pin(pin)).is_err() {
            self.shared.set(PairingStep::Failed(String::from(STOPPED)));
        }
        wanted
    }

    /// Stops the pairing; nothing it began is kept.
    pub(crate) fn cancel(&self) {
        let _ = self.orders.send(PairingOrder::Cancel);
    }
}

impl fmt::Debug for PocketPairing {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PocketPairing")
            .field("step", &self.step())
            .finish_non_exhaustive()
    }
}

/// The thread's inbox, for the platform modules.
pub(crate) type PairingInbox = Receiver<PairingOrder>;
