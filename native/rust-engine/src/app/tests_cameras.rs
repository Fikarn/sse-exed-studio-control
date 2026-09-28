//! The cameras through the hardware link's request loop (new pages program,
//! Slice 8): the events a request raises, the health follow-up, the Recent
//! actions rows, `checks.cameras` in `health.snapshot` and the whole status,
//! and an archive restore.

use super::tests::{app_for, TestDir};
use super::EngineApp;
use crate::action_log::{
    list_recent_actions, record_actions, ActionRecord, ActionSource, DOMAIN_AUDIO, DOMAIN_CAMERAS,
};
use crate::cameras::runtime;
use crate::cameras::test_support::take_announced;
use crate::storage::open_connection;
use serde_json::{json, Value};
use studio_control_protocol::RequestEnvelope;

fn request(app: &EngineApp, method: &str, params: Value) -> super::EngineReply {
    app.handle_request(RequestEnvelope {
        kind: String::from("request"),
        id: json!(method),
        method: String::from(method),
        params,
    })
}

fn result(app: &EngineApp, method: &str, params: Value) -> Value {
    let reply = request(app, method, params);
    assert!(reply.response.ok, "{method}: {:?}", reply.response.error);
    reply.response.result.expect("a result")
}

/// The reply's events, as (event, payload).
fn events(reply: &super::EngineReply) -> Vec<(String, Value)> {
    reply
        .events
        .iter()
        .map(|event| {
            (
                event["event"].as_str().unwrap_or_default().to_string(),
                event["payload"].clone(),
            )
        })
        .collect()
}

fn camera_rows(app: &EngineApp) -> Vec<(String, String, String, String)> {
    list_recent_actions(&app.runtime.db_path, 50)
        .expect("the action log should read")
        .into_iter()
        .filter(|row| row.domain == "cameras")
        .map(|row| (row.source, row.action, row.target, row.detail))
        .rev()
        .collect()
}

fn set_up(app: &EngineApp) {
    result(app, "cameras.setup.pair", json!({ "camera": 1 }));
    result(
        app,
        "cameras.setup.update",
        json!({ "camera": 2, "address": "172.16.16.85" }),
    );
    result(
        app,
        "cameras.setup.update",
        json!({ "camera": 3, "address": "172.16.16.86" }),
    );
}

struct Forget<'a>(&'a EngineApp);

impl Drop for Forget<'_> {
    fn drop(&mut self) {
        runtime::remove(&self.0.runtime.db_path);
    }
}

// `v1.md`: a request that changes something raises `cameras.changed {
// reason, camera }`, and `app.changed { reason: "health" }` after it when
// the check changed; a read raises nothing; a refused request changes
// nothing and raises nothing.
#[test]
fn a_camera_request_raises_cameras_changed_and_the_health_follow_up() {
    let test_dir = TestDir::new("cameras-events");
    let app = app_for(&test_dir);
    let _forget = Forget(&app);

    let reply = request(
        &app,
        "cameras.setup.update",
        json!({ "camera": 2, "address": "172.16.16.85" }),
    );
    assert!(reply.response.ok);
    assert_eq!(
        events(&reply),
        vec![
            (
                String::from("cameras.changed"),
                json!({ "reason": "setup", "camera": 2 })
            ),
            (String::from("app.changed"), json!({ "reason": "health" })),
        ]
    );
    let reply = request(&app, "cameras.select", json!({ "camera": 2 }));
    assert_eq!(
        events(&reply),
        vec![(
            String::from("cameras.changed"),
            json!({ "reason": "select", "camera": 2 })
        )],
        "the check does not change with the selection"
    );
    assert!(request(&app, "cameras.snapshot", json!({}))
        .events
        .is_empty());

    let refused = request(
        &app,
        "cameras.set",
        json!({ "camera": 2, "setting": "iso", "value": "12345" }),
    );
    assert!(!refused.response.ok);
    assert_eq!(
        refused.response.error.as_ref().map(|error| (
            error["code"].as_str().unwrap_or_default().to_string(),
            error["message"].as_str().unwrap_or_default().to_string()
        )),
        Some((
            String::from("CAMERA_VALUE_NOT_ALLOWED"),
            String::from("CAM 2 does not allow ISO 12345.")
        ))
    );
    assert!(refused.events.is_empty(), "a refusal raises nothing");
    let invalid = request(&app, "cameras.select", json!({ "camera": 7 }));
    assert_eq!(
        invalid
            .response
            .error
            .as_ref()
            .map(|error| error["code"].clone()),
        Some(json!("INVALID_PARAMS"))
    );
}

