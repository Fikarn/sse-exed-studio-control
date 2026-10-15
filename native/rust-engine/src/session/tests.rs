//! The session's requests on saved data of their own: what a begin and an
//! end write and answer, the refusals, the name, a damaged value, and the
//! settings across a start.

use super::commands::{
    handle_session_request, CURRENT_KEY, LAST_KEY, SESSION_KIND_UNKNOWN, SESSION_NAME_TOO_LONG,
    SESSION_NOT_RUNNING,
};
use super::snapshot::SessionKind;
use super::{SessionError, SessionReply};
use crate::cameras::runtime::utc_time;
use crate::saved_json::complained_about;
use crate::storage::{initialize_test_database, open_connection, set_settings};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

const MORNING: &str = "2026-10-15T07:16:00.000Z";
const NOON: &str = "2026-10-15T10:02:30.250Z";
const EVENING: &str = "2026-10-15T16:40:00.000Z";

struct TestSession {
    root: PathBuf,
    db_path: PathBuf,
}

impl TestSession {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "studio-control-session-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&root).expect("test dir should be created");
        let db_path = root.join("studio-control.sqlite3");
        initialize_test_database(&db_path).expect("database should initialize");
        Self { root, db_path }
    }

    fn request(&self, method: &str, params: Value, at: &str) -> Result<SessionReply, SessionError> {
        handle_session_request(
            &self.db_path,
            method,
            &params,
            utc_time(at).expect("a time"),
        )
    }

    fn begin(&self, kind: &str, name: &str, at: &str) -> Value {
        let reply = self
            .request("session.begin", json!({ "kind": kind, "name": name }), at)
            .expect("the begin is answered");
        assert_eq!(reply.event, Some("begun"));
        reply.result
    }

    fn end(&self, at: &str) -> Value {
        let reply = self
            .request("session.end", json!({}), at)
            .expect("the end is answered");
        assert_eq!(reply.event, Some("ended"));
        reply.result
    }

    fn snapshot(&self) -> Value {
        let reply = self
            .request("session.snapshot", json!({}), MORNING)
            .expect("the read is answered");
        assert_eq!(reply.event, None, "a read raises nothing");
        reply.result
    }

    /// A setting as the database holds it, read past the hardware link.
    fn setting(&self, key: &str) -> Option<Value> {
        open_connection(&self.db_path)
            .expect("the database opens")
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .expect("the settings read")
            .map(|raw| serde_json::from_str(&raw).expect("the setting is JSON"))
    }

    fn refusal(&self, method: &str, params: Value) -> SessionError {
        match self.request(method, params, NOON) {
            Ok(reply) => panic!("{method} should be refused: {:?}", reply.result),
            Err(error) => error,
        }
    }
}

