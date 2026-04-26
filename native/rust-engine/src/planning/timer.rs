use std::path::Path;

use crate::storage::open_connection;

use super::helpers::*;
use super::types::*;

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
