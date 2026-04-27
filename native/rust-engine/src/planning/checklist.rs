use std::path::Path;

use crate::storage::open_connection;

use super::helpers::*;
use super::types::*;
use super::*;

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
