//! The Teleprompter through the hardware link's request loop (new pages
//! program, Slice 4): what the screen's requests answer, the event they
//! raise, the Recent actions rows they leave, and the page to open.

use super::tests::{app_for, TestDir};
use super::EngineApp;
use crate::action_log::list_recent_actions;
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

fn prompter_rows(app: &EngineApp) -> Vec<(String, String, String)> {
    list_recent_actions(&app.runtime.db_path, 50)
        .expect("the action log should read")
        .into_iter()
        .filter(|row| row.domain == "prompter")
        .map(|row| (row.source, row.action, row.detail))
        .rev()
        .collect()
}

// The proposal §5.5 and the ledger's Slice 4: putting a script on,
// replacing, updating and clearing are Recent actions rows, with Screen as
// who did it; a take's controls and the scripts' bookkeeping leave none, and
// a refused request leaves nothing.
#[test]
fn what_the_glass_shows_is_a_recent_action_and_a_take_is_not() {
    let test_dir = TestDir::new("prompter-rows");
    let app = app_for(&test_dir);
    let intro =
        result(&app, "prompter.script.create", json!({ "name": "Intro" }))["scriptId"].clone();
    let outro =
        result(&app, "prompter.script.create", json!({ "name": "Outro" }))["scriptId"].clone();
    result(&app, "prompter.putOn", json!({ "scriptId": intro }));
    let refused = request(&app, "prompter.putOn", json!({ "scriptId": outro }));
    assert!(!refused.response.ok);
    assert_eq!(
        refused
            .response
            .error
            .as_ref()
            .and_then(|error| error["code"].as_str()),
        Some("PROMPTER_REPLACE_NOT_CONFIRMED")
    );
    assert!(refused.events.is_empty(), "a refusal changes nothing");
    result(
        &app,
        "prompter.putOn",
        json!({ "scriptId": outro, "replace": true }),
    );
    result(
        &app,
        "prompter.script.edit",
        json!({ "scriptId": outro, "paragraphs": [{ "runs": [{ "text": "Goodbye." }] }] }),
    );
    result(&app, "prompter.update", json!({}));
    result(&app, "prompter.speed", json!({ "step": 1 }));
    result(&app, "prompter.jump", json!({ "to": "top" }));
    result(&app, "prompter.clear", json!({}));

    assert_eq!(
        prompter_rows(&app),
        vec![
            (
                String::from("ui"),
                String::from("put-on"),
                String::from("Put Intro on the prompter")
            ),
            (
                String::from("ui"),
                String::from("replaced"),
                String::from("Replaced Intro with Outro on the prompter")
            ),
            (
                String::from("ui"),
                String::from("updated"),
                String::from("Updated Outro on the prompter")
            ),
            (
                String::from("ui"),
                String::from("cleared"),
                String::from("Cleared the prompter")
            ),
        ]
    );
}

// First step 1a: a change answers with `prompter.changed` carrying the
// glass's anchor, so a view draws it at once; a read raises nothing.
#[test]
fn a_change_raises_prompter_changed_with_the_anchor() {
    let test_dir = TestDir::new("prompter-event");
    let app = app_for(&test_dir);
    let script =
        result(&app, "prompter.script.create", json!({ "name": "Talk" }))["scriptId"].clone();
    let reply = request(&app, "prompter.putOn", json!({ "scriptId": script }));
    assert_eq!(reply.events.len(), 1);
    let event = &reply.events[0];
    assert_eq!(event["event"], "prompter.changed");
    assert_eq!(event["payload"]["reason"], "put-on");
    assert_eq!(event["payload"]["anchor"]["playing"], false);
    assert_eq!(
        event["payload"]["anchor"]["place"],
        json!({ "paragraph": 0, "word": 0 })
    );
    assert!(
        event["payload"]["anchor"]["position"].is_null(),
        "not laid out yet"
    );

    assert!(request(&app, "prompter.snapshot", json!({}))
        .events
        .is_empty());
    let cleared = request(&app, "prompter.clear", json!({}));
    assert!(cleared.events[0]["payload"]["anchor"].is_null());
}

