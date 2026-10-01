//! The `cameras.*` controls (new pages program, Slice 8): what each camera
//! reports, what each press answers, and every refusal with its code and the
//! sentence the operator reads — in the order `v1.md` sets: the request's
//! shape, not set up, released, unreachable, a setting the camera does not
//! report or offer, a value it does not allow, the second press.

use crate::cameras::simulated::CameraCommand;
use crate::cameras::test_support::{
    assert_operator_words, refusal, take_announced, TestCameras, CAM2_ADDRESS,
};
use serde_json::{json, Value};
use std::time::Duration;

fn values(camera: &Value, setting: &str) -> Value {
    camera["values"][setting].clone()
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64()
}

// D19 and the slice's first steps: new saved data holds no camera, so a
// fresh start contacts nothing; CAM 1 is selected; each camera reads NOT SET
// UP with its sentence, shows no value and keeps its model's options.
#[test]
fn a_fresh_start_holds_nothing_and_selects_cam_1() {
    let cameras = TestCameras::new("fresh");
    let snapshot = cameras.snapshot();
    assert_eq!(snapshot["selected"], 1);
    let list = snapshot["cameras"].as_array().expect("three cameras");
    assert_eq!(list.len(), 3);
    let expected = [
        (
            1,
            "CAM 1",
            "Blackmagic Pocket Cinema Camera 6K Pro",
            "bluetooth",
            "CAM 1 is not paired. Pair it in Setup, with the camera beside you.",
        ),
        (
            2,
            "CAM 2",
            "Panasonic LUMIX BGH1",
            "network",
            "CAM 2 has no address. Enter it in Setup.",
        ),
        (
            3,
            "CAM 3",
            "Panasonic LUMIX BGH1",
            "network",
            "CAM 3 has no address. Enter it in Setup.",
        ),
    ];
    for (camera, (number, tag, model, link, sentence)) in list.iter().zip(expected) {
        assert_eq!(camera["camera"], number);
        assert_eq!(camera["tag"], tag);
        assert_eq!(camera["model"], model);
        assert_eq!(camera["link"], link);
        assert_eq!(camera["state"], "not-set-up");
        assert_eq!(camera["word"], "NOT SET UP");
        assert_eq!(camera["tone"], "attention");
        assert_eq!(camera["sentence"], sentence);
        assert_operator_words(sentence);
        assert_eq!(
            camera["setup"],
            json!({
                "setUp": false, "address": null, "paired": false, "vmixInput": number,
                "vmixOutput": number + 1, "noLink": null
            })
        );
        assert_eq!(camera["readAt"], Value::Null);
        assert_eq!(values(camera, "iso")["value"], Value::Null);
        assert!(!values(camera, "iso")["options"]
            .as_array()
            .expect("options")
            .is_empty());
        assert_eq!(values(camera, "whiteBalance")["value"], Value::Null);
        assert_eq!(camera["recording"]["recording"], Value::Null);
        assert_eq!(camera["recording"]["timecode"], Value::Null);
    }
    assert!(cameras.nothing_sent());
}

