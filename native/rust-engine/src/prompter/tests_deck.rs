//! The Stream Deck's PROMPTER page (`docs/design/teleprompter.md` §9): its
//! keys, its dials and its displays.

use crate::prompter::deck::{deck_texts, duration_text, handle_deck_action, PROMPTER_LCD_KEYS};
use crate::prompter::test_support::TestPrompter;
use crate::prompter::PrompterError;
use serde_json::json;
use std::collections::HashMap;
use std::thread;
use std::time::Duration;

/// A key or a dial that must do something; the reason `prompter.changed`
/// carries.
fn press(prompter: &TestPrompter, action: &str, value: Option<&str>) -> Option<&'static str> {
    handle_deck_action(prompter.path(), action, value)
        .unwrap_or_else(|error| panic!("{action} {value:?} should succeed: {error:?}"))
        .reason
}

/// A key or a dial that must be refused; its code and sentence.
fn refused(prompter: &TestPrompter, action: &str, value: Option<&str>) -> (String, String) {
    match handle_deck_action(prompter.path(), action, value) {
        Ok(reply) => panic!(
            "{action} {value:?} should be refused, answered {}",
            reply.result
        ),
        Err(PrompterError::Refused(code, sentence)) => (code.to_string(), sentence),
        Err(PrompterError::Invalid(sentence)) => (String::from("INVALID_PARAMS"), sentence),
        Err(PrompterError::Storage(message)) => (String::from("STORAGE_ERROR"), message),
    }
}

fn displays(prompter: &TestPrompter) -> HashMap<&'static str, String> {
    deck_texts(prompter.path())
        .expect("the displays read")
        .into_iter()
        .collect()
}

fn place(prompter: &TestPrompter) -> (u64, u64) {
    let place = prompter.snapshot()["glass"]["place"].clone();
    (
        place["paragraph"].as_u64().expect("paragraph"),
        place["word"].as_u64().expect("word"),
    )
}

/// A script of three paragraphs on the prompter, laid out two words a line.
fn on_the_prompter(label: &str) -> TestPrompter {
    let prompter = TestPrompter::new(label);
    let script = prompter.script(
        "02 Interview intro",
        &[
            "one two three four",
            "five six seven eight",
            "nine ten eleven twelve",
        ],
    );
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(2, 100.0);
    prompter
}

// §9: every prompter control is grey while nothing is on the prompter, the
// size dial too: the screen's look sets the size at any time, the deck's dial
// sets the take's.
#[test]
fn with_nothing_on_the_prompter_the_displays_say_so_and_every_key_is_refused() {
    let prompter = TestPrompter::new("deck-nothing-on");
    let size = prompter.snapshot()["sizePx"].clone();
    assert!(size.is_number(), "{size}");
    let displays = displays(&prompter);
    assert_eq!(displays.len(), PROMPTER_LCD_KEYS.len());
    for key in PROMPTER_LCD_KEYS {
        assert!(displays.contains_key(key), "{key}");
    }
    assert_eq!(displays["prompter_speed"], "SPEED\\n--");
    assert_eq!(displays["prompter_line"], "LINE\\n--");
    assert_eq!(displays["prompter_place"], "PARAGRAPH\\n--");
    // The size, all the time (2026-10-03).
    assert_eq!(displays["prompter_size"], format!("SIZE\\n{size} px"));
    assert_eq!(displays["prompter_left"], "--");
    assert_eq!(displays["prompter_state_play"], "locked");
    assert_eq!(displays["prompter_state_on"], "no");

    for (action, value) in [
        ("playPause", None),
        ("back", None),
        ("top", None),
        ("cue", Some("next")),
        ("speed", Some("up")),
        ("line", Some("next")),
        ("paragraph", Some("previous")),
        ("size", Some("up")),
        ("size", Some("down")),
        ("size", Some("standard")),
    ] {
        assert_eq!(
            refused(&prompter, action, value),
            (
                String::from("PROMPTER_NOTHING_ON"),
                String::from("Nothing is on the prompter. Put a script on first.")
            ),
            "{action} {value:?}"
        );
    }
    // The size is as it was.
    assert_eq!(prompter.snapshot()["sizePx"], size);
    assert_eq!(self::displays(&prompter)["prompter_left"], "--");
}

