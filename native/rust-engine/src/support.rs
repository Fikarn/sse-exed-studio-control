use crate::app_state::{
    COMMISSIONING_COMPLETED_KEY, COMMISSIONING_STAGE_KEY, HARDWARE_PROFILE_KEY,
};
use crate::bootstrap::RuntimeContext;
use crate::commissioning::{
    read_commissioning_snapshot, AUDIO_RECEIVE_PORT_KEY, AUDIO_SEND_HOST_KEY, AUDIO_SEND_PORT_KEY,
    LIGHTING_BRIDGE_IP_KEY, LIGHTING_UNIVERSE_KEY,
};
use crate::diagnostics::append_log;
use crate::legacy_import::{ImportLegacyError, LegacyImportRequest};
use crate::lighting::LIGHTING_SELECTED_FIXTURE_ID_KEY;
use crate::planning::{
    read_planning_snapshot, PlanningActivityEntry, PlanningChecklistItem, PlanningProject,
    PlanningTask,
};
use crate::planning_settings::{
    DASHBOARD_VIEW_KEY, DECK_MODE_KEY, SELECTED_PROJECT_ID_KEY, SELECTED_TASK_ID_KEY, SORT_BY_KEY,
    VIEW_FILTER_KEY,
};
use crate::shell_settings::{
    ShellSettingsSnapshot, LIGHTING_CURRENT_SECTION_ID_KEY, LIGHTING_SCENE_THUMBS_KEY,
    LIGHTING_TALENT_MARKS_KEY, SETUP_ACTIVE_SECTION_KEY, SHELL_SETTINGS_PREFIX, WINDOW_HEIGHT_KEY,
    WINDOW_MAXIMIZED_KEY, WINDOW_MODE_KEY, WINDOW_WIDTH_KEY, WORKSPACE_KEY,
};
use crate::storage::{
    import_legacy_db, list_settings_by_prefix, open_connection, run_integrity_check, EngineResult,
    STORAGE_SCHEMA_VERSION,
};
use crate::storage_backups::{snapshot_database, SnapshotReason};
use rusqlite::{params, Connection, OpenFlags, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Format 4 (2026-09 production readiness, Slice 7 — F20): the archive carries
/// every `shell.` and `app.control_surface.` setting verbatim in `settings`,
/// so the scene thumbnails, the talent marks, the Setup section, the window
/// mode and the deck's bank, dial mode and selections come back with a
/// restore. A reader refuses an archive newer than itself
/// (`SUPPORT_RESTORE_UNSUPPORTED_VERSION`); formats 2 and 3 still read.
pub(crate) const SUPPORT_BACKUP_FORMAT_VERSION: i64 = 4;
const SUPPORT_BACKUP_ARCHIVE_TYPE: &str = "native-support-backup";
/// The two JSON archive names in the backups directory: the operator's
/// exports and the rollback copies a restore writes first.
const EXPORT_ARCHIVE_PREFIX: &str = "native-backup";
const PRE_RESTORE_ARCHIVE_PREFIX: &str = "native-pre-restore";
/// Rollback archives kept after a restore; the database backups have their
/// own retention in `storage_backups` (Slice 3).
const PRE_RESTORE_ARCHIVE_RETENTION: usize = 5;
const ARCHIVE_EXTENSION: &str = "json";
const DATABASE_BACKUP_EXTENSION: &str = "sqlite3";
/// The verified database backup a restore copies here, under the app-data
/// directory; the bootstrap moves it into place at the next start (Slice 7
/// — F20), after the instance lock and before the database is opened.
pub const RESTORE_PENDING_FILE_NAME: &str = "restore-pending.sqlite3";
/// Diagnostics exports older than this are removed at start (Slice 7).
pub const EXPORTS_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const CONTROL_SURFACE_SETTINGS_PREFIX: &str = "app.control_surface.";
/// The setting-key prefixes the archive carries verbatim and a restore
/// clears and rewrites as a whole (F20): the shell's workspace, window,
/// Setup section, scene thumbnails and talent marks, and the deck's state.
pub(crate) const RESTORE_KEY_PREFIXES: &[&str] =
    &[SHELL_SETTINGS_PREFIX, CONTROL_SURFACE_SETTINGS_PREFIX];
const LIGHTING_SETTINGS_PREFIX: &str = "app.lighting.";
const AUDIO_SETTINGS_PREFIX: &str = "app.audio.";
#[cfg(test)]
const LIGHTING_EDITOR_STATE_KEY: &str = "app.lighting.editor.state";

#[derive(Debug)]
pub enum SupportCommandError {
    InvalidParams(String),
    Storage(String),
    /// The backup was written by a newer Studio Control than this one
    /// (`SUPPORT_RESTORE_UNSUPPORTED_VERSION`); nothing was changed.
    UnsupportedVersion(String),
}

/// What a file in the backups directory is: a JSON support archive
/// (`.json`) or a whole database backup (`.sqlite3`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SupportBackupKind {
    Archive,
    Database,
}

impl SupportBackupKind {
    fn from_path(path: &Path) -> Option<Self> {
        match path.extension().and_then(|value| value.to_str()) {
            Some(ARCHIVE_EXTENSION) => Some(SupportBackupKind::Archive),
            Some(DATABASE_BACKUP_EXTENSION) => Some(SupportBackupKind::Database),
            _ => None,
        }
    }
}

/// A verified request against a file inside the backups directory (F29):
/// `source_path` is the path as given, already checked to resolve inside
/// that directory and to be a file of a known kind.
#[derive(Debug, Clone)]
pub struct SupportRestoreRequest {
    pub source_path: PathBuf,
    pub kind: SupportBackupKind,
}

#[derive(Debug, Serialize, Clone)]
pub struct SupportSnapshot {
    #[serde(rename = "backupDir")]
    pub backup_dir: String,
    #[serde(rename = "backupCount")]
    pub backup_count: usize,
    #[serde(rename = "latestBackupPath")]
    pub latest_backup_path: Option<String>,
    pub summary: String,
    #[serde(rename = "restoreSummary")]
    pub restore_summary: String,
    pub backups: Vec<SupportFileEntry>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SupportFileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "modifiedAt")]
    pub modified_at: i64,
    pub kind: SupportBackupKind,
}

