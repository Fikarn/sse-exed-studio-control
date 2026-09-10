//! The storage layer's tests: schema and migrations, the legacy import,
//! the integrity check at start (2026-09 production readiness, Slice 3).
//! Split out of `storage.rs` under the 2,000-line file-health guard; the
//! backup tests live with the backups in `storage_backups.rs`.

use super::*;
use crate::storage_backups::{newest_snapshot, snapshot_reason_of};
use rusqlite::OpenFlags;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process;

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
            "studio-control-engine-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test dir should be created");
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

#[test]
fn initialize_database_applies_planning_schema_and_defaults() {
    let test_dir = TestDir::new("storage-init");
    let db_path = test_dir.path().join("native.sqlite3");

    let bootstrap = initialize_test_database(&db_path).expect("database should initialize");
    assert_eq!(bootstrap.schema_version, STORAGE_SCHEMA_VERSION);
    assert_eq!(bootstrap.integrity_check, "ok");
    assert!(
        newest_snapshot(&test_dir.path().join("backups")).is_none(),
        "a brand-new database has nothing to back up before its first migration"
    );

    let planning_settings =
        list_settings_by_prefix(&db_path, crate::planning_settings::PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
    assert_eq!(
        planning_settings.get(VIEW_FILTER_KEY).map(String::as_str),
        Some("all")
    );
    assert_eq!(
        planning_settings
            .get(DASHBOARD_VIEW_KEY)
            .map(String::as_str),
        Some("kanban")
    );
}

#[test]
fn import_legacy_db_populates_planning_tables_and_settings() {
    let test_dir = TestDir::new("storage-import");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    initialize_test_database(&db_path).expect("database should initialize");

    fs::write(
        &source_path,
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": 8,
            "projects": [
                {
                    "id": "proj-1",
                    "title": "Website Redesign",
                    "description": "Marketing refresh",
                    "status": "in-progress",
                    "priority": "p1",
                    "createdAt": "2026-04-01T10:00:00.000Z",
                    "lastUpdated": "2026-04-10T10:00:00.000Z",
                    "order": 0
                }
            ],
            "tasks": [
                {
                    "id": "task-1",
                    "projectId": "proj-1",
                    "title": "Implement hero section",
                    "description": "",
                    "priority": "p1",
                    "dueDate": "2026-04-20",
                    "labels": ["frontend", "homepage"],
                    "checklist": [
                        {"id": "check-1", "text": "Wire layout", "done": true},
                        {"id": "check-2", "text": "Tune spacing", "done": false}
                    ],
                    "isRunning": true,
                    "totalSeconds": 120,
                    "lastStarted": "2026-04-15T00:00:00.000Z",
                    "completed": false,
                    "order": 0,
                    "createdAt": "2026-04-11T10:00:00.000Z"
                }
            ],
            "activityLog": [
                {
                    "id": "act-1",
                    "timestamp": "2026-04-12T10:00:00.000Z",
                    "entityType": "task",
                    "entityId": "task-1",
                    "action": "created",
                    "detail": "Task created"
                }
            ],
            "settings": {
                "viewFilter": "in-progress",
                "sortBy": "priority",
                "selectedProjectId": "proj-1",
                "selectedTaskId": "task-1",
                "dashboardView": "lighting",
                "deckMode": "light",
                "hasCompletedSetup": true
            }
        }))
        .expect("legacy payload should serialize"),
    )
    .expect("legacy db should be written");

    let summary = import_legacy_db(
        &db_path,
        &LegacyImportRequest {
            source_path: source_path.clone(),
            force: false,
        },
    )
    .expect("legacy import should succeed");

    assert_eq!(summary.imported_projects, 1);
    assert_eq!(summary.imported_tasks, 1);
    assert_eq!(summary.imported_checklist_items, 2);
    assert_eq!(summary.imported_activity_entries, 1);
    assert_eq!(summary.normalized_running_tasks, 1);

    let connection = open_connection(&db_path).expect("sqlite should open");

    let project_count = count_rows(&connection, "projects").expect("project count should load");
    let task_count = count_rows(&connection, "tasks").expect("task count should load");
    let checklist_count =
        count_rows(&connection, "task_checklist_items").expect("checklist count should load");
    let activity_count =
        count_rows(&connection, "activity_log").expect("activity count should load");

    assert_eq!(project_count, 1);
    assert_eq!(task_count, 1);
    assert_eq!(checklist_count, 2);
    assert_eq!(activity_count, 1);

    let task_row = connection
        .query_row(
            "SELECT is_running, total_seconds, last_started, labels_json FROM tasks WHERE id = 'task-1'",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .expect("task row should exist");

    assert_eq!(task_row.0, 0);
    assert!(task_row.1 >= 120);
    assert_eq!(task_row.2, None);
    assert_eq!(task_row.3, "[\"frontend\",\"homepage\"]");

    let planning_settings =
        list_settings_by_prefix(&db_path, crate::planning_settings::PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
    assert_eq!(
        planning_settings.get(VIEW_FILTER_KEY).map(String::as_str),
        Some("in-progress")
    );
    assert_eq!(
        planning_settings.get(SORT_BY_KEY).map(String::as_str),
        Some("priority")
    );
    assert_eq!(
        planning_settings
            .get(DASHBOARD_VIEW_KEY)
            .map(String::as_str),
        Some("lighting")
    );
    assert_eq!(
        planning_settings.get(DECK_MODE_KEY).map(String::as_str),
        Some("light")
    );
    assert_eq!(
        planning_settings
            .get(SELECTED_PROJECT_ID_KEY)
            .map(String::as_str),
        Some("proj-1")
    );
    assert_eq!(
        planning_settings
            .get(SELECTED_TASK_ID_KEY)
            .map(String::as_str),
        Some("task-1")
    );

    let shell_settings =
        list_settings_by_prefix(&db_path, crate::shell_settings::SHELL_SETTINGS_PREFIX)
            .expect("shell settings should load");
    assert_eq!(
        shell_settings.get(WORKSPACE_KEY).map(String::as_str),
        Some("lighting")
    );

    let app_settings = list_settings_by_prefix(&db_path, crate::app_state::APP_SETTINGS_PREFIX)
        .expect("app settings should load");
    assert_eq!(
        app_settings
            .get(COMMISSIONING_COMPLETED_KEY)
            .map(String::as_str),
        Some("true")
    );
    assert_eq!(
        app_settings
            .get(COMMISSIONING_STAGE_KEY)
            .map(String::as_str),
        Some("ready")
    );
}

#[test]
fn import_legacy_db_requires_force_when_data_already_exists() {
    let test_dir = TestDir::new("storage-force");
    let db_path = test_dir.path().join("native.sqlite3");
    let source_path = test_dir.path().join("legacy-db.json");
    initialize_test_database(&db_path).expect("database should initialize");

    fs::write(
        &source_path,
        serde_json::to_vec_pretty(&json!({
            "projects": [{"id": "proj-1", "title": "Imported", "status": "todo", "lastUpdated": "2026-04-10T10:00:00.000Z"}],
            "tasks": [],
            "activityLog": [],
            "settings": {}
        }))
        .expect("legacy payload should serialize"),
    )
    .expect("legacy db should be written");

    import_legacy_db(
        &db_path,
        &LegacyImportRequest {
            source_path: source_path.clone(),
            force: false,
        },
    )
    .expect("initial import should succeed");

    let error = import_legacy_db(
        &db_path,
        &LegacyImportRequest {
            source_path,
            force: false,
        },
    )
    .expect_err("second import without force should fail");

    assert!(matches!(
        error,
        ImportLegacyError::ExistingDataRequiresForce
    ));
}

#[test]
fn migrate_schema_is_idempotent() {
    let test_dir = TestDir::new("storage-migrate-idempotent");
    let db_path = test_dir.path().join("native.sqlite3");

    initialize_test_database(&db_path).expect("initial migration should succeed");

    let mut connection = open_connection(&db_path).expect("connection should open");
    let resolved = migrate_schema(&mut connection, &test_dir.path().join("backups"))
        .expect("second migration should succeed");
    assert_eq!(resolved, STORAGE_SCHEMA_VERSION);

    let version_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            [STORAGE_SCHEMA_VERSION],
            |row| row.get(0),
        )
        .expect("count should query");
    assert_eq!(version_count, 1);
}

