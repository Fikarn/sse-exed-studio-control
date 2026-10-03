//! The PROMPTER and CAMERAS pages through the bridge's two entry points: a
//! key's answer, what the screen hears and when, the row in Recent actions,
//! the last event Setup's Verify step reads, and the displays' short memory.
//!
//! The CAMERAS page's tests give the moment of every press and of every
//! display themselves (`*_at`), so none of them counts real time. The
//! prompter reads its own clock.

use super::{handle_page_action, keys_on_their_way, CAMERA_ROUTE, PROMPTER_ROUTE, TEXTS_KEPT_FOR};
use crate::cameras::deck::{CAMERA_LCD_KEYS, STOP_ARM_DWELL};
use crate::cameras::model::Setting;
use crate::cameras::runtime::with_bodies_unnoticed;
use crate::cameras::simulated::CameraValue;
use crate::cameras::test_support::TestCameras;
use crate::control_surface::{
    control_surface_last_event, deck_key_stamped, handle_control_surface_http_action,
    handle_control_surface_http_action_at, read_control_surface_lcd_text,
    read_control_surface_lcd_text_at, ControlSurfaceError, KeyEvent,
};
use crate::engine_events::EMITTED;
use crate::prompter::deck::PROMPTER_LCD_KEYS;
use crate::prompter::test_support::{hold_the_write_lock, TestPrompter};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant};

fn key(db_path: &Path, route: &str, body: Value) -> Value {
    handle_control_surface_http_action(db_path, route, &body)
        .unwrap_or_else(|error| panic!("{body} should succeed: {}", error.message()))
}