// Slice 4: `teleprompter` is a page the hardware link keeps; until the slice
// `settings.update` refused it.
#[test]
fn the_teleprompter_page_is_kept() {
    let test_dir = TestDir::new("prompter-page");
    let app = app_for(&test_dir);
    let reply = request(
        &app,
        "settings.update",
        json!({ "workspace": "teleprompter" }),
    );
    assert!(reply.response.ok, "{:?}", reply.response.error);
    let settings = result(&app, "settings.get", json!({}));
    assert_eq!(settings["shell"]["workspace"], "teleprompter");
    let refused = request(&app, "settings.update", json!({ "workspace": "cameras" }));
    assert_eq!(
        refused
            .response
            .error
            .and_then(|error| error["message"].as_str().map(str::to_string)),
        Some(String::from(
            "workspace must be one of: lighting, audio, setup, teleprompter"
        ))
    );
}

fn script_named<'a>(snapshot: &'a Value, list: &str, name: &str) -> &'a Value {
    snapshot[list]
        .as_array()
        .expect("a list")
        .iter()
        .find(|row| row["name"] == name)
        .unwrap_or_else(|| panic!("{name} should be in {list}"))
}

// Format 6 (Slice 4; the proposal §3.3): the archive carries the scripts
// with their versions, places and speeds, the removed ones and the look;
// Verify counts the scripts. A restore adds the scripts the saved data lacks,
// never removes or overwrites one — a differing text comes back as an
// earlier version — brings the look back, and never changes what the
// prompter shows, which stays paused where it was (D12).
#[test]
fn a_format_6_archive_adds_scripts_and_never_removes_one() {
    let test_dir = TestDir::new("prompter-archive");
    let app = app_for(&test_dir);
    let edit = |id: &Value, text: &str| {
        result(
            &app,
            "prompter.script.edit",
            json!({ "scriptId": id, "paragraphs": [{ "runs": [{ "text": text }] }, { "runs": [{ "text": "Second." }] }] }),
        );
    };
    let intro =
        result(&app, "prompter.script.create", json!({ "name": "Intro" }))["scriptId"].clone();
    edit(&intro, "Welcome as archived.");
    let spare =
        result(&app, "prompter.script.create", json!({ "name": "Spare" }))["scriptId"].clone();
    edit(&spare, "Spare words.");
    result(&app, "prompter.putOn", json!({ "scriptId": spare }));
    result(&app, "prompter.clear", json!({}));
    result(&app, "prompter.script.remove", json!({ "scriptId": spare }));
    result(
        &app,
        "prompter.look.update",
        json!({ "textColour": "yellow" }),
    );

    let exported = result(&app, "support.backup.export", json!({}));
    assert_eq!(exported["formatVersion"], 6);
    let path = exported["path"].as_str().expect("a path").to_string();
    let raw: Value =
        serde_json::from_slice(&std::fs::read(&path).expect("the archive reads")).expect("JSON");
    assert_eq!(raw["prompter"]["look"]["textColour"], "yellow");
    let archived: Vec<&str> = raw["prompter"]["scripts"]
        .as_array()
        .expect("scripts")
        .iter()
        .map(|script| script["name"].as_str().unwrap())
        .collect();
    assert_eq!(archived, ["Intro", "Spare"]);
    assert!(raw["prompter"]["scripts"][1]["removedAt"].is_string());
    assert_eq!(
        raw["prompter"]["scripts"][1]["versions"][0]["reason"],
        "put-on"
    );
    let verified = result(&app, "support.backup.verify", json!({ "path": path }));
    assert!(
        verified["detail"]
            .as_str()
            .is_some_and(|detail| detail.ends_with(", with 2 scripts.")),
        "{}",
        verified["detail"]
    );

    // Afterwards: Intro edited and on the prompter at paragraph 2, Spare
    // deleted for good, a new script, the look white again.
    edit(&intro, "Welcome as edited.");
    result(&app, "prompter.putOn", json!({ "scriptId": intro }));
    result(
        &app,
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 1 }),
    );
    result(&app, "prompter.script.delete", json!({ "scriptId": spare }));
    result(&app, "prompter.script.create", json!({ "name": "Newer" }));
    result(
        &app,
        "prompter.look.update",
        json!({ "textColour": "white" }),
    );
    let glass_before = result(&app, "prompter.glass.snapshot", json!({}));

    let reply = request(&app, "support.backup.restore", json!({ "path": path }));
    assert!(reply.response.ok, "{:?}", reply.response.error);
    let restored = reply.response.result.clone().expect("a result");
    assert_eq!(
        restored["detail"],
        "1 script added to the Teleprompter; 1 script came back as an earlier version of a script already here."
    );
    assert!(reply
        .events
        .iter()
        .any(|event| event["event"] == "prompter.changed"
            && event["payload"]["reason"] == "backup-restored"));

    let snapshot = result(&app, "prompter.snapshot", json!({}));
    assert_eq!(
        snapshot["look"]["textColour"], "yellow",
        "the look came back"
    );
    let names: Vec<&str> = snapshot["scripts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Intro", "Newer"], "nothing was removed");
    assert_eq!(script_named(&snapshot, "removed", "Spare")["id"], spare);
    let intro_now = result(
        &app,
        "prompter.script.snapshot",
        json!({ "scriptId": intro }),
    );
    assert_eq!(
        intro_now["paragraphs"][0]["runs"][0]["text"],
        "Welcome as edited."
    );
    assert_eq!(intro_now["versions"][0]["reason"], "from-backup");
    let spare_now = result(
        &app,
        "prompter.script.snapshot",
        json!({ "scriptId": spare }),
    );
    assert_eq!(
        spare_now["versions"][0]["reason"], "put-on",
        "its versions came back"
    );

    let glass_after = result(&app, "prompter.glass.snapshot", json!({}));
    assert_eq!(glass_after["paragraphs"], glass_before["paragraphs"]);
    assert_eq!(glass_after["scriptId"], intro);
    assert_eq!(snapshot["glass"]["playing"], false);
    assert_eq!(
        snapshot["glass"]["place"],
        json!({ "paragraph": 1, "word": 0 })
    );

    // A second restore of the same archive adds nothing more.
    let again = result(&app, "support.backup.restore", json!({ "path": path }));
    assert!(again.get("detail").is_none(), "{again}");
}

