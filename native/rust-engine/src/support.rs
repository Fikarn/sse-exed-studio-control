use crate::app_state::{
    COMMISSIONING_COMPLETED_KEY, COMMISSIONING_STAGE_KEY, HARDWARE_PROFILE_KEY,
};
use crate::bootstrap::RuntimeContext;
use crate::commissioning::{
    read_commissioning_snapshot, AUDIO_RECEIVE_PORT_KEY, AUDIO_SEND_HOST_KEY, AUDIO_SEND_PORT_KEY,
    LIGHTING_BRIDGE_IP_KEY, LIGHTING_UNIVERSE_KEY,
};
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
    ShellSettingsSnapshot, SHELL_SETTINGS_PREFIX, WINDOW_HEIGHT_KEY, WINDOW_MAXIMIZED_KEY,
    WINDOW_WIDTH_KEY, WORKSPACE_KEY,
};
use crate::storage::{import_legacy_db, list_settings_by_prefix, open_connection, EngineResult};
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SUPPORT_BACKUP_FORMAT_VERSION: i64 = 3;
const SUPPORT_BACKUP_ARCHIVE_TYPE: &str = "native-support-backup";
const LIGHTING_SETTINGS_PREFIX: &str = "app.lighting.";
const AUDIO_SETTINGS_PREFIX: &str = "app.audio.";
#[cfg(test)]
const LIGHTING_EDITOR_STATE_KEY: &str = "app.lighting.editor.state";
const LEGACY_LIGHTING_EDITOR_STATE_KEY: &str = "app.control_surface.lighting.state";

#[derive(Debug)]
pub enum SupportCommandError {
    InvalidParams(String),
    Storage(String),
}

#[derive(Debug, Clone)]
pub struct SupportRestoreRequest {
    pub source_path: PathBuf,
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
    #[serde(rename = "rollbackBackupPath")]
    pub rollback_backup_path: String,
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

pub fn parse_support_restore_request(params: &Value) -> Result<SupportRestoreRequest, String> {
    let source_path = params
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("path is required and must be a non-empty string"))?;

    Ok(SupportRestoreRequest {
        source_path: PathBuf::from(source_path),
    })
}

pub fn read_support_snapshot(runtime: &RuntimeContext) -> EngineResult<SupportSnapshot> {
    fs::create_dir_all(&runtime.backups_dir)?;
    let mut backups = list_json_files(&runtime.backups_dir)?;
    backups.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| right.name.cmp(&left.name))
    });

    let latest_backup_path = backups.first().map(|entry| entry.path.clone());
    let summary = format!(
        "{} backup archives in {}. Latest: {}.",
        backups.len(),
        runtime.backups_dir.display(),
        latest_backup_path.as_deref().unwrap_or("none")
    );
    let restore_summary = String::from(
        "Restore from a native support backup archive or a legacy db.json export. The engine creates a rollback backup before applying changes."
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

pub fn export_support_backup(
    runtime: &RuntimeContext,
) -> Result<SupportBackupExportSummary, SupportCommandError> {
    write_support_backup_archive(runtime, "native-backup")
}

pub fn restore_support_backup(
    runtime: &RuntimeContext,
    request: &SupportRestoreRequest,
) -> Result<SupportBackupRestoreSummary, SupportCommandError> {
    if !request.source_path.exists() {
        return Err(SupportCommandError::InvalidParams(format!(
            "Backup file was not found: {}",
            request.source_path.display()
        )));
    }

    let rollback = write_support_backup_archive(runtime, "native-pre-restore")?;
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
        let archive: SupportBackupArchive = serde_json::from_value(parsed)
            .map_err(|error| SupportCommandError::InvalidParams(error.to_string()))?;
        let summary = restore_native_support_archive(&runtime.db_path, &archive)
            .map_err(|error| SupportCommandError::Storage(error.to_string()))?;

        return Ok(SupportBackupRestoreSummary {
            source_path: request.source_path.display().to_string(),
            source_format: String::from("native-support-backup"),
            rollback_backup_path: rollback.path,
            project_count: summary.project_count,
            task_count: summary.task_count,
            checklist_item_count: summary.checklist_item_count,
            activity_entry_count: summary.activity_entry_count,
            settings_restored: summary.settings_restored,
        });
    }

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

    Ok(SupportBackupRestoreSummary {
        source_path: request.source_path.display().to_string(),
        source_format: String::from("legacy-db-json"),
        rollback_backup_path: rollback.path,
        project_count: legacy_summary.imported_projects,
        task_count: legacy_summary.imported_tasks,
        checklist_item_count: legacy_summary.imported_checklist_items,
        activity_entry_count: legacy_summary.imported_activity_entries,
        settings_restored: legacy_summary.updated_settings,
    })
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
        WORKSPACE_KEY,
        WINDOW_WIDTH_KEY,
        WINDOW_HEIGHT_KEY,
        WINDOW_MAXIMIZED_KEY,
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
    transaction.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        [LIGHTING_SELECTED_FIXTURE_ID_KEY],
    )?;
    transaction.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        [LEGACY_LIGHTING_EDITOR_STATE_KEY],
    )?;
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