// D10 and the slice's first step 4 (board 2): CAM 1 reports every value D10
// lists; the BGH1s no tint, focus position, ND, dynamic range or display
// LUT, and no recording.
#[test]
fn each_camera_reports_what_its_model_reports() {
    let cameras = TestCameras::set_up("reports");
    cameras.set_clock(1, Duration::from_millis(10 * 3_600_000 + 480));
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["state"], "held");
    assert_eq!(cam1["word"], "HELD");
    assert_eq!(cam1["tone"], "ok");
    assert_eq!(
        cam1["sentence"],
        "CAM 1 is held: Studio Control reads it and sends only what you press."
    );
    assert!(cam1["readAt"].as_str().is_some_and(|at| at.ends_with('Z')));
    let iso = values(&cam1, "iso");
    assert_eq!(iso["reported"], true);
    assert_eq!(iso["value"], "400");
    assert_eq!(iso["options"].as_array().map(Vec::len), Some(25));
    assert_eq!(iso["options"][0], "100");
    assert_eq!(iso["options"][24], "25600");
    assert_eq!(values(&cam1, "shutter")["value"], "180°");
    assert_eq!(
        values(&cam1, "shutter")["options"],
        json!(["45°", "90°", "120°", "144°", "172.8°", "180°", "216°", "270°", "360°"])
    );
    assert_eq!(values(&cam1, "iris")["value"], "f/2.8");
    assert_eq!(
        values(&cam1, "iris")["options"].as_array().map(Vec::len),
        Some(16)
    );
    assert_eq!(values(&cam1, "nd")["value"], "2 stops");
    assert_eq!(
        values(&cam1, "nd")["options"],
        json!(["Clear", "2 stops", "4 stops", "6 stops"])
    );
    let white_balance = values(&cam1, "whiteBalance");
    assert_eq!(number(&white_balance["value"]), Some(5600.0));
    assert_eq!(number(&white_balance["min"]), Some(2500.0));
    assert_eq!(number(&white_balance["max"]), Some(10000.0));
    assert_eq!(number(&white_balance["step"]), Some(50.0));
    assert_eq!(white_balance["unit"], "K");
    let tint = values(&cam1, "tint");
    assert_eq!(
        (
            number(&tint["value"]),
            number(&tint["min"]),
            number(&tint["max"]),
            number(&tint["step"])
        ),
        (Some(2.0), Some(-50.0), Some(50.0), Some(1.0))
    );
    assert_eq!(tint["unit"], "");
    let focus = values(&cam1, "focus");
    assert_eq!(
        (
            number(&focus["value"]),
            number(&focus["min"]),
            number(&focus["max"]),
            number(&focus["step"])
        ),
        (Some(0.62), Some(0.0), Some(1.0), Some(0.01))
    );
    assert_eq!(
        values(&cam1, "resolution"),
        json!({ "reported": true, "value": "6K", "options": ["HD", "UHD", "4K DCI", "6K"], "unavailable": [], "notReported": null })
    );
    assert_eq!(
        values(&cam1, "frameRate"),
        json!({ "reported": true, "value": "25", "options": ["24", "25", "30", "50", "60"], "unavailable": [{ "value": "60", "reason": "not at 6K" }], "notReported": null })
    );
    assert_eq!(values(&cam1, "dynamicRange")["value"], "Film");
    assert_eq!(
        values(&cam1, "dynamicRange")["options"],
        json!(["Film", "Extended video", "Video"])
    );
    assert_eq!(values(&cam1, "displayLut")["value"], "Film → Ext. video");
    assert_eq!(
        values(&cam1, "displayLut")["options"],
        json!(["None", "Custom", "Film → Video", "Film → Ext. video"])
    );
    assert_eq!(
        values(&cam1, "displayLutOn"),
        json!({ "reported": true, "value": true, "notReported": null })
    );
    assert_eq!(
        cam1["auto"],
        json!({ "focus": true, "whiteBalance": true, "iris": true })
    );
    assert_eq!(cam1["focusSteps"], false);
    assert_eq!(
        cam1["recording"],
        json!({
            "records": true,
            "recording": false,
            "timecode": "10:00:00:12",
            "timecodeReported": true,
            "startedAt": null,
            "cardTimeLeft": null,
            "cardTimeNotReported": "CAM 1 does not report its card time over Bluetooth."
        })
    );

    for (camera, iso_value, iris_value, iris_first, white_balance) in [
        (2u8, "800", "f/4.0", "f/4.0", 5600.0),
        (3u8, "1600", "f/2.8", "f/2.8", 4300.0),
    ] {
        let tag = format!("CAM {camera}");
        let bgh1 = cameras.camera(camera);
        assert_eq!(bgh1["state"], "held");
        assert_eq!(values(&bgh1, "iso")["value"], iso_value);
        assert_eq!(
            values(&bgh1, "iso")["options"].as_array().map(Vec::len),
            Some(28)
        );
        assert_eq!(values(&bgh1, "iso")["options"][27], "51200");
        assert_eq!(values(&bgh1, "shutter")["value"], "1/50");
        assert_eq!(
            values(&bgh1, "shutter")["options"].as_array().map(Vec::len),
            Some(18)
        );
        assert_eq!(values(&bgh1, "iris")["value"], iris_value);
        assert_eq!(values(&bgh1, "iris")["options"][0], iris_first);
        assert_eq!(
            values(&bgh1, "nd"),
            json!({ "reported": false, "value": null, "options": [], "unavailable": [], "notReported": "The BGH1 has no ND filter." })
        );
        assert_eq!(
            number(&values(&bgh1, "whiteBalance")["value"]),
            Some(white_balance)
        );
        assert_eq!(number(&values(&bgh1, "whiteBalance")["step"]), Some(100.0));
        assert_eq!(
            values(&bgh1, "tint"),
            json!({ "reported": false, "value": null, "min": 0.0, "max": 0.0, "step": 0.0, "unit": "", "notReported": format!("{tag} does not report tint.") })
        );
        assert_eq!(
            values(&bgh1, "focus")["notReported"],
            format!("{tag} does not report a focus position.")
        );
        assert_eq!(bgh1["focusSteps"], true);
        assert_eq!(
            values(&bgh1, "resolution"),
            json!({ "reported": true, "value": "FHD", "options": ["FHD", "UHD", "C4K"], "unavailable": [], "notReported": null })
        );
        assert_eq!(
            values(&bgh1, "frameRate"),
            json!({ "reported": true, "value": "25", "options": ["25", "50"], "unavailable": [], "notReported": null })
        );
        assert_eq!(
            values(&bgh1, "dynamicRange")["notReported"],
            format!("{tag} does not report its dynamic range.")
        );
        assert_eq!(
            values(&bgh1, "displayLut")["notReported"],
            format!("{tag} does not report a display LUT.")
        );
        assert_eq!(
            values(&bgh1, "displayLutOn"),
            json!({ "reported": false, "value": null, "notReported": format!("{tag} does not report a display LUT.") })
        );
        assert_eq!(
            bgh1["auto"],
            json!({ "focus": true, "whiteBalance": false, "iris": false })
        );
        assert_eq!(
            bgh1["recording"],
            json!({
                "records": false,
                "recording": null,
                "timecode": null,
                "timecodeReported": false,
                "startedAt": null,
                "cardTimeLeft": null,
                "cardTimeNotReported": null
            })
        );
    }
    assert!(cameras.nothing_sent(), "reading a camera sends it nothing");
}

