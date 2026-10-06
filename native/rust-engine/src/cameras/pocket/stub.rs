//! The Pocket's link where there is no Windows: the Linux CI runners, which
//! build and test the engine (D22: Studio Control itself runs on Windows
//! only). The link stops at once and says so, and so does a pairing; nothing
//! is reached. (Setup takes no pairing there: `real_link::has_link`.)

use crate::cameras::pocket::link::{Events, Inbox, Shared};
use crate::cameras::pocket::pairing::{PairingInbox, PairingShared, PairingStep};
use crate::cameras::real_link::LinkFailure;
use std::sync::Arc;

const WINDOWS_ONLY: &str = "Studio Control reaches CAM 1 over Bluetooth on Windows only.";

/// The link's thread, which here ends at once.
pub(crate) fn run(shared: Arc<Shared>, _inbox: Inbox, _events: Events) {
    shared.fail(LinkFailure::Bluetooth(String::from(WINDOWS_ONLY)));
}

/// The pairing's thread, which here ends at once.
pub(crate) fn pair(shared: &Arc<PairingShared>, _inbox: &PairingInbox, notify: &dyn Fn()) {
    shared.set(PairingStep::Failed(String::from(WINDOWS_ONLY)));
    notify();
}
