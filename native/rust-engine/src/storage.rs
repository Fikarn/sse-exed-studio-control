use crate::app_state::{
    default_app_settings_entries, COMMISSIONING_COMPLETED_KEY, COMMISSIONING_RUNNER_STAGE_KEY,
    COMMISSIONING_STAGE_KEY,
};
use crate::commissioning::default_settings_entries as default_commissioning_settings_entries;
use crate::legacy_import::{
    load_legacy_import_payload, ImportLegacyError, LegacyImportRequest, LegacyImportSummary,
};
use crate::planning_settings::{
    default_settings_entries as default_planning_settings_entries, DASHBOARD_VIEW_KEY,
    DECK_MODE_KEY, SELECTED_PROJECT_ID_KEY, SELECTED_TASK_ID_KEY, SORT_BY_KEY, VIEW_FILTER_KEY,
};
use crate::shell_settings::{default_settings_entries, WORKSPACE_KEY};
use crate::storage_backups::{snapshot_database_with, SnapshotReason};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Transaction};
use serde_json::{json, to_string, Value};
use std::collections::HashMap;
use std::error::Error;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub type EngineResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
pub(crate) const STORAGE_SCHEMA_VERSION: i64 = 6;
const STORAGE_FORMAT_VERSION_KEY: &str = "storage.format_version";
const STORAGE_FORMAT_VERSION_INITIAL: &str = "1";
const LIGHTING_EDITOR_STATE_KEY: &str = "app.lighting.editor.state";

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
    let connection = open_connection(db_path)?;
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

pub fn set_settings(db_path: &Path, settings: &[(&str, String)]) -> EngineResult<()> {
    apply_settings(db_path, settings, &[])
}

