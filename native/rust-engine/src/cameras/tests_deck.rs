//! The Stream Deck's CAMERAS page (D14): its keys, its dials and its displays,
//! against the simulated cameras.

use crate::cameras::deck::{
    deck_texts, deck_texts_at, handle_deck_action, handle_deck_action_at, take_length_text,
    CAMERA_LCD_KEYS, STOP_ARM_DWELL, STOP_ARM_WINDOW, STOP_SHOWN_FOR,
};
use crate::cameras::model::Setting;
use crate::cameras::simulated::{CameraCommand, CameraValue};
use crate::cameras::test_support::{
    announced_changes, assert_operator_words, take_announced, TestCameras,
};
use crate::cameras::CameraError;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// A key or a dial that must do something; its answer.
fn press(cameras: &TestCameras, action: &str, value: Option<&str>) -> Value {
    handle_deck_action(cameras.path(), cameras.simulated, action, value)
        .unwrap_or_else(|error| panic!("{action} {value:?} should succeed: {error:?}"))
        .0
        .result
}

/// A key or a dial that must be refused; its code and sentence.
fn refused(cameras: &TestCameras, action: &str, value: Option<&str>) -> (String, String) {
    match handle_deck_action(cameras.path(), cameras.simulated, action, value) {
        Ok((reply, _)) => panic!(
            "{action} {value:?} should be refused, answered {}",
            reply.result
        ),
        Err(CameraError::Refused(code, sentence)) => (code.to_string(), sentence),
        Err(CameraError::Invalid(sentence)) => (String::from("INVALID_PARAMS"), sentence),
        Err(CameraError::Storage(message)) => (String::from("STORAGE_ERROR"), message),
    }
}

/// The displays, as a poll of the deck reads them.
fn displays(cameras: &TestCameras) -> HashMap<&'static str, String> {
    deck_texts(cameras.path(), cameras.simulated)
        .expect("the displays read")
        .into_iter()
        .collect()
}

/// `REC` at a moment of the test's: what the press did.
fn rec_at(cameras: &TestCameras, at: Instant) -> Value {
    handle_deck_action_at(cameras.path(), cameras.simulated, "rec", None, at)
        .expect("REC should be taken")
        .0
        .result["did"]
        .clone()
}

/// What the `REC` key reads at a moment of the test's, and the word its
/// colour follows.
/// `REC`'s word (`REC` or `STOP?`, above the take's length) and its state.
fn rec_key_at(cameras: &TestCameras, at: Instant) -> (String, String) {
    let texts: HashMap<&'static str, String> = deck_texts_at(cameras.path(), cameras.simulated, at)
        .expect("the displays read")
        .into_iter()
        .collect();
    let word = texts["camera_key_rec"]
        .split("\\n")
        .next()
        .unwrap_or_default()
        .to_string();
    (word, texts["camera_state_rec"].clone())
}

fn strip(cameras: &TestCameras) -> [String; 4] {
    let displays = displays(cameras);
    [1, 2, 3, 4].map(|cell| displays[format!("camera_strip_{cell}").as_str()].clone())
}

#[test]
fn every_display_of_the_page_has_a_text() {
    let cameras = TestCameras::set_up("deck-displays");
    let displays = displays(&cameras);
    assert_eq!(displays.len(), CAMERA_LCD_KEYS.len());
    for key in CAMERA_LCD_KEYS {
        assert!(displays.contains_key(key), "{key}");
    }
    assert_eq!(displays["camera_key_1"], "CAM 1\\nHELD");
    assert_eq!(displays["camera_key_3"], "CAM 3\\nHELD");
    assert_eq!(displays["camera_key_bank"], "BANK\\nEXPOSURE");
    assert_eq!(displays["camera_key_rec"], "REC");
    assert_eq!(displays["camera_state_selected"], "1");
    assert_eq!(displays["camera_state_rec"], "ready");
    assert_eq!(displays["camera_state_dials"], "live");
    assert_eq!(
        strip(&cameras),
        [
            "ISO\\n400",
            "SHUTTER\\n180°",
            "IRIS\\nf/2.8",
            "ND\\n2 stops"
        ]
    );
}

