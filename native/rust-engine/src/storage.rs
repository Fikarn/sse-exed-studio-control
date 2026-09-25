use crate::app_state::{
    default_app_settings_entries, CommissioningSnapshot, COMMISSIONING_COMPLETED_KEY,
    COMMISSIONING_RUNNER_STAGE_KEY, COMMISSIONING_STAGE_KEY,
};
use crate::commissioning::{
    default_settings_entries as default_commissioning_settings_entries,
    CONTROL_SURFACE_MESSAGE_KEY, PLANNING_ERA_PROBE_PREFIX, PROBE_CHECKED_BEFORE_THIS_VERSION,
};
use crate::legacy_import::{
    load_legacy_import_payload, ImportLegacyError, LegacyImportRequest, LegacyImportSummary,
};
use crate::shell_settings::{default_settings_entries, WORKSPACE_KEY};
use crate::storage_backups::{snapshot_database_with, SnapshotReason};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Transaction};
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::error::Error;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub type EngineResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
/// The newest schema `migrate_schema` knows. Every step there names its own
/// version as a literal; raising this goes with a new `if schema_version < N`
/// block, never with a change to the last one.
pub(crate) const STORAGE_SCHEMA_VERSION: i64 = 8;
const STORAGE_FORMAT_VERSION_KEY: &str = "storage.format_version";
const STORAGE_FORMAT_VERSION_INITIAL: &str = "1";
const LIGHTING_EDITOR_STATE_KEY: &str = "app.lighting.editor.state";

/// When the legacy db.json import last wrote this database. The import's
/// "existing data" gate reads it (new pages program, Slice 2).
const LEGACY_IMPORT_IMPORTED_AT_KEY: &str = "legacy_import.imported_at_unix";

/// `PRAGMA integrity_check` stops after this many findings; the first one is
/// what the operator reads, the rest go to the log.
const INTEGRITY_CHECK_MAX_FINDINGS: usize = 8;

#[derive(Debug)]
pub struct StorageBootstrap {
    pub schema_version: i64,
    pub format_version: String,
    pub journal_mode: String,
    pub integrity_check: String,
}

/// A storage failure the bootstrap turns into a startup code the recovery
/// display can name (2026-09 production readiness, Slice 3 — findings F02,
/// F13). Travels boxed inside `EngineResult` like every other storage error
/// and is recovered with `downcast_ref`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    /// SQLite refused the file as a database, or `PRAGMA integrity_check`
    /// answered something other than `ok`. `detail` is SQLite's own wording.
    Corrupt { db_path: PathBuf, detail: String },
    /// A migration that rewrites a stored JSON value found it unreadable. The
    /// migration's transaction is rolled back and the schema version stays
    /// where it was.
    MigrationFailed { key: String, detail: String },
}

impl fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::Corrupt { db_path, detail } => write!(
                formatter,
                "Database {} failed its integrity check: {detail}",
                db_path.display()
            ),
            StorageError::MigrationFailed { key, detail } => write!(
                formatter,
                "Database migration refused: the stored value {key} is not readable ({detail})"
            ),
        }
    }
}

impl Error for StorageError {}

/// `PRAGMA integrity_check`: exactly `ok` for a sound database, otherwise the
/// first `INTEGRITY_CHECK_MAX_FINDINGS` findings joined with `; `.
pub(crate) fn run_integrity_check(connection: &Connection) -> Result<String, rusqlite::Error> {
    let mut statement = connection.prepare(&format!(
        "PRAGMA integrity_check({INTEGRITY_CHECK_MAX_FINDINGS})"
    ))?;
    let findings = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<String>, rusqlite::Error>>()?;
    Ok(findings.join("; "))
}

pub fn list_settings_by_prefix(
    db_path: &Path,
    prefix: &str,
) -> EngineResult<HashMap<String, String>> {
    if READ_CONNECTION_ENABLED.with(Cell::get) {
        return with_read_connection(db_path, |connection| {
            query_settings_by_prefix(connection, prefix)
        });
    }
    let connection = open_connection(db_path)?;
    Ok(query_settings_by_prefix(&connection, prefix)?)
}

