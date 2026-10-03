//! The controls every page has in the same place (2026-10-03, the owner's
//! answer to question 1): `REC` top left and `PLAY` under it, the take
//! column, and the page key top right, which turns the deck alone to the
//! next page of the ring. `REC` and `PLAY` read displays every page polls
//! anyway, so on four pages they cost nothing more.

use super::model::{
    key, key_with_value, lamp_key, reads, shown, Control, Prop, Step, DECK_AMBER_BG,
    DECK_AMBER_INK, DECK_DOUBT_INK, DECK_GREY_INK, DECK_HAZARD_INK, DECK_LIVE_BG, DECK_LIVE_INK,
    LABEL, LAMP, VALUE,
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
/// deck is on. Ready: the word under an unlit lamp. Recording: a red lamp,
/// the red word and the take's length, never a red fill. Asking: `STOP?` in
/// amber for 3 s. CAM 1 not answering mid-take: an amber lamp and
/// `LAST KNOWN`, the stop locked. Released or not set up: grey.
pub(super) fn rec_key() -> Control {
    let rec = |word: &str| reads("camera_state_rec", word);
    lamp_key(0, 0, "REC", Prop::Expr(shown("camera_key_rec")))
        .on_press(camera("rec", None))
        .rule(
            rec("recording"),
            vec![
                (
                    LAMP,
                    "base64Image",
                    Prop::Expr(String::from("$(image:lamp_red)")),
                ),
                (LABEL, "color", Prop::colour(DECK_HAZARD_INK)),
            ],
        )
        .filled_and(
            rec("armed"),
            DECK_AMBER_BG,
            DECK_AMBER_INK,
            vec![
                (LABEL, "text", Prop::text("STOP?")),
                (LAMP, "enabled", Prop::flag(false)),
            ],
        )
        .rule(
            rec("last-known"),
            vec![
                (
                    LAMP,
                    "base64Image",
                    Prop::Expr(String::from("$(image:lamp_amber)")),
                ),
                (LABEL, "color", Prop::colour(DECK_DOUBT_INK)),
                (VALUE, "color", Prop::colour(DECK_DOUBT_INK)),
            ],
        )
        .inked(rec("locked"), DECK_GREY_INK)
        .grey_without_the_link()
}

/// `PLAY`, on every page: the prompter's play or pause, decided by what the
/// glass does at that moment. Its time left under it; green while the text
/// scrolls; grey with `END` at the script's end, `NO XL` while the Prompter
/// XL shows nothing, `--` while nothing is on the prompter.
pub(super) fn play_key() -> Control {
    let play = |word: &str| reads("prompter_state_play", word);
    let value = format!(
        "{} ? 'END' : ({} ? 'NO XL' : {})",
        play("end"),
        play("no-xl"),
        shown("prompter_left")
    );
    key_with_value(
        1,
        0,
        "PLAY",
        Prop::text("PLAY"),
        Prop::Expr(value),
        "key_play",
    )
    .on_press(prompter("playPause", None))
    .filled(play("playing"), DECK_LIVE_BG, DECK_LIVE_INK)
    .inked(
        format!("{} || {} || {}", play("end"), play("no-xl"), play("locked")),
        DECK_GREY_INK,
    )
    .grey_without_the_link()
}

/// The page key, top right (D5): the next page's name, and a turn of the
/// deck alone to it. It sends nothing to the hardware link.
pub(super) fn page_key(
    label: &'static str,
    words: &str,
    to: &'static str,
    art: &'static str,
) -> Control {
    key(0, 3, label, words, art).on_press(Step::Jump(to))
}
