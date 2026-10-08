//! The link to the cameras (new pages program, Slice 8): what reaches a
//! camera and what comes back from one. Nothing but the operator's press
//! sends anything (D12); a value the camera changed itself, a camera that
//! stops answering and one that answers again come back as `cameras.changed`
//! (with `app.changed { reason: "health" }` when the check changed); holding
//! and releasing (D13); `checks.cameras`; the link without the simulated
//! cameras; and the drift guard (D15 rule 1).

use crate::cameras::model::Setting;
use crate::cameras::real_link::guard_camera_address;
use crate::cameras::runtime;
use crate::cameras::simulated::{CameraCommand, CameraReading, CameraValue};
use crate::cameras::snapshot::{CameraState, CameraTone};
use crate::cameras::store::{write_setup, StoredSetup};
use crate::cameras::test_support::{
    announced_changes, assert_operator_words, refusal, take_announced, TestCameras, CAM2_ADDRESS,
    CAM3_ADDRESS,
};
use crate::storage::{open_connection, set_settings};
use serde_json::{json, Value};

fn change(reason: &str, camera: Value) -> (String, Value) {
    (String::from(reason), camera)
}

// D12: starting, opening the page, selecting, taking a camera back, a Setup
// change, restarting and restoring send nothing to a camera. Only a press
// does.
#[test]
fn nothing_but_a_press_sends_anything_to_a_camera() {
    let cameras = TestCameras::set_up("d12");
    cameras.restart();
    cameras.snapshot();
    cameras.call("cameras.select", json!({ "camera": 2 }));
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    cameras.call("cameras.connect", json!({ "camera": 2 }));
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 3, "vmixInput": 9 }),
    );
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 3, "address": CAM3_ADDRESS }),
    );
    cameras.pair_cam_1();
    cameras.health();
    crate::cameras::after_archive_restore(cameras.path(), true).expect("the restore settles");
    cameras.restart();
    cameras.snapshot();
    assert!(cameras.nothing_sent(), "nothing was pressed");

    cameras.call(
        "cameras.set",
        json!({ "camera": 2, "setting": "iso", "value": "1600" }),
    );
    assert_eq!(
        cameras.sent(2),
        vec![CameraCommand::Set(
            Setting::Iso,
            CameraValue::Text(String::from("1600"))
        )]
    );
    assert!(cameras.sent(1).is_empty() && cameras.sent(3).is_empty());
}

// D12: the camera wins. A value it changed itself (on its body, or from the
// iPad) is in the next snapshot and comes back as `reported`; the check does
// not change, so no health follow-up. A released camera is not read, so
// nothing comes back until it is connected again.
#[test]
fn a_value_the_camera_changed_itself_comes_back_as_reported() {
    let cameras = TestCameras::set_up("reported");
    cameras.body_sets(1, Setting::Iso, CameraValue::Text(String::from("1600")));
    assert_eq!(
        announced_changes(),
        (vec![change("reported", json!(1))], false)
    );
    assert_eq!(cameras.camera(1)["values"]["iso"]["value"], "1600");
    assert!(cameras.nothing_sent());

    cameras.call("cameras.release", json!({ "camera": 3, "confirm": true }));
    take_announced();
    cameras.body_sets(3, Setting::WhiteBalance, CameraValue::Number(3200.0));
    assert_eq!(announced_changes(), (Vec::new(), false));
    assert_eq!(
        cameras.camera(3)["values"]["whiteBalance"]["value"],
        Value::Null
    );
    cameras.call("cameras.connect", json!({ "camera": 3 }));
    assert_eq!(
        cameras.camera(3)["values"]["whiteBalance"]["value"].as_f64(),
        Some(3200.0)
    );
}