/// The statement and its rows are dropped before this returns, so a
/// connection that outlives the call never pins a read transaction and the
/// write-ahead log can always be checkpointed.
fn query_settings_by_prefix(
    connection: &Connection,
    prefix: &str,
) -> Result<HashMap<String, String>, rusqlite::Error> {
    let mut statement = connection
        .prepare("SELECT key, value FROM app_settings WHERE key LIKE ?1 ORDER BY key ASC")?;
    let rows = statement.query_map([format!("{prefix}%")], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok((key, value))
    })?;

    let mut settings = HashMap::new();
    for row in rows {
        let (key, value) = row?;
        settings.insert(key, value);
    }

    Ok(settings)
}

struct ReadConnection {
    db_path: PathBuf,
    connection: Connection,
}

thread_local! {
    static READ_CONNECTION_ENABLED: Cell<bool> = const { Cell::new(false) };
    static READ_CONNECTION: RefCell<Option<ReadConnection>> = const { RefCell::new(None) };
    static READ_CONNECTION_OPENS: Cell<u64> = const { Cell::new(0) };
}

/// Opts the calling thread into one kept read connection for
/// `list_settings_by_prefix` (2026-09 production readiness, Slice 10 — F18).
/// Only the three threads that live as long as the engine and read settings
/// all day call this — the sACN output, the TotalMix metering and the
/// bridge's workers. Every other thread, the IPC loop and every test thread
/// among them, keeps opening a connection per call, so nothing holds a
/// database file open that a test or a restore is about to move.
pub fn enable_thread_read_connection() {
    READ_CONNECTION_ENABLED.with(|enabled| enabled.set(true));
}

/// Runs `read` on this thread's kept read connection, opening it when there
/// is none yet or when it belongs to another database file. The connection
/// is opened read-write and then made `query_only`: a read-only open fails
/// on a write-ahead-log database whose shared-memory file is gone, which is
/// the state every per-call writer leaves behind. The journal mode and
/// `synchronous` are left as the file has them. A failed read drops the
/// connection, so the next call starts from a fresh one.
pub(crate) fn with_read_connection<T>(
    db_path: &Path,
    read: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
) -> EngineResult<T> {
    READ_CONNECTION.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.as_ref().is_some_and(|kept| kept.db_path != db_path) {
            *slot = None;
        }
        if slot.is_none() {
            let connection = Connection::open(db_path)?;
            connection.pragma_update(None, "busy_timeout", 5000)?;
            connection.pragma_update(None, "query_only", "ON")?;
            READ_CONNECTION_OPENS.with(|opens| opens.set(opens.get() + 1));
            *slot = Some(ReadConnection {
                db_path: db_path.to_path_buf(),
                connection,
            });
        }
        let outcome = slot.as_ref().map(|kept| read(&kept.connection));
        match outcome {
            Some(Ok(value)) => Ok(value),
            Some(Err(error)) => {
                *slot = None;
                Err(error.into())
            }
            None => Err("the read connection could not be kept".into()),
        }
    })
}

/// How many read connections this thread has opened; a test's counter.
#[cfg(test)]
pub(crate) fn thread_read_connection_opens() -> u64 {
    READ_CONNECTION_OPENS.with(Cell::get)
}

/// Closes this thread's read connection and opts the thread out again, so a
/// test can remove its directory.
#[cfg(test)]
pub(crate) fn disable_thread_read_connection() {
    READ_CONNECTION_ENABLED.with(|enabled| enabled.set(false));
    READ_CONNECTION.with(|slot| *slot.borrow_mut() = None);
}

/// Folds the write-ahead log into the database file and empties it. The
/// threads that keep a read connection never close theirs, so the checkpoint
/// SQLite runs when the last connection closes no longer happens by itself:
/// the engine asks for it on a graceful stop, and the pending-restore step
/// asks for it before it moves the database file aside (Slice 10).
pub(crate) fn checkpoint_database(db_path: &Path) -> EngineResult<()> {
    let connection = open_connection(db_path)?;
    let busy: i64 =
        connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))?;
    if busy != 0 {
        return Err("the write-ahead log is in use by a reader and was not folded in".into());
    }
    Ok(())
}

pub fn set_settings(db_path: &Path, settings: &[(&str, String)]) -> EngineResult<()> {
    apply_settings(db_path, settings, &[])
}

