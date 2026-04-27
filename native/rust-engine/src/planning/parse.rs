use serde_json::Value;

use crate::planning_settings::{
    is_valid_dashboard_view, is_valid_deck_mode, is_valid_mode_section, is_valid_sort_by,
    is_valid_timeline_hour, is_valid_view_filter,
};

use super::types::*;
use super::*;

pub fn parse_planning_time_report_request(params: &Value) -> Result<Option<String>, String> {
    match params.get("projectId") {
        Some(value) => parse_nullable_string(value, "projectId"),
        None => Ok(None),
    }
}

pub fn parse_planning_settings_update(
    params: &Value,
) -> Result<PlanningSettingsUpdateRequest, String> {
    let mut request = PlanningSettingsUpdateRequest {
        view_filter: None,
        sort_by: None,
        dashboard_view: None,
        deck_mode: None,
        mode_section: None,
        timeline_start_hour: None,
        timeline_end_hour: None,
        selected_project_id: None,
        selected_task_id: None,
    };

    if let Some(value) = params.get("viewFilter") {
        let filter = value
            .as_str()
            .ok_or_else(|| String::from("viewFilter must be a string"))?;
        if !is_valid_view_filter(filter) {
            return Err(String::from(
                "viewFilter must be one of: all, todo, in-progress, blocked, done",
            ));
        }
        request.view_filter = Some(filter.to_string());
    }

    if let Some(value) = params.get("sortBy") {
        let sort_by = value
            .as_str()
            .ok_or_else(|| String::from("sortBy must be a string"))?;
        if !is_valid_sort_by(sort_by) {
            return Err(String::from(
                "sortBy must be one of: manual, priority, date, name",
            ));
        }
        request.sort_by = Some(sort_by.to_string());
    }

    if let Some(value) = params.get("dashboardView") {
        let dashboard_view = value
            .as_str()
            .ok_or_else(|| String::from("dashboardView must be a string"))?;
        if !is_valid_dashboard_view(dashboard_view) {
            return Err(String::from(
                "dashboardView must be one of: kanban, lighting, audio",
            ));
        }
        request.dashboard_view = Some(dashboard_view.to_string());
    }

    if let Some(value) = params.get("deckMode") {
        let deck_mode = value
            .as_str()
            .ok_or_else(|| String::from("deckMode must be a string"))?;
        if !is_valid_deck_mode(deck_mode) {
            return Err(String::from(
                "deckMode must be one of: project, light, audio",
            ));
        }
        request.deck_mode = Some(deck_mode.to_string());
    }

    if let Some(value) = params.get("modeSection") {
        let mode_section = value
            .as_str()
            .ok_or_else(|| String::from("modeSection must be a string"))?;
        if !is_valid_mode_section(mode_section) {
            return Err(String::from("modeSection must be one of: timeline, board"));
        }
        request.mode_section = Some(mode_section.to_string());
    }

    if let Some(value) = params.get("timelineStartHour") {
        let hour = value
            .as_i64()
            .ok_or_else(|| String::from("timelineStartHour must be an integer"))?;
        if !is_valid_timeline_hour(hour) {
            return Err(String::from("timelineStartHour must be between 0 and 23"));
        }
        request.timeline_start_hour = Some(hour);
    }

    if let Some(value) = params.get("timelineEndHour") {
        let hour = value
            .as_i64()
            .ok_or_else(|| String::from("timelineEndHour must be an integer"))?;
        if !is_valid_timeline_hour(hour) {
            return Err(String::from("timelineEndHour must be between 0 and 23"));
        }
        request.timeline_end_hour = Some(hour);
    }

    if let Some(value) = params.get("selectedProjectId") {
        request.selected_project_id = Some(parse_nullable_string(value, "selectedProjectId")?);
    }

    if let Some(value) = params.get("selectedTaskId") {
        request.selected_task_id = Some(parse_nullable_string(value, "selectedTaskId")?);
    }

    if request.view_filter.is_none()
        && request.sort_by.is_none()
        && request.dashboard_view.is_none()
        && request.deck_mode.is_none()
        && request.mode_section.is_none()
        && request.timeline_start_hour.is_none()
        && request.timeline_end_hour.is_none()
        && request.selected_project_id.is_none()
        && request.selected_task_id.is_none()
    {
        return Err(String::from(
            "planning.settings.update requires one or more supported fields",
        ));
    }

    Ok(request)
}