// New saved data holds no camera: the page still answers every display, and
// says that nothing is set up. Nothing reaches a camera.
#[test]
fn with_no_camera_set_up_the_displays_say_so_and_every_control_is_refused() {
    let cameras = TestCameras::new("deck-not-set-up");
    let displays = displays(&cameras);
    assert_eq!(displays["camera_key_1"], "CAM 1\\nNOT SET UP");
    assert_eq!(displays["camera_state_rec"], "locked");
    assert_eq!(displays["camera_state_dials"], "locked");
    assert_eq!(
        strip(&cameras),
        ["ISO\\n--", "SHUTTER\\n--", "IRIS\\n--", "ND\\n--"]
    );

    assert_eq!(refused(&cameras, "rec", None).0, "CAMERA_NOT_SET_UP");
    assert_eq!(
        refused(&cameras, "dial", Some("1:up")).0,
        "CAMERA_NOT_SET_UP"
    );
    // A camera that is not set up can be selected, as on the screen, and the
    // bank can be turned.
    assert_eq!(press(&cameras, "select", Some("2"))["selected"], 2);
    assert_eq!(press(&cameras, "bank", None)["bank"], "colour");
    assert!(cameras.nothing_sent());
}

// D19: one selection, the page's. The deck's key sets it, and says so as
// the screen's request does.
#[test]
fn a_camera_key_selects_the_pages_camera() {
    let cameras = TestCameras::set_up("deck-select");
    let (reply, texts) =
        handle_deck_action(cameras.path(), cameras.simulated, "select", Some("3")).expect("select");
    assert_eq!(reply.result, json!({ "selected": 3 }));
    assert_eq!(reply.event, Some(("select", Some(3))));
    assert_eq!(cameras.snapshot()["selected"], 3);
    // The key says what the displays read after it, from its own read.
    let texts: HashMap<&'static str, String> = texts.into_iter().collect();
    assert_eq!(texts.len(), CAMERA_LCD_KEYS.len());
    assert_eq!(texts["camera_state_selected"], "3");
    assert_eq!(texts["camera_strip_1"], "ISO\\n1600");
    assert_eq!(displays(&cameras)["camera_state_selected"], "3");
    assert_eq!(
        strip(&cameras),
        ["ISO\\n1600", "SHUTTER\\n1/50", "IRIS\\nf/2.8", "ND\\n--"],
        "the strip follows the selection; a BGH1 has no ND"
    );

    // The screen's selection is the deck's.
    cameras.call("cameras.select", json!({ "camera": 2 }));
    assert_eq!(displays(&cameras)["camera_state_selected"], "2");

    for value in [None, Some("0"), Some("4"), Some("one")] {
        assert_eq!(
            refused(&cameras, "select", value).0,
            "INVALID_PARAMS",
            "{value:?}"
        );
    }
    assert!(cameras.nothing_sent(), "a selection reaches no camera");
}

// D14: BANK puts the dials on exposure, colour and focus in turn. The page
// reads the bank in `cameras.snapshot` and sets it with `cameras.bank.set`.
#[test]
fn the_bank_goes_round_and_the_page_reads_and_sets_it() {
    let cameras = TestCameras::set_up("deck-bank");
    assert_eq!(
        cameras.snapshot()["dials"],
        json!({ "bank": "exposure", "sets": ["iso", "shutter", "iris", "nd"] })
    );

    let (reply, _) =
        handle_deck_action(cameras.path(), cameras.simulated, "bank", None).expect("bank");
    assert_eq!(reply.event, Some(("bank", None)));
    assert_eq!(reply.result["bank"], "colour");
    assert_eq!(
        cameras.snapshot()["dials"],
        json!({ "bank": "colour", "sets": ["whiteBalance", "tint", null, null] })
    );
    assert_eq!(displays(&cameras)["camera_key_bank"], "BANK\\nCOLOUR");
    assert_eq!(strip(&cameras), ["WB\\n5600 K", "TINT\\n+2", "", ""]);

    assert_eq!(press(&cameras, "bank", None)["bank"], "focus");
    assert_eq!(
        cameras.snapshot()["dials"]["sets"],
        json!(["focus", null, null, null])
    );
    assert_eq!(strip(&cameras), ["FOCUS\\n0.62", "", "", ""]);
    assert_eq!(press(&cameras, "bank", None)["bank"], "exposure");

    // From the page.
    let reply = cameras
        .reply("cameras.bank.set", json!({ "bank": "focus" }))
        .expect("the page's key");
    assert_eq!(reply.event, Some(("bank", None)));
    assert_eq!(
        reply.result,
        json!({ "bank": "focus", "dials": { "bank": "focus", "sets": ["focus", null, null, null] } })
    );
    assert_eq!(displays(&cameras)["camera_key_bank"], "BANK\\nFOCUS");
    for bank in [json!("iris"), json!(""), json!(2), Value::Null] {
        assert_eq!(
            cameras.refused("cameras.bank.set", json!({ "bank": bank })),
            (
                String::from("INVALID_PARAMS"),
                String::from("bank must be exposure, colour or focus.")
            )
        );
    }

    // A start puts the dials on exposure, as it selects CAM 1.
    cameras.restart();
    assert_eq!(cameras.snapshot()["dials"]["bank"], "exposure");
    assert!(cameras.nothing_sent(), "the bank reaches no camera");
}

