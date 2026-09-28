//! The backup archive's formats: what an archive of each format carries, and how
//! an older one verifies and restores. Moved out of `tests.rs` unchanged (new
//! pages program, Slice 4) when the tests were split under the 2,000-line
//! file-health guard.

use super::test_support::*;
use super::*;
use crate::commissioning::PROBE_CHECKED_BEFORE_THIS_VERSION;
use crate::storage::{initialize_database, set_settings_owned};
use serde_json::json;

// ---------------------------------------------------------------------------
// New pages program, Slice 2 (D2, D3): Planning left, and the backups with it.
// ---------------------------------------------------------------------------

/// Every object key in a JSON value, at any depth.
fn every_key(value: &Value) -> Vec<String> {
    let mut keys = Vec::new();
    match value {
        Value::Object(object) => {
            for (key, entry) in object {
                keys.push(key.clone());
                keys.extend(every_key(entry));
            }
        }
        Value::Array(entries) => {
            for entry in entries {
                keys.extend(every_key(entry));
            }
        }
        _ => {}
    }
    keys
}

/// This build's archive of the saved data, rewritten as a build before
/// Slice 2 wrote it: format 4, the Planning page saved (the default page
/// then), and a `planning` part — a project, a task with two checklist items
/// and an activity entry when `with_rows`, and the Planning settings every
/// such archive carries.
fn format_4_archive(runtime: &RuntimeContext, with_rows: bool) -> Value {
    let mut archive =
        serde_json::to_value(build_support_backup_archive(runtime).expect("archive should build"))
            .expect("archive should serialize to value");
    archive["formatVersion"] = json!(4);
    // Format 4 had no Teleprompter part (format 6, Slice 4) and no cameras'
    // part (format 7, Slice 8).
    let parts = archive.as_object_mut().expect("the archive is an object");
    parts.remove("prompter");
    parts.remove("cameras");
    // The Control Surface Probe's line as that build wrote it with nothing
    // loaded; the operator's archive of 2026-09-24 carries one like it.
    let checks = archive["commissioning"]["checks"]
        .as_array_mut()
        .expect("the archive lists its probes");
    let control_surface = checks
        .iter_mut()
        .find(|check| check["id"] == json!("control-surface"))
        .expect("the archive holds the Control Surface Probe");
    control_surface["status"] = json!("passed");
    control_surface["message"] = json!(
        "Planning context is reachable. No projects are loaded yet, so the deck surface would start empty."
    );
    archive["shell"]["workspace"] = json!("planning");
    archive["settings"][WORKSPACE_KEY] = json!("planning");
    let rows = |entries: Value| if with_rows { entries } else { json!([]) };
    archive["planning"] = json!({
        "projects": rows(json!([{
            "id": "proj-1",
            "title": "Spring season",
            "description": "",
            "status": "in-progress",
            "priority": "p1",
            "createdAt": "2026-04-01T10:00:00.000Z",
            "lastUpdated": "2026-04-02T10:00:00.000Z",
            "order": 0
        }])),
        "tasks": rows(json!([{
            "id": "task-1",
            "projectId": "proj-1",
            "title": "Book guests",
            "description": "",
            "priority": "p1",
            "dueDate": null,
            "labels": ["guests"],
            "checklist": [
                { "id": "check-1", "text": "Send invites", "done": true, "order": 0 },
                { "id": "check-2", "text": "Confirm times", "done": false, "order": 1 }
            ],
            "isRunning": false,
            "totalSeconds": 120,
            "lastStarted": null,
            "completed": false,
            "order": 0,
            "createdAt": "2026-04-01T11:00:00.000Z"
        }])),
        "activityLog": rows(json!([{
            "id": "act-1",
            "timestamp": "2026-04-01T10:00:00.000Z",
            "entityType": "project",
            "entityId": "proj-1",
            "action": "created",
            "detail": "Project created"
        }])),
        "settings": {
            "viewFilter": "all",
            "sortBy": "manual",
            "dashboardView": "kanban",
            "deckMode": "project",
            "modeSection": "timeline",
            "timelineStartHour": 9,
            "timelineEndHour": 22,
            "selectedProjectId": if with_rows { json!("proj-1") } else { Value::Null },
            "selectedTaskId": if with_rows { json!("task-1") } else { Value::Null }
        }
    });
    archive
}

