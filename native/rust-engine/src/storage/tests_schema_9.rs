//! New pages program, Slice 4 (D20): schema 9 adds the Teleprompter's saved
//! data — the scripts, their versions and the prompter's one row. The live
//! data is at schema 7 (the operator's database on the studio workstation,
//! read on 2026-09-24), so the first test makes the whole jump in one start,
//! as the live data will at the program's close-out, behind the one
//! pre-migration copy (the ledger's Part C, common rules). Beside `tests.rs`
//! and `tests_schema_8.rs` under the 2,000-line file-health guard.

use super::tests::{planning_objects, TestDir};
use super::tests_schema_8::{
    metadata, schema_objects, schema_versions, seed_v7_database, seed_v7_other_data,
    seed_v7_planning_data, settings_rows,
};
use super::*;
use crate::storage_backups::{newest_snapshot, snapshot_reason_of};
use rusqlite::OpenFlags;
use std::fs;

const PROMPTER_TABLES: [&str; 3] = [
    "prompter_script_versions",
    "prompter_scripts",
    "prompter_state",
];

fn tables(db_path: &Path) -> Vec<String> {
    let connection = open_connection(db_path).expect("connection should open");
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .expect("the tables should list");
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("the tables should read")
        .collect::<Result<Vec<_>, _>>()
        .expect("the tables should collect")
}