pub fn set_settings_owned(db_path: &Path, settings: &[(String, String)]) -> EngineResult<()> {
    set_settings_owned_and(db_path, settings, |_| Ok(()))
}

/// `set_settings_owned` with more work inside the same transaction, so a
/// writer that already commits — the Stream Deck's last-event stamp, the
/// console flush — can add its action-log rows without a second wait for the
/// disk (Slice 11 — F30). Nothing is written when `also` fails.
pub(crate) fn set_settings_owned_and(
    db_path: &Path,
    settings: &[(String, String)],
    also: impl FnOnce(&Transaction<'_>) -> Result<(), rusqlite::Error>,
) -> EngineResult<()> {
    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction()?;

    for (key, value) in settings {
        transaction.execute(
            "INSERT INTO app_settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        )?;
    }
    also(&transaction)?;

    transaction.commit()?;
    Ok(())
}

pub fn apply_settings(
    db_path: &Path,
    settings: &[(&str, String)],
    delete_keys: &[&str],
) -> EngineResult<()> {
    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction()?;
    delete_settings_keys(&transaction, delete_keys)?;
    upsert_settings(&transaction, settings)?;
    transaction.commit()?;
    Ok(())
}

pub fn initialize_database(db_path: &Path, backups_dir: &Path) -> EngineResult<StorageBootstrap> {
    // 2026-09 production readiness, Slice 3 (F02): a file SQLite refuses, or
    // one whose integrity check fails, stops the bootstrap here — before any
    // migration or default could touch it — as `StorageError::Corrupt`.
    let mut connection =
        open_connection(db_path).map_err(|error| classify_open_error(db_path, error))?;
    let integrity_check =
        run_integrity_check(&connection).map_err(|error| classify_open_error(db_path, error))?;
    if integrity_check != "ok" {
        return Err(StorageError::Corrupt {
            db_path: db_path.to_path_buf(),
            detail: integrity_check,
        }
        .into());
    }

    let resolved_schema_version = migrate_schema(&mut connection, backups_dir)?;

    upsert_metadata(
        &connection,
        &[("storage.bootstrap", String::from("initialized"))],
    )?;

    // New pages program, Slice 2: no `planning.*` defaults any more — seeded
    // here, schema 8's drop would come back at every start.
    for (key, value) in default_settings_entries()
        .into_iter()
        .chain(default_app_settings_entries())
        .chain(default_commissioning_settings_entries())
    {
        connection.execute(
            "INSERT INTO app_settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO NOTHING",
            (key, value),
        )?;
    }

    let journal_mode: String =
        connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    let format_version = read_format_version(&connection)?;

    Ok(StorageBootstrap {
        schema_version: resolved_schema_version,
        format_version,
        journal_mode,
        integrity_check,
    })
}

/// Test convenience: the backups directory beside the database, as
/// `resolve_runtime_paths` lays the app-data directory out.
#[cfg(test)]
pub(crate) fn initialize_test_database(db_path: &Path) -> EngineResult<StorageBootstrap> {
    let backups_dir = db_path
        .parent()
        .map(|parent| parent.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"));
    initialize_database(db_path, &backups_dir)
}

/// SQLite's "file is not a database" and "database disk image is malformed"
/// while opening or checking the file are the corrupt-file case, not a
/// generic storage error.
fn classify_open_error(db_path: &Path, error: rusqlite::Error) -> Box<dyn Error + Send + Sync> {
    match error.sqlite_error_code() {
        Some(ErrorCode::NotADatabase) | Some(ErrorCode::DatabaseCorrupt) => {
            Box::new(StorageError::Corrupt {
                db_path: db_path.to_path_buf(),
                detail: error.to_string(),
            })
        }
        _ => Box::new(error),
    }
}

fn read_format_version(connection: &Connection) -> Result<String, rusqlite::Error> {
    connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key = ?1",
            [STORAGE_FORMAT_VERSION_KEY],
            |row| row.get::<_, String>(0),
        )
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(String::from("0")),
            other => Err(other),
        })
}