// Finding 19 of the walk of 2026-10-07 (the owner's decision): a connection
// that brings no setting shows what the camera last reported, and when, as
// the last read until the camera reports; across a start too, from the
// saved reading; and after a Connect soon after a Release.
#[test]
fn a_connection_that_brings_no_setting_shows_the_last_values_as_the_last_read() {
    let cameras = TestCameras::set_up("last-read");
    let before = cameras.camera(2);
    assert_eq!(before["valuesLastRead"], false);
    assert_eq!(
        before["sentence"],
        "CAM 2 is held: Studio Control reads it and sends only what you press."
    );

    // The camera connects again and reports nothing, while its body holds
    // another ISO: the last values, as doubt, and when they were read.
    cameras.reporting(2, false);
    cameras.body_sets(2, Setting::Iso, CameraValue::Text(String::from("3200")));
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["state"], "held");
    assert_eq!(cam2["valuesLastRead"], true);
    assert_eq!(
        cam2["values"], before["values"],
        "the last values, not the body's"
    );
    assert_eq!(cam2["readAt"], before["readAt"], "and when they were read");
    assert_eq!(
        cam2["sentence"],
        "CAM 2 is held and has reported nothing since it connected: its values are the last read, until it does."
    );
    assert_eq!(announced_changes(), (Vec::new(), false), "nothing changed");

    // Across a start: the saved reading, still the last read, with the time
    // it was saved (a reading that does not change is saved again once a
    // minute, so the time is near the last read).
    cameras.restart();
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["valuesLastRead"], true);
    assert_eq!(cam2["values"], before["values"]);
    assert!(cam2["readAt"].is_string(), "{:?}", cam2["readAt"]);
    assert!(cam2["readAt"].as_str() <= before["readAt"].as_str());

    // The camera reports: its values are its own again, read now.
    cameras.reporting(2, true);
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["valuesLastRead"], false);
    assert_eq!(cam2["values"]["iso"]["value"], "3200");
    assert_ne!(cam2["readAt"], before["readAt"]);
    assert_eq!(cam2["sentence"], before["sentence"]);

    // Released and connected soon after: the last values until it reports.
    cameras.reporting(2, false);
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    let released = cameras.camera(2);
    assert_eq!(released["state"], "released");
    assert_eq!(
        released["valuesLastRead"], false,
        "nothing is shown while released"
    );
    assert!(released["readAt"].is_null());
    cameras.call("cameras.connect", json!({ "camera": 2 }));
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["state"], "held");
    assert_eq!(cam2["valuesLastRead"], true);
    assert_eq!(cam2["values"]["iso"]["value"], "3200");

    // CAM 1, the Pocket: while its values are the last read, a press that
    // sets half a parameter is refused (the other half would be a guess,
    // D12), a whole one goes, and the timecode follows the link.
    cameras.reporting(1, false);
    assert_eq!(cameras.camera(1)["valuesLastRead"], true);
    assert_eq!(
        cameras.refused(
            "cameras.set",
            json!({ "camera": 1, "setting": "whiteBalance", "value": 5600 })
        ),
        (
            String::from("CAMERA_VALUE_NOT_ALLOWED"),
            String::from(
                "CAM 1 has not reported its tint since it connected, so a white balance cannot be sent with it."
            )
        )
    );
    let _ = cameras.reply(
        "cameras.set",
        json!({ "camera": 1, "setting": "iso", "value": "800" }),
    );
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::Set(
            Setting::Iso,
            CameraValue::Text(String::from("800"))
        )]
    );
    cameras.set_clock(1, std::time::Duration::from_secs(9 * 3600 + 12 * 60 + 53));
    let timecode = cameras.camera(1)["recording"]["timecode"].clone();
    assert!(
        timecode
            .as_str()
            .is_some_and(|text| text.starts_with("09:12:53")),
        "{timecode}"
    );

    // Forget takes the saved reading away (ISO 400, saved before the press):
    // paired again and started, with its link bringing nothing, CAM 1 has
    // nothing kept to show, so what the link brings is its own, not the
    // last read.
    cameras.call("cameras.setup.forget", json!({ "camera": 1 }));
    cameras.pair_cam_1();
    cameras.restart();
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["state"], "held");
    assert_eq!(cam1["valuesLastRead"], false);
    assert_eq!(
        cam1["values"]["iso"]["value"], "800",
        "the body's own value, not the dropped reading's"
    );
}