// A detent is one of the camera's own steps on the selected camera, through
// the request the screen's steppers send.
#[test]
fn a_dial_steps_what_the_bank_gives_it_on_the_selected_camera() {
    let cameras = TestCameras::set_up("deck-dials");
    let (reply, _) = handle_deck_action(cameras.path(), cameras.simulated, "dial", Some("1:up"))
        .expect("a detent");
    assert_eq!(
        reply.result,
        json!({ "camera": 1, "setting": "iso", "value": "500" })
    );
    assert_eq!(reply.event, Some(("setting", Some(1))));
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::Set(
            Setting::Iso,
            CameraValue::Text(String::from("500"))
        )]
    );
    assert_eq!(press(&cameras, "dial", Some("2:down"))["value"], "172.8°");
    assert_eq!(press(&cameras, "dial", Some("3:up"))["value"], "f/3.2");
    assert_eq!(press(&cameras, "dial", Some("4:down"))["value"], "Clear");
    assert_eq!(
        strip(&cameras),
        [
            "ISO\\n500",
            "SHUTTER\\n172.8°",
            "IRIS\\nf/3.2",
            "ND\\nClear"
        ]
    );

    // The selected camera, and no other.
    press(&cameras, "select", Some("2"));
    assert_eq!(
        press(&cameras, "dial", Some("1:down")),
        json!({ "camera": 2, "setting": "iso", "value": "640" })
    );
    assert_eq!(cameras.sent(1).len(), 4);
    assert_eq!(cameras.sent(3), Vec::new());
    // What a camera does not report is refused in its own words.
    let (code, sentence) = refused(&cameras, "dial", Some("4:up"));
    assert_eq!(code, "CAMERA_SETTING_UNSUPPORTED");
    assert_eq!(sentence, "The BGH1 has no ND filter.");

    press(&cameras, "bank", None);
    assert_eq!(press(&cameras, "dial", Some("1:up"))["value"], 5700.0);
    let (code, sentence) = refused(&cameras, "dial", Some("3:up"));
    assert_eq!(code, "CAMERA_DIAL_UNUSED");
    assert_eq!(
        sentence,
        "Dial 3 sets nothing while the dials set the colour."
    );
    assert_operator_words(&sentence);

    for value in [
        None,
        Some("1"),
        Some("5:up"),
        Some("0:up"),
        Some("1:left"),
        Some("up"),
    ] {
        assert_eq!(
            refused(&cameras, "dial", value).0,
            "INVALID_PARAMS",
            "{value:?}"
        );
    }
}

