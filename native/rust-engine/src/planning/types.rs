use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

use crate::planning_settings::{
    DASHBOARD_VIEW_KEY, DECK_MODE_KEY, DEFAULT_DASHBOARD_VIEW, DEFAULT_DECK_MODE,
    DEFAULT_MODE_SECTION, DEFAULT_SORT_BY, DEFAULT_TIMELINE_END_HOUR, DEFAULT_TIMELINE_START_HOUR,
    DEFAULT_VIEW_FILTER, MODE_SECTION_KEY, PLANNING_SETTINGS_PREFIX, SELECTED_PROJECT_ID_KEY,
    SELECTED_TASK_ID_KEY, SORT_BY_KEY, TIMELINE_END_HOUR_KEY, TIMELINE_START_HOUR_KEY,
    VIEW_FILTER_KEY,
};

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
    pub view_filter: Option<String>,
    pub sort_by: Option<String>,
    pub dashboard_view: Option<String>,
    pub deck_mode: Option<String>,
    pub mode_section: Option<String>,
    pub timeline_start_hour: Option<i64>,
    pub timeline_end_hour: Option<i64>,
    pub selected_project_id: Option<Option<String>>,
    pub selected_task_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Copy)]
pub enum SelectionDirection {
    Next,
    Prev,
}

#[derive(Debug)]
pub enum PlanningSelectionMode {
    ProjectId(String),
    ProjectDirection(SelectionDirection),
    TaskId(String),
    TaskDirection(SelectionDirection),
}

#[derive(Debug)]
pub struct PlanningSelectionRequest {
    pub mode: PlanningSelectionMode,
}

#[derive(Debug)]
pub struct PlanningProjectCreateRequest {
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
}

#[derive(Debug)]
pub struct PlanningProjectUpdateRequest {
    pub project_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub order: Option<i64>,
}

#[derive(Debug)]
pub struct PlanningProjectDeleteRequest {
    pub project_id: String,
}

#[derive(Debug)]
pub struct PlanningProjectReorderRequest {
    pub project_id: String,
    pub new_status: Option<String>,
    pub new_index: Option<i64>,
}

#[derive(Debug)]
pub struct PlanningTaskCreateRequest {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub labels: Vec<String>,
}

#[derive(Debug)]
pub struct PlanningTaskUpdateRequest {
    pub task_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<Option<String>>,
    pub labels: Option<Vec<String>>,
    pub completed: Option<bool>,
    pub order: Option<i64>,
}

#[derive(Debug)]
pub struct PlanningTaskDeleteRequest {
    pub task_id: String,
}

#[derive(Debug)]
pub struct PlanningTaskRescheduleRequest {
    pub task_id: String,
    pub project_id: Option<String>,
    pub scheduled_start: Option<Option<String>>,
    pub scheduled_duration_seconds: Option<Option<i64>>,
}

#[derive(Debug)]
pub struct PlanningTaskChecklistAddRequest {
    pub task_id: String,
    pub text: String,
}

#[derive(Debug)]
pub struct PlanningTaskChecklistUpdateRequest {
    pub task_id: String,
    pub item_id: String,
    pub text: Option<String>,
    pub done: Option<bool>,
}

#[derive(Debug)]
pub struct PlanningTaskChecklistDeleteRequest {
    pub task_id: String,
    pub item_id: String,
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
pub enum TimerAction {
    Start,
    Stop,
    Toggle,
}

#[derive(Debug)]
pub struct PlanningTaskTimerRequest {
    pub task_id: String,
    pub action: TimerAction,
}

#[derive(Debug)]
pub struct PlanningTaskToggleCompleteRequest {
    pub task_id: String,
}

#[derive(Debug)]
pub(super) struct PlanningTaskRow {
    pub(super) id: String,
    pub(super) project_id: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) priority: String,
    pub(super) due_date: Option<String>,
    pub(super) labels: Vec<String>,
    pub(super) is_running: bool,
    pub(super) total_seconds: i64,
    pub(super) last_started: Option<String>,
    pub(super) completed: bool,
    pub(super) order: i64,
    pub(super) created_at: String,
    pub(super) scheduled_start: Option<String>,
    pub(super) scheduled_duration_seconds: Option<i64>,
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