#[test]
fn migrate_schema_v2_db_loads_on_v3_binary() {
    let test_dir = TestDir::new("storage-migrate-v2-v3");
    let db_path = test_dir.path().join("native.sqlite3");

    {
        let connection = open_connection(&db_path).expect("connection should open");
        connection
            .execute_batch(
                r#"
                CREATE TABLE schema_migrations (
                  version INTEGER PRIMARY KEY,
                  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO schema_migrations(version) VALUES (1);
                CREATE TABLE projects (
                  id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  description TEXT NOT NULL,
                  status TEXT NOT NULL,
                  priority TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  last_updated TEXT NOT NULL,
                  sort_order INTEGER NOT NULL
                );
                CREATE TABLE tasks (
                  id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                  title TEXT NOT NULL,
                  description TEXT NOT NULL,
                  priority TEXT NOT NULL,
                  due_date TEXT,
                  labels_json TEXT NOT NULL,
                  is_running INTEGER NOT NULL DEFAULT 0,
                  total_seconds INTEGER NOT NULL DEFAULT 0,
                  last_started TEXT,
                  completed INTEGER NOT NULL DEFAULT 0,
                  sort_order INTEGER NOT NULL,
                  created_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations(version) VALUES (2);
                INSERT INTO projects(id, title, description, status, priority, created_at, last_updated, sort_order)
                  VALUES ('p1', 'Legacy project', '', 'todo', 'p1', '2026-04-20T10:00:00Z', '2026-04-20T10:00:00Z', 0);
                INSERT INTO tasks(id, project_id, title, description, priority, due_date, labels_json, is_running, total_seconds, last_started, completed, sort_order, created_at)
                  VALUES ('t1', 'p1', 'Legacy task', '', 'p1', NULL, '[]', 0, 0, NULL, 0, 0, '2026-04-20T10:00:00Z');
                "#,
            )
            .expect("v2 schema should seed");
    }

    initialize_test_database(&db_path).expect("migration to current schema should succeed");

    let connection = open_connection(&db_path).expect("connection should reopen");
    let (scheduled_start, scheduled_duration): (Option<String>, Option<i64>) = connection
        .query_row(
            "SELECT scheduled_start, scheduled_duration_seconds FROM tasks WHERE id = 't1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("row should load");
    assert!(scheduled_start.is_none());
    assert!(scheduled_duration.is_none());

    let version_3_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
            [],
            |row| row.get(0),
        )
        .expect("count should query");
    assert_eq!(version_3_count, 1);
    let version_4_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
            [],
            |row| row.get(0),
        )
        .expect("count should query");
    assert_eq!(version_4_count, 1);
}

#[test]
fn initialize_database_records_format_version_metadata() {
    let test_dir = TestDir::new("storage-format-version");
    let db_path = test_dir.path().join("native.sqlite3");

    let bootstrap = initialize_test_database(&db_path).expect("database should initialize");
    assert_eq!(bootstrap.format_version, STORAGE_FORMAT_VERSION_INITIAL);

    let connection = open_connection(&db_path).expect("connection should open");
    let stored: String = connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'storage.format_version'",
            [],
            |row| row.get(0),
        )
        .expect("format_version row should exist");
    assert_eq!(stored, STORAGE_FORMAT_VERSION_INITIAL);
}

