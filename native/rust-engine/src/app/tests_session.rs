//! The session through the hardware link's request loop (the Session page,
//! 2026-10-15): the event a begin and an end raise, the rows they leave and
//! their order, a refusal that leaves nothing, the page's word as a saved
//! page, and an archive that neither carries the session nor brings one back.

use super::tests::{app_for, TestDir};
use super::EngineApp;
use crate::action_log::{list_recent_actions, DOMAIN_SESSION};
use crate::cameras::runtime;
use crate::session::drives::{DriveRead, Space, GIB};
use crate::session::watch::{hardware_links_board, RootRead, WatchReport};
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

fn code(reply: &super::EngineReply) -> Option<String> {
    reply
        .response
        .error
        .as_ref()
        .and_then(|error| error["code"].as_str())
        .map(str::to_string)
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

/// The session's rows, oldest first, as (source, action, target, detail).
fn session_rows(app: &EngineApp) -> Vec<(String, String, String, String)> {
    list_recent_actions(&app.runtime.db_path, 50)
        .expect("the action log should read")
        .into_iter()
        .filter(|row| row.domain == DOMAIN_SESSION)
        .map(|row| (row.source, row.action, row.target, row.detail))
        .rev()
        .collect()
}

fn row(action: &str, target: &str, detail: &str) -> (String, String, String, String) {
    (
        String::from("ui"),
        String::from(action),
        String::from(target),
        String::from(detail),
    )
}

/// The restore takes the cameras' setup, which starts their runtime for this
/// saved data; the test lets it go.
struct Forget<'a>(&'a EngineApp);

impl Drop for Forget<'_> {
    fn drop(&mut self) {
        runtime::remove(&self.0.runtime.db_path);
    }
}

