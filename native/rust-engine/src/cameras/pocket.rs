//! CAM 1's link: the Blackmagic Pocket Cinema Camera 6K Pro over Bluetooth
//! (D15 rule 2, D18; built in parts from 2026-10-06). The parts that are
//! pure and run on every platform: the protocol's messages (`protocol.rs`),
//! the timecode (`timecode.rs`), the recording format's words (`format.rs`),
//! the characteristics (`characteristics.rs`) and the link's own state
//! (`state.rs`). The link itself (`link.rs`) runs one thread, which speaks
//! to Windows' own Bluetooth (`winrt.rs`; `stub.rs` where there is no
//! Windows) behind the guard that no test and no development run can pass.
//! Pairing (`pairing.rs`, part 5) runs a thread of its own behind the same
//! guard, which speaks to Windows' own pairing (`winrt_pairing.rs`).
//!
//! What the protocol is, read on the web on 2026-10-06 from Blackmagic's
//! Developer Information and tried on the camera on 2026-10-07
//! (`docs/HARDWARE.md`, Cameras): the SDI camera control protocol's
//! messages, written to the Outgoing Camera Control characteristic and
//! indicated back on the Incoming one, the camera sending every setting
//! after a connection that follows some minutes without a controller or a
//! power-on (a controller back sooner gets a setting when it changes) and
//! then each change; the timecode on a characteristic of its own.

// Some of the protocol's record (its types, the status flags, the format's
// flags, the characteristics the link does not write) is named for the
// reader and the tests, and used by nothing else yet.
#![allow(dead_code)]

pub(crate) mod characteristics;
pub(crate) mod format;
pub(crate) mod link;
pub(crate) mod pairing;
pub(crate) mod protocol;
pub(crate) mod state;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_link;
#[cfg(test)]
mod tests_pairing;
pub(crate) mod timecode;
mod winrt;
mod winrt_pairing;
