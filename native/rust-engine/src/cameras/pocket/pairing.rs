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
//! The steps: `Finding` (an active listen for the Pocket's advertisement and
//! scan reply, a minute at most), `Pin` (Windows asked for the PIN the camera shows; thirty
//! seconds at most, as Bluetooth's pairing allows), `Pairing` (the PIN handed over), then `Paired` with the
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
use std::collections::BTreeMap;
use std::fmt;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::cameras::pocket::winrt_pairing as platform;

/// How long the pairing looks for the camera.
pub(crate) const FIND_TIMEOUT: Duration = Duration::from_secs(60);
/// How long it waits for the PIN once the camera shows it: Bluetooth's
/// pairing gives the PIN about 30 seconds (its timer), and a pairing that
/// ends sooner while the PIN is awaited says `NO_PIN` too.
pub(crate) const PIN_TIMEOUT: Duration = Duration::from_secs(30);
/// How long Windows may take to ask for the PIN once it has the camera, and
/// to pair once it has the PIN.
pub(crate) const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) const FINDING: &str =
    "Looking for CAM 1. Switch its Bluetooth on, with no other controller connected to it.";
pub(crate) const PIN_WANTED: &str = "CAM 1 shows a 6-digit PIN. Enter it here within 30 seconds.";
pub(crate) const PAIRING: &str = "Pairing with CAM 1…";
pub(crate) const NOT_FOUND: &str = "CAM 1 was not found within a minute. Check that its Bluetooth is on and that no other controller holds it, then press Pair CAM 1 again.";
pub(crate) const PIN_REFUSED: &str = "CAM 1 did not accept the PIN. Press Pair CAM 1 to try again.";
pub(crate) const NO_PIN: &str =
    "The PIN was not entered within 30 seconds. Press Pair CAM 1 to try again.";
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

/// Whether an advertisement (or a scan reply) is the Pocket's: it names
/// Blackmagic's camera service. The camera's name tells nothing: it is the
/// camera's own ID (`A:F901D868` on the studio's Pocket, 2026-10-07). The
/// pairing takes no other device.
pub(crate) fn is_pocket(services: &[u128]) -> bool {
    services.contains(&SERVICE)
}

/// How many devices a listen that did not hear the Pocket keeps for the log.
pub(crate) const HEARD_KEPT: usize = 32;

/// A service as Windows writes it, `291D567A-6D75-11E6-8B77-86F30CA893D3`.
fn service_text(uuid: u128) -> String {
    let hex = format!("{uuid:032X}");
    let parts: Vec<&str> = [(0, 8), (8, 12), (12, 16), (16, 20), (20, 32)]
        .iter()
        .filter_map(|&(from, to)| hex.get(from..to))
        .collect();
    parts.join("-")
}

/// One advertisement as a listen that did not hear the Pocket names it in
/// the log: the address, the name, the services, the makers' IDs and the
/// kinds of data it carried (`sections`, the advertisement's data types).
pub(crate) fn heard_entry(
    address: BluetoothAddress,
    name: &str,
    services: &[u128],
    makers: &[u16],
    sections: &[u8],
) -> String {
    let name = name.trim();
    let mut entry = address.text();
    if !name.is_empty() {
        entry.push_str(&format!(" \"{name}\""));
    }
    if !services.is_empty() {
        let listed: Vec<String> = services.iter().map(|&uuid| service_text(uuid)).collect();
        entry.push_str(&format!(" [{}]", listed.join(", ")));
    }
    if !makers.is_empty() {
        let listed: Vec<String> = makers.iter().map(|id| format!("{id:04X}")).collect();
        entry.push_str(&format!(" maker {}", listed.join(", ")));
    }
    if !sections.is_empty() {
        let listed: Vec<String> = sections.iter().map(|kind| format!("{kind:02X}")).collect();
        entry.push_str(&format!(" sections {}", listed.join(" ")));
    }
    entry
}

/// How often one entry was heard, and at its strongest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Seen {
    strongest_dbm: i16,
    count: usize,
}

/// What a listen heard, for the log's line when it did not hear the Pocket:
/// each distinct advertisement with its count and strongest signal,
/// `HEARD_KEPT` distinct ones at most.
#[derive(Debug, Default)]
pub(crate) struct Heard {
    entries: BTreeMap<String, Seen>,
    more: bool,
}

impl Heard {
    pub(crate) fn note(&mut self, entry: String, dbm: i16) {
        if let Some(seen) = self.entries.get_mut(&entry) {
            seen.count += 1;
            seen.strongest_dbm = seen.strongest_dbm.max(dbm);
            return;
        }
        if self.entries.len() < HEARD_KEPT {
            self.entries.insert(
                entry,
                Seen {
                    strongest_dbm: dbm,
                    count: 1,
                },
            );
        } else {
            self.more = true;
        }
    }

    /// The log's line: how many advertisements came, and what they were.
    pub(crate) fn line(&self, advertisements: usize) -> String {
        let mut line = format!(
            "CAM 1 was not heard: {advertisements} advertisements in all, none the Pocket's."
        );
        if !self.entries.is_empty() {
            let listed: Vec<String> = self
                .entries
                .iter()
                .map(|(entry, seen)| {
                    format!("{entry} ({} dBm, {}×)", seen.strongest_dbm, seen.count)
                })
                .collect();
            line.push_str(&format!(" Heard: {}", listed.join("; ")));
            line.push_str(if self.more { "; and more." } else { "." });
        }
        line
    }
}

/// The log's line when the Pocket was heard: where, how strongly, and in
/// which packet (its scan reply answers only an active listen).
pub(crate) fn heard_line(address: BluetoothAddress, dbm: i16, scan_reply: bool) -> String {
    format!(
        "CAM 1 was heard at {} ({dbm} dBm, in its {}).",
        address.text(),
        if scan_reply {
            "scan reply"
        } else {
            "advertisement"
        }
    )
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
        5 => "CAM 1 holds too many connections: disconnect its other controller.",
        7 => "CAM 1 took too long to answer.",
        9 => return Err(String::from(PIN_REFUSED)),
        11 => "CAM 1 does not offer a pairing with a PIN.",
        14 => "The pairing was cancelled.",
        15 => "Windows is still busy with an earlier pairing of CAM 1: wait a moment.",
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
