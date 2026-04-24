use crate::planning_settings::dashboard_view_to_workspace;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_TIMESTAMP: &str = "1970-01-01T00:00:00.000Z";

#[derive(Debug)]
pub enum ImportLegacyError {
    SourceNotFound(PathBuf),
    SourceReadFailed(String),
    SourceParseFailed(String),
    InvalidData(String),
    ExistingDataRequiresForce,
    Storage(String),
}

impl fmt::Display for ImportLegacyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceNotFound(path) => {
                write!(
                    f,
                    "Legacy database source file was not found: {}",
                    path.display()
                )
            }
            Self::SourceReadFailed(message) => {
                write!(f, "Failed to read legacy database: {message}")
            }
            Self::SourceParseFailed(message) => {
                write!(f, "Failed to parse legacy database JSON: {message}")
            }
            Self::InvalidData(message) => write!(f, "Legacy database is invalid: {message}"),
            Self::ExistingDataRequiresForce => write!(
                f,
                "Native planning tables already contain data. Re-run with force=true to replace it."
            ),
            Self::Storage(message) => write!(f, "Native storage operation failed: {message}"),
        }
    }
}

impl Error for ImportLegacyError {}

#[derive(Debug, Clone)]
pub struct LegacyImportRequest {
    pub source_path: PathBuf,
    pub force: bool,
}

#[derive(Debug, Clone)]
pub struct LegacyImportPayload {
    pub source_path: PathBuf,
    pub source_schema_version: i64,
    pub projects: Vec<ImportedProject>,
    pub tasks: Vec<ImportedTask>,
    pub activity_log: Vec<ImportedActivityEntry>,
    pub settings: ImportedSettings,
}

#[derive(Debug, Clone)]
pub struct ImportedProject {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub created_at: String,
    pub last_updated: String,
    pub order: i64,
}

#[derive(Debug, Clone)]
pub struct ImportedChecklistItem {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub order: i64,
}