fn write_archive(runtime: &RuntimeContext, name: &str, archive: &Value) -> PathBuf {
    let path = runtime.backups_dir.join(name);
    fs::write(
        &path,
        serde_json::to_vec_pretty(archive).expect("archive should serialize"),
    )
    .expect("archive should write");
    path
}

fn planning_tables_in(db_path: &Path) -> Vec<String> {
    let connection = Connection::open(db_path).expect("database should open");
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table'
             AND name IN ('projects', 'tasks', 'task_checklist_items', 'activity_log')
             ORDER BY name",
        )
        .expect("tables should prepare");
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("tables should query")
        .collect::<Result<Vec<_>, _>>()
        .expect("tables should read");
    names
}

/// Turns a database backup this build wrote into one a build before Slice 2
/// wrote: schema 7, Planning's four tables, the seven Planning settings that
/// build seeded and the Planning page saved, plus a project, a task, a
/// checklist item and an activity entry when `with_rows`. The operator's own
/// database, read on 2026-09-24, was of the kind without rows.
fn make_schema_7_backup(path: &Path, with_rows: bool) {
    let connection = Connection::open(path).expect("backup should open");
    connection
        .execute_batch(
            r#"
            DELETE FROM schema_migrations WHERE version IN (8, 9, 10);
            DROP TABLE camera_setup;
            DROP TABLE prompter_script_versions;
            DROP TABLE prompter_scripts;
            DROP TABLE prompter_state;
            CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL);
            CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
            CREATE TABLE task_checklist_items (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
            CREATE TABLE activity_log (id TEXT PRIMARY KEY, detail TEXT NOT NULL);
            INSERT INTO app_settings(key, value) VALUES
              ('planning.view_filter', 'all'),
              ('planning.sort_by', 'manual'),
              ('planning.dashboard_view', 'kanban'),
              ('planning.deck_mode', 'project'),
              ('planning.mode_section', 'timeline'),
              ('planning.timeline_start_hour', '9'),
              ('planning.timeline_end_hour', '22');
            UPDATE app_settings SET value = 'planning' WHERE key = 'shell.workspace';
            "#,
        )
        .expect("the schema-7 layout should seed");
    if with_rows {
        connection
            .execute_batch(
                r#"
                INSERT INTO projects(id, title) VALUES ('proj-1', 'Spring season');
                INSERT INTO tasks(id, project_id) VALUES ('task-1', 'proj-1');
                INSERT INTO task_checklist_items(id, task_id) VALUES ('check-1', 'task-1');
                INSERT INTO activity_log(id, detail) VALUES ('act-1', 'Project created');
                "#,
            )
            .expect("the Planning rows should seed");
    }
}

