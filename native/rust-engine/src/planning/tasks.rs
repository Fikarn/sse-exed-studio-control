use std::path::Path;

use crate::planning_settings::PLANNING_SETTINGS_PREFIX;
use crate::storage::{list_settings_by_prefix, open_connection};

use super::helpers::*;
use super::types::*;
use super::*;

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
