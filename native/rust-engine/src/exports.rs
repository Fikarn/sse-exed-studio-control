//! The Stream Deck's pages, as the hardware link hands them out: the
//! Companion profile the operator imports, and the page model Setup draws.
//! Both are made from one list of pages (`pages::DECK_PAGES`), each page from
//! its controls. What the deck's keys and dials then send is answered by the
//! bridge (`control_surface`, `control_surface_http`).

mod audio;
mod controls;
mod lights;
mod pages;
mod profile;
mod snapshot;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use audio::AUDIO_LCD_KEYS;
#[cfg(test)]
pub(crate) use profile::deck_worst_instant_requests;
pub use profile::{export_companion_config, ExportCommandError};
pub use snapshot::build_control_surface_snapshot;