// D11: one press sets a choice to one of its options or a level to a number
// on its scale and step; the answer is what the camera reports after it.
#[test]
fn a_press_sets_what_the_camera_allows() {
    let cameras = TestCameras::set_up("set");
    let reply = cameras
        .reply(
            "cameras.set",
            json!({ "camera": 1, "setting": "iso", "value": "800" }),
        )
        .expect("the press is taken");
    assert_eq!(
        reply.result,
        json!({ "camera": 1, "setting": "iso", "value": "800" })
    );
    assert_eq!(reply.event, Some(("setting", Some(1))));
    let answer = |camera: u8, setting: &str, value: Value| {
        cameras.call(
            "cameras.set",
            json!({ "camera": camera, "setting": setting, "value": value }),
        )["value"]
            .clone()
    };
    assert_eq!(
        number(&answer(1, "whiteBalance", json!(3200))),
        Some(3200.0)
    );
    assert_eq!(number(&answer(1, "tint", json!(-3))), Some(-3.0));
    assert_eq!(number(&answer(1, "focus", json!(0.25))), Some(0.25));
    assert_eq!(answer(1, "nd", json!("Clear")), "Clear");
    assert_eq!(answer(1, "shutter", json!("172.8°")), "172.8°");
    assert_eq!(answer(2, "iris", json!("f/8.0")), "f/8.0");
    assert_eq!(
        number(&answer(3, "whiteBalance", json!(3200))),
        Some(3200.0)
    );
    let cam1 = cameras.camera(1);
    assert_eq!(values(&cam1, "iso")["value"], "800");
    assert_eq!(number(&values(&cam1, "focus")["value"]), Some(0.25));
    assert_eq!(cameras.sent(1).len(), 6);
    assert_eq!(cameras.sent(2).len(), 1);

    let refused = |params: Value| cameras.refused("cameras.set", params);
    assert_eq!(
        refused(json!({ "camera": 1, "setting": "iso", "value": "12345" })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow ISO 12345."
        )
    );
    assert_eq!(
        refused(json!({ "camera": 1, "setting": "whiteBalance", "value": 5625 })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow white balance 5625."
        )
    );
    // A whole number sent as `5625.0` reads as the page writes it.
    assert_eq!(
        refused(json!({ "camera": 1, "setting": "whiteBalance", "value": 5625.0 })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow white balance 5625."
        )
    );
    assert_eq!(
        refused(json!({ "camera": 1, "setting": "tint", "value": 51 })),
        refusal("CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow tint 51.")
    );
    assert_eq!(
        refused(json!({ "camera": 1, "setting": "focus", "value": 1.5 })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow focus 1.5."
        )
    );
    assert_eq!(
        refused(json!({ "camera": 2, "setting": "shutter", "value": "180°" })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 2 does not allow shutter 180°."
        )
    );
    assert_eq!(
        refused(json!({ "camera": 2, "setting": "iris", "value": "f/2.8" })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 2 does not allow iris f/2.8."
        )
    );
    assert_eq!(
        refused(json!({ "camera": 1, "setting": "nd", "value": "3 stops" })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow ND 3 stops."
        )
    );
    assert_eq!(
        refused(json!({ "camera": 2, "setting": "nd", "value": "Clear" })),
        refusal("CAMERA_SETTING_UNSUPPORTED", "The BGH1 has no ND filter.")
    );
    assert_eq!(
        refused(json!({ "camera": 3, "setting": "tint", "value": 0 })),
        refusal("CAMERA_SETTING_UNSUPPORTED", "CAM 3 does not report tint.")
    );
    assert_eq!(
        refused(json!({ "camera": 2, "setting": "focus", "value": 0.5 })),
        refusal(
            "CAMERA_SETTING_UNSUPPORTED",
            "CAM 2 does not report a focus position."
        )
    );
    for params in [
        json!({ "camera": 4, "setting": "iso", "value": "800" }),
        json!({ "camera": "1", "setting": "iso", "value": "800" }),
        json!({ "setting": "iso", "value": "800" }),
        json!({ "camera": 1, "setting": "resolution", "value": "UHD" }),
        json!({ "camera": 1, "setting": "zoom", "value": "2x" }),
        json!({ "camera": 1, "setting": "iso", "value": 800 }),
        json!({ "camera": 1, "setting": "whiteBalance", "value": "5600" }),
        json!({ "camera": 1, "setting": "iso" }),
    ] {
        assert_eq!(
            cameras.code("cameras.set", params.clone()),
            "INVALID_PARAMS",
            "{params}"
        );
    }
    assert_eq!(cameras.sent(1).len(), 6, "a refusal sends nothing");
}