// D3: a new archive carries nothing of Planning — no `planning` part, no
// Planning setting, no project, task or activity entry — and the export's
// reply no longer counts them. Verify reads it back with nothing left out.
// Slice 2 wrote it as format 5; since Slice 4 it is format 6 and Verify
// counts its scripts (the test asserted format 5 and the sentence "Backup
// archive, format 5, exported T."); since Slice 8 it is format 7 and Verify
// names the cameras' setup too (it asserted format 6 and "…, with 0
// scripts.").
#[test]
fn a_new_archive_carries_no_planning() {
    let test_dir = TestDir::new("format-7-no-planning");
    let runtime = seeded_runtime(&test_dir);

    let export = export_support_backup(&runtime).expect("export should succeed");
    assert_eq!(SUPPORT_BACKUP_FORMAT_VERSION, 7);
    assert_eq!(export.format_version, 7);
    let reply = serde_json::to_value(&export).expect("reply should serialize");
    let mut reply_keys = reply
        .as_object()
        .expect("the reply is an object")
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    reply_keys.sort();
    assert_eq!(reply_keys, ["fileName", "formatVersion", "path"]);

    let raw: Value = serde_json::from_slice(&fs::read(&export.path).expect("archive should read"))
        .expect("archive should parse");
    assert_eq!(raw["formatVersion"], json!(7));
    let keys = every_key(&raw);
    for key in &keys {
        assert!(
            key != "planning" && !key.starts_with("planning."),
            "the archive carries {key}"
        );
        assert!(
            !["projects", "tasks", "activityLog", "checklist"].contains(&key.as_str()),
            "the archive carries {key}"
        );
    }
    assert_eq!(raw["shell"]["workspace"], json!("audio"));

    let verification = verify_support_backup(&request_for(&runtime, Path::new(&export.path)));
    assert!(verification.ok, "{}", verification.detail);
    assert_eq!(verification.format_version, Some(7));
    assert_eq!(
        verification.detail,
        format!(
            "Backup archive, format 7, exported {}, with 0 scripts and the cameras' setup.",
            raw["exportedAt"]
                .as_str()
                .expect("the archive has its time")
        )
    );
    assert_operator_words(&verification.detail);
}

// D3: an archive of format 4 still restores — everything but its Planning
// part, which is skipped (no Planning table comes back, no `planning.*`
// setting is written, and it adds nothing to the settings count), and the
// Planning page it saved opens the Console (D1, D2). The reply says the
// Planning data was not restored, and only when there was some.
#[test]
fn a_format_4_archive_restores_everything_but_its_planning_part() {
    let test_dir = TestDir::new("format-4-restore");
    let runtime = seeded_runtime(&test_dir);
    let kept: Vec<(String, String)> = vec![
        (
            String::from("app.lighting.grand_master"),
            String::from("64"),
        ),
        (
            String::from("app.audio.faders_per_bank"),
            String::from("12"),
        ),
        (String::from(WINDOW_MODE_KEY), String::from("windowed")),
        (
            String::from("app.control_surface.audio.bank"),
            String::from("2"),
        ),
    ];
    set_settings_owned(&runtime.db_path, &kept).expect("settings should seed");
    let with_rows = write_archive(
        &runtime,
        "native-backup-format-4-planning.json",
        &format_4_archive(&runtime, true),
    );
    let without_rows = write_archive(
        &runtime,
        "native-backup-format-4-settings-only.json",
        &format_4_archive(&runtime, false),
    );
    let current = export_support_backup(&runtime).expect("export should succeed");

    // Everything changes after the export.
    let changed = kept
        .iter()
        .map(|(key, _)| (key.clone(), String::from("changed")))
        .chain([(String::from(WORKSPACE_KEY), String::from("lighting"))])
        .collect::<Vec<_>>();
    set_settings_owned(&runtime.db_path, &changed).expect("changes should persist");

    let summary = restore_support_backup(&runtime, &request_for(&runtime, &with_rows))
        .expect("a format-4 archive restores");
    assert_eq!(summary.source_format, "native-support-backup");
    assert!(!summary.requires_restart);
    assert_eq!(summary.detail.as_deref(), Some(PLANNING_WAS_NOT_RESTORED));
    assert_operator_words(PLANNING_WAS_NOT_RESTORED);

    let settings = list_settings_by_prefix(&runtime.db_path, "").expect("settings should load");
    for (key, value) in &kept {
        assert_eq!(settings.get(key), Some(value), "{key} is restored");
    }
    assert_eq!(
        settings.get(WORKSPACE_KEY).map(String::as_str),
        Some("audio"),
        "the saved Planning page opens the Console"
    );
    let commissioning =
        read_commissioning_snapshot(&runtime.db_path).expect("commissioning snapshot should load");
    assert!(commissioning.has_completed_setup);
    let control_surface = commissioning
        .checks
        .iter()
        .find(|check| check.id == "control-surface")
        .expect("the Control Surface Probe is listed");
    assert_eq!(
        control_surface.status, "passed",
        "the probe's status stands"
    );
    assert_eq!(
        control_surface.message, PROBE_CHECKED_BEFORE_THIS_VERSION,
        "the probe's line no longer talks about Planning"
    );
    assert_operator_words(PROBE_CHECKED_BEFORE_THIS_VERSION);
    let planning_keys = settings
        .keys()
        .filter(|key| key.starts_with("planning."))
        .collect::<Vec<_>>();
    assert!(planning_keys.is_empty(), "{planning_keys:?}");
    assert!(planning_tables_in(&runtime.db_path).is_empty());

    // The Planning part adds nothing: the same saved data from this build's
    // own archive restores exactly as many settings.
    let current_summary =
        restore_support_backup(&runtime, &request_for(&runtime, Path::new(&current.path)))
            .expect("the current archive restores");
    assert_eq!(current_summary.detail, None);
    assert_eq!(summary.settings_restored, current_summary.settings_restored);

    // Planning settings alone are not Planning data: skipped without a word.
    set_settings_owned(
        &runtime.db_path,
        &[(String::from(WORKSPACE_KEY), String::from("lighting"))],
    )
    .expect("the page should persist");
    let settings_only = restore_support_backup(&runtime, &request_for(&runtime, &without_rows))
        .expect("a format-4 archive without Planning rows restores");
    assert_eq!(settings_only.detail, None);
    assert_eq!(
        settings_only.settings_restored,
        current_summary.settings_restored
    );
    assert!(list_settings_by_prefix(&runtime.db_path, "planning.")
        .expect("settings should load")
        .is_empty());
    assert_eq!(
        list_settings_by_prefix(&runtime.db_path, WORKSPACE_KEY)
            .expect("settings should load")
            .get(WORKSPACE_KEY)
            .map(String::as_str),
        Some("audio")
    );
}

