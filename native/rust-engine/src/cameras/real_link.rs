//! The real links: CAM 1's over Bluetooth (the Pocket's, Blackmagic's
//! protocol on Windows' own pairing and GATT, built in parts from
//! 2026-10-06), CAM 2's and CAM 3's over the network (Panasonic's LUMIX SDK,
//! after it). `RealLinks` is the seam the runtime talks to: it is told which
//! cameras to hold and to let go, it is read without waiting, and it is sent
//! the operator's presses. A camera whose link is not built does not answer,
//! and the sentence says Studio Control has no link to it yet.
//!
//! The drift guard (D15 rule 1): the network link calls
//! `guard_camera_address` before it would connect, and in a test build that
//! refuses every address but this PC's, so no test can reach a camera on the
//! studio's network whatever its saved data says.

use crate::cameras::model::model;
use crate::cameras::simulated::{CameraCommand, CameraReading};
use crate::cameras::store::StoredSetup;

/// Why a camera could not be read or sent anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LinkFailure {
    /// The link reached for it and it did not answer.
    NoAnswer,
    /// Studio Control has no link of this kind yet.
    NoLinkYet,
    /// A test build refused to reach for it (the drift guard); the reason.
    Refused(String),
}

impl LinkFailure {
    /// The unreachable camera's sentence.
    pub(crate) fn sentence(&self, camera: u8, address: Option<&str>) -> String {
        let model = model(camera);
        match self {
            Self::NoAnswer => model.unreachable_sentence(address),
            Self::NoLinkYet => model.no_link_sentence(),
            Self::Refused(reason) => reason.clone(),
        }
    }
}

/// The cameras whose real link is built: none yet. CAM 1 joins with the
/// Pocket's pairing, CAM 2 and CAM 3 with the LUMIX SDK's part.
const BUILT: [u8; 0] = [];

/// Whether this build can reach the camera at all: through the simulated
/// link, or through its real one once that is built. Without a link Setup
/// takes no pairing and no address for it (`CAMERA_NO_LINK`), so the camera
/// reads `NOT SET UP`, not a fault. Saved data that holds a pairing or an
/// address all the same (a database backup restored whole) is the one way
/// to a fault there: that camera reads `UNREACHABLE` until it is forgotten.
pub(crate) fn has_link(camera: u8, simulated: bool) -> bool {
    simulated || BUILT.contains(&camera)
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

/// The real links as the runtime holds them, one seam for the three
/// cameras. It is told to hold a camera (a start, `Connect`, a new setup) and
/// to let it go (`Release`, `Forget`); it is read without waiting, since the
/// request loop must never wait on a camera (a link keeps its newest reading
/// on a thread of its own); and it is sent the operator's presses, which may
/// wait a bounded moment for the camera's answer. With the simulated cameras
/// the runtime never speaks to it. Until the Pocket's parts are built every
/// camera reads `NoLinkYet` here, CAM 2 and CAM 3 after the drift guard.
#[derive(Debug, Clone, Default)]
pub(crate) struct RealLinks {
    /// What the runtime told the links, in order (`hold 2`, `let go 2`), for
    /// the tests of the seam.
    #[cfg(test)]
    told: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

impl RealLinks {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Holds a set-up camera: its link connects and keeps reading it.
    pub(crate) fn hold(&mut self, setup: &StoredSetup) {
        self.note("hold", setup.camera);
    }

    /// Lets a camera go: its link disconnects and reads it no more.
    pub(crate) fn let_go(&mut self, camera: u8) {
        self.note("let go", camera);
    }

    /// What the camera last reported, at once; or why it cannot be read.
    pub(crate) fn read(&self, setup: &StoredSetup) -> Result<CameraReading, LinkFailure> {
        Err(no_link_yet(setup))
    }

    /// Sends the operator's press to a held camera.
    pub(crate) fn send(
        &mut self,
        setup: &StoredSetup,
        _commands: &[CameraCommand],
    ) -> Result<(), LinkFailure> {
        Err(no_link_yet(setup))
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

/// Until the links are built: CAM 2 and CAM 3 pass the drift guard first;
/// then there is no link to read them with.
fn no_link_yet(setup: &StoredSetup) -> LinkFailure {
    if let Some(address) = setup.address.as_deref().filter(|_| setup.camera != 1) {
        if let Err(reason) = guard_camera_address(address) {
            return LinkFailure::Refused(reason);
        }
    }
    LinkFailure::NoLinkYet
}
