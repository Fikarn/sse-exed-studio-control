//! The PROMPTER and CAMERAS pages through the bridge's two entry points: a
//! key's answer, what the screen hears, the row in Recent actions, the last
//! event Setup's Verify step reads, and the displays' short memory.

use super::{CAMERA_ROUTE, PROMPTER_ROUTE};
use crate::cameras::deck::STOP_ARM_DWELL;
use crate::cameras::test_support::TestCameras;
use crate::control_surface::{
    control_surface_last_event, handle_control_surface_http_action, read_control_surface_lcd_text,
    ControlSurfaceError,
};
use crate::engine_events::EMITTED;
use crate::prompter::test_support::TestPrompter;
use serde_json::{json, Value};
use std::path::Path;
use std::thread;
use std::time::Duration;

fn key(db_path: &Path, route: &str, body: Value) -> Value {
    handle_control_surface_http_action(db_path, route, &body)
        .unwrap_or_else(|error| panic!("{body} should succeed: {}", error.message()))
}

fn refused(db_path: &Path, route: &str, body: Value) -> (u16, String) {
    match handle_control_surface_http_action(db_path, route, &body) {
        Ok(answer) => panic!("{body} should be refused, answered {answer}"),
        Err(error) => (error.status_code(), error.message().to_string()),
    }
}

fn display(db_path: &Path, key: &str) -> String {
    read_control_surface_lcd_text(db_path, key)
        .unwrap_or_else(|error| panic!("{key} should be answered: {}", error.message()))
}

/// What the bridge said to the screen on this thread since the last call.
fn said() -> Vec<(String, Value)> {
    EMITTED.with(|events| std::mem::take(&mut *events.borrow_mut()))
}

fn rows(db_path: &Path) -> Vec<(String, String, String, String)> {
    crate::action_log::list_recent_actions(db_path, crate::action_log::RECENT_ACTIONS_LIMIT)
        .expect("the action log should list")
        .into_iter()
        .map(|entry| (entry.source, entry.domain, entry.action, entry.detail))
        .collect()
}

// A key of the CAMERAS page is the screen's request, and the screen hears of
// it as of its own: the page's selection follows the deck.
#[test]
fn a_cameras_key_is_answered_said_and_stamped() {
    let cameras = TestCameras::set_up("bridge-cameras-key");
    said();
    let answer = key(
        cameras.path(),
        CAMERA_ROUTE,
        json!({ "action": "select", "value": "2" }),
    );
    assert_eq!(
        answer,
        json!({ "ok": true, "did": "select", "selected": 2 })
    );
    assert_eq!(
        said(),
        vec![(
            String::from("cameras.changed"),
            json!({ "reason": "select", "camera": 2 })
        )]
    );
    assert_eq!(cameras.snapshot()["selected"], 2);

    // Setup's Verify step reads the last event: the route, the key, its value.
    let last = control_surface_last_event(cameras.path());
    assert_eq!(last["route"], CAMERA_ROUTE);
    assert_eq!(last["action"], "select");
    assert_eq!(last["value"], "2");
    assert!(rows(cameras.path()).is_empty(), "a selection is no row");

    // A dial's detent and the bank are no rows either.
    key(cameras.path(), CAMERA_ROUTE, json!({ "action": "bank" }));
    key(
        cameras.path(),
        CAMERA_ROUTE,
        json!({ "action": "dial", "value": "1:up" }),
    );
    assert!(rows(cameras.path()).is_empty());
    assert_eq!(
        said()
            .into_iter()
            .map(|(_, payload)| payload["reason"].clone())
            .collect::<Vec<_>>(),
        vec![json!("bank"), json!("setting")]
    );
}

// Recent actions: a take started or stopped at the deck is a row with
// `deck` as its source, which the pages print as Stream Deck, in the
// sentence the screen's row carries. The armed stop changed nothing.
#[test]
fn the_decks_rec_leaves_rows_with_the_deck_as_their_source() {
    let cameras = TestCameras::set_up("bridge-cameras-rec");
    let rec = || key(cameras.path(), CAMERA_ROUTE, json!({ "action": "rec" }));

    assert_eq!(rec()["did"], "started");
    assert_eq!(
        rows(cameras.path()),
        vec![(
            String::from("deck"),
            String::from("cameras"),
            String::from("recording-started"),
            String::from("CAM 1 started recording.")
        )]
    );
    let recent = cameras.snapshot()["recent"].clone();
    assert_eq!(recent[0]["source"], "deck");
    assert_eq!(recent[0]["target"], "CAM 1");

    said();
    assert_eq!(rec()["did"], "armed");
    assert_eq!(rows(cameras.path()).len(), 1, "the armed stop is no row");
    assert_eq!(said(), Vec::new(), "and changed nothing the screen shows");
    assert_eq!(display(cameras.path(), "camera_key_rec"), "STOP?");
    assert_eq!(display(cameras.path(), "camera_state_rec"), "armed");

    thread::sleep(STOP_ARM_DWELL + Duration::from_millis(50));
    assert_eq!(rec()["did"], "stopped");
    assert_eq!(
        rows(cameras.path())[0],
        (
            String::from("deck"),
            String::from("cameras"),
            String::from("recording-stopped"),
            String::from("CAM 1 stopped recording.")
        )
    );
    assert_eq!(rows(cameras.path()).len(), 2);
    assert_eq!(display(cameras.path(), "camera_key_rec"), "REC");
}