pub fn parse_planning_selection_request(
    params: &Value,
) -> Result<PlanningSelectionRequest, String> {
    let project_id = params
        .get("projectId")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("projectId must be a string"))
                .map(|value| value.to_string())
        })
        .transpose()?;
    let task_id = params
        .get("taskId")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("taskId must be a string"))
                .map(|value| value.to_string())
        })
        .transpose()?;
    let project_direction = params
        .get("projectDirection")
        .map(|value| parse_selection_direction(value, "projectDirection"))
        .transpose()?;
    let task_direction = params
        .get("taskDirection")
        .map(|value| parse_selection_direction(value, "taskDirection"))
        .transpose()?;

    let selection_mode = [
        project_id.is_some(),
        task_id.is_some(),
        project_direction.is_some(),
        task_direction.is_some(),
    ]
    .into_iter()
    .filter(|value| *value)
    .count();

    if selection_mode != 1 {
        return Err(String::from(
            "planning.select requires exactly one of: projectId, taskId, projectDirection, taskDirection",
        ));
    }

    let mode = if let Some(project_id) = project_id {
        PlanningSelectionMode::ProjectId(project_id)
    } else if let Some(task_id) = task_id {
        PlanningSelectionMode::TaskId(task_id)
    } else if let Some(direction) = project_direction {
        PlanningSelectionMode::ProjectDirection(direction)
    } else {
        PlanningSelectionMode::TaskDirection(
            task_direction.expect("taskDirection should be present"),
        )
    };

    Ok(PlanningSelectionRequest { mode })
}

pub fn parse_planning_project_create_request(
    params: &Value,
) -> Result<PlanningProjectCreateRequest, String> {
    let title = parse_required_title(params, "title")?;
    let description = parse_optional_string_field(params, "description")?.unwrap_or_default();
    let status =
        parse_optional_string_field(params, "status")?.unwrap_or_else(|| String::from("todo"));
    if !is_valid_project_status(&status) {
        return Err(format!(
            "status must be one of: {}",
            VALID_PROJECT_STATUSES.join(", ")
        ));
    }

    let priority =
        parse_optional_string_field(params, "priority")?.unwrap_or_else(|| String::from("p2"));
    if !is_valid_priority(&priority) {
        return Err(format!(
            "priority must be one of: {}",
            VALID_PRIORITIES.join(", ")
        ));
    }

    Ok(PlanningProjectCreateRequest {
        title,
        description,
        status,
        priority,
    })
}

pub fn parse_planning_project_update_request(
    params: &Value,
) -> Result<PlanningProjectUpdateRequest, String> {
    let project_id = parse_required_string_field(params, "projectId")?;
    let title = parse_optional_string_field(params, "title")?;
    if title.as_deref() == Some("") {
        return Err(String::from("title must not be empty"));
    }

    let description = parse_optional_string_field(params, "description")?;
    let priority = parse_optional_string_field(params, "priority")?;
    if let Some(priority) = priority.as_deref() {
        if !is_valid_priority(priority) {
            return Err(format!(
                "priority must be one of: {}",
                VALID_PRIORITIES.join(", ")
            ));
        }
    }

    let order = parse_optional_i64_field(params, "order")?;

    if title.is_none() && description.is_none() && priority.is_none() && order.is_none() {
        return Err(String::from(
            "planning.project.update requires one or more supported fields",
        ));
    }

    Ok(PlanningProjectUpdateRequest {
        project_id,
        title,
        description,
        priority,
        order,
    })
}

pub fn parse_planning_project_delete_request(
    params: &Value,
) -> Result<PlanningProjectDeleteRequest, String> {
    Ok(PlanningProjectDeleteRequest {
        project_id: parse_required_string_field(params, "projectId")?,
    })
}

pub fn parse_planning_project_reorder_request(
    params: &Value,
) -> Result<PlanningProjectReorderRequest, String> {
    let project_id = parse_required_string_field(params, "projectId")?;
    let new_status = parse_optional_string_field(params, "newStatus")?;
    if let Some(status) = new_status.as_deref() {
        if !is_valid_project_status(status) {
            return Err(format!(
                "newStatus must be one of: {}",
                VALID_PROJECT_STATUSES.join(", ")
            ));
        }
    }
    let new_index = parse_optional_i64_field(params, "newIndex")?;

    Ok(PlanningProjectReorderRequest {
        project_id,
        new_status,
        new_index,
    })
}

pub fn parse_planning_task_create_request(
    params: &Value,
) -> Result<PlanningTaskCreateRequest, String> {
    let project_id = parse_required_string_field(params, "projectId")?;
    let title = parse_required_title(params, "title")?;
    let description = parse_optional_string_field(params, "description")?.unwrap_or_default();
    let priority =
        parse_optional_string_field(params, "priority")?.unwrap_or_else(|| String::from("p2"));
    if !is_valid_priority(&priority) {
        return Err(format!(
            "priority must be one of: {}",
            VALID_PRIORITIES.join(", ")
        ));
    }

    Ok(PlanningTaskCreateRequest {
        project_id,
        title,
        description,
        priority,
        due_date: parse_optional_nullable_string_field(params, "dueDate")?,
        labels: parse_optional_string_array_field(params, "labels")?.unwrap_or_default(),
    })
}