// An archive from before format 6 has no Teleprompter part: a restore
// leaves every script as it is.
#[test]
fn an_older_archive_leaves_the_scripts_alone() {
    let test_dir = TestDir::new("prompter-archive-5");
    let app = app_for(&test_dir);
    let path = result(&app, "support.backup.export", json!({}))["path"]
        .as_str()
        .unwrap()
        .to_string();
    let mut raw: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    raw["formatVersion"] = json!(5);
    raw.as_object_mut().unwrap().remove("prompter");
    std::fs::write(&path, serde_json::to_vec_pretty(&raw).unwrap()).unwrap();
    result(&app, "prompter.script.create", json!({ "name": "Kept" }));

    let verified = result(&app, "support.backup.verify", json!({ "path": path }));
    assert!(verified["detail"]
        .as_str()
        .unwrap()
        .starts_with("Backup archive, format 5, exported "));
    assert!(!verified["detail"].as_str().unwrap().contains("script"));
    let restored = result(&app, "support.backup.restore", json!({ "path": path }));
    assert!(restored.get("detail").is_none());
    let snapshot = result(&app, "prompter.snapshot", json!({}));
    assert_eq!(snapshot["scripts"][0]["name"], "Kept");
}

// Review of 2026-09-27 (M1): while the script on the glass has an edit that
// was never Updated, the archive carries its place in its own text.
#[test]
fn the_archive_carries_an_edited_glass_script_s_place_in_its_own_text() {
    let test_dir = TestDir::new("prompter-archive-edited");
    let app = app_for(&test_dir);
    let script =
        result(&app, "prompter.script.create", json!({ "name": "Talk" }))["scriptId"].clone();
    let paragraphs: Vec<Value> = (0..6)
        .map(|index| json!({ "runs": [{ "text": format!("Paragraph number {index} here.") }] }))
        .collect();
    result(
        &app,
        "prompter.script.edit",
        json!({ "scriptId": script, "paragraphs": paragraphs }),
    );
    result(&app, "prompter.putOn", json!({ "scriptId": script }));
    result(
        &app,
        "prompter.jump",
        json!({ "to": "paragraph", "paragraph": 4 }),
    );
    let edited: Vec<Value> = paragraphs
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != 1)
        .map(|(_, paragraph)| paragraph.clone())
        .collect();
    result(
        &app,
        "prompter.script.edit",
        json!({ "scriptId": script, "paragraphs": edited }),
    );
    let path = result(&app, "support.backup.export", json!({}))["path"]
        .as_str()
        .unwrap()
        .to_string();
    let raw: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(
        raw["prompter"]["scripts"][0]["place"],
        json!({ "paragraph": 3, "word": 0 })
    );
}

