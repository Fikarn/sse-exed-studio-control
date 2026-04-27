use std::collections::HashMap;
use std::path::Path;

use crate::planning_settings::PLANNING_SETTINGS_PREFIX;
use crate::storage::{list_settings_by_prefix, open_connection, EngineResult};

use super::reads::*;
use super::types::*;

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

pub(super) fn build_planning_context(snapshot: PlanningSnapshot) -> PlanningContextSnapshot {
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
