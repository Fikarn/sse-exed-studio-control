use crate::planning_settings::{
    is_valid_dashboard_view, is_valid_deck_mode, is_valid_sort_by, is_valid_view_filter,
    DASHBOARD_VIEW_KEY, DECK_MODE_KEY, DEFAULT_DASHBOARD_VIEW, DEFAULT_DECK_MODE, DEFAULT_SORT_BY,
    DEFAULT_VIEW_FILTER, PLANNING_SETTINGS_PREFIX, SELECTED_PROJECT_ID_KEY, SELECTED_TASK_ID_KEY,
    SORT_BY_KEY, VIEW_FILTER_KEY,
};
use crate::storage::{apply_settings, list_settings_by_prefix, open_connection, EngineResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use std::path::Path;

const VALID_PROJECT_STATUSES: &[&str] = &["todo", "in-progress", "blocked", "done"];
const VALID_PRIORITIES: &[&str] = &["p0", "p1", "p2", "p3"];

#[derive(Debug, Serialize)]
pub struct PlanningSnapshot {
    pub projects: Vec<PlanningProject>,
    pub tasks: Vec<PlanningTask>,
    #[serde(rename = "activityLog")]
    pub activity_log: Vec<PlanningActivityEntry>,
    pub settings: PlanningSettingsSnapshot,
    pub counts: PlanningCounts,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlanningProject {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastUpdated")]
    pub last_updated: String,
    pub order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlanningChecklistItem {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlanningTask {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    pub labels: Vec<String>,
    pub checklist: Vec<PlanningChecklistItem>,
    #[serde(rename = "isRunning")]
    pub is_running: bool,
    #[serde(rename = "totalSeconds")]
    pub total_seconds: i64,
    #[serde(rename = "lastStarted")]
    pub last_started: Option<String>,
    pub completed: bool,
    pub order: i64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(default, rename = "scheduledStart")]
    pub scheduled_start: Option<String>,
    #[serde(default, rename = "scheduledDurationSeconds")]
    pub scheduled_duration_seconds: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlanningActivityEntry {
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "entityType")]
    pub entity_type: String,
    #[serde(rename = "entityId")]
    pub entity_id: String,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningSettingsSnapshot {
    #[serde(rename = "settingsPrefix")]
    pub settings_prefix: &'static str,
    #[serde(rename = "viewFilter")]
    pub view_filter: String,
    #[serde(rename = "sortBy")]
    pub sort_by: String,
    #[serde(rename = "dashboardView")]
    pub dashboard_view: String,
    #[serde(rename = "deckMode")]
    pub deck_mode: String,
    #[serde(rename = "selectedProjectId")]
    pub selected_project_id: Option<String>,
    #[serde(rename = "selectedTaskId")]
    pub selected_task_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningCounts {
    #[serde(rename = "projectCount")]
    pub project_count: usize,
    #[serde(rename = "taskCount")]
    pub task_count: usize,
    #[serde(rename = "runningTaskCount")]
    pub running_task_count: usize,
    #[serde(rename = "completedTaskCount")]
    pub completed_task_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningContextSnapshot {
    #[serde(rename = "selectedProject")]
    pub selected_project: Option<PlanningProjectContext>,
    #[serde(rename = "projectIndex")]
    pub project_index: i64,
    #[serde(rename = "projectCount")]
    pub project_count: usize,
    pub settings: PlanningSettingsSnapshot,
    #[serde(rename = "selectedTaskId")]
    pub selected_task_id: Option<String>,
    #[serde(rename = "selectedTask")]
    pub selected_task: Option<PlanningTaskContext>,
    #[serde(rename = "taskIndex")]
    pub task_index: i64,
    pub tasks: Vec<PlanningTaskContext>,
    #[serde(rename = "taskCount")]
    pub task_count: usize,
    #[serde(rename = "runningTask")]
    pub running_task: Option<PlanningRunningTaskContext>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningProjectContext {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningTaskContext {
    pub id: String,
    pub title: String,
    #[serde(rename = "isRunning")]
    pub is_running: bool,
    pub completed: bool,
    #[serde(rename = "totalSeconds")]
    pub total_seconds: i64,
    pub priority: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningRunningTaskContext {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub title: String,
    #[serde(rename = "totalSeconds")]
    pub total_seconds: i64,
    #[serde(rename = "lastStarted")]
    pub last_started: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningProjectMutationResult {
    pub project: PlanningProject,
    pub context: PlanningContextSnapshot,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningTaskMutationResult {
    pub task: PlanningTask,
    pub context: PlanningContextSnapshot,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningDeleteResult {
    pub deleted: bool,
    pub context: PlanningContextSnapshot,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningTimeReport {
    #[serde(rename = "totalSeconds")]
    pub total_seconds: i64,
    #[serde(rename = "byProject")]
    pub by_project: Vec<PlanningProjectTimeEntry>,
    #[serde(rename = "byTask")]
    pub by_task: Vec<PlanningTaskTimeEntry>,
    #[serde(rename = "timerEvents")]
    pub timer_events: Vec<PlanningActivityEntry>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningProjectTimeEntry {
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub title: String,
    #[serde(rename = "totalSeconds")]
    pub total_seconds: i64,
    #[serde(rename = "taskCount")]
    pub task_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningTaskTimeEntry {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "taskTitle")]
    pub task_title: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "projectTitle")]
    pub project_title: String,
    #[serde(rename = "totalSeconds")]
    pub total_seconds: i64,
    #[serde(rename = "isRunning")]
    pub is_running: bool,
    #[serde(rename = "lastStarted")]
    pub last_started: Option<String>,
}

#[derive(Debug)]
pub enum PlanningCommandError {
    InvalidParams(String),
    Storage(String),
}

impl fmt::Display for PlanningCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidParams(message) | Self::Storage(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for PlanningCommandError {}

#[derive(Debug)]
pub struct PlanningSettingsUpdateRequest {
    view_filter: Option<String>,
    sort_by: Option<String>,
    dashboard_view: Option<String>,
    deck_mode: Option<String>,
    selected_project_id: Option<Option<String>>,
    selected_task_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Copy)]
enum SelectionDirection {
    Next,
    Prev,
}

#[derive(Debug)]
enum PlanningSelectionMode {
    ProjectId(String),
    ProjectDirection(SelectionDirection),
    TaskId(String),
    TaskDirection(SelectionDirection),
}

#[derive(Debug)]
pub struct PlanningSelectionRequest {
    mode: PlanningSelectionMode,
}

#[derive(Debug)]
pub struct PlanningProjectCreateRequest {
    title: String,
    description: String,
    status: String,
    priority: String,
}

#[derive(Debug)]
pub struct PlanningProjectUpdateRequest {
    project_id: String,
    title: Option<String>,
    description: Option<String>,
    priority: Option<String>,
    order: Option<i64>,
}

#[derive(Debug)]
pub struct PlanningProjectDeleteRequest {
    project_id: String,
}

#[derive(Debug)]
pub struct PlanningProjectReorderRequest {
    project_id: String,
    new_status: Option<String>,
    new_index: Option<i64>,
}

#[derive(Debug)]
pub struct PlanningTaskCreateRequest {
    project_id: String,
    title: String,
    description: String,
    priority: String,
    due_date: Option<String>,
    labels: Vec<String>,
}

#[derive(Debug)]
pub struct PlanningTaskUpdateRequest {
    task_id: String,
    title: Option<String>,
    description: Option<String>,
    priority: Option<String>,
    due_date: Option<Option<String>>,
    labels: Option<Vec<String>>,
    completed: Option<bool>,
    order: Option<i64>,
}

#[derive(Debug)]
pub struct PlanningTaskDeleteRequest {
    task_id: String,
}

#[derive(Debug)]
pub struct PlanningTaskRescheduleRequest {
    task_id: String,
    scheduled_start: Option<Option<String>>,
    scheduled_duration_seconds: Option<Option<i64>>,
}

#[derive(Debug)]
pub struct PlanningTaskChecklistAddRequest {
    task_id: String,
    text: String,
}

#[derive(Debug)]
pub struct PlanningTaskChecklistUpdateRequest {
    task_id: String,
    item_id: String,
    text: Option<String>,
    done: Option<bool>,
}

#[derive(Debug)]
pub struct PlanningTaskChecklistDeleteRequest {
    task_id: String,
    item_id: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningTaskTimerResult {
    #[serde(rename = "resolvedAction")]
    pub resolved_action: String,
    pub task: PlanningTask,
    pub context: PlanningContextSnapshot,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlanningTaskToggleCompleteResult {
    pub task: PlanningTask,
    pub context: PlanningContextSnapshot,
}

#[derive(Debug, Clone, Copy)]
enum TimerAction {
    Start,
    Stop,
    Toggle,
}

#[derive(Debug)]
pub struct PlanningTaskTimerRequest {
    task_id: String,
    action: TimerAction,
}

#[derive(Debug)]
pub struct PlanningTaskToggleCompleteRequest {
    task_id: String,
}

#[derive(Debug)]
struct PlanningTaskRow {
    id: String,
    project_id: String,
    title: String,
    description: String,
    priority: String,
    due_date: Option<String>,
    labels: Vec<String>,
    is_running: bool,
    total_seconds: i64,
    last_started: Option<String>,
    completed: bool,
    order: i64,
    created_at: String,
    scheduled_start: Option<String>,
    scheduled_duration_seconds: Option<i64>,
}

impl PlanningSettingsSnapshot {
    pub fn from_settings(settings: &HashMap<String, String>) -> Self {
        Self {
            settings_prefix: PLANNING_SETTINGS_PREFIX,
            view_filter: settings
                .get(VIEW_FILTER_KEY)
                .cloned()
                .unwrap_or_else(|| String::from(DEFAULT_VIEW_FILTER)),
            sort_by: settings
                .get(SORT_BY_KEY)
                .cloned()
                .unwrap_or_else(|| String::from(DEFAULT_SORT_BY)),
            dashboard_view: settings
                .get(DASHBOARD_VIEW_KEY)
                .cloned()
                .unwrap_or_else(|| String::from(DEFAULT_DASHBOARD_VIEW)),
            deck_mode: settings
                .get(DECK_MODE_KEY)
                .cloned()
                .unwrap_or_else(|| String::from(DEFAULT_DECK_MODE)),
            selected_project_id: settings.get(SELECTED_PROJECT_ID_KEY).cloned(),
            selected_task_id: settings.get(SELECTED_TASK_ID_KEY).cloned(),
        }
    }
}

pub fn planning_data_present(db_path: &Path) -> EngineResult<bool> {
    let connection = open_connection(db_path)?;
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))?;
    Ok(count > 0)
}

pub fn read_planning_snapshot(
    db_path: &Path,
    planning_settings: &HashMap<String, String>,
) -> EngineResult<PlanningSnapshot> {
    let connection = open_connection(db_path)?;
    let projects = read_projects(&connection)?;
    let checklist_by_task = read_checklist_items_by_task(&connection)?;
    let task_rows = read_tasks(&connection)?;
    let activity_log = read_activity_log(&connection)?;

    let tasks = task_rows
        .into_iter()
        .map(|task| PlanningTask {
            checklist: checklist_by_task.get(&task.id).cloned().unwrap_or_default(),
            id: task.id,
            project_id: task.project_id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            due_date: task.due_date,
            labels: task.labels,
            is_running: task.is_running,
            total_seconds: task.total_seconds,
            last_started: task.last_started,
            completed: task.completed,
            order: task.order,
            created_at: task.created_at,
            scheduled_start: task.scheduled_start,
            scheduled_duration_seconds: task.scheduled_duration_seconds,
        })
        .collect::<Vec<_>>();

    let running_task_count = tasks.iter().filter(|task| task.is_running).count();
    let completed_task_count = tasks.iter().filter(|task| task.completed).count();

    Ok(PlanningSnapshot {
        counts: PlanningCounts {
            project_count: projects.len(),
            task_count: tasks.len(),
            running_task_count,
            completed_task_count,
        },
        settings: PlanningSettingsSnapshot::from_settings(planning_settings),
        projects,
        tasks,
        activity_log,
    })
}

pub fn read_planning_context(
    db_path: &Path,
    planning_settings: &HashMap<String, String>,
) -> EngineResult<PlanningContextSnapshot> {
    Ok(build_planning_context(read_planning_snapshot(
        db_path,
        planning_settings,
    )?))
}

pub fn parse_planning_time_report_request(params: &Value) -> Result<Option<String>, String> {
    match params.get("projectId") {
        Some(value) => parse_nullable_string(value, "projectId"),
        None => Ok(None),
    }
}

pub fn read_planning_time_report(
    db_path: &Path,
    project_id: Option<&str>,
) -> EngineResult<PlanningTimeReport> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)?;
    let snapshot = read_planning_snapshot(db_path, &planning_settings)?;
    let filtered_tasks = snapshot
        .tasks
        .iter()
        .filter(|task| project_id.is_none_or(|value| task.project_id == value))
        .collect::<Vec<_>>();

    let mut project_totals: HashMap<String, PlanningProjectTimeEntry> = HashMap::new();
    for task in &filtered_tasks {
        if let Some(project) = snapshot
            .projects
            .iter()
            .find(|item| item.id == task.project_id)
        {
            let entry = project_totals
                .entry(task.project_id.clone())
                .or_insert_with(|| PlanningProjectTimeEntry {
                    project_id: project.id.clone(),
                    title: project.title.clone(),
                    total_seconds: 0,
                    task_count: 0,
                });
            entry.total_seconds += task.total_seconds;
            entry.task_count += 1;
        }
    }

    let mut by_project = project_totals.into_values().collect::<Vec<_>>();
    by_project.sort_by(|left, right| right.total_seconds.cmp(&left.total_seconds));

    let mut by_task = filtered_tasks
        .iter()
        .filter(|task| task.total_seconds > 0)
        .map(|task| {
            let project_title = snapshot
                .projects
                .iter()
                .find(|project| project.id == task.project_id)
                .map(|project| project.title.clone())
                .unwrap_or_else(|| String::from("Unknown"));
            PlanningTaskTimeEntry {
                task_id: task.id.clone(),
                task_title: task.title.clone(),
                project_id: task.project_id.clone(),
                project_title,
                total_seconds: task.total_seconds,
                is_running: task.is_running,
                last_started: task.last_started.clone(),
            }
        })
        .collect::<Vec<_>>();
    by_task.sort_by(|left, right| right.total_seconds.cmp(&left.total_seconds));

    let timer_events = snapshot
        .activity_log
        .iter()
        .filter(|entry| matches!(entry.action.as_str(), "timer_started" | "timer_stopped"))
        .take(100)
        .cloned()
        .collect::<Vec<_>>();

    Ok(PlanningTimeReport {
        total_seconds: filtered_tasks.iter().map(|task| task.total_seconds).sum(),
        by_project,
        by_task,
        timer_events,
    })
}

pub fn parse_planning_settings_update(
    params: &Value,
) -> Result<PlanningSettingsUpdateRequest, String> {
    let mut request = PlanningSettingsUpdateRequest {
        view_filter: None,
        sort_by: None,
        dashboard_view: None,
        deck_mode: None,
        selected_project_id: None,
        selected_task_id: None,
    };

    if let Some(value) = params.get("viewFilter") {
        let filter = value
            .as_str()
            .ok_or_else(|| String::from("viewFilter must be a string"))?;
        if !is_valid_view_filter(filter) {
            return Err(String::from(
                "viewFilter must be one of: all, todo, in-progress, blocked, done",
            ));
        }
        request.view_filter = Some(filter.to_string());
    }

    if let Some(value) = params.get("sortBy") {
        let sort_by = value
            .as_str()
            .ok_or_else(|| String::from("sortBy must be a string"))?;
        if !is_valid_sort_by(sort_by) {
            return Err(String::from(
                "sortBy must be one of: manual, priority, date, name",
            ));
        }
        request.sort_by = Some(sort_by.to_string());
    }

    if let Some(value) = params.get("dashboardView") {
        let dashboard_view = value
            .as_str()
            .ok_or_else(|| String::from("dashboardView must be a string"))?;
        if !is_valid_dashboard_view(dashboard_view) {
            return Err(String::from(
                "dashboardView must be one of: kanban, lighting, audio",
            ));
        }
        request.dashboard_view = Some(dashboard_view.to_string());
    }

    if let Some(value) = params.get("deckMode") {
        let deck_mode = value
            .as_str()
            .ok_or_else(|| String::from("deckMode must be a string"))?;
        if !is_valid_deck_mode(deck_mode) {
            return Err(String::from(
                "deckMode must be one of: project, light, audio",
            ));
        }
        request.deck_mode = Some(deck_mode.to_string());
    }

    if let Some(value) = params.get("selectedProjectId") {
        request.selected_project_id = Some(parse_nullable_string(value, "selectedProjectId")?);
    }

    if let Some(value) = params.get("selectedTaskId") {
        request.selected_task_id = Some(parse_nullable_string(value, "selectedTaskId")?);
    }

    if request.view_filter.is_none()
        && request.sort_by.is_none()
        && request.dashboard_view.is_none()
        && request.deck_mode.is_none()
        && request.selected_project_id.is_none()
        && request.selected_task_id.is_none()
    {
        return Err(String::from(
            "planning.settings.update requires one or more supported fields",
        ));
    }

    Ok(request)
}

pub fn update_planning_settings(
    db_path: &Path,
    request: &PlanningSettingsUpdateRequest,
) -> Result<PlanningContextSnapshot, PlanningCommandError> {
    let current_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let current_snapshot = PlanningSettingsSnapshot::from_settings(&current_settings);

    let mut updates = Vec::new();
    let mut delete_keys = Vec::new();

    if let Some(view_filter) = &request.view_filter {
        updates.push((VIEW_FILTER_KEY, view_filter.clone()));
    }
    if let Some(sort_by) = &request.sort_by {
        updates.push((SORT_BY_KEY, sort_by.clone()));
    }
    if let Some(dashboard_view) = &request.dashboard_view {
        updates.push((DASHBOARD_VIEW_KEY, dashboard_view.clone()));
    }
    if let Some(deck_mode) = &request.deck_mode {
        updates.push((DECK_MODE_KEY, deck_mode.clone()));
    }

    if request.selected_project_id.is_some() || request.selected_task_id.is_some() {
        let selection = resolve_updated_selection(db_path, &current_snapshot, request)?;
        match selection.project_id {
            Some(project_id) => updates.push((SELECTED_PROJECT_ID_KEY, project_id)),
            None => delete_keys.push(SELECTED_PROJECT_ID_KEY),
        }
        match selection.task_id {
            Some(task_id) => updates.push((SELECTED_TASK_ID_KEY, task_id)),
            None => delete_keys.push(SELECTED_TASK_ID_KEY),
        }
    }

    apply_settings(db_path, &updates, &delete_keys)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let next_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    read_planning_context(db_path, &next_settings)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

pub fn parse_planning_selection_request(
    params: &Value,
) -> Result<PlanningSelectionRequest, String> {
    let project_id = params
        .get("projectId")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("projectId must be a string"))
                .map(|value| value.to_string())
        })
        .transpose()?;
    let task_id = params
        .get("taskId")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("taskId must be a string"))
                .map(|value| value.to_string())
        })
        .transpose()?;
    let project_direction = params
        .get("projectDirection")
        .map(|value| parse_selection_direction(value, "projectDirection"))
        .transpose()?;
    let task_direction = params
        .get("taskDirection")
        .map(|value| parse_selection_direction(value, "taskDirection"))
        .transpose()?;

    let selection_mode = [
        project_id.is_some(),
        task_id.is_some(),
        project_direction.is_some(),
        task_direction.is_some(),
    ]
    .into_iter()
    .filter(|value| *value)
    .count();

    if selection_mode != 1 {
        return Err(String::from(
            "planning.select requires exactly one of: projectId, taskId, projectDirection, taskDirection",
        ));
    }

    let mode = if let Some(project_id) = project_id {
        PlanningSelectionMode::ProjectId(project_id)
    } else if let Some(task_id) = task_id {
        PlanningSelectionMode::TaskId(task_id)
    } else if let Some(direction) = project_direction {
        PlanningSelectionMode::ProjectDirection(direction)
    } else {
        PlanningSelectionMode::TaskDirection(
            task_direction.expect("taskDirection should be present"),
        )
    };

    Ok(PlanningSelectionRequest { mode })
}

pub fn apply_planning_selection(
    db_path: &Path,
    request: &PlanningSelectionRequest,
) -> Result<PlanningContextSnapshot, PlanningCommandError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let current_snapshot = PlanningSettingsSnapshot::from_settings(&planning_settings);

    let selection = match &request.mode {
        PlanningSelectionMode::ProjectId(project_id) => SelectionState {
            project_id: Some(assert_project_exists(db_path, project_id)?),
            task_id: first_task_id_for_project(db_path, project_id)?,
        },
        PlanningSelectionMode::TaskId(task_id) => {
            let project_id = project_id_for_task(db_path, task_id)?;
            SelectionState {
                project_id: Some(project_id),
                task_id: Some(task_id.clone()),
            }
        }
        PlanningSelectionMode::ProjectDirection(direction) => {
            let ordered_project_ids = ordered_project_ids(db_path)?;
            if ordered_project_ids.is_empty() {
                return read_planning_context(db_path, &planning_settings)
                    .map_err(|error| PlanningCommandError::Storage(error.to_string()));
            }

            let next_project_id = cycle_string(
                &ordered_project_ids,
                current_snapshot.selected_project_id.as_deref(),
                *direction,
            )
            .expect("project cycle should resolve a value");

            SelectionState {
                project_id: Some(next_project_id.clone()),
                task_id: first_task_id_for_project(db_path, &next_project_id)?,
            }
        }
        PlanningSelectionMode::TaskDirection(direction) => {
            let Some(selected_project_id) = current_snapshot.selected_project_id.clone() else {
                return read_planning_context(db_path, &planning_settings)
                    .map_err(|error| PlanningCommandError::Storage(error.to_string()));
            };

            let ordered_task_ids = ordered_task_ids_for_project(db_path, &selected_project_id)?;
            if ordered_task_ids.is_empty() {
                SelectionState {
                    project_id: Some(selected_project_id),
                    task_id: None,
                }
            } else {
                SelectionState {
                    project_id: Some(selected_project_id),
                    task_id: cycle_string(
                        &ordered_task_ids,
                        current_snapshot.selected_task_id.as_deref(),
                        *direction,
                    ),
                }
            }
        }
    };

    let mut updates = Vec::new();
    let mut delete_keys = Vec::new();

    match selection.project_id {
        Some(project_id) => updates.push((SELECTED_PROJECT_ID_KEY, project_id)),
        None => delete_keys.push(SELECTED_PROJECT_ID_KEY),
    }
    match selection.task_id {
        Some(task_id) => updates.push((SELECTED_TASK_ID_KEY, task_id)),
        None => delete_keys.push(SELECTED_TASK_ID_KEY),
    }

    apply_settings(db_path, &updates, &delete_keys)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let next_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    read_planning_context(db_path, &next_settings)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

pub fn parse_planning_project_create_request(
    params: &Value,
) -> Result<PlanningProjectCreateRequest, String> {
    let title = parse_required_title(params, "title")?;
    let description = parse_optional_string_field(params, "description")?.unwrap_or_default();
    let status =
        parse_optional_string_field(params, "status")?.unwrap_or_else(|| String::from("todo"));
    if !is_valid_project_status(&status) {
        return Err(format!(
            "status must be one of: {}",
            VALID_PROJECT_STATUSES.join(", ")
        ));
    }

    let priority =
        parse_optional_string_field(params, "priority")?.unwrap_or_else(|| String::from("p2"));
    if !is_valid_priority(&priority) {
        return Err(format!(
            "priority must be one of: {}",
            VALID_PRIORITIES.join(", ")
        ));
    }

    Ok(PlanningProjectCreateRequest {
        title,
        description,
        status,
        priority,
    })
}

pub fn apply_planning_project_create(
    db_path: &Path,
    request: &PlanningProjectCreateRequest,
) -> Result<PlanningProjectMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let now = current_timestamp(&transaction)?;
    let project_id = generate_runtime_id("proj");
    let order = next_project_sort_order_for_status(&transaction, &request.status)?;

    transaction
        .execute(
            "INSERT INTO projects(
                id, title, description, status, priority, created_at, last_updated, sort_order
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                project_id,
                request.title,
                request.description,
                request.status,
                request.priority,
                now,
                now,
                order,
            ],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    append_activity_entry(
        &transaction,
        "project",
        &project_id,
        "created",
        &format!("Project \"{}\" created", request.title),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let context =
        update_selection_after_mutation(db_path, Some(Some(project_id.clone())), Some(None))?;
    let project = read_project_by_id(db_path, &project_id)?;
    Ok(PlanningProjectMutationResult { project, context })
}

pub fn parse_planning_project_update_request(
    params: &Value,
) -> Result<PlanningProjectUpdateRequest, String> {
    let project_id = parse_required_string_field(params, "projectId")?;
    let title = parse_optional_string_field(params, "title")?;
    if title.as_deref() == Some("") {
        return Err(String::from("title must not be empty"));
    }

    let description = parse_optional_string_field(params, "description")?;
    let priority = parse_optional_string_field(params, "priority")?;
    if let Some(priority) = priority.as_deref() {
        if !is_valid_priority(priority) {
            return Err(format!(
                "priority must be one of: {}",
                VALID_PRIORITIES.join(", ")
            ));
        }
    }

    let order = parse_optional_i64_field(params, "order")?;

    if title.is_none() && description.is_none() && priority.is_none() && order.is_none() {
        return Err(String::from(
            "planning.project.update requires one or more supported fields",
        ));
    }

    Ok(PlanningProjectUpdateRequest {
        project_id,
        title,
        description,
        priority,
        order,
    })
}

pub fn apply_planning_project_update(
    db_path: &Path,
    request: &PlanningProjectUpdateRequest,
) -> Result<PlanningProjectMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let project = load_project_row(&transaction, &request.project_id)?;
    let now = current_timestamp(&transaction)?;

    let mut changes = Vec::new();
    let next_title = match &request.title {
        Some(title) => {
            changes.push("title");
            title.clone()
        }
        None => project.title.clone(),
    };
    let next_description = match &request.description {
        Some(description) => {
            changes.push("description");
            description.clone()
        }
        None => project.description.clone(),
    };
    let next_priority = match &request.priority {
        Some(priority) => {
            changes.push("priority");
            priority.clone()
        }
        None => project.priority.clone(),
    };

    if request.title.is_some() || request.description.is_some() || request.priority.is_some() {
        transaction
            .execute(
                "UPDATE projects
                 SET title = ?2, description = ?3, priority = ?4, last_updated = ?5
                 WHERE id = ?1",
                rusqlite::params![
                    request.project_id,
                    next_title,
                    next_description,
                    next_priority,
                    now,
                ],
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    }

    if let Some(order) = request.order {
        changes.push("order");
        reorder_project_in_transaction(
            &transaction,
            &request.project_id,
            &project.status,
            &project.status,
            Some(order),
            &now,
        )?;
    }

    append_activity_entry(
        &transaction,
        "project",
        &request.project_id,
        "updated",
        &format!("Updated {}", changes.join(", ")),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (project, context) = read_project_and_context(db_path, &request.project_id)?;
    Ok(PlanningProjectMutationResult { project, context })
}

pub fn parse_planning_project_delete_request(
    params: &Value,
) -> Result<PlanningProjectDeleteRequest, String> {
    Ok(PlanningProjectDeleteRequest {
        project_id: parse_required_string_field(params, "projectId")?,
    })
}

pub fn apply_planning_project_delete(
    db_path: &Path,
    request: &PlanningProjectDeleteRequest,
) -> Result<PlanningDeleteResult, PlanningCommandError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let current_settings = PlanningSettingsSnapshot::from_settings(&planning_settings);

    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let project = load_project_row(&transaction, &request.project_id)?;
    let now = current_timestamp(&transaction)?;

    transaction
        .execute("DELETE FROM projects WHERE id = ?1", [&request.project_id])
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    append_activity_entry(
        &transaction,
        "project",
        &request.project_id,
        "deleted",
        &format!("Project \"{}\" deleted", project.title),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let selected_project_was_deleted =
        current_settings.selected_project_id.as_deref() == Some(request.project_id.as_str());
    let context = if selected_project_was_deleted {
        let next_project_id = ordered_project_ids(db_path)?.into_iter().next();
        let next_task_id = next_project_id
            .as_deref()
            .map(|project_id| first_task_id_for_project(db_path, project_id))
            .transpose()?
            .flatten();
        update_selection_after_mutation(db_path, Some(next_project_id), Some(next_task_id))?
    } else {
        read_planning_context_with_current_settings(db_path)?
    };

    Ok(PlanningDeleteResult {
        deleted: true,
        context,
    })
}

pub fn parse_planning_project_reorder_request(
    params: &Value,
) -> Result<PlanningProjectReorderRequest, String> {
    let project_id = parse_required_string_field(params, "projectId")?;
    let new_status = parse_optional_string_field(params, "newStatus")?;
    if let Some(status) = new_status.as_deref() {
        if !is_valid_project_status(status) {
            return Err(format!(
                "newStatus must be one of: {}",
                VALID_PROJECT_STATUSES.join(", ")
            ));
        }
    }
    let new_index = parse_optional_i64_field(params, "newIndex")?;

    Ok(PlanningProjectReorderRequest {
        project_id,
        new_status,
        new_index,
    })
}

pub fn apply_planning_project_reorder(
    db_path: &Path,
    request: &PlanningProjectReorderRequest,
) -> Result<PlanningProjectMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let project = load_project_row(&transaction, &request.project_id)?;
    let now = current_timestamp(&transaction)?;
    let target_status = request
        .new_status
        .clone()
        .unwrap_or_else(|| project.status.clone());

    reorder_project_in_transaction(
        &transaction,
        &request.project_id,
        &project.status,
        &target_status,
        request.new_index,
        &now,
    )?;

    let (action, detail) = if target_status != project.status {
        (
            "status_changed",
            format!(
                "Moved project \"{}\" from {} to {}",
                project.title, project.status, target_status
            ),
        )
    } else {
        (
            "reordered",
            format!("Reordered project \"{}\"", project.title),
        )
    };
    append_activity_entry(
        &transaction,
        "project",
        &request.project_id,
        action,
        &detail,
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (project, context) = read_project_and_context(db_path, &request.project_id)?;
    Ok(PlanningProjectMutationResult { project, context })
}

pub fn parse_planning_task_create_request(
    params: &Value,
) -> Result<PlanningTaskCreateRequest, String> {
    let project_id = parse_required_string_field(params, "projectId")?;
    let title = parse_required_title(params, "title")?;
    let description = parse_optional_string_field(params, "description")?.unwrap_or_default();
    let priority =
        parse_optional_string_field(params, "priority")?.unwrap_or_else(|| String::from("p2"));
    if !is_valid_priority(&priority) {
        return Err(format!(
            "priority must be one of: {}",
            VALID_PRIORITIES.join(", ")
        ));
    }

    Ok(PlanningTaskCreateRequest {
        project_id,
        title,
        description,
        priority,
        due_date: parse_optional_nullable_string_field(params, "dueDate")?,
        labels: parse_optional_string_array_field(params, "labels")?.unwrap_or_default(),
    })
}

pub fn apply_planning_task_create(
    db_path: &Path,
    request: &PlanningTaskCreateRequest,
) -> Result<PlanningTaskMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    assert_project_exists_in_transaction(&transaction, &request.project_id)?;
    let now = current_timestamp(&transaction)?;
    let task_id = generate_runtime_id("task");
    let order = next_task_sort_order_for_project(&transaction, &request.project_id)?;

    transaction
        .execute(
            "INSERT INTO tasks(
                id, project_id, title, description, priority, due_date, labels_json,
                is_running, total_seconds, last_started, completed, sort_order, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, NULL, 0, ?8, ?9)",
            rusqlite::params![
                task_id,
                request.project_id,
                request.title,
                request.description,
                request.priority,
                request.due_date,
                serde_json::to_string(&request.labels)
                    .map_err(|error| PlanningCommandError::Storage(error.to_string()))?,
                order,
                now,
            ],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    append_activity_entry(
        &transaction,
        "task",
        &task_id,
        "created",
        &format!("Task \"{}\" created", request.title),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let context = update_selection_after_mutation(db_path, None, Some(Some(task_id.clone())))?;
    let task = read_task_by_id(db_path, &task_id)?;
    Ok(PlanningTaskMutationResult { task, context })
}

pub fn parse_planning_task_update_request(
    params: &Value,
) -> Result<PlanningTaskUpdateRequest, String> {
    let task_id = parse_required_string_field(params, "taskId")?;
    let title = parse_optional_string_field(params, "title")?;
    if title.as_deref() == Some("") {
        return Err(String::from("title must not be empty"));
    }

    let description = parse_optional_string_field(params, "description")?;
    let priority = parse_optional_string_field(params, "priority")?;
    if let Some(priority) = priority.as_deref() {
        if !is_valid_priority(priority) {
            return Err(format!(
                "priority must be one of: {}",
                VALID_PRIORITIES.join(", ")
            ));
        }
    }

    let due_date = if params.get("dueDate").is_some() {
        Some(parse_optional_nullable_string_field(params, "dueDate")?)
    } else {
        None
    };
    let labels = parse_optional_string_array_field(params, "labels")?;
    let completed = parse_optional_bool_field(params, "completed")?;
    let order = parse_optional_i64_field(params, "order")?;

    if title.is_none()
        && description.is_none()
        && priority.is_none()
        && due_date.is_none()
        && labels.is_none()
        && completed.is_none()
        && order.is_none()
    {
        return Err(String::from(
            "planning.task.update requires one or more supported fields",
        ));
    }

    Ok(PlanningTaskUpdateRequest {
        task_id,
        title,
        description,
        priority,
        due_date,
        labels,
        completed,
        order,
    })
}

pub fn apply_planning_task_update(
    db_path: &Path,
    request: &PlanningTaskUpdateRequest,
) -> Result<PlanningTaskMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let task = load_task_row(&transaction, &request.task_id)?;
    let now = current_timestamp(&transaction)?;

    let mut changes = Vec::new();
    let next_title = match &request.title {
        Some(title) => {
            changes.push("title");
            title.clone()
        }
        None => task.title.clone(),
    };
    let next_description = match &request.description {
        Some(description) => {
            changes.push("description");
            description.clone()
        }
        None => task.description.clone(),
    };
    let next_priority = match &request.priority {
        Some(priority) => {
            changes.push("priority");
            priority.clone()
        }
        None => task.priority.clone(),
    };
    let next_due_date = match &request.due_date {
        Some(value) => {
            changes.push("dueDate");
            value.clone()
        }
        None => task.due_date.clone(),
    };
    let next_labels = match &request.labels {
        Some(labels) => {
            changes.push("labels");
            labels.clone()
        }
        None => task.labels.clone(),
    };
    let next_completed = match request.completed {
        Some(completed) => {
            changes.push("completed");
            completed
        }
        None => task.completed,
    };

    if request.title.is_some()
        || request.description.is_some()
        || request.priority.is_some()
        || request.due_date.is_some()
        || request.labels.is_some()
        || request.completed.is_some()
    {
        transaction
            .execute(
                "UPDATE tasks
                 SET title = ?2,
                     description = ?3,
                     priority = ?4,
                     due_date = ?5,
                     labels_json = ?6,
                     completed = ?7
                 WHERE id = ?1",
                rusqlite::params![
                    request.task_id,
                    next_title,
                    next_description,
                    next_priority,
                    next_due_date,
                    serde_json::to_string(&next_labels)
                        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?,
                    bool_to_int(next_completed),
                ],
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    }

    if let Some(order) = request.order {
        changes.push("order");
        reorder_task_in_transaction(&transaction, &request.task_id, &task.project_id, order)?;
    }

    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        "updated",
        &format!("Updated {}", changes.join(", ")),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (task, context) = read_task_and_context(db_path, &request.task_id)?;
    Ok(PlanningTaskMutationResult { task, context })
}

pub fn parse_planning_task_delete_request(
    params: &Value,
) -> Result<PlanningTaskDeleteRequest, String> {
    Ok(PlanningTaskDeleteRequest {
        task_id: parse_required_string_field(params, "taskId")?,
    })
}

pub fn apply_planning_task_delete(
    db_path: &Path,
    request: &PlanningTaskDeleteRequest,
) -> Result<PlanningDeleteResult, PlanningCommandError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let current_settings = PlanningSettingsSnapshot::from_settings(&planning_settings);

    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let task = load_task_row(&transaction, &request.task_id)?;
    let now = current_timestamp(&transaction)?;

    transaction
        .execute("DELETE FROM tasks WHERE id = ?1", [&request.task_id])
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        "deleted",
        &format!("Task \"{}\" deleted", task.title),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let selected_task_was_deleted =
        current_settings.selected_task_id.as_deref() == Some(request.task_id.as_str());
    let context = if selected_task_was_deleted {
        let next_task_id = first_task_id_for_project(db_path, &task.project_id)?;
        update_selection_after_mutation(
            db_path,
            Some(Some(task.project_id.clone())),
            Some(next_task_id),
        )?
    } else {
        read_planning_context_with_current_settings(db_path)?
    };

    Ok(PlanningDeleteResult {
        deleted: true,
        context,
    })
}

pub fn parse_planning_task_reschedule_request(
    params: &Value,
) -> Result<PlanningTaskRescheduleRequest, String> {
    let task_id = parse_required_string_field(params, "taskId")?;

    let scheduled_start = if params.get("scheduledStart").is_some() {
        Some(parse_optional_nullable_string_field(params, "scheduledStart")?)
    } else {
        None
    };
    let scheduled_duration_seconds = if params.get("scheduledDurationSeconds").is_some() {
        Some(parse_optional_nullable_i64_field(
            params,
            "scheduledDurationSeconds",
        )?)
    } else {
        None
    };

    if let Some(Some(seconds)) = scheduled_duration_seconds {
        if seconds < 0 {
            return Err(String::from(
                "scheduledDurationSeconds must be non-negative",
            ));
        }
    }

    if scheduled_start.is_none() && scheduled_duration_seconds.is_none() {
        return Err(String::from(
            "planning.task.reschedule requires scheduledStart or scheduledDurationSeconds",
        ));
    }

    Ok(PlanningTaskRescheduleRequest {
        task_id,
        scheduled_start,
        scheduled_duration_seconds,
    })
}

pub fn apply_planning_task_reschedule(
    db_path: &Path,
    request: &PlanningTaskRescheduleRequest,
) -> Result<PlanningTaskMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let task = load_task_row(&transaction, &request.task_id)?;
    let now = current_timestamp(&transaction)?;

    let next_scheduled_start = match &request.scheduled_start {
        Some(value) => value.clone(),
        None => task.scheduled_start.clone(),
    };
    let next_scheduled_duration = match request.scheduled_duration_seconds {
        Some(value) => value,
        None => task.scheduled_duration_seconds,
    };

    transaction
        .execute(
            "UPDATE tasks
             SET scheduled_start = ?2,
                 scheduled_duration_seconds = ?3
             WHERE id = ?1",
            rusqlite::params![request.task_id, next_scheduled_start, next_scheduled_duration],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let mut changes: Vec<&'static str> = Vec::new();
    if request.scheduled_start.is_some() {
        changes.push("scheduledStart");
    }
    if request.scheduled_duration_seconds.is_some() {
        changes.push("scheduledDurationSeconds");
    }

    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        "rescheduled",
        &format!("Rescheduled {}", changes.join(", ")),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (task, context) = read_task_and_context(db_path, &request.task_id)?;
    Ok(PlanningTaskMutationResult { task, context })
}

pub fn parse_planning_task_checklist_add_request(
    params: &Value,
) -> Result<PlanningTaskChecklistAddRequest, String> {
    Ok(PlanningTaskChecklistAddRequest {
        task_id: parse_required_string_field(params, "taskId")?,
        text: parse_required_title(params, "text")?,
    })
}

pub fn apply_planning_task_checklist_add(
    db_path: &Path,
    request: &PlanningTaskChecklistAddRequest,
) -> Result<PlanningTaskMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    load_task_row(&transaction, &request.task_id)?;
    let now = current_timestamp(&transaction)?;
    let item_id = generate_runtime_id("cl");
    let order = next_checklist_sort_order_for_task(&transaction, &request.task_id)?;

    transaction
        .execute(
            "INSERT INTO task_checklist_items(id, task_id, text, done, sort_order)
             VALUES (?1, ?2, ?3, 0, ?4)",
            rusqlite::params![item_id, request.task_id, request.text, order],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        "checklist_added",
        &format!("Checklist item \"{}\" added", request.text),
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (task, context) = read_task_and_context(db_path, &request.task_id)?;
    Ok(PlanningTaskMutationResult { task, context })
}

pub fn parse_planning_task_checklist_update_request(
    params: &Value,
) -> Result<PlanningTaskChecklistUpdateRequest, String> {
    let task_id = parse_required_string_field(params, "taskId")?;
    let item_id = parse_required_string_field(params, "itemId")?;
    let text = parse_optional_string_field(params, "text")?;
    if text.as_deref() == Some("") {
        return Err(String::from("text must not be empty"));
    }
    let done = parse_optional_bool_field(params, "done")?;

    if text.is_none() && done.is_none() {
        return Err(String::from(
            "planning.task.checklist.update requires one or more supported fields",
        ));
    }

    Ok(PlanningTaskChecklistUpdateRequest {
        task_id,
        item_id,
        text,
        done,
    })
}

pub fn apply_planning_task_checklist_update(
    db_path: &Path,
    request: &PlanningTaskChecklistUpdateRequest,
) -> Result<PlanningTaskMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let item = load_checklist_item_row(&transaction, &request.task_id, &request.item_id)?;
    let now = current_timestamp(&transaction)?;

    let next_text = request.text.clone().unwrap_or_else(|| item.text.clone());
    let next_done = request.done.unwrap_or(item.done);

    transaction
        .execute(
            "UPDATE task_checklist_items
             SET text = ?3, done = ?4
             WHERE task_id = ?1 AND id = ?2",
            rusqlite::params![
                request.task_id,
                request.item_id,
                next_text,
                bool_to_int(next_done),
            ],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let detail = if request.done.is_some() {
        format!(
            "Checklist item {}",
            if next_done { "checked" } else { "unchecked" }
        )
    } else {
        String::from("Checklist item updated")
    };
    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        "checklist_updated",
        &detail,
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (task, context) = read_task_and_context(db_path, &request.task_id)?;
    Ok(PlanningTaskMutationResult { task, context })
}

pub fn parse_planning_task_checklist_delete_request(
    params: &Value,
) -> Result<PlanningTaskChecklistDeleteRequest, String> {
    Ok(PlanningTaskChecklistDeleteRequest {
        task_id: parse_required_string_field(params, "taskId")?,
        item_id: parse_required_string_field(params, "itemId")?,
    })
}

pub fn apply_planning_task_checklist_delete(
    db_path: &Path,
    request: &PlanningTaskChecklistDeleteRequest,
) -> Result<PlanningTaskMutationResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    load_checklist_item_row(&transaction, &request.task_id, &request.item_id)?;
    let now = current_timestamp(&transaction)?;

    transaction
        .execute(
            "DELETE FROM task_checklist_items WHERE task_id = ?1 AND id = ?2",
            rusqlite::params![request.task_id, request.item_id],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        "checklist_removed",
        "Checklist item removed",
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (task, context) = read_task_and_context(db_path, &request.task_id)?;
    Ok(PlanningTaskMutationResult { task, context })
}

pub fn parse_planning_task_timer_request(
    params: &Value,
) -> Result<PlanningTaskTimerRequest, String> {
    let task_id = params
        .get("taskId")
        .and_then(Value::as_str)
        .ok_or_else(|| String::from("taskId is required and must be a string"))?
        .to_string();
    let action = params
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| String::from("action is required and must be a string"))?;

    let action = match action {
        "start" => TimerAction::Start,
        "stop" => TimerAction::Stop,
        "toggle" => TimerAction::Toggle,
        _ => {
            return Err(String::from("action must be one of: start, stop, toggle"));
        }
    };

    Ok(PlanningTaskTimerRequest { task_id, action })
}

pub fn parse_planning_task_toggle_complete_request(
    params: &Value,
) -> Result<PlanningTaskToggleCompleteRequest, String> {
    let task_id = params
        .get("taskId")
        .and_then(Value::as_str)
        .ok_or_else(|| String::from("taskId is required and must be a string"))?
        .to_string();

    Ok(PlanningTaskToggleCompleteRequest { task_id })
}

pub fn apply_planning_task_timer(
    db_path: &Path,
    request: &PlanningTaskTimerRequest,
) -> Result<PlanningTaskTimerResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let task = load_task_row(&transaction, &request.task_id)?;
    let resolved_action = resolve_timer_action(request.action, task.is_running);
    let now = current_timestamp(&transaction)?;

    match resolved_action {
        TimerAction::Start => {
            transaction
                .execute(
                    "UPDATE tasks
                     SET is_running = 1, last_started = ?2
                     WHERE id = ?1",
                    rusqlite::params![request.task_id, now],
                )
                .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        }
        TimerAction::Stop => {
            let elapsed = task
                .last_started
                .as_deref()
                .map(|last_started| elapsed_seconds_between(&transaction, last_started, &now))
                .transpose()?
                .unwrap_or(0);
            transaction
                .execute(
                    "UPDATE tasks
                     SET is_running = 0,
                         total_seconds = ?2,
                         last_started = NULL
                     WHERE id = ?1",
                    rusqlite::params![request.task_id, task.total_seconds.saturating_add(elapsed)],
                )
                .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        }
        TimerAction::Toggle => unreachable!("toggle should resolve to start/stop"),
    }

    let action_name = if matches!(resolved_action, TimerAction::Start) {
        "timer_started"
    } else {
        "timer_stopped"
    };
    let detail = if matches!(resolved_action, TimerAction::Start) {
        format!("Timer started on \"{}\"", task.title)
    } else {
        format!("Timer stopped on \"{}\"", task.title)
    };
    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        action_name,
        &detail,
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (updated_task, context) = read_task_and_context(db_path, &request.task_id)?;
    Ok(PlanningTaskTimerResult {
        resolved_action: if matches!(resolved_action, TimerAction::Start) {
            String::from("start")
        } else {
            String::from("stop")
        },
        task: updated_task,
        context,
    })
}

pub fn apply_planning_task_toggle_complete(
    db_path: &Path,
    request: &PlanningTaskToggleCompleteRequest,
) -> Result<PlanningTaskToggleCompleteResult, PlanningCommandError> {
    let mut connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let task = load_task_row(&transaction, &request.task_id)?;
    let new_completed = !task.completed;
    let now = current_timestamp(&transaction)?;

    transaction
        .execute(
            "UPDATE tasks SET completed = ?2 WHERE id = ?1",
            rusqlite::params![request.task_id, if new_completed { 1 } else { 0 }],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let action_name = if new_completed {
        "completed"
    } else {
        "uncompleted"
    };
    let detail = format!(
        "Task \"{}\" marked as {}",
        task.title,
        if new_completed {
            "completed"
        } else {
            "incomplete"
        }
    );
    append_activity_entry(
        &transaction,
        "task",
        &request.task_id,
        action_name,
        &detail,
        &now,
    )?;
    prune_activity_log(&transaction)?;

    transaction
        .commit()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    let (updated_task, context) = read_task_and_context(db_path, &request.task_id)?;
    Ok(PlanningTaskToggleCompleteResult {
        task: updated_task,
        context,
    })
}

fn read_task_and_context(
    db_path: &Path,
    task_id: &str,
) -> Result<(PlanningTask, PlanningContextSnapshot), PlanningCommandError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let snapshot = read_planning_snapshot(db_path, &planning_settings)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let task = snapshot
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .cloned()
        .ok_or_else(|| PlanningCommandError::InvalidParams(format!("Unknown taskId: {task_id}")))?;
    let context = build_planning_context(snapshot);
    Ok((task, context))
}

fn read_project_and_context(
    db_path: &Path,
    project_id: &str,
) -> Result<(PlanningProject, PlanningContextSnapshot), PlanningCommandError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let snapshot = read_planning_snapshot(db_path, &planning_settings)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let project = snapshot
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .cloned()
        .ok_or_else(|| {
            PlanningCommandError::InvalidParams(format!("Unknown projectId: {project_id}"))
        })?;
    let context = build_planning_context(snapshot);
    Ok((project, context))
}

