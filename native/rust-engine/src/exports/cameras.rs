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
//! look and turn in one place. The selected camera has the Beige keyline,
//! not an amber fill (F1): a fill means "switched on" on the screen. The
//! state words take the screen's colours and lamps; Coral is REC's and an
//! unreachable camera's.

use super::common::{camera, page_key, play_key, rec_key};
use super::model::{
    cell, dark_key, dial, key_with_value, reads, shown, shown_head, CellValue, Control, Element,
    ElementKind, Prop, ART, BANK_LINE, DECK_FACE, DECK_INK_4, STATE_LINE, VALUE,
};

/// The selected camera's keyline, over its key's picture.
const SELECTED: &str = "selected";

/// `CAM n`: selects it; the dials, the strip, the plate and the big picture
/// follow, and REC stays CAM 1's. A lamp and its name, and under it its
/// state in the screen's words and colours: `HELD` Green, `RELEASED` and
/// `NOT SET UP` Yellow, `UNREACHABLE` Coral. The state is live text only
/// when it is none of the pictures'.
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
    let hidden = || vec![(VALUE, "enabled", Prop::flag(false))];
    key_with_value(1, col, label, Prop::Expr(shown(display)), art, STATE_LINE)
        .element(
            Element::new(
                SELECTED,
                ElementKind::Image {
                    image: "key_selected",
                },
                [0.0, 0.0, 100.0, 100.0],
            )
            .hidden(),
        )
        .on_press(camera("select", Some(number)))
        .shows_and(state("HELD"), &format!("{art}_held"), DECK_FACE, hidden())
        .shows_and(
            state("RELEASED"),
            &format!("{art}_released"),
            DECK_FACE,
            hidden(),
        )
        .shows_and(
            state("NOT SET UP"),
            &format!("{art}_not_set_up"),
            DECK_FACE,
            hidden(),
        )
        .shows_and(
            state("UNREACHABLE"),
            &format!("{art}_unreachable"),
            DECK_FACE,
            hidden(),
        )
        .rule(
            reads("camera_state_selected", number),
            vec![(SELECTED, "enabled", Prop::flag(true))],
        )
        .grey_without_the_link()
}

/// A cell of the strip: what the dial under it sets on the selected camera,
/// by the bank, over the camera's value. Doubt while the camera does not
/// answer (its last values): a dashed Yellow keyline on the value. The
/// fourth ink while it is released or not set up.
fn camera_cell(col: u8, label: &'static str, display: &'static str) -> Control {
    cell(
        col,
        label,
        "what the dial under it sets on the selected camera, and its value",
        Some(Prop::Expr(shown_head(display))),
        display,
        "cell_camera_dial",
        CellValue::Number,
    )
    .rule(
        reads("camera_state_dials", "doubt"),
        vec![(ART, "base64Image", Prop::image("cell_camera_dial_doubt"))],
    )
    .inked(reads("camera_state_dials", "locked"), DECK_INK_4)
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
    let bank = |word: &str| reads("camera_key_bank", word);
    let hidden = || vec![(VALUE, "enabled", Prop::flag(false))];
    vec![
        rec_key(),
        // EXPOSURE, COLOUR or FOCUS, with a pip a bank: nothing reaches a
        // camera. The word is live only when it is none of the pictures'.
        key_with_value(
            0,
            1,
            "BANK",
            Prop::Expr(shown("camera_key_bank")),
            "key_camera_bank",
            BANK_LINE,
        )
        .on_press(camera("bank", None))
        .shows_and(
            bank("EXPOSURE"),
            "key_camera_bank_exposure",
            DECK_FACE,
            hidden(),
        )
        .shows_and(
            bank("COLOUR"),
            "key_camera_bank_colour",
            DECK_FACE,
            hidden(),
        )
        .shows_and(bank("FOCUS"), "key_camera_bank_focus", DECK_FACE, hidden())
        .grey_without_the_link(),
        // Kept free: a one-press AUTO could go here once the camera links are
        // built and reviewed.
        dark_key(0, 2),
        page_key("PROMPTER \u{203a}", "prompter", "key_page_prompter"),
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