// The slice's first step 3: `checks.cameras` is in `health.snapshot`. A
// camera not set up or released lights the Cameras lamp only; a held camera
// that does not answer takes the whole status to attention at most, and the
// summary then ends with ` Cameras: ` and its sentence.
#[test]
fn the_cameras_reach_the_health_check_and_the_whole_status() {
    let test_dir = TestDir::new("cameras-health");
    let app = app_for(&test_dir);
    let _forget = Forget(&app);

    let health = result(&app, "health.snapshot", json!({}));
    let check = &health["checks"]["cameras"];
    assert_eq!(check["ok"], false);
    assert_eq!(check["status"], "attention");
    assert_eq!(check["word"], "NOT SET UP");
    assert_eq!(
        check["summary"],
        "CAM 1 is not paired. Pair it in Setup, with the camera beside you."
    );
    assert_eq!(check["recording"], false);
    assert_eq!(
        check["cameras"][2],
        json!({
            "camera": 3,
            "tag": "CAM 3",
            "state": "not-set-up",
            "word": "NOT SET UP",
            "tone": "attention",
            "sentence": "CAM 3 has no address. Enter it in Setup."
        })
    );
    assert!(
        !health["summary"].as_str().unwrap().contains("Cameras:"),
        "a camera not set up leaves the whole status alone: {health}"
    );

    set_up(&app);
    result(&app, "cameras.record.start", json!({}));
    let health = result(&app, "health.snapshot", json!({}));
    assert_eq!(health["checks"]["cameras"]["word"], "HELD");
    assert_eq!(health["checks"]["cameras"]["ok"], true);
    assert_eq!(health["checks"]["cameras"]["recording"], true);

    result(
        &app,
        "cameras.release",
        json!({ "camera": 3, "confirm": true }),
    );
    let health = result(&app, "health.snapshot", json!({}));
    assert_eq!(health["checks"]["cameras"]["word"], "RELEASED");
    assert!(!health["summary"].as_str().unwrap().contains("Cameras:"));

    take_announced();
    runtime::with_bodies(&app.runtime.db_path, |bodies| {
        bodies.set_answering(2, false)
    });
    let announced = take_announced();
    assert_eq!(
        announced,
        vec![
            (
                String::from("cameras.changed"),
                json!({ "reason": "unreachable", "camera": 2 })
            ),
            (String::from("app.changed"), json!({ "reason": "health" })),
        ]
    );
    let health = result(&app, "health.snapshot", json!({}));
    assert_eq!(health["checks"]["cameras"]["word"], "UNREACHABLE");
    assert_eq!(health["checks"]["cameras"]["status"], "error");
    // The registry is process-wide, so the other tests may have raised the
    // whole status further; it is never `ok` or `warning` here.
    let status = health["status"].as_str().unwrap();
    assert!(["attention", "error"].contains(&status), "{status}");
    assert!(
        health["summary"].as_str().unwrap().ends_with(
            " Cameras: CAM 2 does not answer at 172.16.16.85. Check that it is on and on the network."
        ),
        "{}",
        health["summary"]
    );
}