/// The legacy db.json import, reduced to what is not Planning (new pages
/// program, Slice 2 — interim until Slice 2b retires the import): it writes
/// the setup flag and the page to open, and nothing else. The projects,
/// tasks, checklists, activity entries and Planning settings a db.json holds
/// are ignored.
pub fn import_legacy_db(
    db_path: &Path,
    request: &LegacyImportRequest,
) -> Result<LegacyImportSummary, ImportLegacyError> {
    let payload = load_legacy_import_payload(&request.source_path)?;
    let mut connection =
        open_connection(db_path).map_err(|error| ImportLegacyError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;

    let had_existing_data = legacy_import_would_replace(&transaction)
        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;
    if had_existing_data && !request.force {
        return Err(ImportLegacyError::ExistingDataRequiresForce);
    }

    let updated_settings = write_imported_settings(&transaction, &payload)
        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;

    let summary = LegacyImportSummary {
        source_path: payload.source_path.display().to_string(),
        source_schema_version: payload.source_schema_version,
        replaced_existing_data: had_existing_data,
        updated_settings,
    };

    upsert_metadata(
        &transaction,
        &[
            ("legacy_import.source_path", summary.source_path.clone()),
            (
                "legacy_import.source_schema_version",
                summary.source_schema_version.to_string(),
            ),
            (
                LEGACY_IMPORT_IMPORTED_AT_KEY,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_secs().to_string())
                    .unwrap_or_else(|_| String::from("0")),
            ),
        ],
    )
    .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;

    transaction
        .commit()
        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;

    Ok(summary)
}

/// Whether a legacy db.json import would replace saved data here: the setup
/// is already complete, or a db.json was imported before. Until Slice 2 the
/// gate was "the Planning tables hold rows"; the import now writes only the
/// setup flag and the page to open, so these are what it could replace. The
/// start-up auto-import runs only while this is false, and an explicit
/// import (or a development fixture load) then needs `force`.
pub fn legacy_import_finds_saved_data(db_path: &Path) -> EngineResult<bool> {
    let connection = open_connection(db_path)?;
    Ok(legacy_import_would_replace(&connection)?)
}