// D3: Verify of an archive written before Planning left no longer counts
// projects and tasks; it says the Planning part will not be restored when
// the archive holds Planning data, and says nothing of it otherwise. A
// legacy db.json is refused since Slice 2b retired the import (in Slice 2 it
// said that whether setup is complete and the page would be restored).
#[test]
fn verify_says_a_format_4_archive_s_planning_part_is_skipped() {
    let test_dir = TestDir::new("format-4-verify");
    let runtime = seeded_runtime(&test_dir);
    let with_rows_archive = format_4_archive(&runtime, true);
    let exported_at = with_rows_archive["exportedAt"]
        .as_str()
        .expect("the archive has its time")
        .to_string();
    let with_rows = write_archive(
        &runtime,
        "native-backup-format-4-planning.json",
        &with_rows_archive,
    );
    let mut without_rows_archive = format_4_archive(&runtime, false);
    without_rows_archive["exportedAt"] = json!(exported_at);
    let without_rows = write_archive(
        &runtime,
        "native-backup-format-4-settings-only.json",
        &without_rows_archive,
    );

    let checked = verify_support_backup(&request_for(&runtime, &with_rows));
    assert!(checked.ok, "{}", checked.detail);
    assert_eq!(checked.format_version, Some(4));
    assert_eq!(
        checked.detail,
        format!(
            "Backup archive, format 4, exported {exported_at}. {PLANNING_WILL_NOT_BE_RESTORED}"
        )
    );
    assert!(!checked.detail.contains("1 project"), "{}", checked.detail);
    assert_operator_words(&checked.detail);

    let checked = verify_support_backup(&request_for(&runtime, &without_rows));
    assert!(checked.ok, "{}", checked.detail);
    assert_eq!(
        checked.detail,
        format!("Backup archive, format 4, exported {exported_at}.")
    );

    let legacy = runtime.backups_dir.join("legacy-db.json");
    write_old_studio_control_export(&legacy);
    let checked = verify_support_backup(&request_for(&runtime, &legacy));
    assert!(!checked.ok, "{}", checked.detail);
    assert_eq!(checked.schema_version, None);
    assert_eq!(
        checked.detail,
        "legacy-db.json is an export from the old Studio Control (db.json); this version no longer restores those. Restore a backup archive or a database backup instead."
    );
    assert_operator_words(&checked.detail);
}

