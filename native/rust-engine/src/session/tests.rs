//! The session's requests on saved data of their own: what a begin and an
//! end write and answer, the refusals, the name, a damaged value, and the
//! settings across a start. Every begin makes its folder in the test's own
//! scratch folder, a simulated run's (`tests_folder.rs` has the folder's
//! own tests).

use super::commands::{
    handle_session_request, CURRENT_KEY, LAST_KEY, SESSION_KIND_UNKNOWN, SESSION_NAME_TOO_LONG,
    SESSION_NOT_RUNNING,
};
use super::folder::{folder_leaf, local_day};
use super::places::Places;
use super::snapshot::SessionKind;
use super::watch::WatchReport;
use super::{SessionError, SessionReply};
use crate::cameras::runtime::utc_time;
use crate::saved_json::complained_about;
use crate::storage::{initialize_test_database, open_connection, set_settings};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::fs;
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) const MORNING: &str = "2026-10-15T07:16:00.000Z";
pub(super) const NOON: &str = "2026-10-15T10:02:30.250Z";
pub(super) const EVENING: &str = "2026-10-15T16:40:00.000Z";

/// Saved data of its own in a temp folder, removed at the end, and the
/// places of a simulated run there: the sessions' folders go in its
/// `Sessions` folder and nowhere else. `watch` is the sessions' watch's
/// report its requests read, the test's own (none to begin with): no test
/// here touches the hardware link's board.
pub(super) struct TestSession {
    pub(super) root: PathBuf,
    pub(super) db_path: PathBuf,
    pub(super) places: Places,
    pub(super) watch: RefCell<Option<WatchReport>>,
}

impl TestSession {
    pub(super) fn new(label: &str) -> Self {
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
        let places = Places::new(true, &root);
        Self {
            root,
            db_path,
            places,
            watch: RefCell::new(None),
        }
    }

    pub(super) fn request(
        &self,
        method: &str,
        params: Value,
        at: &str,
    ) -> Result<SessionReply, SessionError> {
        handle_session_request(
            &self.db_path,
            &self.places,
            self.watch.borrow().as_ref(),
            method,
            &params,
            utc_time(at).expect("a time"),
        )
    }

    pub(super) fn begin(&self, kind: &str, name: &str, at: &str) -> Value {
        self.begin_with(json!({ "kind": kind, "name": name }), at)
    }

    pub(super) fn begin_with(&self, params: Value, at: &str) -> Value {
        let reply = self
            .request("session.begin", params, at)
            .expect("the begin is answered");
        assert_eq!(reply.event, Some("begun"));
        reply.result
    }

    pub(super) fn end(&self, at: &str) -> Value {
        let reply = self
            .request("session.end", json!({}), at)
            .expect("the end is answered");
        assert_eq!(reply.event, Some("ended"));
        reply.result
    }

    pub(super) fn snapshot(&self) -> Value {
        let reply = self
            .request("session.snapshot", json!({}), MORNING)
            .expect("the read is answered");
        assert_eq!(reply.event, None, "a read raises nothing");
        reply.result
    }

    /// The running session and the last of each kind, as the snapshot says.
    pub(super) fn sessions(&self) -> Value {
        let snapshot = self.snapshot();
        json!({ "current": snapshot["current"], "last": snapshot["last"] })
    }

