use super::EngineApp;
use crate::bootstrap::RuntimeContext;
use crate::control_surface::ControlSurfaceBridgeInfo;
use crate::storage::{initialize_test_database, StorageBootstrap};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};
use studio_control_protocol::RequestEnvelope;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "studio-control-engine-app-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(path.join("logs")).expect("test dir should be created");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn app_for(test_dir: &TestDir) -> EngineApp {
    let runtime = RuntimeContext {
        protocol_version: String::from("1"),
        app_data_dir: test_dir.path().to_path_buf(),
        backups_dir: test_dir.path().join("backups"),
        logs_dir: test_dir.path().join("logs"),
        log_file_path: test_dir.path().join("logs").join("engine.log"),
        db_path: test_dir.path().join("native.sqlite3"),
        update_repository_path: None,
        storage_ready: true,
        storage_bootstrap: StorageBootstrap {
            schema_version: 4,
            format_version: String::from("1"),
            journal_mode: String::from("wal"),
            integrity_check: String::from("ok"),
        },
        control_surface_token: String::from("bridge-token-for-tests"),
        control_surface_bridge: ControlSurfaceBridgeInfo {
            base_url: String::from("http://127.0.0.1:38201"),
            port: 38201,
            available: true,
            status: String::from("ready"),
            summary: String::from("Test bridge"),
            error: None,
        },
    };
    initialize_test_database(&runtime.db_path).expect("database should initialize");
    EngineApp { runtime }
}

fn parity_fixture_request(params: Value) -> RequestEnvelope {
    RequestEnvelope {
        kind: String::from("request"),
        id: json!("parity-1"),
        method: String::from("dev.parityFixture.load"),
        params,
    }
}

// 2026-09 production readiness, Slice 1 (finding F04): a release engine
// keeps the method in the contract but does not carry the handler or
// the bundled fixture payloads; it answers METHOD_UNAVAILABLE and
// touches nothing.
#[cfg(not(feature = "dev-fixtures"))]
#[test]
fn parity_fixture_unavailable_without_feature() {
    let test_dir = TestDir::new("parity-unavailable");
    let app = app_for(&test_dir);

    let reply = app.handle_request(parity_fixture_request(
        json!({ "fixtureId": "planning-empty" }),
    ));

    assert!(!reply.response.ok, "release engines must refuse the method");
    assert_eq!(
        reply
            .response
            .error
            .as_ref()
            .and_then(|error| error.get("code"))
            .and_then(Value::as_str),
        Some("METHOD_UNAVAILABLE")
    );
    assert!(reply.events.is_empty(), "a refused load emits no events");
    assert!(
        !test_dir
            .path()
            .join("parity-fixture-planning-empty.json")
            .exists(),
        "a refused load writes no fixture file"
    );
}

#[cfg(feature = "dev-fixtures")]
#[test]
fn parity_fixture_loads_with_feature() {
    let test_dir = TestDir::new("parity-available");
    let app = app_for(&test_dir);

    let reply = app.handle_request(parity_fixture_request(
        json!({ "fixtureId": "planning-empty" }),
    ));

    assert!(
        reply.response.ok,
        "a dev-fixtures engine loads the fixture (got {:?})",
        reply.response.error
    );
    assert_eq!(
        reply
            .response
            .result
            .as_ref()
            .and_then(|result| result.get("fixtureId"))
            .and_then(Value::as_str),
        Some("planning-empty")
    );
    assert_eq!(
        reply.events.len(),
        3,
        "app, commissioning and planning change events"
    );
}

// Finding F27: at the default level a request leaves no line in the log
// — neither the old per-request INFO line nor the DEBUG one.
#[test]
fn handle_request_writes_no_request_line_at_the_default_level() {
    let test_dir = TestDir::new("request-log");
    let app = app_for(&test_dir);
    let reply = app.handle_request(RequestEnvelope {
        kind: String::from("request"),
        id: json!("ping-1"),
        method: String::from("engine.ping"),
        params: json!({}),
    });
    assert!(reply.response.ok);
    let log = fs::read_to_string(app.runtime.log_file_path.as_path()).unwrap_or_default();
    assert!(!log.contains("Handling request"), "{log}");
    assert!(!log.contains("method=engine.ping"), "{log}");
}

// ---------------------------------------------------------------------------
// 2026-09 production readiness, Slice 10 (F12). These go through the real
// entry points — `handle_request` for the screen, the bridge's action
// handler for the Stream Deck — and through the process-wide preview, so
// each holds the shared-preview test guard.
// ---------------------------------------------------------------------------

