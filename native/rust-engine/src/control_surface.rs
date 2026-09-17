use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::read_audio_snapshot;
use crate::bootstrap::RuntimeContext;
use crate::control_surface_audio::{
    audio_deck_bank, audio_deck_dial_mode, audio_deck_gate_label, audio_key_lcd_text,
    audio_state_value_text, audio_strip_key_index, audio_strip_lcd_text, audio_strip_level_text,
    audio_strip_state_text, current_audio_snapshot, handle_audio_action, resolve_audio_deck_strip,
    AudioDeckStrip,
};
use crate::lighting::{
    create_lighting_scene_with_preview, delete_lighting_scene, load_lighting_editor_state,
    lock_shared_lighting_preview, parse_lighting_all_power_request,
    parse_lighting_fixture_update_request, parse_lighting_scene_create_request,
    parse_lighting_scene_delete_request, parse_lighting_scene_recall_request,
    read_lighting_fixture_levels, recall_lighting_scene_with_preview,
    set_lighting_all_power_with_preview, update_lighting_fixture_with_preview,
    with_lighting_state_and_preview, LightingCommandError, LightingEditorState,
    LightingFixtureLevels, LightingPreviewRuntimeState,
};
use crate::planning::{
    apply_planning_project_create, apply_planning_project_delete, apply_planning_project_reorder,
    apply_planning_project_update, apply_planning_selection, apply_planning_task_timer,
    apply_planning_task_toggle_complete, parse_planning_project_create_request,
    parse_planning_project_delete_request, parse_planning_project_reorder_request,
    parse_planning_project_update_request, parse_planning_selection_request,
    parse_planning_settings_update, parse_planning_task_timer_request,
    parse_planning_task_toggle_complete_request, read_planning_context, update_planning_settings,
    PlanningCommandError, PlanningContextSnapshot,
};
use crate::planning_settings::{PLANNING_SETTINGS_PREFIX, SORT_BY_KEY};
use crate::shell_settings::{DEFAULT_WORKSPACE, SHELL_SETTINGS_PREFIX, WORKSPACE_KEY};
use crate::storage::{
    list_settings_by_prefix, open_connection, set_settings_owned, set_settings_owned_and,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::Sender;

pub const DEFAULT_CONTROL_SURFACE_HOST: &str = "127.0.0.1";
pub const DEFAULT_CONTROL_SURFACE_PORT: u16 = 38201;

const SELECTED_LIGHT_ID_KEY: &str = "app.control_surface.selected_light_id";
const SELECTED_SCENE_ID_KEY: &str = "app.control_surface.selected_scene_id";
const LAST_EVENT_KEY: &str = "app.control_surface.last_event";

const PROJECT_STATUS_CYCLE: &[&str] = &["todo", "in-progress", "blocked", "done"];
const PROJECT_PRIORITY_CYCLE: &[&str] = &["p0", "p1", "p2", "p3"];
const SORT_CYCLE: &[&str] = &["manual", "priority", "date", "name"];

#[derive(Debug, Clone, Serialize)]
pub struct ControlSurfaceBridgeInfo {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub port: u16,
    pub available: bool,
    pub status: String,
    pub summary: String,
    pub error: Option<String>,
}

#[derive(Debug)]
pub enum ControlSurfaceError {
    InvalidParams(String),
    Unsupported(String),
    Rejected(String),
    Storage(String),
    /// Missing or wrong bearer token (401) — `control_surface_http`.
    Unauthorized(String),
    /// A browser origin presented itself (403).
    Forbidden(String),
    /// The request did not arrive within the deadline (408).
    Timeout(String),
    /// A body without a usable `Content-Length` (411).
    LengthRequired(String),
    /// The declared body exceeds the cap (413).
    TooLarge(String),
    /// The headers exceed the cap (431).
    HeadersTooLarge(String),
    /// The worker queue is full (503).
    Busy(String),
}

impl ControlSurfaceError {
    pub(crate) fn status_code(&self) -> u16 {
        match self {
            Self::InvalidParams(_) => 400,
            Self::Unauthorized(_) => 401,
            Self::Forbidden(_) => 403,
            Self::Timeout(_) => 408,
            Self::Rejected(_) => 409,
            Self::LengthRequired(_) => 411,
            Self::TooLarge(_) => 413,
            Self::HeadersTooLarge(_) => 431,
            Self::Storage(_) => 500,
            Self::Unsupported(_) => 501,
            Self::Busy(_) => 503,
        }
    }

    pub(crate) fn message(&self) -> &str {
        match self {
            Self::InvalidParams(message)
            | Self::Unsupported(message)
            | Self::Rejected(message)
            | Self::Storage(message)
            | Self::Unauthorized(message)
            | Self::Forbidden(message)
            | Self::Timeout(message)
            | Self::LengthRequired(message)
            | Self::TooLarge(message)
            | Self::HeadersTooLarge(message)
            | Self::Busy(message) => message,
        }
    }
}

pub fn resolve_control_surface_port() -> u16 {
    std::env::var("SSE_CONTROL_SURFACE_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_CONTROL_SURFACE_PORT)
}

/// The bridge shares the engine-wide out-of-band event sender
/// (`engine_events`) with the console link; kept under its historical name
/// for the startup wiring in `main.rs`.
pub fn register_control_surface_event_sender(sender: Sender<Value>) {
    crate::engine_events::register_engine_event_sender(sender);
}

pub(crate) fn emit_audio_changed() {
    crate::engine_events::emit_audio_changed("control-surface");
}

// The listener, the bearer token, the request limits and the worker pool live
// in `control_surface_http`; this module owns what a request does.

pub fn read_control_surface_context(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let context = read_planning_context(db_path, &planning_settings)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let (app_settings, audio_snapshot) = current_audio_snapshot(db_path)?;
    let bank = audio_deck_bank(&app_settings);
    let strips = (1..=4)
        .map(
            |strip_index| match resolve_audio_deck_strip(&audio_snapshot, &bank, strip_index) {
                Ok(AudioDeckStrip::Channel(channel)) => json!({
                    "position": strip_index,
                    "kind": "channel",
                    "id": channel.id,
                    "name": channel.name,
                }),
                Ok(AudioDeckStrip::MixTarget(target)) => json!({
                    "position": strip_index,
                    "kind": "mixTarget",
                    "id": target.id,
                    "name": target.name,
                }),
                Err(_) => json!({
                    "position": strip_index,
                    "kind": "empty",
                    "id": Value::Null,
                    "name": Value::Null,
                }),
            },
        )
        .collect::<Vec<_>>();

    Ok(json!({
        "workspace": read_active_workspace(db_path)?,
        "audio": {
            "status": audio_snapshot.status,
            "gated": audio_deck_gate_label(&audio_snapshot).is_some(),
            "bank": bank,
            "dialMode": audio_deck_dial_mode(&app_settings),
            "selectedMixTargetId": audio_snapshot.selected_mix_target_id,
            "selectedChannelId": audio_snapshot.selected_channel_id,
            "strips": strips,
        },
        "selectedProject": context.selected_project,
        "projectIndex": context.project_index,
        "projectCount": context.project_count,
        "selectedTaskId": context.selected_task_id,
        "selectedTask": context.selected_task,
        "taskIndex": context.task_index,
        "tasks": context.tasks,
        "taskCount": context.task_count,
        "runningTask": context.running_task,
        "viewFilter": context.settings.view_filter,
        "sortBy": context.settings.sort_by,
    }))
}

pub fn read_control_surface_lcd_text(
    db_path: &Path,
    key: &str,
) -> Result<String, ControlSurfaceError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let context = read_planning_context(db_path, &planning_settings)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let audio_snapshot = read_audio_snapshot(&app_settings);
    let lighting_state = load_lighting_editor_state(&app_settings);

    match key {
        "project_nav" => {
            if let Some(project) = &context.selected_project {
                Ok(format!(
                    "PROJECT\\n{}\\n{}/{}",
                    truncate(&project.title, 12),
                    context.project_index + 1,
                    context.project_count
                ))
            } else {
                Ok(String::from("PROJECT\\n(none)\\n--"))
            }
        }
        "project_status" => {
            if let Some(project) = &context.selected_project {
                Ok(format!("STATUS\\n{}", status_label(&project.status)))
            } else {
                Ok(String::from("STATUS\\n--"))
            }
        }
        "project_priority" => {
            if let Some(project) = &context.selected_project {
                Ok(format!("PRIORITY\\n{}", priority_label(&project.priority)))
            } else {
                Ok(String::from("PRIORITY\\n--"))
            }
        }
        "sort_mode" => Ok(format!("SORT\\n{}", sort_label(&context.settings.sort_by))),
        "task_nav" => {
            if let Some(task) = &context.selected_task {
                Ok(format!(
                    "TASK\\n{}\\n{}/{}",
                    truncate(&task.title, 12),
                    context.task_index + 1,
                    context.task_count
                ))
            } else {
                Ok(String::from("TASK\\n(none)\\n--"))
            }
        }
        "light_nav" => {
            let selected_light_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_LIGHT_ID_KEY,
                lighting_state
                    .fixtures
                    .iter()
                    .map(|fixture| fixture.id.as_str()),
            );
            if let Some(selected_light_id) = selected_light_id {
                if let Some((index, fixture)) = lighting_state
                    .fixtures
                    .iter()
                    .enumerate()
                    .find(|(_, fixture)| fixture.id == selected_light_id)
                {
                    return Ok(format!(
                        "LIGHT\\n{}\\n{}/{}",
                        truncate(&fixture.name, 12),
                        index + 1,
                        lighting_state.fixtures.len()
                    ));
                }
            }
            Ok(String::from("LIGHT\\n(none)\\n--"))
        }
        "light_intensity" => {
            let selected_light_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_LIGHT_ID_KEY,
                lighting_state
                    .fixtures
                    .iter()
                    .map(|fixture| fixture.id.as_str()),
            );
            if let Some(levels) =
                selected_light_id.and_then(|fixture_id| deck_fixture_levels(db_path, &fixture_id))
            {
                return Ok(format!(
                    "INTENSITY\\n{}%{}",
                    levels.intensity,
                    preview_lcd_line(&levels)
                ));
            }
            Ok(String::from("INTENSITY\\n--"))
        }
        "light_cct" => {
            let selected_light_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_LIGHT_ID_KEY,
                lighting_state
                    .fixtures
                    .iter()
                    .map(|fixture| fixture.id.as_str()),
            );
            if let Some(levels) =
                selected_light_id.and_then(|fixture_id| deck_fixture_levels(db_path, &fixture_id))
            {
                return Ok(format!(
                    "CCT\\n{}K{}",
                    levels.cct,
                    preview_lcd_line(&levels)
                ));
            }
            Ok(String::from("CCT\\n--"))
        }
        "scene_nav" => {
            let selected_scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            );
            if let Some(selected_scene_id) = selected_scene_id {
                if let Some((index, scene)) = lighting_state
                    .scenes
                    .iter()
                    .enumerate()
                    .find(|(_, scene)| scene.id == selected_scene_id)
                {
                    return Ok(format!(
                        "SCENE\\n{}\\n{}/{}",
                        truncate(&scene.name, 12),
                        index + 1,
                        lighting_state.scenes.len()
                    ));
                }
            }
            Ok(String::from("SCENE\\n(none)\\n--"))
        }
        "audio_strip_1" | "audio_strip_2" | "audio_strip_3" | "audio_strip_4" => {
            let strip_index = key
                .rsplit('_')
                .next()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1);
            Ok(audio_strip_lcd_text(
                &app_settings,
                &audio_snapshot,
                strip_index,
            ))
        }
        "audio_key_1" | "audio_key_2" | "audio_key_3" | "audio_key_4" | "audio_key_5"
        | "audio_key_6" | "audio_key_7" | "audio_key_8" => {
            let key_index = key
                .rsplit('_')
                .next()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1);
            Ok(audio_key_lcd_text(
                &app_settings,
                &audio_snapshot,
                key_index,
            ))
        }
        "audio_strip_1_state"
        | "audio_strip_2_state"
        | "audio_strip_3_state"
        | "audio_strip_4_state" => Ok(audio_strip_state_text(
            &app_settings,
            &audio_snapshot,
            audio_strip_key_index(key),
        )),
        "audio_strip_1_level"
        | "audio_strip_2_level"
        | "audio_strip_3_level"
        | "audio_strip_4_level" => Ok(audio_strip_level_text(
            &app_settings,
            &audio_snapshot,
            audio_strip_key_index(key),
        )),
        "audio_state_target" | "audio_state_bank" | "audio_state_mode" | "audio_state_dim"
        | "audio_state_talk" | "audio_state_solo" | "audio_state_gated" => audio_state_value_text(
            &app_settings,
            &audio_snapshot,
            key.trim_start_matches("audio_state_"),
        ),
        "workspace" => read_active_workspace(db_path),
        _ => Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported LCD key: {key}"
        ))),
    }
}

