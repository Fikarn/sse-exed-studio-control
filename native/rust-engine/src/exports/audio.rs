//! The AUDIO page (2026-10-03, the approved layout). During the take: ride
//! the voices into the chosen mix, mute, dim the monitor, and clear a stray
//! solo.
//!
//! |        | 1    | 2        | 3      | 4         |
//! | ------ | ---- | -------- | ------ | --------- |
//! | Top    | REC  | MAIN OUT | PHONES | CAMERAS › |
//! | Bottom | PLAY | BANK     | DIM    | SOLO      |
//!
//! The four dials ride the strips' levels into the mix target and their push
//! mutes; the strip above them shows each strip's name over its level, with
//! a bar. GAIN, the strip taps and the mark of the screen's selected strip
//! left the deck (the owner's answers to questions 2 and 4): a turn always
//! sets a level and a push always mutes. The keys' pictures are picked on
//! the deck from state words it reads anyway, so the page asks for nine
//! displays fewer than before.

use super::common::{page_key, play_key, rec_key};
use super::model::{
    cell, dial, key, key_with_value, reads, shown, shown_head, CellValue, Control, Element,
    ElementKind, Prop, Step, ART, BANK_LINE, DECK_FACE, DECK_INK_2, DECK_INK_3, DECK_INK_4,
    DECK_YELLOW, HEAD, MIDDLE_LINE, VALUE,
};

/// The AUDIO page's keys and dials.
const ROUTE: &str = "/api/deck/audio-action";

fn audio(action: &'static str, value: Option<&'static str>) -> Step {
    Step::Post {
        route: ROUTE,
        action,
        value,
    }
}

/// While the Console is locked (OSC off, not verified, offline): every key
/// of the page shows its locked form, whatever state word the hardware link
/// still sends (a key's lock rule comes after its state rules, and only the
/// lost link's after it), and the strip says why.
fn locked() -> String {
    reads("audio_state_gated", "yes")
}

/// The strip's bar: its track runs across the cell under the level, from
/// 6 % to 94 % of its width, 82 to 88 px down (`scripts/deck-assets.py`,
/// `BAR_*`), and the level word is its fill in thirteen steps, `0` to `12`.
const BAR: [f64; 4] = [6.0, 82.0, 88.0, 6.0];
/// RME's 0 dB fader position (step 836 of 1023), on the bar.
const UNITY_AT: f64 = 6.0 + 88.0 * 836.0 / 1023.0;

/// A cell of the strip: the strip's name from TotalMix over its level into
/// the mix target, or `MUTED` (Yellow: engaged, as the screen's M), with a
/// bar for the fader's position; `AUDIO` over the reason (Yellow:
/// attention) while the Console is locked; empty for a strip the bank does
/// not have (the fourth on OUTPUTS).
fn strip_cell(col: u8, strip: &'static str, display: &'static str, level: &'static str) -> Control {
    let word = shown(level);
    let muted = format!("substr({word}, 0, 1) == 'm'");
    let filled = format!(
        "{word} != '' && {word} != 'off' && {word} != 'empty' && substr({word}, 0, 1) != 'm'"
    );
    let on_the_strip = format!("{word} != '' && {word} != 'off' && {word} != 'empty'");
    cell(
        col,
        strip,
        "the strip's name and its level into the mix target",
        Some(Prop::Expr(shown_head(display))),
        display,
        "cell_audio_strip",
        CellValue::Strip,
    )
    .element(
        Element::new(
            "bar",
            ElementKind::Gauge {
                value: Prop::Expr(word.clone()),
                max: 12.0,
                colour: DECK_INK_2,
            },
            BAR,
        )
        .drawn_while(filled),
    )
    .element(
        Element::new(
            "bar-muted",
            ElementKind::Gauge {
                value: Prop::Expr(format!("substr({word}, 1)")),
                max: 12.0,
                colour: DECK_INK_4,
            },
            BAR,
        )
        .drawn_while(muted.clone()),
    )
    .element(
        Element::new(
            "unity",
            ElementKind::Fill {
                colour: Prop::colour(DECK_INK_3),
            },
            [UNITY_AT - 0.5, 79.0, 1.0, 12.0],
        )
        .drawn_while(on_the_strip),
    )
    .rule(muted, vec![(VALUE, "color", Prop::colour(DECK_YELLOW))])
    .rule(
        format!("{word} == 'empty'"),
        vec![(ART, "base64Image", Prop::image("cell_empty"))],
    )
    .rule(
        locked(),
        vec![
            (ART, "base64Image", Prop::image("cell_empty")),
            (HEAD, "color", Prop::colour(DECK_INK_3)),
            (VALUE, "color", Prop::colour(DECK_YELLOW)),
        ],
    )
    .grey_without_the_link()
}

