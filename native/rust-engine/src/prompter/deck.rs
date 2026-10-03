//! The Stream Deck's PROMPTER page in the hardware link
//! (`docs/design/teleprompter.md` §9, D14): what its keys and dials do, and
//! what its displays say. The bridge (`control_surface`) hands a key over and
//! asks for the displays; everything is decided here, under the prompter's
//! lock, through the functions the screen's requests run.
//!
//! - `PLAY` and the speed dial's push play or pause: which of the two is
//!   decided under the lock, by what the glass does at that moment.
//! - `BACK`, `TOP` and the two cue keys jump as the page's keys do; a jump
//!   keeps the scroll as it was, and only `TOP` pauses.
//! - The dials: speed (5 words a minute a detent), position (a line), text
//!   size (4 px; a push returns to the standard) and paragraph.
//!
//! Putting a script on, replacing, updating and clearing it stay on the
//! screen (D14). Nothing here starts a scroll but `PLAY` and the speed
//! dial's push (D12). While nothing is on the prompter every control is
//! grey and refused (§9), the size dial too, which the screen's look sets
//! at any time.
//!
//! Since 2026-10-02 the keys, the dials and the displays run on the
//! prompter's memory alone: the place, the pace and the size go to the saver,
//! and the strip's name is the prompter's, so a slow disk never holds the
//! deck. A key's jump is saved at once, a dial's detent shortly after. The
//! displays take no lock of the prompter's: they read the frame it publishes
//! whenever it lets go of its lock (`DeckFrame`) and work their text out from
//! it at the moment they are asked, so they never wait for a key or the
//! screen and are never stale.

use crate::prompter::clock::{read_words_from, GlassClock, PrompterPlace};
use crate::prompter::commands::{
    jump_request, nothing_on, pause_request, play_request, reply, speed_request, text_size_request,
};
use crate::prompter::runtime::{published_frame, with_prompter, Prompter};
use crate::prompter::saver::Urgency;
use crate::prompter::screen::PrompterScreenState;
use crate::prompter::{PrompterError, PrompterReply};
use serde_json::json;
use std::path::Path;
use std::time::Instant;

/// The displays of the PROMPTER page, by their LCD keys (2026-10-03): the
/// four touch-strip cells, each its own dial's (speed, the share read, the
/// paragraph, the size), the time left `PLAY` shows, and the two words the
/// keys' colours follow. The script's name left the deck: the screen shows
/// it.
pub(crate) const PROMPTER_LCD_KEYS: [&str; 7] = [
    "prompter_speed",
    "prompter_line",
    "prompter_place",
    "prompter_size",
    "prompter_left",
    "prompter_state_play",
    "prompter_state_on",
];

/// What `PLAY` can do, as the deck's colours match it letter for letter:
/// `playing` (the text scrolls), `ready`, `end` (the text is at its end),
/// `no-xl` (the Prompter XL shows nothing, or has not drawn the text yet),
/// `locked` (nothing is on the prompter).
#[cfg(test)]
pub(crate) const PLAY_STATES: [&str; 5] = ["playing", "ready", "end", "no-xl", "locked"];