// D11: a step is a number of the camera's own steps, stopping at the ends;
// focus on a BGH1 moves nearer or farther without a position.
#[test]
fn a_step_moves_in_the_camera_s_own_steps_and_stops_at_the_ends() {
    let cameras = TestCameras::set_up("step");
    let step = |camera: u8, setting: &str, step: i64| {
        cameras.call(
            "cameras.step",
            json!({ "camera": camera, "setting": setting, "step": step }),
        )["value"]
            .clone()
    };
    assert_eq!(step(1, "iso", 1), "500");
    assert_eq!(step(1, "iso", -100), "100", "stops at the first");
    assert_eq!(step(1, "iris", 100), "f/16", "stops at the last");
    assert_eq!(step(1, "nd", 1), "4 stops");
    assert_eq!(number(&step(1, "whiteBalance", 2)), Some(5700.0));
    assert_eq!(number(&step(1, "whiteBalance", 1000)), Some(10000.0));
    assert_eq!(number(&step(1, "tint", -1)), Some(1.0));
    assert_eq!(number(&step(1, "focus", 1)), Some(0.63));
    assert_eq!(number(&step(1, "focus", -100)), Some(0.0));
    assert_eq!(
        number(&step(2, "whiteBalance", 1)),
        Some(5700.0),
        "BGH1 steps are 100 K"
    );
    assert_eq!(step(2, "shutter", -1), "1/40");

    let reply = cameras
        .reply(
            "cameras.step",
            json!({ "camera": 2, "setting": "focus", "step": -2 }),
        )
        .expect("a BGH1 focus step is taken");
    assert_eq!(
        reply.result,
        json!({ "camera": 2, "setting": "focus", "value": null })
    );
    assert_eq!(reply.event, Some(("setting", Some(2))));
    assert_eq!(cameras.sent(2).last(), Some(&CameraCommand::FocusSteps(-2)));

    assert_eq!(
        cameras.refused(
            "cameras.step",
            json!({ "camera": 3, "setting": "nd", "step": 1 })
        ),
        refusal("CAMERA_SETTING_UNSUPPORTED", "The BGH1 has no ND filter.")
    );
    assert_eq!(
        cameras.refused(
            "cameras.step",
            json!({ "camera": 2, "setting": "tint", "step": 1 })
        ),
        refusal("CAMERA_SETTING_UNSUPPORTED", "CAM 2 does not report tint.")
    );
    for params in [
        json!({ "camera": 1, "setting": "iso", "step": 0 }),
        json!({ "camera": 1, "setting": "iso", "step": 1.5 }),
        json!({ "camera": 1, "setting": "iso", "step": 1001 }),
        json!({ "camera": 1, "setting": "iso", "step": -1001 }),
        json!({ "camera": 1, "setting": "iso", "step": i64::MIN }),
        json!({ "camera": 1, "setting": "iso" }),
        json!({ "camera": 1, "setting": "frameRate", "step": 1 }),
    ] {
        assert_eq!(
            cameras.code("cameras.step", params.clone()),
            "INVALID_PARAMS",
            "{params}"
        );
    }
}