// 2026-10-03: each cell shows its own dial (SPEED, LINE, PARAGRAPH, SIZE),
// and `PLAY` the bare time left. The script's name left the deck.
#[test]
fn the_strip_says_the_speed_the_line_the_paragraph_and_the_size() {
    let prompter = on_the_prompter("deck-strip");
    let displays = displays(&prompter);
    assert_eq!(displays.len(), PROMPTER_LCD_KEYS.len());
    assert!(!displays.contains_key("prompter_name"));
    assert_eq!(displays["prompter_speed"], "SPEED\\n140");
    assert_eq!(displays["prompter_line"], "LINE\\n0 %");
    assert_eq!(displays["prompter_place"], "PARAGRAPH\\n1 / 3");
    assert_eq!(displays["prompter_size"], "SIZE\\n88 px");
    // The time the screen gets (`timeLeftSeconds`, from the layout), in the
    // page's own form, bare.
    let seconds = prompter.snapshot()["glass"]["timeLeftSeconds"]
        .as_f64()
        .expect("the time left");
    assert_eq!(displays["prompter_left"], duration_text(seconds));
    assert_eq!(displays["prompter_left"], "0:06");
    assert_eq!(displays["prompter_state_play"], "ready");
    assert_eq!(displays["prompter_state_on"], "yes");

    prompter.call(
        "prompter.jump",
        json!({ "to": "place", "paragraph": 1, "word": 2 }),
    );
    // Six of twelve read words are before the reading line.
    let displays = self::displays(&prompter);
    assert_eq!(displays["prompter_line"], "LINE\\n50 %");
    assert_eq!(displays["prompter_place"], "PARAGRAPH\\n2 / 3");
}

// §9: `PLAY` and the speed dial's push play or pause; which, the hardware
// link decides by what the glass does at that moment.
#[test]
fn play_plays_or_pauses_by_what_the_glass_does() {
    let prompter = on_the_prompter("deck-play");
    let reply = handle_deck_action(prompter.path(), "playPause", None).expect("play");
    assert_eq!(reply.reason, Some("played"));
    assert!(reply.anchor.is_some(), "the views hear where the text is");
    assert!(!reply.health_changed);
    // The displays read what the key left, at once.
    let texts = displays(&prompter);
    assert_eq!(texts.len(), PROMPTER_LCD_KEYS.len());
    assert_eq!(texts["prompter_state_play"], "playing");
    assert_eq!(prompter.snapshot()["glass"]["playing"], true);
    assert_eq!(displays(&prompter)["prompter_state_play"], "playing");

    assert_eq!(press(&prompter, "playPause", None), Some("paused"));
    assert_eq!(prompter.snapshot()["glass"]["playing"], false);
    assert_eq!(displays(&prompter)["prompter_state_play"], "ready");

    // The screen's PLAY and the deck's are one: what one started the other
    // pauses.
    prompter.call("prompter.play", json!({}));
    assert_eq!(press(&prompter, "playPause", None), Some("paused"));
}