#[test]
fn migrate_schema_v3_to_v4_copies_legacy_lighting_key_when_canonical_missing() {
    let test_dir = TestDir::new("storage-v4-legacy-only");
    let db_path = test_dir.path().join("native.sqlite3");

    seed_v3_database(&db_path);
    set_settings_owned(
        &db_path,
        &[(
            String::from("app.control_surface.lighting.state"),
            String::from(r#"{"groups":[],"removed_fixture_ids":[],"fixtures":[],"scenes":[]}"#),
        )],
    )
    .expect("legacy seed should write");

    initialize_test_database(&db_path).expect("v4 migration should succeed");

    let settings = list_settings_by_prefix(&db_path, "app.").expect("settings should load");
    assert!(
        settings.contains_key("app.lighting.editor.state"),
        "canonical lighting key should be populated from legacy"
    );
    assert!(
        !settings.contains_key("app.control_surface.lighting.state"),
        "legacy lighting key should be removed"
    );
}

#[test]
fn migrate_schema_v3_to_v4_canonical_lighting_key_wins_over_legacy() {
    let test_dir = TestDir::new("storage-v4-canonical-wins");
    let db_path = test_dir.path().join("native.sqlite3");

    seed_v3_database(&db_path);
    let canonical_value = String::from(
        r#"{"groups":[{"id":"g1","name":"Stage"}],"removed_fixture_ids":[],"fixtures":[],"scenes":[]}"#,
    );
    set_settings_owned(
        &db_path,
        &[
            (
                String::from("app.lighting.editor.state"),
                canonical_value.clone(),
            ),
            (
                String::from("app.control_surface.lighting.state"),
                String::from(r#"{"groups":[],"removed_fixture_ids":[],"fixtures":[],"scenes":[]}"#),
            ),
        ],
    )
    .expect("dual seed should write");

    initialize_test_database(&db_path).expect("v4 migration should succeed");

    let settings = list_settings_by_prefix(&db_path, "app.").expect("settings should load");
    let migrated_state: Value = serde_json::from_str(
        settings
            .get("app.lighting.editor.state")
            .expect("canonical lighting key should exist"),
    )
    .expect("canonical lighting state should parse");
    assert_eq!(
        migrated_state
            .pointer("/groups/0/id")
            .and_then(Value::as_str),
        Some("g1"),
        "canonical lighting key should win over legacy"
    );
    assert_eq!(
        migrated_state
            .get("palettes")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(8),
        "v6 palette seed should still apply after canonical wins"
    );
    assert!(
        !settings.contains_key("app.control_surface.lighting.state"),
        "legacy lighting key should be removed"
    );
}

#[test]
fn migrate_schema_v3_to_v4_drops_per_fixture_state_keys() {
    let test_dir = TestDir::new("storage-v4-per-fixture-cleanup");
    let db_path = test_dir.path().join("native.sqlite3");

    seed_v3_database(&db_path);
    set_settings_owned(
        &db_path,
        &[
            (
                String::from("app.lighting.fixture.fixture-key-left.intensity"),
                String::from("80"),
            ),
            (
                String::from("app.lighting.fixture.fixture-key-left.cct"),
                String::from("4500"),
            ),
            (
                String::from("app.lighting.fixture.fixture-key-left.on"),
                String::from("true"),
            ),
            (
                String::from("app.lighting.fixture.fixture-other.intensity"),
                String::from("42"),
            ),
        ],
    )
    .expect("per-fixture seed should write");

    initialize_test_database(&db_path).expect("v4 migration should succeed");

    let settings = list_settings_by_prefix(&db_path, "app.lighting.fixture.")
        .expect("lighting fixture settings should load");
    assert!(
        settings.is_empty(),
        "all per-fixture lighting keys should be deleted, got: {:?}",
        settings.keys().collect::<Vec<_>>()
    );
}

// 2026-09 production readiness, Slice 3 (F13): the SQL-only steps (v4,
// v5) still commit, but the v6 step, which rewrites the lighting editor
// state, refuses an unreadable value instead of silently skipping it —
// the operator learns about the damage at start-up, with a pre-migration
// backup already written, rather than months later. (Before this slice
// the test asserted that the whole migration succeeded despite the bad
// JSON.)
#[test]
fn migrate_schema_refuses_malformed_editor_state_json_at_the_blob_step() {
    let test_dir = TestDir::new("storage-v4-malformed-json");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");

    seed_v3_database(&db_path);
    set_settings_owned(
        &db_path,
        &[(
            String::from("app.lighting.editor.state"),
            String::from("not valid json {{ broken"),
        )],
    )
    .expect("malformed seed should write");

    let error = initialize_database(&db_path, &backups_dir)
        .expect_err("the blob migration must refuse unreadable editor state");
    match error.downcast_ref::<StorageError>() {
        Some(StorageError::MigrationFailed { key, .. }) => {
            assert_eq!(key, "app.lighting.editor.state");
        }
        other => panic!("expected StorageError::MigrationFailed, got {other:?} ({error})"),
    }

    let connection = open_connection(&db_path).expect("connection should open");
    let max_version: i64 = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("max version should query");
    assert_eq!(
        max_version, 5,
        "the SQL-only steps commit; the refused blob step does not"
    );
    let stored: String = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'app.lighting.editor.state'",
            [],
            |row| row.get(0),
        )
        .expect("value should still exist");
    assert_eq!(
        stored, "not valid json {{ broken",
        "the unreadable value is left exactly as it was"
    );
    let backup = newest_snapshot(&backups_dir).expect("a pre-migration backup should exist");
    assert!(
        backup.to_string_lossy().ends_with("-pre-migration.sqlite3"),
        "{}",
        backup.display()
    );
}

#[test]
fn migrate_schema_v4_to_v5_purges_cue_keys() {
    let test_dir = TestDir::new("storage-v5-cue-purge");
    let db_path = test_dir.path().join("native.sqlite3");

    seed_v3_database(&db_path);
    set_settings_owned(
        &db_path,
        &[
            (
                String::from("app.lighting.cues"),
                String::from(r#"[{"id":"cue-custom-1","ordinal":1,"label":"Stale"}]"#),
            ),
            (
                String::from("app.lighting.active_cue_id"),
                String::from("cue-custom-1"),
            ),
            (
                String::from("shell.lighting.selectedCueId"),
                String::from("cue-custom-1"),
            ),
            (
                String::from("app.lighting.editor.state"),
                String::from(r#"{"fixtures":[],"groups":[],"scenes":[]}"#),
            ),
        ],
    )
    .expect("cue seed should write");

    initialize_test_database(&db_path).expect("v5 migration should succeed");

    let lighting =
        list_settings_by_prefix(&db_path, "app.lighting.").expect("lighting settings should load");
    assert!(
        !lighting.contains_key("app.lighting.cues"),
        "app.lighting.cues should be purged",
    );
    assert!(
        !lighting.contains_key("app.lighting.active_cue_id"),
        "app.lighting.active_cue_id should be purged",
    );
    // Sanity: editor state survives — only cue keys are dropped.
    assert!(lighting.contains_key("app.lighting.editor.state"));

    let shell = list_settings_by_prefix(&db_path, "shell.lighting.")
        .expect("shell lighting settings should load");
    assert!(
        !shell.contains_key("shell.lighting.selectedCueId"),
        "shell.lighting.selectedCueId should be purged",
    );

    let connection = open_connection(&db_path).expect("connection should open");
    let version_5_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 5",
            [],
            |row| row.get(0),
        )
        .expect("count should query");
    assert_eq!(version_5_count, 1);
}

#[test]
fn migrate_schema_v5_to_v6_seeds_lighting_palettes() {
    let test_dir = TestDir::new("storage-v6-palette-seed");
    let db_path = test_dir.path().join("native.sqlite3");

    seed_v3_database(&db_path);
    let legacy_state = json!({
        "groups": [{ "id": "group-stage", "name": "Stage", "colorIndex": 4 }],
        "groupOrder": ["group-stage"],
        "removed_fixture_ids": [],
        "fixtures": [],
        "scenes": [{ "id": "scene-prep", "name": "Prep", "fixtureStates": [], "colorIndex": 3 }],
        "sceneOrder": ["scene-prep"],
        "pinnedSceneIds": ["scene-prep"]
    });
    set_settings_owned(
        &db_path,
        &[(
            String::from("app.lighting.editor.state"),
            serde_json::to_string(&legacy_state).expect("state should serialize"),
        )],
    )
    .expect("lighting seed should write");

    initialize_test_database(&db_path).expect("v6 migration should succeed");

    let settings =
        list_settings_by_prefix(&db_path, "app.lighting.").expect("lighting settings should load");
    let state: serde_json::Value = serde_json::from_str(
        settings
            .get("app.lighting.editor.state")
            .expect("editor state should exist"),
    )
    .expect("editor state should parse");
    assert_eq!(
        state
            .get("palettes")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len),
        Some(8)
    );
    assert_eq!(
        state
            .get("paletteOrder")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len),
        Some(8)
    );
    assert_eq!(
        state
            .pointer("/groups/0/colorIndex")
            .and_then(serde_json::Value::as_i64),
        Some(4)
    );
    assert_eq!(
        state
            .pointer("/scenes/0/colorIndex")
            .and_then(serde_json::Value::as_i64),
        Some(3)
    );

    let connection = open_connection(&db_path).expect("connection should open");
    let version_6_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
            [],
            |row| row.get(0),
        )
        .expect("count should query");
    assert_eq!(version_6_count, 1);
}