#[derive(Debug, Serialize)]
pub struct SupportBackupExportSummary {
    pub path: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "formatVersion")]
    pub format_version: i64,
    #[serde(rename = "projectCount")]
    pub project_count: usize,
    #[serde(rename = "taskCount")]
    pub task_count: usize,
    #[serde(rename = "activityEntryCount")]
    pub activity_entry_count: usize,
}

#[derive(Debug, Serialize)]
pub struct SupportBackupRestoreSummary {
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "sourceFormat")]
    pub source_format: String,
    /// The rollback copy written before anything changed: a JSON archive for
    /// an archive restore, a `pre-restore` database backup for a database
    /// restore — `None` only when the current saved data could not be copied
    /// (a database restore from the recovery surface).
    #[serde(rename = "rollbackBackupPath")]
    pub rollback_backup_path: Option<String>,
    #[serde(rename = "projectCount")]
    pub project_count: usize,
    #[serde(rename = "taskCount")]
    pub task_count: usize,
    #[serde(rename = "checklistItemCount")]
    pub checklist_item_count: usize,
    #[serde(rename = "activityEntryCount")]
    pub activity_entry_count: usize,
    #[serde(rename = "settingsRestored")]
    pub settings_restored: usize,
    /// A database backup is staged, not applied: it takes effect when the
    /// engine is started again (the shell restarts it on this flag).
    #[serde(rename = "requiresRestart")]
    pub requires_restart: bool,
}

