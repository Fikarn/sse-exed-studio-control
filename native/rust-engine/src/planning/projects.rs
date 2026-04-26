use std::path::Path;

use crate::planning_settings::PLANNING_SETTINGS_PREFIX;
use crate::storage::{list_settings_by_prefix, open_connection};

use super::helpers::*;
use super::types::*;

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