// `v1.md`'s "Session": a begin and an end raise `session.changed { reason }`
// in their reply, a begin over a running session one event for both; the
// rows are the screen's, the end's before the begin's; a read raises nothing
// and leaves no row, and neither does a refusal.
#[test]
fn a_begin_and_an_end_raise_session_changed_and_leave_their_rows_in_order() {
    let test_dir = TestDir::new("session-rows");
    let app = app_for(&test_dir);

    let read = request(&app, "session.snapshot", json!({}));
    let snapshot = read.response.result.clone().expect("a result");
    assert_eq!(
        (&snapshot["current"], &snapshot["last"]),
        (&Value::Null, &json!([]))
    );
    // A test is a simulated run: its sessions' folders go beside its saved
    // data (D52).
    let scratch = app.runtime.app_data_dir.join("Sessions");
    assert_eq!(
        (
            &snapshot["places"]["root"],
            &snapshot["places"]["simulated"]
        ),
        (&json!(scratch.display().to_string()), &json!(true))
    );
    // A simulated run never reads vMix.
    assert_eq!(snapshot["vmix"]["state"], "simulated");
    assert!(read.events.is_empty(), "a read raises nothing");

    let begun = request(
        &app,
        "session.begin",
        json!({ "kind": "podcast", "name": " Morning take " }),
    );
    assert!(begun.response.ok, "{:?}", begun.response.error);
    assert_eq!(
        events(&begun),
        vec![(
            String::from("session.changed"),
            json!({ "reason": "begun" })
        )]
    );
    let answer = begun.response.result.clone().expect("a result");
    assert_eq!(answer["session"]["kind"], "podcast");
    assert_eq!(answer["session"]["name"], "Morning take");
    assert_eq!(answer["session"]["endedAt"], Value::Null);
    assert_eq!(answer["ended"], Value::Null);
    assert_eq!(answer["folder"]["made"], true);
    let podcast_folder = answer["folder"]["path"]
        .as_str()
        .expect("a path")
        .to_string();
    assert!(
        std::path::Path::new(&podcast_folder).starts_with(&scratch),
        "{podcast_folder}"
    );

    let instead = request(&app, "session.begin", json!({ "kind": "webinar" }));
    assert_eq!(
        events(&instead),
        vec![(
            String::from("session.changed"),
            json!({ "reason": "begun" })
        )],
        "one event for the end and the begin"
    );
    let answer = instead.response.result.clone().expect("a result");
    assert_eq!(answer["ended"]["name"], "Morning take");
    assert_eq!(answer["ended"]["endedAt"], answer["session"]["begunAt"]);
    let webinar_folder = answer["folder"]["path"]
        .as_str()
        .expect("a path")
        .to_string();

    let ended = request(&app, "session.end", json!({}));
    assert_eq!(
        events(&ended),
        vec![(
            String::from("session.changed"),
            json!({ "reason": "ended" })
        )]
    );

    // The settings' update (D52) raises the event with its own reason.
    let updated = request(
        &app,
        "session.settings.update",
        json!({ "lowBelowGb": 300 }),
    );
    assert!(updated.response.ok, "{:?}", updated.response.error);
    assert_eq!(
        events(&updated),
        vec![(
            String::from("session.changed"),
            json!({ "reason": "settings" })
        )]
    );

    let mut expected = vec![
        row(
            "begun",
            "podcast",
            &format!(
                "Session begun: Podcast Recording · Morning take, in a new folder {podcast_folder}"
            ),
        ),
        row(
            "ended",
            "podcast",
            "Session ended: Podcast Recording · Morning take",
        ),
        row(
            "begun",
            "webinar",
            &format!("Session begun: Webinar, in a new folder {webinar_folder}"),
        ),
        row("ended", "webinar", "Session ended: Webinar"),
        row(
            "settings",
            "thresholds",
            "The disk reads Low under 300 GB and Nearly full under 50 GB.",
        ),
    ];
    assert_eq!(session_rows(&app), expected);

    // A second begin of the podcast's name on the same day uses its folder.
    let again = result(
        &app,
        "session.begin",
        json!({ "kind": "podcast", "name": "Morning take" }),
    );
    assert_eq!(
        again["folder"],
        json!({ "path": podcast_folder, "made": false })
    );
    expected.push(row(
        "begun",
        "podcast",
        &format!("Session begun: Podcast Recording · Morning take, in {podcast_folder}"),
    ));
    result(&app, "session.end", json!({}));
    expected.push(row(
        "ended",
        "podcast",
        "Session ended: Podcast Recording · Morning take",
    ));
    assert_eq!(session_rows(&app), expected);

    for (method, params, refusal) in [
        ("session.end", json!({}), "SESSION_NOT_RUNNING"),
        (
            "session.begin",
            json!({ "kind": "interview" }),
            "SESSION_KIND_UNKNOWN",
        ),
        (
            "session.begin",
            json!({ "kind": "podcast", "name": "a".repeat(81) }),
            "SESSION_NAME_TOO_LONG",
        ),
        ("session.begin", json!({}), "INVALID_PARAMS"),
        (
            "session.begin",
            json!({ "kind": "podcast", "folder": { "mode": "new", "parent": app.runtime.app_data_dir.display().to_string() } }),
            "SESSION_FOLDER_OUTSIDE_SCRATCH",
        ),
        (
            "session.settings.update",
            json!({ "lowBelowGb": 10 }),
            "SESSION_THRESHOLDS_INVALID",
        ),
        ("session.settings.update", json!({}), "INVALID_PARAMS"),
    ] {
        let refused = request(&app, method, params);
        assert!(!refused.response.ok, "{method}");
        assert_eq!(code(&refused).as_deref(), Some(refusal), "{method}");
        assert!(
            refused.events.is_empty(),
            "{method}: a refusal raises nothing"
        );
    }
    let read = request(&app, "session.snapshot", json!({}));
    assert!(read.events.is_empty());
    assert_eq!(session_rows(&app), expected, "neither leaves a row");
}

