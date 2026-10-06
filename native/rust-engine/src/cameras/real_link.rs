//! The real links: CAM 1's over Bluetooth (the Pocket's, Blackmagic's
//! protocol on Windows' own pairing and GATT, `pocket/`), CAM 2's and CAM 3's
//! over the network (Panasonic's LUMIX SDK, after it). `RealLinks` is the
//! seam the runtime talks to: it is told which cameras to hold and to let
//! go, it is read without waiting, and it is sent the operator's presses. A
//! camera whose link is not built does not answer, and the sentence says
//! Studio Control has no link to it yet.
//!
//! The drift guard (D15 rule 1): the network link calls
//! `guard_camera_address` before it would connect, and in a test build that
//! refuses every address but this PC's, so no test can reach a camera on the
//! studio's network whatever its saved data says. The Pocket's link has a
//! guard of its own (`pocket::link::guard_bluetooth`, D15 rule 2).

use crate::cameras::model::{model, RECORDING_CAMERA};
use crate::cameras::pocket::link::PocketLink;
use crate::cameras::pocket::pairing::{PairingStep, PocketPairing};
use crate::cameras::runtime::notice;
use crate::cameras::simulated::{CameraCommand, CameraReading};
use crate::cameras::store::StoredSetup;
use std::path::{Path, PathBuf};

/// Why a camera could not be read or sent anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LinkFailure {
    /// The link reached for it and it did not answer.
    NoAnswer,
    /// Studio Control has no link of this kind yet.
    NoLinkYet,
    /// A test build refused to reach for it (the drift guard); the reason.
    Refused(String),
    /// The Bluetooth link cannot reach it, in the link's own words: the
    /// guard's refusal, no session.
    Bluetooth(String),
    /// Windows no longer holds CAM 1's pairing, or its row holds no
    /// Bluetooth address: the camera reads `NOT SET UP` and Setup pairs it
    /// again. The saved row is kept, so an adapter that is off erases
    /// nothing.
    NotPaired(String),
    /// The press cannot be carried by the camera's protocol; nothing was
    /// sent, and the camera is as reachable as before.
    NotCarried(String),
}

impl LinkFailure {
    /// The unreachable camera's sentence.
    pub(crate) fn sentence(&self, camera: u8, address: Option<&str>) -> String {
        let model = model(camera);
        match self {
            Self::NoAnswer => model.unreachable_sentence(address),
            Self::NoLinkYet => model.no_link_sentence(),
            Self::Refused(reason)
            | Self::Bluetooth(reason)
            | Self::NotPaired(reason)
            | Self::NotCarried(reason) => reason.clone(),
        }
    }
}

/// The sentence of a CAM 1 row that is paired and holds no Bluetooth
/// address (saved data from before the link: only a database backup brings
/// one).
pub(crate) const NO_BLUETOOTH_ADDRESS: &str =
    "CAM 1's pairing holds no Bluetooth address. Pair it again in Setup.";

/// The cameras whose real link is built: CAM 1 on Windows, with the
/// Pocket's pairing (part 5, 2026-10-06); CAM 2 and CAM 3 join with the
/// LUMIX SDK's part. Linux, where only CI builds the engine, has none.
const BUILT: [u8; 1] = [RECORDING_CAMERA];

/// Whether this build can reach the camera at all: through the simulated
/// link, or through its real one once that is built. Without a link Setup
/// takes no pairing and no address for it (`CAMERA_NO_LINK`), so the camera
/// reads `NOT SET UP`, not a fault. Saved data that holds a pairing or an
/// address all the same (a database backup restored whole) is the one way
/// to a fault there: that camera reads `UNREACHABLE` until it is forgotten.
pub(crate) fn has_link(camera: u8, simulated: bool) -> bool {
    simulated || (cfg!(windows) && BUILT.contains(&camera))
}

/// The addresses a test build may connect to: this PC's own.
const THIS_PC: [&str; 3] = ["127.0.0.1", "::1", "localhost"];