// `v1.md`'s Recent actions: the record's start and stop, the format and the
// look, Release and Connect are rows under the cameras, with Screen as who
// did it and the sentence the answer carried; the selection, a press on a
// setting and Setup leave none, and neither does a refused request.
#[test]
fn a_take_a_format_a_look_and_who_holds_a_camera_are_recent_actions() {
    let test_dir = TestDir::new("cameras-rows");
    let app = app_for(&test_dir);
    let _forget = Forget(&app);
    set_up(&app);
    result(&app, "cameras.select", json!({ "camera": 2 }));
    result(
        &app,
        "cameras.set",
        json!({ "camera": 1, "setting": "iso", "value": "800" }),
    );
    result(
        &app,
        "cameras.step",
        json!({ "camera": 2, "setting": "iso", "step": 1 }),
    );
    result(
        &app,
        "cameras.auto",
        json!({ "camera": 2, "what": "focus" }),
    );
    assert!(
        !request(&app, "cameras.record.stop", json!({ "confirm": true }))
            .response
            .ok
    );
    result(&app, "cameras.record.start", json!({}));
    result(
        &app,
        "cameras.format.set",
        json!({ "camera": 1, "frameRate": "50", "confirm": true }),
    );
    result(
        &app,
        "cameras.look.set",
        json!({ "camera": 1, "dynamicRange": "Video", "displayLutOn": false, "confirm": true }),
    );
    result(&app, "cameras.record.stop", json!({ "confirm": true }));
    result(
        &app,
        "cameras.release",
        json!({ "camera": 2, "confirm": true }),
    );
    result(&app, "cameras.connect", json!({ "camera": 2 }));
    result(
        &app,
        "cameras.setup.update",
        json!({ "camera": 3, "vmixInput": 4 }),
    );

    let row = |action: &str, target: &str, detail: &str| {
        (
            String::from("ui"),
            String::from(action),
            String::from(target),
            String::from(detail),
        )
    };
    assert_eq!(
        camera_rows(&app),
        vec![
            row("recording-started", "CAM 1", "CAM 1 started recording."),
            row("format-changed", "CAM 1", "CAM 1: 25p → 50p."),
            row(
                "look-changed",
                "CAM 1",
                "CAM 1: dynamic range Film → Video; display LUT off."
            ),
            row("recording-stopped", "CAM 1", "CAM 1 stopped recording."),
            row("released", "CAM 2", "CAM 2 released to LUMIX Tether."),
            row("held-again", "CAM 2", "CAM 2 held again."),
        ]
    );
}

// The page's Recent list (`v1.md`): `cameras.snapshot` carries the action
// log's newest five rows about the cameras, newest first, as they were
// written — the screen's and the deck's — and no row of another page. A
// read leaves no row and raises nothing.
#[test]
fn the_cameras_read_carries_their_newest_recent_actions() {
    let test_dir = TestDir::new("cameras-recent");
    let app = app_for(&test_dir);
    let _forget = Forget(&app);
    assert_eq!(
        result(&app, "cameras.snapshot", json!({}))["recent"],
        json!([])
    );

    set_up(&app);
    result(&app, "cameras.record.start", json!({}));
    result(
        &app,
        "cameras.format.set",
        json!({ "camera": 1, "frameRate": "50", "confirm": true }),
    );
    record_actions(
        &app.runtime.db_path,
        &[
            ActionRecord::new(
                ActionSource::Deck,
                DOMAIN_AUDIO,
                "mute",
                "Host",
                "Host muted",
            ),
            ActionRecord::new(
                ActionSource::Deck,
                DOMAIN_CAMERAS,
                "recording-stopped",
                "CAM 1",
                "CAM 1 stopped recording.",
            ),
        ],
    )
    .expect("the rows write");
    result(
        &app,
        "cameras.release",
        json!({ "camera": 2, "confirm": true }),
    );
    result(&app, "cameras.connect", json!({ "camera": 2 }));
    result(
        &app,
        "cameras.release",
        json!({ "camera": 3, "confirm": true }),
    );

    let reply = request(&app, "cameras.snapshot", json!({}));
    assert!(reply.events.is_empty());
    let recent = reply.response.result.expect("a result")["recent"].clone();
    let rows: Vec<(String, String, String, String)> = recent
        .as_array()
        .expect("a list")
        .iter()
        .map(|row| {
            let text = |key: &str| row[key].as_str().expect(key).to_string();
            (
                text("source"),
                text("action"),
                text("target"),
                text("detail"),
            )
        })
        .collect();
    let row = |source: &str, action: &str, target: &str, detail: &str| {
        (
            String::from(source),
            String::from(action),
            String::from(target),
            String::from(detail),
        )
    };
    assert_eq!(
        rows,
        vec![
            row("ui", "released", "CAM 3", "CAM 3 released to LUMIX Tether."),
            row("ui", "held-again", "CAM 2", "CAM 2 held again."),
            row("ui", "released", "CAM 2", "CAM 2 released to LUMIX Tether."),
            row(
                "deck",
                "recording-stopped",
                "CAM 1",
                "CAM 1 stopped recording."
            ),
            row("ui", "format-changed", "CAM 1", "CAM 1: 25p → 50p."),
        ],
        "the newest five, newest first"
    );
    let first = &recent[0];
    assert!(first["id"].as_i64().expect("an id") > recent[1]["id"].as_i64().expect("an id"));
    let at = first["at"].as_str().expect("a time");
    assert!(at.len() == 24 && at.ends_with('Z'), "{at}");
    assert_eq!(
        first.as_object().expect("a row").len(),
        6,
        "id, at, source, action, target and detail: {first}"
    );
    assert_eq!(camera_rows(&app).len(), 6, "reading wrote no row");
}