// D19: a held camera that stops answering reads UNREACHABLE (error), keeps
// the values it last reported and when, and comes back as `unreachable`
// with the health follow-up; answering again is `reachable`.
#[test]
fn a_camera_that_stops_answering_is_unreachable_and_keeps_its_last_values() {
    let cameras = TestCameras::set_up("unreachable");
    let before = cameras.camera(2);
    cameras.answering(2, false);
    assert_eq!(
        announced_changes(),
        (vec![change("unreachable", json!(2))], true)
    );
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["state"], "unreachable");
    assert_eq!(cam2["word"], "UNREACHABLE");
    assert_eq!(cam2["tone"], "error");
    assert_eq!(
        cam2["sentence"],
        "CAM 2 does not answer at 172.16.16.85. Check that it is on and on the network."
    );
    assert_eq!(cam2["values"], before["values"], "its last values stay");
    assert_eq!(
        cam2["readAt"], before["readAt"],
        "and when it last answered"
    );
    assert_eq!(announced_changes(), (Vec::new(), false), "said once");

    let check = cameras.health();
    assert_eq!(check.status, CameraTone::Error);
    assert_eq!(check.word, "UNREACHABLE");
    assert!(check.raises_whole_status());
    assert_eq!(
        check.whole_status_sentence(),
        Some("CAM 2 does not answer at 172.16.16.85. Check that it is on and on the network.")
    );

    // Connect on an unreachable camera tries to read it again and answers
    // its state.
    assert_eq!(
        cameras.call("cameras.connect", json!({ "camera": 2 })),
        json!({
            "camera": 2,
            "state": "unreachable",
            "sentence": "CAM 2 does not answer at 172.16.16.85. Check that it is on and on the network."
        })
    );
    cameras.answering(2, true);
    assert_eq!(
        announced_changes(),
        (vec![change("reachable", json!(2))], true)
    );
    assert_eq!(cameras.camera(2)["state"], "held");
    assert!(!cameras.health().raises_whole_status());
    assert!(cameras.nothing_sent());
}

// D19: a recording CAM 1 that stops answering is left as it was — the
// snapshot keeps `recording: true` as doubt, and the take goes on.
#[test]
fn a_recording_cam_1_that_stops_answering_is_left_recording() {
    let cameras = TestCameras::set_up("recording-unreachable");
    cameras.call("cameras.record.start", json!({}));
    let started_at = cameras.camera(1)["recording"]["startedAt"].clone();
    assert!(started_at.is_string());
    cameras.answering(1, false);
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["state"], "unreachable");
    assert_eq!(cam1["recording"]["recording"], true);
    assert_eq!(cam1["recording"]["startedAt"], started_at);
    assert!(cameras.health().recording);
    assert_eq!(
        cameras.refused("cameras.record.stop", json!({ "confirm": true })),
        refusal(
            "CAMERA_UNREACHABLE",
            "CAM 1 does not answer over Bluetooth. Check it is on and within reach."
        )
    );
    assert_eq!(cameras.sent(1), vec![CameraCommand::RecordStart]);
    // Answering again, the take reads as one that started before the hardware
    // link looked: it was not looking, and the take may have stopped and
    // started again in between.
    cameras.answering(1, true);
    assert_eq!(cameras.camera(1)["recording"]["recording"], true);
    assert_eq!(cameras.camera(1)["recording"]["startedAt"], Value::Null);
}

// D13: a recording CAM 1 can be released (armed); the take goes on — only
// the camera or the iPad stops it then — and its values are no longer shown.
// Connected again, it reads the take as one that started before it looked.
#[test]
fn a_recording_cam_1_released_goes_on_recording() {
    let cameras = TestCameras::set_up("release-recording");
    cameras.call("cameras.record.start", json!({}));
    cameras.call("cameras.release", json!({ "camera": 1, "confirm": true }));
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["state"], "released");
    assert_eq!(cam1["recording"]["recording"], Value::Null);
    assert_eq!(cam1["recording"]["timecode"], Value::Null);
    assert_eq!(cam1["values"]["iso"]["value"], Value::Null);
    assert_eq!(cam1["readAt"], Value::Null);
    assert!(!cameras.health().recording);
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::RecordStart],
        "release sends nothing: the camera keeps recording"
    );
    cameras.call("cameras.connect", json!({ "camera": 1 }));
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["recording"]["recording"], true);
    assert_eq!(cam1["recording"]["startedAt"], Value::Null);
}

