//! The PROMPTER page (`docs/design/teleprompter.md` §9, D14): five keys and
//! the page key, four dials, and the strip over them. What a key does and
//! what a display says is the prompter's own (`prompter::deck`).

use super::controls::{
    button, color_feedback, dial, expression_button, http_post, lcd_refreshes, page_jump,
    state_feedback, ControlDef, DECK_GREY_INK, DECK_LIVE_BG, DECK_LIVE_INK,
};
use super::pages::deck_page_number;
use serde_json::{json, Value};

/// The route of the page's keys and dials.
const ROUTE: &str = "/api/deck/prompter-action";

/// What a jump refreshes: the place, the time left, and whether `PLAY` may
/// be pressed (`TOP` pauses, and a jump back from the end frees it).
const AFTER_A_JUMP: [&str; 3] = ["prompter_place", "prompter_left", "prompter_state_play"];

fn key(action: &str, value: Option<&str>, refresh_keys: &[&str]) -> Vec<Value> {
    let body = match value {
        Some(value) => json!({ "action": action, "value": value }),
        None => json!({ "action": action }),
    };
    http_post(ROUTE, body)
        .into_iter()
        .chain(lcd_refreshes(refresh_keys))
        .collect()
}

/// Grey while nothing is on the prompter: every control of the page.
fn nothing_on_feedback() -> Value {
    state_feedback(
        "prompter_state_on",
        "no",
        false,
        json!({ "color": DECK_GREY_INK }),
    )
}

/// Grey while `PLAY` cannot be pressed: nothing is drawn on the glass, the
/// text is at its end, or nothing is on the prompter.
fn play_locked_feedback() -> Value {
    state_feedback(
        "prompter_state_play",
        "locked",
        false,
        json!({ "color": DECK_GREY_INK }),
    )
}

fn take_key(
    row: &'static str,
    col: &'static str,
    label: &'static str,
    action: &str,
    value: Option<&str>,
) -> ControlDef {
    button(row, col, label, key(action, value, &AFTER_A_JUMP))
        .size("18")
        .with_feedbacks(vec![nothing_on_feedback()])
}

fn strip_cell(
    col: &'static str,
    label: &'static str,
    text: &'static str,
    feedbacks: Vec<Value>,
) -> ControlDef {
    expression_button("2", col, label, text, Vec::new())
        .size("14")
        .no_topbar()
        .with_feedbacks(feedbacks)
}

pub(super) fn prompter_controls() -> Vec<ControlDef> {
    vec![
        // `PLAY` plays or pauses: green while the text scrolls (§9).
        button(
            "0",
            "0",
            "PLAY",
            key("playPause", None, &["prompter_state_play", "prompter_left"]),
        )
        .size("18")
        .with_feedbacks(vec![
            color_feedback(
                "prompter_state_play",
                "playing",
                DECK_LIVE_INK,
                DECK_LIVE_BG,
            ),
            play_locked_feedback(),
        ]),
        take_key("0", "1", "BACK", "back", None),
        take_key("0", "2", "TOP", "top", None),
        // Row 0, column 3 and row 1, column 2 stay dark (§9).
        take_key("1", "0", "CUE <", "cue", Some("previous")),
        take_key("1", "1", "CUE >", "cue", Some("next")),
        // The last page of the ring: its page key goes round to the first.
        button("1", "3", "LIGHTS >>", page_jump(deck_page_number("lights"))),
        strip_cell(
            "0",
            "The speed",
            "$(custom:lcd_prompter_speed)",
            vec![play_locked_feedback()],
        ),
        strip_cell(
            "1",
            "The place",
            "$(custom:lcd_prompter_place)",
            vec![nothing_on_feedback()],
        ),
        strip_cell(
            "2",
            "The time left",
            "$(custom:lcd_prompter_left)",
            vec![nothing_on_feedback()],
        ),
        strip_cell(
            "3",
            "The script's name",
            "$(custom:lcd_prompter_name)",
            vec![nothing_on_feedback()],
        ),
        dial(
            "3",
            "0",
            "Speed",
            None,
            key("playPause", None, &["prompter_state_play", "prompter_left"]),
            key("speed", Some("down"), &["prompter_speed", "prompter_left"]),
            key("speed", Some("up"), &["prompter_speed", "prompter_left"]),
        ),
        dial(
            "3",
            "1",
            "Position",
            None,
            Vec::new(),
            key("line", Some("previous"), &AFTER_A_JUMP),
            key("line", Some("next"), &AFTER_A_JUMP),
        ),
        dial(
            "3",
            "2",
            "Text size",
            None,
            key(
                "size",
                Some("standard"),
                &["prompter_left", "prompter_state_play"],
            ),
            key(
                "size",
                Some("down"),
                &["prompter_left", "prompter_state_play"],
            ),
            key(
                "size",
                Some("up"),
                &["prompter_left", "prompter_state_play"],
            ),
        ),
        dial(
            "3",
            "3",
            "Paragraph",
            None,
            Vec::new(),
            key("paragraph", Some("previous"), &AFTER_A_JUMP),
            key("paragraph", Some("next"), &AFTER_A_JUMP),
        ),
    ]
}