fn list_json_files(directory: &Path) -> EngineResult<Vec<SupportFileEntry>> {
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
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

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
        });
    }

    Ok(entries)
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
mod tests {
    use super::*;
    use crate::app_state::APP_SETTINGS_PREFIX;
    use crate::audio::{
        read_audio_snapshot, update_audio_channel, update_audio_mix_target, update_audio_settings,
        AudioChannelUpdateRequest, AudioMixTargetUpdateRequest, AudioSettingsUpdateRequest,
    };
    use crate::commissioning::read_commissioning_snapshot;
    use crate::control_surface::ControlSurfaceBridgeInfo;
    use crate::lighting::read_lighting_snapshot;
    use crate::storage::{initialize_database, set_settings_owned};
    use serde_json::json;
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
                "studio-control-engine-support-{label}-{}-{unique}",
                process::id()
            ));
            fs::create_dir_all(&path).expect("test dir should be created");
            Self { path }
        }

        fn runtime(&self) -> RuntimeContext {
            let app_data_dir = self.path.join("runtime");
            let logs_dir = app_data_dir.join("logs");
            let backups_dir = app_data_dir.join("backups");
            fs::create_dir_all(&logs_dir).expect("logs dir should be created");
            fs::create_dir_all(&backups_dir).expect("backups dir should be created");
            let db_path = app_data_dir.join("studio-control.sqlite3");
            let storage_bootstrap =
                initialize_database(&db_path).expect("database should initialize");

            RuntimeContext {
                protocol_version: String::from("1"),
                app_data_dir,
                backups_dir,
                logs_dir: logs_dir.clone(),
                log_file_path: logs_dir.join("engine.log"),
                db_path,
                update_repository_path: None,
                storage_ready: true,
                storage_bootstrap,
                control_surface_bridge: ControlSurfaceBridgeInfo {
                    base_url: String::from("http://127.0.0.1:38201"),
                    port: 38201,
                    available: true,
                    status: String::from("ready"),
                    summary: String::from("Test bridge"),
                    error: None,
                },
            }
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

    fn seed_legacy_payload(path: &Path) {
        fs::write(
            path,
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 9,
                "projects": [
                    {
                        "id": "proj-1",
                        "title": "Native Support",
                        "description": "Backup flow",
                        "status": "in-progress",
                        "priority": "p1",
                        "createdAt": "2026-04-01T10:00:00.000Z",
                        "lastUpdated": "2026-04-11T10:00:00.000Z",
                        "order": 0
                    }
                ],
                "tasks": [
                    {
                        "id": "task-1",
                        "projectId": "proj-1",
                        "title": "Ship support archive",
                        "description": "Implement backup/restore",
                        "priority": "p0",
                        "dueDate": "2026-04-20",
                        "labels": ["native", "support"],
                        "checklist": [
                            {"id": "check-1", "text": "Export", "done": true},
                            {"id": "check-2", "text": "Restore", "done": false}
                        ],
                        "isRunning": false,
                        "totalSeconds": 120,
                        "lastStarted": null,
                        "completed": false,
                        "order": 0,
                        "createdAt": "2026-04-11T10:00:00.000Z"
                    }
                ],
                "activityLog": [
                    {
                        "id": "act-1",
                        "timestamp": "2026-04-11T12:00:00.000Z",
                        "entityType": "task",
                        "entityId": "task-1",
                        "action": "created",
                        "detail": "Task created"
                    }
                ],
                "settings": {
                    "viewFilter": "all",
                    "sortBy": "manual",
                    "selectedProjectId": "proj-1",
                    "selectedTaskId": "task-1",
                    "dashboardView": "audio",
                    "deckMode": "audio",
                    "hasCompletedSetup": true
                }
            }))
            .expect("legacy payload should serialize"),
        )
        .expect("legacy payload should be written");
    }

    #[test]
    fn export_support_backup_writes_archive_and_lists_it() {
        let test_dir = TestDir::new("export");
        let runtime = test_dir.runtime();
        let legacy_path = test_dir.path().join("legacy-db.json");
        seed_legacy_payload(&legacy_path);
        import_legacy_db(
            &runtime.db_path,
            &LegacyImportRequest {
                source_path: legacy_path,
                force: true,
            },
        )
        .expect("legacy import should seed database");

        let summary = export_support_backup(&runtime).expect("backup export should succeed");
        assert_eq!(summary.project_count, 1);
        assert_eq!(summary.task_count, 1);

        let snapshot = read_support_snapshot(&runtime).expect("support snapshot should load");
        assert_eq!(snapshot.backup_count, 1);
        assert_eq!(
            snapshot.latest_backup_path.as_deref(),
            Some(summary.path.as_str())
        );
        assert!(snapshot.summary.contains("1 backup archives"));
        assert!(snapshot.restore_summary.contains("rollback backup"));
    }

    #[test]
    fn restore_support_backup_round_trips_native_archive() {
        let test_dir = TestDir::new("restore-native");
        let runtime = test_dir.runtime();
        let legacy_path = test_dir.path().join("legacy-db.json");
        seed_legacy_payload(&legacy_path);
        import_legacy_db(
            &runtime.db_path,
            &LegacyImportRequest {
                source_path: legacy_path,
                force: true,
            },
        )
        .expect("legacy import should seed database");

        let export = export_support_backup(&runtime).expect("backup export should succeed");
        set_settings_owned(
            &runtime.db_path,
            &[
                (
                    String::from(LIGHTING_EDITOR_STATE_KEY),
                    serde_json::to_string(&json!({
                        "groups": [
                            { "id": "group-custom-1", "name": "Parity Group" }
                        ],
                        "removed_fixture_ids": [],
                        "fixtures": [
                            {
                                "id": "fixture-custom-1",
                                "name": "Parity Key",
                                "type": "astra-bicolor",
                                "dmxStartAddress": 481,
                                "kind": "profile",
                                "groupId": "group-custom-1",
                                "spatialX": 0.22,
                                "spatialY": 0.31,
                                "spatialRotation": 15,
                                "intensity": 72,
                                "cct": 5600,
                                "on": true,
                                "effect": null
                            }
                        ],
                        "scenes": [
                            {
                                "id": "scene-custom-1",
                                "name": "Parity Scene",
                                "fixtureStates": [
                                    {
                                        "fixtureId": "fixture-custom-1",
                                        "intensity": 72,
                                        "cct": 5600,
                                        "on": true
                                    }
                                ]
                            }
                        ]
                    }))
                    .expect("lighting editor state should serialize"),
                ),
                (String::from("app.lighting.enabled"), String::from("true")),
                (
                    String::from("app.lighting.grand_master"),
                    String::from("72"),
                ),
                (
                    String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
                    String::from("fixture-custom-1"),
                ),
            ],
        )
        .expect("lighting mutations should persist before restore");
        update_audio_settings(
            &runtime.db_path,
            &AudioSettingsUpdateRequest {
                osc_enabled: None,
                send_host: None,
                send_port: None,
                receive_port: None,
                selected_channel_id: Some(Some(String::from("audio-input-12"))),
                selected_mix_target_id: Some(String::from("audio-mix-phones-a")),
                expected_peak_data: Some(false),
                expected_submix_lock: Some(false),
                expected_compatibility_mode: Some(true),
                faders_per_bank: None,
            },
        )
        .expect("audio settings should persist before restore");
        update_audio_mix_target(
            &runtime.db_path,
            &AudioMixTargetUpdateRequest {
                mix_target_id: String::from("audio-mix-main"),
                volume: Some(0.81),
                mute: None,
                dim: Some(true),
                mono: Some(true),
                talkback: Some(true),
            },
        )
        .expect("audio mix target should persist before restore");
        update_audio_channel(
            &runtime.db_path,
            &AudioChannelUpdateRequest {
                channel_id: String::from("audio-input-12"),
                mix_target_id: None,
                gain: Some(40),
                fader: None,
                mute: None,
                solo: None,
                phantom: Some(true),
                phase: Some(true),
                pad: Some(true),
                instrument: Some(true),
                auto_set: Some(true),
            },
        )
        .expect("front-preamp audio mutations should persist before restore");
        update_audio_channel(
            &runtime.db_path,
            &AudioChannelUpdateRequest {
                channel_id: String::from("audio-input-1"),
                mix_target_id: None,
                gain: None,
                fader: None,
                mute: Some(true),
                solo: None,
                phantom: None,
                phase: Some(true),
                pad: None,
                instrument: None,
                auto_set: None,
            },
        )
        .expect("rear-line audio mutations should persist before restore");
        update_audio_channel(
            &runtime.db_path,
            &AudioChannelUpdateRequest {
                channel_id: String::from("audio-playback-1-2"),
                mix_target_id: Some(String::from("audio-mix-phones-a")),
                gain: None,
                fader: Some(0.61),
                mute: Some(true),
                solo: Some(true),
                phantom: None,
                phase: None,
                pad: None,
                instrument: None,
                auto_set: None,
            },
        )
        .expect("playback audio mutations should persist before restore");
        set_settings_owned(
            &runtime.db_path,
            &[
                (
                    String::from("app.audio.console_state_confidence"),
                    String::from("assumed"),
                ),
                (
                    String::from("app.audio.last_console_sync_at"),
                    String::from("2026-04-16T20:15:00Z"),
                ),
                (
                    String::from("app.audio.last_console_sync_reason"),
                    String::from("snapshot"),
                ),
                (
                    String::from("app.audio.last_recalled_snapshot_id"),
                    String::from("snapshot-panel"),
                ),
                (
                    String::from("app.audio.last_snapshot_recall_at"),
                    String::from("2026-04-16T20:16:00Z"),
                ),
            ],
        )
        .expect("audio sync and recall markers should persist before restore");

        let summary = restore_support_backup(
            &runtime,
            &SupportRestoreRequest {
                source_path: PathBuf::from(&export.path),
            },
        )
        .expect("native restore should succeed");

        assert_eq!(summary.source_format, "native-support-backup");
        assert_eq!(summary.project_count, 1);
        assert_eq!(summary.task_count, 1);
        assert!(!summary.rollback_backup_path.is_empty());

        let planning_settings = list_settings_by_prefix(
            &runtime.db_path,
            crate::planning_settings::PLANNING_SETTINGS_PREFIX,
        )
        .expect("planning settings should load");
        let planning = read_planning_snapshot(&runtime.db_path, &planning_settings)
            .expect("planning snapshot should load");
        assert_eq!(planning.counts.project_count, 1);
        assert_eq!(planning.counts.task_count, 1);

        let commissioning = read_commissioning_snapshot(&runtime.db_path)
            .expect("commissioning snapshot should load");
        assert!(commissioning.has_completed_setup);

        let lighting_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
            .expect("lighting settings should load");
        let lighting = read_lighting_snapshot(&lighting_settings);
        assert_eq!(lighting.fixtures.len(), 0);
        assert_eq!(lighting.groups.len(), 0);
        assert_eq!(lighting.scenes.len(), 0);
        assert!(!lighting.enabled);
        assert!(lighting.selected_fixture_id.is_none());

        let audio_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
            .expect("audio settings should load");
        let audio = read_audio_snapshot(&audio_settings);
        assert_eq!(audio.selected_channel_id.as_deref(), Some("audio-input-9"));
        assert_eq!(audio.selected_mix_target_id, "audio-mix-main");
        assert!(audio.expected_peak_data);
        assert!(audio.expected_submix_lock);
        assert!(!audio.expected_compatibility_mode);
        assert_eq!(audio.console_state_confidence, "unknown");
        assert!(audio.last_console_sync_at.is_none());
        assert!(audio.last_console_sync_reason.is_none());
        assert!(audio.last_recalled_snapshot_id.is_none());
        assert!(audio.last_snapshot_recall_at.is_none());

        let restored_front = audio
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-12")
            .expect("restored front channel should be present");
        assert_eq!(restored_front.gain, 32);
        assert!(restored_front.phantom);
        assert!(!restored_front.phase);
        assert!(!restored_front.pad);
        assert!(restored_front.instrument);
        assert!(!restored_front.auto_set);

        let restored_rear = audio
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-1")
            .expect("restored rear channel should be present");
        assert!(!restored_rear.mute);
        assert!(!restored_rear.phase);

        let restored_playback = audio
            .channels
            .iter()
            .find(|entry| entry.id == "audio-playback-1-2")
            .expect("restored playback channel should be present");
        assert!(!restored_playback.mute);
        assert!(!restored_playback.solo);
        let restored_phones_a_mix = restored_playback
            .mix_levels
            .get("audio-mix-phones-a")
            .copied()
            .expect("restored playback phones mix should be present");
        assert!((restored_phones_a_mix - 0.54).abs() < 0.000_001);

        let restored_main_mix = audio
            .mix_targets
            .iter()
            .find(|entry| entry.id == "audio-mix-main")
            .expect("restored main mix should be present");
        assert_eq!(restored_main_mix.volume, 0.82);
        assert!(!restored_main_mix.dim);
        assert!(!restored_main_mix.mono);
        assert!(!restored_main_mix.talkback);
    }

    #[test]
    fn restore_support_backup_accepts_legacy_json() {
        let test_dir = TestDir::new("restore-legacy");
        let runtime = test_dir.runtime();
        let legacy_path = test_dir.path().join("legacy-db.json");
        seed_legacy_payload(&legacy_path);

        let summary = restore_support_backup(
            &runtime,
            &SupportRestoreRequest {
                source_path: legacy_path,
            },
        )
        .expect("legacy restore should succeed");

        assert_eq!(summary.source_format, "legacy-db-json");
        assert_eq!(summary.project_count, 1);
        assert_eq!(summary.task_count, 1);
        assert_eq!(summary.checklist_item_count, 2);
    }

    #[test]
    fn export_support_backup_records_storage_format_version() {
        let test_dir = TestDir::new("export-format-version");
        let runtime = test_dir.runtime();
        let legacy_path = test_dir.path().join("legacy-db.json");
        seed_legacy_payload(&legacy_path);
        import_legacy_db(
            &runtime.db_path,
            &LegacyImportRequest {
                source_path: legacy_path,
                force: true,
            },
        )
        .expect("legacy import should seed database");

        let export = export_support_backup(&runtime).expect("backup export should succeed");
        let archive_bytes = fs::read(&export.path).expect("archive should read back");
        let archive: SupportBackupArchive =
            serde_json::from_slice(&archive_bytes).expect("archive should parse");

        assert_eq!(archive.format_version, SUPPORT_BACKUP_FORMAT_VERSION);
        assert_eq!(archive.storage_format_version, Some(String::from("1")));
    }

    #[test]
    fn restore_support_backup_accepts_format_v2_archive_without_storage_version() {
        let test_dir = TestDir::new("restore-format-v2");
        let runtime = test_dir.runtime();
        let legacy_path = test_dir.path().join("legacy-db.json");
        seed_legacy_payload(&legacy_path);
        import_legacy_db(
            &runtime.db_path,
            &LegacyImportRequest {
                source_path: legacy_path,
                force: true,
            },
        )
        .expect("legacy import should seed database");

        // Build a real archive then strip the v3-only field to forge a v2 shape.
        let mut archive_value = serde_json::to_value(
            build_support_backup_archive(&runtime).expect("archive should build"),
        )
        .expect("archive should serialize to value");
        let archive_object = archive_value.as_object_mut().expect("archive is an object");
        archive_object.insert(String::from("formatVersion"), json!(2));
        archive_object.remove("storageFormatVersion");

        let v2_archive_path = test_dir.path().join("legacy-format-v2-backup.json");
        fs::write(
            &v2_archive_path,
            serde_json::to_vec_pretty(&archive_value).expect("v2 archive should serialize"),
        )
        .expect("v2 archive should write");

        let summary = restore_support_backup(
            &runtime,
            &SupportRestoreRequest {
                source_path: v2_archive_path,
            },
        )
        .expect("v2 archive should restore on v3-aware reader");

        assert_eq!(summary.source_format, "native-support-backup");
    }
}