// D10: a take started from the iPad is seen starting (and `checks.cameras`
// says CAM 1 records, so the health follow-up comes after it); a take
// already running at the start started before the hardware link looked.
#[test]
fn a_take_started_elsewhere_is_seen_starting_or_not() {
    let cameras = TestCameras::set_up("take-elsewhere");
    cameras.body_records(1, true);
    assert_eq!(
        announced_changes(),
        (vec![change("reported", json!(1))], true),
        "the check says CAM 1 records now, so the lamp follows"
    );
    assert!(cameras.camera(1)["recording"]["startedAt"].is_string());
    assert!(cameras.health().recording);
    cameras.restart();
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["recording"]["recording"], true);
    assert_eq!(cam1["recording"]["startedAt"], Value::Null);
    assert!(cameras.nothing_sent());
}

// D13 and D41 (2026-10-06): a release is kept across a start, so a camera
// handed to the iPad or LUMIX Tether stays with it until Connect; Forget and
// a new pairing or address end it too. Until D41 a start held every set-up
// camera again, which would have taken the Pocket from the iPad the moment
// the iPad let go. A start still announces nothing and sends nothing.
#[test]
fn a_release_is_kept_across_a_start_until_connect() {
    let cameras = TestCameras::set_up("release-kept");
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    cameras.call("cameras.release", json!({ "camera": 1, "confirm": true }));
    cameras.restart();
    let snapshot = cameras.snapshot();
    assert_eq!(snapshot["cameras"][0]["state"], "released");
    assert_eq!(snapshot["cameras"][1]["state"], "released");
    assert_eq!(snapshot["cameras"][2]["state"], "held");
    assert_eq!(
        snapshot["cameras"][0]["sentence"],
        "CAM 1 is released: Studio Control reads it no more and sends it nothing. Connect it to control it here."
    );
    assert_eq!(take_announced(), Vec::new(), "a start announces nothing");

    // Connect ends it, and a start keeps that too.
    cameras.call("cameras.connect", json!({ "camera": 2 }));
    cameras.restart();
    let snapshot = cameras.snapshot();
    assert_eq!(snapshot["cameras"][1]["state"], "held");
    assert_eq!(
        snapshot["cameras"][0]["state"], "released",
        "CAM 1 stays released"
    );

    // Forget ends it: the camera is not set up, and a new pairing holds it.
    cameras.call("cameras.setup.forget", json!({ "camera": 1 }));
    assert_eq!(cameras.camera(1)["state"], "not-set-up");
    cameras.pair_cam_1();
    assert_eq!(cameras.camera(1)["state"], "held");
    cameras.restart();
    assert_eq!(cameras.camera(1)["state"], "held");

    // A new address ends a BGH1's release the same way.
    cameras.call("cameras.release", json!({ "camera": 3, "confirm": true }));
    cameras.restart();
    assert_eq!(cameras.camera(3)["state"], "released");
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 3, "address": "172.16.16.87" }),
    );
    assert_eq!(cameras.camera(3)["state"], "held");
    cameras.restart();
    assert_eq!(cameras.camera(3)["state"], "held");
    assert!(cameras.nothing_sent());
}

// `checks.cameras`: the worst camera's state, word and sentence (latest in
// the states' order; among equals the lowest number), whether CAM 1 records;
// only a set-up, unreleased camera that does not answer counts toward the
// whole status.
#[test]
fn the_health_check_names_the_worst_camera() {
    let cameras = TestCameras::new("health");
    let check = cameras.health();
    assert!(!check.ok);
    assert_eq!(check.status, CameraTone::Attention);
    assert_eq!(check.word, "NOT SET UP");
    assert_eq!(
        check.summary,
        "CAM 1 is not paired. Pair it in Setup, with the camera beside you."
    );
    assert!(
        !check.raises_whole_status(),
        "not set up lights the lamp only"
    );
    assert_eq!(check.cameras.len(), 3);
    assert_eq!(check.cameras[1].tag, "CAM 2");
    assert_eq!(check.cameras[1].state, CameraState::NotSetUp);

    cameras.pair_cam_1();
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 2, "address": CAM2_ADDRESS }),
    );
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 3, "address": CAM3_ADDRESS }),
    );
    let check = cameras.health();
    assert!(check.ok);
    assert_eq!(check.status, CameraTone::Ok);
    assert_eq!(check.word, "HELD");
    assert_eq!(
        check.summary,
        "CAM 1 is held: Studio Control reads it and sends only what you press."
    );
    assert!(!check.recording);

    cameras.call("cameras.release", json!({ "camera": 3, "confirm": true }));
    let check = cameras.health();
    assert_eq!(check.word, "RELEASED");
    assert!(check
        .summary
        .starts_with("CAM 3 is released to LUMIX Tether."));
    assert!(
        !check.raises_whole_status(),
        "released lights the lamp only"
    );

    cameras.answering(3, false);
    assert!(
        !cameras.health().raises_whole_status(),
        "a released camera is not read, so it cannot be unreachable"
    );
    cameras.answering(2, false);
    cameras.answering(1, false);
    let check = cameras.health();
    assert_eq!(check.word, "UNREACHABLE");
    assert!(
        check.summary.starts_with("CAM 1 does not answer"),
        "{}",
        check.summary
    );
    assert!(check.raises_whole_status());
    for entry in &check.cameras {
        assert_operator_words(&entry.sentence);
    }
}

