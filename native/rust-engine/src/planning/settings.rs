use std::path::Path;

use crate::planning_settings::{
    DASHBOARD_VIEW_KEY, DECK_MODE_KEY, MODE_SECTION_KEY, PLANNING_SETTINGS_PREFIX,
    SELECTED_PROJECT_ID_KEY, SELECTED_TASK_ID_KEY, SORT_BY_KEY, TIMELINE_END_HOUR_KEY,
    TIMELINE_START_HOUR_KEY, VIEW_FILTER_KEY,
};
use crate::storage::{apply_settings, list_settings_by_prefix};

use super::types::*;
use super::*;

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