#[test]
fn migrate_schema_v5_to_v6_preserves_existing_lighting_palettes() {
    let test_dir = TestDir::new("storage-v6-palette-preserve");
    let db_path = test_dir.path().join("native.sqlite3");

    seed_v3_database(&db_path);
    let existing_state = json!({
        "groups": [{ "id": "group-stage", "name": "Stage", "colorIndex": 4 }],
        "groupOrder": ["group-stage"],
        "removed_fixture_ids": [],
        "fixtures": [],
        "scenes": [{ "id": "scene-prep", "name": "Prep", "fixtureStates": [], "colorIndex": 3 }],
        "sceneOrder": ["scene-prep"],
        "pinnedSceneIds": ["scene-prep"],
        "palettes": [{
            "id": "palette-custom-9",
            "name": "Interview",
            "kind": "cct",
            "value": 4300.0,
            "colorIndex": 1
        }]
    });
    set_settings_owned(
        &db_path,
        &[(
            String::from("app.lighting.editor.state"),
            serde_json::to_string(&existing_state).expect("state should serialize"),
        )],
    )
    .expect("lighting seed should write");

    initialize_test_database(&db_path).expect("v6 migration should succeed");

    let settings =
        list_settings_by_prefix(&db_path, "app.lighting.").expect("lighting settings should load");
    let state: serde_json::Value = serde_json::from_str(
        settings
            .get("app.lighting.editor.state")
            .expect("editor state should exist"),
    )
    .expect("editor state should parse");
    let palettes = state
        .get("palettes")
        .and_then(serde_json::Value::as_array)
        .expect("palettes should be an array");
    assert_eq!(palettes.len(), 1);
    assert_eq!(
        palettes[0].get("id").and_then(serde_json::Value::as_str),
        Some("palette-custom-9")
    );
    assert_eq!(
        state
            .pointer("/paletteOrder/0")
            .and_then(serde_json::Value::as_str),
        Some("palette-custom-9")
    );
    assert_eq!(
        state
            .pointer("/pinnedSceneIds/0")
            .and_then(serde_json::Value::as_str),
        Some("scene-prep")
    );
    assert_eq!(
        state
            .pointer("/groups/0/colorIndex")
            .and_then(serde_json::Value::as_i64),
        Some(4)
    );
}