/// The prompter's one row: the look, the take's size, what the glass shows
/// and the two revisions.
fn prompter_state(db_path: &Path) -> (Value, i64, Option<String>, Option<String>, i64, i64) {
    open_connection(db_path)
        .expect("connection should open")
        .query_row(
            "SELECT look, size_px, glass_script_id, glass_paragraphs, glass_revision, look_revision
             FROM prompter_state WHERE id = 1",
            [],
            |row| {
                Ok((
                    serde_json::from_str::<Value>(&row.get::<_, String>(0)?)
                        .expect("the look is JSON"),
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .expect("the prompter's row should read")
}

fn assert_empty_prompter(db_path: &Path) {
    for table in PROMPTER_TABLES {
        assert!(tables(db_path).contains(&String::from(table)), "{table}");
    }
    for table in ["prompter_scripts", "prompter_script_versions"] {
        let rows: i64 = open_connection(db_path)
            .expect("connection should open")
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("the rows should count");
        assert_eq!(rows, 0, "{table} starts empty");
    }
    let (look, size, glass_script, glass_text, glass_revision, look_revision) =
        prompter_state(db_path);
    assert_eq!(
        look,
        serde_json::to_value(crate::prompter::look::PrompterLook::default()).unwrap(),
        "the proposal's standard look (§4.1)"
    );
    assert_eq!(size, 88);
    assert_eq!(glass_script, None, "nothing on the prompter");
    assert_eq!(glass_text, None);
    assert_eq!((glass_revision, look_revision), (0, 0));
}

// D20 and the ledger's Part C: the live data's schema 7 goes to schema 9 in
// one start. Planning leaves as it did in Slice 2, the Teleprompter's tables
// arrive empty with the standard look and nothing on the prompter, nothing
// else is touched, and the one pre-migration copy is the schema-7 database.
// On the build before this slice the start ended at schema 8 with no
// prompter table. Since Slice 8 the same start goes on to schema 10 (the
// cameras' Setup, `tests_schema_10.rs`); it asserted 9 until then.
#[test]
fn the_live_data_s_schema_7_goes_to_schema_9_in_one_start() {
    let test_dir = TestDir::new("storage-v7-to-v9");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");
    seed_v7_database(&db_path);
    seed_v7_planning_data(&db_path);
    seed_v7_other_data(&db_path);
    let rows_before = settings_rows(&db_path);
    let metadata_before = metadata(&db_path);

    let bootstrap =
        initialize_database(&db_path, &backups_dir).expect("the v9 migration should succeed");
    assert_eq!(bootstrap.schema_version, 10);
    assert_eq!(STORAGE_SCHEMA_VERSION, 10);
    assert_eq!(
        schema_versions(&db_path),
        vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );

    assert_eq!(planning_objects(&db_path), Vec::<String>::new());
    assert_empty_prompter(&db_path);
    let rows_after = settings_rows(&db_path);
    for (key, row) in &rows_before {
        if key.starts_with("planning.")
            || key == crate::shell_settings::WORKSPACE_KEY
            || key == CONTROL_SURFACE_MESSAGE_KEY
        {
            continue;
        }
        assert_eq!(rows_after.get(key), Some(row), "{key} was touched");
    }
    assert!(
        rows_after.keys().all(|key| !key.starts_with("prompter.")),
        "the prompter keeps its saved data in its own tables"
    );
    assert_eq!(
        metadata(&db_path).get("storage.format_version"),
        metadata_before.get("storage.format_version")
    );

    // What is left is exactly what a new database has.
    let fresh_dir = TestDir::new("storage-v9-fresh-layout");
    let fresh_path = fresh_dir.path().join("native.sqlite3");
    initialize_database(&fresh_path, &fresh_dir.path().join("backups"))
        .expect("a new database should initialize");
    assert_eq!(schema_objects(&db_path), schema_objects(&fresh_path));
    assert_empty_prompter(&fresh_path);

    // One copy, taken before the first step: the schema-7 database.
    let copies: Vec<_> = fs::read_dir(&backups_dir)
        .expect("backups dir should list")
        .filter_map(Result::ok)
        .filter(|entry| snapshot_reason_of(&entry.file_name().to_string_lossy()).is_some())
        .collect();
    assert_eq!(copies.len(), 1, "one pre-migration copy for the whole jump");
    let backup = newest_snapshot(&backups_dir).expect("a pre-migration backup should exist");
    assert!(backup.to_string_lossy().ends_with("-pre-migration.sqlite3"));
    let copy = Connection::open_with_flags(&backup, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("backup should open");
    let copy_version: i64 = copy
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("backup version should read");
    assert_eq!(copy_version, 7);
    let copy_prompter_tables: i64 = copy
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'prompter_%'",
            [],
            |row| row.get(0),
        )
        .expect("the copy's tables should read");
    assert_eq!(copy_prompter_tables, 0);
    drop(copy);

    // A second start changes nothing and writes no copy.
    initialize_database(&db_path, &backups_dir).expect("second start should succeed");
    assert_eq!(
        schema_versions(&db_path),
        vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
    assert_empty_prompter(&db_path);
    assert_eq!(settings_rows(&db_path), rows_after);
}

// D20: a database at schema 8 (a build of Slices 2 to 3) takes the one step,
// behind a copy of itself at schema 8. Since Slice 8 it takes step 10 after
// it (the test stepped back from 9 and asserted 9 until then).
#[test]
fn a_schema_8_database_takes_the_one_step_to_9() {
    let test_dir = TestDir::new("storage-v8-to-v9");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");
    initialize_database(&db_path, &test_dir.path().join("first-backups"))
        .expect("a new database should initialize");
    // Schema 10 less its last two steps is schema 8 as the build before
    // Slice 4 left it.
    open_connection(&db_path)
        .expect("connection should open")
        .execute_batch(
            "DROP TABLE camera_setup;
             DROP TABLE prompter_script_versions;
             DROP TABLE prompter_scripts;
             DROP TABLE prompter_state;
             DELETE FROM schema_migrations WHERE version IN (9, 10);",
        )
        .expect("the database should step back to schema 8");
    assert_eq!(schema_versions(&db_path), vec![1, 2, 3, 4, 5, 6, 7, 8]);
    let rows_before = settings_rows(&db_path);

    let bootstrap =
        initialize_database(&db_path, &backups_dir).expect("the v9 migration should succeed");
    assert_eq!(bootstrap.schema_version, 10);
    assert_empty_prompter(&db_path);
    assert_eq!(settings_rows(&db_path), rows_before);
    let backup = newest_snapshot(&backups_dir).expect("a pre-migration backup should exist");
    let copy_version: i64 = Connection::open_with_flags(&backup, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("backup should open")
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("backup version should read");
    assert_eq!(copy_version, 8);
}