fn read_active_workspace(db_path: &Path) -> Result<String, ControlSurfaceError> {
    let shell_settings = list_settings_by_prefix(db_path, SHELL_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    Ok(shell_settings
        .get(WORKSPACE_KEY)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| String::from(DEFAULT_WORKSPACE)))
}

// Mirrors the operator app's fader curve (normalizedToFaderDb in
// frontend/app/src/app/audio/audioFormatting.ts) — the deck and the screen
// must always print the same dB number for the same wire value.
pub fn handle_control_surface_http_action(
    db_path: &Path,
    path: &str,
    body: &Value,
) -> Result<Value, ControlSurfaceError> {
    let action = body
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("action is required")))?;
    let value = body.get("value").and_then(Value::as_str);

    let response = match path {
        "/api/deck/action" => handle_planning_action(db_path, action, value),
        "/api/deck/light-action" => handle_light_action(db_path, action, value),
        "/api/deck/audio-action" => handle_audio_action(db_path, action, value),
        _ => Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported action route: {path}"
        ))),
    };
    if let Ok(reply) = &response {
        // The action log (Slice 11 — F30): every key through the bridge is
        // the Stream Deck's, so this is where a row gets the source `deck`.
        // The reply says what the key did and whether it was staged in the
        // preview; the row rides the transaction that stamps the last
        // event, so a key waits for the disk no more often than before.
        let actions = crate::action_log::deck_actions(path, action, reply);
        if let Err(error) = stamp_control_surface_last_event(db_path, path, action, value, &actions)
        {
            crate::diagnostics::log_event(
                crate::diagnostics::LogLevel::Warn,
                &format!(
                    "Stream Deck key {action}: the last event and {} action-log row(s) could not be written: {}",
                    actions.len(),
                    error.message()
                ),
            );
        }
        match deck_change_event(path, action) {
            Some(DeckChange::Lighting) => {
                crate::engine_events::emit_lighting_changed("control-surface")
            }
            Some(DeckChange::Planning) => {
                crate::engine_events::emit_planning_changed("control-surface")
            }
            None => {}
        }
    }
    response
}