pub fn parse_planning_task_update_request(
    params: &Value,
) -> Result<PlanningTaskUpdateRequest, String> {
    let task_id = parse_required_string_field(params, "taskId")?;
    let title = parse_optional_string_field(params, "title")?;
    if title.as_deref() == Some("") {
        return Err(String::from("title must not be empty"));
    }

    let description = parse_optional_string_field(params, "description")?;
    let priority = parse_optional_string_field(params, "priority")?;
    if let Some(priority) = priority.as_deref() {
        if !is_valid_priority(priority) {
            return Err(format!(
                "priority must be one of: {}",
                VALID_PRIORITIES.join(", ")
            ));
        }
    }

    let due_date = if params.get("dueDate").is_some() {
        Some(parse_optional_nullable_string_field(params, "dueDate")?)
    } else {
        None
    };
    let labels = parse_optional_string_array_field(params, "labels")?;
    let completed = parse_optional_bool_field(params, "completed")?;
    let order = parse_optional_i64_field(params, "order")?;

    if title.is_none()
        && description.is_none()
        && priority.is_none()
        && due_date.is_none()
        && labels.is_none()
        && completed.is_none()
        && order.is_none()
    {
        return Err(String::from(
            "planning.task.update requires one or more supported fields",
        ));
    }

    Ok(PlanningTaskUpdateRequest {
        task_id,
        title,
        description,
        priority,
        due_date,
        labels,
        completed,
        order,
    })
}

pub fn parse_planning_task_delete_request(
    params: &Value,
) -> Result<PlanningTaskDeleteRequest, String> {
    Ok(PlanningTaskDeleteRequest {
        task_id: parse_required_string_field(params, "taskId")?,
    })
}

pub fn parse_planning_task_reschedule_request(
    params: &Value,
) -> Result<PlanningTaskRescheduleRequest, String> {
    let task_id = parse_required_string_field(params, "taskId")?;
    let project_id = parse_optional_string_field(params, "projectId")?;

    let scheduled_start = if params.get("scheduledStart").is_some() {
        Some(parse_optional_nullable_string_field(
            params,
            "scheduledStart",
        )?)
    } else {
        None
    };
    let scheduled_duration_seconds = if params.get("scheduledDurationSeconds").is_some() {
        Some(parse_optional_nullable_i64_field(
            params,
            "scheduledDurationSeconds",
        )?)
    } else {
        None
    };

    if let Some(Some(seconds)) = scheduled_duration_seconds {
        if seconds < 0 {
            return Err(String::from(
                "scheduledDurationSeconds must be non-negative",
            ));
        }
    }

    if project_id.is_none() && scheduled_start.is_none() && scheduled_duration_seconds.is_none() {
        return Err(String::from(
            "planning.task.reschedule requires projectId, scheduledStart, or scheduledDurationSeconds",
        ));
    }

    Ok(PlanningTaskRescheduleRequest {
        task_id,
        project_id,
        scheduled_start,
        scheduled_duration_seconds,
    })
}

pub fn parse_planning_task_checklist_add_request(
    params: &Value,
) -> Result<PlanningTaskChecklistAddRequest, String> {
    Ok(PlanningTaskChecklistAddRequest {
        task_id: parse_required_string_field(params, "taskId")?,
        text: parse_required_title(params, "text")?,
    })
}

pub fn parse_planning_task_checklist_update_request(
    params: &Value,
) -> Result<PlanningTaskChecklistUpdateRequest, String> {
    let task_id = parse_required_string_field(params, "taskId")?;
    let item_id = parse_required_string_field(params, "itemId")?;
    let text = parse_optional_string_field(params, "text")?;
    if text.as_deref() == Some("") {
        return Err(String::from("text must not be empty"));
    }
    let done = parse_optional_bool_field(params, "done")?;

    if text.is_none() && done.is_none() {
        return Err(String::from(
            "planning.task.checklist.update requires one or more supported fields",
        ));
    }

    Ok(PlanningTaskChecklistUpdateRequest {
        task_id,
        item_id,
        text,
        done,
    })
}

pub fn parse_planning_task_checklist_delete_request(
    params: &Value,
) -> Result<PlanningTaskChecklistDeleteRequest, String> {
    Ok(PlanningTaskChecklistDeleteRequest {
        task_id: parse_required_string_field(params, "taskId")?,
        item_id: parse_required_string_field(params, "itemId")?,
    })
}

