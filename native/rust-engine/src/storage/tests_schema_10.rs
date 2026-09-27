//! New pages program, Slice 8 (D15): schema 10 adds the cameras' Setup —
//! `camera_setup`, one row a camera: CAM 2's and CAM 3's address, whether CAM
//! 1 is paired, and the vMix input that carries each camera's picture. The
//! live data is at schema 7, so the first test makes the whole jump in one
//! start, behind the one pre-migration copy (the ledger's Part C, common
//! rules); a database a build of Slices 4 to 7 left at schema 9 takes the one
//! step. Beside `tests_schema_9.rs` under the 2,000-line file-health guard.

use super::tests::TestDir;
use super::tests_schema_8::{
    schema_objects, schema_versions, seed_v7_database, seed_v7_other_data, seed_v7_planning_data,
    settings_rows,
};
use super::*;
use crate::storage_backups::{newest_snapshot, snapshot_reason_of};
use rusqlite::OpenFlags;
use std::fs;

/// The rows as new and migrated data hold them: nothing entered, nothing
/// paired, each camera's own number as its vMix input.
const NEW_ROWS: [(i64, Option<&str>, i64, i64); 3] =
    [(1, None, 0, 1), (2, None, 0, 2), (3, None, 0, 3)];

fn camera_rows(db_path: &Path) -> Vec<(i64, Option<String>, i64, i64)> {
    let connection = open_connection(db_path).expect("connection should open");
    let mut statement = connection
        .prepare("SELECT camera, address, paired, vmix_input FROM camera_setup ORDER BY camera")
        .expect("the rows should list");
    statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .expect("the rows should read")
        .collect::<Result<Vec<_>, _>>()
        .expect("the rows should collect")
}

fn assert_new_rows(db_path: &Path) {
    let expected: Vec<(i64, Option<String>, i64, i64)> = NEW_ROWS
        .iter()
        .map(|(camera, address, paired, input)| {
            (*camera, address.map(String::from), *paired, *input)
        })
        .collect();
    assert_eq!(camera_rows(db_path), expected);
}

fn prompter_rows(db_path: &Path) -> i64 {
    open_connection(db_path)
        .expect("connection should open")
        .query_row("SELECT COUNT(*) FROM prompter_state", [], |row| row.get(0))
        .expect("the prompter's row should count")
}

fn copy_version_and_camera_table(backup: &Path) -> (i64, i64) {
    let copy = Connection::open_with_flags(backup, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .expect("backup should open");
    let version = copy
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .expect("backup version should read");
    let tables = copy
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'camera_setup'",
            [],
            |row| row.get(0),
        )
        .expect("the copy's tables should read");
    (version, tables)
}