// The studio's build before Slice 13: without a link Setup takes no
// address, so a BGH1 reads NOT SET UP and says why, and the whole status
// stays as it is. The vMix input, taking an address away and Forget stay.
// CAM 1's link is built on Windows (the Pocket's pairing, 2026-10-06): there
// it reads NOT SET UP until it is paired; Linux, where only CI builds the
// engine, has no link to it and takes no pairing either.
#[test]
fn without_a_link_setup_takes_no_pairing_and_no_address() {
    let cameras = TestCameras::without_simulation("no-link-setup");
    let cannot_pair =
        "Studio Control cannot pair CAM 1 yet: its Bluetooth link comes with a later version.";
    let cannot_take = "Studio Control cannot take CAM 2's address yet: its network link comes with a later version.";
    let (cam1_sentence, cam1_cannot) = if cfg!(windows) {
        (
            "CAM 1 is not paired. Pair it in Setup, with the camera beside you.",
            None,
        )
    } else {
        assert_eq!(
            cameras.refused("cameras.setup.pair", json!({ "camera": 1 })),
            refusal("CAMERA_NO_LINK", cannot_pair)
        );
        (
            "Studio Control has no link to CAM 1 yet: it comes with a later version.",
            Some(cannot_pair),
        )
    };
    assert_eq!(
        cameras.refused(
            "cameras.setup.update",
            json!({ "camera": 2, "address": "127.0.0.1" })
        ),
        refusal("CAMERA_NO_LINK", cannot_take)
    );
    assert_eq!(
        cameras.refused(
            "cameras.setup.update",
            json!({ "camera": 2, "address": "127.0.0.1", "vmixInput": 9 })
        ),
        refusal("CAMERA_NO_LINK", cannot_take),
        "and the vMix input beside it is not saved"
    );
    // The request's shape and the address's form are checked first.
    assert_eq!(
        cameras.code(
            "cameras.setup.update",
            json!({ "camera": 2, "address": "" })
        ),
        "INVALID_PARAMS"
    );
    assert_eq!(
        cameras.code(
            "cameras.setup.update",
            json!({ "camera": 2, "address": "1.2.3" })
        ),
        "CAMERA_ADDRESS_INVALID"
    );
    assert_eq!(announced_changes(), (Vec::new(), false));
    // Nothing of a refused request is in the saved data: a start reads it again.
    cameras.restart();

    let snapshot = cameras.snapshot();
    for (index, no_link, cannot) in [
        (0, cam1_sentence, cam1_cannot),
        (
            1,
            "Studio Control has no link to CAM 2 yet: it comes with a later version.",
            Some(cannot_take),
        ),
        (
            2,
            "Studio Control has no link to CAM 3 yet: it comes with a later version.",
            Some("Studio Control cannot take CAM 3's address yet: its network link comes with a later version."),
        ),
    ] {
        let camera = &snapshot["cameras"][index];
        assert_eq!(camera["state"], "not-set-up");
        assert_eq!(camera["word"], "NOT SET UP");
        assert_eq!(camera["sentence"], no_link);
        assert_eq!(
            camera["setup"],
            json!({
                "setUp": false, "address": null, "paired": false, "vmixInput": index + 1,
                "vmixOutput": index + 2, "noLink": cannot, "pairing": null
            })
        );
        assert_operator_words(no_link);
        assert_operator_words(cannot.unwrap_or_default());
    }
    let check = cameras.health();
    assert_eq!(check.word, "NOT SET UP");
    assert_eq!(check.summary, cam1_sentence);
    assert!(!check.raises_whole_status());
    assert_eq!(
        cameras.refused(
            "cameras.set",
            json!({ "camera": 2, "setting": "iso", "value": "800" })
        ),
        refusal(
            "CAMERA_NOT_SET_UP",
            "Studio Control has no link to CAM 2 yet: it comes with a later version."
        )
    );

    assert_eq!(
        cameras.call(
            "cameras.setup.update",
            json!({ "camera": 2, "vmixInput": 9 })
        )["setup"]["vmixInput"],
        9
    );
    assert_eq!(
        cameras.call(
            "cameras.setup.update",
            json!({ "camera": 2, "address": null })
        )["setup"]["setUp"],
        false
    );
    assert_eq!(
        cameras.call("cameras.setup.forget", json!({ "camera": 1 }))["setup"]["noLink"],
        json!(cam1_cannot)
    );
    assert!(cameras.nothing_sent());
}