// D14: a push of the focus dial is a one-shot autofocus where the lens
// allows; every other push does nothing, and says so.
#[test]
fn a_push_is_autofocus_on_the_focus_bank_and_nothing_elsewhere() {
    let cameras = TestCameras::set_up("deck-push");
    let (code, sentence) = refused(&cameras, "dialPush", Some("1"));
    assert_eq!(code, "CAMERA_DIAL_UNUSED");
    assert_eq!(
        sentence,
        "A push of dial 1 does nothing while the dials set the exposure."
    );
    assert!(cameras.nothing_sent());

    press(&cameras, "bank", None);
    press(&cameras, "bank", None);
    assert_eq!(
        press(&cameras, "dialPush", Some("1")),
        json!({ "camera": 1, "setting": "focus", "value": 0.5 })
    );
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::Auto(crate::cameras::model::AutoKind::Focus)]
    );
    assert_eq!(
        refused(&cameras, "dialPush", Some("2")).0,
        "CAMERA_DIAL_UNUSED"
    );
    assert_eq!(refused(&cameras, "dialPush", Some("5")).0, "INVALID_PARAMS");

    // A BGH1 moves nearer and farther, without a position to show.
    press(&cameras, "select", Some("2"));
    assert_eq!(strip(&cameras)[0], "FOCUS\\nNEAR · FAR");
    press(&cameras, "dial", Some("1:up"));
    assert_eq!(cameras.sent(2), vec![CameraCommand::FocusSteps(1)]);
}

// D14: REC always acts on CAM 1. One press starts. While CAM 1 records, a
// press arms the stop (`STOP?`), and a second within 3 s stops; a second
// press inside the dwell is a bounce, and changes nothing.
#[test]
fn rec_starts_at_one_press_and_stops_at_two_within_three_seconds() {
    let cameras = TestCameras::set_up("deck-rec");
    let act = |at: Instant| {
        handle_deck_action_at(cameras.path(), cameras.simulated, "rec", None, at)
            .expect("REC should be taken")
            .0
    };
    let rec = |at: Instant| rec_key_at(&cameras, at);
    // Whichever camera is selected.
    press(&cameras, "select", Some("3"));
    let start = Instant::now();

    let started = act(start);
    assert_eq!(started.result["did"], "started");
    assert_eq!(started.result["camera"], 1);
    assert_eq!(started.result["recording"], true);
    assert_eq!(started.result["sentence"], "CAM 1 started recording.");
    assert_eq!(started.event, Some(("record", Some(1))));
    assert_eq!(cameras.sent(1), vec![CameraCommand::RecordStart]);
    assert_eq!(cameras.sent(3), Vec::new());
    assert_eq!(rec(start), (String::from("REC"), String::from("recording")));

    // The first press while it records arms, and sends nothing.
    let armed_at = start + Duration::from_secs(10);
    let armed = act(armed_at);
    assert_eq!(armed.result["did"], "armed");
    assert_eq!(armed.event, None);
    assert_eq!(cameras.sent(1).len(), 1);
    assert_eq!(
        rec(armed_at),
        (String::from("STOP?"), String::from("armed"))
    );

    // Inside the dwell: a bounce.
    let bounce = act(armed_at + STOP_ARM_DWELL - Duration::from_millis(1));
    assert_eq!(bounce.result["did"], "kept");
    assert_eq!(bounce.result["recording"], true);
    assert_eq!(bounce.event, None);
    assert_eq!(cameras.sent(1).len(), 1);
    assert_eq!(cameras.camera(1)["recording"]["recording"], true);

    // Past the 3 s the arm is over: the key reads REC again, and a press arms anew.
    let late = armed_at + STOP_ARM_WINDOW + Duration::from_millis(1);
    assert_eq!(rec(late), (String::from("REC"), String::from("recording")));
    assert_eq!(act(late).result["did"], "armed");
    assert_eq!(cameras.sent(1).len(), 1);

    // The second press, after the dwell and within the 3 s, stops.
    let stopped = act(late + STOP_ARM_WINDOW);
    assert_eq!(stopped.result["did"], "stopped");
    assert_eq!(stopped.result["recording"], false);
    assert_eq!(stopped.result["sentence"], "CAM 1 stopped recording.");
    assert_eq!(stopped.event, Some(("record", Some(1))));
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::RecordStart, CameraCommand::RecordStop]
    );
    assert_eq!(
        rec(late + STOP_ARM_WINDOW),
        (String::from("REC"), String::from("ready"))
    );
}