// §9: while the Prompter XL is not connected, `PLAY` and the speed dial's
// push are locked and `PLAY` says why (`no-xl`, 2026-10-03: until then the
// speed cell said it); jumps, speed and size still work.
#[test]
fn without_the_prompter_xl_play_is_locked_and_says_why() {
    let prompter = on_the_prompter("deck-not-connected");
    prompter.report_screen(json!({ "found": false }));
    let displays = displays(&prompter);
    assert_eq!(displays["prompter_state_play"], "no-xl");
    assert_eq!(displays["prompter_speed"], "SPEED\\n140");
    assert_eq!(displays["prompter_state_on"], "yes");
    let (code, sentence) = refused(&prompter, "playPause", None);
    assert_eq!(code, "PROMPTER_NOT_ON_GLASS");
    assert!(
        sentence.starts_with("The Prompter XL is not connected"),
        "{sentence}"
    );
    assert_eq!(prompter.snapshot()["glass"]["playing"], false);

    assert_eq!(press(&prompter, "speed", Some("up")), Some("speed"));
    assert_eq!(press(&prompter, "paragraph", Some("next")), Some("jumped"));
    let displays = self::displays(&prompter);
    assert_eq!(displays["prompter_speed"], "SPEED\\n145");
    assert_eq!(displays["prompter_state_play"], "no-xl");

    prompter.report_screen(
        json!({ "found": true, "duplicated": true, "width": 1920, "height": 1080, "refreshHz": 60 }),
    );
    assert_eq!(self::displays(&prompter)["prompter_state_play"], "no-xl");

    // Drawn soft is drawn: the text may scroll.
    prompter.report_screen(json!({ "found": true, "width": 1280, "height": 720, "refreshHz": 60 }));
    let displays = self::displays(&prompter);
    assert_eq!(displays["prompter_speed"], "SPEED\\n145");
    assert_eq!(displays["prompter_state_play"], "ready");
}

// §9: speed 5 words a minute a detent, position a line, paragraph a
// paragraph. A jump keeps the scroll as it was; only TOP pauses.
#[test]
fn the_dials_step_the_speed_the_line_and_the_paragraph() {
    let prompter = on_the_prompter("deck-dials");
    assert_eq!(press(&prompter, "speed", Some("up")), Some("speed"));
    assert_eq!(press(&prompter, "speed", Some("up")), Some("speed"));
    assert_eq!(prompter.snapshot()["glass"]["speedWpm"], 150);
    press(&prompter, "speed", Some("down"));
    assert_eq!(displays(&prompter)["prompter_speed"], "SPEED\\n145");

    press(&prompter, "line", Some("next"));
    assert_eq!(place(&prompter), (0, 2), "two words a line");
    press(&prompter, "line", Some("previous"));
    assert_eq!(place(&prompter), (0, 0));

    press(&prompter, "paragraph", Some("next"));
    press(&prompter, "paragraph", Some("next"));
    assert_eq!(place(&prompter), (2, 0));
    assert_eq!(
        refused(&prompter, "paragraph", Some("next")).0,
        "PROMPTER_NO_PARAGRAPH"
    );
    press(&prompter, "paragraph", Some("previous"));
    assert_eq!(place(&prompter), (1, 0));

    press(&prompter, "playPause", None);
    press(&prompter, "paragraph", Some("previous"));
    assert_eq!(
        prompter.snapshot()["glass"]["playing"],
        true,
        "a jump keeps the scroll as it was"
    );
    assert_eq!(press(&prompter, "top", None), Some("jumped"));
    let glass = prompter.snapshot()["glass"].clone();
    assert_eq!(glass["playing"], false, "TOP pauses");
    assert_eq!(glass["place"], json!({ "paragraph": 0, "word": 0 }));
}

#[test]
fn back_and_the_cue_keys_jump_as_the_pages_keys_do() {
    let prompter = TestPrompter::new("deck-cues");
    let script = prompter.script(
        "Talk",
        &[
            "[INTRO]",
            "one two three four",
            "[GUEST]",
            "five six seven eight",
        ],
    );
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(press(&prompter, "cue", Some("next")), Some("jumped"));
    assert_eq!(place(&prompter), (2, 0));
    assert_eq!(
        refused(&prompter, "cue", Some("next")),
        (
            String::from("PROMPTER_NO_CUE"),
            String::from("There is no cue after the reading line.")
        )
    );
    press(&prompter, "cue", Some("previous"));
    assert_eq!(place(&prompter), (0, 0));

    prompter.call(
        "prompter.jump",
        json!({ "to": "place", "paragraph": 3, "word": 2 }),
    );
    assert_eq!(press(&prompter, "back", None), Some("jumped"));
    assert_eq!(place(&prompter), (3, 0));
}

