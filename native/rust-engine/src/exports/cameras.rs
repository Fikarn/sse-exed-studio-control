//! The CAMERAS page (D14): `CAM 1`–`CAM 3`, `BANK`, `REC` and the page key,
//! four dials, and the strip over them. What a key does and what a display
//! says is the cameras' own (`cameras::deck`).

use super::controls::{
    button, color_feedback, dial, expression_button, http_post, lcd_refreshes, page_jump,
    state_feedback, ControlDef, DECK_AMBER_BG, DECK_AMBER_INK, DECK_DOUBT_INK, DECK_GREY_INK,
    DECK_HAZARD_INK,
};
use super::pages::deck_page_number;
use serde_json::{json, Value};

/// The route of the page's keys and dials.
const ROUTE: &str = "/api/deck/camera-action";

/// The strip's four cells and the word their colour follows: what a
/// selection or the bank changes.
const STRIP_KEYS: [&str; 5] = [
    "camera_strip_1",
    "camera_strip_2",
    "camera_strip_3",
    "camera_strip_4",
    "camera_state_dials",
];

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

/// `CAM n`: amber while it is the selected camera (the page's selection).
fn camera_key(col: &'static str, camera: &'static str) -> ControlDef {
    type CameraKey = (&'static str, &'static str);
    let (label, text): CameraKey = match camera {
        "1" => ("CAM 1", "$(custom:lcd_camera_key_1)"),
        "2" => ("CAM 2", "$(custom:lcd_camera_key_2)"),
        _ => ("CAM 3", "$(custom:lcd_camera_key_3)"),
    };
    let mut refreshes = vec!["camera_state_selected"];
    refreshes.extend(STRIP_KEYS);
    expression_button(
        "0",
        col,
        label,
        text,
        key("select", Some(camera), &refreshes),
    )
    .size("14")
    .with_feedbacks(vec![color_feedback(
        "camera_state_selected",
        camera,
        DECK_AMBER_INK,
        DECK_AMBER_BG,
    )])
}

fn strip_cell(col: &'static str, label: &'static str, text: &'static str) -> ControlDef {
    expression_button("2", col, label, text, Vec::new())
        .size("14")
        .no_topbar()
        .with_feedbacks(vec![
            // A camera that does not answer: what it last reported, as doubt.
            state_feedback(
                "camera_state_dials",
                "doubt",
                false,
                json!({ "color": DECK_DOUBT_INK }),
            ),
            state_feedback(
                "camera_state_dials",
                "locked",
                false,
                json!({ "color": DECK_GREY_INK }),
            ),
        ])
}

fn camera_dial(col: &'static str, label: &'static str, number: &'static str) -> ControlDef {
    type Turns = (&'static str, &'static str, &'static str);
    let (down, up, strip): Turns = match number {
        "1" => ("1:down", "1:up", "camera_strip_1"),
        "2" => ("2:down", "2:up", "camera_strip_2"),
        "3" => ("3:down", "3:up", "camera_strip_3"),
        _ => ("4:down", "4:up", "camera_strip_4"),
    };
    dial(
        "3",
        col,
        label,
        None,
        key("dialPush", Some(number), &[strip]),
        key("dial", Some(down), &[strip]),
        key("dial", Some(up), &[strip]),
    )
}

pub(super) fn camera_controls() -> Vec<ControlDef> {
    let mut bank_refreshes = vec!["camera_key_bank"];
    bank_refreshes.extend(STRIP_KEYS);

    vec![
        camera_key("0", "1"),
        camera_key("1", "2"),
        camera_key("2", "3"),
        expression_button(
            "0",
            "3",
            "BANK",
            "$(custom:lcd_camera_key_bank)",
            key("bank", None, &bank_refreshes),
        )
        .size("14"),
        // `REC` is CAM 1's whichever camera is selected. While CAM 1 records
        // it is a red lamp and the word on a dark key, never a red fill
        // (D19); armed to stop it reads `STOP?` in amber.
        expression_button(
            "1",
            "0",
            "REC",
            "$(custom:lcd_camera_key_rec)",
            key("rec", None, &["camera_key_rec", "camera_state_rec"]),
        )
        .size("18")
        .no_topbar()
        .with_feedbacks(vec![
            state_feedback(
                "camera_state_rec",
                "recording",
                false,
                json!({ "color": DECK_HAZARD_INK, "png64": super::controls::deck_asset("lamp_red") }),
            ),
            color_feedback("camera_state_rec", "armed", DECK_AMBER_INK, DECK_AMBER_BG),
            state_feedback(
                "camera_state_rec",
                "last-known",
                false,
                json!({ "color": DECK_DOUBT_INK, "png64": super::controls::deck_asset("lamp_amber") }),
            ),
            state_feedback(
                "camera_state_rec",
                "locked",
                false,
                json!({ "color": DECK_GREY_INK }),
            ),
        ]),
        // Row 1, columns 1 and 2 stay dark.
        button(
            "1",
            "3",
            "PROMPTER >>",
            page_jump(deck_page_number("prompter")),
        ),
        strip_cell("0", "What dial 1 sets", "$(custom:lcd_camera_strip_1)"),
        strip_cell("1", "What dial 2 sets", "$(custom:lcd_camera_strip_2)"),
        strip_cell("2", "What dial 3 sets", "$(custom:lcd_camera_strip_3)"),
        strip_cell("3", "What dial 4 sets", "$(custom:lcd_camera_strip_4)"),
        camera_dial("0", "Dial 1", "1"),
        camera_dial("1", "Dial 2", "2"),
        camera_dial("2", "Dial 3", "3"),
        camera_dial("3", "Dial 4", "4"),
    ]
}
