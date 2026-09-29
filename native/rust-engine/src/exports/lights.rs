//! The LIGHTS page.

use super::controls::{
    button, color_feedback, dial, expression_button, http_post, lcd_refreshes, page_jump,
    ControlDef, DECK_AMBER_BG, DECK_AMBER_INK,
};
use super::pages::deck_page_number;
use serde_json::json;

// The LIGHTS page's dial displays. Polled once a second with the other pages'
// displays, so a change made on screen shows within a second, and each dial's
// turn and push refresh what they change at once, as the AUDIO page's dials
// do (Found, to check, 2026-09-28: they were refreshed only as the deck
// arrived on LIGHTS and at a push of the Light dial, so a turn to the next
// light left the last one's name on the strip). (New pages program, Slice 2:
// the Planning keys `project_nav`, `project_status`, `project_priority`,
// `sort_mode` and `task_nav` left with the PROJECTS and TASKS pages; the list
// was called `LEGACY_LCD_KEYS` until then.)
pub(crate) const LIGHT_LCD_KEYS: [&str; 4] =
    ["light_nav", "light_intensity", "light_cct", "scene_nav"];

/// What a turn of the Light dial changes: the light, and so its two values.
const LIGHT_SELECTION_LCD_KEYS: [&str; 3] = ["light_nav", "light_intensity", "light_cct"];

/// A LIGHTS action, then the displays it changes.
fn light_action(action: &str, refresh_keys: &[&str]) -> Vec<serde_json::Value> {
    http_post("/api/deck/light-action", json!({ "action": action }))
        .into_iter()
        .chain(lcd_refreshes(refresh_keys))
        .collect()
}

/// The LIGHTS page's two keys that ask first (2026-09-28): `All Off` reads
/// `OFF?` and `Del Scene` `DEL?` while armed. They are polled with the other
/// pages' displays, or the question would stand after its 3 s until the deck
/// came back to the page.
pub(crate) const LIGHT_POLLED_LCD_KEYS: [&str; 2] = ["light_key_off", "light_key_del"];

/// A key that asks first: its name, or its question in amber while armed.
/// The press refreshes the key, so the question shows at once.
fn asking_key(
    row: &'static str,
    col: &'static str,
    label: &'static str,
    action: &'static str,
    lcd_key: &'static str,
    variable: &'static str,
    question: &'static str,
) -> ControlDef {
    expression_button(
        row,
        col,
        label,
        variable,
        http_post("/api/deck/light-action", json!({ "action": action }))
            .into_iter()
            .chain(lcd_refreshes(&[lcd_key]))
            .collect(),
    )
    .with_feedbacks(vec![color_feedback(
        lcd_key,
        question,
        DECK_AMBER_INK,
        DECK_AMBER_BG,
    )])
}

/// The LIGHTS page (page 1). New pages program, Slice 2: its `<< PROJ` key
/// (row 0, column 0) left with Planning and the slot stays empty, since
/// LIGHTS is the first page. The page keys post nothing to the bridge any
/// more: the deck mode they stored was a Planning setting nothing read.
pub(super) fn light_controls() -> Vec<ControlDef> {
    vec![
        button(
            "0",
            "1",
            "Toggle",
            http_post("/api/deck/light-action", json!({"action":"toggleLight"})),
        ),
        button(
            "0",
            "2",
            "All On",
            http_post("/api/deck/light-action", json!({"action":"allOn"})),
        ),
        // `All Off` and `Del Scene` ask first, as `REC` asks `STOP?`; `Save`
        // stays one press (the owner's decision, 2026-09-28).
        asking_key(
            "0",
            "3",
            "All Off",
            "allOff",
            "light_key_off",
            "$(custom:lcd_light_key_off)",
            "OFF?",
        ),
        button(
            "1",
            "0",
            "Save",
            http_post("/api/deck/light-action", json!({"action":"saveScene"})),
        ),
        button(
            "1",
            "1",
            "Recall",
            http_post("/api/deck/light-action", json!({"action":"recallScene"})),
        ),
        asking_key(
            "1",
            "2",
            "Del Scene",
            "deleteScene",
            "light_key_del",
            "$(custom:lcd_light_key_del)",
            "DEL?",
        ),
        // The next page. Its LCD refreshes named four keys the audio surface
        // retired in 2026-09 (`audio_ch_nav`, `audio_gain1`–`3`), which the
        // bridge refused on every press; the 1 s poll keeps AUDIO current.
        button("1", "3", "AUDIO >>", page_jump(deck_page_number("audio"))),
        dial(
            "3",
            "0",
            "Light",
            Some("$(custom:lcd_light_nav)"),
            light_action("toggleLight", &LIGHT_SELECTION_LCD_KEYS),
            light_action("selectPrevLight", &LIGHT_SELECTION_LCD_KEYS),
            light_action("selectNextLight", &LIGHT_SELECTION_LCD_KEYS),
        ),
        dial(
            "3",
            "1",
            "Intensity",
            Some("$(custom:lcd_light_intensity)"),
            light_action("resetIntensity", &["light_intensity"]),
            light_action("intensityDown", &["light_intensity"]),
            light_action("intensityUp", &["light_intensity"]),
        ),
        dial(
            "3",
            "2",
            "CCT",
            Some("$(custom:lcd_light_cct)"),
            light_action("resetCct", &["light_cct"]),
            light_action("cctDown", &["light_cct"]),
            light_action("cctUp", &["light_cct"]),
        ),
        dial(
            "3",
            "3",
            "Scene",
            Some("$(custom:lcd_scene_nav)"),
            light_action("recallScene", &["scene_nav"]),
            light_action("selectPrevScene", &["scene_nav"]),
            light_action("selectNextScene", &["scene_nav"]),
        ),
    ]
}
