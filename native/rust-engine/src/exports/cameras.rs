//! The CAMERAS page (D14; 2026-10-03, the approved layout). Between takes:
//! pick a camera, then set its exposure, colour and focus. During the take:
//! REC. What a key does and what a display says is the cameras' own
//! (`cameras::deck`).
//!
//! |        | 1    | 2     | 3      | 4          |
//! | ------ | ---- | ----- | ------ | ---------- |
//! | Top    | REC  | BANK  | (dark) | PROMPTER › |
//! | Bottom | PLAY | CAM 1 | CAM 2  | CAM 3      |
//!
//! The camera keys sit over the strip that shows the selected camera: pick,
//! look and turn in one place. The selected camera has a white outline, not
//! an amber fill (F1): amber means "switched on" on the screen. The state
//! words take the screen's colours; red stays REC's.

use super::common::{camera, page_key, play_key, rec_key};
use super::model::{
    cell, dark_key, dial, key_with_value, reads, shown, shown_head, Control, Prop, DECK_DOUBT_INK,
    DECK_GREY_INK, DECK_LIVE_BG, DECK_SELECT_LINE, FILL, VALUE,
};

/// `CAM n`: selects it; the dials, the strip, the plate and the big picture
/// follow, and REC stays CAM 1's. Under its name its state, in the screen's
/// words and colours: `HELD` green, `UNREACHABLE` amber, `RELEASED` and
/// `NOT SET UP` grey.
fn camera_key(
    col: u8,
    label: &'static str,
    number: &'static str,
    display: &'static str,
) -> Control {
    let art = match number {
        "1" => "key_cam_1",
        "2" => "key_cam_2",
        _ => "key_cam_3",
    };
    let state = |word: &str| reads(display, word);
    key_with_value(
        1,
        col,
        label,
        Prop::text(label),
        Prop::Expr(shown(display)),
        art,
    )
    .on_press(camera("select", Some(number)))
    .rule(
        state("HELD"),
        vec![(VALUE, "color", Prop::colour(DECK_LIVE_BG))],
    )
    .rule(
        state("UNREACHABLE"),
        vec![(VALUE, "color", Prop::colour(DECK_DOUBT_INK))],
    )
    .rule(
        format!("{} || {}", state("RELEASED"), state("NOT SET UP")),
        vec![(VALUE, "color", Prop::colour(DECK_GREY_INK))],
    )
    .rule(
        reads("camera_state_selected", number),
        vec![
            (FILL, "borderWidth", Prop::Fixed(4.into())),
            (FILL, "borderColor", Prop::colour(DECK_SELECT_LINE)),
        ],
    )
    .grey_without_the_link()
}

/// A cell of the strip: what the dial under it sets on the selected camera,
/// by the bank, over the camera's value. Amber while the camera does not
/// answer (its last values), grey while it is released or not set up.
fn camera_cell(col: u8, label: &'static str, display: &'static str) -> Control {
    cell(
        col,
        label,
        "what the dial under it sets on the selected camera, and its value",
        Prop::Expr(shown_head(display)),
        display,
        "cell_camera_dial",
    )
    .inked(reads("camera_state_dials", "doubt"), DECK_DOUBT_INK)
    .inked(reads("camera_state_dials", "locked"), DECK_GREY_INK)
    .grey_without_the_link()
}

fn camera_dial(col: u8, label: &'static str, number: &'static str) -> Control {
    let (down, up) = match number {
        "1" => ("1:down", "1:up"),
        "2" => ("2:down", "2:up"),
        "3" => ("3:down", "3:up"),
        _ => ("4:down", "4:up"),
    };
    dial(
        col,
        label,
        Some(camera("dialPush", Some(number))),
        camera("dial", Some(down)),
        camera("dial", Some(up)),
    )
}

pub(super) fn camera_controls() -> Vec<Control> {
    vec![
        rec_key(),
        // EXPOSURE, COLOUR or FOCUS: nothing reaches a camera.
        key_with_value(
            0,
            1,
            "BANK",
            Prop::text("BANK"),
            Prop::Expr(shown("camera_key_bank")),
            "key_camera_bank",
        )
        .on_press(camera("bank", None))
        .grey_without_the_link(),
        // Kept free: a one-press AUTO could go here once the camera links are
        // built and reviewed.
        dark_key(0, 2),
        page_key(
            "PROMPTER \u{203a}",
            "PROMPTER\n\u{203a}",
            "prompter",
            "key_page_prompter",
        ),
        play_key(),
        camera_key(1, "CAM 1", "1", "camera_key_1"),
        camera_key(2, "CAM 2", "2", "camera_key_2"),
        camera_key(3, "CAM 3", "3", "camera_key_3"),
        camera_cell(0, "DIAL 1", "camera_strip_1"),
        camera_cell(1, "DIAL 2", "camera_strip_2"),
        camera_cell(2, "DIAL 3", "camera_strip_3"),
        camera_cell(3, "DIAL 4", "camera_strip_4"),
        camera_dial(0, "DIAL 1", "1"),
        camera_dial(1, "DIAL 2", "2"),
        camera_dial(2, "DIAL 3", "3"),
        camera_dial(3, "DIAL 4", "4"),
    ]
}