// Slice 5a: the shell's report of the Prompter XL goes through the request
// loop like any request. It raises `prompter.changed { reason: "screen" }`
// and, when `checks.prompter` says something else after it, `app.changed {
// reason: "health" }`, so the header's lamp follows; `health.snapshot`
// carries the check, and a Prompter XL state takes the whole status no
// further than attention (first step 1). It is never a Recent actions row.
#[test]
fn the_prompter_xl_reaches_the_health_check_and_the_lamp_follows() {
    let test_dir = TestDir::new("prompter-screen");
    let app = app_for(&test_dir);
    let health = result(&app, "health.snapshot", json!({}));
    let check = &health["checks"]["prompter"];
    assert_eq!(check["word"], "NOT CONNECTED", "until the shell reports");
    assert_eq!(check["status"], "error");
    assert_eq!(check["screen"]["reported"], false);
    assert!(
        !health["summary"].as_str().unwrap().contains("Prompter:"),
        "an unreported Prompter XL leaves the whole status alone: {health}"
    );

    let reply = request(
        &app,
        "prompter.screen.report",
        json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 }),
    );
    assert!(reply.response.ok);
    let events: Vec<(String, String)> = reply
        .events
        .iter()
        .map(|event| {
            (
                event["event"].as_str().unwrap_or_default().to_string(),
                event["payload"]["reason"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            )
        })
        .collect();
    assert_eq!(
        events,
        vec![
            (String::from("prompter.changed"), String::from("screen")),
            (String::from("app.changed"), String::from("health")),
        ]
    );
    let health = result(&app, "health.snapshot", json!({}));
    assert_eq!(health["checks"]["prompter"]["word"], "CONNECTED");
    assert_eq!(health["checks"]["prompter"]["ok"], true);
    assert_eq!(
        health["checks"]["prompter"]["screen"]["sentence"],
        "The Prompter XL is connected: 1920×1080 at 60 Hz."
    );

    let again = request(
        &app,
        "prompter.screen.report",
        json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60 }),
    );
    assert!(again.events.is_empty(), "the same report raises nothing");

    // Reported gone, it counts: the whole status goes to attention (no
    // further), and the summary Setup / Support shows says why.
    result(&app, "prompter.screen.report", json!({ "found": false }));
    let health = result(&app, "health.snapshot", json!({}));
    assert_ne!(health["status"], "ok", "{health}");
    assert!(health["summary"]
        .as_str()
        .unwrap()
        .ends_with("Prompter: Windows does not see the Prompter XL. Check its USB-C cable; it needs 15 W. The script and the place are kept, and nothing is shown on any other screen."));
    assert!(prompter_rows(&app).is_empty(), "never a Recent actions row");
}