/// What a deck action changed, as the screen needs to hear it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeckChange {
    Lighting,
    Planning,
}

/// The event a successful deck action raises (2026-09 production readiness,
/// Slice 10), so an open workspace follows the deck instead of waiting for
/// its next request. The audio route announces itself (`emit_audio_changed`);
/// the deck mode is a planning setting although its key sits on the lighting
/// route; `openDetail` changes nothing.
fn deck_change_event(path: &str, action: &str) -> Option<DeckChange> {
    match (path, action) {
        ("/api/deck/action", "openDetail") => None,
        ("/api/deck/action", _) => Some(DeckChange::Planning),
        ("/api/deck/light-action", "switchToDeckMode") => Some(DeckChange::Planning),
        ("/api/deck/light-action", _) => Some(DeckChange::Lighting),
        _ => None,
    }
}

fn stamp_control_surface_last_event(
    db_path: &Path,
    route: &str,
    action: &str,
    value: Option<&str>,
    actions: &[crate::action_log::ActionRecord],
) -> Result<(), ControlSurfaceError> {
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let event = json!({
        "route": route,
        "action": action,
        "value": value,
        "at": at,
    });
    set_settings_owned_and(
        db_path,
        &[(String::from(LAST_EVENT_KEY), event.to_string())],
        |transaction| crate::action_log::insert_actions(transaction, actions),
    )
    .map_err(|error| ControlSurfaceError::Storage(error.to_string()))
}

