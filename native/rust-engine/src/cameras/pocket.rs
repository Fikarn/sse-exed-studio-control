//! CAM 1's link: the Blackmagic Pocket Cinema Camera 6K Pro over Bluetooth
//! (D15 rule 2, D18; built in parts from 2026-10-06). This file holds the
//! parts that are pure and run on every platform: the protocol's messages
//! (`protocol.rs`), the timecode (`timecode.rs`) and the recording format's
//! words (`format.rs`). Windows' pairing and GATT come in the next part,
//! behind the guard that no test and no development run can pass.
//!
//! What the protocol is, read on the web on 2026-10-06 from Blackmagic's
//! Developer Information and not yet tried on the camera (`docs/HARDWARE.md`,
//! Cameras): the SDI camera control protocol's messages, written to the
//! Outgoing Camera Control characteristic and notified back on the Incoming
//! one, the camera sending every setting once after the connection and then
//! each change; the timecode on a characteristic of its own.

// Until the Windows part wires them, these are reached by their tests alone.
#![allow(dead_code)]

pub(crate) mod format;
pub(crate) mod protocol;
#[cfg(test)]
mod tests;
pub(crate) mod timecode;