// A Recent list that cannot be read never costs the cameras their read: the
// list is `null`, and everything else is there.
#[test]
fn the_cameras_read_answers_when_the_action_log_cannot_be_read() {
    let test_dir = TestDir::new("cameras-recent-unread");
    let app = app_for(&test_dir);
    let _forget = Forget(&app);
    set_up(&app);
    result(&app, "cameras.record.start", json!({}));
    open_connection(&app.runtime.db_path)
        .expect("connection should open")
        .execute("DROP TABLE event_log", [])
        .expect("the table drops");

    for _ in 0..2 {
        let snapshot = result(&app, "cameras.snapshot", json!({}));
        assert_eq!(snapshot["recent"], Value::Null);
        assert_eq!(snapshot["cameras"][0]["state"], "held");
        assert_eq!(snapshot["cameras"][0]["recording"]["recording"], true);
    }
}

// Format 7: an archive restore writes the cameras' addresses and vMix inputs,
// sends nothing to a camera and raises `cameras.changed { reason:
// "restore", camera: null }`.
#[test]
fn an_archive_restore_brings_the_cameras_setup_back_and_sends_nothing() {
    let test_dir = TestDir::new("cameras-restore");
    let app = app_for(&test_dir);
    let _forget = Forget(&app);
    set_up(&app);
    result(
        &app,
        "cameras.setup.update",
        json!({ "camera": 3, "vmixInput": 8 }),
    );
    let path = result(&app, "support.backup.export", json!({}))["path"]
        .as_str()
        .expect("a path")
        .to_string();
    result(&app, "cameras.setup.forget", json!({ "camera": 2 }));
    result(
        &app,
        "cameras.setup.update",
        json!({ "camera": 3, "vmixInput": 3 }),
    );
    assert_eq!(
        result(&app, "cameras.snapshot", json!({}))["cameras"][1]["state"],
        "not-set-up"
    );

    let reply = request(&app, "support.backup.restore", json!({ "path": path }));
    assert!(reply.response.ok, "{:?}", reply.response.error);
    assert!(events(&reply).contains(&(
        String::from("cameras.changed"),
        json!({ "reason": "restore", "camera": null })
    )));
    let snapshot = result(&app, "cameras.snapshot", json!({}));
    assert_eq!(snapshot["cameras"][1]["state"], "held");
    assert_eq!(snapshot["cameras"][1]["setup"]["address"], "172.16.16.85");
    assert_eq!(snapshot["cameras"][2]["setup"]["vmixInput"], 8);
    assert_eq!(snapshot["cameras"][0]["setup"]["paired"], true);
    for camera in [1, 2, 3] {
        assert!(
            runtime::sent(&app.runtime.db_path, camera).is_empty(),
            "CAM {camera} was sent something"
        );
    }
}