// D2, D3: a database backup this build writes and one of schema 7 (from
// before Planning left) both verify and restore; a newer one is refused
// before anything is staged. The schema-7 backup's Planning settings are not
// counted, its Planning rows are named as not restored, and it is upgraded
// again at the next start, which removes them and adds the Teleprompter's
// tables. Before the backups left Planning, every schema-8 backup was
// refused ("no such table: projects"). Since Slice 4 this build writes
// schema 9 and the newer backup is at 10 (the test wrote a schema 8 and
// refused a 9; its schema-7 copies now also lose step 9's tables). Since
// Slice 8 this build writes schema 10 and the newer backup is at 11 (the
// test was `database_backups_of_schema_7_and_9_restore_…`, wrote a schema 9
// and refused a 10; its schema-7 copies now also lose step 10's table).
#[test]
fn database_backups_of_schema_7_and_10_restore_and_a_newer_one_is_refused() {
    let test_dir = TestDir::new("schema-7-and-10");
    let runtime = seeded_runtime(&test_dir);
    let schema_10 = snapshot_database(
        &runtime.db_path,
        &runtime.backups_dir,
        SnapshotReason::Daily,
    )
    .expect("database backup should write");
    let schema_7_rows = runtime.backups_dir.join("db-schema-7-planning.sqlite3");
    let schema_7_settings_only = runtime
        .backups_dir
        .join("db-schema-7-settings-only.sqlite3");
    let schema_11 = runtime.backups_dir.join("db-schema-11.sqlite3");
    for copy in [&schema_7_rows, &schema_7_settings_only, &schema_11] {
        fs::copy(&schema_10, copy).expect("backup should copy");
    }
    make_schema_7_backup(&schema_7_rows, true);
    make_schema_7_backup(&schema_7_settings_only, false);
    Connection::open(&schema_11)
        .expect("backup should open")
        .execute("INSERT INTO schema_migrations(version) VALUES (11)", [])
        .expect("the newer schema should seed");

    let checked_10 = verify_support_backup(&request_for(&runtime, &schema_10));
    assert!(checked_10.ok, "{}", checked_10.detail);
    assert_eq!(checked_10.schema_version, Some(10));
    let settings_8 = inspect_database_backup(&schema_10)
        .expect("a schema-10 backup is a good database")
        .settings_count;
    assert_eq!(
        checked_10.detail,
        format!("Database backup, schema 10, integrity ok: {settings_8} settings.")
    );
    assert_operator_words(&checked_10.detail);

    let checked_7 = verify_support_backup(&request_for(&runtime, &schema_7_rows));
    assert!(checked_7.ok, "{}", checked_7.detail);
    assert_eq!(checked_7.schema_version, Some(7));
    assert_eq!(
        checked_7.detail,
        format!(
            "Database backup, schema 7, integrity ok: {settings_8} settings. {PLANNING_WILL_NOT_BE_RESTORED}"
        ),
        "the seven Planning settings are not counted"
    );
    assert_operator_words(&checked_7.detail);
    let checked_7 = verify_support_backup(&request_for(&runtime, &schema_7_settings_only));
    assert!(checked_7.ok, "{}", checked_7.detail);
    assert_eq!(
        checked_7.detail,
        format!("Database backup, schema 7, integrity ok: {settings_8} settings.")
    );

    let checked_11 = verify_support_backup(&request_for(&runtime, &schema_11));
    assert!(!checked_11.ok);
    assert_eq!(checked_11.schema_version, Some(11));
    assert!(
        checked_11.detail.contains("newer Studio Control"),
        "{}",
        checked_11.detail
    );
    let pending = runtime.app_data_dir.join(RESTORE_PENDING_FILE_NAME);
    match restore_support_backup(&runtime, &request_for(&runtime, &schema_11)) {
        Err(SupportCommandError::UnsupportedVersion(message)) => {
            assert!(message.contains("schema 11"), "{message}");
        }
        other => panic!("expected UnsupportedVersion, got {other:?}"),
    }
    assert!(!pending.exists(), "nothing is staged");

    let staged_10 = restore_support_backup(&runtime, &request_for(&runtime, &schema_10))
        .expect("a schema-10 backup restores");
    assert!(staged_10.requires_restart);
    assert_eq!(staged_10.detail, None);

    let staged_7 = restore_support_backup(&runtime, &request_for(&runtime, &schema_7_rows))
        .expect("a schema-7 backup restores");
    assert!(staged_7.requires_restart);
    assert_eq!(staged_7.settings_restored, settings_8);
    assert_eq!(staged_7.detail.as_deref(), Some(PLANNING_WAS_NOT_RESTORED));

    // The next start: the bootstrap moves the pending file into place and
    // opens it, and the upgrade to schema 10 runs on it like any older data.
    let next_start = test_dir.path().join("next-start");
    fs::create_dir_all(&next_start).expect("next start dir should create");
    let restored = next_start.join("studio-control.sqlite3");
    fs::copy(&pending, &restored).expect("pending should copy");
    let bootstrap = initialize_database(&restored, &next_start.join("backups"))
        .expect("the restored backup opens");
    assert_eq!(bootstrap.schema_version, 10);
    assert!(planning_tables_in(&restored).is_empty());
    let settings = list_settings_by_prefix(&restored, "").expect("settings should load");
    assert!(!settings.keys().any(|key| key.starts_with("planning.")));
    assert_eq!(
        settings.get(WORKSPACE_KEY).map(String::as_str),
        Some("audio")
    );
}