fn read_task_by_id(db_path: &Path, task_id: &str) -> Result<PlanningTask, PlanningCommandError> {
    let (task, _) = read_task_and_context(db_path, task_id)?;
    Ok(task)
}

fn read_project_by_id(
    db_path: &Path,
    project_id: &str,
) -> Result<PlanningProject, PlanningCommandError> {
    let (project, _) = read_project_and_context(db_path, project_id)?;
    Ok(project)
}

fn read_planning_context_with_current_settings(
    db_path: &Path,
) -> Result<PlanningContextSnapshot, PlanningCommandError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    read_planning_context(db_path, &planning_settings)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn update_selection_after_mutation(
    db_path: &Path,
    selected_project_id: Option<Option<String>>,
    selected_task_id: Option<Option<String>>,
) -> Result<PlanningContextSnapshot, PlanningCommandError> {
    let request = PlanningSettingsUpdateRequest {
        view_filter: None,
        sort_by: None,
        dashboard_view: None,
        deck_mode: None,
        selected_project_id,
        selected_task_id,
    };
    update_planning_settings(db_path, &request)
}

fn load_project_row(
    connection: &rusqlite::Transaction<'_>,
    project_id: &str,
) -> Result<PlanningProject, PlanningCommandError> {
    connection
        .query_row(
            "SELECT id, title, description, status, priority, created_at, last_updated, sort_order
             FROM projects
             WHERE id = ?1",
            [project_id],
            |row| {
                Ok(PlanningProject {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    status: row.get(3)?,
                    priority: row.get(4)?,
                    created_at: row.get(5)?,
                    last_updated: row.get(6)?,
                    order: row.get(7)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                PlanningCommandError::InvalidParams(format!("Unknown projectId: {project_id}"))
            }
            _ => PlanningCommandError::Storage(error.to_string()),
        })
}

fn load_task_row(
    connection: &rusqlite::Connection,
    task_id: &str,
) -> Result<PlanningTaskRow, PlanningCommandError> {
    connection
        .query_row(
            "SELECT
                id,
                project_id,
                title,
                description,
                priority,
                due_date,
                labels_json,
                is_running,
                total_seconds,
                last_started,
                completed,
                sort_order,
                created_at,
                scheduled_start,
                scheduled_duration_seconds
             FROM tasks
             WHERE id = ?1",
            [task_id],
            |row| {
                let labels_json: String = row.get(6)?;
                let labels = serde_json::from_str::<Vec<String>>(&labels_json).unwrap_or_default();
                Ok(PlanningTaskRow {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    priority: row.get(4)?,
                    due_date: row.get(5)?,
                    labels,
                    is_running: row.get::<_, i64>(7)? != 0,
                    total_seconds: row.get(8)?,
                    last_started: row.get(9)?,
                    completed: row.get::<_, i64>(10)? != 0,
                    order: row.get(11)?,
                    created_at: row.get(12)?,
                    scheduled_start: row.get(13)?,
                    scheduled_duration_seconds: row.get(14)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                PlanningCommandError::InvalidParams(format!("Unknown taskId: {task_id}"))
            }
            _ => PlanningCommandError::Storage(error.to_string()),
        })
}

fn load_checklist_item_row(
    connection: &rusqlite::Transaction<'_>,
    task_id: &str,
    item_id: &str,
) -> Result<PlanningChecklistItem, PlanningCommandError> {
    connection
        .query_row(
            "SELECT id, text, done, sort_order
             FROM task_checklist_items
             WHERE task_id = ?1 AND id = ?2",
            rusqlite::params![task_id, item_id],
            |row| {
                Ok(PlanningChecklistItem {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    done: row.get::<_, i64>(2)? != 0,
                    order: row.get(3)?,
                })
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => PlanningCommandError::InvalidParams(format!(
                "Unknown checklist itemId for taskId {task_id}: {item_id}"
            )),
            _ => PlanningCommandError::Storage(error.to_string()),
        })
}

fn resolve_timer_action(action: TimerAction, is_running: bool) -> TimerAction {
    match action {
        TimerAction::Toggle => {
            if is_running {
                TimerAction::Stop
            } else {
                TimerAction::Start
            }
        }
        value => value,
    }
}

fn current_timestamp(connection: &rusqlite::Connection) -> Result<String, PlanningCommandError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn elapsed_seconds_between(
    connection: &rusqlite::Connection,
    last_started: &str,
    stopped_at: &str,
) -> Result<i64, PlanningCommandError> {
    connection
        .query_row(
            "SELECT CAST((julianday(?2) - julianday(?1)) * 86400 AS INTEGER)",
            rusqlite::params![last_started, stopped_at],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map(|value| value.unwrap_or(0).max(0))
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn append_activity_entry(
    transaction: &rusqlite::Transaction<'_>,
    entity_type: &str,
    entity_id: &str,
    action: &str,
    detail: &str,
    timestamp: &str,
) -> Result<(), PlanningCommandError> {
    transaction
        .execute(
            "INSERT INTO activity_log(id, timestamp, entity_type, entity_id, action, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                generate_entry_id("act"),
                timestamp,
                entity_type,
                entity_id,
                action,
                detail,
            ],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    Ok(())
}

fn prune_activity_log(transaction: &rusqlite::Transaction<'_>) -> Result<(), PlanningCommandError> {
    transaction
        .execute(
            "DELETE FROM activity_log
             WHERE id NOT IN (
               SELECT id
               FROM activity_log
               ORDER BY timestamp DESC
               LIMIT 500
             )",
            [],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    Ok(())
}

fn next_project_sort_order_for_status(
    transaction: &rusqlite::Transaction<'_>,
    status: &str,
) -> Result<i64, PlanningCommandError> {
    transaction
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects WHERE status = ?1",
            [status],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn next_task_sort_order_for_project(
    transaction: &rusqlite::Transaction<'_>,
    project_id: &str,
) -> Result<i64, PlanningCommandError> {
    transaction
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks WHERE project_id = ?1",
            [project_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn next_checklist_sort_order_for_task(
    transaction: &rusqlite::Transaction<'_>,
    task_id: &str,
) -> Result<i64, PlanningCommandError> {
    transaction
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_checklist_items WHERE task_id = ?1",
            [task_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn reorder_project_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    project_id: &str,
    current_status: &str,
    target_status: &str,
    new_index: Option<i64>,
    now: &str,
) -> Result<(), PlanningCommandError> {
    if current_status == target_status {
        let mut project_ids = ordered_project_ids_by_status_in_transaction(
            transaction,
            target_status,
            Some(project_id),
        )?;
        let insert_index = clamped_index(new_index, project_ids.len());
        project_ids.insert(insert_index, project_id.to_string());

        for (order, ordered_project_id) in project_ids.iter().enumerate() {
            if ordered_project_id == project_id {
                transaction
                    .execute(
                        "UPDATE projects
                         SET status = ?2, sort_order = ?3, last_updated = ?4
                         WHERE id = ?1",
                        rusqlite::params![project_id, target_status, order as i64, now],
                    )
                    .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
            } else {
                transaction
                    .execute(
                        "UPDATE projects SET sort_order = ?2 WHERE id = ?1",
                        rusqlite::params![ordered_project_id, order as i64],
                    )
                    .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
            }
        }

        return Ok(());
    }

    let source_project_ids = ordered_project_ids_by_status_in_transaction(
        transaction,
        current_status,
        Some(project_id),
    )?;
    for (order, ordered_project_id) in source_project_ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE projects SET sort_order = ?2 WHERE id = ?1",
                rusqlite::params![ordered_project_id, order as i64],
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    }

    let mut target_project_ids =
        ordered_project_ids_by_status_in_transaction(transaction, target_status, Some(project_id))?;
    let insert_index = clamped_index(new_index, target_project_ids.len());
    target_project_ids.insert(insert_index, project_id.to_string());
    for (order, ordered_project_id) in target_project_ids.iter().enumerate() {
        if ordered_project_id == project_id {
            transaction
                .execute(
                    "UPDATE projects
                     SET status = ?2, sort_order = ?3, last_updated = ?4
                     WHERE id = ?1",
                    rusqlite::params![project_id, target_status, order as i64, now],
                )
                .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        } else {
            transaction
                .execute(
                    "UPDATE projects SET sort_order = ?2 WHERE id = ?1",
                    rusqlite::params![ordered_project_id, order as i64],
                )
                .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        }
    }

    Ok(())
}

fn reorder_task_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    task_id: &str,
    project_id: &str,
    new_index: i64,
) -> Result<(), PlanningCommandError> {
    let mut task_ids =
        ordered_task_ids_for_project_in_transaction(transaction, project_id, Some(task_id))?;
    let insert_index = clamped_index(Some(new_index), task_ids.len());
    task_ids.insert(insert_index, task_id.to_string());

    for (order, ordered_task_id) in task_ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE tasks SET sort_order = ?2 WHERE id = ?1",
                rusqlite::params![ordered_task_id, order as i64],
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    }

    Ok(())
}

fn generate_entry_id(prefix: &str) -> String {
    generate_runtime_id(prefix)
}

fn generate_runtime_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_ACTIVITY_ID: AtomicU64 = AtomicU64::new(1);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = NEXT_ACTIVITY_ID.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{nanos}-{sequence}")
}

fn build_planning_context(snapshot: PlanningSnapshot) -> PlanningContextSnapshot {
    let selected_project =
        snapshot
            .settings
            .selected_project_id
            .as_ref()
            .and_then(|selected_project_id| {
                snapshot
                    .projects
                    .iter()
                    .find(|project| &project.id == selected_project_id)
                    .map(|project| PlanningProjectContext {
                        id: project.id.clone(),
                        title: project.title.clone(),
                        status: project.status.clone(),
                        priority: project.priority.clone(),
                    })
            });

    let project_index = selected_project
        .as_ref()
        .and_then(|selected_project| {
            snapshot
                .projects
                .iter()
                .position(|project| project.id == selected_project.id)
        })
        .map(|index| index as i64)
        .unwrap_or(-1);

    let tasks = selected_project
        .as_ref()
        .map(|selected_project| {
            snapshot
                .tasks
                .iter()
                .filter(|task| task.project_id == selected_project.id)
                .map(|task| PlanningTaskContext {
                    id: task.id.clone(),
                    title: task.title.clone(),
                    is_running: task.is_running,
                    completed: task.completed,
                    total_seconds: task.total_seconds,
                    priority: task.priority.clone(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let selected_task = snapshot
        .settings
        .selected_task_id
        .as_ref()
        .and_then(|selected_task_id| {
            tasks
                .iter()
                .find(|task| &task.id == selected_task_id)
                .cloned()
        });

    let task_index = selected_task
        .as_ref()
        .and_then(|selected_task| tasks.iter().position(|task| task.id == selected_task.id))
        .map(|index| index as i64)
        .unwrap_or(-1);

    let running_task = snapshot
        .tasks
        .iter()
        .find(|task| task.is_running)
        .map(|task| PlanningRunningTaskContext {
            id: task.id.clone(),
            project_id: task.project_id.clone(),
            title: task.title.clone(),
            total_seconds: task.total_seconds,
            last_started: task.last_started.clone(),
        });

    PlanningContextSnapshot {
        selected_project,
        project_index,
        project_count: snapshot.projects.len(),
        selected_task_id: snapshot.settings.selected_task_id.clone(),
        settings: snapshot.settings,
        selected_task,
        task_index,
        task_count: tasks.len(),
        tasks,
        running_task,
    }
}

#[derive(Debug)]
struct SelectionState {
    project_id: Option<String>,
    task_id: Option<String>,
}

fn resolve_updated_selection(
    db_path: &Path,
    current_snapshot: &PlanningSettingsSnapshot,
    request: &PlanningSettingsUpdateRequest,
) -> Result<SelectionState, PlanningCommandError> {
    if let Some(Some(task_id)) = &request.selected_task_id {
        let task_project_id = project_id_for_task(db_path, task_id)?;
        if let Some(Some(project_id)) = &request.selected_project_id {
            if *project_id != task_project_id {
                return Err(PlanningCommandError::InvalidParams(String::from(
                    "selectedTaskId must belong to selectedProjectId",
                )));
            }
        }

        return Ok(SelectionState {
            project_id: Some(task_project_id),
            task_id: Some(task_id.clone()),
        });
    }

    if let Some(selected_project_id) = &request.selected_project_id {
        return match selected_project_id {
            Some(project_id) => {
                let valid_project_id = assert_project_exists(db_path, project_id)?;
                let task_id = match &request.selected_task_id {
                    Some(None) => None,
                    _ => first_task_id_for_project(db_path, &valid_project_id)?,
                };
                Ok(SelectionState {
                    project_id: Some(valid_project_id),
                    task_id,
                })
            }
            None => Ok(SelectionState {
                project_id: None,
                task_id: None,
            }),
        };
    }

    if let Some(selected_task_id) = &request.selected_task_id {
        return match selected_task_id {
            Some(task_id) => {
                let project_id = project_id_for_task(db_path, task_id)?;
                Ok(SelectionState {
                    project_id: Some(project_id),
                    task_id: Some(task_id.clone()),
                })
            }
            None => Ok(SelectionState {
                project_id: current_snapshot.selected_project_id.clone(),
                task_id: None,
            }),
        };
    }

    Ok(SelectionState {
        project_id: current_snapshot.selected_project_id.clone(),
        task_id: current_snapshot.selected_task_id.clone(),
    })
}

fn ordered_project_ids(db_path: &Path) -> Result<Vec<String>, PlanningCommandError> {
    let connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let mut statement = connection
        .prepare("SELECT id FROM projects ORDER BY sort_order ASC, created_at ASC")
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn ordered_project_ids_by_status_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    status: &str,
    exclude_project_id: Option<&str>,
) -> Result<Vec<String>, PlanningCommandError> {
    if let Some(project_id) = exclude_project_id {
        let mut statement = transaction
            .prepare(
                "SELECT id
                 FROM projects
                 WHERE status = ?1 AND id != ?2
                 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        let rows = statement
            .query_map(rusqlite::params![status, project_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))
    } else {
        let mut statement = transaction
            .prepare(
                "SELECT id
                 FROM projects
                 WHERE status = ?1
                 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        let rows = statement
            .query_map([status], |row| row.get::<_, String>(0))
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))
    }
}

fn ordered_task_ids_for_project(
    db_path: &Path,
    project_id: &str,
) -> Result<Vec<String>, PlanningCommandError> {
    let connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let mut statement = connection
        .prepare(
            "SELECT id
             FROM tasks
             WHERE project_id = ?1
             ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let rows = statement
        .query_map([project_id], |row| row.get::<_, String>(0))
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

fn ordered_task_ids_for_project_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    project_id: &str,
    exclude_task_id: Option<&str>,
) -> Result<Vec<String>, PlanningCommandError> {
    if let Some(task_id) = exclude_task_id {
        let mut statement = transaction
            .prepare(
                "SELECT id
                 FROM tasks
                 WHERE project_id = ?1 AND id != ?2
                 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        let rows = statement
            .query_map(rusqlite::params![project_id, task_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))
    } else {
        let mut statement = transaction
            .prepare(
                "SELECT id
                 FROM tasks
                 WHERE project_id = ?1
                 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        let rows = statement
            .query_map([project_id], |row| row.get::<_, String>(0))
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| PlanningCommandError::Storage(error.to_string()))
    }
}

fn first_task_id_for_project(
    db_path: &Path,
    project_id: &str,
) -> Result<Option<String>, PlanningCommandError> {
    Ok(ordered_task_ids_for_project(db_path, project_id)?
        .into_iter()
        .next())
}

fn assert_project_exists(db_path: &Path, project_id: &str) -> Result<String, PlanningCommandError> {
    let connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            [project_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    if exists == 0 {
        return Err(PlanningCommandError::InvalidParams(format!(
            "Unknown projectId: {project_id}"
        )));
    }

    Ok(project_id.to_string())
}

fn assert_project_exists_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    project_id: &str,
) -> Result<(), PlanningCommandError> {
    let exists = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            [project_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    if exists == 0 {
        return Err(PlanningCommandError::InvalidParams(format!(
            "Unknown projectId: {project_id}"
        )));
    }

    Ok(())
}

fn project_id_for_task(db_path: &Path, task_id: &str) -> Result<String, PlanningCommandError> {
    let connection = open_connection(db_path)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    let project_id = connection
        .query_row(
            "SELECT project_id FROM tasks WHERE id = ?1",
            [task_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                PlanningCommandError::InvalidParams(format!("Unknown taskId: {task_id}"))
            }
            _ => PlanningCommandError::Storage(error.to_string()),
        })?;

    Ok(project_id)
}

fn parse_required_title(params: &Value, name: &str) -> Result<String, String> {
    let title = parse_required_string_field(params, name)?;
    if title.is_empty() {
        return Err(format!("{name} must not be empty"));
    }

    Ok(title)
}

fn parse_required_string_field(params: &Value, name: &str) -> Result<String, String> {
    params
        .get(name)
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .ok_or_else(|| format!("{name} is required and must be a string"))
}

fn parse_optional_string_field(params: &Value, name: &str) -> Result<Option<String>, String> {
    params
        .get(name)
        .map(|value| {
            value
                .as_str()
                .map(|value| value.trim().to_string())
                .ok_or_else(|| format!("{name} must be a string"))
        })
        .transpose()
}

fn parse_optional_nullable_string_field(
    params: &Value,
    name: &str,
) -> Result<Option<String>, String> {
    match params.get(name) {
        Some(value) if value.is_null() => Ok(None),
        Some(value) => value
            .as_str()
            .map(|value| Some(value.to_string()))
            .ok_or_else(|| format!("{name} must be a string or null")),
        None => Ok(None),
    }
}

fn parse_optional_i64_field(params: &Value, name: &str) -> Result<Option<i64>, String> {
    params
        .get(name)
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| format!("{name} must be an integer"))
        })
        .transpose()
}

fn parse_optional_nullable_i64_field(
    params: &Value,
    name: &str,
) -> Result<Option<i64>, String> {
    match params.get(name) {
        Some(value) if value.is_null() => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("{name} must be an integer or null")),
        None => Ok(None),
    }
}

fn parse_optional_bool_field(params: &Value, name: &str) -> Result<Option<bool>, String> {
    params
        .get(name)
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| format!("{name} must be a boolean"))
        })
        .transpose()
}

fn parse_optional_string_array_field(
    params: &Value,
    name: &str,
) -> Result<Option<Vec<String>>, String> {
    params
        .get(name)
        .map(|value| {
            let values = value
                .as_array()
                .ok_or_else(|| format!("{name} must be an array of strings"))?;
            values
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(|value| value.trim().to_string())
                        .ok_or_else(|| format!("{name} must be an array of strings"))
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
}

fn parse_nullable_string(value: &Value, name: &str) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }

    value
        .as_str()
        .map(|value| Some(value.to_string()))
        .ok_or_else(|| format!("{name} must be a string or null"))
}

fn is_valid_project_status(value: &str) -> bool {
    VALID_PROJECT_STATUSES.contains(&value)
}

fn is_valid_priority(value: &str) -> bool {
    VALID_PRIORITIES.contains(&value)
}

fn clamped_index(new_index: Option<i64>, len: usize) -> usize {
    match new_index {
        Some(value) if value <= 0 => 0,
        Some(value) => (value as usize).min(len),
        None => len,
    }
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn parse_selection_direction(value: &Value, name: &str) -> Result<SelectionDirection, String> {
    let value = value
        .as_str()
        .ok_or_else(|| format!("{name} must be a string"))?;

    match value {
        "next" => Ok(SelectionDirection::Next),
        "prev" => Ok(SelectionDirection::Prev),
        _ => Err(format!("{name} must be one of: next, prev")),
    }
}

fn cycle_string(
    values: &[String],
    current: Option<&str>,
    direction: SelectionDirection,
) -> Option<String> {
    if values.is_empty() {
        return None;
    }

    let next_index = match values
        .iter()
        .position(|value| Some(value.as_str()) == current)
    {
        Some(index) => match direction {
            SelectionDirection::Next => (index + 1) % values.len(),
            SelectionDirection::Prev => (index + values.len() - 1) % values.len(),
        },
        None => 0,
    };

    values.get(next_index).cloned()
}

fn read_projects(connection: &rusqlite::Connection) -> EngineResult<Vec<PlanningProject>> {
    let mut statement = connection.prepare(
        "SELECT id, title, description, status, priority, created_at, last_updated, sort_order
         FROM projects
         ORDER BY sort_order ASC, created_at ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PlanningProject {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            created_at: row.get(5)?,
            last_updated: row.get(6)?,
            order: row.get(7)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn read_checklist_items_by_task(
    connection: &rusqlite::Connection,
) -> EngineResult<HashMap<String, Vec<PlanningChecklistItem>>> {
    let mut statement = connection.prepare(
        "SELECT id, task_id, text, done, sort_order
         FROM task_checklist_items
         ORDER BY task_id ASC, sort_order ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(1)?,
            PlanningChecklistItem {
                id: row.get(0)?,
                text: row.get(2)?,
                done: row.get::<_, i64>(3)? != 0,
                order: row.get(4)?,
            },
        ))
    })?;

    let mut checklist_by_task = HashMap::new();
    for row in rows {
        let (task_id, item) = row?;
        checklist_by_task
            .entry(task_id)
            .or_insert_with(Vec::new)
            .push(item);
    }

    Ok(checklist_by_task)
}

fn read_tasks(connection: &rusqlite::Connection) -> EngineResult<Vec<PlanningTaskRow>> {
    let mut statement = connection.prepare(
        "SELECT
            t.id,
            t.project_id,
            t.title,
            t.description,
            t.priority,
            t.due_date,
            t.labels_json,
            t.is_running,
            t.total_seconds,
            t.last_started,
            t.completed,
            t.sort_order,
            t.created_at,
            t.scheduled_start,
            t.scheduled_duration_seconds
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         ORDER BY p.sort_order ASC, t.sort_order ASC, t.created_at ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let labels_json: String = row.get(6)?;
        let labels = serde_json::from_str::<Vec<String>>(&labels_json).unwrap_or_default();

        Ok(PlanningTaskRow {
            id: row.get(0)?,
            project_id: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            priority: row.get(4)?,
            due_date: row.get(5)?,
            labels,
            is_running: row.get::<_, i64>(7)? != 0,
            total_seconds: row.get(8)?,
            last_started: row.get(9)?,
            completed: row.get::<_, i64>(10)? != 0,
            order: row.get(11)?,
            created_at: row.get(12)?,
            scheduled_start: row.get(13)?,
            scheduled_duration_seconds: row.get(14)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn read_activity_log(
    connection: &rusqlite::Connection,
) -> EngineResult<Vec<PlanningActivityEntry>> {
    let mut statement = connection.prepare(
        "SELECT id, timestamp, entity_type, entity_id, action, detail
         FROM activity_log
         ORDER BY timestamp DESC
         LIMIT 50",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PlanningActivityEntry {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            entity_type: row.get(2)?,
            entity_id: row.get(3)?,
            action: row.get(4)?,
            detail: row.get(5)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legacy_import::LegacyImportRequest;
    use crate::storage::{import_legacy_db, initialize_database, list_settings_by_prefix};
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

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

    fn seed_planning_state(db_path: &Path, source_path: &Path) {
        initialize_database(db_path).expect("database should initialize");

        fs::write(
            source_path,
            serde_json::to_vec_pretty(&json!({
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
                    },
                    {
                        "id": "proj-2",
                        "title": "Studio Launch",
                        "description": "Commissioning prep",
                        "status": "todo",
                        "priority": "p2",
                        "createdAt": "2026-04-02T10:00:00.000Z",
                        "lastUpdated": "2026-04-09T10:00:00.000Z",
                        "order": 1
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
                        "labels": ["frontend"],
                        "checklist": [
                            {"id": "check-1", "text": "Wire layout", "done": true}
                        ],
                        "isRunning": false,
                        "totalSeconds": 120,
                        "lastStarted": null,
                        "completed": false,
                        "order": 0,
                        "createdAt": "2026-04-11T10:00:00.000Z"
                    },
                    {
                        "id": "task-2",
                        "projectId": "proj-1",
                        "title": "Finalize copy",
                        "description": "",
                        "priority": "p2",
                        "dueDate": null,
                        "labels": ["content"],
                        "checklist": [],
                        "isRunning": false,
                        "totalSeconds": 30,
                        "lastStarted": null,
                        "completed": false,
                        "order": 1,
                        "createdAt": "2026-04-12T10:00:00.000Z"
                    },
                    {
                        "id": "task-3",
                        "projectId": "proj-2",
                        "title": "Cable patch list",
                        "description": "",
                        "priority": "p0",
                        "dueDate": null,
                        "labels": ["ops"],
                        "checklist": [],
                        "isRunning": true,
                        "totalSeconds": 60,
                        "lastStarted": "2026-04-15T00:00:00.000Z",
                        "completed": false,
                        "order": 0,
                        "createdAt": "2026-04-13T10:00:00.000Z"
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
                    },
                    {
                        "id": "act-2",
                        "timestamp": "2026-04-14T10:00:00.000Z",
                        "entityType": "project",
                        "entityId": "proj-2",
                        "action": "updated",
                        "detail": "Priority bumped"
                    }
                ],
                "settings": {
                    "viewFilter": "todo",
                    "sortBy": "priority",
                    "selectedProjectId": "proj-1",
                    "selectedTaskId": "task-2",
                    "dashboardView": "kanban",
                    "deckMode": "project",
                    "hasCompletedSetup": true
                }
            }))
            .expect("legacy payload should serialize"),
        )
        .expect("legacy db should be written");

        import_legacy_db(
            db_path,
            &LegacyImportRequest {
                source_path: source_path.to_path_buf(),
                force: false,
            },
        )
        .expect("legacy import should succeed");
    }

    #[test]
    fn read_planning_snapshot_returns_imported_planning_state() {
        let test_dir = TestDir::new("planning-snapshot");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");

        assert_eq!(snapshot.counts.project_count, 2);
        assert_eq!(snapshot.counts.task_count, 3);
        assert_eq!(snapshot.projects[0].title, "Website Redesign");
        assert_eq!(snapshot.tasks[0].labels, vec![String::from("frontend")]);
        assert_eq!(snapshot.tasks[0].checklist.len(), 1);
        assert_eq!(snapshot.activity_log[0].action, "updated");
        assert_eq!(snapshot.settings.view_filter, "todo");
        assert_eq!(snapshot.settings.dashboard_view, "kanban");
    }

    #[test]
    fn read_planning_context_returns_selected_project_task_and_running_summary() {
        let test_dir = TestDir::new("planning-context");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let context =
            read_planning_context(&db_path, &planning_settings).expect("context should load");

        assert_eq!(context.project_count, 2);
        assert_eq!(context.project_index, 0);
        assert_eq!(context.task_count, 2);
        assert_eq!(context.task_index, 1);
        assert_eq!(
            context
                .selected_project
                .as_ref()
                .map(|project| project.title.as_str()),
            Some("Website Redesign")
        );
        assert_eq!(
            context
                .selected_task
                .as_ref()
                .map(|task| task.title.as_str()),
            Some("Finalize copy")
        );
        assert!(context.running_task.is_none());
        assert_eq!(context.settings.sort_by, "priority");
        assert_eq!(context.settings.view_filter, "todo");
    }

    #[test]
    fn update_planning_settings_persists_filter_sort_and_selection() {
        let test_dir = TestDir::new("planning-settings-update");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let params = json!({
            "viewFilter": "blocked",
            "sortBy": "name",
            "selectedProjectId": "proj-2"
        });
        let request =
            parse_planning_settings_update(&params).expect("settings update should parse");
        let context =
            update_planning_settings(&db_path, &request).expect("settings update should succeed");

        assert_eq!(context.settings.view_filter, "blocked");
        assert_eq!(context.settings.sort_by, "name");
        assert_eq!(
            context.settings.selected_project_id.as_deref(),
            Some("proj-2")
        );
        assert_eq!(context.settings.selected_task_id.as_deref(), Some("task-3"));
        assert_eq!(
            context
                .selected_project
                .as_ref()
                .map(|project| project.title.as_str()),
            Some("Studio Launch")
        );
        assert_eq!(
            context.selected_task.as_ref().map(|task| task.id.as_str()),
            Some("task-3")
        );
    }

    #[test]
    fn read_planning_time_report_matches_legacy_report_shape() {
        let test_dir = TestDir::new("planning-time-report");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        let report = read_planning_time_report(&db_path, None).expect("time report should load");

        let expected_total = snapshot
            .tasks
            .iter()
            .map(|task| task.total_seconds)
            .sum::<i64>();
        assert_eq!(report.total_seconds, expected_total);
        assert_eq!(report.by_project.len(), 2);
        assert_eq!(report.by_project[0].project_id, "proj-2");
        assert_eq!(report.by_project[0].title, "Studio Launch");
        assert_eq!(report.by_project[0].task_count, 1);
        assert_eq!(
            report.by_task.len(),
            snapshot
                .tasks
                .iter()
                .filter(|task| task.total_seconds > 0)
                .count()
        );
        assert_eq!(report.by_task[0].task_id, "task-3");
        assert_eq!(report.by_task[0].project_title, "Studio Launch");
        assert!(report
            .by_task
            .iter()
            .any(|task| task.task_title == "Finalize copy"));
        assert!(report.by_task[0].total_seconds >= report.by_task[1].total_seconds);
        assert_eq!(
            report.timer_events.len(),
            snapshot
                .activity_log
                .iter()
                .filter(|entry| matches!(entry.action.as_str(), "timer_started" | "timer_stopped"))
                .count()
                .min(100)
        );
        assert!(report
            .timer_events
            .iter()
            .all(|entry| matches!(entry.action.as_str(), "timer_started" | "timer_stopped")));

        let filtered = read_planning_time_report(&db_path, Some("proj-1"))
            .expect("filtered report should load");
        assert_eq!(
            filtered.total_seconds,
            snapshot
                .tasks
                .iter()
                .filter(|task| task.project_id == "proj-1")
                .map(|task| task.total_seconds)
                .sum::<i64>()
        );
        assert_eq!(filtered.by_project.len(), 1);
        assert_eq!(filtered.by_project[0].project_id, "proj-1");
        assert!(filtered
            .by_task
            .iter()
            .all(|task| task.project_id == "proj-1"));
    }

    #[test]
    fn planning_select_supports_task_lookup_and_project_cycling() {
        let test_dir = TestDir::new("planning-select");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let select_task = parse_planning_selection_request(&json!({
            "taskId": "task-3"
        }))
        .expect("task selection should parse");
        let selected_context =
            apply_planning_selection(&db_path, &select_task).expect("task selection should work");

        assert_eq!(
            selected_context.settings.selected_project_id.as_deref(),
            Some("proj-2")
        );
        assert_eq!(
            selected_context.settings.selected_task_id.as_deref(),
            Some("task-3")
        );

        let cycle_project = parse_planning_selection_request(&json!({
            "projectDirection": "prev"
        }))
        .expect("project cycle should parse");
        let cycled_context = apply_planning_selection(&db_path, &cycle_project)
            .expect("project cycling should work");

        assert_eq!(
            cycled_context.settings.selected_project_id.as_deref(),
            Some("proj-1")
        );
        assert_eq!(
            cycled_context.settings.selected_task_id.as_deref(),
            Some("task-1")
        );
        assert_eq!(cycled_context.task_count, 2);
    }

    #[test]
    fn planning_task_timer_starts_and_stops_with_activity_entries() {
        let test_dir = TestDir::new("planning-task-timer");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let start_request = parse_planning_task_timer_request(&json!({
            "taskId": "task-1",
            "action": "start"
        }))
        .expect("timer request should parse");
        let started =
            apply_planning_task_timer(&db_path, &start_request).expect("timer should start");

        assert_eq!(started.resolved_action, "start");
        assert!(started.task.is_running);
        assert!(started.task.last_started.is_some());
        assert_eq!(
            started
                .context
                .running_task
                .as_ref()
                .map(|task| task.id.as_str()),
            Some("task-1")
        );

        let stop_request = parse_planning_task_timer_request(&json!({
            "taskId": "task-1",
            "action": "toggle"
        }))
        .expect("timer request should parse");
        let stopped =
            apply_planning_task_timer(&db_path, &stop_request).expect("timer should stop");

        assert_eq!(stopped.resolved_action, "stop");
        assert!(!stopped.task.is_running);
        assert!(stopped.task.last_started.is_none());
        assert!(stopped.task.total_seconds >= 120);

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        assert_eq!(snapshot.activity_log[0].action, "timer_stopped");
        assert_eq!(snapshot.activity_log[1].action, "timer_started");
    }

    #[test]
    fn planning_task_toggle_complete_flips_completion_and_logs_activity() {
        let test_dir = TestDir::new("planning-task-complete");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let toggle_request = parse_planning_task_toggle_complete_request(&json!({
            "taskId": "task-2"
        }))
        .expect("toggle request should parse");
        let toggled = apply_planning_task_toggle_complete(&db_path, &toggle_request)
            .expect("task completion should toggle");

        assert!(toggled.task.completed);
        assert_eq!(toggled.task.id, "task-2");

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        let task = snapshot
            .tasks
            .iter()
            .find(|task| task.id == "task-2")
            .expect("task should exist");
        assert!(task.completed);
        assert_eq!(snapshot.activity_log[0].action, "completed");
    }

    #[test]
    fn planning_project_create_selects_new_project_and_logs_activity() {
        let test_dir = TestDir::new("planning-project-create");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let request = parse_planning_project_create_request(&json!({
            "title": "Native Planning Lane",
            "priority": "p0",
            "status": "blocked"
        }))
        .expect("project create should parse");
        let created =
            apply_planning_project_create(&db_path, &request).expect("project create should work");

        assert_eq!(created.project.title, "Native Planning Lane");
        assert_eq!(created.project.status, "blocked");
        assert_eq!(
            created.context.settings.selected_project_id.as_deref(),
            Some(created.project.id.as_str())
        );
        assert_eq!(created.context.settings.selected_task_id, None);

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        assert_eq!(snapshot.counts.project_count, 3);
        assert_eq!(snapshot.activity_log[0].action, "created");
        assert_eq!(snapshot.activity_log[0].entity_type, "project");
    }

    #[test]
    fn planning_project_update_reorder_and_delete_keep_selection_consistent() {
        let test_dir = TestDir::new("planning-project-mutations");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let update_request = parse_planning_project_update_request(&json!({
            "projectId": "proj-2",
            "title": "Studio Launch Revised",
            "priority": "p1"
        }))
        .expect("project update should parse");
        let updated =
            apply_planning_project_update(&db_path, &update_request).expect("update should work");
        assert_eq!(updated.project.title, "Studio Launch Revised");
        assert_eq!(updated.project.priority, "p1");

        let reorder_request = parse_planning_project_reorder_request(&json!({
            "projectId": "proj-2",
            "newStatus": "done",
            "newIndex": 0
        }))
        .expect("project reorder should parse");
        let reordered = apply_planning_project_reorder(&db_path, &reorder_request)
            .expect("reorder should work");
        assert_eq!(reordered.project.status, "done");

        let delete_request = parse_planning_project_delete_request(&json!({
            "projectId": "proj-1"
        }))
        .expect("project delete should parse");
        let deleted =
            apply_planning_project_delete(&db_path, &delete_request).expect("delete should work");
        assert!(deleted.deleted);
        assert_eq!(
            deleted.context.settings.selected_project_id.as_deref(),
            Some("proj-2")
        );
        assert_eq!(
            deleted.context.settings.selected_task_id.as_deref(),
            Some("task-3")
        );

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        assert_eq!(snapshot.counts.project_count, 1);
        assert_eq!(snapshot.projects[0].id, "proj-2");
        assert_eq!(snapshot.activity_log[0].action, "deleted");
    }

    #[test]
    fn planning_task_create_update_and_delete_keep_selection_consistent() {
        let test_dir = TestDir::new("planning-task-mutations");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let create_request = parse_planning_task_create_request(&json!({
            "projectId": "proj-1",
            "title": "Ship native shell controls",
            "priority": "p0",
            "labels": ["native", "ui"]
        }))
        .expect("task create should parse");
        let created =
            apply_planning_task_create(&db_path, &create_request).expect("task create should work");
        assert_eq!(created.task.project_id, "proj-1");
        assert_eq!(
            created.context.settings.selected_task_id.as_deref(),
            Some(created.task.id.as_str())
        );

        let update_request = parse_planning_task_update_request(&json!({
            "taskId": created.task.id,
            "description": "Wire shell actions to engine commands",
            "dueDate": "2026-04-30",
            "completed": true,
            "order": 0
        }))
        .expect("task update should parse");
        let updated =
            apply_planning_task_update(&db_path, &update_request).expect("task update should work");
        assert_eq!(
            updated.task.description,
            "Wire shell actions to engine commands"
        );
        assert_eq!(updated.task.due_date.as_deref(), Some("2026-04-30"));
        assert!(updated.task.completed);
        assert_eq!(updated.task.order, 0);

        let delete_request = parse_planning_task_delete_request(&json!({
            "taskId": updated.task.id
        }))
        .expect("task delete should parse");
        let deleted =
            apply_planning_task_delete(&db_path, &delete_request).expect("task delete should work");
        assert!(deleted.deleted);
        assert_eq!(
            deleted.context.settings.selected_project_id.as_deref(),
            Some("proj-1")
        );
        assert_eq!(
            deleted.context.settings.selected_task_id.as_deref(),
            Some("task-1")
        );

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        assert_eq!(snapshot.counts.task_count, 3);
        assert_eq!(snapshot.activity_log[0].action, "deleted");
        assert_eq!(snapshot.activity_log[1].action, "updated");
        assert_eq!(snapshot.activity_log[2].action, "created");
    }

    #[test]
    fn planning_task_checklist_add_update_and_delete_round_trip() {
        let test_dir = TestDir::new("planning-task-checklist");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let add_request = parse_planning_task_checklist_add_request(&json!({
            "taskId": "task-2",
            "text": "Review final copy"
        }))
        .expect("checklist add should parse");
        let added = apply_planning_task_checklist_add(&db_path, &add_request)
            .expect("checklist add should work");
        assert_eq!(added.task.id, "task-2");
        assert_eq!(added.task.checklist.len(), 1);
        let checklist_item_id = added.task.checklist[0].id.clone();

        let update_request = parse_planning_task_checklist_update_request(&json!({
            "taskId": "task-2",
            "itemId": checklist_item_id,
            "done": true
        }))
        .expect("checklist update should parse");
        let updated = apply_planning_task_checklist_update(&db_path, &update_request)
            .expect("checklist update should work");
        assert!(updated.task.checklist[0].done);

        let delete_request = parse_planning_task_checklist_delete_request(&json!({
            "taskId": "task-2",
            "itemId": checklist_item_id
        }))
        .expect("checklist delete should parse");
        let deleted = apply_planning_task_checklist_delete(&db_path, &delete_request)
            .expect("checklist delete should work");
        assert!(deleted.task.checklist.is_empty());

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        let task = snapshot
            .tasks
            .iter()
            .find(|task| task.id == "task-2")
            .expect("task should exist");
        assert!(task.checklist.is_empty());
        assert_eq!(snapshot.activity_log[0].action, "checklist_removed");
        assert_eq!(snapshot.activity_log[1].action, "checklist_updated");
        assert_eq!(snapshot.activity_log[2].action, "checklist_added");
    }

    #[test]
    fn planning_task_reschedule_persists_both_fields() {
        let test_dir = TestDir::new("planning-task-reschedule-set");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let request = parse_planning_task_reschedule_request(&json!({
            "taskId": "task-1",
            "scheduledStart": "2026-04-21T19:30:00Z",
            "scheduledDurationSeconds": 1800
        }))
        .expect("reschedule should parse");
        let result = apply_planning_task_reschedule(&db_path, &request)
            .expect("reschedule should apply");

        assert_eq!(
            result.task.scheduled_start.as_deref(),
            Some("2026-04-21T19:30:00Z")
        );
        assert_eq!(result.task.scheduled_duration_seconds, Some(1800));

        let planning_settings = list_settings_by_prefix(&db_path, PLANNING_SETTINGS_PREFIX)
            .expect("planning settings should load");
        let snapshot =
            read_planning_snapshot(&db_path, &planning_settings).expect("snapshot should load");
        assert_eq!(snapshot.activity_log[0].action, "rescheduled");
    }

    #[test]
    fn planning_task_reschedule_clears_both_fields() {
        let test_dir = TestDir::new("planning-task-reschedule-clear");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let set = parse_planning_task_reschedule_request(&json!({
            "taskId": "task-1",
            "scheduledStart": "2026-04-21T19:30:00Z",
            "scheduledDurationSeconds": 1800
        }))
        .expect("reschedule should parse");
        apply_planning_task_reschedule(&db_path, &set).expect("initial set should apply");

        let clear = parse_planning_task_reschedule_request(&json!({
            "taskId": "task-1",
            "scheduledStart": Value::Null,
            "scheduledDurationSeconds": Value::Null
        }))
        .expect("clear should parse");
        let cleared = apply_planning_task_reschedule(&db_path, &clear)
            .expect("clear should apply");

        assert!(cleared.task.scheduled_start.is_none());
        assert!(cleared.task.scheduled_duration_seconds.is_none());
    }

    #[test]
    fn planning_task_reschedule_leaves_unspecified_fields_untouched() {
        let test_dir = TestDir::new("planning-task-reschedule-partial");
        let db_path = test_dir.path().join("native.sqlite3");
        let source_path = test_dir.path().join("legacy-db.json");
        seed_planning_state(&db_path, &source_path);

        let set = parse_planning_task_reschedule_request(&json!({
            "taskId": "task-1",
            "scheduledStart": "2026-04-21T19:30:00Z",
            "scheduledDurationSeconds": 1800
        }))
        .expect("reschedule should parse");
        apply_planning_task_reschedule(&db_path, &set).expect("initial set should apply");

        let partial = parse_planning_task_reschedule_request(&json!({
            "taskId": "task-1",
            "scheduledStart": "2026-04-21T20:00:00Z"
        }))
        .expect("partial reschedule should parse");
        let updated = apply_planning_task_reschedule(&db_path, &partial)
            .expect("partial reschedule should apply");

        assert_eq!(
            updated.task.scheduled_start.as_deref(),
            Some("2026-04-21T20:00:00Z")
        );
        assert_eq!(updated.task.scheduled_duration_seconds, Some(1800));
    }
}
