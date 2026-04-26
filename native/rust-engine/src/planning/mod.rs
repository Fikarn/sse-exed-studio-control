use crate::planning_settings::{
    is_valid_dashboard_view, is_valid_deck_mode, is_valid_mode_section, is_valid_sort_by,
    is_valid_timeline_hour, is_valid_view_filter, DASHBOARD_VIEW_KEY, DECK_MODE_KEY,
    DEFAULT_DASHBOARD_VIEW, DEFAULT_DECK_MODE, DEFAULT_MODE_SECTION, DEFAULT_SORT_BY,
    DEFAULT_TIMELINE_END_HOUR, DEFAULT_TIMELINE_START_HOUR, DEFAULT_VIEW_FILTER, MODE_SECTION_KEY,
    PLANNING_SETTINGS_PREFIX, SELECTED_PROJECT_ID_KEY, SELECTED_TASK_ID_KEY, SORT_BY_KEY,
    TIMELINE_END_HOUR_KEY, TIMELINE_START_HOUR_KEY, VIEW_FILTER_KEY,
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PlanningSnapshot {
    pub projects: Vec<PlanningProject>,
    pub tasks: Vec<PlanningTask>,
    #[serde(rename = "activityLog")]
    pub activity_log: Vec<PlanningActivityEntry>,
    pub settings: PlanningSettingsSnapshot,
    pub counts: PlanningCounts,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PlanningChecklistItem {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct PlanningSettingsSnapshot {
    #[serde(rename = "settingsPrefix")]
    #[cfg_attr(feature = "ts-rs", ts(type = "string"))]
    pub settings_prefix: &'static str,
    #[serde(rename = "viewFilter")]
    pub view_filter: String,
    #[serde(rename = "sortBy")]
    pub sort_by: String,
    #[serde(rename = "dashboardView")]
    pub dashboard_view: String,
    #[serde(rename = "deckMode")]
    pub deck_mode: String,
    #[serde(rename = "modeSection")]
    pub mode_section: String,
    #[serde(rename = "timelineStartHour")]
    pub timeline_start_hour: i64,
    #[serde(rename = "timelineEndHour")]
    pub timeline_end_hour: i64,
    #[serde(rename = "selectedProjectId")]
    pub selected_project_id: Option<String>,
    #[serde(rename = "selectedTaskId")]
    pub selected_task_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
    mode_section: Option<String>,
    timeline_start_hour: Option<i64>,
    timeline_end_hour: Option<i64>,
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
    project_id: Option<String>,
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
            mode_section: settings
                .get(MODE_SECTION_KEY)
                .cloned()
                .unwrap_or_else(|| String::from(DEFAULT_MODE_SECTION)),
            timeline_start_hour: settings
                .get(TIMELINE_START_HOUR_KEY)
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or_else(|| DEFAULT_TIMELINE_START_HOUR.parse::<i64>().unwrap_or(9)),
            timeline_end_hour: settings
                .get(TIMELINE_END_HOUR_KEY)
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or_else(|| DEFAULT_TIMELINE_END_HOUR.parse::<i64>().unwrap_or(22)),
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
        mode_section: None,
        timeline_start_hour: None,
        timeline_end_hour: None,
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

    if let Some(value) = params.get("modeSection") {
        let mode_section = value
            .as_str()
            .ok_or_else(|| String::from("modeSection must be a string"))?;
        if !is_valid_mode_section(mode_section) {
            return Err(String::from("modeSection must be one of: timeline, board"));
        }
        request.mode_section = Some(mode_section.to_string());
    }

    if let Some(value) = params.get("timelineStartHour") {
        let hour = value
            .as_i64()
            .ok_or_else(|| String::from("timelineStartHour must be an integer"))?;
        if !is_valid_timeline_hour(hour) {
            return Err(String::from("timelineStartHour must be between 0 and 23"));
        }
        request.timeline_start_hour = Some(hour);
    }

    if let Some(value) = params.get("timelineEndHour") {
        let hour = value
            .as_i64()
            .ok_or_else(|| String::from("timelineEndHour must be an integer"))?;
        if !is_valid_timeline_hour(hour) {
            return Err(String::from("timelineEndHour must be between 0 and 23"));
        }
        request.timeline_end_hour = Some(hour);
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
        && request.mode_section.is_none()
        && request.timeline_start_hour.is_none()
        && request.timeline_end_hour.is_none()
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
    if let Some(mode_section) = &request.mode_section {
        updates.push((MODE_SECTION_KEY, mode_section.clone()));
    }
    if let Some(hour) = request.timeline_start_hour {
        updates.push((TIMELINE_START_HOUR_KEY, hour.to_string()));
    }
    if let Some(hour) = request.timeline_end_hour {
        updates.push((TIMELINE_END_HOUR_KEY, hour.to_string()));
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
    let project_id = parse_optional_string_field(params, "projectId")?;

    let scheduled_start = if params.get("scheduledStart").is_some() {
        Some(parse_optional_nullable_string_field(
            params,
            "scheduledStart",
        )?)
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

    if project_id.is_none() && scheduled_start.is_none() && scheduled_duration_seconds.is_none() {
        return Err(String::from(
            "planning.task.reschedule requires projectId, scheduledStart, or scheduledDurationSeconds",
        ));
    }

    Ok(PlanningTaskRescheduleRequest {
        task_id,
        project_id,
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
    let next_project_id = request
        .project_id
        .clone()
        .unwrap_or_else(|| task.project_id.clone());
    let moved_across_projects = next_project_id != task.project_id;

    if moved_across_projects {
        assert_project_exists_in_transaction(&transaction, &next_project_id)?;
    }

    let next_scheduled_start = match &request.scheduled_start {
        Some(value) => value.clone(),
        None => task.scheduled_start.clone(),
    };
    let next_scheduled_duration = match request.scheduled_duration_seconds {
        Some(value) => value,
        None => task.scheduled_duration_seconds,
    };
    let next_order = if moved_across_projects {
        next_task_sort_order_for_project(&transaction, &next_project_id)?
    } else {
        task.order
    };

    transaction
        .execute(
            "UPDATE tasks
             SET project_id = ?2,
                 scheduled_start = ?3,
                 scheduled_duration_seconds = ?4,
                 sort_order = ?5
             WHERE id = ?1",
            rusqlite::params![
                request.task_id,
                next_project_id,
                next_scheduled_start,
                next_scheduled_duration,
                next_order,
            ],
        )
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;

    if moved_across_projects {
        let source_task_ids = ordered_task_ids_for_project_in_transaction(
            &transaction,
            &task.project_id,
            Some(&request.task_id),
        )?;
        for (order, ordered_task_id) in source_task_ids.iter().enumerate() {
            transaction
                .execute(
                    "UPDATE tasks SET sort_order = ?2 WHERE id = ?1",
                    rusqlite::params![ordered_task_id, order as i64],
                )
                .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
        }
    }

    let mut changes: Vec<&'static str> = Vec::new();
    if request.project_id.is_some() {
        changes.push("projectId");
    }
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

    let context = if moved_across_projects {
        update_selection_after_mutation(
            db_path,
            Some(Some(next_project_id.clone())),
            Some(Some(request.task_id.clone())),
        )?
    } else {
        read_planning_context_with_current_settings(db_path)?
    };
    let task = read_task_by_id(db_path, &request.task_id)?;
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
        mode_section: None,
        timeline_start_hour: None,
        timeline_end_hour: None,
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

fn parse_optional_nullable_i64_field(params: &Value, name: &str) -> Result<Option<i64>, String> {
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
mod tests;