// ---------------------------------------------------------------------------
// New pages program, Slice 8: the cameras' part (format 7).
// ---------------------------------------------------------------------------

fn camera_rows(db_path: &Path) -> [crate::cameras::store::StoredSetup; 3] {
    crate::cameras::store::read_setup(&open_connection(db_path).expect("connection should open"))
        .expect("the cameras' rows should read")
}

fn write_camera(db_path: &Path, camera: u8, address: Option<&str>, paired: bool, input: u32) {
    crate::cameras::store::write_setup(
        &open_connection(db_path).expect("connection should open"),
        &crate::cameras::store::StoredSetup {
            camera,
            address: address.map(String::from),
            paired,
            vmix_input: input,
        },
    )
    .expect("the camera's row should write");
}

// Slice 8: an archive carries each camera's address and vMix input, never
// CAM 1's pairing (Windows' own, it stays with this PC). A restore writes
// the addresses and vMix inputs back and keeps this PC's pairing flag, and
// Verify names the part.
#[test]
fn a_format_7_archive_carries_the_cameras_and_restores_them_without_the_pairing() {
    let test_dir = TestDir::new("format-7-cameras");
    let runtime = seeded_runtime(&test_dir);
    write_camera(&runtime.db_path, 1, None, true, 1);
    write_camera(&runtime.db_path, 2, Some("172.16.16.85"), false, 12);
    write_camera(&runtime.db_path, 3, None, false, 7);

    let export = export_support_backup(&runtime).expect("export should succeed");
    let raw: Value = serde_json::from_slice(&fs::read(&export.path).expect("archive should read"))
        .expect("archive should parse");
    assert_eq!(
        raw["cameras"],
        json!([
            { "camera": 1, "address": null, "vmixInput": 1 },
            { "camera": 2, "address": "172.16.16.85", "vmixInput": 12 },
            { "camera": 3, "address": null, "vmixInput": 7 }
        ])
    );
    assert!(
        !every_key(&raw["cameras"]).contains(&String::from("paired")),
        "the pairing stays with this PC"
    );
    let verification = verify_support_backup(&request_for(&runtime, Path::new(&export.path)));
    assert!(verification.ok, "{}", verification.detail);
    assert!(
        verification
            .detail
            .ends_with(", with 0 scripts and the cameras' setup."),
        "{}",
        verification.detail
    );
    assert_operator_words(&verification.detail);

    // This PC now: CAM 1 unpaired, CAM 2's address taken away, CAM 3 on
    // another input.
    write_camera(&runtime.db_path, 1, None, false, 4);
    write_camera(&runtime.db_path, 2, None, false, 2);
    write_camera(&runtime.db_path, 3, Some("10.0.0.9"), false, 3);
    let restored =
        restore_support_backup(&runtime, &request_for(&runtime, Path::new(&export.path)))
            .expect("the archive restores");
    assert!(!restored.requires_restart);

    let rows = camera_rows(&runtime.db_path);
    assert_eq!(
        (rows[0].paired, rows[0].vmix_input),
        (false, 1),
        "CAM 1 keeps this PC's pairing and takes the archive's input"
    );
    assert_eq!(
        (rows[1].address.as_deref(), rows[1].vmix_input),
        (Some("172.16.16.85"), 12)
    );
    assert_eq!((rows[2].address.as_deref(), rows[2].vmix_input), (None, 7));
}

