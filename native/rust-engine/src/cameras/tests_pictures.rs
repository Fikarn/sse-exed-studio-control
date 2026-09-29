//! The cameras' pictures (D17, D28; `pictures.rs`): what `cameras.snapshot`
//! and `checks.cameras` say of them. A studio build reads `NO PICTURES` until
//! the pictures are built; the simulated cameras' test pictures stand in for
//! vMix inputs 1 to 4, so a camera on another input reads `PICTURE MISSING`.
//! With the pictures helper (a development run), what it says it receives is
//! what shows.

use crate::cameras::snapshot::{CameraTone, PictureState};
use crate::cameras::test_support::{announced_changes, assert_operator_words, TestCameras};
use crate::pictures_helper::{set_status_for_test, HelperStatus};
use serde_json::{json, Value};
use studio_control_protocol::pictures::ReceivedCamera;

fn pictures(cameras: &TestCameras) -> Value {
    cameras.snapshot()["pictures"].clone()
}

fn picture(cameras: &TestCameras, camera: u8) -> Value {
    cameras.camera(camera)["picture"].clone()
}

// The simulated cameras' test pictures stand in for vMix inputs 1 to 4: each
// camera's own input, as new saved data has it, shows.
#[test]
fn the_simulated_test_pictures_show_on_vmix_inputs_one_to_four() {
    let cameras = TestCameras::set_up("pictures-showing");
    assert_eq!(
        pictures(&cameras),
        json!({
            "state": "showing",
            "word": null,
            "tone": "ok",
            "sentence": null,
            "source": "test pictures",
            "note": "Test pictures stand in for vMix inputs 1 to 4. The cameras' own come with a later version, over NDI from vMix on this PC."
        })
    );
    for camera in [1, 2, 3] {
        assert_eq!(
            picture(&cameras, camera),
            json!({
                "state": "showing",
                "word": "LIVE",
                "tone": "ok",
                "detail": "test picture",
                "sentence": null,
                "advice": null
            })
        );
    }
    let health = cameras.health();
    assert!(health.ok);
    assert_eq!(health.word, "HELD");
}

// Board 2's `one-picture`: vMix sends pictures, and none for CAM 2's input.
// The camera's controls do not care: it is held, as it was.
#[test]
fn a_camera_on_an_input_the_pictures_do_not_carry_reads_picture_missing() {
    let cameras = TestCameras::set_up("pictures-missing");
    let reply = cameras
        .reply(
            "cameras.setup.update",
            json!({ "camera": 2, "vmixInput": 7 }),
        )
        .expect("the vMix input is saved");
    assert_eq!(reply.event, Some(("setup", Some(2))));
    assert!(
        reply.health_changed,
        "the Cameras lamp reads picture missing"
    );
    assert_eq!(
        picture(&cameras, 2),
        json!({
            "state": "missing",
            "word": "NO PICTURE",
            "tone": "attention",
            "detail": "nothing received",
            "sentence": "vMix is not sending CAM 2 over NDI.",
            "advice": "vMix sends other inputs: check that vMix input 7 is still there and live."
        })
    );
    assert_eq!(picture(&cameras, 1)["state"], "showing");
    assert_eq!(picture(&cameras, 3)["state"], "showing");
    let whole = pictures(&cameras);
    assert_eq!(whole["state"], "missing");
    assert_eq!(whole["word"], "PICTURE MISSING");
    assert_eq!(whole["tone"], "attention");
    assert_eq!(
        whole["sentence"],
        "vMix sends no picture for CAM 2. Check that vMix input 7 is still there and live."
    );
    assert_eq!(cameras.camera(2)["state"], "held");

    let health = cameras.health();
    assert!(!health.ok);
    assert_eq!(health.status, CameraTone::Attention);
    assert_eq!(health.word, "PICTURE MISSING");
    assert_eq!(health.summary, whole["sentence"]);
    assert!(
        !health.raises_whole_status(),
        "a missing picture lights the Cameras lamp only"
    );
    assert!(cameras.nothing_sent());

    // Its input back on one the pictures carry: it shows again.
    let reply = cameras
        .reply(
            "cameras.setup.update",
            json!({ "camera": 2, "vmixInput": 4 }),
        )
        .expect("the vMix input is saved");
    assert!(reply.health_changed);
    assert_eq!(picture(&cameras, 2)["state"], "showing");
    assert_eq!(cameras.health().word, "HELD");
}