/// The answer to `support.backup.verify`: whether the file can be restored
/// by this app, and what it is.
#[derive(Debug, Serialize)]
pub struct SupportBackupVerification {
    pub ok: bool,
    pub kind: SupportBackupKind,
    pub path: String,
    #[serde(rename = "formatVersion", skip_serializing_if = "Option::is_none")]
    pub format_version: Option<i64>,
    #[serde(rename = "schemaVersion", skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<i64>,
    pub detail: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupportBackupArchive {
    #[serde(rename = "archiveType")]
    archive_type: String,
    #[serde(rename = "formatVersion")]
    format_version: i64,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    #[serde(rename = "engineVersion")]
    engine_version: String,
    #[serde(default, rename = "storageFormatVersion")]
    storage_format_version: Option<String>,
    planning: SupportPlanningArchive,
    commissioning: SupportCommissioningArchive,
    shell: ShellSettingsSnapshot,
    /// Format 4: every setting under `RESTORE_KEY_PREFIXES`, verbatim.
    #[serde(default)]
    settings: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupportPlanningArchive {
    pub projects: Vec<PlanningProject>,
    pub tasks: Vec<PlanningTask>,
    #[serde(rename = "activityLog")]
    pub activity_log: Vec<PlanningActivityEntry>,
    pub settings: SupportPlanningSettingsArchive,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupportPlanningSettingsArchive {
    #[serde(rename = "viewFilter")]
    pub view_filter: String,
    #[serde(rename = "sortBy")]
    pub sort_by: String,
    #[serde(rename = "dashboardView")]
    pub dashboard_view: String,
    #[serde(rename = "deckMode")]
    pub deck_mode: String,
    #[serde(default, rename = "modeSection")]
    pub mode_section: Option<String>,
    #[serde(default, rename = "timelineStartHour")]
    pub timeline_start_hour: Option<i64>,
    #[serde(default, rename = "timelineEndHour")]
    pub timeline_end_hour: Option<i64>,
    #[serde(rename = "selectedProjectId")]
    pub selected_project_id: Option<String>,
    #[serde(rename = "selectedTaskId")]
    pub selected_task_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupportCommissioningArchive {
    #[serde(rename = "hasCompletedSetup")]
    pub has_completed_setup: bool,
    pub stage: String,
    #[serde(rename = "hardwareProfile")]
    pub hardware_profile: String,
    pub lighting: SupportLightingArchive,
    pub audio: SupportAudioArchive,
    pub checks: Vec<SupportCommissioningCheckArchive>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupportLightingArchive {
    #[serde(rename = "bridgeIp")]
    pub bridge_ip: String,
    pub universe: i64,
    #[serde(default)]
    pub settings: HashMap<String, String>,
    #[serde(rename = "selectedFixtureId")]
    pub selected_fixture_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupportAudioArchive {
    #[serde(rename = "sendHost")]
    pub send_host: String,
    #[serde(rename = "sendPort")]
    pub send_port: i64,
    #[serde(rename = "receivePort")]
    pub receive_port: i64,
    #[serde(default)]
    pub settings: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupportCommissioningCheckArchive {
    pub id: String,
    pub status: String,
    pub message: String,
    #[serde(rename = "checkedAt")]
    pub checked_at: Option<String>,
}

/// What a database backup holds, read from a read-only connection: the
/// schema version and the counts the restore summary reports.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DatabaseBackupFacts {
    pub schema_version: i64,
    pub project_count: usize,
    pub task_count: usize,
    pub checklist_item_count: usize,
    pub activity_entry_count: usize,
    pub settings_count: usize,
}

/// `support.backup.restore` and `support.backup.verify` take `{ path }`. The
/// path must resolve (links followed) to a file inside the backups directory
/// — nothing else on the workstation can be named (F29) — and be a `.json`
/// archive or a `.sqlite3` database backup.
pub fn parse_support_restore_request(
    params: &Value,
    backups_dir: &Path,
) -> Result<SupportRestoreRequest, String> {
    let source_path = params
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("path is required and must be a non-empty string"))?;

    resolve_backup_file(Path::new(source_path), backups_dir)
}

fn resolve_backup_file(
    source_path: &Path,
    backups_dir: &Path,
) -> Result<SupportRestoreRequest, String> {
    let canonical_source = fs::canonicalize(source_path)
        .map_err(|_| format!("Backup file was not found: {}", source_path.display()))?;
    let canonical_root = fs::canonicalize(backups_dir).map_err(|error| {
        format!(
            "The backups folder {} is not available: {error}",
            backups_dir.display()
        )
    })?;
    if !canonical_source.starts_with(&canonical_root) {
        return Err(format!(
            "Only files inside the backups folder can be restored or verified: {} is outside {}.",
            source_path.display(),
            backups_dir.display()
        ));
    }
    if !canonical_source.is_file() {
        return Err(format!(
            "Backup path is not a file: {}",
            source_path.display()
        ));
    }
    let kind = SupportBackupKind::from_path(&canonical_source).ok_or_else(|| {
        format!(
            "{} is neither a backup archive (.{ARCHIVE_EXTENSION}) nor a database backup (.{DATABASE_BACKUP_EXTENSION}).",
            source_path.display()
        )
    })?;

    Ok(SupportRestoreRequest {
        source_path: source_path.to_path_buf(),
        kind,
    })
}

pub fn read_support_snapshot(runtime: &RuntimeContext) -> EngineResult<SupportSnapshot> {
    fs::create_dir_all(&runtime.backups_dir)?;
    let mut backups = list_backup_files(&runtime.backups_dir)?;
    backups.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| right.name.cmp(&left.name))
    });

    let archive_count = backups
        .iter()
        .filter(|entry| entry.kind == SupportBackupKind::Archive)
        .count();
    let database_count = backups.len() - archive_count;
    let latest_backup_path = backups.first().map(|entry| entry.path.clone());
    let summary = format!(
        "{} in {} ({} and {}). Latest: {}.",
        plural(backups.len(), "backup"),
        runtime.backups_dir.display(),
        plural(archive_count, "backup archive"),
        plural(database_count, "database backup"),
        latest_backup_path.as_deref().unwrap_or("none")
    );
    let restore_summary = String::from(
        "Restore a backup archive or a database backup from the backups folder. A rollback backup is written first; a database backup takes effect once Studio Control has restarted its hardware link.",
    );

    Ok(SupportSnapshot {
        backup_dir: runtime.backups_dir.display().to_string(),
        backup_count: backups.len(),
        latest_backup_path,
        summary,
        restore_summary,
        backups,
    })
}

fn plural(count: usize, noun: &str) -> String {
    if count == 1 {
        format!("1 {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

pub fn export_support_backup(
    runtime: &RuntimeContext,
) -> Result<SupportBackupExportSummary, SupportCommandError> {
    write_support_backup_archive(runtime, EXPORT_ARCHIVE_PREFIX)
}

/// `support.backup.verify`: reads the file without changing anything and
/// says whether this app can restore it. A JSON archive must parse as a
/// support archive of a format this reader knows (or as a legacy `db.json`
/// export); a database backup must open read-only, pass `integrity_check`
/// and carry a schema this app can upgrade from. Never an error: a junk file
/// is `ok: false` with the reason.
pub fn verify_support_backup(request: &SupportRestoreRequest) -> SupportBackupVerification {
    let path = request.source_path.display().to_string();
    match request.kind {
        SupportBackupKind::Archive => match inspect_archive(&request.source_path) {
            Ok(ArchiveFacts::Native {
                format_version,
                exported_at,
                project_count,
                task_count,
            }) if format_version <= SUPPORT_BACKUP_FORMAT_VERSION => SupportBackupVerification {
                ok: true,
                kind: request.kind,
                path,
                format_version: Some(format_version),
                schema_version: None,
                detail: format!(
                    "Backup archive, format {format_version}, exported {exported_at}: {} and {}.",
                    plural(project_count, "project"),
                    plural(task_count, "task")
                ),
            },
            Ok(ArchiveFacts::Native { format_version, .. }) => SupportBackupVerification {
                ok: false,
                kind: request.kind,
                path,
                format_version: Some(format_version),
                schema_version: None,
                detail: newer_archive_sentence(format_version),
            },
            Ok(ArchiveFacts::Legacy { schema_version }) => SupportBackupVerification {
                ok: true,
                kind: request.kind,
                path,
                format_version: None,
                schema_version: Some(schema_version),
                detail: format!(
                    "Legacy db.json export (schema {schema_version}); planning data and settings are imported from it."
                ),
            },
            Err(detail) => SupportBackupVerification {
                ok: false,
                kind: request.kind,
                path,
                format_version: None,
                schema_version: None,
                detail,
            },
        },
        SupportBackupKind::Database => match inspect_database_backup(&request.source_path) {
            Ok(facts) if facts.schema_version <= STORAGE_SCHEMA_VERSION => {
                SupportBackupVerification {
                    ok: true,
                    kind: request.kind,
                    path,
                    format_version: None,
                    schema_version: Some(facts.schema_version),
                    detail: format!(
                        "Database backup, schema {}, integrity ok: {}, {} and {}.",
                        facts.schema_version,
                        plural(facts.project_count, "project"),
                        plural(facts.task_count, "task"),
                        plural(facts.settings_count, "setting")
                    ),
                }
            }
            Ok(facts) => SupportBackupVerification {
                ok: false,
                kind: request.kind,
                path,
                format_version: None,
                schema_version: Some(facts.schema_version),
                detail: newer_database_sentence(facts.schema_version),
            },
            Err(detail) => SupportBackupVerification {
                ok: false,
                kind: request.kind,
                path,
                format_version: None,
                schema_version: None,
                detail,
            },
        },
    }
}

fn newer_archive_sentence(format_version: i64) -> String {
    format!(
        "This backup archive was written by a newer Studio Control (format {format_version}; this app reads up to format {SUPPORT_BACKUP_FORMAT_VERSION}). Update the app, or restore an older backup."
    )
}

fn newer_database_sentence(schema_version: i64) -> String {
    format!(
        "This database backup was written by a newer Studio Control (schema {schema_version}; this app runs schema {STORAGE_SCHEMA_VERSION}). Update the app, or restore an older backup."
    )
}

enum ArchiveFacts {
    Native {
        format_version: i64,
        exported_at: String,
        project_count: usize,
        task_count: usize,
    },
    Legacy {
        schema_version: i64,
    },
}

fn inspect_archive(path: &Path) -> Result<ArchiveFacts, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("{} could not be read: {error}", path.display()))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("{} is not a JSON backup: {error}", path.display()))?;
    let Some(object) = parsed.as_object() else {
        return Err(format!(
            "{} is not a Studio Control backup archive.",
            path.display()
        ));
    };
    if object
        .get("archiveType")
        .and_then(Value::as_str)
        .is_some_and(|value| value == SUPPORT_BACKUP_ARCHIVE_TYPE)
    {
        let format_version = object
            .get("formatVersion")
            .and_then(Value::as_i64)
            .ok_or_else(|| {
                format!(
                    "{} is a backup archive without a format version.",
                    path.display()
                )
            })?;
        let count = |section: &str, key: &str| {
            object
                .get(section)
                .and_then(|value| value.get(key))
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
        };
        return Ok(ArchiveFacts::Native {
            format_version,
            exported_at: object
                .get("exportedAt")
                .and_then(Value::as_str)
                .unwrap_or("at an unknown time")
                .to_string(),
            project_count: count("planning", "projects"),
            task_count: count("planning", "tasks"),
        });
    }
    if object.get("projects").is_some_and(Value::is_array)
        && object.get("schemaVersion").is_some_and(Value::is_number)
    {
        return Ok(ArchiveFacts::Legacy {
            schema_version: object
                .get("schemaVersion")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        });
    }
    Err(format!(
        "{} is not a Studio Control backup archive.",
        path.display()
    ))
}

/// Opens a database backup read-only and checks it: SQLite must accept the
/// file, `PRAGMA integrity_check` must answer `ok`, and the schema table must
/// be there. The bootstrap runs the same check on the pending file before it
/// replaces the live database.
pub(crate) fn inspect_database_backup(path: &Path) -> Result<DatabaseBackupFacts, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("{} could not be opened: {error}", path.display()))?;
    let integrity = run_integrity_check(&connection)
        .map_err(|error| format!("{} is not a usable database: {error}", path.display()))?;
    if integrity != "ok" {
        return Err(format!(
            "{} failed its integrity check ({}).",
            path.display(),
            integrity.split("; ").next().unwrap_or(&integrity)
        ));
    }
    let count = |sql: &str| -> Result<usize, String> {
        connection
            .query_row(sql, [], |row| row.get::<_, i64>(0))
            .map(|value| value.max(0) as usize)
            .map_err(|error| {
                format!(
                    "{} is not a Studio Control database: {error}",
                    path.display()
                )
            })
    };
    let schema_version = count("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")? as i64;
    Ok(DatabaseBackupFacts {
        schema_version,
        project_count: count("SELECT COUNT(*) FROM projects")?,
        task_count: count("SELECT COUNT(*) FROM tasks")?,
        checklist_item_count: count("SELECT COUNT(*) FROM task_checklist_items")?,
        activity_entry_count: count("SELECT COUNT(*) FROM activity_log")?,
        settings_count: count("SELECT COUNT(*) FROM app_settings")?,
    })
}

