//! The controls every page has in the same place (2026-10-03, the owner's
//! answer to question 1): `REC` top left and `PLAY` under it, the take
//! column, and the page key top right, which turns the deck alone to the
//! next page of the ring. `REC` and `PLAY` read displays every page polls
//! anyway, so on four pages they cost nothing more.

use super::model::{
    key_with_value, lamp_key, page_key_base, reads, shown, Control, Prop, Step, ART, DECK_BLACK,
    DECK_BURGUNDY, DECK_FACE, DECK_GREEN, DECK_INK_3, DECK_INK_4, LAMP, SUB_LINE, VALUE,
};

/// The CAMERAS page's keys and dials.
pub(super) const CAMERA_ROUTE: &str = "/api/deck/camera-action";
/// The PROMPTER page's keys and dials.
pub(super) const PROMPTER_ROUTE: &str = "/api/deck/prompter-action";

pub(super) fn camera(action: &'static str, value: Option<&'static str>) -> Step {
    Step::Post {
        route: CAMERA_ROUTE,
        action,
        value,
    }
}

pub(super) fn prompter(action: &'static str, value: Option<&'static str>) -> Step {
    Step::Post {
        route: PROMPTER_ROUTE,
        action,
        value,
    }
}

/// `REC` (D14, D19), on every page: CAM 1's, whatever page or camera the
/// deck is on. Ready: the word under an unlit lamp. Recording: the running
/// latch, a Coral keyline, lamp and word, and the take's length; never a
/// fill. Asking: the armed form, `STOP?` and "press again" on Burgundy, for
/// 3 s (the take's length gives "press again" its place). CAM 1 not
/// answering mid-take: doubt, a dashed Yellow keyline and a Yellow lamp,
/// and `LAST KNOWN`, the stop locked. Released or not set up: locked.
pub(super) fn rec_key() -> Control {
    let rec = |word: &str| reads("camera_state_rec", word);
    lamp_key(0, 0, "REC", Prop::Expr(shown("camera_key_rec")))
        .on_press(camera("rec", None))
        .rule(
            rec("recording"),
            vec![
                (ART, "base64Image", Prop::image("key_rec_recording")),
                (LAMP, "base64Image", Prop::image("lamp_red")),
            ],
        )
        .shows_and(
            rec("armed"),
            "key_rec_armed",
            DECK_BURGUNDY,
            vec![
                (LAMP, "enabled", Prop::flag(false)),
                (VALUE, "enabled", Prop::flag(false)),
            ],
        )
        .rule(
            rec("last-known"),
            vec![
                (ART, "base64Image", Prop::image("key_rec_last_known")),
                (LAMP, "base64Image", Prop::image("lamp_amber")),
            ],
        )
        .shows_and(
            rec("locked"),
            "key_rec_locked",
            DECK_FACE,
            vec![
                (LAMP, "enabled", Prop::flag(false)),
                (VALUE, "color", Prop::colour(DECK_INK_4)),
            ],
        )
        .grey_without_the_link()
}

/// `PLAY`, on every page: the prompter's play or pause, decided by what the
/// glass does at that moment. Its time left under it; the Green fill while
/// the text scrolls; disabled, its reason in the quiet ink, with `END` at
/// the script's end, `NO XL` while the Prompter XL shows nothing, `--` while
/// nothing is on the prompter.
pub(super) fn play_key() -> Control {
    let play = |word: &str| reads("prompter_state_play", word);
    let value = format!(
        "{} ? 'END' : ({} ? 'NO XL' : {})",
        play("end"),
        play("no-xl"),
        shown("prompter_left")
    );
    key_with_value(1, 0, "PLAY", Prop::Expr(value), "key_play", SUB_LINE)
        .on_press(prompter("playPause", None))
        .shows_and(
            play("playing"),
            "key_play_playing",
            DECK_GREEN,
            vec![(VALUE, "color", Prop::colour(DECK_BLACK))],
        )
        .shows_and(
            format!("{} || {} || {}", play("end"), play("no-xl"), play("locked")),
            "key_play_off",
            DECK_FACE,
            vec![(VALUE, "color", Prop::colour(DECK_INK_3))],
        )
        .grey_without_the_link()
}

/// The page key, top right (D5): the next page's tab word on Dark Green,
/// with a pip a page of the ring, and a turn of the deck alone to it. It
/// sends nothing to the hardware link, and works without it.
pub(super) fn page_key(label: &'static str, to: &'static str, art: &'static str) -> Control {
    page_key_base(0, 3, label, art).on_press(Step::Jump(to))
}
