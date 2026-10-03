//! The deck's pages: the one list the profile, the page model, the page keys
//! and the page-follow triggers are made from.

use super::audio::audio_controls;
use super::cameras::camera_controls;
use super::lights::light_controls;
use super::model::Control;
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
    /// deck here. The trigger turns the page and refreshes nothing: every
    /// page's displays are polled once a second (the LIGHTS page's too, since
    /// 2026-09-29, when its refresh on arrival went).
    pub(super) workspace: &'static str,
    pub(super) controls: fn() -> Vec<Control>,
}

/// The deck's pages in their Companion order (D5: the pages follow the
/// app's tabs): LIGHTS, AUDIO, CAMERAS, PROMPTER. The page keys chain them in
/// a ring, one key a page, top right on every page (2026-10-03), each to the
/// page after it and the last to the first. The page numbers, the page keys'
/// jumps, the page-follow triggers and the snapshot's page-nav targets all
/// come from this list.
pub(super) const DECK_PAGES: [DeckPage; 4] = [
    DeckPage {
        companion_id: "sse-page-lights",
        id: "lights",
        label: "LIGHTS",
        workspace: "lighting",
        controls: light_controls,
    },
    DeckPage {
        companion_id: "sse-page-audio",
        id: "audio",
        label: "AUDIO",
        workspace: "audio",
        controls: audio_controls,
    },
    DeckPage {
        companion_id: "sse-page-cameras",
        id: "cameras",
        label: "CAMERAS",
        workspace: "cameras",
        controls: camera_controls,
    },
    DeckPage {
        companion_id: "sse-page-prompter",
        id: "prompter",
        label: "PROMPTER",
        // The page's word in the app, which the hardware link accepts.
        workspace: "teleprompter",
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