// Saved data that holds an address all the same (a database backup restored
// whole brings what it holds): the camera is set up and does not answer,
// says there is no link to it yet, and its address can be taken away.
#[test]
fn without_a_link_a_camera_the_saved_data_holds_does_not_answer() {
    let cameras = TestCameras::without_simulation("no-link");
    cameras.starts_with_address(2, "127.0.0.1");
    let no_link = "Studio Control has no link to CAM 2 yet: it comes with a later version.";
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["state"], "unreachable");
    assert_eq!(cam2["sentence"], no_link);
    assert_eq!(cam2["readAt"], Value::Null);
    assert_eq!(cam2["values"]["iso"]["value"], Value::Null);
    assert_operator_words(no_link);
    assert_eq!(
        cameras.refused(
            "cameras.set",
            json!({ "camera": 2, "setting": "iso", "value": "800" })
        ),
        refusal("CAMERA_UNREACHABLE", no_link)
    );
    assert_eq!(cameras.health().whole_status_sentence(), Some(no_link));
    assert_eq!(
        cameras.call("cameras.connect", json!({ "camera": 2 }))["state"],
        "unreachable"
    );
    take_announced();
    let reply = cameras
        .reply(
            "cameras.setup.update",
            json!({ "camera": 2, "address": null }),
        )
        .expect("the address is taken away");
    assert!(
        reply.health_changed,
        "the camera no longer counts toward the whole status"
    );
    assert_eq!(cameras.camera(2)["state"], "not-set-up");
    assert_eq!(cameras.health().whole_status_sentence(), None);
    assert!(cameras.nothing_sent());
}

// The seam to the real links (2026-10-06): the runtime tells them to hold a
// camera at a start and at Connect, and to let it go at Release and when its
// setup is taken away; with the simulated cameras it tells them nothing.
// CAM 2 and CAM 3 read no link yet; CAM 1's pairing from saved data without
// its Bluetooth address reads as gone on Windows and no link on Linux.
#[test]
fn the_real_links_are_told_what_to_hold_and_to_let_go() {
    let cameras = TestCameras::without_simulation("told");
    cameras.starts_with_address(2, "127.0.0.1");
    let connection = open_connection(cameras.path()).expect("connection should open");
    write_setup(
        &connection,
        &StoredSetup {
            paired: true,
            ..StoredSetup::new(1)
        },
    )
    .expect("the row writes");
    cameras.restart();
    cameras.snapshot();
    assert_eq!(
        runtime::links_told(cameras.path()),
        vec!["hold 1", "hold 2", "let go 3"],
        "a start holds every set-up camera"
    );
    // A pairing without its Bluetooth address: on Windows the link finds
    // it gone (NOT SET UP, `tests_setup.rs`); Linux has no link to CAM 1.
    if cfg!(windows) {
        assert_eq!(cameras.camera(1)["state"], "not-set-up");
    } else {
        let no_link = "Studio Control has no link to CAM 1 yet: it comes with a later version.";
        assert_eq!(cameras.camera(1)["state"], "unreachable");
        assert_eq!(cameras.camera(1)["sentence"], no_link);
    }

    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    cameras.call("cameras.connect", json!({ "camera": 2 }));
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 2, "address": null }),
    );
    cameras.call("cameras.setup.forget", json!({ "camera": 1 }));
    assert_eq!(
        runtime::links_told(cameras.path())[3..],
        ["let go 2", "hold 2", "let go 2", "let go 1"]
    );
    assert!(cameras.nothing_sent());

    let simulated = TestCameras::set_up("told-simulated");
    simulated.call("cameras.release", json!({ "camera": 1, "confirm": true }));
    simulated.call("cameras.connect", json!({ "camera": 1 }));
    assert_eq!(
        runtime::links_told(simulated.path()),
        Vec::<String>::new(),
        "the simulated cameras speak to no real link"
    );
}

