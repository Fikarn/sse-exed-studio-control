//! The PROMPTER page (`docs/design/teleprompter.md` §9, D14; 2026-10-03, the
//! approved layout). During the take: play and pause, pace the presenter,
//! nudge or jump the text. Between takes: TOP. What a key does and what a
//! display says is the prompter's own (`prompter::deck`).
//!
//! |        | 1    | 2      | 3      | 4        |
//! | ------ | ---- | ------ | ------ | -------- |
//! | Top    | REC  | ◂ CUE  | CUE ▸  | LIGHTS › |
//! | Bottom | PLAY | BACK   | (dark) | TOP      |
//!
//! Each cell shows its own dial: SPEED, LINE, PARAGRAPH and SIZE (SIZE and
//! PARAGRAPH swapped places, so the two dials that move through the text sit
//! together). TOP sits in the far corner beside a free key: a slip onto it
//! mid-take would pause the presenter at line one.

use super::common::{page_key, play_key, prompter, rec_key};
use super::model::{cell, dark_key, dial, key, reads, CellValue, Control, DECK_FACE, DECK_INK_4};

/// While nothing is on the prompter, every control of the page is disabled
/// (§9): a key's picture in the fourth ink, a cell's value too.
fn nothing_on() -> String {
    reads("prompter_state_on", "no")
}

fn take_key(
    row: u8,
    col: u8,
    label: &'static str,
    art: &'static str,
    action: &'static str,
    value: Option<&'static str>,
) -> Control {
    key(row, col, label, art)
        .on_press(prompter(action, value))
        .shows(nothing_on(), &format!("{art}_off"), DECK_FACE)
        .grey_without_the_link()
}

fn prompter_cell(
    col: u8,
    label: &'static str,
    shows: &'static str,
    display: &'static str,
    art: &'static str,
) -> Control {
    cell(col, label, shows, None, display, art, CellValue::Number)
        .inked(nothing_on(), DECK_INK_4)
        .grey_without_the_link()
}

pub(super) fn prompter_controls() -> Vec<Control> {
    vec![
        rec_key(),
        // The arrows back as D14 had them (2026-10-03; until then `CUE <`).
        take_key(
            0,
            1,
            "\u{25c2} CUE",
            "key_cue_back",
            "cue",
            Some("previous"),
        ),
        take_key(0, 2, "CUE \u{25b8}", "key_cue_next", "cue", Some("next")),
        // The last page of the ring: its page key goes round to the first.
        page_key("LIGHTS \u{203a}", "lights", "key_page_lights"),
        play_key(),
        take_key(1, 1, "BACK", "key_back", "back", None),
        // Free: it keeps TOP clear of a slip.
        dark_key(1, 2),
        take_key(1, 3, "TOP", "key_top", "top", None),
        prompter_cell(
            0,
            "SPEED",
            "the speed, in words a minute",
            "prompter_speed",
            "cell_speed",
        ),
        prompter_cell(
            1,
            "LINE",
            "how much of the script has been read",
            "prompter_line",
            "cell_line",
        ),
        prompter_cell(
            2,
            "PARAGRAPH",
            "the paragraph at the reading line, of the script's paragraphs",
            "prompter_place",
            "cell_paragraph",
        ),
        prompter_cell(3, "SIZE", "the text's size", "prompter_size", "cell_size"),
        // The speed dial's push plays and pauses, as PLAY does.
        dial(
            0,
            "SPEED",
            Some(prompter("playPause", None)),
            prompter("speed", Some("down")),
            prompter("speed", Some("up")),
        ),
        dial(
            1,
            "LINE",
            None,
            prompter("line", Some("previous")),
            prompter("line", Some("next")),
        ),
        dial(
            2,
            "PARAGRAPH",
            None,
            prompter("paragraph", Some("previous")),
            prompter("paragraph", Some("next")),
        ),
        dial(
            3,
            "SIZE",
            Some(prompter("size", Some("standard"))),
            prompter("size", Some("down")),
            prompter("size", Some("up")),
        ),
    ]
}