// The Cameras page: in a build with no link to a camera (the studio's,
// before Slices 11 and 13) a restore leaves the archive's addresses out, as
// Setup would refuse them, and says which. The vMix inputs come back, an
// address the archive does not hold is taken away, and an address the saved
// data already holds is not named.
#[test]
fn without_a_link_a_restore_leaves_the_addresses_out_and_says_so() {
    let test_dir = TestDir::new("format-7-no-link");
    let mut runtime = seeded_runtime(&test_dir);
    write_camera(&runtime.db_path, 2, Some("172.16.16.85"), false, 12);
    write_camera(&runtime.db_path, 3, Some("172.16.16.86"), false, 7);
    let export = export_support_backup(&runtime).expect("export should succeed");

    runtime.cameras_simulated = false;
    write_camera(&runtime.db_path, 2, None, false, 2);
    write_camera(&runtime.db_path, 3, None, false, 3);
    let restored =
        restore_support_backup(&runtime, &request_for(&runtime, Path::new(&export.path)))
            .expect("the archive restores");
    let detail = restored.detail.expect("a detail");
    assert!(
        detail.ends_with(
            "CAM 2's and CAM 3's addresses were not restored: Studio Control has no link to them yet."
        ),
        "{detail}"
    );
    assert_operator_words(&detail);
    let rows = camera_rows(&runtime.db_path);
    assert_eq!((rows[1].address.as_deref(), rows[1].vmix_input), (None, 12));
    assert_eq!((rows[2].address.as_deref(), rows[2].vmix_input), (None, 7));

    // CAM 3's address is in the saved data already; CAM 2's is another.
    write_camera(&runtime.db_path, 2, Some("10.0.0.9"), false, 2);
    write_camera(&runtime.db_path, 3, Some("172.16.16.86"), false, 3);
    let restored =
        restore_support_backup(&runtime, &request_for(&runtime, Path::new(&export.path)))
            .expect("the archive restores");
    let detail = restored.detail.expect("a detail");
    assert!(
        detail.ends_with("CAM 2's address was not restored: Studio Control has no link to it yet."),
        "{detail}"
    );
    let rows = camera_rows(&runtime.db_path);
    assert_eq!(rows[1].address.as_deref(), Some("10.0.0.9"));
    assert_eq!(rows[2].address.as_deref(), Some("172.16.16.86"));

    // An archive without an address takes the saved one away, as Setup may.
    write_camera(&runtime.db_path, 2, None, false, 2);
    write_camera(&runtime.db_path, 3, None, false, 3);
    runtime.cameras_simulated = true;
    let export = export_support_backup(&runtime).expect("export should succeed");
    runtime.cameras_simulated = false;
    write_camera(&runtime.db_path, 2, Some("10.0.0.9"), false, 2);
    let restored =
        restore_support_backup(&runtime, &request_for(&runtime, Path::new(&export.path)))
            .expect("the archive restores");
    assert!(
        !restored.detail.unwrap_or_default().contains("not restored"),
        "nothing was left out"
    );
    assert_eq!(camera_rows(&runtime.db_path)[1].address, None);
}

