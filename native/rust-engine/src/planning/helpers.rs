use std::path::Path;

use crate::planning_settings::PLANNING_SETTINGS_PREFIX;
use crate::storage::{list_settings_by_prefix, open_connection};

use super::types::*;
use super::*;

pub(super) fn read_task_and_context(
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

pub(super) fn read_project_and_context(
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

pub(super) fn read_task_by_id(
    db_path: &Path,
    task_id: &str,
) -> Result<PlanningTask, PlanningCommandError> {
    let (task, _) = read_task_and_context(db_path, task_id)?;
    Ok(task)
}

pub(super) fn read_project_by_id(
    db_path: &Path,
    project_id: &str,
) -> Result<PlanningProject, PlanningCommandError> {
    let (project, _) = read_project_and_context(db_path, project_id)?;
    Ok(project)
}

pub(super) fn read_planning_context_with_current_settings(
    db_path: &Path,
) -> Result<PlanningContextSnapshot, PlanningCommandError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))?;
    read_planning_context(db_path, &planning_settings)
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

pub(super) fn update_selection_after_mutation(
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

pub(super) fn load_project_row(
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

pub(super) fn load_task_row(
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

pub(super) fn load_checklist_item_row(
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

pub(super) fn resolve_timer_action(action: TimerAction, is_running: bool) -> TimerAction {
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

pub(super) fn current_timestamp(
    connection: &rusqlite::Connection,
) -> Result<String, PlanningCommandError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| PlanningCommandError::Storage(error.to_string()))
}

pub(super) fn elapsed_seconds_between(
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

pub(super) fn append_activity_entry(
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

pub(super) fn prune_activity_log(
    transaction: &rusqlite::Transaction<'_>,
) -> Result<(), PlanningCommandError> {
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

pub(super) fn next_project_sort_order_for_status(
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

pub(super) fn next_task_sort_order_for_project(
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

pub(super) fn next_checklist_sort_order_for_task(
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

pub(super) fn reorder_project_in_transaction(
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

pub(super) fn reorder_task_in_transaction(
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

pub(super) fn generate_entry_id(prefix: &str) -> String {
    generate_runtime_id(prefix)
}

pub(super) fn generate_runtime_id(prefix: &str) -> String {
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

pub(super) fn ordered_project_ids(db_path: &Path) -> Result<Vec<String>, PlanningCommandError> {
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

pub(super) fn ordered_project_ids_by_status_in_transaction(
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

pub(super) fn ordered_task_ids_for_project(
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

pub(super) fn ordered_task_ids_for_project_in_transaction(
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

pub(super) fn first_task_id_for_project(
    db_path: &Path,
    project_id: &str,
) -> Result<Option<String>, PlanningCommandError> {
    Ok(ordered_task_ids_for_project(db_path, project_id)?
        .into_iter()
        .next())
}

pub(super) fn assert_project_exists(
    db_path: &Path,
    project_id: &str,
) -> Result<String, PlanningCommandError> {
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

pub(super) fn assert_project_exists_in_transaction(
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

pub(super) fn project_id_for_task(
    db_path: &Path,
    task_id: &str,
) -> Result<String, PlanningCommandError> {
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