pub fn parse_planning_task_timer_request(
    params: &Value,
) -> Result<PlanningTaskTimerRequest, String> {
    let task_id = params
        .get("taskId")
        .and_then(Value::as_str)
        .ok_or_else(|| String::from("taskId is required and must be a string"))?
        .to_string();
    let action = params
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| String::from("action is required and must be a string"))?;

    let action = match action {
        "start" => TimerAction::Start,
        "stop" => TimerAction::Stop,
        "toggle" => TimerAction::Toggle,
        _ => {
            return Err(String::from("action must be one of: start, stop, toggle"));
        }
    };

    Ok(PlanningTaskTimerRequest { task_id, action })
}

pub fn parse_planning_task_toggle_complete_request(
    params: &Value,
) -> Result<PlanningTaskToggleCompleteRequest, String> {
    let task_id = params
        .get("taskId")
        .and_then(Value::as_str)
        .ok_or_else(|| String::from("taskId is required and must be a string"))?
        .to_string();

    Ok(PlanningTaskToggleCompleteRequest { task_id })
}

pub(super) fn parse_required_title(params: &Value, name: &str) -> Result<String, String> {
    let title = parse_required_string_field(params, name)?;
    if title.is_empty() {
        return Err(format!("{name} must not be empty"));
    }

    Ok(title)
}

pub(super) fn parse_required_string_field(params: &Value, name: &str) -> Result<String, String> {
    params
        .get(name)
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .ok_or_else(|| format!("{name} is required and must be a string"))
}

pub(super) fn parse_optional_string_field(
    params: &Value,
    name: &str,
) -> Result<Option<String>, String> {
    params
        .get(name)
        .map(|value| {
            value
                .as_str()
                .map(|value| value.trim().to_string())
                .ok_or_else(|| format!("{name} must be a string"))
        })
        .transpose()
}

pub(super) fn parse_optional_nullable_string_field(
    params: &Value,
    name: &str,
) -> Result<Option<String>, String> {
    match params.get(name) {
        Some(value) if value.is_null() => Ok(None),
        Some(value) => value
            .as_str()
            .map(|value| Some(value.to_string()))
            .ok_or_else(|| format!("{name} must be a string or null")),
        None => Ok(None),
    }
}

pub(super) fn parse_optional_i64_field(params: &Value, name: &str) -> Result<Option<i64>, String> {
    params
        .get(name)
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| format!("{name} must be an integer"))
        })
        .transpose()
}

pub(super) fn parse_optional_nullable_i64_field(
    params: &Value,
    name: &str,
) -> Result<Option<i64>, String> {
    match params.get(name) {
        Some(value) if value.is_null() => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("{name} must be an integer or null")),
        None => Ok(None),
    }
}

pub(super) fn parse_optional_bool_field(
    params: &Value,
    name: &str,
) -> Result<Option<bool>, String> {
    params
        .get(name)
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| format!("{name} must be a boolean"))
        })
        .transpose()
}

pub(super) fn parse_optional_string_array_field(
    params: &Value,
    name: &str,
) -> Result<Option<Vec<String>>, String> {
    params
        .get(name)
        .map(|value| {
            let values = value
                .as_array()
                .ok_or_else(|| format!("{name} must be an array of strings"))?;
            values
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(|value| value.trim().to_string())
                        .ok_or_else(|| format!("{name} must be an array of strings"))
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
}

pub(super) fn parse_nullable_string(value: &Value, name: &str) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }

    value
        .as_str()
        .map(|value| Some(value.to_string()))
        .ok_or_else(|| format!("{name} must be a string or null"))
}

pub(super) fn is_valid_project_status(value: &str) -> bool {
    VALID_PROJECT_STATUSES.contains(&value)
}

pub(super) fn is_valid_priority(value: &str) -> bool {
    VALID_PRIORITIES.contains(&value)
}

pub(super) fn clamped_index(new_index: Option<i64>, len: usize) -> usize {
    match new_index {
        Some(value) if value <= 0 => 0,
        Some(value) => (value as usize).min(len),
        None => len,
    }
}

pub(super) fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

pub(super) fn parse_selection_direction(
    value: &Value,
    name: &str,
) -> Result<SelectionDirection, String> {
    let value = value
        .as_str()
        .ok_or_else(|| format!("{name} must be a string"))?;

    match value {
        "next" => Ok(SelectionDirection::Next),
        "prev" => Ok(SelectionDirection::Prev),
        _ => Err(format!("{name} must be one of: next, prev")),
    }
}

pub(super) fn cycle_string(
    values: &[String],
    current: Option<&str>,
    direction: SelectionDirection,
) -> Option<String> {
    if values.is_empty() {
        return None;
    }

    let next_index = match values
        .iter()
        .position(|value| Some(value.as_str()) == current)
    {
        Some(index) => match direction {
            SelectionDirection::Next => (index + 1) % values.len(),
            SelectionDirection::Prev => (index + values.len() - 1) % values.len(),
        },
        None => 0,
    };

    values.get(next_index).cloned()
}