fn key_at(db_path: &Path, route: &str, body: Value, at: Instant) -> Value {
    handle_control_surface_http_action_at(db_path, route, &body, at)
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

fn display_at(db_path: &Path, key: &str, at: Instant) -> String {
    read_control_surface_lcd_text_at(db_path, key, at)
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

/// A take, and the Cameras lamp, which says whether CAM 1 records.
fn a_take_changed() -> Vec<(String, Value)> {
    vec![
        (
            String::from("cameras.changed"),
            json!({ "reason": "record", "camera": 1 }),
        ),
        (String::from("app.changed"), json!({ "reason": "health" })),
    ]
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
// sentence the screen's row carries. The armed stop changed nothing, and
// neither did a press that arrived twice.
#[test]
fn the_decks_rec_leaves_rows_with_the_deck_as_their_source() {
    let cameras = TestCameras::set_up("bridge-cameras-rec");
    let start = Instant::now();
    let rec = |at: Instant| key_at(cameras.path(), CAMERA_ROUTE, json!({ "action": "rec" }), at);
    // `REC`'s word, over the take's length, and its state.
    let rec_key = |at: Instant| {
        let text = display_at(cameras.path(), "camera_key_rec", at);
        (
            text.split("\\n").next().unwrap_or_default().to_string(),
            display_at(cameras.path(), "camera_state_rec", at),
        )
    };
    let soon = Duration::from_millis(100);

    assert_eq!(rec(start)["did"], "started");
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

    // The same press again, as a key that bounces sends it: no row, nothing
    // said, nothing armed.
    said();
    let again = rec(start + soon);
    assert_eq!(again["did"], "kept");
    assert_eq!(again["recording"], true);
    assert_eq!(rows(cameras.path()).len(), 1);
    assert_eq!(said(), Vec::new());
    assert_eq!(
        rec_key(start + soon),
        (String::from("REC"), String::from("recording"))
    );

    let armed_at = start + STOP_ARM_DWELL;
    assert_eq!(rec(armed_at)["did"], "armed");
    assert_eq!(rows(cameras.path()).len(), 1, "the armed stop is no row");
    assert_eq!(said(), Vec::new(), "and changed nothing the screen shows");
    assert_eq!(
        rec_key(armed_at + soon),
        (String::from("STOP?"), String::from("armed"))
    );

    let stopped_at = armed_at + STOP_ARM_DWELL;
    assert_eq!(rec(stopped_at)["did"], "stopped");
    assert_eq!(said(), a_take_changed());
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
    assert_eq!(
        rec_key(stopped_at + soon),
        (String::from("REC"), String::from("ready"))
    );

    // The stop's own double press starts no take.
    assert_eq!(rec(stopped_at + soon)["did"], "kept");
    assert_eq!(rows(cameras.path()).len(), 2);
    assert_eq!(said(), Vec::new());
    assert_eq!(cameras.camera(1)["recording"]["recording"], false);
    assert_eq!(cameras.sent(1).len(), 2);
}

// The screen hears of a key once the key is stamped and its row written: a
// page that reads on the event finds the row. The bridge's entry point is two
// steps in that order: the key is acted on, stamped and written, and says
// which events are due (`deck_key_stamped`, which raises none); then they
// are raised.
#[test]
fn a_key_is_stamped_and_written_before_the_screen_hears_of_it() {
    let cameras = TestCameras::set_up("bridge-cameras-events");
    let start = Instant::now();
    let rec = json!({ "action": "rec" });
    said();

    let (answer, events) = deck_key_stamped(cameras.path(), true, CAMERA_ROUTE, &rec, start);
    assert_eq!(answer.expect("REC should be taken")["did"], "started");
    assert_eq!(
        events,
        vec![
            KeyEvent::Page(
                "cameras.changed",
                json!({ "reason": "record", "camera": 1 })
            ),
            KeyEvent::Page("app.changed", json!({ "reason": "health" })),
        ]
    );
    // Stamped and written, and nothing said yet.
    assert_eq!(control_surface_last_event(cameras.path())["action"], "rec");
    assert_eq!(rows(cameras.path())[0].2, "recording-started");
    assert_eq!(cameras.snapshot()["recent"][0]["source"], "deck");
    assert_eq!(said(), Vec::new());

    // The entry point raises what the first step said is due.
    let rec_at = |at: Instant| key_at(cameras.path(), CAMERA_ROUTE, rec.clone(), at);
    assert_eq!(rec_at(start + STOP_ARM_DWELL)["did"], "armed");
    assert_eq!(said(), Vec::new());
    assert_eq!(rec_at(start + STOP_ARM_DWELL * 2)["did"], "stopped");
    assert_eq!(said(), a_take_changed());
    assert_eq!(rows(cameras.path())[0].2, "recording-stopped");

    // A key that is refused is no event, no stamp and no row.
    let stamped = control_surface_last_event(cameras.path());
    let (answer, events) = deck_key_stamped(
        cameras.path(),
        true,
        CAMERA_ROUTE,
        &json!({ "action": "dialPush", "value": "2" }),
        start + Duration::from_secs(10),
    );
    assert_eq!(answer.expect_err("refused").status_code(), 409);
    assert_eq!(events, Vec::new());
    assert_eq!(control_surface_last_event(cameras.path()), stamped);
    assert_eq!(rows(cameras.path()).len(), 2);

    // The page's own entry point says the events and raises none.
    let prompter = TestPrompter::new("bridge-prompter-events");
    let script = prompter.script("Talk", &["one two three four"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(2, 100.0);
    said();
    let page = handle_page_action(
        prompter.path(),
        true,
        PROMPTER_ROUTE,
        "playPause",
        None,
        Instant::now(),
    )
    .expect("the PROMPTER page's route")
    .expect("PLAY should be taken");
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].0, "prompter.changed");
    assert_eq!(page.events[0].1["reason"], "played");
    assert_eq!(said(), Vec::new());

    // A route of another page is not this module's.
    assert!(handle_page_action(
        prompter.path(),
        true,
        "/api/deck/light-action",
        "allOn",
        None,
        Instant::now()
    )
    .is_none());
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
// read once and kept a moment. A key of the deck puts its own in their
// place, so its displays follow at once; a change from the screen shows at
// the next poll.
#[test]
fn a_pages_displays_are_read_once_for_a_poll_and_follow_the_decks_own_keys_at_once() {
    let cameras = TestCameras::set_up("bridge-cameras-kept");
    let poll = Instant::now();
    let within = poll + TEXTS_KEPT_FOR - Duration::from_millis(1);
    assert_eq!(
        display_at(cameras.path(), "camera_state_selected", poll),
        "1"
    );
    assert_eq!(
        display_at(cameras.path(), "camera_strip_1", poll),
        "ISO\\n400"
    );

    cameras.call("cameras.select", json!({ "camera": 2 }));
    assert_eq!(
        display_at(cameras.path(), "camera_state_selected", within),
        "1",
        "kept: the same poll"
    );
    let next_poll = poll + TEXTS_KEPT_FOR;
    assert_eq!(
        display_at(cameras.path(), "camera_state_selected", next_poll),
        "2"
    );
    assert_eq!(
        display_at(cameras.path(), "camera_strip_1", next_poll),
        "ISO\\n800"
    );

    let pressed = next_poll + Duration::from_millis(10);
    key_at(
        cameras.path(),
        CAMERA_ROUTE,
        json!({ "action": "select", "value": "3" }),
        pressed,
    );
    assert_eq!(
        display_at(cameras.path(), "camera_state_selected", pressed),
        "3"
    );
    assert_eq!(
        display_at(cameras.path(), "camera_strip_1", pressed),
        "ISO\\n1600"
    );

    // A display the page does not have is refused, as any other.
    for key in ["camera_strip_5", "camera_key_4", "prompter_name", "camera_"] {
        let error =
            read_control_surface_lcd_text(cameras.path(), key).expect_err("no such display");
        assert!(
            matches!(error, ControlSurfaceError::InvalidParams(_)),
            "{key}"
        );
        assert_eq!(error.message(), format!("Unsupported LCD key: {key}"));
    }
}

// D12: a display never reads a camera by itself. One poll of the deck reads
// the cameras once, however many displays it asks for; a key reads them
// once, and its own read answers its displays. The body's ISO is changed
// where nobody notices: a display that read the cameras would say it.
#[test]
fn a_poll_reads_the_cameras_once_and_a_key_answers_its_own_displays() {
    let cameras = TestCameras::set_up("bridge-cameras-reads");
    let body_sets_iso = |iso: &str| {
        with_bodies_unnoticed(cameras.path(), |bodies| {
            bodies.body_sets(1, Setting::Iso, CameraValue::Text(String::from(iso)));
        });
    };
    let iso = |at: Instant| display_at(cameras.path(), "camera_strip_1", at);
    let poll = Instant::now();
    let within = Duration::from_millis(200);
    let next = TEXTS_KEPT_FOR;

    // The poll's first display reads the cameras; the rest of it reads none.
    assert_eq!(
        display_at(cameras.path(), "camera_key_1", poll),
        "CAM 1\\nHELD"
    );
    body_sets_iso("3200");
    for key in CAMERA_LCD_KEYS {
        display_at(cameras.path(), key, poll + within);
    }
    assert_eq!(iso(poll + within), "ISO\\n400");
    // The next poll reads them again.
    let poll = poll + next;
    assert_eq!(iso(poll), "ISO\\n3200");

    // A key reads the cameras, once, and says what its displays read.
    body_sets_iso("800");
    let pressed = poll + next;
    key_at(
        cameras.path(),
        CAMERA_ROUTE,
        json!({ "action": "select", "value": "1" }),
        pressed,
    );
    body_sets_iso("1600");
    assert_eq!(iso(pressed + within), "ISO\\n800");
    assert_eq!(
        display_at(cameras.path(), "camera_state_selected", pressed + within),
        "1"
    );

    // A key that is refused leaves the displays to be read again.
    let poll = pressed + next;
    assert_eq!(iso(poll), "ISO\\n1600");
    body_sets_iso("2000");
    let answer = handle_control_surface_http_action_at(
        cameras.path(),
        CAMERA_ROUTE,
        &json!({ "action": "dialPush", "value": "2" }),
        poll + Duration::from_millis(10),
    );
    assert_eq!(
        answer
            .expect_err("a push of dial 2 does nothing")
            .status_code(),
        409
    );
    assert_eq!(iso(poll + within), "ISO\\n2000");
    assert!(cameras.nothing_sent(), "a read sends nothing");
}

// 2026-10-02: a PROMPTER display that waited for the prompter held a worker
// of the bridge with it. The displays read the frame the prompter publishes,
// so every one is answered while another thread holds the prompter.
#[test]
fn a_prompter_display_is_answered_while_the_prompter_is_held() {
    let prompter = TestPrompter::new("bridge-prompter-held");
    let script = prompter.script("Held", &["one two three four"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(display(prompter.path(), "prompter_state_on"), "yes");

    let path = prompter.path().to_path_buf();
    let (held, holding) = std::sync::mpsc::channel();
    let holder = std::thread::spawn(move || {
        crate::prompter::runtime::with_prompter(&path, "test", |_, _| {
            held.send(()).expect("the test waits");
            std::thread::sleep(Duration::from_millis(500));
            Ok(())
        })
        .expect("the prompter is held");
    });
    holding.recv().expect("the prompter is held");
    let started = Instant::now();
    for key in PROMPTER_LCD_KEYS {
        display(prompter.path(), key);
    }
    let took = started.elapsed();
    holder.join().expect("the holder lets go");
    assert!(
        took < Duration::from_millis(250),
        "the six displays took {took:?} behind a held prompter"
    );
}

// The afternoon of 2026-10-02: a turn of the speed dial waited for the disk
// three times before the glass heard of it. A PROMPTER key and the poll after
// it wait for none: the place and pace go to the saver, and the key's last
// event is kept in memory.
#[test]
fn a_prompter_key_and_its_displays_wait_for_no_disk() {
    let prompter = TestPrompter::with_saver("bridge-prompter-disk");
    let script = prompter.script("Disk", &["one two three four", "five six seven eight"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(2, 100.0);
    said();

    let writer = hold_the_write_lock(prompter.path(), Duration::from_millis(600));
    let started = Instant::now();
    let answer = key(
        prompter.path(),
        PROMPTER_ROUTE,
        json!({ "action": "speed", "value": "up" }),
    );
    for key in PROMPTER_LCD_KEYS {
        display(prompter.path(), key);
    }
    let took = started.elapsed();
    writer.join().expect("the writer lets go");
    assert!(
        took < Duration::from_millis(300),
        "a detent and a poll took {took:?} behind a held disk"
    );
    assert_eq!(answer["speedWpm"], 145);
    assert_eq!(said()[0].0, "prompter.changed");

    // The last event is the PROMPTER key's, from memory; a later key that is
    // written shows instead.
    let kept = control_surface_last_event(prompter.path());
    assert_eq!(kept["route"], PROMPTER_ROUTE);
    assert_eq!(kept["action"], "speed");
    let later = json!({
        "route": "/api/deck/light-action",
        "action": "allOff",
        "value": null,
        "at": kept["at"].as_u64().expect("an at") + 1,
    });
    crate::storage::set_settings_owned(
        prompter.path(),
        &[(
            String::from("app.control_surface.last_event"),
            later.to_string(),
        )],
    )
    .expect("a saved last event");
    // Written behind the bridge's back, it is older than the kept key.
    assert_eq!(control_surface_last_event(prompter.path()), kept);
}

// The last event is the key that came last, whichever page it was on: a key
// that is written, then a PROMPTER key kept in memory, then a written one
// again (the review of #288: the wall clock told them apart, and Windows may
// set it back).
#[test]
fn the_last_event_is_the_key_that_came_last() {
    let cameras = TestCameras::set_up("bridge-last-event");
    let request = |method: &str, params: Value| {
        crate::prompter::handle_prompter_request(cameras.path(), method, &params)
            .unwrap_or_else(|error| panic!("{method} should succeed: {error:?}"))
            .result
    };
    let script = request("prompter.script.create", json!({ "name": "Order" }))["scriptId"]
        .as_str()
        .expect("an id")
        .to_string();
    request("prompter.putOn", json!({ "scriptId": script }));

    key(cameras.path(), CAMERA_ROUTE, json!({ "action": "rec" }));
    assert_eq!(control_surface_last_event(cameras.path())["action"], "rec");
    key(
        cameras.path(),
        PROMPTER_ROUTE,
        json!({ "action": "speed", "value": "up" }),
    );
    assert_eq!(
        control_surface_last_event(cameras.path())["action"],
        "speed"
    );
    key(
        cameras.path(),
        CAMERA_ROUTE,
        json!({ "action": "select", "value": "2" }),
    );
    assert_eq!(
        control_surface_last_event(cameras.path())["action"],
        "select"
    );
    key(
        cameras.path(),
        PROMPTER_ROUTE,
        json!({ "action": "speed", "value": "down" }),
    );
    let last = control_surface_last_event(cameras.path());
    assert_eq!(
        (last["action"].clone(), last["value"].clone()),
        (json!("speed"), json!("down"))
    );
}

// Companion asks for a dial's displays as it sends the detent: a display
// asked for while the key is on its way waits for it, and says what the key
// did (the review of #288). The test waits until the key is on its way,
// held at the prompter's lock, and lets it go just as the display is asked.
// Its save goes to the saver's thread, as in the live app: written inline it
// waited for the disk under the lock, up to 377 ms while the other tests
// wrote (2026-10-02).
#[test]
fn a_prompter_display_asked_for_during_a_key_follows_the_key() {
    let prompter = TestPrompter::with_saver("bridge-prompter-on-its-way");
    let script = prompter.script("Way", &["one two three four"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(display(prompter.path(), "prompter_speed"), "SPEED\\n140");

    let path = prompter.path().to_path_buf();
    let (held, holding) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel::<()>();
    let holder = std::thread::spawn(move || {
        crate::prompter::runtime::with_prompter(&path, "test", |_, _| {
            held.send(()).expect("the test waits");
            released
                .recv_timeout(Duration::from_secs(10))
                .expect("the test lets go");
            // Long enough for the display below to be asked, well inside
            // the display's wait for the key.
            std::thread::sleep(Duration::from_millis(10));
            Ok(())
        })
        .expect("the prompter is held");
    });
    holding.recv().expect("the prompter is held");
    let path = prompter.path().to_path_buf();
    let detent = std::thread::spawn(move || {
        key(
            &path,
            PROMPTER_ROUTE,
            json!({ "action": "speed", "value": "up" }),
        )
    });
    let until = Instant::now() + Duration::from_secs(10);
    while keys_on_their_way()
        .count
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(prompter.path())
        .is_none_or(|on_their_way| *on_their_way == 0)
    {
        assert!(Instant::now() < until, "the key is on its way");
        std::thread::sleep(Duration::from_millis(1));
    }
    release.send(()).expect("the holder waits");
    assert_eq!(display(prompter.path(), "prompter_speed"), "SPEED\\n145");
    assert_eq!(detent.join().expect("the detent")["speedWpm"], 145);
    holder.join().expect("the holder lets go");
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

    // With nothing on the prompter the size dial is refused as every other
    // control, and saves nothing.
    prompter.call("prompter.clear", json!({ "confirm": true }));
    assert_eq!(
        refused(
            prompter.path(),
            PROMPTER_ROUTE,
            json!({ "action": "size", "value": "up" })
        ),
        (
            409,
            String::from("Nothing is on the prompter. Put a script on first.")
        )
    );
}

// `PLAY` switches at one press, and a press that arrives twice within the
// dwell (a bounce, a double press) is one press: it sends nothing, says
// nothing and changes nothing (the owner's decision, 2026-09-28). The speed
// dial's push posts the same, and is the same press.
#[test]
fn play_drops_a_second_press_within_the_dwell() {
    let prompter = TestPrompter::new("bridge-play-dwell");
    let script = prompter.script("Talk", &["one two three four", "five six seven eight"]);
    prompter.call("prompter.putOn", json!({ "scriptId": script }));
    prompter.lay_out(2, 100.0);
    said();
    let start = Instant::now();
    let play = |at: Instant| {
        key_at(
            prompter.path(),
            PROMPTER_ROUTE,
            json!({ "action": "playPause" }),
            at,
        )
    };

    assert_eq!(play(start), json!({ "ok": true, "did": "played" }));
    assert_eq!(said().len(), 1);
    assert_eq!(
        play(start + Duration::from_millis(150)),
        json!({ "ok": true, "did": "kept" })
    );
    assert!(said().is_empty(), "the same press says nothing");
    assert_eq!(display(prompter.path(), "prompter_state_play"), "playing");

    // After the dwell a press is a press of its own.
    assert_eq!(
        play(start + Duration::from_millis(500)),
        json!({ "ok": true, "did": "paused" })
    );
    assert_ne!(display(prompter.path(), "prompter_state_play"), "playing");
}
