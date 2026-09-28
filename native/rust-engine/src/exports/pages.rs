//! The deck's pages: the one list the profile, the page model, the page keys
//! and the page-follow triggers are made from.

use super::audio::audio_controls;
use super::controls::ControlDef;
use super::lights::{light_controls, LIGHT_LCD_KEYS};

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
    /// LIGHTS texts are not polled, so they are refreshed here; the AUDIO ones
    /// by the 1 s poll.
    pub(super) arrival_refreshes: &'static [&'static str],
    pub(super) controls: fn() -> Vec<ControlDef>,
}

/// The deck's pages in their Companion order (new pages program, D5: the
/// pages follow the app's tabs). PROJECTS and TASKS left with Planning in
/// Slice 2, so LIGHTS is page 1 and AUDIO page 2; CAMERAS and PROMPTER join
/// with Part C. The page numbers, the page keys' jumps, the page-follow
/// triggers and the snapshot's page-nav targets all come from this list.
pub(super) const DECK_PAGES: [DeckPage; 2] = [
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
];

/// A page's Companion page number (1-based), 0 for a page the deck lacks.
pub(super) fn deck_page_number(page_id: &str) -> i64 {
    DECK_PAGES
        .iter()
        .position(|page| page.id == page_id)
        .and_then(|index| i64::try_from(index + 1).ok())
        .unwrap_or(0)
}