// plan PR 7 / workstream E4: storage forward-compat guard. Asserts that
// a DB at a schema version newer than the current binary refuses to
// initialise with a recoverable, operator-readable error (not a panic,
// not a silent corruption). AGENTS.md rollback posture: "rollback to a
// prior tag must remain a reinstall-away". This test enforces that on
// the storage layer.
#[test]
fn initialize_database_rejects_a_db_newer_than_the_current_binary() {
    let test_dir = TestDir::new("storage-future-schema");
    let db_path = test_dir.path().join("native.sqlite3");

    // First boot to current schema, then forge a future version row
    // on top so the migration loop sees a schema_version that's
    // STORAGE_SCHEMA_VERSION + 1.
    initialize_test_database(&db_path).expect("bootstrap should succeed at current version");
    let future_version: i64 = STORAGE_SCHEMA_VERSION + 1;
    {
        let connection = open_connection(&db_path).expect("connection should open");
        connection
            .execute(
                "INSERT INTO schema_migrations(version) VALUES (?1)",
                [future_version],
            )
            .expect("future version row should insert");
    }

    let error = initialize_test_database(&db_path)
        .expect_err("downgraded engine should refuse a DB it does not understand");
    let message = error.to_string();
    assert!(
        message.contains(&future_version.to_string()),
        "error should name the unsupported schema version (got: {message})"
    );
    assert!(
        message.contains(&STORAGE_SCHEMA_VERSION.to_string()),
        "error should name the binary's max supported version (got: {message})"
    );
    assert!(
        message.contains("Reinstall") || message.contains("backup"),
        "error should describe an operator-readable next step (got: {message})"
    );
}