// 2026-10-03: while CAM 1 records, `REC` shows the take's length under its
// word, counted from the start the hardware link saw as the page counts it;
// `STOP?` keeps it under; `--` when the take began before the link looked.
// Nothing is asked of a camera for it.
#[test]
fn rec_shows_the_takes_length_as_the_page_counts_it() {
    assert_eq!(take_length_text(0), "0:00");
    assert_eq!(take_length_text(59), "0:59");
    assert_eq!(take_length_text(754), "12:34");
    assert_eq!(take_length_text(3725), "1:02:05");

    let cameras = TestCameras::set_up("deck-rec-length");
    let start = Instant::now();
    assert_eq!(rec_at(&cameras, start), "started");
    let sent = cameras.sent(1);
    assert_eq!(
        deck_texts_at(cameras.path(), cameras.simulated, start)
            .expect("the displays read")
            .into_iter()
            .find(|(key, _)| *key == "camera_key_rec")
            .map(|(_, text)| text),
        Some(String::from("REC\\n0:00"))
    );
    let armed_at = start + Duration::from_secs(10);
    assert_eq!(rec_at(&cameras, armed_at), "armed");
    let armed: HashMap<&'static str, String> =
        deck_texts_at(cameras.path(), cameras.simulated, armed_at)
            .expect("the displays read")
            .into_iter()
            .collect();
    assert_eq!(armed["camera_key_rec"], "STOP?\\n0:00");
    assert_eq!(cameras.sent(1), sent, "the displays sent nothing");

    // CAM 1 lost and found again: the take began before the link looked.
    cameras.answering(1, false);
    cameras.answering(1, true);
    let found: HashMap<&'static str, String> = deck_texts_at(
        cameras.path(),
        cameras.simulated,
        armed_at + Duration::from_secs(10),
    )
    .expect("the displays read")
    .into_iter()
    .collect();
    assert_eq!(found["camera_key_rec"], "REC\\n--");
}

// A press that arrives twice is one press. Without the dwell the second of a
// double press would arm the stop of the take the first began, and the
// second of a stop's double press would begin a take after the one it ended.
#[test]
fn a_double_press_neither_arms_nor_starts_after_the_press_before_it() {
    let cameras = TestCameras::set_up("deck-rec-double");
    let start = Instant::now();
    let almost = STOP_ARM_DWELL - Duration::from_millis(1);

    assert_eq!(rec_at(&cameras, start), "started");
    assert_eq!(rec_at(&cameras, start + Duration::from_millis(100)), "kept");
    assert_eq!(rec_at(&cameras, start + almost), "kept");
    assert_eq!(
        rec_key_at(&cameras, start + almost),
        (String::from("REC"), String::from("recording")),
        "the double press armed nothing"
    );
    assert_eq!(cameras.sent(1), vec![CameraCommand::RecordStart]);

    // After the dwell the key is the operator's again.
    let armed_at = start + STOP_ARM_DWELL;
    assert_eq!(rec_at(&cameras, armed_at), "armed");
    let stopped_at = armed_at + STOP_ARM_DWELL;
    assert_eq!(rec_at(&cameras, stopped_at), "stopped");

    // The stop's own double press starts no take.
    assert_eq!(
        rec_at(&cameras, stopped_at + Duration::from_millis(100)),
        "kept"
    );
    assert_eq!(rec_at(&cameras, stopped_at + almost), "kept");
    assert_eq!(cameras.camera(1)["recording"]["recording"], false);
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::RecordStart, CameraCommand::RecordStop]
    );
    // And after the dwell one press starts the next take, as any first press.
    assert_eq!(rec_at(&cameras, stopped_at + STOP_ARM_DWELL), "started");

    // The dwell counts from the deck's own presses: a take the screen
    // started is armed by the deck's next press.
    let restarted_at = stopped_at + STOP_ARM_DWELL;
    cameras.call("cameras.record.stop", json!({ "confirm": true }));
    cameras.call("cameras.record.start", json!({}));
    assert_eq!(rec_at(&cameras, restarted_at + STOP_ARM_DWELL), "armed");
}

// The arm is about the take that was running. A take that the screen stops
// or starts ends it; so does a take that starts or stops on the camera.
#[test]
fn an_armed_stop_ends_with_the_take_it_was_about() {
    let cameras = TestCameras::set_up("deck-rec-arm-ends");
    let start = Instant::now();
    let seconds = |seconds: u64| start + Duration::from_secs(seconds);
    assert_eq!(rec_at(&cameras, start), "started");
    assert_eq!(rec_at(&cameras, seconds(1)), "armed");
    // The screen stops the take (its own two presses).
    cameras.call("cameras.record.stop", json!({ "confirm": true }));
    // A new take, from the screen: the deck's next press arms, it does not stop.
    cameras.call("cameras.record.start", json!({}));
    assert_eq!(rec_at(&cameras, seconds(2)), "armed");
    assert_eq!(
        cameras.sent(1),
        vec![
            CameraCommand::RecordStart,
            CameraCommand::RecordStop,
            CameraCommand::RecordStart
        ]
    );
}

