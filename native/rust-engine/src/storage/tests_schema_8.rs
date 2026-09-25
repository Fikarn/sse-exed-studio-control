//! New pages program, Slice 2 (D2): schema 8 removes Planning's saved data —
//! the 7 -> 8 step behind its pre-migration copy, the refusal of a newer
//! database, and the interim db.json import's "existing data" gate. Beside
//! `tests.rs` under the 2,000-line file-health guard.

use super::tests::{all_settings, planning_objects, TestDir};
use super::*;
use crate::storage_backups::{newest_snapshot, snapshot_reason_of};
use rusqlite::OpenFlags;
use serde_json::json;
use std::fs;

/// Every schema object as (type, name, table, SQL with its whitespace
/// collapsed), so a seeded layout compares with one the migrations built.
fn schema_objects(db_path: &Path) -> Vec<(String, String, String, String)> {
    let connection = open_connection(db_path).expect("connection should open");
    let mut statement = connection
        .prepare(
            "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master ORDER BY type, name",
        )
        .expect("objects should prepare");
    let rows = statement
        .query_map([], |row| {
            let sql: String = row.get(3)?;
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                sql.split_whitespace().collect::<Vec<_>>().join(" "),
            ))
        })
        .expect("objects should query")
        .collect::<Result<Vec<_>, _>>()
        .expect("objects should read");
    rows
}

/// Every settings row with its `updated_at`, to prove a row was not touched.
fn settings_rows(db_path: &Path) -> HashMap<String, (String, String)> {
    let connection = open_connection(db_path).expect("connection should open");
    let mut statement = connection
        .prepare("SELECT key, value, updated_at FROM app_settings")
        .expect("settings should prepare");
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?))))
        .expect("settings should query")
        .collect::<Result<HashMap<_, _>, _>>()
        .expect("settings should read");
    rows
}

fn metadata(db_path: &Path) -> HashMap<String, String> {
    let connection = open_connection(db_path).expect("connection should open");
    let mut statement = connection
        .prepare("SELECT key, value FROM app_metadata")
        .expect("metadata should prepare");
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("metadata should query")
        .collect::<Result<HashMap<_, _>, _>>()
        .expect("metadata should read");
    rows
}

fn schema_versions(db_path: &Path) -> Vec<i64> {
    let connection = open_connection(db_path).expect("connection should open");
    let mut statement = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .expect("versions should prepare");
    let rows = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .expect("versions should query")
        .collect::<Result<Vec<_>, _>>()
        .expect("versions should read");
    rows
}