pub fn restore_support_backup(
    runtime: &RuntimeContext,
    request: &SupportRestoreRequest,
) -> Result<SupportBackupRestoreSummary, SupportCommandError> {
    match request.kind {
        SupportBackupKind::Archive => restore_archive_backup(runtime, request),
        SupportBackupKind::Database => restore_database_backup(runtime, request),
    }
}

/// A JSON archive is applied in place: parsed and checked first (a newer
/// format is refused before anything is written), then a rollback archive
/// is written, then the planning tables and the archive's settings replace
/// what is there in one transaction.
fn restore_archive_backup(
    runtime: &RuntimeContext,
    request: &SupportRestoreRequest,
) -> Result<SupportBackupRestoreSummary, SupportCommandError> {
    if !runtime.storage_ready {
        return Err(SupportCommandError::InvalidParams(String::from(
            "The saved data could not be opened, so a backup archive cannot be applied to it. Restore a database backup first; an archive can be applied once Studio Control is back.",
        )));
    }
    let raw = fs::read_to_string(&request.source_path)
        .map_err(|error| SupportCommandError::Storage(error.to_string()))?;
    let parsed: Value = serde_json::from_str(&raw)
        .map_err(|error| SupportCommandError::InvalidParams(error.to_string()))?;

    if parsed
        .get("archiveType")
        .and_then(Value::as_str)
        .map(|value| value == SUPPORT_BACKUP_ARCHIVE_TYPE)
        .unwrap_or(false)
    {
        let format_version = parsed
            .get("formatVersion")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if format_version > SUPPORT_BACKUP_FORMAT_VERSION {
            return Err(SupportCommandError::UnsupportedVersion(
                newer_archive_sentence(format_version),
            ));
        }
        let archive: SupportBackupArchive = serde_json::from_value(parsed)
            .map_err(|error| SupportCommandError::InvalidParams(error.to_string()))?;
        let rollback = write_support_backup_archive(runtime, PRE_RESTORE_ARCHIVE_PREFIX)?;
        let summary = restore_native_support_archive(&runtime.db_path, &archive)
            .map_err(|error| SupportCommandError::Storage(error.to_string()))?;
        prune_pre_restore_archives(runtime);

        return Ok(SupportBackupRestoreSummary {
            source_path: request.source_path.display().to_string(),
            source_format: String::from("native-support-backup"),
            rollback_backup_path: Some(rollback.path),
            project_count: summary.project_count,
            task_count: summary.task_count,
            checklist_item_count: summary.checklist_item_count,
            activity_entry_count: summary.activity_entry_count,
            settings_restored: summary.settings_restored,
            requires_restart: false,
        });
    }

    let rollback = write_support_backup_archive(runtime, PRE_RESTORE_ARCHIVE_PREFIX)?;
    let legacy_summary = import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: request.source_path.clone(),
            force: true,
        },
    )
    .map_err(|error| match error {
        ImportLegacyError::SourceNotFound(path) => SupportCommandError::InvalidParams(format!(
            "Backup file was not found: {}",
            path.display()
        )),
        ImportLegacyError::SourceReadFailed(message)
        | ImportLegacyError::SourceParseFailed(message)
        | ImportLegacyError::InvalidData(message) => SupportCommandError::InvalidParams(message),
        ImportLegacyError::ExistingDataRequiresForce | ImportLegacyError::Storage(_) => {
            SupportCommandError::Storage(error.to_string())
        }
    })?;
    prune_pre_restore_archives(runtime);

    Ok(SupportBackupRestoreSummary {
        source_path: request.source_path.display().to_string(),
        source_format: String::from("legacy-db-json"),
        rollback_backup_path: Some(rollback.path),
        project_count: legacy_summary.imported_projects,
        task_count: legacy_summary.imported_tasks,
        checklist_item_count: legacy_summary.imported_checklist_items,
        activity_entry_count: legacy_summary.imported_activity_entries,
        settings_restored: legacy_summary.updated_settings,
        requires_restart: false,
    })
}