// The request reads the sessions' watch's report off the hardware link's
// board (D52). This is the one test that puts a report there: of its own
// sessions' folder, with a drive that answers, so no other test's begin is
// refused by it, and taken off at once.
#[test]
fn the_session_snapshot_reads_the_watchs_report_off_its_board() {
    let test_dir = TestDir::new("session-board");
    let app = app_for(&test_dir);
    let scratch = app.runtime.app_data_dir.join("Sessions");
    let letter = crate::session::folder::drive_letter(&scratch).expect("a lettered drive");
    let board = hardware_links_board();
    board.publish(WatchReport {
        read_at: Some(String::from("2026-10-19T08:00:00.000Z")),
        drives: vec![DriveRead {
            letter,
            name: String::from("Local Disk"),
            mapped: false,
            space: Some(Space {
                free_bytes: 900 * GIB,
                total_bytes: 3_815 * GIB,
            }),
        }],
        root: Some(RootRead {
            path: scratch.display().to_string(),
            exists: true,
            recent: Vec::new(),
        }),
        ..WatchReport::default()
    });
    let snapshot = result(&app, "session.snapshot", json!({}));
    board.clear();
    assert_eq!(snapshot["readAt"], "2026-10-19T08:00:00.000Z");
    assert_eq!(snapshot["places"]["rootExists"], true);
    assert_eq!(
        snapshot["drives"],
        json!([{ "letter": letter.to_string(), "name": "Local Disk", "mapped": false,
                 "answering": true, "freeBytes": 900 * GIB, "totalBytes": 3_815 * GIB,
                 "level": "ok" }])
    );
    assert_eq!(snapshot["sessionDrive"], letter.to_string());
    assert_eq!(
        result(&app, "session.snapshot", json!({}))["readAt"],
        Value::Null,
        "off the board, nothing is read"
    );
}

// The Session page is a page the hardware link keeps, and the default page
// stays the Overview (D47): new saved data opens there.
#[test]
fn the_session_page_is_a_saved_page_and_not_the_default() {
    let test_dir = TestDir::new("session-page");
    let app = app_for(&test_dir);
    assert_eq!(
        result(&app, "settings.get", json!({}))["shell"]["workspace"],
        "overview"
    );
    result(&app, "settings.update", json!({ "workspace": "session" }));
    assert_eq!(
        result(&app, "settings.get", json!({}))["shell"]["workspace"],
        "session"
    );
}

// The session's settings stand outside the archive: an archive does not
// carry them, and its restore leaves the running session, the last of each
// kind and the folders' settings (D52) as they were, raising no
// `session.changed`.
#[test]
fn an_archive_neither_carries_the_session_nor_brings_one_back() {
    let test_dir = TestDir::new("session-restore");
    let app = app_for(&test_dir);
    let _forget = Forget(&app);
    result(
        &app,
        "session.settings.update",
        json!({ "root": r"E:\Archived 4418", "subfolders": { "webinar": [] } }),
    );
    result(
        &app,
        "session.begin",
        json!({ "kind": "podcast", "name": "Archived on purpose 4417" }),
    );
    let path = result(&app, "support.backup.export", json!({}))["path"]
        .as_str()
        .expect("a path")
        .to_string();
    let archive = std::fs::read_to_string(&path).expect("the archive reads");
    let raw: Value = serde_json::from_str(&archive).expect("the archive is JSON");
    let keys = raw["settings"].as_object().expect("the archive's settings");
    assert!(!keys.is_empty());
    assert!(
        keys.keys().all(|key| !key.starts_with("session.")),
        "{keys:?}"
    );
    assert!(
        !archive.contains("on purpose 4417"),
        "the session's name is not in it"
    );
    assert!(
        !archive.contains("Archived 4418"),
        "nor the sessions' folder"
    );

    result(
        &app,
        "session.begin",
        json!({ "kind": "webinar", "name": "After the archive" }),
    );
    result(
        &app,
        "session.settings.update",
        json!({ "root": r"E:\After the archive" }),
    );
    let reply = request(&app, "support.backup.restore", json!({ "path": path }));
    assert!(reply.response.ok, "{:?}", reply.response.error);
    assert!(
        events(&reply)
            .iter()
            .all(|(event, _)| event != "session.changed"),
        "{:?}",
        events(&reply)
    );
    let snapshot = result(&app, "session.snapshot", json!({}));
    assert_eq!(snapshot["current"]["name"], "After the archive");
    assert_eq!(snapshot["last"][0]["name"], "Archived on purpose 4417");
    assert_eq!(snapshot["settings"]["root"], r"E:\After the archive");
    assert_eq!(snapshot["settings"]["subfolders"]["webinar"], json!([]));
}