#[derive(Debug, Clone)]
pub struct ImportedTask {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub labels: Vec<String>,
    pub checklist: Vec<ImportedChecklistItem>,
    pub is_running: bool,
    pub total_seconds: i64,
    pub last_started: Option<String>,
    pub completed: bool,
    pub order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ImportedActivityEntry {
    pub id: String,
    pub timestamp: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct ImportedSettings {
    pub view_filter: String,
    pub sort_by: String,
    pub dashboard_view: String,
    pub deck_mode: String,
    pub selected_project_id: Option<String>,
    pub selected_task_id: Option<String>,
    pub commissioning_completed: bool,
    pub commissioning_runner_stage: String,
    pub commissioning_stage: String,
    pub shell_workspace: String,
}

#[derive(Debug, Serialize)]
pub struct LegacyImportSummary {
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "sourceSchemaVersion")]
    pub source_schema_version: i64,
    #[serde(rename = "replacedExistingData")]
    pub replaced_existing_data: bool,
    #[serde(rename = "importedProjects")]
    pub imported_projects: usize,
    #[serde(rename = "importedTasks")]
    pub imported_tasks: usize,
    #[serde(rename = "importedChecklistItems")]
    pub imported_checklist_items: usize,
    #[serde(rename = "importedActivityEntries")]
    pub imported_activity_entries: usize,
    #[serde(rename = "normalizedRunningTasks")]
    pub normalized_running_tasks: usize,
    #[serde(rename = "updatedSettings")]
    pub updated_settings: usize,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyDbWire {
    #[serde(default, rename = "schemaVersion")]
    schema_version: i64,
    #[serde(default)]
    projects: Vec<LegacyProjectWire>,
    #[serde(default)]
    tasks: Vec<LegacyTaskWire>,
    #[serde(default, rename = "activityLog")]
    activity_log: Vec<LegacyActivityEntryWire>,
    #[serde(default)]
    settings: LegacySettingsWire,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyProjectWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    priority: String,
    #[serde(default, rename = "createdAt")]
    created_at: String,
    #[serde(default, rename = "lastUpdated")]
    last_updated: String,
    #[serde(default)]
    order: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyChecklistItemWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyTaskWire {
    #[serde(default)]
    id: String,
    #[serde(default, rename = "projectId")]
    project_id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    priority: String,
    #[serde(default, rename = "dueDate")]
    due_date: Option<String>,
    #[serde(default)]
    labels: Vec<String>,
    #[serde(default)]
    checklist: Vec<LegacyChecklistItemWire>,
    #[serde(default, rename = "isRunning")]
    is_running: bool,
    #[serde(default, rename = "totalSeconds")]
    total_seconds: i64,
    #[serde(default, rename = "lastStarted")]
    last_started: Option<String>,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    order: Option<i64>,
    #[serde(default, rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyActivityEntryWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    timestamp: String,
    #[serde(default, rename = "entityType")]
    entity_type: String,
    #[serde(default, rename = "entityId")]
    entity_id: String,
    #[serde(default)]
    action: String,
    #[serde(default)]
    detail: String,
}

#[derive(Debug, Deserialize, Default)]
struct LegacySettingsWire {
    #[serde(default, rename = "viewFilter")]
    view_filter: String,
    #[serde(default, rename = "sortBy")]
    sort_by: String,
    #[serde(default, rename = "selectedProjectId")]
    selected_project_id: Option<String>,
    #[serde(default, rename = "selectedTaskId")]
    selected_task_id: Option<String>,
    #[serde(default, rename = "dashboardView")]
    dashboard_view: String,
    #[serde(default, rename = "deckMode")]
    deck_mode: String,
    #[serde(default, rename = "hasCompletedSetup")]
    has_completed_setup: bool,
}

pub fn parse_import_request(params: &Value) -> Result<LegacyImportRequest, String> {
    let path = params
        .get("path")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("path is required and must be a non-empty string"))?;

    let force = match params.get("force") {
        Some(value) => value
            .as_bool()
            .ok_or_else(|| String::from("force must be a boolean"))?,
        None => false,
    };

    Ok(LegacyImportRequest {
        source_path: PathBuf::from(path),
        force,
    })
}

pub fn load_legacy_import_payload(
    source_path: &Path,
) -> Result<LegacyImportPayload, ImportLegacyError> {
    if !source_path.exists() {
        return Err(ImportLegacyError::SourceNotFound(source_path.to_path_buf()));
    }

    let contents = fs::read_to_string(source_path)
        .map_err(|error| ImportLegacyError::SourceReadFailed(error.to_string()))?;
    let wire = serde_json::from_str::<LegacyDbWire>(&contents)
        .map_err(|error| ImportLegacyError::SourceParseFailed(error.to_string()))?;

    normalize_legacy_db(source_path, wire)
}

fn normalize_legacy_db(
    source_path: &Path,
    wire: LegacyDbWire,
) -> Result<LegacyImportPayload, ImportLegacyError> {
    let projects = wire
        .projects
        .into_iter()
        .enumerate()
        .map(|(index, project)| normalize_project(index, project))
        .collect::<Result<Vec<_>, _>>()?;

    let project_ids = projects
        .iter()
        .map(|project| project.id.clone())
        .collect::<HashSet<_>>();

    let tasks = wire
        .tasks
        .into_iter()
        .enumerate()
        .map(|(index, task)| normalize_task(index, task, &project_ids))
        .collect::<Result<Vec<_>, _>>()?;

    let task_project_map = tasks
        .iter()
        .map(|task| (task.id.clone(), task.project_id.clone()))
        .collect::<HashMap<_, _>>();
    let task_ids = task_project_map.keys().cloned().collect::<HashSet<_>>();

    let activity_log = wire
        .activity_log
        .into_iter()
        .enumerate()
        .filter_map(|(index, entry)| normalize_activity_entry(index, entry).transpose())
        .collect::<Result<Vec<_>, _>>()?;

    let settings = normalize_settings(wire.settings, &project_ids, &task_project_map, &task_ids);

    Ok(LegacyImportPayload {
        source_path: source_path.to_path_buf(),
        source_schema_version: wire.schema_version,
        projects,
        tasks,
        activity_log,
        settings,
    })
}

fn normalize_project(
    index: usize,
    project: LegacyProjectWire,
) -> Result<ImportedProject, ImportLegacyError> {
    let id = require_text(project.id, "project.id")?;
    let title = require_text(project.title, "project.title")?;
    let created_at = normalize_timestamp(&project.created_at, Some(&project.last_updated));
    let last_updated = normalize_timestamp(&project.last_updated, Some(&created_at));

    Ok(ImportedProject {
        id,
        title,
        description: project.description.trim().to_string(),
        status: normalize_project_status(&project.status),
        priority: normalize_priority(&project.priority),
        created_at,
        last_updated,
        order: project.order.unwrap_or(index as i64).max(0),
    })
}

fn normalize_task(
    index: usize,
    task: LegacyTaskWire,
    project_ids: &HashSet<String>,
) -> Result<ImportedTask, ImportLegacyError> {
    let id = require_text(task.id, "task.id")?;
    let project_id = require_text(task.project_id, "task.projectId")?;
    if !project_ids.contains(&project_id) {
        return Err(ImportLegacyError::InvalidData(format!(
            "task {id} references missing project {project_id}"
        )));
    }

    let title = require_text(task.title, "task.title")?;
    let checklist = task
        .checklist
        .into_iter()
        .enumerate()
        .map(|(checklist_index, item)| normalize_checklist_item(checklist_index, item))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ImportedTask {
        id,
        project_id,
        title,
        description: task.description.trim().to_string(),
        priority: normalize_priority(&task.priority),
        due_date: normalize_optional_text(task.due_date),
        labels: task
            .labels
            .into_iter()
            .filter_map(|label| {
                let normalized = label.trim().to_string();
                if normalized.is_empty() {
                    None
                } else {
                    Some(normalized)
                }
            })
            .collect(),
        checklist,
        is_running: task.is_running,
        total_seconds: task.total_seconds.max(0),
        last_started: normalize_optional_text(task.last_started),
        completed: task.completed,
        order: task.order.unwrap_or(index as i64).max(0),
        created_at: normalize_timestamp(&task.created_at, None),
    })
}