impl Drop for TestSession {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn session(kind: &str, name: &str, begun_at: &str, ended_at: Option<&str>) -> Value {
    json!({ "kind": kind, "name": name, "begunAt": begun_at, "endedAt": ended_at })
}

#[test]
fn new_saved_data_has_no_session_and_no_last() {
    let test = TestSession::new("empty");
    assert_eq!(test.snapshot(), json!({ "current": null, "last": [] }));
}

#[test]
fn a_begin_writes_the_running_session_and_answers_it() {
    let test = TestSession::new("begin");
    let reply = test.begin("podcast", "Morning take", MORNING);
    let running = session("podcast", "Morning take", MORNING, None);
    assert_eq!(reply, json!({ "session": running, "ended": null }));
    assert_eq!(test.setting(CURRENT_KEY), Some(running.clone()));
    // Nothing ended, so nothing became a kind's last.
    assert_eq!(test.setting(LAST_KEY), None);
    assert_eq!(test.snapshot(), json!({ "current": running, "last": [] }));
}

#[test]
fn a_begin_over_a_running_session_ends_it_as_its_kinds_last() {
    let test = TestSession::new("begin-over");
    test.begin("podcast", "Morning take", MORNING);
    let reply = test.begin("webinar", "Spring launch", NOON);
    let ended = session("podcast", "Morning take", MORNING, Some(NOON));
    let running = session("webinar", "Spring launch", NOON, None);
    assert_eq!(
        reply,
        json!({ "session": running, "ended": ended }),
        "the one ended and the one begun share the moment"
    );
    assert_eq!(test.setting(CURRENT_KEY), Some(running.clone()));
    assert_eq!(test.setting(LAST_KEY), Some(json!([ended.clone()])));
    assert_eq!(
        test.snapshot(),
        json!({ "current": running, "last": [ended] })
    );
}

#[test]
fn an_end_removes_the_running_session_and_a_second_end_is_refused() {
    let test = TestSession::new("end");
    test.begin("green-screen", "", MORNING);
    let ended = session("green-screen", "", MORNING, Some(EVENING));
    assert_eq!(test.end(EVENING), json!({ "ended": ended }));
    assert_eq!(test.setting(CURRENT_KEY), None, "the setting is removed");
    assert_eq!(test.setting(LAST_KEY), Some(json!([ended.clone()])));
    assert_eq!(test.snapshot(), json!({ "current": null, "last": [ended] }));

    assert_eq!(
        test.refusal("session.end", json!({})),
        SessionError::Refused(
            SESSION_NOT_RUNNING,
            String::from("No session is running, so there is none to end.")
        )
    );
    assert_eq!(
        test.setting(LAST_KEY),
        Some(json!([ended])),
        "a refusal writes nothing"
    );
}

#[test]
fn the_last_holds_one_session_of_each_kind_newest_first() {
    let test = TestSession::new("last");
    test.begin("podcast", "First podcast", "2026-10-13T08:00:00.000Z");
    test.begin("green-screen", "Studio intro", "2026-10-13T11:00:00.000Z");
    test.begin("podcast", "Second podcast", "2026-10-14T09:00:00.000Z");
    test.end("2026-10-14T12:30:00.000Z");
    // The webinar was never used: it has no last.
    assert_eq!(
        test.snapshot()["last"],
        json!([
            session(
                "podcast",
                "Second podcast",
                "2026-10-14T09:00:00.000Z",
                Some("2026-10-14T12:30:00.000Z")
            ),
            session(
                "green-screen",
                "Studio intro",
                "2026-10-13T11:00:00.000Z",
                Some("2026-10-14T09:00:00.000Z")
            ),
        ])
    );

    // A list saved with a kind twice reads with its first, the newest.
    set_settings(
        &test.db_path,
        &[(
            LAST_KEY,
            json!([
                session("webinar", "Newer", NOON, Some(EVENING)),
                session("webinar", "Older", MORNING, Some(NOON)),
            ])
            .to_string(),
        )],
    )
    .expect("the setting is written");
    assert_eq!(
        test.snapshot()["last"],
        json!([session("webinar", "Newer", NOON, Some(EVENING))])
    );
}

#[test]
fn the_name_is_trimmed_may_be_empty_and_has_at_most_eighty_characters() {
    let test = TestSession::new("name");
    assert_eq!(
        test.begin("webinar", "  Spring launch \n", MORNING)["session"]["name"],
        "Spring launch"
    );
    assert_eq!(test.begin("webinar", "   ", NOON)["session"]["name"], "");
    let without_a_name = test
        .request("session.begin", json!({ "kind": "podcast" }), NOON)
        .expect("a name may be left out");
    assert_eq!(without_a_name.result["session"]["name"], "");
    let with_null = test
        .request(
            "session.begin",
            json!({ "kind": "podcast", "name": null }),
            NOON,
        )
        .expect("a name may be null");
    assert_eq!(with_null.result["session"]["name"], "");

    // Eighty characters, each two bytes in UTF-8: characters are counted.
    let eighty = "é".repeat(80);
    assert_eq!(
        test.begin("podcast", &format!(" {eighty} "), EVENING)["session"]["name"],
        eighty.as_str()
    );
    let eighty_one = "a".repeat(81);
    assert_eq!(
        test.refusal(
            "session.begin",
            json!({ "kind": "podcast", "name": eighty_one })
        ),
        SessionError::Refused(
            SESSION_NAME_TOO_LONG,
            String::from("A session's name has at most 80 characters; this one has 81.")
        )
    );
    assert_eq!(
        test.snapshot()["current"]["name"],
        eighty.as_str(),
        "a refused begin leaves the running session as it was"
    );
    assert_eq!(
        test.refusal("session.begin", json!({ "kind": "podcast", "name": 7 })),
        SessionError::Invalid(String::from("name must be a string"))
    );
}

#[test]
fn a_kind_the_hardware_link_does_not_know_is_refused() {
    let test = TestSession::new("kind");
    assert_eq!(
        test.refusal("session.begin", json!({ "kind": "interview", "name": "A" })),
        SessionError::Refused(
            SESSION_KIND_UNKNOWN,
            String::from(
                "\"interview\" is not a kind of session: the kinds are green-screen, podcast and webinar."
            )
        )
    );
    for params in [
        json!({ "name": "A" }),
        json!({ "kind": 2 }),
        json!(["podcast"]),
    ] {
        assert_eq!(
            test.refusal("session.begin", params),
            SessionError::Invalid(String::from(
                "kind must be one of: green-screen, podcast, webinar"
            ))
        );
    }
    // The shape is checked before the kind: an unknown kind with a name
    // that is not a string is the shape's refusal.
    assert_eq!(
        test.refusal(
            "session.begin",
            json!({ "kind": "interview", "name": false })
        ),
        SessionError::Invalid(String::from("name must be a string"))
    );
    assert_eq!(test.snapshot(), json!({ "current": null, "last": [] }));

    assert_eq!(
        SessionKind::ALL.map(SessionKind::id),
        ["green-screen", "podcast", "webinar"]
    );
    for kind in SessionKind::ALL {
        assert_eq!(SessionKind::from_id(kind.id()), Some(kind));
        assert_eq!(serde_json::to_value(kind).expect("a kind"), kind.id());
    }
}

#[test]
fn a_damaged_running_session_reads_as_none_and_is_said_once() {
    let test = TestSession::new("damaged");
    set_settings(
        &test.db_path,
        &[
            (
                CURRENT_KEY,
                String::from("{\"kind\": \"podcast\", \"name\""),
            ),
            (
                LAST_KEY,
                json!([session("webinar", "Kept", MORNING, Some(NOON))]).to_string(),
            ),
        ],
    )
    .expect("the settings are written");
    assert_eq!(
        test.snapshot(),
        json!({
            "current": null,
            "last": [session("webinar", "Kept", MORNING, Some(NOON))]
        })
    );
    assert!(complained_about(CURRENT_KEY));
    // A session of a kind this build does not know does not read either.
    set_settings(
        &test.db_path,
        &[(
            CURRENT_KEY,
            session("interview", "Later", MORNING, None).to_string(),
        )],
    )
    .expect("the setting is written");
    assert_eq!(test.snapshot()["current"], Value::Null);
    // Nothing runs, so there is nothing to end; the next begin writes it again.
    assert!(matches!(
        test.refusal("session.end", json!({})),
        SessionError::Refused(SESSION_NOT_RUNNING, _)
    ));
    test.begin("podcast", "Fresh", EVENING);
    assert_eq!(
        test.setting(CURRENT_KEY),
        Some(session("podcast", "Fresh", EVENING, None))
    );
    assert_eq!(
        test.snapshot()["last"],
        json!([session("webinar", "Kept", MORNING, Some(NOON))]),
        "a begin that ended nothing leaves the last as they were"
    );
}

#[test]
fn a_damaged_last_reads_as_none_and_the_next_end_writes_it_again() {
    let test = TestSession::new("damaged-last");
    set_settings(&test.db_path, &[(LAST_KEY, String::from("[1, 2"))])
        .expect("the setting is written");
    assert_eq!(test.snapshot()["last"], json!([]));
    assert!(complained_about(LAST_KEY));
    test.begin("podcast", "", MORNING);
    test.end(NOON);
    assert_eq!(
        test.setting(LAST_KEY),
        Some(json!([session("podcast", "", MORNING, Some(NOON))]))
    );
}

#[test]
fn the_session_is_kept_across_a_start() {
    let test = TestSession::new("restart");
    test.begin("green-screen", "Studio intro", MORNING);
    test.begin("podcast", "Morning take", NOON);
    // The bootstrap of the next start: the upgrade steps and the defaults
    // leave the session's settings as they are.
    initialize_test_database(&test.db_path).expect("the database opens again");
    assert_eq!(
        test.snapshot(),
        json!({
            "current": session("podcast", "Morning take", NOON, None),
            "last": [session("green-screen", "Studio intro", MORNING, Some(NOON))]
        })
    );
}

#[test]
fn an_unknown_method_is_the_requests_fault() {
    let test = TestSession::new("unknown");
    assert_eq!(
        test.refusal("session.pause", json!({})),
        SessionError::Invalid(String::from("Unsupported method: session.pause"))
    );
}