// D15 and the ledger's Part C: the live data's schema 7 goes to schema 10 in
// one start. The cameras' rows arrive with nothing entered, so the first
// start after the upgrade contacts no camera; nothing else is touched but
// what steps 8 and 9 do; the one pre-migration copy is the schema-7
// database. On the build before this slice the start ended at schema 9 with
// no camera table.
#[test]
fn the_live_data_s_schema_7_goes_to_schema_10_in_one_start() {
    let test_dir = TestDir::new("storage-v7-to-v10");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");
    seed_v7_database(&db_path);
    seed_v7_planning_data(&db_path);
    seed_v7_other_data(&db_path);

    let bootstrap =
        initialize_database(&db_path, &backups_dir).expect("the v10 migration should succeed");
    assert_eq!(bootstrap.schema_version, 10);
    assert_eq!(STORAGE_SCHEMA_VERSION, 10);
    assert_eq!(
        schema_versions(&db_path),
        vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
    assert_new_rows(&db_path);
    assert_eq!(prompter_rows(&db_path), 1, "step 9 ran in the same start");
    let rows_after = settings_rows(&db_path);
    assert!(
        rows_after.keys().all(|key| !key.starts_with("cameras.")),
        "the cameras keep their saved data in their own table"
    );

    // What is left is exactly what a new database has.
    let fresh_dir = TestDir::new("storage-v10-fresh-layout");
    let fresh_path = fresh_dir.path().join("native.sqlite3");
    initialize_database(&fresh_path, &fresh_dir.path().join("backups"))
        .expect("a new database should initialize");
    assert_eq!(schema_objects(&db_path), schema_objects(&fresh_path));
    assert_new_rows(&fresh_path);

    // One copy, taken before the first step: the schema-7 database.
    let copies = fs::read_dir(&backups_dir)
        .expect("backups dir should list")
        .filter_map(Result::ok)
        .filter(|entry| snapshot_reason_of(&entry.file_name().to_string_lossy()).is_some())
        .count();
    assert_eq!(copies, 1, "one pre-migration copy for the whole jump");
    let backup = newest_snapshot(&backups_dir).expect("a pre-migration backup should exist");
    assert!(backup.to_string_lossy().ends_with("-pre-migration.sqlite3"));
    assert_eq!(copy_version_and_camera_table(&backup), (7, 0));

    // A second start changes nothing and writes no copy.
    initialize_database(&db_path, &backups_dir).expect("second start should succeed");
    assert_eq!(
        schema_versions(&db_path),
        vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
    assert_new_rows(&db_path);
    assert_eq!(settings_rows(&db_path), rows_after);
    let copies = fs::read_dir(&backups_dir)
        .expect("backups dir should list")
        .filter_map(Result::ok)
        .filter(|entry| snapshot_reason_of(&entry.file_name().to_string_lossy()).is_some())
        .count();
    assert_eq!(copies, 1);
}

// D15: a database at schema 9 (a build of Slices 4 to 7) takes the one step,
// behind a copy of itself at schema 9, and keeps what the Teleprompter saved.
#[test]
fn a_schema_9_database_takes_the_one_step_to_10() {
    let test_dir = TestDir::new("storage-v9-to-v10");
    let db_path = test_dir.path().join("native.sqlite3");
    let backups_dir = test_dir.path().join("backups");
    initialize_database(&db_path, &test_dir.path().join("first-backups"))
        .expect("a new database should initialize");
    // Schema 10 less its step is schema 9 as the build before this slice
    // left it, with a script of the operator's.
    open_connection(&db_path)
        .expect("connection should open")
        .execute_batch(
            "DROP TABLE camera_setup;
             DELETE FROM schema_migrations WHERE version = 10;
             INSERT INTO prompter_scripts
               (id, name, source_file_name, paragraphs, paragraph_count, read_words,
                created_at, changed_at, speed_wpm, place_paragraph, place_word, removed_at)
             VALUES ('script-1', 'Intro', NULL, '[]', 0, 0,
                     '2026-09-26T10:00:00.000Z', '2026-09-26T10:00:00.000Z', 140, 0, 0, NULL);",
        )
        .expect("the database should step back to schema 9");
    assert_eq!(schema_versions(&db_path), vec![1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let rows_before = settings_rows(&db_path);

    let bootstrap =
        initialize_database(&db_path, &backups_dir).expect("the v10 migration should succeed");
    assert_eq!(bootstrap.schema_version, 10);
    assert_new_rows(&db_path);
    assert_eq!(settings_rows(&db_path), rows_before);
    let scripts: i64 = open_connection(&db_path)
        .expect("connection should open")
        .query_row("SELECT COUNT(*) FROM prompter_scripts", [], |row| {
            row.get(0)
        })
        .expect("the scripts should count");
    assert_eq!(scripts, 1, "the operator's script is kept");
    let backup = newest_snapshot(&backups_dir).expect("a pre-migration backup should exist");
    assert_eq!(copy_version_and_camera_table(&backup), (9, 0));
}

// D15: the table itself refuses what Setup would refuse — a fourth camera, a
// vMix input outside 1–1000, a pairing flag that is not 0 or 1 — so no
// write, from any build, can leave a row the cameras cannot read.
#[test]
fn the_camera_table_refuses_what_setup_would_refuse() {
    let test_dir = TestDir::new("storage-v10-checks");
    let db_path = test_dir.path().join("native.sqlite3");
    initialize_test_database(&db_path).expect("a new database should initialize");
    let connection = open_connection(&db_path).expect("connection should open");
    for statement in [
        "INSERT INTO camera_setup (camera, address, paired, vmix_input) VALUES (4, NULL, 0, 4)",
        "INSERT INTO camera_setup (camera, address, paired, vmix_input) VALUES (0, NULL, 0, 1)",
        "UPDATE camera_setup SET vmix_input = 0 WHERE camera = 2",
        "UPDATE camera_setup SET vmix_input = 1001 WHERE camera = 2",
        "UPDATE camera_setup SET paired = 2 WHERE camera = 1",
        "UPDATE camera_setup SET vmix_input = NULL WHERE camera = 3",
    ] {
        assert!(
            connection.execute(statement, []).is_err(),
            "{statement} must be refused"
        );
    }
    assert_new_rows(&db_path);
}