// D15 rule 1: in a test build the network link refuses every address that is
// not on this PC before it would connect — whatever the saved data says.
#[test]
fn the_drift_guard_refuses_every_address_but_this_pc_s_in_a_test_build() {
    for address in ["127.0.0.1", "::1", "localhost", " 127.0.0.1 "] {
        assert_eq!(guard_camera_address(address), Ok(()), "{address}");
    }
    for address in [
        "172.16.16.85",
        "10.0.0.1",
        "192.168.1.20",
        "127.0.0.2",
        "localhost.example",
        "0.0.0.0",
    ] {
        assert!(guard_camera_address(address).is_err(), "{address}");
    }

    // The link without the simulated cameras calls it before anything else:
    // a camera at an address on the studio's network is stopped there.
    let cameras = TestCameras::without_simulation("guard");
    cameras.starts_with_address(3, CAM3_ADDRESS);
    let sentence = cameras.camera(3)["sentence"]
        .as_str()
        .expect("a sentence")
        .to_string();
    assert!(
        sentence.contains("does not reach 172.16.16.86"),
        "{sentence}"
    );
}

// D15 rules 1–2: the simulated cameras touch no network and no radio — their
// module names no socket and no Bluetooth crate, and not the real links.
#[test]
fn the_simulated_cameras_name_no_socket_and_no_bluetooth_crate() {
    let source = include_str!("simulated.rs");
    let code: String = source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "std::net",
        "TcpStream",
        "TcpListener",
        "UdpSocket",
        "socket",
        "btleplug",
        "bluest",
        "bluetooth",
        "windows::",
        "tokio",
        "reqwest",
        "ureq",
        "hyper",
        "real_link",
    ] {
        assert!(
            !code.to_lowercase().contains(&forbidden.to_lowercase()),
            "simulated.rs names {forbidden}"
        );
    }
}

// A reading saved before 2026-10-08, without the battery and the record
// time, loads: the two read as none, and a start shows its values as the
// last read. The camera's own status then comes with every read, the last
// read too (the simulated body's here).
#[test]
fn a_reading_saved_before_the_status_fields_loads_as_the_last_read() {
    let reading_json = concat!(
        r#"{"iso":"1600","shutter":"180°","iris":"f/4.0","nd":"Clear","white_balance":5600.0,"#,
        r#""tint":0.0,"focus":null,"resolution":"6K","frame_rate":"25","dynamic_range":"Film","#,
        r#""display_lut":"None","display_lut_on":false,"recording":false,"timecode":null}"#
    );
    let loaded: CameraReading = serde_json::from_str(reading_json).expect("an older reading loads");
    assert_eq!(loaded.battery, None);
    assert_eq!(loaded.record_time_left_minutes, None);
    assert_eq!(loaded.iso.as_deref(), Some("1600"));

    let cameras = TestCameras::set_up("older-saved-reading");
    let older = format!(r#"{{"read_at":"2026-10-07T18:14:16.000Z","reading":{reading_json}}}"#);
    set_settings(&cameras.db_path, &[("cameras.lastReading.1", older)])
        .expect("the setting writes");
    cameras.reporting(1, false);
    cameras.restart();
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["valuesLastRead"], true);
    assert_eq!(cam1["values"]["iso"]["value"], "1600");
    assert_eq!(cam1["readAt"], "2026-10-07T18:14:16.000Z");
    assert_eq!(
        cam1["battery"], "100 % · on mains",
        "the status rides along"
    );
    assert_eq!(cam1["recording"]["cardTimeLeft"], "17 h 00 min");
}