fn legacy_import_would_replace(connection: &Connection) -> Result<bool, rusqlite::Error> {
    let imported_before = connection
        .query_row(
            "SELECT 1 FROM app_metadata WHERE key = ?1",
            [LEGACY_IMPORT_IMPORTED_AT_KEY],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let setup_completed = CommissioningSnapshot::from_settings(&query_settings_by_prefix(
        connection,
        "app.commissioning.",
    )?)
    .has_completed_setup;
    Ok(imported_before || setup_completed)
}

pub(crate) fn open_connection(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let connection = Connection::open(db_path)?;
    configure_connection(&connection)?;
    Ok(connection)
}

pub fn read_sqlite_version(db_path: &Path) -> EngineResult<String> {
    let connection = open_connection(db_path)?;
    let sqlite_version = connection.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;
    Ok(sqlite_version)
}

fn configure_connection(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    // 2026-09 production readiness, Slice 3 (F21): every commit waits for the
    // disk, so a power cut on the workstation cannot lose a committed
    // transaction. The write rate is a handful per second at most.
    connection.pragma_update(None, "synchronous", "FULL")?;
    connection.pragma_update(None, "busy_timeout", 5000)?;
    Ok(())
}

fn migrate_schema(connection: &mut Connection, backups_dir: &Path) -> EngineResult<i64> {
    connection.execute_batch(
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
        "#,
    )?;

    let mut schema_version = current_schema_version(connection)?;

    // plan PR 7 / workstream E4: forward-compatibility guard. If the
    // workstation is downgraded to a binary older than the DB schema it
    // last ran against, opening the DB silently used to succeed and any
    // newer-only column or seed would be invisible / corrupted. AGENTS.md
    // rollback posture is: "rollback to a prior tag must remain a
    // reinstall-away; do not change on-disk formats without an explicit
    // migration plan." Surfacing a typed, recoverable error keeps the
    // operator on the original version instead of silently corrupting.
    if schema_version > STORAGE_SCHEMA_VERSION {
        return Err(format!(
            "This workstation database is at schema version {schema_version}, which is newer than this engine binary (supports up to {STORAGE_SCHEMA_VERSION}). \
             Reinstall the newer release or restore a v{STORAGE_SCHEMA_VERSION}-or-earlier backup before launching this version."
        )
        .into());
    }

    // 2026-09 production readiness, Slice 3 (F13): before the first
    // migration step touches an existing database, a verified copy of it
    // goes to the backups directory. A brand-new database (version 0) has
    // nothing to protect.
    if schema_version > 0 && schema_version < STORAGE_SCHEMA_VERSION {
        snapshot_database_with(connection, backups_dir, SnapshotReason::PreMigration)?;
    }

    if schema_version == 0 {
        connection.execute("INSERT INTO schema_migrations(version) VALUES (1)", [])?;
        schema_version = 1;
    }

    if schema_version < 2 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            r#"
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
            "#,
        )?;
        transaction.execute("INSERT INTO schema_migrations(version) VALUES (2)", [])?;
        transaction.commit()?;
        schema_version = 2;
    }

    if schema_version < 3 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            r#"
            ALTER TABLE tasks ADD COLUMN scheduled_start TEXT;
            ALTER TABLE tasks ADD COLUMN scheduled_duration_seconds INTEGER;
            CREATE INDEX IF NOT EXISTS tasks_scheduled_start_idx
              ON tasks(scheduled_start) WHERE scheduled_start IS NOT NULL;
            "#,
        )?;
        transaction.execute("INSERT INTO schema_migrations(version) VALUES (3)", [])?;
        transaction.commit()?;
        schema_version = 3;
    }

    if schema_version < 4 {
        let transaction = connection.transaction()?;

        // Record format_version metadata so future migrations can distinguish
        // DDL shape (schema_migrations) from data shape (format_version).
        transaction.execute(
            "INSERT INTO app_metadata(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO NOTHING",
            params![STORAGE_FORMAT_VERSION_KEY, STORAGE_FORMAT_VERSION_INITIAL],
        )?;

        // Migrate the legacy lighting editor state key to the canonical key,
        // preserving data for any database that still holds only the legacy
        // value, then drop the legacy key unconditionally.
        transaction.execute(
            "INSERT INTO app_settings(key, value)
             SELECT 'app.lighting.editor.state', value
             FROM app_settings
             WHERE key = 'app.control_surface.lighting.state'
               AND NOT EXISTS (
                 SELECT 1 FROM app_settings WHERE key = 'app.lighting.editor.state'
               )",
            [],
        )?;
        transaction.execute(
            "DELETE FROM app_settings WHERE key = 'app.control_surface.lighting.state'",
            [],
        )?;

        // Drop redundant per-fixture lighting keys. The editor state JSON has
        // been the canonical source of truth for fixture intensity/cct/on
        // since the lighting refactor; the per-fixture keys were a stale
        // dual-write path.
        transaction.execute(
            "DELETE FROM app_settings WHERE key LIKE 'app.lighting.fixture.%'",
            [],
        )?;

        transaction.execute("INSERT INTO schema_migrations(version) VALUES (4)", [])?;
        transaction.commit()?;
        schema_version = 4;
    }

    if schema_version < 5 {
        // v4 -> v5 (PR 4 -- Direction D cue cleanup).
        //
        // Direction D dropped the cue model entirely. The frontend has no
        // cue call sites (verified post-PR-3 merge); the engine cue IPCs are
        // gone in PR 4. This migration purges the now-orphaned storage keys
        // so an upgraded operator workstation does not carry orphaned cue
        // bytes forever. The shell.lighting.selectedCueId blob is dropped
        // alongside the engine-side `app.lighting.cues` /
        // `app.lighting.active_cue_id` keys.
        let transaction = connection.transaction()?;

        transaction.execute(
            "DELETE FROM app_settings WHERE key IN
                ('app.lighting.cues',
                 'app.lighting.active_cue_id',
                 'shell.lighting.selectedCueId')",
            [],
        )?;

        transaction.execute("INSERT INTO schema_migrations(version) VALUES (?1)", [5])?;
        transaction.commit()?;
        schema_version = 5;
    }

    if schema_version < 6 {
        // v5 -> v6 (Wave 34). Seed editable lighting palettes once for
        // existing editor-state rows that predate the palette pool. The step
        // names its own version: keyed to the constant, a later version would
        // seed a v6 database a second time — and an operator's deliberately
        // empty palette list reads as "unseeded" to the seed.
        let transaction = connection.transaction()?;
        seed_lighting_palettes_v6(&transaction)?;
        transaction.execute("INSERT INTO schema_migrations(version) VALUES (6)", [])?;
        transaction.commit()?;
        schema_version = 6;
    }

    if schema_version < 7 {
        // v6 -> v7 (2026-09 production readiness, Slice 11 — F30): the action
        // log. One row per discrete action that changed what a device
        // receives, with who did it; `action_log.rs` owns the rows.
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            r#"
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
            "#,
        )?;
        transaction.execute("INSERT INTO schema_migrations(version) VALUES (7)", [])?;
        transaction.commit()?;
        schema_version = 7;
    }

    if schema_version < 8 {
        // v7 -> v8 (new pages program, Slice 2 — D2): Planning left the app.
        // Its four tables go (children first; their indexes go with them),
        // every `planning.*` setting goes, the Planning counts an earlier
        // db.json import recorded go, a saved Planning page opens the
        // Console, and the Control Surface Probe's saved line stops talking
        // about Planning (its status stays). The pre-migration copy written
        // above keeps all of it: it is the way back to an older build, which
        // refuses schema 8. A new database takes this step too, so it ends
        // without the tables that steps 2 and 3 created.
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            r#"
            DROP TABLE IF EXISTS task_checklist_items;
            DROP TABLE IF EXISTS tasks;
            DROP TABLE IF EXISTS projects;
            DROP TABLE IF EXISTS activity_log;

            DELETE FROM app_settings WHERE key LIKE 'planning.%';

            DELETE FROM app_metadata WHERE key IN
                ('legacy_import.projects',
                 'legacy_import.tasks',
                 'legacy_import.checklist_items',
                 'legacy_import.activity_entries',
                 'legacy_import.normalized_running_tasks');

            UPDATE app_settings
               SET value = 'audio', updated_at = CURRENT_TIMESTAMP
             WHERE key = 'shell.workspace' AND value = 'planning';
            "#,
        )?;
        transaction.execute(
            "UPDATE app_settings SET value = ?1, updated_at = CURRENT_TIMESTAMP \
             WHERE key = ?2 AND substr(value, 1, length(?3)) = ?3",
            params![
                PROBE_CHECKED_BEFORE_THIS_VERSION,
                CONTROL_SURFACE_MESSAGE_KEY,
                PLANNING_ERA_PROBE_PREFIX
            ],
        )?;
        transaction.execute("INSERT INTO schema_migrations(version) VALUES (8)", [])?;
        transaction.commit()?;
        schema_version = 8;
    }

    Ok(schema_version)
}