// Slice 8: an archive of format 6 or older has no cameras' part, and a
// restore of it leaves the cameras' setup as it is; Verify names only its
// scripts.
#[test]
fn an_archive_of_format_6_leaves_the_cameras_setup_as_it_is() {
    let test_dir = TestDir::new("format-6-cameras");
    let runtime = seeded_runtime(&test_dir);
    let mut archive =
        serde_json::to_value(build_support_backup_archive(&runtime).expect("archive should build"))
            .expect("archive should serialize to value");
    archive["formatVersion"] = json!(6);
    archive
        .as_object_mut()
        .expect("the archive is an object")
        .remove("cameras");
    let path = write_archive(&runtime, "native-backup-format-6.json", &archive);
    let verification = verify_support_backup(&request_for(&runtime, &path));
    assert!(verification.ok, "{}", verification.detail);
    assert!(
        verification.detail.ends_with(", with 0 scripts."),
        "{}",
        verification.detail
    );

    write_camera(&runtime.db_path, 1, None, true, 5);
    write_camera(&runtime.db_path, 2, Some("172.16.16.85"), false, 6);
    let before = camera_rows(&runtime.db_path);
    restore_support_backup(&runtime, &request_for(&runtime, &path)).expect("the archive restores");
    assert_eq!(camera_rows(&runtime.db_path), before);
}

// Slice 8: a restore never writes what Setup would refuse — an address that
// is not one machine's, a vMix input out of range, a camera that does not
// exist, CAM 1 with an address; those values stay as this PC has them.
#[test]
fn a_restore_writes_no_camera_value_setup_would_refuse() {
    let test_dir = TestDir::new("format-7-refused-values");
    let runtime = seeded_runtime(&test_dir);
    write_camera(&runtime.db_path, 2, Some("172.16.16.85"), false, 2);
    write_camera(&runtime.db_path, 3, Some("172.16.16.86"), false, 3);
    let mut archive =
        serde_json::to_value(build_support_backup_archive(&runtime).expect("archive should build"))
            .expect("archive should serialize to value");
    archive["cameras"] = json!([
        { "camera": 1, "address": "10.0.0.1", "vmixInput": 1001 },
        { "camera": 2, "address": "224.0.0.1", "vmixInput": 0 },
        { "camera": 3, "address": " 010.000.000.020 ", "vmixInput": 9 },
        { "camera": 4, "address": "10.0.0.4", "vmixInput": 4 }
    ]);
    let path = write_archive(&runtime, "native-backup-refused-values.json", &archive);
    restore_support_backup(&runtime, &request_for(&runtime, &path)).expect("the archive restores");

    let rows = camera_rows(&runtime.db_path);
    assert_eq!((rows[0].address.as_deref(), rows[0].vmix_input), (None, 1));
    assert_eq!(
        (rows[1].address.as_deref(), rows[1].vmix_input),
        (Some("172.16.16.85"), 2)
    );
    assert_eq!(
        (rows[2].address.as_deref(), rows[2].vmix_input),
        (Some("10.0.0.20"), 9),
        "an address Setup takes is written as Setup writes it"
    );
}