/// A database backup is never applied to an open database: it is checked,
/// the live database is copied as a `pre-restore` backup (when it can be
/// opened at all — from the recovery surface it cannot, and the bootstrap
/// keeps the replaced file instead), and the backup is copied to
/// `restore-pending.sqlite3`, which the next start moves into place.
fn restore_database_backup(
    runtime: &RuntimeContext,
    request: &SupportRestoreRequest,
) -> Result<SupportBackupRestoreSummary, SupportCommandError> {
    let facts = inspect_database_backup(&request.source_path)
        .map_err(SupportCommandError::InvalidParams)?;
    if facts.schema_version > STORAGE_SCHEMA_VERSION {
        return Err(SupportCommandError::UnsupportedVersion(
            newer_database_sentence(facts.schema_version),
        ));
    }
    let rollback_backup_path = if runtime.storage_ready {
        let rollback = snapshot_database(
            &runtime.db_path,
            &runtime.backups_dir,
            SnapshotReason::PreRestore,
        )
        .map_err(|error| SupportCommandError::Storage(error.to_string()))?;
        Some(rollback.display().to_string())
    } else {
        None
    };
    let pending = stage_database_restore(runtime, &request.source_path)?;
    let _ = append_log(
        &runtime.log_file_path,
        "INFO",
        &format!(
            "Database restore staged: {} copied to {}; applied at the next start",
            request.source_path.display(),
            pending.display()
        ),
    );

    Ok(SupportBackupRestoreSummary {
        source_path: request.source_path.display().to_string(),
        source_format: String::from("database-backup"),
        rollback_backup_path,
        project_count: facts.project_count,
        task_count: facts.task_count,
        checklist_item_count: facts.checklist_item_count,
        activity_entry_count: facts.activity_entry_count,
        settings_restored: facts.settings_count,
        requires_restart: true,
    })
}

fn stage_database_restore(
    runtime: &RuntimeContext,
    source_path: &Path,
) -> Result<PathBuf, SupportCommandError> {
    let pending = runtime.app_data_dir.join(RESTORE_PENDING_FILE_NAME);
    fs::copy(source_path, &pending).map_err(|error| {
        SupportCommandError::Storage(format!(
            "Could not copy {} to {}: {error}",
            source_path.display(),
            pending.display()
        ))
    })?;
    fs::OpenOptions::new()
        .write(true)
        .open(&pending)
        .and_then(|file| file.sync_all())
        .map_err(|error| {
            SupportCommandError::Storage(format!("Could not flush {}: {error}", pending.display()))
        })?;
    Ok(pending)
}

/// Keeps the newest `PRE_RESTORE_ARCHIVE_RETENTION` rollback archives; a
/// failure to prune is logged, never a failed restore.
fn prune_pre_restore_archives(runtime: &RuntimeContext) {
    if let Err(error) = prune_pre_restore_archives_in(&runtime.backups_dir) {
        let _ = append_log(
            &runtime.log_file_path,
            "WARN",
            &format!("Rollback archive pruning failed: {error}"),
        );
    }
}

fn write_support_backup_archive(
    runtime: &RuntimeContext,
    file_prefix: &str,
) -> Result<SupportBackupExportSummary, SupportCommandError> {
    fs::create_dir_all(&runtime.backups_dir)
        .map_err(|error| SupportCommandError::Storage(error.to_string()))?;

    let archive = build_support_backup_archive(runtime)
        .map_err(|error| SupportCommandError::Storage(error.to_string()))?;
    let file_name = format!(
        "{file_prefix}-{}.json",
        sanitize_for_file_name(&archive.exported_at)
    );
    let path = runtime.backups_dir.join(&file_name);
    let bytes = serde_json::to_vec_pretty(&archive)
        .map_err(|error| SupportCommandError::Storage(error.to_string()))?;
    fs::write(&path, bytes).map_err(|error| SupportCommandError::Storage(error.to_string()))?;

    Ok(SupportBackupExportSummary {
        path: path.display().to_string(),
        file_name,
        format_version: archive.format_version,
        project_count: archive.planning.projects.len(),
        task_count: archive.planning.tasks.len(),
        activity_entry_count: archive.planning.activity_log.len(),
    })
}