fn seed_lighting_palettes_v6(transaction: &Transaction<'_>) -> EngineResult<()> {
    let existing_value: Option<String> = transaction
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'app.lighting.editor.state'",
            [],
            |row| row.get(0),
        )
        .optional()?;

    let Some(existing_value) = existing_value else {
        return Ok(());
    };
    // 2026-09 production readiness, Slice 3 (F13): an unreadable value is a
    // failed migration, not a skipped one — the transaction rolls back, the
    // schema version stays, and the bootstrap names the key.
    let mut parsed = serde_json::from_str::<Value>(&existing_value).map_err(|error| {
        StorageError::MigrationFailed {
            key: String::from(LIGHTING_EDITOR_STATE_KEY),
            detail: error.to_string(),
        }
    })?;
    let Some(object) = parsed.as_object_mut() else {
        return Err(StorageError::MigrationFailed {
            key: String::from(LIGHTING_EDITOR_STATE_KEY),
            detail: String::from("expected a JSON object"),
        }
        .into());
    };

    let should_seed_palettes = match object.get("palettes") {
        Some(Value::Array(palettes)) => palettes.is_empty(),
        Some(_) => true,
        None => true,
    };
    if should_seed_palettes {
        object.insert(String::from("palettes"), default_lighting_palettes_json());
        object.insert(
            String::from("paletteOrder"),
            default_lighting_palette_order_json(),
        );
    } else {
        let should_build_order = match object.get("paletteOrder") {
            Some(Value::Array(order)) => order.is_empty(),
            _ => true,
        };
        if should_build_order {
            let palette_order = object
                .get("palettes")
                .map(lighting_palette_order_from_json)
                .unwrap_or_default();
            object.insert(String::from("paletteOrder"), Value::Array(palette_order));
        }
    }

    let serialized = serde_json::to_string(&parsed)?;
    transaction.execute(
        "UPDATE app_settings SET value = ?1, updated_at = CURRENT_TIMESTAMP WHERE key = 'app.lighting.editor.state'",
        [serialized],
    )?;
    Ok(())
}

