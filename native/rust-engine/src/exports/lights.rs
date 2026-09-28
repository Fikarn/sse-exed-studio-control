//! The LIGHTS page.

use super::controls::{
    button, color_feedback, dial, expression_button, http_post, lcd_refreshes, page_jump,
    ControlDef, DECK_AMBER_BG, DECK_AMBER_INK,
};
use super::pages::deck_page_number;
use serde_json::json;

// The LIGHTS page's LCD keys: not polled. The lighting page-follow trigger
// refreshes all four as the deck arrives on LIGHTS, and the Light dial's press
// refreshes `light_nav`, `light_intensity` and `light_cct`; the dial turns and
// the scene keys refresh none of them. (New pages program, Slice 2: the
// Planning keys `project_nav`, `project_status`, `project_priority`,
// `sort_mode` and `task_nav` left with the PROJECTS and TASKS pages; the list
// was called `LEGACY_LCD_KEYS` until then.)
pub(super) const LIGHT_LCD_KEYS: &[&str] =
    &["light_nav", "light_intensity", "light_cct", "scene_nav"];

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
            http_post("/api/deck/light-action", json!({"action":"toggleLight"}))
                .into_iter()
                .chain(lcd_refreshes(&[
                    "light_nav",
                    "light_intensity",
                    "light_cct",
                ]))
                .collect(),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectPrevLight"}),
            ),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectNextLight"}),
            ),
        ),
        dial(
            "3",
            "1",
            "Intensity",
            Some("$(custom:lcd_light_intensity)"),
            http_post("/api/deck/light-action", json!({"action":"resetIntensity"})),
            http_post("/api/deck/light-action", json!({"action":"intensityDown"})),
            http_post("/api/deck/light-action", json!({"action":"intensityUp"})),
        ),
        dial(
            "3",
            "2",
            "CCT",
            Some("$(custom:lcd_light_cct)"),
            http_post("/api/deck/light-action", json!({"action":"resetCct"})),
            http_post("/api/deck/light-action", json!({"action":"cctDown"})),
            http_post("/api/deck/light-action", json!({"action":"cctUp"})),
        ),
        dial(
            "3",
            "3",
            "Scene",
            Some("$(custom:lcd_scene_nav)"),
            http_post("/api/deck/light-action", json!({"action":"recallScene"})),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectPrevScene"}),
            ),
            http_post(
                "/api/deck/light-action",
                json!({"action":"selectNextScene"}),
            ),
        ),
    ]
}