fn build_support_backup_archive(runtime: &RuntimeContext) -> EngineResult<SupportBackupArchive> {
    let planning_settings = list_settings_by_prefix(
        &runtime.db_path,
        crate::planning_settings::PLANNING_SETTINGS_PREFIX,
    )?;
    let planning_snapshot = read_planning_snapshot(&runtime.db_path, &planning_settings)?;
    let commissioning_snapshot = read_commissioning_snapshot(&runtime.db_path)?;
    let shell_settings_map = list_settings_by_prefix(&runtime.db_path, SHELL_SETTINGS_PREFIX)?;
    let lighting_settings = list_settings_by_prefix(&runtime.db_path, LIGHTING_SETTINGS_PREFIX)?;
    let audio_settings = list_settings_by_prefix(&runtime.db_path, AUDIO_SETTINGS_PREFIX)?;
    let selected_fixture_settings =
        list_settings_by_prefix(&runtime.db_path, LIGHTING_SELECTED_FIXTURE_ID_KEY)?;
    let shell_snapshot = ShellSettingsSnapshot::from_settings(&shell_settings_map);
    // Format 4 (F20): the raw settings under every restore prefix, so a
    // restore puts back exactly what was exported — thumbnails, marks, the
    // deck's state — not only the fields the structured snapshot names.
    let mut settings = HashMap::new();
    for prefix in RESTORE_KEY_PREFIXES {
        settings.extend(list_settings_by_prefix(&runtime.db_path, prefix)?);
    }
    let exported_at = current_timestamp(&runtime.db_path)?;
    let storage_format_version = read_storage_format_version(&runtime.db_path)?;

    Ok(SupportBackupArchive {
        archive_type: String::from(SUPPORT_BACKUP_ARCHIVE_TYPE),
        format_version: SUPPORT_BACKUP_FORMAT_VERSION,
        exported_at,
        engine_version: String::from(env!("CARGO_PKG_VERSION")),
        storage_format_version,
        planning: SupportPlanningArchive {
            projects: planning_snapshot.projects,
            tasks: planning_snapshot.tasks,
            activity_log: planning_snapshot.activity_log,
            settings: SupportPlanningSettingsArchive {
                view_filter: planning_snapshot.settings.view_filter,
                sort_by: planning_snapshot.settings.sort_by,
                dashboard_view: planning_snapshot.settings.dashboard_view,
                deck_mode: planning_snapshot.settings.deck_mode,
                mode_section: Some(planning_snapshot.settings.mode_section),
                timeline_start_hour: Some(planning_snapshot.settings.timeline_start_hour),
                timeline_end_hour: Some(planning_snapshot.settings.timeline_end_hour),
                selected_project_id: planning_snapshot.settings.selected_project_id,
                selected_task_id: planning_snapshot.settings.selected_task_id,
            },
        },
        commissioning: SupportCommissioningArchive {
            has_completed_setup: commissioning_snapshot.has_completed_setup,
            stage: commissioning_snapshot.stage,
            hardware_profile: commissioning_snapshot.hardware_profile,
            lighting: SupportLightingArchive {
                bridge_ip: commissioning_snapshot.lighting.bridge_ip,
                universe: commissioning_snapshot.lighting.universe,
                settings: lighting_settings,
                selected_fixture_id: selected_fixture_settings
                    .get(LIGHTING_SELECTED_FIXTURE_ID_KEY)
                    .cloned()
                    .filter(|value| !value.trim().is_empty()),
            },
            audio: SupportAudioArchive {
                send_host: commissioning_snapshot.audio.send_host,
                send_port: commissioning_snapshot.audio.send_port,
                receive_port: commissioning_snapshot.audio.receive_port,
                settings: audio_settings,
            },
            checks: commissioning_snapshot
                .checks
                .into_iter()
                .map(|check| SupportCommissioningCheckArchive {
                    id: check.id,
                    status: check.status,
                    message: check.message,
                    checked_at: check.checked_at,
                })
                .collect(),
        },
        shell: shell_snapshot,
        settings,
    })
}

fn restore_native_support_archive(
    db_path: &Path,
    archive: &SupportBackupArchive,
) -> EngineResult<NativeRestoreSummary> {
    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction()?;

    clear_planning_data(&transaction)?;
    clear_support_settings(&transaction)?;
    write_projects(&transaction, &archive.planning.projects)?;
    let checklist_item_count = write_tasks(&transaction, &archive.planning.tasks)?;
    write_activity_log(&transaction, &archive.planning.activity_log)?;
    let settings_restored = write_support_settings(
        &transaction,
        &archive.planning.settings,
        &archive.commissioning,
        &archive.shell,
        &archive.settings,
    )?;

    transaction.commit()?;

    Ok(NativeRestoreSummary {
        project_count: archive.planning.projects.len(),
        task_count: archive.planning.tasks.len(),
        checklist_item_count,
        activity_entry_count: archive.planning.activity_log.len(),
        settings_restored,
    })
}

fn clear_planning_data(transaction: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    transaction.execute("DELETE FROM task_checklist_items", [])?;
    transaction.execute("DELETE FROM tasks", [])?;
    transaction.execute("DELETE FROM projects", [])?;
    transaction.execute("DELETE FROM activity_log", [])?;
    Ok(())
}

fn clear_support_settings(transaction: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    for key in [
        VIEW_FILTER_KEY,
        SORT_BY_KEY,
        DASHBOARD_VIEW_KEY,
        DECK_MODE_KEY,
        crate::planning_settings::MODE_SECTION_KEY,
        crate::planning_settings::TIMELINE_START_HOUR_KEY,
        crate::planning_settings::TIMELINE_END_HOUR_KEY,
        SELECTED_PROJECT_ID_KEY,
        SELECTED_TASK_ID_KEY,
        COMMISSIONING_COMPLETED_KEY,
        COMMISSIONING_STAGE_KEY,
        HARDWARE_PROFILE_KEY,
        LIGHTING_BRIDGE_IP_KEY,
        LIGHTING_UNIVERSE_KEY,
        AUDIO_SEND_HOST_KEY,
        AUDIO_SEND_PORT_KEY,
        AUDIO_RECEIVE_PORT_KEY,
    ] {
        transaction.execute("DELETE FROM app_settings WHERE key = ?1", [key])?;
    }

    transaction.execute(
        "DELETE FROM app_settings WHERE key LIKE 'app.commissioning.check.%'",
        [],
    )?;
    transaction.execute(
        "DELETE FROM app_settings WHERE key LIKE ?1",
        [format!("{LIGHTING_SETTINGS_PREFIX}%")],
    )?;
    transaction.execute(
        "DELETE FROM app_settings WHERE key LIKE ?1",
        [format!("{AUDIO_SETTINGS_PREFIX}%")],
    )?;
    // Slice 7 (F20): every key under the restore prefixes goes — the shell's
    // workspace, window, Setup section, scene thumbnails and talent marks,
    // and the deck's selections, bank and dial mode (which also covers the
    // selected light and the legacy `app.control_surface.lighting.state`).
    for prefix in RESTORE_KEY_PREFIXES {
        transaction.execute(
            "DELETE FROM app_settings WHERE key LIKE ?1",
            [format!("{prefix}%")],
        )?;
    }
    Ok(())
}

