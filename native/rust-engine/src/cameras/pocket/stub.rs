//! The Pocket's link where there is no Windows: the Linux CI runners, which
//! build and test the engine (D22: Studio Control itself runs on Windows
//! only). The link stops at once and says so; nothing is reached.

use crate::cameras::pocket::link::{Events, Inbox, Shared};
use std::sync::Arc;

/// The link's thread, which here ends at once.
pub(crate) fn run(shared: Arc<Shared>, _inbox: Inbox, _events: Events) {
    shared.fail(String::from(
        "Studio Control reaches CAM 1 over Bluetooth on Windows only.",
    ));
}
