use std::path::Path;

use crate::planning_settings::{
    PLANNING_SETTINGS_PREFIX, SELECTED_PROJECT_ID_KEY, SELECTED_TASK_ID_KEY,
};
use crate::storage::{apply_settings, list_settings_by_prefix};

use super::helpers::*;
use super::types::*;
use super::*;

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

#[derive(Debug)]
pub(super) struct SelectionState {
    pub(super) project_id: Option<String>,
    pub(super) task_id: Option<String>,
}

pub(super) fn resolve_updated_selection(
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