fn write_projects(
    transaction: &Transaction<'_>,
    projects: &[PlanningProject],
) -> Result<(), rusqlite::Error> {
    for project in projects {
        transaction.execute(
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
        )?;
    }

    Ok(())
}

fn write_tasks(
    transaction: &Transaction<'_>,
    tasks: &[PlanningTask],
) -> Result<usize, rusqlite::Error> {
    let mut checklist_item_count = 0usize;

    for task in tasks {
        transaction.execute(
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
                serde_json::to_string(&task.labels).unwrap_or_else(|_| String::from("[]")),
                bool_to_int(task.is_running),
                task.total_seconds,
                task.last_started,
                bool_to_int(task.completed),
                task.order,
                task.created_at,
            ],
        )?;

        for item in &task.checklist {
            write_checklist_item(transaction, &task.id, item)?;
            checklist_item_count += 1;
        }
    }

    Ok(checklist_item_count)
}

fn write_checklist_item(
    transaction: &Transaction<'_>,
    task_id: &str,
    item: &PlanningChecklistItem,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO task_checklist_items(id, task_id, text, done, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            item.id,
            task_id,
            item.text,
            bool_to_int(item.done),
            item.order
        ],
    )?;
    Ok(())
}

fn write_activity_log(
    transaction: &Transaction<'_>,
    entries: &[PlanningActivityEntry],
) -> Result<(), rusqlite::Error> {
    for entry in entries {
        transaction.execute(
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
        )?;
    }

    Ok(())
}

fn write_support_settings(
    transaction: &Transaction<'_>,
    planning: &SupportPlanningSettingsArchive,
    commissioning: &SupportCommissioningArchive,
    shell: &ShellSettingsSnapshot,
    settings: &HashMap<String, String>,
) -> Result<usize, rusqlite::Error> {
    let mut settings_restored = 0usize;

    upsert_setting(transaction, VIEW_FILTER_KEY, &planning.view_filter)?;
    settings_restored += 1;
    upsert_setting(transaction, SORT_BY_KEY, &planning.sort_by)?;
    settings_restored += 1;
    upsert_setting(transaction, DASHBOARD_VIEW_KEY, &planning.dashboard_view)?;
    settings_restored += 1;
    upsert_setting(transaction, DECK_MODE_KEY, &planning.deck_mode)?;
    settings_restored += 1;

    if let Some(mode_section) = &planning.mode_section {
        upsert_setting(
            transaction,
            crate::planning_settings::MODE_SECTION_KEY,
            mode_section,
        )?;
        settings_restored += 1;
    }
    if let Some(hour) = planning.timeline_start_hour {
        upsert_setting(
            transaction,
            crate::planning_settings::TIMELINE_START_HOUR_KEY,
            &hour.to_string(),
        )?;
        settings_restored += 1;
    }
    if let Some(hour) = planning.timeline_end_hour {
        upsert_setting(
            transaction,
            crate::planning_settings::TIMELINE_END_HOUR_KEY,
            &hour.to_string(),
        )?;
        settings_restored += 1;
    }

    if let Some(project_id) = &planning.selected_project_id {
        upsert_setting(transaction, SELECTED_PROJECT_ID_KEY, project_id)?;
        settings_restored += 1;
    }

    if let Some(task_id) = &planning.selected_task_id {
        upsert_setting(transaction, SELECTED_TASK_ID_KEY, task_id)?;
        settings_restored += 1;
    }

    upsert_setting(transaction, WORKSPACE_KEY, &shell.workspace)?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        WINDOW_WIDTH_KEY,
        &shell.window_width.to_string(),
    )?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        WINDOW_HEIGHT_KEY,
        &shell.window_height.to_string(),
    )?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        WINDOW_MAXIMIZED_KEY,
        &shell.window_maximized.to_string(),
    )?;
    settings_restored += 1;
    // The shell fields formats 2 and 3 exported but never restored (F20).
    upsert_setting(transaction, WINDOW_MODE_KEY, &shell.window_mode)?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        SETUP_ACTIVE_SECTION_KEY,
        &shell.setup_active_section,
    )?;
    settings_restored += 1;
    if let Some(section_id) = &shell.lighting_current_section_id {
        upsert_setting(transaction, LIGHTING_CURRENT_SECTION_ID_KEY, section_id)?;
        settings_restored += 1;
    }
    if !shell.lighting_scene_thumbs.is_empty() {
        let thumbs = serde_json::to_string(&shell.lighting_scene_thumbs)
            .unwrap_or_else(|_| String::from("{}"));
        upsert_setting(transaction, LIGHTING_SCENE_THUMBS_KEY, &thumbs)?;
        settings_restored += 1;
    }
    if !shell.lighting_talent_marks.is_empty() {
        let marks = serde_json::to_string(&shell.lighting_talent_marks)
            .unwrap_or_else(|_| String::from("[]"));
        upsert_setting(transaction, LIGHTING_TALENT_MARKS_KEY, &marks)?;
        settings_restored += 1;
    }

    upsert_setting(
        transaction,
        COMMISSIONING_COMPLETED_KEY,
        &commissioning.has_completed_setup.to_string(),
    )?;
    settings_restored += 1;
    upsert_setting(transaction, COMMISSIONING_STAGE_KEY, &commissioning.stage)?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        HARDWARE_PROFILE_KEY,
        &commissioning.hardware_profile,
    )?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        LIGHTING_BRIDGE_IP_KEY,
        &commissioning.lighting.bridge_ip,
    )?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        LIGHTING_UNIVERSE_KEY,
        &commissioning.lighting.universe.to_string(),
    )?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        AUDIO_SEND_HOST_KEY,
        &commissioning.audio.send_host,
    )?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        AUDIO_SEND_PORT_KEY,
        &commissioning.audio.send_port.to_string(),
    )?;
    settings_restored += 1;
    upsert_setting(
        transaction,
        AUDIO_RECEIVE_PORT_KEY,
        &commissioning.audio.receive_port.to_string(),
    )?;
    settings_restored += 1;

    let mut audio_setting_keys = commissioning
        .audio
        .settings
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    audio_setting_keys.sort();

    for key in audio_setting_keys {
        if let Some(value) = commissioning.audio.settings.get(&key) {
            upsert_setting(transaction, &key, value)?;
            settings_restored += 1;
        }
    }

    for check in &commissioning.checks {
        let key_prefix = format!("app.commissioning.check.{}", check.id);
        upsert_setting(transaction, &format!("{key_prefix}.status"), &check.status)?;
        settings_restored += 1;
        upsert_setting(
            transaction,
            &format!("{key_prefix}.message"),
            &check.message,
        )?;
        settings_restored += 1;
        if let Some(checked_at) = &check.checked_at {
            upsert_setting(transaction, &format!("{key_prefix}.checked_at"), checked_at)?;
            settings_restored += 1;
        }
    }

    let mut lighting_setting_keys = commissioning
        .lighting
        .settings
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    lighting_setting_keys.sort();

    for key in lighting_setting_keys {
        if let Some(value) = commissioning.lighting.settings.get(&key) {
            upsert_setting(transaction, &key, value)?;
            settings_restored += 1;
        }
    }

    if let Some(selected_fixture_id) = commissioning.lighting.selected_fixture_id.as_deref() {
        upsert_setting(
            transaction,
            LIGHTING_SELECTED_FIXTURE_ID_KEY,
            selected_fixture_id,
        )?;
        settings_restored += 1;
    }

    // Format 4 (F20): the verbatim settings win over the structured shell
    // fields above, which stand in for them when an older archive has none.
    let mut raw_keys = settings.keys().cloned().collect::<Vec<_>>();
    raw_keys.sort();
    for key in raw_keys {
        if let Some(value) = settings.get(&key) {
            upsert_setting(transaction, &key, value)?;
            settings_restored += 1;
        }
    }

    Ok(settings_restored)
}