// The state display speaks of one camera: the selected one when its picture
// is missing, otherwise the first whose picture is.
#[test]
fn the_pictures_speak_of_the_selected_camera_first() {
    let cameras = TestCameras::set_up("pictures-selected");
    for camera in [2, 3] {
        cameras.call(
            "cameras.setup.update",
            json!({ "camera": camera, "vmixInput": 10 + camera }),
        );
    }
    assert_eq!(
        pictures(&cameras)["sentence"],
        "vMix sends no picture for CAM 2. Check that vMix input 12 is still there and live."
    );
    cameras.call("cameras.select", json!({ "camera": 3 }));
    assert_eq!(
        pictures(&cameras)["sentence"],
        "vMix sends no picture for CAM 3. Check that vMix input 13 is still there and live."
    );
    // Every input off the pictures: still missing, for the source sends.
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 1, "vmixInput": 11 }),
    );
    assert_eq!(pictures(&cameras)["state"], "missing");
}

// A camera's own state lights the lamp before its picture does: the pictures
// speak only while every camera is held.
#[test]
fn a_camera_that_is_not_held_speaks_before_the_pictures() {
    let cameras = TestCameras::set_up("pictures-behind");
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 3, "vmixInput": 9 }),
    );
    cameras.call("cameras.release", json!({ "camera": 1, "confirm": true }));
    let health = cameras.health();
    assert_eq!(health.word, "RELEASED");
    // Its picture is vMix's, not the link's: a released camera keeps it.
    assert_eq!(picture(&cameras, 1)["state"], "showing");
    assert_eq!(picture(&cameras, 3)["state"], "missing");
    let _ = announced_changes();
}

// The studio's build before the pictures are built: no picture at all, and
// the page says they come with a later version. The cameras read NOT SET UP
// first.
#[test]
fn without_the_simulated_cameras_there_are_no_pictures_yet() {
    let cameras = TestCameras::without_simulation("pictures-not-built");
    assert_eq!(
        pictures(&cameras),
        json!({
            "state": "no-pictures",
            "word": "NO PICTURES",
            "tone": "attention",
            "sentence": "Studio Control shows no pictures yet: they come with a later version, over NDI from vMix on this PC.",
            "source": "not built yet",
            "note": "The cameras' own pictures come with a later version, over NDI from vMix on this PC."
        })
    );
    for camera in [1, 2, 3] {
        assert_eq!(
            picture(&cameras, camera),
            json!({
                "state": "no-pictures",
                "word": "NO PICTURE",
                "tone": "attention",
                "detail": "not built yet",
                "sentence": "No picture yet: the cameras' pictures come with a later version.",
                "advice": null
            })
        );
    }
    assert_eq!(cameras.health().word, "NOT SET UP");
}

#[test]
fn the_pictures_words_are_the_operators() {
    let simulated = TestCameras::set_up("pictures-words");
    simulated.call(
        "cameras.setup.update",
        json!({ "camera": 2, "vmixInput": 7 }),
    );
    let studio = TestCameras::without_simulation("pictures-words-studio");
    for cameras in [&simulated, &studio] {
        let snapshot = cameras.snapshot();
        let mut words = vec![snapshot["pictures"].clone()];
        words.extend(
            snapshot["cameras"]
                .as_array()
                .expect("three cameras")
                .iter()
                .map(|camera| camera["picture"].clone()),
        );
        for entry in words {
            for (_, value) in entry.as_object().expect("an object") {
                if let Some(text) = value.as_str() {
                    assert_operator_words(text);
                }
            }
        }
    }
}

#[test]
fn a_picture_state_names_itself_in_the_answers() {
    for (state, key) in [
        (PictureState::Showing, "showing"),
        (PictureState::Missing, "missing"),
        (PictureState::NoPictures, "no-pictures"),
    ] {
        assert_eq!(serde_json::to_value(state).expect("serializes"), key);
    }
}

// ---------------------------------------------------------------------------
// With the pictures helper (`pictures_helper.rs`): what it says is what shows
// ---------------------------------------------------------------------------