/// What the page's displays say, by their LCD keys.
pub(crate) type DeckTexts = Vec<(&'static str, String)>;

/// What the PROMPTER page's displays are made of: the prompter as it was
/// when it last let go of its lock.
#[derive(Debug, Clone)]
pub(crate) struct DeckFrame {
    glass: Option<GlassClock>,
    screen: PrompterScreenState,
    size_px: u32,
}

impl DeckFrame {
    pub(crate) fn of(prompter: &Prompter) -> Self {
        Self {
            glass: prompter.glass.clone(),
            screen: prompter.screen.state(),
            size_px: prompter.size_px,
        }
    }

    /// The displays at `now`. The text moved on since the frame was taken is
    /// worked out from its clock, which stops at `END` as the prompter's own
    /// will.
    pub(crate) fn texts_at(&self, now: Instant) -> DeckTexts {
        let mut glass = self.glass.clone();
        if let Some(glass) = glass.as_mut() {
            glass.settle(now);
        }
        texts_of(glass.as_ref(), self.screen, self.size_px, now)
    }
}

/// One key or dial of the PROMPTER page. `action` and `value` are the
/// profile's: `playPause`, `back`, `top`, `cue` with `previous` or `next`,
/// `speed` with `up` or `down`, `line` and `paragraph` with `previous` or
/// `next`, and `size` with `up`, `down` or `standard`.
pub(crate) fn handle_deck_action(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<PrompterReply, PrompterError> {
    let what = format!("deck {action}");
    with_prompter(db_path, &what, |prompter, now| {
        let jump = |to: &str| json!({ "to": to });
        let (result, reason) = match (action, value) {
            ("playPause", _) => {
                if prompter.glass.as_ref().is_some_and(|glass| glass.playing) {
                    pause_request(prompter, now)?
                } else {
                    play_request(prompter, now)?
                }
            }
            ("back", _) => jump_request(prompter, &jump("back"), now, Urgency::Now)?,
            ("top", _) => jump_request(prompter, &jump("top"), now, Urgency::Now)?,
            ("cue", Some("previous")) => {
                jump_request(prompter, &jump("previousCue"), now, Urgency::Now)?
            }
            ("cue", Some("next")) => jump_request(prompter, &jump("nextCue"), now, Urgency::Now)?,
            ("line", Some("previous")) => {
                jump_request(prompter, &jump("previousLine"), now, Urgency::Shortly)?
            }
            ("line", Some("next")) => {
                jump_request(prompter, &jump("nextLine"), now, Urgency::Shortly)?
            }
            ("paragraph", Some("previous")) => {
                jump_request(prompter, &jump("previousParagraph"), now, Urgency::Shortly)?
            }
            ("paragraph", Some("next")) => {
                jump_request(prompter, &jump("nextParagraph"), now, Urgency::Shortly)?
            }
            ("speed", Some("up")) => speed_request(prompter, &json!({ "step": 1 }), now)?,
            ("speed", Some("down")) => speed_request(prompter, &json!({ "step": -1 }), now)?,
            ("size", Some(way @ ("up" | "down" | "standard"))) => {
                if prompter.glass.is_none() {
                    return Err(nothing_on());
                }
                let params = match way {
                    "up" => json!({ "step": 1 }),
                    "down" => json!({ "step": -1 }),
                    _ => json!({ "standard": true }),
                };
                text_size_request(prompter, &params, now)?
            }
            ("cue" | "line" | "paragraph", _) => {
                return Err(PrompterError::Invalid(format!(
                    "{action} goes previous or next."
                )))
            }
            ("speed", _) => {
                return Err(PrompterError::Invalid(String::from(
                    "speed goes up or down.",
                )))
            }
            ("size", _) => {
                return Err(PrompterError::Invalid(String::from(
                    "size goes up, down or standard.",
                )))
            }
            (other, _) => {
                return Err(PrompterError::Invalid(format!(
                    "Unsupported PROMPTER key: {other}"
                )))
            }
        };
        // A take's controls cannot change `checks.prompter`
        // (`commands::changes_the_check`).
        Ok(reply(prompter, result, reason, None))
    })
}

/// Every display of the PROMPTER page, now, from the frame the prompter
/// published. Before the prompter is loaded the first read loads it, once.
pub(crate) fn deck_texts(db_path: &Path) -> Result<DeckTexts, PrompterError> {
    let frame = match published_frame(db_path) {
        Some(frame) => frame,
        None => {
            with_prompter(db_path, "deck display", |_, _| Ok(()))?;
            published_frame(db_path).ok_or_else(|| {
                PrompterError::Storage(String::from("The prompter could not be read."))
            })?
        }
    };
    Ok(frame.texts_at(Instant::now()))
}

/// `0:37`, `4:19`, `1:02:05`: whole seconds, as the page prints a time.
pub(crate) fn duration_text(total_seconds: f64) -> String {
    let seconds = if total_seconds.is_finite() {
        total_seconds.max(0.0).round() as u64
    } else {
        0
    };
    let (hours, minutes, rest) = (seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{rest:02}")
    } else {
        format!("{minutes}:{rest:02}")
    }
}

/// The place as the strip says it (2026-10-03): `LINE` over how far into
/// the words the presenter reads, rounded down so a place short of the end
/// never reads 100 % (the page's `placeView`), and `PARAGRAPH` over the
/// paragraph of the script's paragraphs, or `END` at the end.
fn place_texts(
    paragraphs: &[crate::prompter::model::PrompterParagraph],
    place: PrompterPlace,
) -> (String, String) {
    let count = paragraphs.len();
    let total = read_words_from(paragraphs, PrompterPlace::TOP);
    let left = read_words_from(paragraphs, place);
    let share = (total.saturating_sub(left) * 100)
        .checked_div(total)
        .unwrap_or(0);
    let paragraph = if place.paragraph as usize >= count {
        String::from("PARAGRAPH\\nEND")
    } else {
        format!("PARAGRAPH\\n{} / {count}", place.paragraph + 1)
    };
    (format!("LINE\\n{share} %"), paragraph)
}

fn texts_of(
    glass: Option<&GlassClock>,
    screen: PrompterScreenState,
    size_px: u32,
    now: Instant,
) -> DeckTexts {
    // The size, all the time: the dial under it sets it (§9, 2026-10-03).
    let size = format!("SIZE\\n{size_px} px");
    let Some(glass) = glass else {
        return vec![
            ("prompter_speed", String::from("SPEED\\n--")),
            ("prompter_line", String::from("LINE\\n--")),
            ("prompter_place", String::from("PARAGRAPH\\n--")),
            ("prompter_size", size),
            ("prompter_left", String::from("--")),
            ("prompter_state_play", String::from("locked")),
            ("prompter_state_on", String::from("no")),
        ];
    };
    let (line, paragraph) = place_texts(&glass.paragraphs, glass.place_at(now));
    // Why `PLAY` will not play, for the deck to say it (`END`, `NO XL`).
    let play = if glass.playing {
        "playing"
    } else if !screen.draws() || glass.layout.is_none() {
        "no-xl"
    } else if glass.at_end(now) {
        "end"
    } else {
        "ready"
    };
    vec![
        ("prompter_speed", format!("SPEED\\n{}", glass.speed_wpm)),
        ("prompter_line", line),
        ("prompter_place", paragraph),
        ("prompter_size", size),
        // The bare time left: `PLAY` shows it under its word.
        ("prompter_left", duration_text(glass.time_left(now).0)),
        ("prompter_state_play", String::from(play)),
        ("prompter_state_on", String::from("yes")),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_time_reads_as_the_page_prints_it() {
        assert_eq!(duration_text(0.0), "0:00");
        assert_eq!(duration_text(37.4), "0:37");
        assert_eq!(duration_text(259.5), "4:20");
        assert_eq!(duration_text(3725.0), "1:02:05");
        assert_eq!(duration_text(-3.0), "0:00");
        assert_eq!(duration_text(f64::NAN), "0:00");
    }
}
