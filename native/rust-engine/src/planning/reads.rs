use std::collections::HashMap;

use crate::storage::EngineResult;

use super::types::*;

pub(super) fn read_projects(
    connection: &rusqlite::Connection,
) -> EngineResult<Vec<PlanningProject>> {
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

pub(super) fn read_checklist_items_by_task(
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

pub(super) fn read_tasks(connection: &rusqlite::Connection) -> EngineResult<Vec<PlanningTaskRow>> {
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

pub(super) fn read_activity_log(
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