// D11: a one-shot auto the camera offers; the answer is the value it
// settles on. A BGH1 offers autofocus only, and reports no focus position.
#[test]
fn an_auto_settles_on_what_the_camera_reports() {
    let cameras = TestCameras::set_up("auto");
    let auto = |camera: u8, what: &str| {
        cameras.call("cameras.auto", json!({ "camera": camera, "what": what }))
    };
    assert_eq!(
        auto(1, "focus"),
        json!({ "camera": 1, "setting": "focus", "value": 0.5 })
    );
    assert_eq!(number(&auto(1, "whiteBalance")["value"]), Some(5600.0));
    assert_eq!(
        auto(1, "iris"),
        json!({ "camera": 1, "setting": "iris", "value": "f/4.0" })
    );
    assert_eq!(
        auto(2, "focus"),
        json!({ "camera": 2, "setting": "focus", "value": null })
    );
    assert_eq!(
        cameras.refused(
            "cameras.auto",
            json!({ "camera": 2, "what": "whiteBalance" })
        ),
        refusal(
            "CAMERA_SETTING_UNSUPPORTED",
            "CAM 2 does not offer auto white balance once."
        )
    );
    assert_eq!(
        cameras.refused("cameras.auto", json!({ "camera": 3, "what": "iris" })),
        refusal(
            "CAMERA_SETTING_UNSUPPORTED",
            "CAM 3 does not offer auto iris once."
        )
    );
    assert_eq!(
        cameras.code("cameras.auto", json!({ "camera": 1, "what": "zoom" })),
        "INVALID_PARAMS"
    );
    assert_eq!(cameras.sent(1).len(), 3);
    assert_eq!(cameras.sent(3).len(), 0);
}

// D11, D19: a format change is armed on the page (`confirm: true`); a frame
// rate the camera does not allow at the resolution is refused first; the
// answer's sentence says what changed.
#[test]
fn a_format_change_needs_a_second_press_and_says_what_changed() {
    let cameras = TestCameras::set_up("format");
    let format = |params: Value| cameras.refused("cameras.format.set", params);
    assert_eq!(
        format(json!({ "camera": 1, "frameRate": "50" })),
        refusal(
            "CAMERA_CHANGE_NOT_CONFIRMED",
            "This change needs a second press to confirm."
        )
    );
    assert_eq!(
        format(json!({ "camera": 1, "frameRate": "60", "confirm": true })),
        refusal(
            "CAMERA_FORMAT_NOT_ALLOWED",
            "CAM 1 does not allow 60p at 6K."
        )
    );
    assert_eq!(
        format(json!({ "camera": 1, "frameRate": "60" })),
        refusal(
            "CAMERA_FORMAT_NOT_ALLOWED",
            "CAM 1 does not allow 60p at 6K."
        ),
        "not allowed comes before the second press"
    );
    assert_eq!(
        format(json!({ "camera": 1, "resolution": "8K", "confirm": true })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow resolution 8K."
        )
    );
    assert_eq!(
        format(json!({ "camera": 1, "frameRate": "120", "confirm": true })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow frame rate 120."
        )
    );
    for params in [
        json!({ "camera": 1, "confirm": true }),
        json!({ "camera": 1, "frameRate": 50, "confirm": true }),
        json!({ "camera": 1, "frameRate": "50", "confirm": "yes" }),
    ] {
        assert_eq!(
            cameras.code("cameras.format.set", params.clone()),
            "INVALID_PARAMS",
            "{params}"
        );
    }
    assert!(cameras.sent(1).is_empty(), "a refusal sends nothing");

    let sentence = |params: Value| {
        let reply = cameras
            .reply("cameras.format.set", params)
            .expect("the change is taken");
        assert_eq!(reply.event.map(|(reason, _)| reason), Some("format"));
        reply.result["sentence"]
            .as_str()
            .expect("a sentence")
            .to_string()
    };
    assert_eq!(
        sentence(json!({ "camera": 1, "resolution": "UHD", "confirm": true })),
        "CAM 1: 6K → UHD."
    );
    assert_eq!(
        sentence(json!({ "camera": 1, "frameRate": "50", "confirm": true })),
        "CAM 1: 25p → 50p."
    );
    assert_eq!(
        sentence(json!({ "camera": 1, "resolution": "6K", "frameRate": "25", "confirm": true })),
        "CAM 1: UHD 50p → 6K 25p."
    );
    assert_eq!(
        sentence(json!({ "camera": 1, "resolution": "UHD", "frameRate": "60", "confirm": true })),
        "CAM 1: 6K 25p → UHD 60p."
    );
    assert_eq!(
        format(json!({ "camera": 1, "resolution": "6K", "confirm": true })),
        refusal(
            "CAMERA_FORMAT_NOT_ALLOWED",
            "CAM 1 does not allow 60p at 6K."
        ),
        "the frame rate it has now is not allowed at the new resolution"
    );
    assert_eq!(
        sentence(json!({ "camera": 2, "frameRate": "50", "confirm": true })),
        "CAM 2: 25p → 50p."
    );
    assert_eq!(
        format(json!({ "camera": 2, "resolution": "6K", "confirm": true })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 2 does not allow resolution 6K."
        )
    );
    let cam1 = cameras.camera(1);
    assert_eq!(values(&cam1, "resolution")["value"], "UHD");
    assert_eq!(values(&cam1, "frameRate")["value"], "60");
    assert_eq!(values(&cam1, "frameRate")["unavailable"], json!([]));
}

