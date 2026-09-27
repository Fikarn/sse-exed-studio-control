//! The cameras in the hardware link (new pages program, Slice 8): the three
//! cameras, who holds each, what each reports, the selection, the simulated
//! cameras every test, lane and scratch run uses, and Setup's part of them in
//! the saved data. The contract is `v1.md`'s "Cameras" section; the slice's
//! first steps, answered by the operator on 2026-09-27, are recorded under
//! the ledger's Slice 8.
//!
//! The hardware link is the only thing that talks to the cameras; the page
//! (Slice 9) and the deck (Slices 7 and 12) draw and send what it answers.
//! Until Slices 12 and 13 bring the real links, a set-up camera is read only
//! through the simulated link (`SSE_CAMERAS_SIMULATED=1`).

pub(crate) mod archive;
pub(crate) mod commands;
pub(crate) mod model;
pub(crate) mod real_link;
pub(crate) mod report;
pub(crate) mod runtime;
pub(crate) mod simulated;
pub(crate) mod snapshot;
pub(crate) mod store;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests_controls;
#[cfg(test)]
mod tests_link;
#[cfg(test)]
mod tests_setup;

use serde_json::Value;

pub(crate) use commands::{after_archive_restore, cameras_health_check, handle_cameras_request};

/// `SSE_CAMERAS_SIMULATED=1` asks for the simulated cameras; nothing else
/// does. The lanes set it and refuse to start without it
/// (`scripts/native-runtime-harness.mjs`, `laneEnvRefusal`), reading it the
/// same way.
pub(crate) fn simulated_cameras_requested(value: &str) -> bool {
    value.trim() == "1"
}

/// A refused or failed `cameras.*` request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CameraError {
    /// The request's parameters are wrong: `INVALID_PARAMS`.
    Invalid(String),
    /// A sound request the cameras refuse now, with its code and the
    /// sentence the operator reads.
    Refused(&'static str, String),
    /// The saved data could not be read or written: `STORAGE_ERROR`.
    Storage(String),
}

impl From<rusqlite::Error> for CameraError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

impl From<serde_json::Error> for CameraError {
    fn from(error: serde_json::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

/// What a `cameras.*` request answers, and what `cameras.changed` says of
/// it.
#[derive(Debug, Clone)]
pub(crate) struct CamerasReply {
    pub result: Value,
    /// The event's reason and camera (`None` when it is about all three);
    /// `None` for a read.
    pub event: Option<(&'static str, Option<u8>)>,
    /// `checks.cameras` says something else after the request: the reply
    /// also raises `app.changed { reason: "health" }`, so the header's lamp
    /// follows.
    pub health_changed: bool,
}