// plan PR 8 / workstream E7: concurrent DB access. Documents what
// happens when two engine instances try to share the same SQLite file.
// The plan accepts either "the second instance waits" or "the second
// instance fails clearly" — what it forbids is silent corruption. This
// test pins whichever behavior the production code ships today so a
// future refactor can't drift without surfacing it.
#[test]
fn second_engine_against_same_db_either_succeeds_or_returns_recoverable_error() {
    let test_dir = TestDir::new("storage-concurrent");
    let db_path = test_dir.path().join("native.sqlite3");

    // First engine: full bootstrap. Captures the schema version this
    // binary expects.
    let first_bootstrap = initialize_test_database(&db_path).expect("first bootstrap must succeed");

    // Second engine call against the same file. Outcome is either Ok
    // (SQLite's locking permits the re-entry) or Err (database is
    // locked) — both are valid; silent corruption is the forbidden
    // case.
    let second = initialize_test_database(&db_path);

    match second {
        Ok(second_bootstrap) => {
            assert_eq!(
                second_bootstrap.schema_version, first_bootstrap.schema_version,
                "concurrent second bootstrap must agree on the schema version"
            );
        }
        Err(error) => {
            let message = error.to_string().to_lowercase();
            // SQLite surfaces lock contention as "database is locked"
            // or "busy"; assert the message points at the recoverable
            // class so a future refactor can't smuggle in a panic via
            // a different error path.
            assert!(
                message.contains("lock") || message.contains("busy"),
                "concurrent bootstrap failure must be a recoverable lock error, got: {error}"
            );
        }
    }

    // After both calls, the schema_migrations table must still be
    // intact — the documented anti-pattern of "two engines silently
    // corrupted the DB" would show up as a missing/duplicated row
    // here.
    let connection =
        open_connection(&db_path).expect("should re-open db after concurrent bootstraps");
    let max_version: i64 = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("schema_migrations should still be readable");
    assert_eq!(
        max_version, first_bootstrap.schema_version,
        "schema_migrations max version must equal what the first bootstrap reported"
    );
}