// D11, D19: the look — the picture profile and the display LUT — is armed
// too; several changes in one request are one sentence.
#[test]
fn a_look_change_needs_a_second_press_and_says_what_changed() {
    let cameras = TestCameras::set_up("look");
    let look = |params: Value| cameras.refused("cameras.look.set", params);
    assert_eq!(
        look(json!({ "camera": 1, "dynamicRange": "Video" })),
        refusal(
            "CAMERA_CHANGE_NOT_CONFIRMED",
            "This change needs a second press to confirm."
        )
    );
    assert_eq!(
        look(json!({ "camera": 1, "dynamicRange": "Log", "confirm": true })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow dynamic range Log."
        )
    );
    assert_eq!(
        look(json!({ "camera": 1, "displayLut": "Rec 709", "confirm": true })),
        refusal(
            "CAMERA_VALUE_NOT_ALLOWED",
            "CAM 1 does not allow display LUT Rec 709."
        )
    );
    assert_eq!(
        look(json!({ "camera": 2, "dynamicRange": "Video", "confirm": true })),
        refusal(
            "CAMERA_SETTING_UNSUPPORTED",
            "CAM 2 does not report its dynamic range."
        )
    );
    assert_eq!(
        look(json!({ "camera": 3, "displayLutOn": false, "confirm": true })),
        refusal(
            "CAMERA_SETTING_UNSUPPORTED",
            "CAM 3 does not report a display LUT."
        )
    );
    for params in [
        json!({ "camera": 1, "confirm": true }),
        json!({ "camera": 1, "displayLutOn": "off", "confirm": true }),
        json!({ "camera": 1, "dynamicRange": 2, "confirm": true }),
    ] {
        assert_eq!(
            cameras.code("cameras.look.set", params.clone()),
            "INVALID_PARAMS",
            "{params}"
        );
    }

    let sentence = |params: Value| {
        cameras.call("cameras.look.set", params)["sentence"]
            .as_str()
            .expect("a sentence")
            .to_string()
    };
    assert_eq!(
        sentence(
            json!({ "camera": 1, "dynamicRange": "Video", "displayLutOn": false, "confirm": true })
        ),
        "CAM 1: dynamic range Film → Video; display LUT off."
    );
    assert_eq!(
        sentence(json!({ "camera": 1, "displayLut": "Custom", "confirm": true })),
        "CAM 1: display LUT Film → Ext. video → Custom."
    );
    assert_eq!(
        sentence(json!({ "camera": 1, "displayLutOn": true, "confirm": true })),
        "CAM 1: display LUT on."
    );
    let cam1 = cameras.camera(1);
    assert_eq!(values(&cam1, "dynamicRange")["value"], "Video");
    assert_eq!(values(&cam1, "displayLut")["value"], "Custom");
    assert_eq!(values(&cam1, "displayLutOn")["value"], true);
}

