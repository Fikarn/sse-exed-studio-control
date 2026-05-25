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
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, to_string, Value};
use std::collections::HashMap;
use std::error::Error;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub type EngineResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
const STORAGE_SCHEMA_VERSION: i64 = 6;
const STORAGE_FORMAT_VERSION_KEY: &str = "storage.format_version";
const STORAGE_FORMAT_VERSION_INITIAL: &str = "1";

#[derive(Debug)]
pub struct StorageBootstrap {
    pub schema_version: i64,
    pub format_version: String,
    pub journal_mode: String,
    pub integrity_check: String,
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

pub fn initialize_database(db_path: &Path) -> EngineResult<StorageBootstrap> {
    let mut connection = open_connection(db_path)?;
    let resolved_schema_version = migrate_schema(&mut connection)?;

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
    let integrity_check: String =
        connection.pragma_query_value(None, "integrity_check", |row| row.get(0))?;
    let format_version = read_format_version(&connection)?;

    Ok(StorageBootstrap {
        schema_version: resolved_schema_version,
        format_version,
        journal_mode,
        integrity_check,
    })
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
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "busy_timeout", 5000)?;
    Ok(())
}

fn migrate_schema(connection: &mut Connection) -> EngineResult<i64> {
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
    let Ok(mut parsed) = serde_json::from_str::<Value>(&existing_value) else {
        return Ok(());
    };
    let Some(object) = parsed.as_object_mut() else {
        return Ok(());
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
mod tests {
    use super::*;
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

        let bootstrap = initialize_database(&db_path).expect("database should initialize");
        assert_eq!(bootstrap.schema_version, STORAGE_SCHEMA_VERSION);

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
        initialize_database(&db_path).expect("database should initialize");

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
        initialize_database(&db_path).expect("database should initialize");

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

        initialize_database(&db_path).expect("initial migration should succeed");

        let mut connection = open_connection(&db_path).expect("connection should open");
        let resolved = migrate_schema(&mut connection).expect("second migration should succeed");
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

        initialize_database(&db_path).expect("migration to current schema should succeed");

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

        let bootstrap = initialize_database(&db_path).expect("database should initialize");
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

        initialize_database(&db_path).expect("v4 migration should succeed");

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
                    String::from(
                        r#"{"groups":[],"removed_fixture_ids":[],"fixtures":[],"scenes":[]}"#,
                    ),
                ),
            ],
        )
        .expect("dual seed should write");

        initialize_database(&db_path).expect("v4 migration should succeed");

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

        initialize_database(&db_path).expect("v4 migration should succeed");

        let settings = list_settings_by_prefix(&db_path, "app.lighting.fixture.")
            .expect("lighting fixture settings should load");
        assert!(
            settings.is_empty(),
            "all per-fixture lighting keys should be deleted, got: {:?}",
            settings.keys().collect::<Vec<_>>()
        );
    }

    #[test]
    fn migrate_schema_v3_to_v4_handles_malformed_editor_state_json() {
        let test_dir = TestDir::new("storage-v4-malformed-json");
        let db_path = test_dir.path().join("native.sqlite3");

        seed_v3_database(&db_path);
        set_settings_owned(
            &db_path,
            &[(
                String::from("app.lighting.editor.state"),
                String::from("not valid json {{ broken"),
            )],
        )
        .expect("malformed seed should write");

        initialize_database(&db_path).expect("v4 migration should succeed despite bad json");

        let connection = open_connection(&db_path).expect("connection should open");
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

        initialize_database(&db_path).expect("v5 migration should succeed");

        let lighting = list_settings_by_prefix(&db_path, "app.lighting.")
            .expect("lighting settings should load");
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

        initialize_database(&db_path).expect("v6 migration should succeed");

        let settings = list_settings_by_prefix(&db_path, "app.lighting.")
            .expect("lighting settings should load");
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

        initialize_database(&db_path).expect("v6 migration should succeed");

        let settings = list_settings_by_prefix(&db_path, "app.lighting.")
            .expect("lighting settings should load");
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
        initialize_database(&db_path).expect("bootstrap should succeed at current version");
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

        let error = initialize_database(&db_path)
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
}