fn upsert_setting(
    transaction: &Transaction<'_>,
    key: &str,
    value: &str,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO app_settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        params![key, value],
    )?;
    Ok(())
}

fn current_timestamp(db_path: &Path) -> EngineResult<String> {
    let connection = open_connection(db_path)?;
    let timestamp =
        connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })?;
    Ok(timestamp)
}

fn read_storage_format_version(db_path: &Path) -> EngineResult<Option<String>> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_metadata WHERE key = 'storage.format_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(value)
}

/// Every restorable file in the backups directory: the `.json` support
/// archives and the `.sqlite3` database backups (Slice 7 — the engine's own
/// `db-<timestamp>-<reason>.sqlite3` copies among them). Anything else in the
/// directory is not listed.
fn list_backup_files(directory: &Path) -> EngineResult<Vec<SupportFileEntry>> {
    let mut entries = Vec::new();

    if !directory.exists() {
        return Ok(entries);
    }

    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(kind) = SupportBackupKind::from_path(&path) else {
            continue;
        };

        let metadata = entry.metadata()?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(unix_timestamp)
            .unwrap_or(0);

        entries.push(SupportFileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.display().to_string(),
            size_bytes: metadata.len(),
            modified_at,
            kind,
        });
    }

    Ok(entries)
}

/// Removes the oldest `native-pre-restore-*.json` rollback archives beyond
/// the retention; the names carry the export time at fixed width, so name
/// order is age order. Exports and database backups are left alone.
pub(crate) fn prune_pre_restore_archives_in(backups_dir: &Path) -> EngineResult<Vec<PathBuf>> {
    let mut removed = Vec::new();
    if !backups_dir.is_dir() {
        return Ok(removed);
    }
    let prefix = format!("{PRE_RESTORE_ARCHIVE_PREFIX}-");
    let mut names: Vec<String> = fs::read_dir(backups_dir)?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| {
            name.starts_with(&prefix) && name.ends_with(&format!(".{ARCHIVE_EXTENSION}"))
        })
        .collect();
    names.sort();
    let excess = names.len().saturating_sub(PRE_RESTORE_ARCHIVE_RETENTION);
    for name in names.iter().take(excess) {
        let path = backups_dir.join(name);
        fs::remove_file(&path)?;
        removed.push(path);
    }
    Ok(removed)
}

/// Removes files in the diagnostics `exports` directory that are older than
/// `EXPORTS_MAX_AGE` at `now` (Slice 7). Sub-directories and files whose
/// modification time cannot be read are left alone. Returns the removed
/// paths.
pub fn prune_exports(exports_dir: &Path, now: SystemTime) -> EngineResult<Vec<PathBuf>> {
    let mut removed = Vec::new();
    if !exports_dir.is_dir() {
        return Ok(removed);
    }
    let cutoff = now.checked_sub(EXPORTS_MAX_AGE);
    for entry in fs::read_dir(exports_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) else {
            continue;
        };
        if cutoff.is_some_and(|cutoff| modified < cutoff) {
            fs::remove_file(&path)?;
            removed.push(path);
        }
    }
    Ok(removed)
}

fn unix_timestamp(time: SystemTime) -> Option<i64> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_secs() as i64)
}

fn sanitize_for_file_name(value: &str) -> String {
    value.replace([':', '.'], "-")
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

#[derive(Debug)]
struct NativeRestoreSummary {
    project_count: usize,
    task_count: usize,
    checklist_item_count: usize,
    activity_entry_count: usize,
    settings_restored: usize,
}

#[cfg(test)]
mod tests;
