//! The LIGHTS page (2026-10-03, the approved layout). Between segments: choose
//! a scene and recall it. Now and then: set one light by hand, or switch the
//! whole rig.
//!
//! |        | 1    | 2       | 3      | 4       |
//! | ------ | ---- | ------- | ------ | ------- |
//! | Top    | REC  | ALL ON  | SAVE   | AUDIO › |
//! | Bottom | PLAY | ALL OFF | (dark) | RECALL  |
//!
//! The strip shows each dial's name over its value: LIGHT, INTENSITY, CCT and
//! SCENE. Until 2026-10-03 the four displays sat on the dials themselves,
//! where Companion draws nothing on a Stream Deck+, and the strip was black.

use super::common::{page_key, play_key, rec_key};
use super::model::{
    cell, dark_key, dial, key, key_with_value, reads, shown_head, Control, Prop, Step,
    DECK_AMBER_BG, DECK_AMBER_INK, DECK_GREY_INK, DECK_LIVE_BG, DECK_PREVIEW_INK, LABEL, VALUE,
};

/// The LIGHTS page's keys and dials.
const ROUTE: &str = "/api/deck/light-action";

fn light(action: &'static str) -> Step {
    Step::Post {
        route: ROUTE,
        action,
        value: None,
    }
}

/// While Preview is on: what a key or a dial of the page changes is staged.
fn previewing() -> String {
    reads("scene_state", "preview")
}

/// `RECALL`: the chosen scene onto the rig, with the Lighting page's Fade.
/// Under its word: `ON RIG` (green) while the rig holds the chosen scene,
/// `UNSAVED` (amber) while it was put on the rig and the rig changed since,
/// `PREVIEW` (blue) while previewing; nothing when a press changes the rig.
/// Grey with no scene.
fn recall_key() -> Control {
    let state = |word: &str| reads("scene_state", word);
    let value = format!(
        "{} ? 'ON RIG' : ({} ? 'UNSAVED' : ({} ? 'PREVIEW' : ''))",
        state("live"),
        state("unsaved"),
        state("preview")
    );
    key_with_value(
        1,
        3,
        "RECALL",
        Prop::text("RECALL"),
        Prop::Expr(value),
        "key_recall",
    )
    .on_press(light("recallScene"))
    .rule(
        state("live"),
        vec![(VALUE, "color", Prop::colour(DECK_LIVE_BG))],
    )
    .rule(
        state("unsaved"),
        vec![(VALUE, "color", Prop::colour(DECK_AMBER_BG))],
    )
    .rule(
        state("preview"),
        vec![(VALUE, "color", Prop::colour(DECK_PREVIEW_INK))],
    )
    .inked(state("none"), DECK_GREY_INK)
    .grey_without_the_link()
}

/// A value of the chosen light: blue while Preview is on.
fn level_cell(
    col: u8,
    label: &'static str,
    shows: &'static str,
    display: &str,
    art: &'static str,
) -> Control {
    cell(col, label, shows, Prop::text(label), display, art)
        .rule(
            previewing(),
            vec![(VALUE, "color", Prop::colour(DECK_PREVIEW_INK))],
        )
        .grey_without_the_link()
}

pub(super) fn light_controls() -> Vec<Control> {
    let scene = |word: &str| reads("scene_state", word);
    vec![
        rec_key(),
        key(0, 1, "ALL ON", "ALL ON", "key_all_on")
            .on_press(light("allOn"))
            .grey_without_the_link(),
        // Saves the rig as a new scene, `Scene N`, which the SCENE dial then
        // has chosen. One press (the owner's decision, 2026-09-28).
        key(0, 2, "SAVE", "SAVE", "key_save")
            .on_press(light("saveScene"))
            .grey_without_the_link(),
        page_key(
            "AUDIO \u{203a}",
            "AUDIO\n\u{203a}",
            "audio",
            "key_page_audio",
        ),
        play_key(),
        // Asks first: `OFF?` in amber for 3 s, and a second press within them
        // switches every fixture off (2026-09-28). ALL ON sits over it, as on
        // a wall switch.
        key(1, 1, "ALL OFF", "ALL OFF", "key_all_off")
            .on_press(light("allOff"))
            .filled_and(
                reads("light_key_off", "OFF?"),
                DECK_AMBER_BG,
                DECK_AMBER_INK,
                vec![(LABEL, "text", Prop::text("OFF?"))],
            )
            .grey_without_the_link(),
        // Del Scene's place: deleting a scene stays on the screen, with its
        // confirm and its Undo (the owner's answer to question 3).
        dark_key(1, 2),
        recall_key(),
        cell(
            0,
            "LIGHT",
            "the light the dials set, and its place among the lights",
            Prop::Expr(shown_head("light_nav")),
            "light_nav",
            "cell_light",
        )
        .grey_without_the_link(),
        level_cell(
            1,
            "INTENSITY",
            "the chosen light's intensity, or OFF",
            "light_intensity",
            "cell_intensity",
        ),
        level_cell(
            2,
            "CCT",
            "the chosen light's colour temperature",
            "light_cct",
            "cell_cct",
        ),
        cell(
            3,
            "SCENE",
            "the chosen scene, and whether the rig holds it",
            Prop::Expr(shown_head("scene_nav")),
            "scene_nav",
            "cell_scene",
        )
        .rule(
            scene("live"),
            vec![(VALUE, "color", Prop::colour(DECK_LIVE_BG))],
        )
        .rule(
            scene("unsaved"),
            vec![(VALUE, "color", Prop::colour(DECK_AMBER_BG))],
        )
        .rule(
            scene("preview"),
            vec![(VALUE, "color", Prop::colour(DECK_PREVIEW_INK))],
        )
        .grey_without_the_link(),
        dial(
            0,
            "LIGHT",
            Some(light("toggleLight")),
            light("selectPrevLight"),
            light("selectNextLight"),
        ),
        dial(
            1,
            "INTENSITY",
            Some(light("resetIntensity")),
            light("intensityDown"),
            light("intensityUp"),
        ),
        dial(
            2,
            "CCT",
            Some(light("resetCct")),
            light("cctDown"),
            light("cctUp"),
        ),
        // The SCENE dial's push recalls, as RECALL does.
        dial(
            3,
            "SCENE",
            Some(light("recallScene")),
            light("selectPrevScene"),
            light("selectNextScene"),
        ),
    ]
}