/// A schema-7 database as the build before Slice 2 left it: the DDL of
/// migration steps 1 to 7 verbatim (the v3 columns added by ALTER, the
/// indexes, the action log), the format-version row, and that build's seven
/// `planning.*` defaults with `shell.workspace` at its default then,
/// `planning`. The operator's own copy, read on 2026-09-24, held no Planning
/// rows, those seven settings and `shell.workspace = audio`.
fn seed_v7_database(db_path: &Path) {
    let connection = open_connection(db_path).expect("connection should open");
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO schema_migrations(version) VALUES (1);

            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              status TEXT NOT NULL,
              priority TEXT NOT NULL,
              created_at TEXT NOT NULL,
              last_updated TEXT NOT NULL,
              sort_order INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS projects_status_order_idx
              ON projects(status, sort_order, created_at);

            CREATE TABLE IF NOT EXISTS tasks (
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

            CREATE INDEX IF NOT EXISTS tasks_project_order_idx
              ON tasks(project_id, sort_order, created_at);

            CREATE TABLE IF NOT EXISTS task_checklist_items (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
              text TEXT NOT NULL,
              done INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS task_checklist_task_order_idx
              ON task_checklist_items(task_id, sort_order);

            CREATE TABLE IF NOT EXISTS activity_log (
              id TEXT PRIMARY KEY,
              timestamp TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              action TEXT NOT NULL,
              detail TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS activity_log_timestamp_idx
              ON activity_log(timestamp DESC);
            INSERT INTO schema_migrations(version) VALUES (2);

            ALTER TABLE tasks ADD COLUMN scheduled_start TEXT;
            ALTER TABLE tasks ADD COLUMN scheduled_duration_seconds INTEGER;
            CREATE INDEX IF NOT EXISTS tasks_scheduled_start_idx
              ON tasks(scheduled_start) WHERE scheduled_start IS NOT NULL;
            INSERT INTO schema_migrations(version) VALUES (3);

            INSERT INTO app_metadata(key, value) VALUES ('storage.format_version', '1');
            INSERT INTO schema_migrations(version) VALUES (4);
            INSERT INTO schema_migrations(version) VALUES (5);
            INSERT INTO schema_migrations(version) VALUES (6);

            CREATE TABLE IF NOT EXISTS event_log (
              id INTEGER PRIMARY KEY,
              at TEXT NOT NULL,
              source TEXT NOT NULL,
              domain TEXT NOT NULL,
              action TEXT NOT NULL,
              target TEXT NOT NULL,
              detail TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS event_log_at_idx
              ON event_log(at DESC);
            INSERT INTO schema_migrations(version) VALUES (7);

            INSERT INTO app_metadata(key, value) VALUES ('storage.bootstrap', 'initialized');
            INSERT INTO app_settings(key, value) VALUES
              ('planning.view_filter', 'all'),
              ('planning.sort_by', 'manual'),
              ('planning.dashboard_view', 'kanban'),
              ('planning.deck_mode', 'project'),
              ('planning.mode_section', 'timeline'),
              ('planning.timeline_start_hour', '9'),
              ('planning.timeline_end_hour', '22'),
              ('shell.workspace', 'planning');
            "#,
        )
        .expect("the v7 layout should seed");
}

/// Planning rows in all four tables, the two selection settings the build
/// before Slice 2 wrote while a project and a task were selected, a
/// `planning.*` key no build wrote (the step removes the whole prefix), the
/// Control Surface Probe's line about that selection, and what an earlier
/// db.json import recorded.
fn seed_v7_planning_data(db_path: &Path) {
    let connection = open_connection(db_path).expect("connection should open");
    connection
        .execute_batch(
            r#"
            INSERT INTO projects(id, title, description, status, priority, created_at, last_updated, sort_order) VALUES
              ('proj-1', 'Spring season', '', 'in-progress', 'p1', '2026-04-01T10:00:00Z', '2026-04-02T10:00:00Z', 0),
              ('proj-2', 'Studio move', '', 'todo', 'p2', '2026-04-03T10:00:00Z', '2026-04-03T10:00:00Z', 1);
            INSERT INTO tasks(id, project_id, title, description, priority, due_date, labels_json, is_running, total_seconds, last_started, completed, sort_order, created_at, scheduled_start, scheduled_duration_seconds) VALUES
              ('task-1', 'proj-1', 'Book guests', '', 'p1', NULL, '["guests"]', 0, 120, NULL, 0, 0, '2026-04-01T11:00:00Z', '2026-04-05T09:00:00Z', 3600),
              ('task-2', 'proj-2', 'Pack cables', '', 'p2', '2026-05-01', '[]', 0, 0, NULL, 1, 0, '2026-04-03T11:00:00Z', NULL, NULL);
            INSERT INTO task_checklist_items(id, task_id, text, done, sort_order) VALUES
              ('check-1', 'task-1', 'Send invites', 1, 0),
              ('check-2', 'task-1', 'Confirm times', 0, 1);
            INSERT INTO activity_log(id, timestamp, entity_type, entity_id, action, detail) VALUES
              ('act-1', '2026-04-01T10:00:00Z', 'project', 'proj-1', 'created', 'Project created'),
              ('act-2', '2026-04-03T11:00:00Z', 'task', 'task-2', 'completed', 'Task completed');
            INSERT INTO app_settings(key, value) VALUES
              ('planning.selected_project_id', 'proj-1'),
              ('planning.selected_task_id', 'task-1'),
              ('planning.some_later_key', 'x'),
              ('app.commissioning.check.control-surface.message',
               'Planning context is reachable. Selected project ''Spring season'' exposes 1 tasks for operator navigation.');
            INSERT INTO app_metadata(key, value) VALUES
              ('legacy_import.source_path', 'C:/old/db.json'),
              ('legacy_import.source_schema_version', '8'),
              ('legacy_import.projects', '2'),
              ('legacy_import.tasks', '2'),
              ('legacy_import.checklist_items', '2'),
              ('legacy_import.activity_entries', '2'),
              ('legacy_import.normalized_running_tasks', '0'),
              ('legacy_import.imported_at_unix', '1760000000');
            "#,
        )
        .expect("the Planning data should seed");
}

/// The Lighting, Console and Setup saved data around Planning, with an
/// action-log row. None of it may change.
fn seed_v7_other_data(db_path: &Path) {
    let connection = open_connection(db_path).expect("connection should open");
    connection
        .execute_batch(
            r#"
            INSERT INTO app_settings(key, value) VALUES
              ('app.commissioning.completed', 'true'),
              ('app.commissioning.stage', 'ready'),
              ('app.commissioning.runnerStage', 'publish'),
              ('app.commissioning.check.control-surface.status', 'passed'),
              ('app.commissioning.check.control-surface.checked_at', '2026-09-20T09:00:00Z'),
              ('app.commissioning.check.lighting.status', 'passed'),
              ('app.commissioning.check.lighting.message', 'Lighting bridge answered on the stored address.'),
              ('app.lighting.editor.state', '{"fixtures":[],"groups":[{"id":"g1","name":"Stage"}],"scenes":[],"palettes":[],"paletteOrder":[]}'),
              ('app.audio.snapshots_state', '[{"id":"asnap-1","name":"Interview Setup","oscIndex":0,"order":0}]'),
              ('shell.window.mode', 'fullscreen'),
              ('shell.lighting.currentSectionId', '"planning"');
            INSERT INTO event_log(at, source, domain, action, target, detail) VALUES
              ('2026-09-20T10:00:00Z', 'ui', 'lighting', 'scene.recall', 'Interview', 'Recalled Interview');
            "#,
        )
        .expect("the other saved data should seed");
}

// D2: the 7 -> 8 step, on a schema-7 database with Planning in it. The four
// tables and their indexes go, every `planning.*` setting goes, the saved
// Planning page opens the Console, the Control Surface Probe's line about
// Planning reads as checked before this version (its status stands), and
// nothing else is touched. The verified
// pre-migration copy — written before this step by the mechanism every
// upgrade goes through — still holds all of it: the way back to an older
// build, which refuses schema 8.
#[test]
fn migrate_v7_to_v8_drops_planning_after_snapshot() {
    let test_dir = TestDir::new("storage-v7-to-v8");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");
    seed_v7_database(&db_path);
    seed_v7_planning_data(&db_path);
    seed_v7_other_data(&db_path);
    assert_eq!(
        planning_objects(&db_path).len(),
        13,
        "four tables, their four primary-key indexes and five more"
    );
    let rows_before = settings_rows(&db_path);
    assert_eq!(
        rows_before
            .keys()
            .filter(|key| key.starts_with("planning."))
            .count(),
        10
    );

    let bootstrap =
        initialize_database(&db_path, &backups_dir).expect("the v8 migration should succeed");
    assert_eq!(bootstrap.schema_version, 8);
    assert_eq!(schema_versions(&db_path), vec![1, 2, 3, 4, 5, 6, 7, 8]);

    assert_eq!(planning_objects(&db_path), Vec::<String>::new());
    let rows_after = settings_rows(&db_path);
    let planning_left = rows_after
        .keys()
        .filter(|key| key.starts_with("planning."))
        .collect::<Vec<_>>();
    assert!(planning_left.is_empty(), "{planning_left:?}");
    assert_eq!(
        rows_after
            .get(WORKSPACE_KEY)
            .map(|(value, _)| value.as_str()),
        Some("audio"),
        "a saved Planning page opens the Console"
    );
    assert_eq!(
        rows_after
            .get(CONTROL_SURFACE_MESSAGE_KEY)
            .map(|(value, _)| value.as_str()),
        Some(PROBE_CHECKED_BEFORE_THIS_VERSION),
        "the probe's line no longer talks about Planning"
    );
    for (key, row) in &rows_before {
        if key.starts_with("planning.")
            || key == WORKSPACE_KEY
            || key == CONTROL_SURFACE_MESSAGE_KEY
        {
            continue;
        }
        assert_eq!(rows_after.get(key), Some(row), "{key} was touched");
    }

    let after_metadata = metadata(&db_path);
    for gone in [
        "legacy_import.projects",
        "legacy_import.tasks",
        "legacy_import.checklist_items",
        "legacy_import.activity_entries",
        "legacy_import.normalized_running_tasks",
    ] {
        assert!(!after_metadata.contains_key(gone), "{gone}");
    }
    for kept in [
        "legacy_import.source_path",
        "legacy_import.source_schema_version",
        "legacy_import.imported_at_unix",
        "storage.format_version",
    ] {
        assert!(after_metadata.contains_key(kept), "{kept}");
    }

    let action_rows: i64 = open_connection(&db_path)
        .expect("connection should open")
        .query_row(
            "SELECT COUNT(*) FROM event_log WHERE target = 'Interview'",
            [],
            |row| row.get(0),
        )
        .expect("the action log should read");
    assert_eq!(action_rows, 1, "the action log is untouched");

    // What is left is exactly what a new database has.
    let fresh_dir = TestDir::new("storage-v8-fresh-layout");
    let fresh_path = fresh_dir.path().join("native.sqlite3");
    initialize_database(&fresh_path, &fresh_dir.path().join("backups"))
        .expect("a new database should initialize");
    assert_eq!(schema_objects(&db_path), schema_objects(&fresh_path));

    // The copy taken before the step.
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
    assert_eq!(copy_version, 7, "the copy is the database before the step");
    for (table, expected) in [
        ("projects", 2),
        ("tasks", 2),
        ("task_checklist_items", 2),
        ("activity_log", 2),
    ] {
        let rows: i64 = copy
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("the copy's Planning rows should read");
        assert_eq!(rows, expected, "{table} in the copy");
    }
    let copy_planning_settings: i64 = copy
        .query_row(
            "SELECT COUNT(*) FROM app_settings WHERE key LIKE 'planning.%'",
            [],
            |row| row.get(0),
        )
        .expect("the copy's settings should read");
    assert_eq!(copy_planning_settings, 10);
    let copy_workspace: String = copy
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'shell.workspace'",
            [],
            |row| row.get(0),
        )
        .expect("the copy's page should read");
    assert_eq!(copy_workspace, "planning");
    let copy_probe_line: String = copy
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [CONTROL_SURFACE_MESSAGE_KEY],
            |row| row.get(0),
        )
        .expect("the copy's probe line should read");
    assert!(copy_probe_line.starts_with(PLANNING_ERA_PROBE_PREFIX));
    drop(copy);

    // A second start changes nothing and writes no copy.
    let rows_settled = settings_rows(&db_path);
    initialize_database(&db_path, &backups_dir).expect("second start should succeed");
    assert_eq!(schema_versions(&db_path), vec![1, 2, 3, 4, 5, 6, 7, 8]);
    assert_eq!(settings_rows(&db_path), rows_settled);
    let copies = fs::read_dir(&backups_dir)
        .expect("backups dir should list")
        .filter_map(Result::ok)
        .filter(|entry| snapshot_reason_of(&entry.file_name().to_string_lossy()).is_some())
        .count();
    assert_eq!(copies, 1);
}

// D2: only a saved Planning page moves. A schema-7 database that opens on
// Lighting, Setup or the Console keeps its page through the upgrade (the
// rewrite is keyed to the value `planning`). Its schema assertions are what
// fail on the build before Slice 2; the pages themselves are a regression
// guard.
#[test]
fn migrate_v7_to_v8_keeps_every_other_saved_page() {
    for page in ["lighting", "setup", "audio"] {
        let test_dir = TestDir::new(&format!("storage-v7-to-v8-{page}"));
        let db_path = test_dir.path().join("native.sqlite3");
        seed_v7_database(&db_path);
        open_connection(&db_path)
            .expect("connection should open")
            .execute(
                "UPDATE app_settings SET value = ?1 WHERE key = 'shell.workspace'",
                [page],
            )
            .expect("the page should write");

        let bootstrap =
            initialize_test_database(&db_path).expect("the v8 migration should succeed");
        assert_eq!(bootstrap.schema_version, 8);
        assert_eq!(planning_objects(&db_path), Vec::<String>::new());
        assert_eq!(
            all_settings(&db_path)
                .get(WORKSPACE_KEY)
                .map(String::as_str),
            Some(page)
        );
    }
}

// D2: older builds refuse schema 8, and this one still refuses a database a
// newer build wrote — by its schema number and this build's — before any
// step or copy touches it.
#[test]
fn a_database_from_a_newer_build_is_refused_by_name() {
    let test_dir = TestDir::new("storage-v9-refused");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");
    seed_v7_database(&db_path);
    open_connection(&db_path)
        .expect("connection should open")
        .execute_batch(
            "INSERT INTO schema_migrations(version) VALUES (8);
             INSERT INTO schema_migrations(version) VALUES (9);",
        )
        .expect("the newer rows should insert");
    let rows_before = settings_rows(&db_path);

    let error = initialize_database(&db_path, &backups_dir)
        .expect_err("a schema-9 database must be refused");
    let message = error.to_string();
    assert!(message.contains("schema version 9"), "{message}");
    assert!(message.contains("(supports up to 8)"), "{message}");
    assert!(
        message.contains("restore a v8-or-earlier backup"),
        "{message}"
    );

    assert_eq!(schema_versions(&db_path), vec![1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert_eq!(settings_rows(&db_path), rows_before);
    assert_eq!(planning_objects(&db_path).len(), 13, "no step ran");
    assert!(
        newest_snapshot(&backups_dir).is_none(),
        "a refused database is not copied"
    );
}

// The interim import's "existing data" (Slice 2, until Slice 2b retires the
// import): a completed setup or an earlier import — what the setup flag and
// the page it writes would replace. Before Slice 2 the gate was Planning rows,
// so an import into a set-up desk without Planning rows went through.
#[test]
fn import_legacy_db_counts_a_completed_setup_or_an_earlier_import_as_saved_data() {
    let test_dir = TestDir::new("storage-import-gate");
    let source_path = test_dir.path().join("legacy-db.json");
    fs::write(
        &source_path,
        serde_json::to_vec_pretty(&json!({
            "settings": { "dashboardView": "lighting", "hasCompletedSetup": false }
        }))
        .expect("legacy payload should serialize"),
    )
    .expect("legacy db should be written");
    let request = |force: bool| LegacyImportRequest {
        source_path: source_path.clone(),
        force,
    };

    // New saved data: nothing to replace; after the import, its own record is
    // what the next one would replace.
    let fresh_path = test_dir.path().join("fresh.sqlite3");
    initialize_test_database(&fresh_path).expect("database should initialize");
    assert!(!legacy_import_finds_saved_data(&fresh_path).expect("the gate should read"));
    let summary = import_legacy_db(&fresh_path, &request(false)).expect("the import should run");
    assert!(!summary.replaced_existing_data);
    assert!(legacy_import_finds_saved_data(&fresh_path).expect("the gate should read"));

    // A set-up desk that never imported anything.
    let desk_path = test_dir.path().join("desk.sqlite3");
    initialize_test_database(&desk_path).expect("database should initialize");
    set_settings_owned(
        &desk_path,
        &[
            (
                String::from(COMMISSIONING_COMPLETED_KEY),
                String::from("true"),
            ),
            (String::from(COMMISSIONING_STAGE_KEY), String::from("ready")),
            (
                String::from(COMMISSIONING_RUNNER_STAGE_KEY),
                String::from("publish"),
            ),
            (String::from(WORKSPACE_KEY), String::from("audio")),
        ],
    )
    .expect("the desk should be set up");
    assert!(legacy_import_finds_saved_data(&desk_path).expect("the gate should read"));
    let before = all_settings(&desk_path);
    let error = import_legacy_db(&desk_path, &request(false))
        .expect_err("a set-up desk is not replaced without force");
    assert!(matches!(
        error,
        ImportLegacyError::ExistingDataRequiresForce
    ));
    assert_eq!(
        all_settings(&desk_path),
        before,
        "a refused import writes nothing"
    );
    let words = error.to_string().to_lowercase();
    for forbidden in [
        "engine",
        "backend",
        "transport",
        "ipc",
        "snapshot",
        "planning",
    ] {
        assert!(!words.contains(forbidden), "{words}");
    }

    let summary = import_legacy_db(&desk_path, &request(true)).expect("force replaces");
    assert!(summary.replaced_existing_data);
    let after = all_settings(&desk_path);
    assert_eq!(
        after.get(WORKSPACE_KEY).map(String::as_str),
        Some("lighting")
    );
    assert_eq!(
        after.get(COMMISSIONING_COMPLETED_KEY).map(String::as_str),
        Some("false")
    );
}