// D14: the record acts on CAM 1, whichever camera is selected; the start is
// one press, the stop is armed.
#[test]
fn the_record_acts_on_cam_1_whichever_camera_is_selected() {
    let cameras = TestCameras::set_up("record");
    cameras.call("cameras.select", json!({ "camera": 3 }));
    assert_eq!(
        cameras.refused("cameras.record.stop", json!({ "confirm": true })),
        refusal("CAMERA_NOT_RECORDING", "CAM 1 is not recording.")
    );
    let reply = cameras
        .reply("cameras.record.start", json!({}))
        .expect("the take starts");
    assert_eq!(
        reply.result,
        json!({ "camera": 1, "recording": true, "sentence": "CAM 1 started recording." })
    );
    assert_eq!(reply.event, Some(("record", Some(1))));
    let cam1 = cameras.camera(1);
    assert_eq!(cam1["recording"]["recording"], true);
    assert!(
        cam1["recording"]["startedAt"].as_str().is_some(),
        "the hardware link saw the take start"
    );
    assert_eq!(cameras.snapshot()["selected"], 3);
    assert_eq!(
        cameras.refused("cameras.record.start", json!({})),
        refusal("CAMERA_ALREADY_RECORDING", "CAM 1 is already recording.")
    );
    assert_eq!(
        cameras.refused("cameras.record.stop", json!({})),
        refusal(
            "CAMERA_CHANGE_NOT_CONFIRMED",
            "This change needs a second press to confirm."
        )
    );
    assert_eq!(
        cameras.code("cameras.record.stop", json!({ "confirm": 1 })),
        "INVALID_PARAMS"
    );
    assert_eq!(
        cameras.call("cameras.record.stop", json!({ "confirm": true })),
        json!({ "camera": 1, "recording": false, "sentence": "CAM 1 stopped recording." })
    );
    assert_eq!(cameras.camera(1)["recording"]["startedAt"], Value::Null);
    assert_eq!(
        cameras.sent(1),
        vec![CameraCommand::RecordStart, CameraCommand::RecordStop]
    );
    assert!(cameras.sent(3).is_empty());

    let unpaired = TestCameras::new("record-unpaired");
    assert_eq!(
        unpaired.refused("cameras.record.start", json!({})),
        refusal(
            "CAMERA_NOT_SET_UP",
            "CAM 1 is not paired. Pair it in Setup, with the camera beside you."
        )
    );
}

// The order of the checks: the request's shape, then not set up, released,
// unreachable, and only then what the camera reports and allows.
#[test]
fn a_control_on_a_camera_that_is_not_held_is_refused_with_its_sentence() {
    let cameras = TestCameras::new("not-held");
    let iso = |camera: u8| json!({ "camera": camera, "setting": "iso", "value": "800" });
    assert_eq!(
        cameras.refused("cameras.set", iso(2)),
        refusal(
            "CAMERA_NOT_SET_UP",
            "CAM 2 has no address. Enter it in Setup."
        )
    );
    assert_eq!(
        cameras.code(
            "cameras.set",
            json!({ "camera": 2, "setting": "zoom", "value": "2x" })
        ),
        "INVALID_PARAMS",
        "the shape comes first"
    );
    cameras.call(
        "cameras.setup.update",
        json!({ "camera": 2, "address": CAM2_ADDRESS }),
    );
    cameras.call("cameras.setup.pair", json!({ "camera": 1 }));
    cameras.call("cameras.release", json!({ "camera": 2, "confirm": true }));
    assert_eq!(
        cameras.refused("cameras.set", iso(2)),
        refusal(
            "CAMERA_RELEASED",
            "CAM 2 is released. Connect it to set it from here."
        )
    );
    assert_eq!(
        cameras.refused(
            "cameras.set",
            json!({ "camera": 2, "setting": "nd", "value": "Clear" })
        ),
        refusal(
            "CAMERA_RELEASED",
            "CAM 2 is released. Connect it to set it from here."
        ),
        "released comes before a setting it does not report"
    );
    cameras.call("cameras.connect", json!({ "camera": 2 }));
    cameras.answering(2, false);
    cameras.answering(1, false);
    take_announced();
    let unreachable_2 =
        "CAM 2 does not answer at 172.16.16.85. Check that it is on and on the network.";
    let unreachable_1 =
        "CAM 1 does not answer over Bluetooth. Check that it is on and within reach of this PC.";
    assert_eq!(
        cameras.refused("cameras.set", iso(2)),
        refusal("CAMERA_UNREACHABLE", unreachable_2)
    );
    assert_eq!(
        cameras.refused(
            "cameras.format.set",
            json!({ "camera": 2, "resolution": "8K" })
        ),
        refusal("CAMERA_UNREACHABLE", unreachable_2),
        "unreachable comes before a value it does not allow and the second press"
    );
    assert_eq!(
        cameras.refused("cameras.record.start", json!({})),
        refusal("CAMERA_UNREACHABLE", unreachable_1)
    );
    assert_eq!(
        cameras.refused("cameras.auto", json!({ "camera": 1, "what": "focus" })),
        refusal("CAMERA_UNREACHABLE", unreachable_1)
    );
    for sentence in [unreachable_1, unreachable_2] {
        assert_operator_words(sentence);
    }
    assert!(cameras.nothing_sent());
}