fn lighting_app_for(test_dir: &TestDir) -> EngineApp {
    let app = app_for(test_dir);
    crate::storage::set_settings_owned(
        &app.runtime.db_path,
        &[
            (
                String::from(crate::commissioning::LIGHTING_BRIDGE_IP_KEY),
                String::from("127.0.0.1"),
            ),
            (
                format!(
                    "app.commissioning.check.{}.status",
                    crate::commissioning::LIGHTING_CHECK_ID
                ),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting settings should persist");
    app
}

fn request(app: &EngineApp, method: &str, params: Value) -> Value {
    let reply = app.handle_request(RequestEnvelope {
        kind: String::from("request"),
        id: json!(method),
        method: String::from(method),
        params,
    });
    assert!(
        reply.response.ok,
        "{method} should succeed (got {:?})",
        reply.response.error
    );
    reply.response.result.unwrap_or(Value::Null)
}

fn deck_light_action(app: &EngineApp, action: &str) -> Value {
    crate::control_surface::handle_control_surface_http_action(
        &app.runtime.db_path,
        "/api/deck/light-action",
        &json!({ "action": action }),
    )
    .unwrap_or_else(|error| panic!("{action} should succeed: {}", error.message()))
}

fn fixture_in<'a>(snapshot: &'a Value, list: &str, fixture_id: &str) -> &'a Value {
    snapshot[list]
        .as_array()
        .and_then(|fixtures| fixtures.iter().find(|fixture| fixture["id"] == fixture_id))
        .unwrap_or_else(|| panic!("{fixture_id} should be in {list}"))
}

// The preview the screen switches on is the preview a deck key edits: the
// engine keeps one, not one per entry point.
#[test]
fn ipc_preview_mode_is_the_preview_the_deck_edits() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = TestDir::new("shared-preview");
    let app = lighting_app_for(&test_dir);
    let before = request(&app, "lighting.snapshot", json!({}));
    let lit_before = fixture_in(&before, "fixtures", "fixture-key-left")["on"].clone();
    let monitor_before = request(&app, "lighting.dmxMonitor.snapshot", json!({}));

    request(
        &app,
        "lighting.editor.previewMode",
        json!({ "enabled": true }),
    );
    assert_eq!(deck_light_action(&app, "toggleLight")["preview"], true);

    let previewing = request(&app, "lighting.snapshot", json!({}));
    assert_eq!(previewing["previewMode"], true);
    assert_eq!(previewing["previewDirty"], true);
    assert_ne!(
        fixture_in(&previewing, "previewFixtures", "fixture-key-left")["on"],
        lit_before,
        "the screen's preview shows what the key staged"
    );
    assert_eq!(
        fixture_in(&previewing, "fixtures", "fixture-key-left")["on"],
        lit_before,
        "the rig did not move"
    );
    assert_eq!(
        request(&app, "lighting.dmxMonitor.snapshot", json!({})),
        monitor_before
    );

    request(&app, "lighting.editor.previewDiscard", json!({}));
    assert_eq!(deck_light_action(&app, "toggleLight")["preview"], false);
    let live = request(&app, "lighting.snapshot", json!({}));
    assert_eq!(live["previewMode"], false);
    assert_ne!(
        fixture_in(&live, "fixtures", "fixture-key-left")["on"],
        lit_before
    );
}

// F12, the first half. Every lighting mutation loads the whole editor state,
// changes it and writes the whole of it back; the screen's requests run on
// the IPC thread and the deck's on the bridge's workers. Twenty group
// creations from the one and twenty presses of the intensity key from the
// other, while a third thread keeps reading the snapshot: the end state is
// the sum of all forty — twenty more groups, and a fixture that started at
// 0 % standing at 20 × 5 = 100 %. Without the lighting state lock a write
// lands on top of the other side's and takes its group or its step with it.
// Twenty a side and not more: a commit waits for the disk (Slice 3), about
// 35 ms on the studio workstation, and the two sides collide on nearly every
// operation anyway, because each reads while the other is committing.
#[test]
fn deck_and_ipc_mutations_serialize_without_lost_updates() {
    const OPERATIONS: usize = 20;
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = TestDir::new("lighting-serialize");
    let app = lighting_app_for(&test_dir);
    request(
        &app,
        "lighting.fixture.update",
        json!({ "fixtureId": "fixture-key-left", "on": true, "intensity": 0 }),
    );
    let before = request(&app, "lighting.snapshot", json!({}));
    let groups_before = before["groups"].as_array().map(Vec::len).unwrap_or(0);
    let writers_done = std::sync::atomic::AtomicBool::new(false);
    let start = std::sync::Barrier::new(2);

    let snapshot_reads = std::thread::scope(|scope| {
        let screen = scope.spawn(|| {
            start.wait();
            for index in 0..OPERATIONS {
                request(
                    &app,
                    "lighting.group.create",
                    json!({ "name": format!("Serialize {index}") }),
                );
            }
        });
        let deck = scope.spawn(|| {
            start.wait();
            for _ in 0..OPERATIONS {
                deck_light_action(&app, "intensityUp");
            }
        });
        let reader = scope.spawn(|| {
            let mut reads = 0_usize;
            while !writers_done.load(std::sync::atomic::Ordering::SeqCst) {
                request(&app, "lighting.snapshot", json!({}));
                reads += 1;
            }
            reads
        });
        screen.join().expect("the screen's requests should finish");
        deck.join().expect("the deck's keys should finish");
        writers_done.store(true, std::sync::atomic::Ordering::SeqCst);
        reader.join().expect("the reader should finish")
    });
    assert!(
        snapshot_reads > 0,
        "the snapshot stayed readable throughout"
    );

    let after = request(&app, "lighting.snapshot", json!({}));
    let mut group_ids = after["groups"]
        .as_array()
        .expect("a list of groups")
        .iter()
        .map(|group| group["id"].as_str().expect("an id").to_string())
        .collect::<Vec<_>>();
    group_ids.sort();
    group_ids.dedup();
    assert_eq!(
        group_ids.len(),
        groups_before + OPERATIONS,
        "every group the screen created is there, once"
    );
    assert_eq!(
        fixture_in(&after, "fixtures", "fixture-key-left")["intensity"],
        (OPERATIONS * 5) as i64,
        "every step the deck's key took is there"
    );
}