fn received(cameras: [(u32, bool); 3]) -> Vec<ReceivedCamera> {
    cameras
        .iter()
        .zip(1_u8..)
        .map(|((vmix_input, receiving), camera)| ReceivedCamera {
            camera,
            vmix_input: *vmix_input,
            receiving: *receiving,
        })
        .collect()
}

// The helper's word is the picture's, whatever the simulated source's rule
// would say.
#[test]
fn with_a_helper_each_picture_is_what_the_helper_receives() {
    let cameras = TestCameras::set_up("pictures-helper-running");
    set_status_for_test(
        cameras.path(),
        Some(HelperStatus::Running {
            sending: true,
            cameras: received([(1, true), (2, false), (3, true)]),
        }),
    );
    assert_eq!(picture(&cameras, 1)["state"], "showing");
    assert_eq!(picture(&cameras, 2)["state"], "missing");
    assert_eq!(
        picture(&cameras, 2)["advice"],
        "vMix sends other inputs: check that vMix input 2 is still there and live."
    );
    assert_eq!(pictures(&cameras)["word"], "PICTURE MISSING");
    assert_eq!(pictures(&cameras)["source"], "test pictures");
    assert_eq!(cameras.health().word, "PICTURE MISSING");

    set_status_for_test(
        cameras.path(),
        Some(HelperStatus::Running {
            sending: true,
            cameras: received([(1, true), (2, true), (3, true)]),
        }),
    );
    assert_eq!(pictures(&cameras)["state"], "showing");
    assert_eq!(cameras.health().word, "HELD");
}

// Board 2's `no-pictures`: the source sends nothing at all.
#[test]
fn a_helper_whose_source_sends_nothing_reads_no_pictures_from_vmix() {
    let cameras = TestCameras::set_up("pictures-helper-not-sending");
    set_status_for_test(
        cameras.path(),
        Some(HelperStatus::Running {
            sending: false,
            cameras: received([(1, false), (2, false), (3, false)]),
        }),
    );
    let whole = pictures(&cameras);
    assert_eq!(whole["state"], "no-pictures");
    assert_eq!(whole["word"], "NO PICTURES");
    assert_eq!(
        whole["sentence"],
        "No pictures from vMix. Open vMix and turn on NDI for Cameras / Calls / Audio Inputs."
    );
    assert_eq!(
        picture(&cameras, 3),
        json!({
            "state": "no-pictures",
            "word": "NO PICTURE",
            "tone": "attention",
            "detail": "nothing received",
            "sentence": "vMix is not sending CAM 3 over NDI.",
            "advice": "Either vMix is closed, or its NDI output for Cameras / Calls / Audio Inputs (Settings › Outputs) is off."
        })
    );
    let health = cameras.health();
    assert_eq!(health.word, "NO PICTURES");
    assert!(!health.raises_whole_status());
}

// While the helper starts, restarts or is missing, no picture arrives, and
// the page says why.
#[test]
fn a_helper_starting_stopped_or_missing_reads_no_pictures_and_why() {
    let cameras = TestCameras::set_up("pictures-helper-states");
    for (status, sentence, detail) in [
        (
            HelperStatus::Starting,
            "The pictures are starting.",
            "starting",
        ),
        (
            HelperStatus::Restarting,
            "The pictures stopped. Studio Control starts them again.",
            "stopped",
        ),
        (
            HelperStatus::Missing,
            "This build has no picture program, so it shows no pictures.",
            "no picture program",
        ),
    ] {
        set_status_for_test(cameras.path(), Some(status.clone()));
        let whole = pictures(&cameras);
        assert_eq!(whole["state"], "no-pictures", "{status:?}");
        assert_eq!(whole["sentence"], sentence, "{status:?}");
        assert_eq!(whole["source"], "test pictures");
        let cam1 = picture(&cameras, 1);
        assert_eq!(cam1["sentence"], sentence, "{status:?}");
        assert_eq!(cam1["detail"], detail, "{status:?}");
        assert_eq!(cam1["advice"], Value::Null);
        assert_operator_words(sentence);
    }
    set_status_for_test(cameras.path(), None);
    assert_eq!(
        pictures(&cameras)["state"],
        "showing",
        "no helper: the rule"
    );
}
