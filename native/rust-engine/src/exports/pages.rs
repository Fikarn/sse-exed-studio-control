//! The deck's pages: the one list the profile, the page model, the page keys
//! and the page-follow triggers are made from.

use super::audio::audio_controls;
use super::cameras::camera_controls;
use super::controls::ControlDef;
use super::lights::{light_controls, LIGHT_LCD_KEYS};
use super::prompter::prompter_controls;

/// One page of the exported Stream Deck profile.
pub(super) struct DeckPage {
    /// Companion's id for the page.
    pub(super) companion_id: &'static str,
    /// The control-surface snapshot's page id, which also prefixes its
    /// control ids (`lights-btn-2`).
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    /// The app page (`shell.workspace`) whose page-follow trigger brings the
    /// deck here.
    pub(super) workspace: &'static str,
    /// The LCDs the page-follow trigger refreshes as the deck arrives: the
    /// LIGHTS texts are not polled, so they are refreshed here; the other
    /// pages' by the 1 s poll.
    pub(super) arrival_refreshes: &'static [&'static str],
    pub(super) controls: fn() -> Vec<ControlDef>,
}

/// The deck's pages in their Companion order (D5: the pages follow the
/// app's tabs): LIGHTS, AUDIO, CAMERAS, PROMPTER. The page keys chain them in
/// a ring, one key a page, each to the page after it and the last to the
/// first. The page numbers, the page keys' jumps, the page-follow triggers
/// and the snapshot's page-nav targets all come from this list.
pub(super) const DECK_PAGES: [DeckPage; 4] = [
    DeckPage {
        companion_id: "sse-page-lights",
        id: "lights",
        label: "LIGHTS",
        workspace: "lighting",
        arrival_refreshes: LIGHT_LCD_KEYS,
        controls: light_controls,
    },
    DeckPage {
        companion_id: "sse-page-audio",
        id: "audio",
        label: "AUDIO",
        workspace: "audio",
        arrival_refreshes: &[],
        controls: audio_controls,
    },
    DeckPage {
        companion_id: "sse-page-cameras",
        id: "cameras",
        label: "CAMERAS",
        workspace: "cameras",
        arrival_refreshes: &[],
        controls: camera_controls,
    },
    DeckPage {
        companion_id: "sse-page-prompter",
        id: "prompter",
        label: "PROMPTER",
        // The page's word in the app, which the hardware link accepts.
        workspace: "teleprompter",
        arrival_refreshes: &[],
        controls: prompter_controls,
    },
];

/// A page's Companion page number (1-based), 0 for a page the deck lacks.
pub(super) fn deck_page_number(page_id: &str) -> i64 {
    DECK_PAGES
        .iter()
        .position(|page| page.id == page_id)
        .and_then(|index| i64::try_from(index + 1).ok())
        .unwrap_or(0)
}