fn default_lighting_palettes_json() -> Value {
    json!([
        { "id": "palette-intensity-low", "name": "Low", "kind": "intensity", "value": 10.0, "colorIndex": 5 },
        { "id": "palette-intensity-quarter", "name": "Quarter", "kind": "intensity", "value": 25.0, "colorIndex": 4 },
        { "id": "palette-intensity-half", "name": "Half", "kind": "intensity", "value": 50.0, "colorIndex": 2 },
        { "id": "palette-intensity-full", "name": "Full", "kind": "intensity", "value": 100.0, "colorIndex": 0 },
        { "id": "palette-cct-warm", "name": "Warm", "kind": "cct", "value": 2700.0, "colorIndex": 0 },
        { "id": "palette-cct-studio", "name": "Studio", "kind": "cct", "value": 4000.0, "colorIndex": 4 },
        { "id": "palette-cct-daylight", "name": "Daylight", "kind": "cct", "value": 5600.0, "colorIndex": 5 },
        { "id": "palette-cct-cool", "name": "Cool", "kind": "cct", "value": 6500.0, "colorIndex": 5 }
    ])
}

fn default_lighting_palette_order_json() -> Value {
    Value::Array(vec![
        Value::String(String::from("palette-intensity-low")),
        Value::String(String::from("palette-intensity-quarter")),
        Value::String(String::from("palette-intensity-half")),
        Value::String(String::from("palette-intensity-full")),
        Value::String(String::from("palette-cct-warm")),
        Value::String(String::from("palette-cct-studio")),
        Value::String(String::from("palette-cct-daylight")),
        Value::String(String::from("palette-cct-cool")),
    ])
}

fn lighting_palette_order_from_json(palettes: &Value) -> Vec<Value> {
    palettes
        .as_array()
        .into_iter()
        .flat_map(|palettes| palettes.iter())
        .filter_map(|palette| {
            palette
                .get("id")
                .and_then(Value::as_str)
                .map(|id| Value::String(String::from(id)))
        })
        .collect()
}

fn current_schema_version(connection: &Connection) -> Result<i64, rusqlite::Error> {
    connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )
}

fn upsert_settings(
    transaction: &Transaction<'_>,
    settings: &[(&str, String)],
) -> Result<(), rusqlite::Error> {
    for (key, value) in settings {
        transaction.execute(
            "INSERT INTO app_settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        )?;
    }

    Ok(())
}

fn delete_settings_keys(
    transaction: &Transaction<'_>,
    keys: &[&str],
) -> Result<(), rusqlite::Error> {
    for key in keys {
        transaction.execute("DELETE FROM app_settings WHERE key = ?1", [key])?;
    }

    Ok(())
}

fn upsert_metadata(
    connection: &Connection,
    values: &[(&str, String)],
) -> Result<(), rusqlite::Error> {
    for (key, value) in values {
        connection.execute(
            "INSERT INTO app_metadata(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
    }

    Ok(())
}

/// The setup flag and the page to open — all a legacy db.json still gives.
fn write_imported_settings(
    transaction: &Transaction<'_>,
    payload: &crate::legacy_import::LegacyImportPayload,
) -> Result<usize, rusqlite::Error> {
    let updates = [
        (WORKSPACE_KEY, payload.settings.shell_workspace.clone()),
        (
            COMMISSIONING_COMPLETED_KEY,
            payload.settings.commissioning_completed.to_string(),
        ),
        (
            COMMISSIONING_RUNNER_STAGE_KEY,
            payload.settings.commissioning_runner_stage.clone(),
        ),
        (
            COMMISSIONING_STAGE_KEY,
            payload.settings.commissioning_stage.clone(),
        ),
    ];

    upsert_settings(transaction, &updates)?;
    Ok(updates.len())
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_schema_8;