/// The drift guard every connection of the network link passes first: in a
/// test build (`cfg(test)`), an address that is not on this PC is refused
/// before anything is sent or opened. The live app is never refused here.
pub(crate) fn guard_camera_address(address: &str) -> Result<(), String> {
    let address = address.trim();
    if cfg!(test) && !THIS_PC.contains(&address) {
        return Err(format!(
            "A test run does not reach {address}: only 127.0.0.1, ::1 and localhost."
        ));
    }
    Ok(())
}

/// A Bluetooth LE address with its kind: public, or random (a static random
/// address, which many devices use; Windows must be told which it is to find
/// the device).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BluetoothAddress {
    pub address: u64,
    pub random: bool,
}

impl BluetoothAddress {
    /// The address as CAM 1's row holds it: `D4:3A:2C:11:22:33`, with
    /// ` random` after it for a random address. The pairing writes it.
    pub(crate) fn text(self) -> String {
        let bytes = self.address.to_be_bytes();
        let pairs: Vec<String> = bytes[2..]
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect();
        let joined = pairs.join(":");
        if self.random {
            format!("{joined} random")
        } else {
            joined
        }
    }
}

/// A Bluetooth address as CAM 1's row holds it, `D4:3A:2C:11:22:33` (six
/// pairs of hexadecimal digits, with `:` or `-` between), with ` random`
/// after it for a random address; `None` for anything else, an IPv4
/// address included.
pub(crate) fn parse_bluetooth_address(text: &str) -> Option<BluetoothAddress> {
    let mut words = text.split_whitespace();
    let digits = words.next()?;
    let random = match words.next() {
        None => false,
        Some("random") => true,
        Some(_) => return None,
    };
    if words.next().is_some() {
        return None;
    }
    let parts: Vec<&str> = digits.split([':', '-']).collect();
    if parts.len() != 6 {
        return None;
    }
    let mut address: u64 = 0;
    for part in parts {
        if part.len() != 2 {
            return None;
        }
        address = (address << 8) | u64::from(u8::from_str_radix(part, 16).ok()?);
    }
    Some(BluetoothAddress { address, random })
}

/// The real links as the runtime holds them, one seam for the three
/// cameras. It is told to hold a camera (a start, `Connect`, a new setup) and
/// to let it go (`Release`, `Forget`); it is read without waiting, since the
/// request loop must never wait on a camera (a link keeps its newest reading
/// on a thread of its own); and it is sent the operator's presses, which may
/// wait a bounded moment for the camera's answer. With the simulated cameras
/// the runtime never speaks to it. CAM 1's link starts when its row holds a
/// pairing and the camera's Bluetooth address, and CAM 1's pairing runs here
/// too (`begin_pairing`); CAM 2 and CAM 3 read `NoLinkYet` after the drift
/// guard.
#[derive(Debug, Clone)]
pub(crate) struct RealLinks {
    /// The saved data the links belong to: what a link's thread tells the
    /// runtime to look at again (`notice`).
    db_path: PathBuf,
    pocket: Option<PocketLink>,
    /// CAM 1's pairing while the runtime follows it.
    pairing: Option<PocketPairing>,
    /// What the runtime told the links, in order (`hold 2`, `let go 2`), for
    /// the tests of the seam.
    #[cfg(test)]
    told: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

impl RealLinks {
    pub(crate) fn new(db_path: &Path) -> Self {
        Self {
            db_path: db_path.to_path_buf(),
            pocket: None,
            pairing: None,
            #[cfg(test)]
            told: std::sync::Arc::default(),
        }
    }

    /// Begins CAM 1's pairing, a pairing that runs given up first; its
    /// first step. The pairing's thread tells the runtime of each step after
    /// it (`notice`).
    pub(crate) fn begin_pairing(&mut self) -> PairingStep {
        self.cancel_pairing();
        let db_path = self.db_path.clone();
        let pairing = PocketPairing::start(move || notice(&db_path));
        let step = pairing.step();
        self.pairing = Some(pairing);
        step
    }