pub fn set_settings_owned(db_path: &Path, settings: &[(String, String)]) -> EngineResult<()> {
    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction()?;

    for (key, value) in settings {
        transaction.execute(
            "INSERT INTO app_settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        )?;
    }

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

    for (key, value) in default_settings_entries()
        .into_iter()
        .chain(default_app_settings_entries())
        .chain(default_commissioning_settings_entries())
        .chain(default_planning_settings_entries())
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

    let had_existing_data = has_existing_planning_data(&transaction)
        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;
    if had_existing_data && !request.force {
        return Err(ImportLegacyError::ExistingDataRequiresForce);
    }

    clear_planning_data(&transaction)
        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;

    for project in &payload.projects {
        transaction
            .execute(
                "INSERT INTO projects(
                    id, title, description, status, priority, created_at, last_updated, sort_order
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    project.id,
                    project.title,
                    project.description,
                    project.status,
                    project.priority,
                    project.created_at,
                    project.last_updated,
                    project.order,
                ],
            )
            .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;
    }

    let mut checklist_items_imported = 0usize;
    let mut normalized_running_tasks = 0usize;

    for task in &payload.tasks {
        let mut total_seconds = task.total_seconds;
        let mut is_running = task.is_running;
        let mut last_started = task.last_started.clone();

        if task.is_running {
            let recovered_seconds = task
                .last_started
                .as_deref()
                .map(|value| recover_elapsed_seconds(&transaction, value))
                .transpose()
                .map_err(|error| ImportLegacyError::Storage(error.to_string()))?
                .unwrap_or(0);

            total_seconds = total_seconds.saturating_add(recovered_seconds);
            is_running = false;
            last_started = None;
            normalized_running_tasks += 1;
        }

        transaction
            .execute(
                "INSERT INTO tasks(
                    id, project_id, title, description, priority, due_date, labels_json,
                    is_running, total_seconds, last_started, completed, sort_order, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    task.id,
                    task.project_id,
                    task.title,
                    task.description,
                    task.priority,
                    task.due_date,
                    to_string(&task.labels)
                        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?,
                    bool_to_int(is_running),
                    total_seconds,
                    last_started,
                    bool_to_int(task.completed),
                    task.order,
                    task.created_at,
                ],
            )
            .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;

        for item in &task.checklist {
            transaction
                .execute(
                    "INSERT INTO task_checklist_items(id, task_id, text, done, sort_order)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        item.id,
                        task.id,
                        item.text,
                        bool_to_int(item.done),
                        item.order,
                    ],
                )
                .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;
            checklist_items_imported += 1;
        }
    }

    for entry in &payload.activity_log {
        transaction
            .execute(
                "INSERT INTO activity_log(id, timestamp, entity_type, entity_id, action, detail)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    entry.id,
                    entry.timestamp,
                    entry.entity_type,
                    entry.entity_id,
                    entry.action,
                    entry.detail,
                ],
            )
            .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;
    }

    let updated_settings = write_imported_settings(&transaction, &payload)
        .map_err(|error| ImportLegacyError::Storage(error.to_string()))?;

    let summary = LegacyImportSummary {
        source_path: payload.source_path.display().to_string(),
        source_schema_version: payload.source_schema_version,
        replaced_existing_data: had_existing_data,
        imported_projects: payload.projects.len(),
        imported_tasks: payload.tasks.len(),
        imported_checklist_items: checklist_items_imported,
        imported_activity_entries: payload.activity_log.len(),
        normalized_running_tasks,
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
                "legacy_import.projects",
                summary.imported_projects.to_string(),
            ),
            ("legacy_import.tasks", summary.imported_tasks.to_string()),
            (
                "legacy_import.checklist_items",
                summary.imported_checklist_items.to_string(),
            ),
            (
                "legacy_import.activity_entries",
                summary.imported_activity_entries.to_string(),
            ),
            (
                "legacy_import.normalized_running_tasks",
                summary.normalized_running_tasks.to_string(),
            ),
            (
                "legacy_import.imported_at_unix",
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

    if schema_version < STORAGE_SCHEMA_VERSION {
        // v5 -> v6 (Wave 34). Seed editable lighting palettes once for
        // existing editor-state rows that predate the palette pool.
        let transaction = connection.transaction()?;
        seed_lighting_palettes_v6(&transaction)?;
        transaction.execute(
            "INSERT INTO schema_migrations(version) VALUES (?1)",
            [STORAGE_SCHEMA_VERSION],
        )?;
        transaction.commit()?;
        schema_version = STORAGE_SCHEMA_VERSION;
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

fn write_imported_settings(
    transaction: &Transaction<'_>,
    payload: &crate::legacy_import::LegacyImportPayload,
) -> Result<usize, rusqlite::Error> {
    delete_settings_keys(
        transaction,
        &[
            SELECTED_PROJECT_ID_KEY,
            SELECTED_TASK_ID_KEY,
            WORKSPACE_KEY,
            COMMISSIONING_COMPLETED_KEY,
            COMMISSIONING_RUNNER_STAGE_KEY,
            COMMISSIONING_STAGE_KEY,
        ],
    )?;

    let mut updates = vec![
        (VIEW_FILTER_KEY, payload.settings.view_filter.clone()),
        (SORT_BY_KEY, payload.settings.sort_by.clone()),
        (DASHBOARD_VIEW_KEY, payload.settings.dashboard_view.clone()),
        (DECK_MODE_KEY, payload.settings.deck_mode.clone()),
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

    if let Some(project_id) = &payload.settings.selected_project_id {
        updates.push((SELECTED_PROJECT_ID_KEY, project_id.clone()));
    }

    if let Some(task_id) = &payload.settings.selected_task_id {
        updates.push((SELECTED_TASK_ID_KEY, task_id.clone()));
    }

    upsert_settings(transaction, &updates)?;
    Ok(updates.len())
}

fn has_existing_planning_data(transaction: &Transaction<'_>) -> Result<bool, rusqlite::Error> {
    Ok(count_rows(transaction, "projects")? > 0
        || count_rows(transaction, "tasks")? > 0
        || count_rows(transaction, "activity_log")? > 0)
}

fn clear_planning_data(transaction: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    transaction.execute("DELETE FROM task_checklist_items", [])?;
    transaction.execute("DELETE FROM tasks", [])?;
    transaction.execute("DELETE FROM projects", [])?;
    transaction.execute("DELETE FROM activity_log", [])?;
    Ok(())
}

fn count_rows(connection: &Connection, table_name: &str) -> Result<i64, rusqlite::Error> {
    let sql = format!("SELECT COUNT(*) FROM {table_name}");
    connection.query_row(&sql, [], |row| row.get(0))
}

fn recover_elapsed_seconds(
    transaction: &Transaction<'_>,
    last_started: &str,
) -> Result<i64, rusqlite::Error> {
    let elapsed_seconds = transaction.query_row(
        "SELECT CAST((julianday('now') - julianday(?1)) * 86400 AS INTEGER)",
        [last_started],
        |row| row.get::<_, Option<i64>>(0),
    )?;

    Ok(elapsed_seconds.unwrap_or(0).max(0))
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests;