// 2026-09 production readiness, Slice 3 (F21): every write waits for the
// disk (`synchronous = FULL`, PRAGMA value 2).
#[test]
fn connection_uses_synchronous_full() {
    let test_dir = TestDir::new("storage-synchronous");
    let db_path = test_dir.path().join("native.sqlite3");

    let connection = open_connection(&db_path).expect("connection should open");
    let synchronous: i64 = connection
        .pragma_query_value(None, "synchronous", |row| row.get(0))
        .expect("synchronous pragma should read");
    assert_eq!(synchronous, 2, "PRAGMA synchronous must read FULL (2)");
}

// 2026-09 production readiness, Slice 3 (F02): a file SQLite cannot read
// as a database, and a database whose pages are damaged, both stop the
// bootstrap as StorageError::Corrupt before any migration or default
// touches them; the file is left as it was.
#[test]
fn initialize_refuses_corrupt_database() {
    let test_dir = TestDir::new("storage-corrupt");
    let backups_dir = test_dir.path().join("backups");

    let junk_path = test_dir.path().join("junk.sqlite3");
    let junk = b"this is not a database\n".repeat(200);
    fs::write(&junk_path, &junk).expect("junk should write");
    let error = initialize_database(&junk_path, &backups_dir)
        .expect_err("a file that is not a database must be refused");
    match error.downcast_ref::<StorageError>() {
        Some(StorageError::Corrupt { db_path, detail }) => {
            assert_eq!(db_path, &junk_path);
            assert!(!detail.is_empty(), "the detail carries SQLite's wording");
        }
        other => panic!("expected StorageError::Corrupt, got {other:?} ({error})"),
    }
    assert_eq!(
        fs::read(&junk_path).expect("junk should still exist"),
        junk,
        "the refused file is left untouched"
    );

    let damaged_path = test_dir.path().join("damaged.sqlite3");
    initialize_database(&damaged_path, &backups_dir).expect("database should initialize");
    let mut bytes = fs::read(&damaged_path).expect("database should read");
    assert!(
        bytes.len() > 8192,
        "the initialized database should span several pages, got {} bytes",
        bytes.len()
    );
    // A valid header with a damaged second page: its b-tree page header
    // and its cell area are overwritten.
    for byte in &mut bytes[4096..4096 + 16] {
        *byte = 0xFF;
    }
    for byte in &mut bytes[8192 - 512..8192] {
        *byte = 0xFF;
    }
    fs::write(&damaged_path, &bytes).expect("damaged database should write");
    let error = initialize_database(&damaged_path, &backups_dir)
        .expect_err("a database with a damaged page must be refused");
    assert!(
        matches!(
            error.downcast_ref::<StorageError>(),
            Some(StorageError::Corrupt { .. })
        ),
        "expected StorageError::Corrupt, got {error}"
    );
    assert_eq!(
        fs::read(&damaged_path).expect("damaged database should still exist"),
        bytes,
        "the refused file is left untouched"
    );
}