// D13, D19: Release (armed) hands a camera back and stops reading it;
// Connect takes it back and reads it again. Neither sends anything.
#[test]
fn release_and_connect_hand_a_camera_back_and_take_it_again() {
    let cameras = TestCameras::set_up("release");
    assert_eq!(
        cameras.refused("cameras.release", json!({ "camera": 2 })),
        refusal(
            "CAMERA_CHANGE_NOT_CONFIRMED",
            "This change needs a second press to confirm."
        )
    );
    let reply = cameras
        .reply("cameras.release", json!({ "camera": 2, "confirm": true }))
        .expect("the camera is released");
    assert_eq!(
        reply.result,
        json!({ "camera": 2, "state": "released", "sentence": "CAM 2 released to LUMIX Tether." })
    );
    assert_eq!(reply.event, Some(("release", Some(2))));
    assert_eq!(
        cameras.call("cameras.release", json!({ "camera": 1, "confirm": true })),
        json!({ "camera": 1, "state": "released", "sentence": "CAM 1 released to the iPad." })
    );
    let cam2 = cameras.camera(2);
    assert_eq!(cam2["state"], "released");
    assert_eq!(cam2["word"], "RELEASED");
    assert_eq!(cam2["tone"], "attention");
    assert_eq!(
        cam2["sentence"],
        "CAM 2 is released to LUMIX Tether. Studio Control does not read it or send it anything until you connect it again."
    );
    assert_eq!(
        cameras.camera(1)["sentence"],
        "CAM 1 is released to the iPad. Studio Control does not read it or send it anything until you connect it again."
    );
    assert_eq!(cam2["readAt"], Value::Null);
    assert_eq!(values(&cam2, "iso")["value"], Value::Null);
    assert!(!values(&cam2, "iso")["options"]
        .as_array()
        .expect("options")
        .is_empty());
    assert_eq!(
        cameras.refused("cameras.release", json!({ "camera": 2, "confirm": true })),
        refusal(
            "CAMERA_RELEASED",
            "CAM 2 is released. Connect it to set it from here."
        )
    );

    let reply = cameras
        .reply("cameras.connect", json!({ "camera": 2 }))
        .expect("the camera is taken back");
    assert_eq!(
        reply.result,
        json!({ "camera": 2, "state": "held", "sentence": "CAM 2 held again." })
    );
    assert_eq!(reply.event, Some(("connect", Some(2))));
    assert_eq!(cameras.camera(2)["values"]["iso"]["value"], "800");
    assert_eq!(
        cameras.refused("cameras.connect", json!({ "camera": 2 })),
        refusal("CAMERA_ALREADY_HELD", "CAM 2 is already held.")
    );
    assert!(cameras.nothing_sent(), "release and connect send nothing");

    let fresh = TestCameras::new("release-not-set-up");
    assert_eq!(
        fresh.refused("cameras.release", json!({ "camera": 3, "confirm": true })),
        refusal(
            "CAMERA_NOT_SET_UP",
            "CAM 3 has no address. Enter it in Setup."
        )
    );
    assert_eq!(
        fresh.refused("cameras.connect", json!({ "camera": 1 })),
        refusal(
            "CAMERA_NOT_SET_UP",
            "CAM 1 is not paired. Pair it in Setup, with the camera beside you."
        )
    );
    for method in ["cameras.release", "cameras.connect"] {
        assert_eq!(fresh.code(method, json!({ "camera": 0 })), "INVALID_PARAMS");
    }
}

// D19: the selection is kept in memory; a camera not set up can be selected;
// after a start it is CAM 1. It sends nothing.
#[test]
fn the_selection_is_kept_in_memory_and_is_cam_1_after_a_start() {
    let cameras = TestCameras::new("select");
    let reply = cameras
        .reply("cameras.select", json!({ "camera": 3 }))
        .expect("a camera not set up can be selected");
    assert_eq!(reply.result, json!({ "selected": 3 }));
    assert_eq!(reply.event, Some(("select", Some(3))));
    assert!(!reply.health_changed);
    assert_eq!(cameras.snapshot()["selected"], 3);
    for params in [json!({}), json!({ "camera": 4 }), json!({ "camera": "2" })] {
        assert_eq!(
            cameras.code("cameras.select", params.clone()),
            "INVALID_PARAMS",
            "{params}"
        );
    }
    cameras.restart();
    assert_eq!(cameras.snapshot()["selected"], 1);
    assert!(cameras.nothing_sent());
}