// A refusal is the bridge's answer in the operator's words: 409 for what the
// cameras refuse now, 400 for a key the page does not have.
#[test]
fn a_refused_key_is_answered_in_the_operators_words() {
    let cameras = TestCameras::set_up("bridge-cameras-refused");
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    key(
        cameras.path(),
        CAMERA_ROUTE,
        json!({ "action": "select", "value": "2" }),
    );
    let stamped = control_surface_last_event(cameras.path());

    // The screen's own refusal, in its words.
    let (_, screens) = cameras.refused(
        "cameras.step",
        json!({ "camera": 2, "setting": "iso", "step": 1 }),
    );
    assert_eq!(
        screens,
        "CAM 2 is released. Connect it to set it from here."
    );
    for dial in ["1:up", "3:down"] {
        assert_eq!(
            refused(
                cameras.path(),
                CAMERA_ROUTE,
                json!({ "action": "dial", "value": dial })
            ),
            (409, screens.clone()),
            "{dial}"
        );
    }
    assert_eq!(
        refused(
            cameras.path(),
            CAMERA_ROUTE,
            json!({ "action": "playPause" })
        ),
        (400, String::from("Unsupported CAMERAS key: playPause"))
    );
    assert_eq!(
        refused(cameras.path(), PROMPTER_ROUTE, json!({ "action": "rec" })),
        (400, String::from("Unsupported PROMPTER key: rec"))
    );
    assert_eq!(
        refused(cameras.path(), CAMERA_ROUTE, json!({ "value": "2" })),
        (400, String::from("action is required"))
    );
    // A refused key is no last event, and nothing reached a camera.
    assert_eq!(control_surface_last_event(cameras.path()), stamped);
    assert!(cameras.nothing_sent());
}

// One poll of the deck asks for every display at once: the page's texts are
// read once and kept a moment. A key of the deck forgets them, so its own
// displays follow at once; a change from the screen shows at the next poll.
#[test]
fn a_pages_displays_are_read_once_for_a_poll_and_follow_the_decks_own_keys_at_once() {
    let cameras = TestCameras::set_up("bridge-cameras-kept");
    assert_eq!(display(cameras.path(), "camera_state_selected"), "1");
    assert_eq!(display(cameras.path(), "camera_strip_1"), "ISO\\n400");

    cameras.call("cameras.select", json!({ "camera": 2 }));
    assert_eq!(
        display(cameras.path(), "camera_state_selected"),
        "1",
        "kept: the same poll"
    );
    thread::sleep(Duration::from_millis(300));
    assert_eq!(display(cameras.path(), "camera_state_selected"), "2");
    assert_eq!(display(cameras.path(), "camera_strip_1"), "ISO\\n800");

    key(
        cameras.path(),
        CAMERA_ROUTE,
        json!({ "action": "select", "value": "3" }),
    );
    assert_eq!(display(cameras.path(), "camera_state_selected"), "3");
    assert_eq!(display(cameras.path(), "camera_strip_1"), "ISO\\n1600");

    // A display the page does not have is refused, as any other.
    for key in ["camera_strip_5", "camera_key_4", "prompter_size", "camera_"] {
        let error =
            read_control_surface_lcd_text(cameras.path(), key).expect_err("no such display");
        assert!(
            matches!(error, ControlSurfaceError::InvalidParams(_)),
            "{key}"
        );
        assert_eq!(error.message(), format!("Unsupported LCD key: {key}"));
    }
}

#[test]
fn a_prompter_key_is_answered_said_and_stamped() {
    let prompter = TestPrompter::new("bridge-prompter-key");
    let script = prompter.script("Talk", &["one two three four", "five six seven eight"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(2, 100.0);
    assert_eq!(display(prompter.path(), "prompter_state_play"), "ready");
    said();

    let answer = key(
        prompter.path(),
        PROMPTER_ROUTE,
        json!({ "action": "playPause" }),
    );
    assert_eq!(answer, json!({ "ok": true, "did": "played" }));
    let events = said();
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].0, "prompter.changed");
    assert_eq!(events[0].1["reason"], "played");
    assert!(
        events[0].1["anchor"].is_object(),
        "the views hear where the text is: {}",
        events[0].1
    );
    // The key's own display follows at once.
    assert_eq!(display(prompter.path(), "prompter_state_play"), "playing");

    let answer = key(
        prompter.path(),
        PROMPTER_ROUTE,
        json!({ "action": "speed", "value": "up" }),
    );
    assert_eq!(
        answer,
        json!({ "ok": true, "did": "speed", "speedWpm": 145 })
    );
    assert_eq!(display(prompter.path(), "prompter_speed"), "SPEED\\n145");
    let last = control_surface_last_event(prompter.path());
    assert_eq!(last["route"], PROMPTER_ROUTE);
    assert_eq!(last["action"], "speed");
    assert_eq!(last["value"], "up");

    // A take's controls are no rows, from the deck as from the screen.
    assert!(rows(prompter.path())
        .iter()
        .all(|(source, _, _, _)| source != "deck"));

    assert_eq!(
        refused(
            prompter.path(),
            PROMPTER_ROUTE,
            json!({ "action": "cue", "value": "next" })
        ),
        (409, String::from("There is no cue after the reading line."))
    );
}