    /// A setting as the database holds it, read past the hardware link.
    pub(super) fn setting(&self, key: &str) -> Option<Value> {
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

    pub(super) fn refusal(&self, method: &str, params: Value) -> SessionError {
        match self.request(method, params, NOON) {
            Ok(reply) => panic!("{method} should be refused: {:?}", reply.result),
            Err(error) => error,
        }
    }

    /// The folder a begin of `kind` named `name` at `begun_at` makes on the
    /// scratch folder.
    pub(super) fn folder(&self, kind: &str, name: &str, begun_at: &str) -> PathBuf {
        let kind = SessionKind::from_id(kind).expect("a kind");
        let day = local_day(utc_time(begun_at).expect("a time")).expect("the day");
        self.places.scratch_root.join(folder_leaf(name, kind, &day))
    }

    /// A session begun here, with its folder, and no measure of it (no
    /// watch has measured it).
    pub(super) fn session(
        &self,
        kind: &str,
        name: &str,
        begun_at: &str,
        ended_at: Option<&str>,
    ) -> Value {
        let mut session = saved_session(kind, name, begun_at, ended_at);
        session["folder"] = json!(self.folder(kind, name, begun_at).display().to_string());
        session["folderBytes"] = Value::Null;
        session
    }
}

impl Drop for TestSession {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A session as step 1 saved it, without a folder.
pub(super) fn saved_session(
    kind: &str,
    name: &str,
    begun_at: &str,
    ended_at: Option<&str>,
) -> Value {
    json!({ "kind": kind, "name": name, "begunAt": begun_at, "endedAt": ended_at })
}

/// A session saved without a folder, as it reads back: with none, and no
/// measure.
fn read_back(saved: Value) -> Value {
    let mut session = saved;
    session["folder"] = Value::Null;
    session["folderBytes"] = Value::Null;
    session
}

#[test]
fn new_saved_data_has_no_session_and_no_last() {
    let test = TestSession::new("empty");
    assert_eq!(test.sessions(), json!({ "current": null, "last": [] }));
}

#[test]
fn a_begin_writes_the_running_session_and_answers_it() {
    let test = TestSession::new("begin");
    let reply = test.begin("podcast", "Morning take", MORNING);
    let running = test.session("podcast", "Morning take", MORNING, None);
    assert_eq!(
        reply,
        json!({
            "session": running,
            "ended": null,
            "folder": { "path": running["folder"], "made": true }
        })
    );
    assert_eq!(test.setting(CURRENT_KEY), Some(running.clone()));
    // Nothing ended, so nothing became a kind's last.
    assert_eq!(test.setting(LAST_KEY), None);
    assert_eq!(test.sessions(), json!({ "current": running, "last": [] }));
}

#[test]
fn a_begin_over_a_running_session_ends_it_as_its_kinds_last() {
    let test = TestSession::new("begin-over");
    test.begin("podcast", "Morning take", MORNING);
    let reply = test.begin("webinar", "Spring launch", NOON);
    let ended = test.session("podcast", "Morning take", MORNING, Some(NOON));
    let running = test.session("webinar", "Spring launch", NOON, None);
    assert_eq!(
        (&reply["session"], &reply["ended"]),
        (&running, &ended),
        "the one ended and the one begun share the moment"
    );
    assert_eq!(test.setting(CURRENT_KEY), Some(running.clone()));
    assert_eq!(test.setting(LAST_KEY), Some(json!([ended.clone()])));
    assert_eq!(
        test.sessions(),
        json!({ "current": running, "last": [ended] })
    );
}

#[test]
fn an_end_removes_the_running_session_and_a_second_end_is_refused() {
    let test = TestSession::new("end");
    test.begin("green-screen", "", MORNING);
    let ended = test.session("green-screen", "", MORNING, Some(EVENING));
    assert_eq!(test.end(EVENING), json!({ "ended": ended }));
    assert_eq!(test.setting(CURRENT_KEY), None, "the setting is removed");
    assert_eq!(test.setting(LAST_KEY), Some(json!([ended.clone()])));
    assert_eq!(test.sessions(), json!({ "current": null, "last": [ended] }));
    assert!(
        test.folder("green-screen", "", MORNING).is_dir(),
        "an end leaves the folder as it is"
    );

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
            test.session(
                "podcast",
                "Second podcast",
                "2026-10-14T09:00:00.000Z",
                Some("2026-10-14T12:30:00.000Z")
            ),
            test.session(
                "green-screen",
                "Studio intro",
                "2026-10-13T11:00:00.000Z",
                Some("2026-10-14T09:00:00.000Z")
            ),
        ])
    );

    // A list saved with a kind twice reads with its first, the newest; a
    // session saved before sessions had folders reads with none.
    set_settings(
        &test.db_path,
        &[(
            LAST_KEY,
            json!([
                saved_session("webinar", "Newer", NOON, Some(EVENING)),
                saved_session("webinar", "Older", MORNING, Some(NOON)),
            ])
            .to_string(),
        )],
    )
    .expect("the setting is written");
    assert_eq!(
        test.snapshot()["last"],
        json!([read_back(saved_session(
            "webinar",
            "Newer",
            NOON,
            Some(EVENING)
        ))])
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
    // The test's temp folder is deep, and a new folder of this name could
    // pass the paths' 200 characters there (the review of #354): this begin
    // uses a folder that exists, which is not measured (`tests_folder.rs`
    // has the length's own test).
    let eighty = "é".repeat(80);
    let existing = test.root.display().to_string();
    assert_eq!(
        test.begin_with(
            json!({
                "kind": "podcast",
                "name": format!(" {eighty} "),
                "folder": { "mode": "existing", "path": existing }
            }),
            EVENING
        )["session"]["name"],
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
    assert_eq!(test.sessions(), json!({ "current": null, "last": [] }));
    assert!(
        !test.places.scratch_root.exists(),
        "a refused begin makes nothing"
    );

    assert_eq!(
        SessionKind::ALL.map(SessionKind::id),
        ["green-screen", "podcast", "webinar"]
    );
    for kind in SessionKind::ALL {
        assert_eq!(SessionKind::from_id(kind.id()), Some(kind));
        assert_eq!(serde_json::to_value(kind).expect("a kind"), kind.id());
    }
}

// Said once for the key: `saved_json`'s own test holds the once.
#[test]
fn a_damaged_running_session_reads_as_none_and_is_said_in_the_log() {
    let test = TestSession::new("damaged");
    let kept = saved_session("webinar", "Kept", MORNING, Some(NOON));
    set_settings(
        &test.db_path,
        &[
            (
                CURRENT_KEY,
                String::from("{\"kind\": \"podcast\", \"name\""),
            ),
            (LAST_KEY, json!([kept.clone()]).to_string()),
        ],
    )
    .expect("the settings are written");
    assert_eq!(
        test.sessions(),
        json!({ "current": null, "last": [read_back(kept.clone())] })
    );
    assert!(complained_about(CURRENT_KEY));
    // A session of a kind this build does not know does not read either.
    set_settings(
        &test.db_path,
        &[(
            CURRENT_KEY,
            saved_session("interview", "Later", MORNING, None).to_string(),
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
        Some(test.session("podcast", "Fresh", EVENING, None))
    );
    assert_eq!(
        test.snapshot()["last"],
        json!([read_back(kept)]),
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
        Some(json!([test.session("podcast", "", MORNING, Some(NOON))]))
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
        test.sessions(),
        json!({
            "current": test.session("podcast", "Morning take", NOON, None),
            "last": [test.session("green-screen", "Studio intro", MORNING, Some(NOON))]
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