// §9: text size 4 px a detent; a push returns to the standard. The size
// cell shows the size all the time, and `PLAY` the time left (2026-10-03:
// until then the time-left cell showed the size for 2 s after a turn).
#[test]
fn the_size_dial_sets_the_size_its_cell_shows() {
    let prompter = on_the_prompter("deck-size");
    assert_eq!(prompter.snapshot()["sizePx"], 88);
    assert_eq!(displays(&prompter)["prompter_size"], "SIZE\\n88 px");

    assert_eq!(press(&prompter, "size", Some("up")), Some("size"));
    assert_eq!(press(&prompter, "size", Some("up")), Some("size"));
    assert_eq!(prompter.snapshot()["sizePx"], 96);
    assert_eq!(displays(&prompter)["prompter_size"], "SIZE\\n96 px");
    assert!(!displays(&prompter)["prompter_left"].contains("px"));
    // The text is laid out anew, and until a view has said how, PLAY waits:
    // the Prompter XL has not drawn it yet.
    assert_eq!(displays(&prompter)["prompter_state_play"], "no-xl");
    prompter.lay_out(2, 110.0);
    assert_eq!(displays(&prompter)["prompter_state_play"], "ready");

    press(&prompter, "size", Some("down"));
    assert_eq!(displays(&prompter)["prompter_size"], "SIZE\\n92 px");
    press(&prompter, "size", Some("standard"));
    assert_eq!(prompter.snapshot()["sizePx"], 88);
    assert_eq!(displays(&prompter)["prompter_size"], "SIZE\\n88 px");
}

// D19: at a script's end PLAY stays locked until a jump moves the place
// back.
#[test]
fn at_the_end_play_is_locked_until_a_jump_moves_the_place_back() {
    let prompter = TestPrompter::new("deck-end");
    let script = prompter.script("Short", &["Go."]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(5, 10.0);
    prompter.call("prompter.speed", json!({ "wpm": 300 }));
    press(&prompter, "playPause", None);
    // One read word at 300 words a minute is 0.2 s, and the ease 0.15 s.
    thread::sleep(Duration::from_millis(700));
    let displays = displays(&prompter);
    assert_eq!(displays["prompter_place"], "PARAGRAPH\\nEND");
    assert_eq!(displays["prompter_line"], "LINE\\n100 %");
    assert_eq!(displays["prompter_left"], "0:00");
    // `PLAY` says why it will not play (2026-10-03).
    assert_eq!(displays["prompter_state_play"], "end");
    assert_eq!(refused(&prompter, "playPause", None).0, "PROMPTER_AT_END");

    press(&prompter, "back", None);
    assert_eq!(self::displays(&prompter)["prompter_state_play"], "ready");
}

// D14: putting a script on, replacing, updating and clearing it stay on the
// screen. The page has no key for them, and no other.
#[test]
fn a_key_the_page_does_not_have_is_refused() {
    let prompter = on_the_prompter("deck-unknown");
    for action in ["play", "pause", "putOn", "clear", "update", "jump", ""] {
        let (code, sentence) = refused(&prompter, action, None);
        assert_eq!(code, "INVALID_PARAMS", "{action}");
        assert_eq!(sentence, format!("Unsupported PROMPTER key: {action}"));
    }
    for (action, value, sentence) in [
        ("speed", None, "speed goes up or down."),
        ("speed", Some("fast"), "speed goes up or down."),
        ("size", Some("88"), "size goes up, down or standard."),
        ("line", Some("up"), "line goes previous or next."),
        ("paragraph", None, "paragraph goes previous or next."),
        ("cue", Some(""), "cue goes previous or next."),
    ] {
        assert_eq!(
            refused(&prompter, action, value),
            (String::from("INVALID_PARAMS"), String::from(sentence)),
            "{action} {value:?}"
        );
    }
    let glass = prompter.snapshot()["glass"].clone();
    assert_eq!(glass["name"], "02 Interview intro");
    assert_eq!(glass["playing"], false);
    assert_eq!(glass["speedWpm"], 140);
}