pub fn control_surface_last_event(db_path: &Path) -> Value {
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .ok()
        .and_then(|settings| settings.get(LAST_EVENT_KEY).cloned())
        .and_then(|serialized| serde_json::from_str::<Value>(&serialized).ok())
        .unwrap_or(Value::Null)
}

fn handle_planning_action(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    match action {
        "selectNextProject" | "selectPrevProject" => {
            let direction = if action == "selectNextProject" {
                "next"
            } else {
                "prev"
            };
            let result = apply_planning_selection(
                db_path,
                &parse_planning_selection_request(&json!({ "projectDirection": direction }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({
                "selectedProjectId": result.settings.selected_project_id,
                "selectedTaskId": result.settings.selected_task_id,
            }))
        }
        "selectNextTask" | "selectPrevTask" => {
            let direction = if action == "selectNextTask" {
                "next"
            } else {
                "prev"
            };
            let result = apply_planning_selection(
                db_path,
                &parse_planning_selection_request(&json!({ "taskDirection": direction }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({
                "selectedTaskId": result.settings.selected_task_id,
            }))
        }
        "setStatus" => {
            let status = value.ok_or_else(|| {
                ControlSurfaceError::InvalidParams(String::from("setStatus requires value"))
            })?;
            let context = current_planning_context(db_path)?;
            let project = require_selected_project(&context)?;
            let result = apply_planning_project_reorder(
                db_path,
                &parse_planning_project_reorder_request(&json!({
                    "projectId": project.id,
                    "newStatus": status
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "project": result.project }))
        }
        "nextStatus" | "prevStatus" => {
            let context = current_planning_context(db_path)?;
            let project = require_selected_project(&context)?;
            let next_status = cycle_value(
                PROJECT_STATUS_CYCLE,
                &project.status,
                action == "nextStatus",
            );
            let result = apply_planning_project_reorder(
                db_path,
                &parse_planning_project_reorder_request(&json!({
                    "projectId": project.id,
                    "newStatus": next_status
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "project": result.project }))
        }
        "setPriority" => {
            let priority = value.ok_or_else(|| {
                ControlSurfaceError::InvalidParams(String::from("setPriority requires value"))
            })?;
            let context = current_planning_context(db_path)?;
            let project = require_selected_project(&context)?;
            let result = apply_planning_project_update(
                db_path,
                &parse_planning_project_update_request(&json!({
                    "projectId": project.id,
                    "priority": priority
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "project": result.project }))
        }
        "nextPriority" | "prevPriority" => {
            let context = current_planning_context(db_path)?;
            let project = require_selected_project(&context)?;
            let next_priority = cycle_value(
                PROJECT_PRIORITY_CYCLE,
                &project.priority,
                action == "nextPriority",
            );
            let result = apply_planning_project_update(
                db_path,
                &parse_planning_project_update_request(&json!({
                    "projectId": project.id,
                    "priority": next_priority
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "project": result.project }))
        }
        "nextSort" | "prevSort" => {
            let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
                .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
            let current_sort = planning_settings
                .get(SORT_BY_KEY)
                .cloned()
                .unwrap_or_else(|| String::from("manual"));
            let next_sort = cycle_value(SORT_CYCLE, &current_sort, action == "nextSort");
            let result = update_planning_settings(
                db_path,
                &parse_planning_settings_update(&json!({ "sortBy": next_sort }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "sortBy": result.settings.sort_by }))
        }
        "resetSort" => {
            let result = update_planning_settings(
                db_path,
                &parse_planning_settings_update(&json!({ "sortBy": "manual" }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "sortBy": result.settings.sort_by }))
        }
        "toggleTimer" => {
            let context = current_planning_context(db_path)?;
            let task_id = resolve_timer_task_id(&context)?;
            let result = apply_planning_task_timer(
                db_path,
                &parse_planning_task_timer_request(&json!({
                    "taskId": task_id,
                    "action": "toggle"
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "task": result.task }))
        }
        "toggleTaskComplete" => {
            let context = current_planning_context(db_path)?;
            let task_id = resolve_completion_task_id(&context)?;
            let result = apply_planning_task_toggle_complete(
                db_path,
                &parse_planning_task_toggle_complete_request(&json!({
                    "taskId": task_id
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "task": result.task }))
        }
        "createProject" => {
            let title = value.unwrap_or("New Project");
            let result = apply_planning_project_create(
                db_path,
                &parse_planning_project_create_request(&json!({ "title": title }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "project": result.project }))
        }
        "deleteProject" => {
            let context = current_planning_context(db_path)?;
            let project = require_selected_project(&context)?;
            let result = apply_planning_project_delete(
                db_path,
                &parse_planning_project_delete_request(&json!({ "projectId": project.id }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "deleted": result.deleted, "projectId": project.id }))
        }
        "setFilter" => {
            let filter = value.ok_or_else(|| {
                ControlSurfaceError::InvalidParams(String::from("setFilter requires value"))
            })?;
            let result = update_planning_settings(
                db_path,
                &parse_planning_settings_update(&json!({ "viewFilter": filter }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "viewFilter": result.settings.view_filter }))
        }
        "openDetail" => Ok(json!({ "action": "openDetail" })),
        _ => Err(ControlSurfaceError::Unsupported(format!(
            "Unsupported planning deck action: {action}"
        ))),
    }
}

fn handle_light_action(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    if action == "switchToDeckMode" {
        let deck_mode = value.unwrap_or("light");
        let result = update_planning_settings(
            db_path,
            &parse_planning_settings_update(&json!({ "deckMode": deck_mode }))
                .map_err(ControlSurfaceError::InvalidParams)?,
        )
        .map_err(map_planning_error)?;
        return Ok(json!({ "deckMode": result.settings.deck_mode }));
    }

    // Every lighting key reads, decides and writes under the lighting state
    // lock, with the preview the IPC loop uses, and changes lighting state
    // only through the functions the screen's requests run (2026-09
    // production readiness, Slice 10 — F12): two keys, or a key and the
    // screen, can no longer overwrite each other's change, and a key pressed
    // while previewing edits the preview buffer, not the light output.
    with_lighting_state_and_preview(|preview| locked_light_action(db_path, action, preview))
}

fn locked_light_action(
    db_path: &Path,
    action: &str,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<Value, ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let lighting_state = load_lighting_editor_state(&app_settings);

    match action {
        "selectNextLight" | "selectPrevLight" => {
            let selected_light_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_LIGHT_ID_KEY,
                lighting_state
                    .fixtures
                    .iter()
                    .map(|fixture| fixture.id.as_str()),
            );
            let next_light_id = cycle_inventory_id(
                lighting_state
                    .fixtures
                    .iter()
                    .map(|fixture| fixture.id.as_str()),
                selected_light_id.as_deref(),
                action == "selectNextLight",
            );
            persist_optional_setting(db_path, SELECTED_LIGHT_ID_KEY, next_light_id.as_deref())?;
            Ok(json!({ "selectedLightId": next_light_id }))
        }
        "selectNextScene" | "selectPrevScene" => {
            let selected_scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            );
            let next_scene_id = cycle_inventory_id(
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
                selected_scene_id.as_deref(),
                action == "selectNextScene",
            );
            persist_optional_setting(db_path, SELECTED_SCENE_ID_KEY, next_scene_id.as_deref())?;
            Ok(json!({ "selectedSceneId": next_scene_id }))
        }
        "toggleLight" | "intensityUp" | "intensityDown" | "cctUp" | "cctDown"
        | "resetIntensity" | "resetCct" => {
            let fixture_id = selected_lighting_fixture_id(&app_settings, &lighting_state)?;
            // The relative keys start from what the operator means the
            // fixture to be: the preview buffer while previewing, otherwise
            // the stored value with a running fade sampled now.
            let levels = read_lighting_fixture_levels(&app_settings, preview, &fixture_id)
                .ok_or_else(|| {
                    ControlSurfaceError::Rejected(String::from(
                        "Selected lighting fixture was not found.",
                    ))
                })?;
            let (field, change) = match action {
                "toggleLight" => ("on", json!(!levels.on)),
                "intensityUp" => ("intensity", json!(clamp_i64(levels.intensity + 5, 0, 100))),
                "intensityDown" => ("intensity", json!(clamp_i64(levels.intensity - 5, 0, 100))),
                "cctUp" => ("cct", json!(clamp_i64(levels.cct + 200, 2700, 6500))),
                "cctDown" => ("cct", json!(clamp_i64(levels.cct - 200, 2700, 6500))),
                "resetIntensity" => ("intensity", json!(100)),
                _ => ("cct", json!(4500)),
            };
            let mut params = json!({ "fixtureId": fixture_id });
            params[field] = change;
            let result = update_lighting_fixture_with_preview(
                db_path,
                &parse_lighting_fixture_update_request(&params)
                    .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            // The reply carries what was stored — the fixture's own CCT range
            // may be narrower than the deck's 2700–6500 K.
            let stored = match field {
                "on" => json!(result.fixture.on),
                "intensity" => json!(result.fixture.intensity),
                _ => json!(result.fixture.cct),
            };
            let mut light = json!({ "id": result.fixture.id, "name": result.fixture.name });
            light[field] = stored;
            Ok(json!({ "light": light, "preview": result.source == "preview" }))
        }
        "allOn" | "allOff" => {
            let next_on = action == "allOn";
            let previewing = preview.enabled;
            set_lighting_all_power_with_preview(
                db_path,
                &parse_lighting_all_power_request(&json!({ "on": next_on }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            Ok(json!({ "on": next_on, "preview": previewing }))
        }
        "saveScene" => {
            // The deck keeps its own name for the scene ("Scene N"); the id
            // comes from the rule the screen's scenes use, which never hands
            // out an id a live scene already has.
            let scene_name = format!("Scene {}", lighting_state.scenes.len() + 1);
            let result = create_lighting_scene_with_preview(
                db_path,
                &parse_lighting_scene_create_request(&json!({ "name": scene_name }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            persist_optional_setting(db_path, SELECTED_SCENE_ID_KEY, Some(&result.scene.id))?;
            Ok(json!({ "scene": { "id": result.scene.id, "name": result.scene.name } }))
        }
        "deleteScene" => {
            let selected_scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            )
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(String::from("No lighting scene is selected."))
            })?;
            let current_index = lighting_state
                .scenes
                .iter()
                .position(|scene| scene.id == selected_scene_id)
                .unwrap_or(0);
            delete_lighting_scene(
                db_path,
                &parse_lighting_scene_delete_request(&json!({ "sceneId": selected_scene_id }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_lighting_error)?;
            let remaining = lighting_state
                .scenes
                .iter()
                .filter(|scene| scene.id != selected_scene_id)
                .collect::<Vec<_>>();
            let next_scene_id = remaining
                .get(current_index.min(remaining.len().saturating_sub(1)))
                .map(|scene| scene.id.clone());
            persist_optional_setting(db_path, SELECTED_SCENE_ID_KEY, next_scene_id.as_deref())?;
            Ok(json!({ "deleted": true, "sceneId": selected_scene_id }))
        }
        "recallScene" => {
            let scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            )
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(String::from("No lighting scene is available."))
            })?;
            // The recall writes everything a recall writes; nothing is saved
            // after it (the deck used to save its pre-recall copy of the
            // state over what the recall had just written).
            let result = recall_lighting_scene_with_preview(
                db_path,
                &parse_lighting_scene_recall_request(&json!({
                    "sceneId": scene_id,
                    "fadeDurationSeconds": 0.0
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            Ok(json!({ "recalled": result.scene_name, "preview": result.preview_mode }))
        }
        _ => Err(ControlSurfaceError::Unsupported(format!(
            "Unsupported lighting deck action: {action}"
        ))),
    }
}

fn current_planning_context(
    db_path: &Path,
) -> Result<PlanningContextSnapshot, ControlSurfaceError> {
    let planning_settings = list_settings_by_prefix(db_path, PLANNING_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    read_planning_context(db_path, &planning_settings)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))
}

fn require_selected_project(
    context: &PlanningContextSnapshot,
) -> Result<crate::planning::PlanningProjectContext, ControlSurfaceError> {
    context.selected_project.clone().ok_or_else(|| {
        ControlSurfaceError::Rejected(String::from("No project is currently selected."))
    })
}

fn resolve_timer_task_id(context: &PlanningContextSnapshot) -> Result<String, ControlSurfaceError> {
    if let Some(task_id) = context.selected_task_id.clone() {
        return Ok(task_id);
    }

    if let Some(running_task) = &context.running_task {
        return Ok(running_task.id.clone());
    }

    context
        .tasks
        .first()
        .map(|task| task.id.clone())
        .ok_or_else(|| {
            ControlSurfaceError::Rejected(String::from(
                "No tasks are available for the selected project.",
            ))
        })
}

fn resolve_completion_task_id(
    context: &PlanningContextSnapshot,
) -> Result<String, ControlSurfaceError> {
    if let Some(task_id) = context.selected_task_id.clone() {
        return Ok(task_id);
    }

    if let Some(task) = context.tasks.iter().find(|task| !task.completed) {
        return Ok(task.id.clone());
    }

    context
        .tasks
        .last()
        .map(|task| task.id.clone())
        .ok_or_else(|| {
            ControlSurfaceError::Rejected(String::from(
                "No tasks are available for the selected project.",
            ))
        })
}

pub(crate) fn map_planning_error(error: PlanningCommandError) -> ControlSurfaceError {
    match error {
        PlanningCommandError::InvalidParams(message) => ControlSurfaceError::InvalidParams(message),
        PlanningCommandError::Storage(message) => ControlSurfaceError::Storage(message),
    }
}

fn map_lighting_error(error: LightingCommandError) -> ControlSurfaceError {
    match error {
        LightingCommandError::Rejected(_, message) => ControlSurfaceError::Rejected(message),
        LightingCommandError::Storage(message) => ControlSurfaceError::Storage(message),
    }
}

fn resolve_selected_inventory_id<'a>(
    settings: &HashMap<String, String>,
    key: &str,
    inventory_ids: impl Iterator<Item = &'a str>,
) -> Option<String> {
    let inventory_ids = inventory_ids.map(str::to_string).collect::<Vec<_>>();
    let configured = settings.get(key).cloned();
    if let Some(configured) = configured {
        if inventory_ids.iter().any(|value| value == &configured) {
            return Some(configured);
        }
    }
    inventory_ids.into_iter().next()
}

fn cycle_inventory_id<'a>(
    inventory_ids: impl Iterator<Item = &'a str>,
    current_id: Option<&str>,
    forward: bool,
) -> Option<String> {
    let values = inventory_ids.map(str::to_string).collect::<Vec<_>>();
    if values.is_empty() {
        return None;
    }

    let index = current_id
        .and_then(|current_id| values.iter().position(|value| value == current_id))
        .unwrap_or(0);
    let next = if forward {
        (index + 1) % values.len()
    } else if index == 0 {
        values.len() - 1
    } else {
        index - 1
    };
    values.get(next).cloned()
}

fn persist_optional_setting(
    db_path: &Path,
    key: &str,
    value: Option<&str>,
) -> Result<(), ControlSurfaceError> {
    let mut updates = Vec::new();
    let mut deletes = Vec::new();
    if let Some(value) = value {
        updates.push((key.to_string(), value.to_string()));
    } else {
        deletes.push(key.to_string());
    }
    if !updates.is_empty() {
        set_settings_owned(db_path, &updates)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    }
    if !deletes.is_empty() {
        let connection = open_connection(db_path)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
        for key in deletes {
            connection
                .execute("DELETE FROM app_settings WHERE key = ?1", [key])
                .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
        }
    }
    Ok(())
}

fn selected_lighting_fixture_id(
    settings: &HashMap<String, String>,
    state: &LightingEditorState,
) -> Result<String, ControlSurfaceError> {
    resolve_selected_inventory_id(
        settings,
        SELECTED_LIGHT_ID_KEY,
        state.fixtures.iter().map(|fixture| fixture.id.as_str()),
    )
    .ok_or_else(|| ControlSurfaceError::Rejected(String::from("No lighting fixture is available.")))
}

/// The LCD is a reader: it takes the shared preview alone, and reads the
/// settings under it — a preview-aware mutation holds the preview from its
/// first read to its last write, so the pair read here is from one side of
/// it, never the stored value of one moment beside the preview of another.
fn deck_fixture_levels(db_path: &Path, fixture_id: &str) -> Option<LightingFixtureLevels> {
    let preview = lock_shared_lighting_preview();
    let settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX).ok()?;
    read_lighting_fixture_levels(&settings, &preview, fixture_id)
}

/// A third LCD line while previewing: the number above it is staged, not on
/// the light output.
fn preview_lcd_line(levels: &LightingFixtureLevels) -> &'static str {
    if levels.previewing {
        "\\nPREVIEW"
    } else {
        ""
    }
}

pub(crate) fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

pub(crate) fn truncate(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        return value.to_string();
    }
    chars.truncate(max_chars);
    chars.into_iter().collect()
}

fn status_label(value: &str) -> &'static str {
    match value {
        "todo" => "To Do",
        "in-progress" => "In Progress",
        "blocked" => "Blocked",
        "done" => "Done",
        _ => "--",
    }
}

fn priority_label(value: &str) -> &'static str {
    match value {
        "p0" => "P0 Critical",
        "p1" => "P1 High",
        "p2" => "P2 Medium",
        "p3" => "P3 Low",
        _ => "--",
    }
}

fn sort_label(value: &str) -> &'static str {
    match value {
        "manual" => "Manual",
        "priority" => "Priority",
        "date" => "Date",
        "name" => "Name",
        _ => "Manual",
    }
}

pub(crate) fn cycle_value(values: &[&str], current: &str, forward: bool) -> String {
    let index = values
        .iter()
        .position(|value| *value == current)
        .unwrap_or(0);
    let next = if forward {
        (index + 1) % values.len()
    } else if index == 0 {
        values.len() - 1
    } else {
        index - 1
    };
    values[next].to_string()
}

pub fn build_control_surface_health_check(runtime: &RuntimeContext) -> Value {
    json!({
        "ok": runtime.control_surface_bridge.available,
        "status": runtime.control_surface_bridge.status,
        "summary": runtime.control_surface_bridge.summary,
        "baseUrl": runtime.control_surface_bridge.base_url,
        "port": runtime.control_surface_bridge.port,
        "error": runtime.control_surface_bridge.error,
    })
}

/// Test fixtures shared with `control_surface_http::tests`.
#[cfg(test)]
pub(crate) mod test_support {
    use crate::storage::{initialize_test_database, set_settings_owned};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(crate) struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        pub(crate) fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "studio-control-engine-deck-{label}-{}-{unique}",
                process::id()
            ));
            fs::create_dir_all(&path).expect("test dir should be created");
            Self { path }
        }

        pub(crate) fn path(&self) -> &Path {
            &self.path
        }

        pub(crate) fn db_path(&self) -> PathBuf {
            self.path.join("native.sqlite3")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    pub(crate) fn ready_audio_test_db(label: &str) -> TestDir {
        let test_dir = TestDir::new(label);
        initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from("app.commissioning.check.audio.status"),
                    String::from("passed"),
                ),
                (
                    String::from("app.audio.send_host"),
                    String::from("127.0.0.1"),
                ),
                (
                    String::from("app.audio.metering_source"),
                    String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
                ),
            ],
        )
        .expect("ready audio settings should persist");
        test_dir
    }
}

#[cfg(test)]
mod tests;