// The take ends on the camera itself while the stop is armed (its own
// button, a full card). The press that comes within the 3 s was the stop's
// second press: it finds nothing to stop, and starts nothing.
#[test]
fn the_second_press_of_a_stop_starts_no_take_when_the_take_ended_by_itself() {
    let cameras = TestCameras::set_up("deck-rec-ended-itself");
    let start = Instant::now();
    let seconds = |seconds: u64| start + Duration::from_secs(seconds);
    assert_eq!(rec_at(&cameras, start), "started");
    assert_eq!(rec_at(&cameras, seconds(10)), "armed");

    // Nobody has read the cameras since: the press's own read finds it.
    crate::cameras::runtime::with_bodies_unnoticed(cameras.path(), |bodies| {
        bodies.body_records(1, false);
    });
    let (reply, texts) =
        handle_deck_action_at(cameras.path(), cameras.simulated, "rec", None, seconds(11))
            .expect("REC should be taken");
    assert_eq!(
        reply.result,
        json!({ "camera": 1, "recording": false, "did": "kept" })
    );
    assert_eq!(reply.event, None);
    let texts: HashMap<&'static str, String> = texts.into_iter().collect();
    assert_eq!(texts["camera_key_rec"], "REC", "no take, no length");
    assert_eq!(texts["camera_state_rec"], "ready");
    assert_eq!(cameras.sent(1), vec![CameraCommand::RecordStart]);

    // The arm ended with that press: the next one starts a take, inside
    // what were the arm's 3 s.
    assert_eq!(rec_at(&cameras, seconds(12)), "started");
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::RecordStart, CameraCommand::RecordStart]
    );
}

// An arm never stops another take than the one it was made for. Take A is
// armed; A is stopped and B started on the camera itself; the deck's press
// within A's 3 s finds a take running and the dwell long over, and would
// have stopped B with one press.
#[test]
fn an_arm_stops_no_other_take_than_its_own() {
    let cameras = TestCameras::set_up("deck-rec-stale-arm");
    let start = Instant::now();
    let at = |millis: u64| start + Duration::from_millis(millis);
    assert_eq!(rec_at(&cameras, start), "started");
    assert_eq!(rec_at(&cameras, at(10_000)), "armed");
    assert_eq!(
        rec_key_at(&cameras, at(10_100)),
        (String::from("STOP?"), String::from("armed"))
    );

    cameras.body_records(1, false);
    cameras.body_records(1, true);
    // The key says so as soon as the cameras were read.
    assert_eq!(
        rec_key_at(&cameras, at(11_000)),
        (String::from("REC"), String::from("recording"))
    );
    assert_eq!(rec_at(&cameras, at(12_000)), "kept");
    assert_eq!(cameras.camera(1)["recording"]["recording"], true);
    assert_eq!(cameras.sent(1), vec![CameraCommand::RecordStart]);

    // B is stopped as any take: a press arms, a second stops.
    assert_eq!(rec_at(&cameras, at(12_500)), "armed");
    assert_eq!(rec_at(&cameras, at(13_000)), "stopped");
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::RecordStart, CameraCommand::RecordStop]
    );
}

// The screen stops the take while the deck's stop is armed. The deck's next
// press within the 3 s was the stop's second, its key perhaps still reading
// `STOP?`: there is nothing left for it to stop, and it starts no take.
#[test]
fn the_second_press_of_a_stop_starts_no_take_when_the_screen_stopped_it() {
    let cameras = TestCameras::set_up("deck-rec-screen-stopped");
    let start = Instant::now();
    let seconds = |seconds: u64| start + Duration::from_secs(seconds);
    assert_eq!(rec_at(&cameras, start), "started");
    assert_eq!(rec_at(&cameras, seconds(10)), "armed");

    cameras.call("cameras.record.stop", json!({ "confirm": true }));
    let sent = vec![CameraCommand::RecordStart, CameraCommand::RecordStop];
    assert_eq!(cameras.sent(1), sent);
    assert_eq!(
        rec_key_at(&cameras, seconds(11)),
        (String::from("REC"), String::from("ready"))
    );
    assert_eq!(rec_at(&cameras, seconds(11)), "kept");
    assert_eq!(cameras.sent(1), sent, "nothing was sent");
    assert_eq!(cameras.camera(1)["recording"]["recording"], false);

    // The arm ended with that press: the next one starts a take.
    assert_eq!(rec_at(&cameras, seconds(12)), "started");
}