fn normalize_checklist_item(
    index: usize,
    item: LegacyChecklistItemWire,
) -> Result<ImportedChecklistItem, ImportLegacyError> {
    Ok(ImportedChecklistItem {
        id: require_text(item.id, "task.checklist.id")?,
        text: require_text(item.text, "task.checklist.text")?,
        done: item.done,
        order: index as i64,
    })
}

fn normalize_activity_entry(
    _index: usize,
    entry: LegacyActivityEntryWire,
) -> Result<Option<ImportedActivityEntry>, ImportLegacyError> {
    let id = match normalize_optional_text(Some(entry.id)) {
        Some(value) => value,
        None => return Ok(None),
    };
    let entity_id = match normalize_optional_text(Some(entry.entity_id)) {
        Some(value) => value,
        None => return Ok(None),
    };
    let action = match normalize_optional_text(Some(entry.action)) {
        Some(value) => value,
        None => return Ok(None),
    };

    let entity_type = match entry.entity_type.trim() {
        "project" | "task" | "light" | "scene" | "audio" => entry.entity_type.trim().to_string(),
        _ => return Ok(None),
    };

    Ok(Some(ImportedActivityEntry {
        id,
        timestamp: normalize_timestamp(&entry.timestamp, None),
        entity_type,
        entity_id,
        action,
        detail: entry.detail.trim().to_string(),
    }))
}