fn strip_dial(col: u8, strip: &'static str) -> Control {
    let (press, down, up) = match strip {
        "1" => ("1", "1:down", "1:up"),
        "2" => ("2", "2:down", "2:up"),
        "3" => ("3", "3:down", "3:up"),
        _ => ("4", "4:down", "4:up"),
    };
    let label = match strip {
        "1" => "DIAL 1",
        "2" => "DIAL 2",
        "3" => "DIAL 3",
        _ => "DIAL 4",
    };
    dial(
        col,
        label,
        Some(audio("dialPress", Some(press))),
        audio("dialTurn", Some(down)),
        audio("dialTurn", Some(up)),
    )
}

pub(super) fn audio_controls() -> Vec<Control> {
    let target = |role: &str| reads("audio_state_target", role);
    let bank = |word: &str| reads("audio_state_bank", word);
    let solo = shown("audio_state_solo");
    let hidden = || (VALUE, "enabled", Prop::flag(false));
    vec![
        rec_key(),
        // Home: the dials send into Main Out. The Yellow fill while it is the
        // mix target.
        key(0, 1, "MAIN OUT", "key_main_out")
            .on_press(audio("setMixTarget", Some("main")))
            .shows(target("main"), "key_main_out_on", DECK_YELLOW)
            .locked_while(locked())
            .grey_without_the_link(),
        // Main Out to Phones 1, Phones 1 to Phones 2, Phones 2 to Phones 1;
        // Yellow, with the phones mix's name, while a phones mix is the
        // target, so that a take never starts with the dials riding a phones
        // mix by mistake.
        key(0, 2, "PHONES", "key_phones")
            .on_press(audio("setMixTarget", Some("phones")))
            .shows(target("phones-a"), "key_phones_1", DECK_YELLOW)
            .shows(target("phones-b"), "key_phones_2", DECK_YELLOW)
            .locked_while(locked())
            .grey_without_the_link(),
        page_key("CAMERAS \u{203a}", "cameras", "key_page_cameras"),
        play_key(),
        // The bank's word and a pip a bank; Yellow off the microphones: the
        // dials ride playback or the outputs. The word is live only when it is
        // none of the pictures'.
        key_with_value(
            1,
            1,
            "BANK",
            Prop::Expr(format!("toUpperCase({})", shown("audio_state_bank"))),
            "key_audio_bank",
            BANK_LINE,
        )
        .on_press(audio("cycleBank", None))
        .shows_and(
            bank("inputs"),
            "key_audio_bank_inputs",
            DECK_FACE,
            vec![hidden()],
        )
        .shows_and(
            bank("playback"),
            "key_audio_bank_playback",
            DECK_YELLOW,
            vec![hidden()],
        )
        .shows_and(
            bank("outputs"),
            "key_audio_bank_outputs",
            DECK_YELLOW,
            vec![hidden()],
        )
        .locked_while(locked())
        .grey_without_the_link(),
        // Main Out 20 dB down, whatever the mix target: the Yellow fill while
        // it is.
        key(1, 2, "DIM", "key_dim")
            .on_press(audio("dimToggle", None))
            .shows(reads("audio_state_dim", "on"), "key_dim_on", DECK_YELLOW)
            .locked_while(locked())
            .grey_without_the_link(),
        // The screen's latch while any strip is soloed: the Yellow keyline,
        // lamp and word, the count, and Clear all.
        key_with_value(
            1,
            3,
            "SOLO",
            Prop::Expr(format!("{solo} > 0 ? `${{{solo}}} ON` : ''")),
            "key_solo",
            MIDDLE_LINE,
        )
        .on_press(audio("soloClearAll", None))
        .shows(format!("{solo} > 0"), "key_solo_latched", DECK_FACE)
        .locked_while(locked())
        .grey_without_the_link(),
        strip_cell(0, "STRIP 1", "audio_strip_1", "audio_strip_1_level"),
        strip_cell(1, "STRIP 2", "audio_strip_2", "audio_strip_2_level"),
        strip_cell(2, "STRIP 3", "audio_strip_3", "audio_strip_3_level"),
        strip_cell(3, "STRIP 4", "audio_strip_4", "audio_strip_4_level"),
        strip_dial(0, "1"),
        strip_dial(1, "2"),
        strip_dial(2, "3"),
        strip_dial(3, "4"),
    ]
}
