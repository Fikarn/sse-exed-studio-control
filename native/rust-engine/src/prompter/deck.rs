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

use crate::prompter::clock::{read_words_from, PrompterPlace};
use crate::prompter::commands::{
    jump_request, nothing_on, pause_request, play_request, speed_request, text_size_request,
};
use crate::prompter::runtime::{with_prompter, Prompter};
use crate::prompter::screen::PrompterScreenState;
use crate::prompter::store;
use crate::prompter::{PrompterError, PrompterReply};
use rusqlite::Connection;
use serde_json::json;
use std::path::Path;
use std::time::{Duration, Instant};

/// After a turn of the size dial the strip shows the size for this long,
/// then the time left again (§9).
pub(crate) const SIZE_SHOWN_FOR: Duration = Duration::from_secs(2);

/// The displays of the PROMPTER page, by their LCD keys: the four
/// touch-strip cells, and the two words the keys' colours follow.
pub(crate) const PROMPTER_LCD_KEYS: [&str; 6] = [
    "prompter_speed",
    "prompter_place",
    "prompter_left",
    "prompter_name",
    "prompter_state_play",
    "prompter_state_on",
];

/// A line of a strip cell holds about this many characters.
const STRIP_LINE_CHARS: usize = 12;

/// What the page's displays say, by their LCD keys.
pub(crate) type DeckTexts = Vec<(&'static str, String)>;

/// One key or dial of the PROMPTER page, and what the page's displays say
/// after it. `action` and `value` are the profile's: `playPause`, `back`,
/// `top`, `cue` with `previous` or `next`, `speed` with `up` or `down`,
/// `line` and `paragraph` with `previous` or `next`, and `size` with `up`,
/// `down` or `standard`.
pub(crate) fn handle_deck_action(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<(PrompterReply, DeckTexts), PrompterError> {
    with_prompter(db_path, |prompter, connection, now| {
        let jump = |to: &str| json!({ "to": to });
        let (result, reason) = match (action, value) {
            ("playPause", _) => {
                if prompter.glass.as_ref().is_some_and(|glass| glass.playing) {
                    pause_request(prompter, connection, now)?
                } else {
                    play_request(prompter, connection, now)?
                }
            }
            ("back", _) => jump_request(prompter, connection, &jump("back"), now)?,
            ("top", _) => jump_request(prompter, connection, &jump("top"), now)?,
            ("cue", Some("previous")) => {
                jump_request(prompter, connection, &jump("previousCue"), now)?
            }
            ("cue", Some("next")) => jump_request(prompter, connection, &jump("nextCue"), now)?,
            ("line", Some("previous")) => {
                jump_request(prompter, connection, &jump("previousLine"), now)?
            }
            ("line", Some("next")) => jump_request(prompter, connection, &jump("nextLine"), now)?,
            ("paragraph", Some("previous")) => {
                jump_request(prompter, connection, &jump("previousParagraph"), now)?
            }
            ("paragraph", Some("next")) => {
                jump_request(prompter, connection, &jump("nextParagraph"), now)?
            }
            ("speed", Some("up")) => {
                speed_request(prompter, connection, &json!({ "step": 1 }), now)?
            }
            ("speed", Some("down")) => {
                speed_request(prompter, connection, &json!({ "step": -1 }), now)?
            }
            ("size", Some(way @ ("up" | "down" | "standard"))) => {
                if prompter.glass.is_none() {
                    return Err(nothing_on());
                }
                let params = match way {
                    "up" => json!({ "step": 1 }),
                    "down" => json!({ "step": -1 }),
                    _ => json!({ "standard": true }),
                };
                let answer = text_size_request(prompter, connection, &params, now)?;
                prompter.deck_size_shown_at = Some(now);
                answer
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
        let reply = PrompterReply {
            result,
            reason,
            anchor: prompter.glass.as_ref().map(|glass| glass.anchor(now)),
            // A take's controls cannot change `checks.prompter`
            // (`commands::changes_the_check`).
            health_changed: false,
        };
        Ok((reply, texts(prompter, connection, now)))
    })
}

/// Every display of the PROMPTER page, as the prompter is now.
pub(crate) fn deck_texts(db_path: &Path) -> Result<DeckTexts, PrompterError> {
    with_prompter(db_path, |prompter, connection, now| {
        Ok(texts(prompter, connection, now))
    })
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

/// A name on a strip cell: two lines at most, broken between words where it
/// can be, and cut with `...` when it is longer.
pub(crate) fn name_text(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    if words.is_empty() {
        return String::from("(no name)");
    }
    let mut lines: Vec<String> = Vec::new();
    let mut rest = words.as_slice();
    while !rest.is_empty() && lines.len() < 2 {
        let mut line = String::new();
        let mut taken = 0;
        for word in rest {
            let longer = if line.is_empty() {
                word.chars().count()
            } else {
                line.chars().count() + 1 + word.chars().count()
            };
            if longer > STRIP_LINE_CHARS && !line.is_empty() {
                break;
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
            taken += 1;
            if longer > STRIP_LINE_CHARS {
                break;
            }
        }
        lines.push(line);
        rest = &rest[taken..];
    }
    let cut = !rest.is_empty()
        || lines
            .iter()
            .any(|line| line.chars().count() > STRIP_LINE_CHARS);
    let mut lines: Vec<String> = lines
        .into_iter()
        .map(|line| line.chars().take(STRIP_LINE_CHARS).collect())
        .collect();
    if cut {
        if let Some(last) = lines.last_mut() {
            let kept: String = last.chars().take(STRIP_LINE_CHARS - 3).collect();
            *last = format!("{}...", kept.trim_end());
        }
    }
    lines.join("\\n")
}

/// The place as the strip says it: the paragraph of the script's
/// paragraphs, and how far into the words the presenter reads, rounded down
/// so a place short of the end never reads 100 % (the page's `placeView`).
fn place_text(
    paragraphs: &[crate::prompter::model::PrompterParagraph],
    place: PrompterPlace,
) -> String {
    let count = paragraphs.len();
    if place.paragraph as usize >= count {
        return String::from("PLACE\\nEND");
    }
    let total = read_words_from(paragraphs, PrompterPlace::TOP);
    let left = read_words_from(paragraphs, place);
    let share = (total.saturating_sub(left) * 100)
        .checked_div(total)
        .unwrap_or(0);
    format!("¶ {}/{count}\\n{share} %", place.paragraph + 1)
}

/// What the strip says of a Prompter XL that draws nothing.
fn screen_words(state: PrompterScreenState) -> &'static str {
    match state {
        PrompterScreenState::NotConnected => "XL NOT\\nCONNECTED",
        PrompterScreenState::Duplicated => "XL\\nDUPLICATED",
        PrompterScreenState::NotShowing => "XL NOT\\nSHOWING",
        PrompterScreenState::Connected | PrompterScreenState::LowResolution => "",
    }
}

fn texts(prompter: &Prompter, connection: &Connection, now: Instant) -> DeckTexts {
    let Some(glass) = &prompter.glass else {
        return vec![
            ("prompter_speed", String::from("SPEED\\n--")),
            ("prompter_place", String::from("PLACE\\n--")),
            ("prompter_left", String::from("LEFT\\n--")),
            ("prompter_name", String::from("NOTHING\\nON")),
            ("prompter_state_play", String::from("locked")),
            ("prompter_state_on", String::from("no")),
        ];
    };
    let screen = prompter.screen.state();
    let at_end = glass.at_end(now);
    let speed = if screen.draws() {
        format!("SPEED\\n{}", glass.speed_wpm)
    } else {
        format!("SPEED {}\\n{}", glass.speed_wpm, screen_words(screen))
    };
    let size_shown = prompter
        .deck_size_shown_at
        .is_some_and(|shown| now.saturating_duration_since(shown) < SIZE_SHOWN_FOR);
    let left = if size_shown {
        format!("SIZE\\n{} px", prompter.size_px)
    } else {
        format!("LEFT\\n{}", duration_text(glass.time_left(now).0))
    };
    // The name is the script's as it is now; a read that fails leaves the
    // cell without one and the rest as it is.
    let name = store::read_script_name(connection, &glass.script_id)
        .ok()
        .flatten()
        .unwrap_or_default();
    let play = if glass.playing {
        "playing"
    } else if !screen.draws() || at_end || glass.layout.is_none() {
        "locked"
    } else {
        "ready"
    };
    vec![
        ("prompter_speed", speed),
        (
            "prompter_place",
            place_text(&glass.paragraphs, glass.place_at(now)),
        ),
        ("prompter_left", left),
        ("prompter_name", name_text(&name)),
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

    #[test]
    fn a_name_takes_two_lines_and_says_when_it_is_cut() {
        assert_eq!(name_text("Welcome"), "Welcome");
        assert_eq!(name_text("02 Interview intro"), "02 Interview\\nintro");
        assert_eq!(
            name_text("04 Outro and the closing credits"),
            "04 Outro and\\nthe closi..."
        );
        assert_eq!(name_text("Extraordinarily"), "Extraordi...");
        assert_eq!(name_text("   "), "(no name)");
        for line in name_text("A name of many words that goes on and on").split("\\n") {
            assert!(line.chars().count() <= STRIP_LINE_CHARS, "{line}");
        }
    }
}