fn normalize_settings(
    settings: LegacySettingsWire,
    project_ids: &HashSet<String>,
    task_project_map: &HashMap<String, String>,
    task_ids: &HashSet<String>,
) -> ImportedSettings {
    let dashboard_view = normalize_dashboard_view(&settings.dashboard_view);
    let mut selected_project_id = normalize_optional_text(settings.selected_project_id);
    let mut selected_task_id = normalize_optional_text(settings.selected_task_id);

    if selected_project_id
        .as_ref()
        .is_some_and(|project_id| !project_ids.contains(project_id))
    {
        selected_project_id = None;
    }

    if selected_task_id
        .as_ref()
        .is_some_and(|task_id| !task_ids.contains(task_id))
    {
        selected_task_id = None;
    }

    if selected_project_id.is_none() {
        selected_project_id = selected_task_id
            .as_ref()
            .and_then(|task_id| task_project_map.get(task_id))
            .cloned();
    }

    if selected_task_id.as_ref().is_some_and(|task_id| {
        selected_project_id
            .as_ref()
            .and_then(|project_id| {
                task_project_map
                    .get(task_id)
                    .map(|task_project_id| task_project_id != project_id)
            })
            .unwrap_or(false)
    }) {
        selected_task_id = None;
    }

    let commissioning_completed = settings.has_completed_setup;

    ImportedSettings {
        view_filter: normalize_view_filter(&settings.view_filter),
        sort_by: normalize_sort_by(&settings.sort_by),
        dashboard_view: dashboard_view.clone(),
        deck_mode: normalize_deck_mode(&settings.deck_mode),
        selected_project_id,
        selected_task_id,
        commissioning_completed,
        commissioning_runner_stage: if commissioning_completed {
            String::from("publish")
        } else {
            String::from("import")
        },
        commissioning_stage: if commissioning_completed {
            String::from("ready")
        } else {
            String::from("setup-required")
        },
        shell_workspace: String::from(dashboard_view_to_workspace(&dashboard_view)),
    }
}

fn require_text(value: String, field: &str) -> Result<String, ImportLegacyError> {
    normalize_optional_text(Some(value)).ok_or_else(|| {
        ImportLegacyError::InvalidData(format!(
            "{field} is required and must be a non-empty string"
        ))
    })
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_timestamp(value: &str, fallback: Option<&str>) -> String {
    let normalized = value.trim();
    if !normalized.is_empty() {
        return normalized.to_string();
    }

    fallback
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TIMESTAMP)
        .to_string()
}

fn normalize_project_status(value: &str) -> String {
    match value.trim() {
        "in-progress" => String::from("in-progress"),
        "blocked" => String::from("blocked"),
        "done" => String::from("done"),
        _ => String::from("todo"),
    }
}

fn normalize_priority(value: &str) -> String {
    match value.trim() {
        "p0" => String::from("p0"),
        "p1" => String::from("p1"),
        "p3" => String::from("p3"),
        _ => String::from("p2"),
    }
}

fn normalize_view_filter(value: &str) -> String {
    match value.trim() {
        "todo" => String::from("todo"),
        "in-progress" => String::from("in-progress"),
        "blocked" => String::from("blocked"),
        "done" => String::from("done"),
        _ => String::from("all"),
    }
}

fn normalize_sort_by(value: &str) -> String {
    match value.trim() {
        "priority" => String::from("priority"),
        "date" => String::from("date"),
        "name" => String::from("name"),
        _ => String::from("manual"),
    }
}

fn normalize_dashboard_view(value: &str) -> String {
    match value.trim() {
        "lighting" => String::from("lighting"),
        "audio" => String::from("audio"),
        _ => String::from("kanban"),
    }
}

fn normalize_deck_mode(value: &str) -> String {
    match value.trim() {
        "light" => String::from("light"),
        "audio" => String::from("audio"),
        _ => String::from("project"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_import_request_requires_path() {
        let error = parse_import_request(&json!({})).expect_err("path should be required");
        assert_eq!(error, "path is required and must be a non-empty string");
    }

    #[test]
    fn normalize_settings_derives_project_from_selected_task() {
        let settings = LegacySettingsWire {
            selected_task_id: Some(String::from("task-1")),
            ..LegacySettingsWire::default()
        };
        let project_ids = HashSet::from([String::from("proj-1")]);
        let task_project_map = HashMap::from([(String::from("task-1"), String::from("proj-1"))]);
        let task_ids = HashSet::from([String::from("task-1")]);

        let normalized = normalize_settings(settings, &project_ids, &task_project_map, &task_ids);

        assert_eq!(normalized.selected_project_id.as_deref(), Some("proj-1"));
        assert_eq!(normalized.selected_task_id.as_deref(), Some("task-1"));
        assert_eq!(normalized.shell_workspace, "planning");
        assert_eq!(normalized.commissioning_runner_stage, "import");
        assert_eq!(normalized.commissioning_stage, "setup-required");
    }
}