    /// Where CAM 1's pairing stands; `None` when none is followed.
    pub(crate) fn pairing_step(&self) -> Option<PairingStep> {
        self.pairing.as_ref().map(PocketPairing::step)
    }

    /// Hands the camera's PIN to the pairing; `false` when it does not
    /// wait for one.
    pub(crate) fn give_pin(&self, pin: String) -> bool {
        self.pairing
            .as_ref()
            .is_some_and(|pairing| pairing.pin(pin))
    }

    /// Stops CAM 1's pairing (Forget, a new pairing).
    pub(crate) fn cancel_pairing(&mut self) {
        if let Some(pairing) = self.pairing.take() {
            pairing.cancel();
        }
    }

    /// The pairing has ended and the runtime took its end: it is followed
    /// no more.
    pub(crate) fn end_pairing(&mut self) {
        self.pairing = None;
    }

    /// Holds a set-up camera: its link connects and keeps reading it. CAM 1
    /// without a Bluetooth address in its row (a pairing from before the
    /// link, restored whole) has no link to start, and a link that was
    /// running for another row is let go.
    pub(crate) fn hold(&mut self, setup: &StoredSetup) {
        self.note("hold", setup.camera);
        if setup.camera != RECORDING_CAMERA {
            return;
        }
        let Some(address) = setup.address.as_deref().and_then(parse_bluetooth_address) else {
            self.let_go_pocket();
            return;
        };
        if self
            .pocket
            .as_ref()
            .is_some_and(|pocket| pocket.address() == address && !pocket.stopped())
        {
            return;
        }
        self.let_go_pocket();
        let db_path = self.db_path.clone();
        self.pocket = Some(PocketLink::start(address, move || notice(&db_path)));
    }

    /// Lets a camera go: its link disconnects and reads it no more.
    pub(crate) fn let_go(&mut self, camera: u8) {
        self.note("let go", camera);
        if camera == RECORDING_CAMERA {
            self.let_go_pocket();
        }
    }

    fn let_go_pocket(&mut self) {
        if let Some(pocket) = self.pocket.take() {
            pocket.let_go();
        }
    }

    /// What the camera last reported, at once; or why it cannot be read.
    pub(crate) fn read(&self, setup: &StoredSetup) -> Result<CameraReading, LinkFailure> {
        match (&self.pocket, setup.camera) {
            (Some(pocket), RECORDING_CAMERA) => pocket.read(),
            _ => Err(no_link_yet(setup)),
        }
    }

    /// Sends the operator's press to a held camera, with what it last
    /// reported (a press that sets half a parameter carries the other half).
    pub(crate) fn send(
        &mut self,
        setup: &StoredSetup,
        commands: &[CameraCommand],
        current: &CameraReading,
    ) -> Result<(), LinkFailure> {
        match (&self.pocket, setup.camera) {
            (Some(pocket), RECORDING_CAMERA) => pocket.send(commands, current),
            _ => Err(no_link_yet(setup)),
        }
    }

    /// What the runtime told the links since they were made.
    #[cfg(test)]
    pub(crate) fn told(&self) -> Vec<String> {
        self.told
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn note(&self, what: &str, camera: u8) {
        #[cfg(test)]
        self.told
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(format!("{what} {camera}"));
        #[cfg(not(test))]
        let _ = (what, camera);
    }
}

/// A camera with no link running. CAM 1 on Windows: its row is paired and
/// holds no Bluetooth address (a link starts for any address it holds).
/// Until the links are built: CAM 2 and CAM 3 pass the drift guard first;
/// then there is no link to read them with.
fn no_link_yet(setup: &StoredSetup) -> LinkFailure {
    if setup.camera == RECORDING_CAMERA && has_link(RECORDING_CAMERA, false) {
        return LinkFailure::NotPaired(String::from(NO_BLUETOOTH_ADDRESS));
    }
    if let Some(address) = setup
        .address
        .as_deref()
        .filter(|_| setup.camera != RECORDING_CAMERA)
    {
        if let Err(reason) = guard_camera_address(address) {
            return LinkFailure::Refused(reason);
        }
    }
    LinkFailure::NoLinkYet
}
