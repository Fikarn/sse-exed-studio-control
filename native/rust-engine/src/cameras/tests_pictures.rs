//! The cameras' pictures (D17, D28; `pictures.rs`): what `cameras.snapshot`
//! and `checks.cameras` say of them. A studio build reads `NO PICTURES` until
//! the pictures are built; the simulated cameras' test pictures stand in for
//! vMix inputs 1 to 4, so a camera on another input reads `PICTURE MISSING`.
//! With the pictures helper (a development run), what it says it receives is
//! what shows.

use crate::cameras::snapshot::{CameraTone, PictureState};
use crate::cameras::test_support::{announced_changes, assert_operator_words, TestCameras};
use crate::pictures_helper::{set_status_for_test, set_vmix_status_for_test, HelperStatus};
use serde_json::{json, Value};
use studio_control_protocol::pictures::{HelperProblem, PictureFormat, ReceivedCamera};

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
            "note": "Test pictures stand in for vMix inputs 1 to 4. A studio build shows vMix's Outputs 2, 3 and 4 over NDI."
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

// A run with the real cameras and no helper (a development run without the
// switch; a studio build has one): no picture at all, and the page says no
// picture program runs. The cameras read NOT SET UP first.
#[test]
fn with_the_real_cameras_and_no_helper_there_are_no_pictures() {
    let cameras = TestCameras::without_simulation("pictures-no-helper");
    assert_eq!(
        pictures(&cameras),
        json!({
            "state": "no-pictures",
            "word": "NO PICTURES",
            "tone": "attention",
            "sentence": "Studio Control starts no picture program in this run, so it shows no pictures.",
            "source": "not started",
            "note": "A studio build shows vMix's Outputs 2, 3 and 4 over NDI; a development run, its test pictures."
        })
    );
    for camera in [1, 2, 3] {
        assert_eq!(
            picture(&cameras, camera),
            json!({
                "state": "no-pictures",
                "word": "NO PICTURE",
                "tone": "attention",
                "detail": "not started",
                "sentence": "No picture in this run.",
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
            format: None,
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
            problem: None,
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
            problem: None,
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
            problem: None,
            cameras: received([(1, false), (2, false), (3, false)]),
        }),
    );
    let whole = pictures(&cameras);
    assert_eq!(whole["state"], "no-pictures");
    assert_eq!(whole["word"], "NO PICTURES");
    assert_eq!(
        whole["sentence"],
        "No pictures from vMix. Open vMix and send Outputs 2, 3 and 4 over NDI."
    );
    assert_eq!(
        picture(&cameras, 3),
        json!({
            "state": "no-pictures",
            "word": "NO PICTURE",
            "tone": "attention",
            "detail": "nothing received",
            "sentence": "vMix is not sending CAM 3 over NDI.",
            "advice": "Either vMix is closed, or its Outputs 2, 3 and 4 are not sent over NDI (Settings › Outputs)."
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
            "The picture program beside this build is missing or not its own, so it shows no pictures.",
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

// ---------------------------------------------------------------------------
// vMix's Outputs 2 to 4 (D31, D33): `npm run app -- --vmix-pictures`
// ---------------------------------------------------------------------------

fn uhd() -> PictureFormat {
    PictureFormat {
        width: 3840,
        height: 2160,
        rate_numerator: 30000,
        rate_denominator: 1001,
    }
}

// Each camera's picture is its output's: the rows say which, its size and
// its rate; the Pictures section names vMix's outputs.
#[test]
fn vmix_s_outputs_read_live_with_their_output_size_and_rate() {
    let cameras = TestCameras::set_up("pictures-vmix-live");
    let mut received = received([(1, true), (2, true), (3, true)]);
    received[0].format = Some(uhd());
    set_vmix_status_for_test(
        cameras.path(),
        HelperStatus::Running {
            sending: true,
            problem: None,
            cameras: received,
        },
    );
    assert_eq!(
        picture(&cameras, 1),
        json!({
            "state": "showing",
            "word": "LIVE",
            "tone": "ok",
            "detail": "vMix Output 2 · 3840 × 2160 · 29.97",
            "sentence": null,
            "advice": null
        })
    );
    assert_eq!(
        picture(&cameras, 2)["detail"],
        "vMix Output 3",
        "its format not known yet"
    );
    let whole = pictures(&cameras);
    assert_eq!(whole["state"], "showing");
    assert_eq!(whole["source"], "vMix Outputs 2 to 4");
    assert_eq!(
        whole["note"],
        "Over NDI from vMix on this PC: CAM 1 from Output 2, CAM 2 from Output 3, CAM 3 from Output 4."
    );
    assert_eq!(cameras.health().word, "HELD");
}

// An output that is not sent reads PICTURE MISSING, and names the output to
// check, not a vMix input.
#[test]
fn an_output_vmix_does_not_send_reads_picture_missing_with_its_output() {
    let cameras = TestCameras::set_up("pictures-vmix-missing");
    set_vmix_status_for_test(
        cameras.path(),
        HelperStatus::Running {
            sending: true,
            problem: None,
            cameras: received([(1, true), (2, true), (3, false)]),
        },
    );
    assert_eq!(
        picture(&cameras, 3),
        json!({
            "state": "missing",
            "word": "NO PICTURE",
            "tone": "attention",
            "detail": "vMix Output 4 · nothing received",
            "sentence": "vMix is not sending CAM 3 over NDI.",
            "advice": "vMix sends other outputs: check that Output 4 is on and sent over NDI (Settings › Outputs)."
        })
    );
    let whole = pictures(&cameras);
    assert_eq!(whole["word"], "PICTURE MISSING");
    assert_eq!(
        whole["sentence"],
        "vMix sends no picture for CAM 3. Check that vMix's Output 4 is on and sent over NDI."
    );
    assert_eq!(cameras.health().word, "PICTURE MISSING");
}

// A helper that takes nothing from vMix says why: not allowed, or no
// library.
#[test]
fn a_helper_that_takes_nothing_from_vmix_says_why() {
    let cameras = TestCameras::set_up("pictures-vmix-problem");
    for (problem, sentence, detail) in [
        (
            HelperProblem::NotAllowed,
            "This run does not take vMix's pictures, so it shows none.",
            "vMix Output 3 · not taken",
        ),
        (
            HelperProblem::NoLibrary,
            "NDI's library did not load, so there are no pictures from vMix.",
            "vMix Output 3 · NDI not loaded",
        ),
    ] {
        set_vmix_status_for_test(
            cameras.path(),
            HelperStatus::Running {
                sending: false,
                problem: Some(problem),
                cameras: received([(1, false), (2, false), (3, false)]),
            },
        );
        let whole = pictures(&cameras);
        assert_eq!(whole["state"], "no-pictures", "{problem:?}");
        assert_eq!(whole["word"], "NO PICTURES");
        assert_eq!(whole["sentence"], sentence);
        let cam2 = picture(&cameras, 2);
        assert_eq!(cam2["sentence"], sentence);
        assert_eq!(cam2["detail"], detail);
        assert_eq!(cam2["advice"], Value::Null);
        assert_operator_words(sentence);
        assert_operator_words(detail);
    }
    // Starting, a helper on vMix's pictures is named for them.
    set_vmix_status_for_test(cameras.path(), HelperStatus::Starting);
    assert_eq!(pictures(&cameras)["source"], "vMix Outputs 2 to 4");
    set_status_for_test(cameras.path(), None);
}

#[test]
fn vmix_s_words_are_the_operators() {
    let cameras = TestCameras::set_up("pictures-vmix-words");
    let mut received = received([(1, true), (2, true), (3, false)]);
    received[0].format = Some(uhd());
    set_vmix_status_for_test(
        cameras.path(),
        HelperStatus::Running {
            sending: true,
            problem: None,
            cameras: received,
        },
    );
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
    set_status_for_test(cameras.path(), None);
}