// 2026-09 production readiness, Slice 3 (F13): upgrading an existing
// database leaves a verified copy of what it held before the upgrade; a
// start at the current version writes none.
#[test]
fn migration_snapshots_before_upgrading_v5() {
    let test_dir = TestDir::new("storage-premigration");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");

    seed_v5_database(&db_path);
    set_settings_owned(
        &db_path,
        &[(
            String::from("app.lighting.editor.state"),
            String::from(r#"{"fixtures":[],"groups":[],"scenes":[]}"#),
        )],
    )
    .expect("lighting seed should write");

    let bootstrap =
        initialize_database(&db_path, &backups_dir).expect("v6 migration should succeed");
    assert_eq!(bootstrap.schema_version, STORAGE_SCHEMA_VERSION);

    let backup = newest_snapshot(&backups_dir).expect("a pre-migration backup should exist");
    assert!(
        backup.to_string_lossy().ends_with("-pre-migration.sqlite3"),
        "{}",
        backup.display()
    );
    let copy = Connection::open_with_flags(&backup, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("backup should open");
    let copy_version: i64 = copy
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("backup version should read");
    assert_eq!(
        copy_version, 5,
        "the backup holds the database as it was before the upgrade"
    );
    let copy_state: String = copy
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'app.lighting.editor.state'",
            [],
            |row| row.get(0),
        )
        .expect("backup state should read");
    assert!(!copy_state.contains("palettes"));
    drop(copy);

    initialize_database(&db_path, &backups_dir).expect("second start should succeed");
    let backups = fs::read_dir(&backups_dir)
        .expect("backups dir should list")
        .filter_map(Result::ok)
        .filter(|entry| snapshot_reason_of(&entry.file_name().to_string_lossy()).is_some())
        .count();
    assert_eq!(
        backups, 1,
        "a start at the current version writes no backup"
    );
}

// 2026-09 production readiness, Slice 3 (F13): a blob migration that
// cannot read the stored value fails as StorageError::MigrationFailed,
// its transaction rolls back (the schema version stays at 5, the value is
// untouched), the pre-migration backup is already on disk, and repairing
// the value lets the same database upgrade.
#[test]
fn blob_migration_failure_rolls_back() {
    let test_dir = TestDir::new("storage-blob-rollback");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");

    seed_v5_database(&db_path);
    set_settings_owned(
        &db_path,
        &[(
            String::from("app.lighting.editor.state"),
            String::from(r#"{"fixtures": ["#),
        )],
    )
    .expect("truncated seed should write");

    let error = initialize_database(&db_path, &backups_dir)
        .expect_err("a truncated editor state must fail the v6 migration");
    match error.downcast_ref::<StorageError>() {
        Some(StorageError::MigrationFailed { key, detail }) => {
            assert_eq!(key, "app.lighting.editor.state");
            assert!(!detail.is_empty());
        }
        other => panic!("expected StorageError::MigrationFailed, got {other:?} ({error})"),
    }

    {
        let connection = open_connection(&db_path).expect("connection should open");
        let max_version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("max version should query");
        assert_eq!(max_version, 5, "the failed step is rolled back");
        let stored: String = connection
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'app.lighting.editor.state'",
                [],
                |row| row.get(0),
            )
            .expect("value should still exist");
        assert_eq!(stored, r#"{"fixtures": ["#);
    }
    let backup = newest_snapshot(&backups_dir).expect("a pre-migration backup should exist");
    assert!(backup.to_string_lossy().ends_with("-pre-migration.sqlite3"));

    set_settings_owned(
        &db_path,
        &[(
            String::from("app.lighting.editor.state"),
            String::from(r#"{"fixtures":[],"groups":[],"scenes":[]}"#),
        )],
    )
    .expect("repaired seed should write");
    let bootstrap =
        initialize_database(&db_path, &backups_dir).expect("the repaired database should upgrade");
    assert_eq!(bootstrap.schema_version, STORAGE_SCHEMA_VERSION);
}

fn seed_v5_database(db_path: &Path) {
    seed_v3_database(db_path);
    let connection = open_connection(db_path).expect("connection should open");
    connection
        .execute_batch(
            "INSERT INTO schema_migrations(version) VALUES (4);
             INSERT INTO schema_migrations(version) VALUES (5);",
        )
        .expect("v4 and v5 rows should insert");
}

fn seed_v3_database(db_path: &Path) {
    let connection = open_connection(db_path).expect("connection should open");
    connection
        .execute_batch(
            r#"
            CREATE TABLE schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE app_metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE projects (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              status TEXT NOT NULL,
              priority TEXT NOT NULL,
              created_at TEXT NOT NULL,
              last_updated TEXT NOT NULL,
              sort_order INTEGER NOT NULL
            );
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              priority TEXT NOT NULL,
              due_date TEXT,
              labels_json TEXT NOT NULL,
              is_running INTEGER NOT NULL DEFAULT 0,
              total_seconds INTEGER NOT NULL DEFAULT 0,
              last_started TEXT,
              completed INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              scheduled_start TEXT,
              scheduled_duration_seconds INTEGER
            );
            CREATE TABLE task_checklist_items (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
              text TEXT NOT NULL,
              done INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL
            );
            CREATE TABLE activity_log (
              id TEXT PRIMARY KEY,
              timestamp TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              action TEXT NOT NULL,
              detail TEXT NOT NULL
            );
            INSERT INTO schema_migrations(version) VALUES (1);
            INSERT INTO schema_migrations(version) VALUES (2);
            INSERT INTO schema_migrations(version) VALUES (3);
            "#,
        )
        .expect("v3 schema should seed");
}