// The key's display follows the deck's poll, so it can read `STOP?` for a
// moment after the 3 s. For as long as it can, a press starts no take; the
// stop's own window stays 3 s.
#[test]
fn a_press_starts_no_take_while_the_key_can_still_read_stop() {
    let cameras = TestCameras::set_up("deck-rec-stale-stop");
    let start = Instant::now();
    assert_eq!(rec_at(&cameras, start), "started");
    let armed_at = start + Duration::from_secs(10);
    assert_eq!(rec_at(&cameras, armed_at), "armed");
    cameras.body_records(1, false);

    assert_eq!(rec_at(&cameras, armed_at + STOP_SHOWN_FOR), "kept");
    assert_eq!(cameras.sent(1), vec![CameraCommand::RecordStart]);
    // That press ended the arm.
    assert_eq!(
        rec_at(
            &cameras,
            armed_at + STOP_SHOWN_FOR + Duration::from_millis(1)
        ),
        "started"
    );

    // Once the key cannot read `STOP?` any more, one press starts, as ever.
    let armed_at = armed_at + Duration::from_secs(20);
    assert_eq!(rec_at(&cameras, armed_at), "armed");
    cameras.body_records(1, false);
    assert_eq!(
        rec_at(
            &cameras,
            armed_at + STOP_SHOWN_FOR + Duration::from_millis(1)
        ),
        "started"
    );

    // A take that still runs after the 3 s is armed again, not stopped.
    let armed_at = armed_at + Duration::from_secs(20);
    assert_eq!(rec_at(&cameras, armed_at), "armed");
    assert_eq!(
        rec_at(
            &cameras,
            armed_at + STOP_ARM_WINDOW + Duration::from_millis(1)
        ),
        "armed"
    );
    assert_eq!(cameras.camera(1)["recording"]["recording"], true);
}

// CAM 1 does not answer for a while under an armed stop. When it answers
// again a take may have ended and another begun: the arm is not trusted.
#[test]
fn an_arm_does_not_outlive_a_camera_that_was_lost_or_released() {
    let cameras = TestCameras::set_up("deck-rec-lost");
    let start = Instant::now();
    let at = |millis: u64| start + Duration::from_millis(millis);
    assert_eq!(rec_at(&cameras, start), "started");
    assert_eq!(rec_at(&cameras, at(10_000)), "armed");

    cameras.answering(1, false);
    assert_eq!(refused(&cameras, "rec", None).0, "CAMERA_UNREACHABLE");
    cameras.answering(1, true);
    assert_eq!(
        rec_key_at(&cameras, at(11_000)),
        (String::from("REC"), String::from("recording")),
        "the key reads STOP? for the take it was armed for, and for no other"
    );
    assert_eq!(rec_at(&cameras, at(11_000)), "kept");
    assert_eq!(cameras.camera(1)["recording"]["recording"], true);
    assert_eq!(cameras.sent(1), vec![CameraCommand::RecordStart]);

    // Released and connected again: the same.
    assert_eq!(rec_at(&cameras, at(20_000)), "armed");
    cameras.call("cameras.release", json!({ "camera": 1, "confirm": true }));
    assert_eq!(refused(&cameras, "rec", None).0, "CAMERA_RELEASED");
    cameras.call("cameras.connect", json!({ "camera": 1 }));
    assert_eq!(rec_at(&cameras, at(21_000)), "kept");
    assert_eq!(cameras.camera(1)["recording"]["recording"], true);

    // The take is stopped as any take: a press arms, a second stops.
    assert_eq!(rec_at(&cameras, at(22_000)), "armed");
    assert_eq!(rec_at(&cameras, at(23_000)), "stopped");
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::RecordStart, CameraCommand::RecordStop]
    );

    // A restart forgets the arm and the dwell.
    assert_eq!(rec_at(&cameras, at(30_000)), "started");
    assert_eq!(rec_at(&cameras, at(40_000)), "armed");
    cameras.restart();
    assert_eq!(
        rec_key_at(&cameras, at(40_500)),
        (String::from("REC"), String::from("recording"))
    );
    assert_eq!(rec_at(&cameras, at(40_500)), "armed");
}

