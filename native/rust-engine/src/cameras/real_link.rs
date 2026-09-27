//! The real links, which later slices build: CAM 1's over Bluetooth in Slice
//! 11 (Blackmagic's Bluetooth protocol, with its own test-build guard), CAM 2's and CAM 3's over the network
//! in Slice 13 (Panasonic's LUMIX SDK). Until then a set-up camera without
//! the simulated link does not answer, and the sentence says Studio Control
//! has no link to it yet.
//!
//! The drift guard (D15 rule 1): the network link calls
//! `guard_camera_address` before it would connect, and in a test build that
//! refuses every address but this PC's, so no test can reach a camera on the
//! studio's network whatever its saved data says.

use crate::cameras::model::model;

/// Why a camera could not be read or sent anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LinkFailure {
    /// The link reached for it and it did not answer.
    NoAnswer,
    /// Studio Control has no link of this kind yet (before Slices 11 and 13).
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

/// Reads a camera over its real link. CAM 2 and CAM 3 pass the drift guard
/// first; then, until Slices 11 and 13, there is no link to read them with.
pub(crate) fn read(camera: u8, address: Option<&str>) -> LinkFailure {
    if let Some(address) = address.filter(|_| camera != 1) {
        if let Err(reason) = guard_camera_address(address) {
            return LinkFailure::Refused(reason);
        }
    }
    LinkFailure::NoLinkYet
}