// D13, D19: a camera that is released or does not answer takes nothing from
// the deck, and the displays say which. A take CAM 1 last reported reads as
// doubt, and the stop is locked.
#[test]
fn a_camera_that_is_not_held_takes_nothing_from_the_deck() {
    let cameras = TestCameras::set_up("deck-not-held");
    press(&cameras, "rec", None);
    cameras.answering(1, false);
    take_announced();

    let displays = displays(&cameras);
    assert_eq!(displays["camera_key_1"], "CAM 1\\nUNREACHABLE");
    // The take CAM 1 last reported: no length is counted (2026-10-03).
    assert_eq!(displays["camera_key_rec"], "REC\\nLAST KNOWN");
    assert_eq!(displays["camera_state_rec"], "last-known");
    assert_eq!(displays["camera_state_dials"], "doubt");
    assert_eq!(
        strip(&cameras),
        [
            "ISO\\n400",
            "SHUTTER\\n180°",
            "IRIS\\nf/2.8",
            "ND\\n2 stops"
        ],
        "what it last reported, which the strip shows as doubt"
    );
    let sent = cameras.sent(1).len();
    assert_eq!(refused(&cameras, "rec", None).0, "CAMERA_UNREACHABLE");
    assert_eq!(
        refused(&cameras, "dial", Some("1:up")).0,
        "CAMERA_UNREACHABLE"
    );
    assert_eq!(cameras.sent(1).len(), sent);

    press(&cameras, "select", Some("2"));
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    let displays = self::displays(&cameras);
    assert_eq!(displays["camera_key_2"], "CAM 2\\nRELEASED");
    assert_eq!(displays["camera_state_dials"], "locked");
    assert_eq!(
        strip(&cameras),
        ["ISO\\n--", "SHUTTER\\n--", "IRIS\\n--", "ND\\n--"]
    );
    assert_eq!(refused(&cameras, "dial", Some("1:up")).0, "CAMERA_RELEASED");
    assert_eq!(cameras.sent(2), Vec::new());
}

// D12: a read sends nothing. The displays are read with the cameras, once
// for all of them, and what a camera changed itself is then announced as
// any request announces it. (The bridge keeps the texts for the rest of the
// poll: `control_surface_pages`.)
#[test]
fn the_displays_are_read_with_the_cameras_once_for_all_of_them() {
    let cameras = TestCameras::set_up("deck-poll");
    cameras.snapshot();
    take_announced();
    // The body changes a value and CAM 3 stops answering; nobody has read
    // the cameras since.
    crate::cameras::runtime::with_bodies_unnoticed(cameras.path(), |bodies| {
        bodies.body_sets(1, Setting::Iso, CameraValue::Text(String::from("3200")));
        bodies.set_answering(3, false);
    });
    assert!(announced_changes().0.is_empty());

    let texts = displays(&cameras);
    assert_eq!(texts["camera_strip_1"], "ISO\\n3200");
    assert_eq!(texts["camera_key_3"], "CAM 3\\nUNREACHABLE");
    let (changes, health) = announced_changes();
    assert_eq!(
        changes,
        vec![
            (String::from("reported"), json!(1)),
            (String::from("unreachable"), json!(3)),
        ]
    );
    assert!(health, "the Cameras lamp follows");
    assert!(cameras.nothing_sent(), "a read sends nothing");
}

#[test]
fn a_key_the_page_does_not_have_is_refused() {
    let cameras = TestCameras::set_up("deck-unknown");
    for action in ["record", "stop", "release", "format", "", "REC"] {
        let (code, sentence) = refused(&cameras, action, None);
        assert_eq!(code, "INVALID_PARAMS", "{action}");
        assert_eq!(sentence, format!("Unsupported CAMERAS key: {action}"));
    }
    assert!(cameras.nothing_sent());
}
