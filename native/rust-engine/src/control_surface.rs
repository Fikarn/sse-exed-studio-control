use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    clear_all_audio_solo, ensure_audio_action_allowed, parse_audio_snapshot_recall_request,
    read_audio_snapshot, recall_audio_snapshot, update_audio_channel, update_audio_mix_target,
    update_audio_settings, AudioChannelUpdateRequest, AudioCommandError,
    AudioMixTargetUpdateRequest, AudioSettingsUpdateRequest, AudioSnapshot,
};
use crate::bootstrap::RuntimeContext;
use crate::diagnostics::append_log;
use crate::lighting::{
    load_lighting_editor_state, parse_lighting_scene_recall_request, read_lighting_snapshot,
    recall_lighting_scene, save_lighting_editor_state, LightingCommandError,
    LightingEditorFixtureState, LightingEditorSceneFixtureState, LightingEditorSceneState,
    LightingEditorState,
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
use crate::protocol::{event_message, EVENT_AUDIO_CHANGED};
use crate::shell_settings::{DEFAULT_WORKSPACE, SHELL_SETTINGS_PREFIX, WORKSPACE_KEY};
use crate::storage::{list_settings_by_prefix, open_connection, set_settings_owned};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

pub const DEFAULT_CONTROL_SURFACE_HOST: &str = "127.0.0.1";
pub const DEFAULT_CONTROL_SURFACE_PORT: u16 = 38201;

const SELECTED_LIGHT_ID_KEY: &str = "app.control_surface.selected_light_id";
const SELECTED_SCENE_ID_KEY: &str = "app.control_surface.selected_scene_id";

const AUDIO_DECK_BANK_KEY: &str = "app.control_surface.audio.bank";
const AUDIO_DECK_DIAL_MODE_KEY: &str = "app.control_surface.audio.dial_mode";
const AUDIO_DECK_BANK_CYCLE: &[&str] = &["inputs", "playback", "outputs"];
const AUDIO_DECK_FADER_STEP: f64 = 0.01;
const AUDIO_DECK_FAST_TURN_WINDOW: Duration = Duration::from_millis(80);
const AUDIO_DECK_FAST_TURN_MULTIPLIER: f64 = 5.0;
const AUDIO_DECK_TALK_RELEASE: Duration = Duration::from_secs(2);
const AUDIO_ROLE_FRONT_PREAMP: &str = "front-preamp";
const AUDIO_ROLE_PLAYBACK_PAIR: &str = "playback-pair";
const AUDIO_MAIN_MIX_TARGET_ROLE: &str = "main-out";
const AUDIO_PREAMP_GAIN_MIN: i64 = 0;
const AUDIO_PREAMP_GAIN_MAX: i64 = 75;

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

type LightingDeckState = LightingEditorState;
type LightingDeckFixtureState = LightingEditorFixtureState;
type LightingDeckSceneState = LightingEditorSceneState;
type LightingDeckSceneFixtureState = LightingEditorSceneFixtureState;

#[derive(Debug)]
enum AudioDeckStrip {
    Channel(Box<crate::audio::AudioChannelSnapshot>),
    MixTarget(crate::audio::AudioMixTargetSnapshot),
}

static CONTROL_SURFACE_EVENT_SENDER: OnceLock<Sender<Value>> = OnceLock::new();
static AUDIO_DIAL_TURN_TIMES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static AUDIO_TALK_DEADLINES: OnceLock<Mutex<HashMap<PathBuf, Instant>>> = OnceLock::new();
static AUDIO_TALK_WATCHDOG: OnceLock<()> = OnceLock::new();

#[derive(Debug)]
pub enum ControlSurfaceError {
    InvalidParams(String),
    Unsupported(String),
    Rejected(String),
    Storage(String),
}

impl ControlSurfaceError {
    fn status_code(&self) -> u16 {
        match self {
            Self::InvalidParams(_) => 400,
            Self::Unsupported(_) => 501,
            Self::Rejected(_) => 409,
            Self::Storage(_) => 500,
        }
    }

    fn message(&self) -> &str {
        match self {
            Self::InvalidParams(message)
            | Self::Unsupported(message)
            | Self::Rejected(message)
            | Self::Storage(message) => message,
        }
    }
}

pub fn resolve_control_surface_port() -> u16 {
    std::env::var("SSE_CONTROL_SURFACE_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_CONTROL_SURFACE_PORT)
}

pub fn register_control_surface_event_sender(sender: Sender<Value>) {
    let _ = CONTROL_SURFACE_EVENT_SENDER.set(sender);
}

fn emit_audio_changed() {
    if let Some(sender) = CONTROL_SURFACE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(
            EVENT_AUDIO_CHANGED,
            json!({ "reason": "control-surface" }),
        ));
    }
}

pub fn start_control_surface_bridge(
    db_path: &Path,
    log_file_path: &Path,
    requested_port: u16,
) -> ControlSurfaceBridgeInfo {
    match bind_control_surface_listener(requested_port) {
        Ok(listener) => {
            let port = listener
                .local_addr()
                .map(|address| address.port())
                .unwrap_or(requested_port);
            let base_url = format!("http://{DEFAULT_CONTROL_SURFACE_HOST}:{port}");
            let db_path = db_path.to_path_buf();
            let log_file_path = log_file_path.to_path_buf();
            let summary = format!(
                "Native control-surface bridge is serving deck actions and LCD payloads at {base_url}."
            );

            let _ = append_log(log_file_path.as_path(), "INFO", &summary);

            thread::spawn(move || run_control_surface_bridge(listener, db_path, log_file_path));

            ControlSurfaceBridgeInfo {
                base_url,
                port,
                available: true,
                status: String::from("ready"),
                summary,
                error: None,
            }
        }
        Err(message) => ControlSurfaceBridgeInfo {
            base_url: format!("http://{DEFAULT_CONTROL_SURFACE_HOST}:{requested_port}"),
            port: requested_port,
            available: false,
            status: String::from("unavailable"),
            summary: format!(
                "Native control-surface bridge is unavailable because the listener could not bind: {message}"
            ),
            error: Some(message),
        },
    }
}

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
    let lighting_snapshot = read_lighting_snapshot(&app_settings);
    let audio_snapshot = read_audio_snapshot(&app_settings);
    let lighting_state = load_lighting_deck_state(&app_settings, &lighting_snapshot);

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
            if let Some(selected_light_id) = selected_light_id {
                if let Some(fixture) = lighting_state
                    .fixtures
                    .iter()
                    .find(|fixture| fixture.id == selected_light_id)
                {
                    return Ok(format!("INTENSITY\\n{}%", fixture.intensity));
                }
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
            if let Some(selected_light_id) = selected_light_id {
                if let Some(fixture) = lighting_state
                    .fixtures
                    .iter()
                    .find(|fixture| fixture.id == selected_light_id)
                {
                    return Ok(format!("CCT\\n{}K", fixture.cct));
                }
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
fn audio_fader_db_label(value: f64) -> String {
    let normalized = if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    };
    if normalized <= 0.0 {
        return String::from("-\u{221e} dB");
    }
    let db = if normalized >= 1.0 {
        6.0
    } else if normalized <= 0.7 {
        -60.0 + (normalized / 0.7) * 50.0
    } else if normalized <= 0.8 {
        -10.0 + ((normalized - 0.7) / 0.1) * 10.0
    } else {
        ((normalized - 0.8) / 0.2) * 6.0
    };
    format!("{db:+.1} dB")
}

fn audio_deck_gate_label(snapshot: &AudioSnapshot) -> Option<&'static str> {
    if !snapshot.osc_enabled {
        return Some("OSC OFF");
    }
    match snapshot.status.as_str() {
        "ready" => None,
        "attention" => Some("CHECK OSC"),
        "not-verified" => Some("NOT VERIFIED"),
        _ => Some("OFFLINE"),
    }
}

fn audio_mix_target_short_label(role: &str) -> &'static str {
    match role {
        "main-out" => "MAIN",
        "phones-a" => "PH1",
        "phones-b" => "PH2",
        _ => "MIX",
    }
}

fn audio_selected_mix_target_label(snapshot: &AudioSnapshot) -> &'static str {
    snapshot
        .mix_targets
        .iter()
        .find(|target| target.id == snapshot.selected_mix_target_id)
        .map(|target| audio_mix_target_short_label(&target.role))
        .unwrap_or("MIX")
}

fn audio_strip_lcd_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    strip_index: usize,
) -> String {
    if let Some(gate) = audio_deck_gate_label(snapshot) {
        return format!("AUDIO\\n{gate}");
    }

    let bank = audio_deck_bank(app_settings);
    let dial_mode = audio_deck_dial_mode(app_settings);
    match resolve_audio_deck_strip(snapshot, &bank, strip_index) {
        Ok(AudioDeckStrip::Channel(channel)) => {
            let marker = if snapshot.selected_channel_id.as_deref() == Some(channel.id.as_str()) {
                "\u{2022} "
            } else {
                ""
            };
            let name = truncate(&channel.name, 10);
            if bank == "inputs" && dial_mode == "gain" {
                format!("{marker}{name}\\nGAIN {} dB", channel.gain)
            } else {
                let level = channel
                    .mix_levels
                    .get(&snapshot.selected_mix_target_id)
                    .copied()
                    .unwrap_or(channel.fader);
                let level_line = if channel.mute {
                    String::from("MUTED")
                } else {
                    audio_fader_db_label(level)
                };
                format!(
                    "{marker}{name}\\n{level_line}\\n\u{2192}{}",
                    audio_selected_mix_target_label(snapshot)
                )
            }
        }
        Ok(AudioDeckStrip::MixTarget(target)) => {
            let marker = if snapshot.selected_mix_target_id == target.id {
                "\u{2022} "
            } else {
                ""
            };
            let level_line = if target.mute {
                String::from("MUTED")
            } else {
                audio_fader_db_label(target.volume)
            };
            format!(
                "{marker}{}\\n{level_line}\\nOUTPUT",
                truncate(&target.name, 10)
            )
        }
        Err(_) => String::from("\u{2014}\\n(no strip)"),
    }
}

fn audio_key_lcd_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    key_index: usize,
) -> String {
    let gate = audio_deck_gate_label(snapshot);
    let main = audio_main_mix_target(snapshot);
    match key_index {
        1..=3 => {
            let role = match key_index {
                1 => "main-out",
                2 => "phones-a",
                _ => "phones-b",
            };
            let label = audio_mix_target_short_label(role);
            let active = snapshot
                .mix_targets
                .iter()
                .find(|target| target.role == role)
                .is_some_and(|target| target.id == snapshot.selected_mix_target_id);
            if active {
                format!("\u{2192} {label}\\n\u{25cf} ACTIVE")
            } else {
                format!("\u{2192} {label}\\n")
            }
        }
        4 => format!("BANK\\n{}", audio_deck_bank(app_settings).to_uppercase()),
        5 => match (gate, main) {
            (None, Some(main)) => format!("DIM\\n{}", if main.dim { "ON" } else { "OFF" }),
            _ => String::from("DIM\\n--"),
        },
        6 => {
            if audio_deck_bank(app_settings) == "inputs" {
                format!(
                    "GAIN\\n{}",
                    if audio_deck_dial_mode(app_settings) == "gain" {
                        "ON"
                    } else {
                        "OFF"
                    }
                )
            } else {
                String::from("GAIN\\nN/A")
            }
        }
        7 => match (gate, main) {
            (None, Some(main)) => format!("TALK\\n{}", if main.talkback { "LIVE" } else { "HOLD" }),
            _ => String::from("TALK\\n--"),
        },
        8 => {
            if gate.is_some() {
                return String::from("SOLO\\n--");
            }
            let soloed = snapshot.channels.iter().filter(|entry| entry.solo).count();
            if soloed > 0 {
                format!("SOLO\\n{soloed} LIVE")
            } else {
                String::from("SOLO\\nCLEAR")
            }
        }
        _ => String::from("--"),
    }
}

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

    match path {
        "/api/deck/action" => handle_planning_action(db_path, action, value),
        "/api/deck/light-action" => handle_light_action(db_path, action, value),
        "/api/deck/audio-action" => handle_audio_action(db_path, action, value),
        _ => Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported action route: {path}"
        ))),
    }
}

fn bind_control_surface_listener(requested_port: u16) -> Result<TcpListener, String> {
    TcpListener::bind((DEFAULT_CONTROL_SURFACE_HOST, requested_port))
        .map_err(|error| error.to_string())
}

fn run_control_surface_bridge(
    listener: TcpListener,
    db_path: std::path::PathBuf,
    log_file_path: std::path::PathBuf,
) {
    let _ = listener.set_nonblocking(false);
    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let db_path = db_path.clone();
                let log_file_path = log_file_path.clone();
                thread::spawn(move || {
                    if let Err(error) = handle_control_surface_connection(stream, &db_path) {
                        let _ = append_log(
                            log_file_path.as_path(),
                            "WARN",
                            &format!("Control-surface bridge request failed: {}", error.message()),
                        );
                    }
                });
            }
            Err(error) => {
                let _ = append_log(
                    log_file_path.as_path(),
                    "WARN",
                    &format!("Control-surface bridge accept failed: {error}"),
                );
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn handle_control_surface_connection(
    mut stream: TcpStream,
    db_path: &Path,
) -> Result<(), ControlSurfaceError> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = read_http_request(&mut stream)?;
    let response = route_control_surface_request(db_path, &request);
    write_http_response(&mut stream, response.status_code, &response.body)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))
}

struct HttpRequest {
    method: String,
    target: String,
    body: Vec<u8>,
}

struct HttpResponse {
    status_code: u16,
    body: Vec<u8>,
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, ControlSurfaceError> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];

    loop {
        let bytes_read = stream
            .read(&mut chunk)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > 64 * 1024 {
            return Err(ControlSurfaceError::InvalidParams(String::from(
                "HTTP request header exceeded the native bridge limit",
            )));
        }
    }

    let Some(header_end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Err(ControlSurfaceError::InvalidParams(String::from(
            "Malformed HTTP request",
        )));
    };
    let header_end = header_end + 4;
    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("Missing request line")))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("Missing HTTP method")))?
        .to_string();
    let target = parts
        .next()
        .ok_or_else(|| ControlSurfaceError::InvalidParams(String::from("Missing HTTP target")))?
        .to_string();

    let content_length = header_text
        .lines()
        .skip(1)
        .filter_map(|line| line.split_once(':'))
        .find_map(|(name, value)| {
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    while buffer.len() < header_end + content_length {
        let bytes_read = stream
            .read(&mut chunk)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);
    }

    let mut body = buffer.split_off(header_end);
    if body.len() > content_length {
        body.truncate(content_length);
    }

    Ok(HttpRequest {
        method,
        target,
        body,
    })
}

fn route_control_surface_request(db_path: &Path, request: &HttpRequest) -> HttpResponse {
    let (path, query) = split_target(&request.target);

    let result = match (request.method.as_str(), path) {
        ("GET", "/api/deck/context") => read_control_surface_context(db_path),
        ("GET", "/api/deck/lcd") => {
            let key = query_parameter(query, "key").ok_or_else(|| {
                ControlSurfaceError::InvalidParams(String::from("Missing ?key= parameter"))
            });
            key.and_then(|key| read_control_surface_lcd_text(db_path, &key).map(Value::String))
        }
        ("POST", "/api/deck/action")
        | ("POST", "/api/deck/light-action")
        | ("POST", "/api/deck/audio-action") => parse_json_body(&request.body)
            .and_then(|body| handle_control_surface_http_action(db_path, path, &body)),
        _ => Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported bridge endpoint: {} {}",
            request.method, path
        ))),
    };

    match result {
        Ok(value) => HttpResponse {
            status_code: 200,
            body: serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec()),
        },
        Err(error) => HttpResponse {
            status_code: error.status_code(),
            body: serde_json::to_vec(&json!({ "error": error.message() }))
                .unwrap_or_else(|_| b"{\"error\":\"bridge failure\"}".to_vec()),
        },
    }
}

fn write_http_response(
    stream: &mut TcpStream,
    status_code: u16,
    body: &[u8],
) -> Result<(), std::io::Error> {
    let status_text = match status_code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        409 => "Conflict",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "Error",
    };
    let headers = format!(
        "HTTP/1.1 {status_code} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn split_target(target: &str) -> (&str, &str) {
    target.split_once('?').unwrap_or((target, ""))
}

fn query_parameter(query: &str, name: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find_map(|(key, value)| {
            if key == name {
                Some(value.replace("%20", " "))
            } else {
                None
            }
        })
}

fn parse_json_body(body: &[u8]) -> Result<Value, ControlSurfaceError> {
    if body.is_empty() {
        return Ok(json!({}));
    }

    serde_json::from_slice(body)
        .map_err(|error| ControlSurfaceError::InvalidParams(error.to_string()))
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
    match action {
        "switchToDeckMode" => {
            let deck_mode = value.unwrap_or("light");
            let result = update_planning_settings(
                db_path,
                &parse_planning_settings_update(&json!({ "deckMode": deck_mode }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "deckMode": result.settings.deck_mode }))
        }
        "selectNextLight" | "selectPrevLight" => {
            let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
                .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
            let lighting_snapshot = read_lighting_snapshot(&app_settings);
            let lighting_state = load_lighting_deck_state(&app_settings, &lighting_snapshot);
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
            let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
                .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
            let lighting_snapshot = read_lighting_snapshot(&app_settings);
            let lighting_state = load_lighting_deck_state(&app_settings, &lighting_snapshot);
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
        "toggleLight" | "allOn" | "allOff" | "intensityUp" | "intensityDown" | "cctUp"
        | "cctDown" | "resetIntensity" | "resetCct" | "saveScene" | "deleteScene" => {
            let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
                .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
            let lighting_snapshot = read_lighting_snapshot(&app_settings);
            let mut lighting_state = load_lighting_deck_state(&app_settings, &lighting_snapshot);

            match action {
                "toggleLight" => {
                    let (fixture_id, next_on) = {
                        let fixture =
                            selected_lighting_fixture_mut(&app_settings, &mut lighting_state)?;
                        fixture.on = !fixture.on;
                        (fixture.id.clone(), fixture.on)
                    };
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    Ok(json!({ "light": { "id": fixture_id, "on": next_on } }))
                }
                "allOn" | "allOff" => {
                    let next_on = action == "allOn";
                    for fixture in &mut lighting_state.fixtures {
                        fixture.on = next_on;
                    }
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    Ok(json!({ "on": next_on }))
                }
                "intensityUp" | "intensityDown" => {
                    let (fixture_id, intensity) = {
                        let fixture =
                            selected_lighting_fixture_mut(&app_settings, &mut lighting_state)?;
                        let delta = if action == "intensityUp" { 5 } else { -5 };
                        fixture.intensity = clamp_i64(fixture.intensity + delta, 0, 100);
                        (fixture.id.clone(), fixture.intensity)
                    };
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    Ok(json!({ "light": { "id": fixture_id, "intensity": intensity } }))
                }
                "cctUp" | "cctDown" => {
                    let (fixture_id, cct) = {
                        let fixture =
                            selected_lighting_fixture_mut(&app_settings, &mut lighting_state)?;
                        let delta = if action == "cctUp" { 200 } else { -200 };
                        fixture.cct = clamp_i64(fixture.cct + delta, 2700, 6500);
                        (fixture.id.clone(), fixture.cct)
                    };
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    Ok(json!({ "light": { "id": fixture_id, "cct": cct } }))
                }
                "resetIntensity" => {
                    let fixture_id = {
                        let fixture =
                            selected_lighting_fixture_mut(&app_settings, &mut lighting_state)?;
                        fixture.intensity = 100;
                        fixture.id.clone()
                    };
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    Ok(json!({ "light": { "id": fixture_id, "intensity": 100 } }))
                }
                "resetCct" => {
                    let fixture_id = {
                        let fixture =
                            selected_lighting_fixture_mut(&app_settings, &mut lighting_state)?;
                        fixture.cct = 4500;
                        fixture.id.clone()
                    };
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    Ok(json!({ "light": { "id": fixture_id, "cct": 4500 } }))
                }
                "saveScene" => {
                    if lighting_state.fixtures.is_empty() {
                        return Err(ControlSurfaceError::Rejected(String::from(
                            "No lighting fixtures are available.",
                        )));
                    }
                    let next_index = lighting_state.scenes.len() + 1;
                    let scene_id = format!("scene-custom-{next_index}");
                    let scene_name = format!("Scene {next_index}");
                    lighting_state.scenes.push(LightingDeckSceneState {
                        id: scene_id.clone(),
                        name: scene_name.clone(),
                        fixture_states: lighting_state
                            .fixtures
                            .iter()
                            .map(|fixture| LightingDeckSceneFixtureState {
                                fixture_id: fixture.id.clone(),
                                intensity: fixture.intensity,
                                cct: fixture.cct,
                                on: fixture.on,
                                control_values: fixture.control_values.clone(),
                            })
                            .collect(),
                        color_index: None,
                    });
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    persist_optional_setting(db_path, SELECTED_SCENE_ID_KEY, Some(&scene_id))?;
                    Ok(json!({ "scene": { "id": scene_id, "name": scene_name } }))
                }
                "deleteScene" => {
                    let selected_scene_id = resolve_selected_inventory_id(
                        &app_settings,
                        SELECTED_SCENE_ID_KEY,
                        lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
                    )
                    .ok_or_else(|| {
                        ControlSurfaceError::Rejected(String::from(
                            "No lighting scene is selected.",
                        ))
                    })?;
                    let current_index = lighting_state
                        .scenes
                        .iter()
                        .position(|scene| scene.id == selected_scene_id)
                        .ok_or_else(|| {
                            ControlSurfaceError::Rejected(String::from(
                                "Selected lighting scene was not found.",
                            ))
                        })?;
                    lighting_state
                        .scenes
                        .retain(|scene| scene.id != selected_scene_id);
                    save_lighting_deck_state(db_path, &lighting_state)?;
                    let next_scene_id = lighting_state
                        .scenes
                        .get(current_index.min(lighting_state.scenes.len().saturating_sub(1)))
                        .map(|scene| scene.id.clone());
                    persist_optional_setting(
                        db_path,
                        SELECTED_SCENE_ID_KEY,
                        next_scene_id.as_deref(),
                    )?;
                    Ok(json!({ "deleted": true, "sceneId": selected_scene_id }))
                }
                _ => Err(ControlSurfaceError::Unsupported(String::from(
                    "Unsupported lighting mutation",
                ))),
            }
        }
        "recallScene" => {
            let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
                .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
            let lighting_snapshot = read_lighting_snapshot(&app_settings);
            let mut lighting_state = load_lighting_deck_state(&app_settings, &lighting_snapshot);
            let scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            )
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(String::from("No lighting scene is available."))
            })?;
            let result = recall_lighting_scene(
                db_path,
                &parse_lighting_scene_recall_request(&json!({
                    "sceneId": scene_id,
                    "fadeDurationSeconds": 0.0
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(|error| match error {
                crate::lighting::LightingCommandError::Rejected(_, message) => {
                    ControlSurfaceError::Rejected(message)
                }
                crate::lighting::LightingCommandError::Storage(message) => {
                    ControlSurfaceError::Storage(message)
                }
            })?;
            if let Some(scene) = lighting_state
                .scenes
                .iter()
                .find(|scene| scene.id == scene_id)
                .cloned()
            {
                for fixture in &mut lighting_state.fixtures {
                    if let Some(scene_state) = scene
                        .fixture_states
                        .iter()
                        .find(|fixture_state| fixture_state.fixture_id == fixture.id)
                    {
                        fixture.intensity = scene_state.intensity;
                        fixture.cct = scene_state.cct;
                        fixture.on = scene_state.on;
                    }
                }
            }
            save_lighting_deck_state(db_path, &lighting_state)?;
            Ok(json!({ "recalled": result.scene_name }))
        }
        _ => Err(ControlSurfaceError::Unsupported(format!(
            "Unsupported lighting deck action: {action}"
        ))),
    }
}

fn handle_audio_action(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    match action {
        "switchToDeckMode" => {
            let deck_mode = value.unwrap_or("audio");
            let result = update_planning_settings(
                db_path,
                &parse_planning_settings_update(&json!({ "deckMode": deck_mode }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "deckMode": result.settings.deck_mode }))
        }
        "recallSnapshot" => {
            let (_, audio_snapshot) = current_audio_snapshot(db_path)?;
            let Some(snapshot) = audio_snapshot.snapshots.first() else {
                return Err(ControlSurfaceError::Rejected(String::from(
                    "No audio snapshot is available.",
                )));
            };
            let result = recall_audio_snapshot(
                db_path,
                &parse_audio_snapshot_recall_request(&json!({
                    "snapshotId": snapshot.id
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({ "recalled": result.snapshot_name }))
        }
        "dialTurn" => handle_audio_dial_turn(db_path, value),
        "dialPress" => handle_audio_dial_press(db_path, value),
        "stripTap" => handle_audio_strip_tap(db_path, value),
        "setMixTarget" => handle_audio_set_mix_target(db_path, value),
        "cycleBank" => handle_audio_cycle_bank(db_path),
        "toggleDialMode" => handle_audio_toggle_dial_mode(db_path),
        "dimToggle" => handle_audio_dim_toggle(db_path),
        "talkOn" => handle_audio_talk(db_path, true),
        "talkOff" => handle_audio_talk(db_path, false),
        "soloClearAll" => handle_audio_solo_clear_all(db_path),
        _ => Err(ControlSurfaceError::Unsupported(format!(
            "Unsupported audio deck action: {action}"
        ))),
    }
}

fn map_audio_error(error: AudioCommandError) -> ControlSurfaceError {
    match error {
        AudioCommandError::Rejected(_, message) => ControlSurfaceError::Rejected(message),
        AudioCommandError::Storage(message) => ControlSurfaceError::Storage(message),
    }
}

fn current_audio_snapshot(
    db_path: &Path,
) -> Result<(HashMap<String, String>, AudioSnapshot), ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let snapshot = read_audio_snapshot(&app_settings);
    Ok((app_settings, snapshot))
}

fn audio_deck_bank(settings: &HashMap<String, String>) -> String {
    settings
        .get(AUDIO_DECK_BANK_KEY)
        .filter(|value| AUDIO_DECK_BANK_CYCLE.contains(&value.as_str()))
        .cloned()
        .unwrap_or_else(|| String::from("inputs"))
}

fn audio_deck_dial_mode(settings: &HashMap<String, String>) -> String {
    settings
        .get(AUDIO_DECK_DIAL_MODE_KEY)
        .filter(|value| value.as_str() == "gain")
        .cloned()
        .unwrap_or_else(|| String::from("fader"))
}

fn parse_audio_strip_index(value: &str) -> Result<usize, ControlSurfaceError> {
    let index = value.trim().parse::<usize>().map_err(|_| {
        ControlSurfaceError::InvalidParams(String::from("strip index must be an integer"))
    })?;
    if !(1..=4).contains(&index) {
        return Err(ControlSurfaceError::InvalidParams(String::from(
            "strip index must be between 1 and 4",
        )));
    }
    Ok(index)
}

fn resolve_audio_deck_strip(
    snapshot: &AudioSnapshot,
    bank: &str,
    strip_index: usize,
) -> Result<AudioDeckStrip, ControlSurfaceError> {
    match bank {
        "playback" => snapshot
            .channels
            .iter()
            .filter(|channel| channel.role == AUDIO_ROLE_PLAYBACK_PAIR)
            .nth(strip_index - 1)
            .cloned()
            .map(|channel| AudioDeckStrip::Channel(Box::new(channel)))
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(format!(
                    "No playback strip {strip_index} is available."
                ))
            }),
        "outputs" => snapshot
            .mix_targets
            .get(strip_index - 1)
            .cloned()
            .map(AudioDeckStrip::MixTarget)
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(format!(
                    "No output strip {strip_index} is available."
                ))
            }),
        _ => snapshot
            .channels
            .iter()
            .filter(|channel| channel.role == AUDIO_ROLE_FRONT_PREAMP)
            .nth(strip_index - 1)
            .cloned()
            .map(|channel| AudioDeckStrip::Channel(Box::new(channel)))
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(format!("No input strip {strip_index} is available."))
            }),
    }
}

fn audio_main_mix_target(
    snapshot: &AudioSnapshot,
) -> Option<&crate::audio::AudioMixTargetSnapshot> {
    snapshot
        .mix_targets
        .iter()
        .find(|target| target.role == AUDIO_MAIN_MIX_TARGET_ROLE)
        .or_else(|| snapshot.mix_targets.first())
}

fn audio_channel_update_request(channel_id: &str) -> AudioChannelUpdateRequest {
    AudioChannelUpdateRequest {
        channel_id: String::from(channel_id),
        mix_target_id: None,
        name: None,
        gain: None,
        fader: None,
        mute: None,
        solo: None,
        phantom: None,
        phase: None,
        pad: None,
        instrument: None,
        auto_set: None,
    }
}

fn audio_mix_target_update_request(mix_target_id: &str) -> AudioMixTargetUpdateRequest {
    AudioMixTargetUpdateRequest {
        mix_target_id: String::from(mix_target_id),
        volume: None,
        mute: None,
        dim: None,
        mono: None,
        talkback: None,
    }
}

fn audio_settings_update_request() -> AudioSettingsUpdateRequest {
    AudioSettingsUpdateRequest {
        osc_enabled: None,
        send_host: None,
        send_port: None,
        receive_port: None,
        selected_channel_id: None,
        selected_mix_target_id: None,
        expected_peak_data: None,
        expected_submix_lock: None,
        expected_compatibility_mode: None,
        faders_per_bank: None,
        view_mode: None,
    }
}

fn audio_dial_turn_multiplier(turn_key: &str, now: Instant) -> f64 {
    let times = AUDIO_DIAL_TURN_TIMES.get_or_init(|| Mutex::new(HashMap::new()));
    let Ok(mut times) = times.lock() else {
        return 1.0;
    };
    let fast = times
        .get(turn_key)
        .is_some_and(|last| now.saturating_duration_since(*last) < AUDIO_DECK_FAST_TURN_WINDOW);
    times.insert(String::from(turn_key), now);
    if fast {
        AUDIO_DECK_FAST_TURN_MULTIPLIER
    } else {
        1.0
    }
}

fn audio_dial_turn_key(db_path: &Path, bank: &str, strip_index: usize) -> String {
    format!("{}|{bank}|{strip_index}", db_path.display())
}

fn handle_audio_dial_turn(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value.ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from(
            "dialTurn requires a value like \"1:up\" or \"3:down\"",
        ))
    })?;
    let (strip_raw, direction_raw) = value.split_once(':').ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from(
            "dialTurn requires a value like \"1:up\" or \"3:down\"",
        ))
    })?;
    let strip_index = parse_audio_strip_index(strip_raw)?;
    let step_sign: i64 = match direction_raw.trim() {
        "up" => 1,
        "down" => -1,
        _ => {
            return Err(ControlSurfaceError::InvalidParams(String::from(
                "dialTurn direction must be \"up\" or \"down\"",
            )))
        }
    };

    let (app_settings, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let bank = audio_deck_bank(&app_settings);
    let dial_mode = audio_deck_dial_mode(&app_settings);

    match resolve_audio_deck_strip(&snapshot, &bank, strip_index)? {
        AudioDeckStrip::Channel(channel) => {
            if bank == "inputs" && dial_mode == "gain" {
                let next_gain = clamp_i64(
                    channel.gain + step_sign,
                    AUDIO_PREAMP_GAIN_MIN,
                    AUDIO_PREAMP_GAIN_MAX,
                );
                let mut request = audio_channel_update_request(&channel.id);
                request.gain = Some(next_gain);
                let updated = update_audio_channel(db_path, &request).map_err(map_audio_error)?;
                emit_audio_changed();
                Ok(json!({
                    "strip": strip_index,
                    "channelId": updated.id,
                    "name": updated.name,
                    "gain": updated.gain,
                }))
            } else {
                let multiplier = audio_dial_turn_multiplier(
                    &audio_dial_turn_key(db_path, &bank, strip_index),
                    Instant::now(),
                );
                let mix_target_id = snapshot.selected_mix_target_id.clone();
                let current = channel
                    .mix_levels
                    .get(&mix_target_id)
                    .copied()
                    .unwrap_or(channel.fader);
                let next = (current + step_sign as f64 * AUDIO_DECK_FADER_STEP * multiplier)
                    .clamp(0.0, 1.0);
                let mut request = audio_channel_update_request(&channel.id);
                request.mix_target_id = Some(mix_target_id.clone());
                request.fader = Some(next);
                let updated = update_audio_channel(db_path, &request).map_err(map_audio_error)?;
                emit_audio_changed();
                let level = updated
                    .mix_levels
                    .get(&mix_target_id)
                    .copied()
                    .unwrap_or(updated.fader);
                Ok(json!({
                    "strip": strip_index,
                    "channelId": updated.id,
                    "name": updated.name,
                    "mixTargetId": mix_target_id,
                    "fader": level,
                }))
            }
        }
        AudioDeckStrip::MixTarget(target) => {
            let multiplier = audio_dial_turn_multiplier(
                &audio_dial_turn_key(db_path, &bank, strip_index),
                Instant::now(),
            );
            let next = (target.volume + step_sign as f64 * AUDIO_DECK_FADER_STEP * multiplier)
                .clamp(0.0, 1.0);
            let mut request = audio_mix_target_update_request(&target.id);
            request.volume = Some(next);
            let updated = update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "mixTargetId": updated.id,
                "name": updated.name,
                "volume": updated.volume,
            }))
        }
    }
}

fn handle_audio_dial_press(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value.ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from("dialPress requires a strip index value"))
    })?;
    let strip_index = parse_audio_strip_index(value)?;

    let (app_settings, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let bank = audio_deck_bank(&app_settings);

    match resolve_audio_deck_strip(&snapshot, &bank, strip_index)? {
        AudioDeckStrip::Channel(channel) => {
            let mut request = audio_channel_update_request(&channel.id);
            request.mute = Some(!channel.mute);
            let updated = update_audio_channel(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "channelId": updated.id,
                "name": updated.name,
                "mute": updated.mute,
            }))
        }
        AudioDeckStrip::MixTarget(target) => {
            let mut request = audio_mix_target_update_request(&target.id);
            request.mute = Some(!target.mute);
            let updated = update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "mixTargetId": updated.id,
                "name": updated.name,
                "mute": updated.mute,
            }))
        }
    }
}

fn handle_audio_strip_tap(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value.ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from("stripTap requires a strip index value"))
    })?;
    let strip_index = parse_audio_strip_index(value)?;

    let (app_settings, snapshot) = current_audio_snapshot(db_path)?;
    let bank = audio_deck_bank(&app_settings);

    match resolve_audio_deck_strip(&snapshot, &bank, strip_index)? {
        AudioDeckStrip::Channel(channel) => {
            let mut request = audio_settings_update_request();
            request.selected_channel_id = Some(Some(channel.id.clone()));
            update_audio_settings(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "selectedChannelId": channel.id,
                "name": channel.name,
            }))
        }
        AudioDeckStrip::MixTarget(target) => {
            let mut request = audio_settings_update_request();
            request.selected_mix_target_id = Some(target.id.clone());
            update_audio_settings(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "selectedMixTargetId": target.id,
                "name": target.name,
            }))
        }
    }
}

fn handle_audio_set_mix_target(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ControlSurfaceError::InvalidParams(String::from(
                "setMixTarget requires a value of main, phones-a, or phones-b",
            ))
        })?;
    let mix_target_id = match value {
        "main" => "audio-mix-main",
        "phones-a" => "audio-mix-phones-a",
        "phones-b" => "audio-mix-phones-b",
        other => other,
    };

    let mut request = audio_settings_update_request();
    request.selected_mix_target_id = Some(String::from(mix_target_id));
    update_audio_settings(db_path, &request).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(json!({ "selectedMixTargetId": mix_target_id }))
}

fn handle_audio_cycle_bank(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let next = cycle_value(AUDIO_DECK_BANK_CYCLE, &audio_deck_bank(&app_settings), true);
    set_settings_owned(
        db_path,
        &[(String::from(AUDIO_DECK_BANK_KEY), next.clone())],
    )
    .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    Ok(json!({ "bank": next }))
}

fn handle_audio_toggle_dial_mode(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let next = if audio_deck_dial_mode(&app_settings) == "gain" {
        String::from("fader")
    } else {
        String::from("gain")
    };
    set_settings_owned(
        db_path,
        &[(String::from(AUDIO_DECK_DIAL_MODE_KEY), next.clone())],
    )
    .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    Ok(json!({ "dialMode": next }))
}

fn handle_audio_dim_toggle(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let main = audio_main_mix_target(&snapshot).ok_or_else(|| {
        ControlSurfaceError::Rejected(String::from("No main output mix target is available."))
    })?;
    let mut request = audio_mix_target_update_request(&main.id);
    request.dim = Some(!main.dim);
    let updated = update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(json!({ "mixTargetId": updated.id, "dim": updated.dim }))
}

fn handle_audio_talk(db_path: &Path, engage: bool) -> Result<Value, ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    let main = audio_main_mix_target(&snapshot).ok_or_else(|| {
        ControlSurfaceError::Rejected(String::from("No main output mix target is available."))
    })?;
    let main_id = main.id.clone();
    let currently_on = main.talkback;

    if engage {
        ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
        arm_audio_talk_watchdog(db_path);
        if !currently_on {
            let mut request = audio_mix_target_update_request(&main_id);
            request.talkback = Some(true);
            update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
        }
        Ok(json!({ "mixTargetId": main_id, "talkback": true }))
    } else {
        clear_audio_talk_deadline(db_path);
        if currently_on {
            let mut request = audio_mix_target_update_request(&main_id);
            request.talkback = Some(false);
            update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
        }
        Ok(json!({ "mixTargetId": main_id, "talkback": false }))
    }
}

fn handle_audio_solo_clear_all(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let soloed = snapshot.channels.iter().filter(|entry| entry.solo).count();
    clear_all_audio_solo(db_path).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(json!({ "cleared": soloed }))
}

fn arm_audio_talk_watchdog(db_path: &Path) {
    let deadlines = AUDIO_TALK_DEADLINES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut deadlines) = deadlines.lock() {
        deadlines.insert(
            db_path.to_path_buf(),
            Instant::now() + AUDIO_DECK_TALK_RELEASE,
        );
    }
    AUDIO_TALK_WATCHDOG.get_or_init(|| {
        thread::spawn(run_audio_talk_watchdog);
    });
}

fn clear_audio_talk_deadline(db_path: &Path) {
    if let Some(deadlines) = AUDIO_TALK_DEADLINES.get() {
        if let Ok(mut deadlines) = deadlines.lock() {
            deadlines.remove(db_path);
        }
    }
}

fn run_audio_talk_watchdog() {
    loop {
        thread::sleep(Duration::from_millis(250));
        let Some(deadlines) = AUDIO_TALK_DEADLINES.get() else {
            continue;
        };
        let expired: Vec<PathBuf> = {
            let Ok(mut deadlines) = deadlines.lock() else {
                continue;
            };
            let now = Instant::now();
            let expired = deadlines
                .iter()
                .filter(|(_, deadline)| now >= **deadline)
                .map(|(path, _)| path.clone())
                .collect::<Vec<_>>();
            for path in &expired {
                deadlines.remove(path);
            }
            expired
        };
        for db_path in expired {
            if let Err(error) = release_audio_talkback(&db_path) {
                eprintln!(
                    "Control-surface talkback watchdog release failed: {}",
                    error.message()
                );
            }
        }
    }
}

fn release_audio_talkback(db_path: &Path) -> Result<(), ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    let Some(main) = audio_main_mix_target(&snapshot) else {
        return Ok(());
    };
    if !main.talkback {
        return Ok(());
    }
    let mut request = audio_mix_target_update_request(&main.id);
    request.talkback = Some(false);
    update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(())
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

fn map_planning_error(error: PlanningCommandError) -> ControlSurfaceError {
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

fn save_lighting_deck_state(
    db_path: &Path,
    state: &LightingDeckState,
) -> Result<(), ControlSurfaceError> {
    save_lighting_editor_state(db_path, state).map_err(map_lighting_error)
}

fn load_lighting_deck_state(
    settings: &HashMap<String, String>,
    _lighting_snapshot: &crate::lighting::LightingSnapshot,
) -> LightingDeckState {
    load_lighting_editor_state(settings)
}

fn selected_lighting_fixture_mut<'a>(
    settings: &HashMap<String, String>,
    state: &'a mut LightingDeckState,
) -> Result<&'a mut LightingDeckFixtureState, ControlSurfaceError> {
    let selected_light_id = resolve_selected_inventory_id(
        settings,
        SELECTED_LIGHT_ID_KEY,
        state.fixtures.iter().map(|fixture| fixture.id.as_str()),
    );
    let selected_light_id = selected_light_id.ok_or_else(|| {
        ControlSurfaceError::Rejected(String::from("No lighting fixture is available."))
    })?;
    state
        .fixtures
        .iter_mut()
        .find(|fixture| fixture.id == selected_light_id)
        .ok_or_else(|| {
            ControlSurfaceError::Rejected(String::from("Selected lighting fixture was not found."))
        })
}

fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

fn truncate(value: &str, max_chars: usize) -> String {
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

fn cycle_value(values: &[&str], current: &str, forward: bool) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::initialize_database;
    use std::fs;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
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

        fn db_path(&self) -> PathBuf {
            self.path.join("native.sqlite3")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn ready_audio_test_db(label: &str) -> TestDir {
        let test_dir = TestDir::new(label);
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
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

    fn audio_snapshot_for(test_dir: &TestDir) -> AudioSnapshot {
        current_audio_snapshot(test_dir.db_path().as_path())
            .expect("audio snapshot should load")
            .1
    }

    #[test]
    fn truncate_preserves_short_text() {
        assert_eq!(truncate("Host Mic", 12), "Host Mic");
    }

    #[test]
    fn truncate_limits_long_text() {
        assert_eq!(truncate("Very Long Fixture Name", 12), "Very Long Fi");
    }

    #[test]
    fn cycle_value_wraps_forward() {
        assert_eq!(cycle_value(PROJECT_STATUS_CYCLE, "done", true), "todo");
    }

    #[test]
    fn cycle_value_wraps_backward() {
        assert_eq!(cycle_value(PROJECT_STATUS_CYCLE, "todo", false), "done");
    }

    #[test]
    fn audio_deck_bank_defaults_to_inputs_and_validates() {
        assert_eq!(audio_deck_bank(&HashMap::new()), "inputs");
        assert_eq!(
            audio_deck_bank(&HashMap::from([(
                String::from(AUDIO_DECK_BANK_KEY),
                String::from("playback"),
            )])),
            "playback"
        );
        assert_eq!(
            audio_deck_bank(&HashMap::from([(
                String::from(AUDIO_DECK_BANK_KEY),
                String::from("nonsense"),
            )])),
            "inputs"
        );
        assert_eq!(audio_deck_dial_mode(&HashMap::new()), "fader");
    }

    #[test]
    fn resolve_audio_deck_strip_maps_the_three_banks() {
        let snapshot = read_audio_snapshot(&HashMap::new());

        let inputs = (1..=4)
            .map(
                |strip| match resolve_audio_deck_strip(&snapshot, "inputs", strip) {
                    Ok(AudioDeckStrip::Channel(channel)) => channel.id,
                    other => panic!("input strip {strip} should resolve to a channel: {other:?}"),
                },
            )
            .collect::<Vec<_>>();
        assert_eq!(
            inputs,
            vec![
                "audio-input-9",
                "audio-input-10",
                "audio-input-11",
                "audio-input-12"
            ]
        );

        let playback = (1..=4)
            .map(
                |strip| match resolve_audio_deck_strip(&snapshot, "playback", strip) {
                    Ok(AudioDeckStrip::Channel(channel)) => channel.id,
                    other => {
                        panic!("playback strip {strip} should resolve to a channel: {other:?}")
                    }
                },
            )
            .collect::<Vec<_>>();
        assert_eq!(
            playback,
            vec![
                "audio-playback-1-2",
                "audio-playback-3-4",
                "audio-playback-5-6",
                "audio-playback-7-8"
            ]
        );

        let outputs = (1..=3)
            .map(
                |strip| match resolve_audio_deck_strip(&snapshot, "outputs", strip) {
                    Ok(AudioDeckStrip::MixTarget(target)) => target.id,
                    other => {
                        panic!("output strip {strip} should resolve to a mix target: {other:?}")
                    }
                },
            )
            .collect::<Vec<_>>();
        assert_eq!(
            outputs,
            vec!["audio-mix-main", "audio-mix-phones-a", "audio-mix-phones-b"]
        );
        assert!(matches!(
            resolve_audio_deck_strip(&snapshot, "outputs", 4),
            Err(ControlSurfaceError::Rejected(_))
        ));
    }

    #[test]
    fn audio_dial_turn_is_gated_until_probe_passes() {
        let test_dir = TestDir::new("gated");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

        let error = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect_err("dial turn should be gated");
        assert!(matches!(error, ControlSurfaceError::Rejected(_)));

        let snapshot = audio_snapshot_for(&test_dir);
        assert_eq!(snapshot.last_action_status, "failed");
        assert_eq!(
            snapshot.last_action_code.as_deref(),
            Some("AUDIO_NOT_VERIFIED")
        );
    }

    #[test]
    fn audio_dial_turn_moves_the_selected_send_level() {
        let test_dir = ready_audio_test_db("dial-turn");
        let before = audio_snapshot_for(&test_dir);
        let target_id = before.selected_mix_target_id.clone();
        let channel = before
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist")
            .clone();
        let current = channel
            .mix_levels
            .get(&target_id)
            .copied()
            .unwrap_or(channel.fader);

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("dial turn should succeed");
        assert_eq!(result["channelId"], "audio-input-9");
        assert_eq!(result["mixTargetId"], target_id.as_str());
        let reported = result["fader"].as_f64().expect("fader should be numeric");
        assert!((reported - (current + AUDIO_DECK_FADER_STEP)).abs() < 1e-9);

        let after = audio_snapshot_for(&test_dir);
        let updated = after
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist");
        let level = updated
            .mix_levels
            .get(&target_id)
            .copied()
            .expect("send level should be recorded for the selected mix target");
        assert!((level - (current + AUDIO_DECK_FADER_STEP)).abs() < 1e-9);
    }

    #[test]
    fn audio_dial_turn_acceleration_uses_fast_window() {
        let t0 = Instant::now();
        assert_eq!(audio_dial_turn_multiplier("accel-test|inputs|1", t0), 1.0);
        assert_eq!(
            audio_dial_turn_multiplier("accel-test|inputs|1", t0 + Duration::from_millis(10)),
            AUDIO_DECK_FAST_TURN_MULTIPLIER
        );
        assert_eq!(
            audio_dial_turn_multiplier("accel-test|inputs|1", t0 + Duration::from_millis(500)),
            1.0
        );
        assert_eq!(
            audio_dial_turn_multiplier("accel-test|inputs|2", t0 + Duration::from_millis(505)),
            1.0
        );
    }

    #[test]
    fn audio_dial_press_toggles_channel_mute_through_the_real_path() {
        let test_dir = ready_audio_test_db("dial-press");
        let before = audio_snapshot_for(&test_dir);
        let was_muted = before
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist")
            .mute;

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialPress", Some("1"))
            .expect("dial press should succeed");
        assert_eq!(result["mute"], !was_muted);

        let after = audio_snapshot_for(&test_dir);
        assert_eq!(
            after
                .channels
                .iter()
                .find(|entry| entry.id == "audio-input-9")
                .expect("host input should exist")
                .mute,
            !was_muted
        );

        let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load");
        assert!(
            !settings.contains_key("app.control_surface.audio.state"),
            "the legacy deck shadow state must stay deleted"
        );
    }

    #[test]
    fn audio_strip_tap_selects_the_channel_for_the_inspector() {
        let test_dir = ready_audio_test_db("strip-tap");
        let result = handle_audio_action(test_dir.db_path().as_path(), "stripTap", Some("2"))
            .expect("strip tap should succeed");
        assert_eq!(result["selectedChannelId"], "audio-input-10");

        let after = audio_snapshot_for(&test_dir);
        assert_eq!(after.selected_channel_id.as_deref(), Some("audio-input-10"));
    }

    #[test]
    fn audio_set_mix_target_shares_selection_and_retargets_dials() {
        let test_dir = ready_audio_test_db("mix-target");
        let result = handle_audio_action(
            test_dir.db_path().as_path(),
            "setMixTarget",
            Some("phones-a"),
        )
        .expect("set mix target should succeed");
        assert_eq!(result["selectedMixTargetId"], "audio-mix-phones-a");

        let after = audio_snapshot_for(&test_dir);
        assert_eq!(after.selected_mix_target_id, "audio-mix-phones-a");

        handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("dial turn should succeed");
        let final_snapshot = audio_snapshot_for(&test_dir);
        let channel = final_snapshot
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist");
        assert!(
            channel.mix_levels.contains_key("audio-mix-phones-a"),
            "the dial should now write the phones-a send"
        );
    }

    #[test]
    fn audio_cycle_bank_reaches_outputs_and_rides_output_volume() {
        let test_dir = ready_audio_test_db("bank-outputs");
        assert_eq!(
            handle_audio_action(test_dir.db_path().as_path(), "cycleBank", None)
                .expect("cycle should succeed")["bank"],
            "playback"
        );
        assert_eq!(
            handle_audio_action(test_dir.db_path().as_path(), "cycleBank", None)
                .expect("cycle should succeed")["bank"],
            "outputs"
        );

        let before = audio_snapshot_for(&test_dir);
        let main_volume = before
            .mix_targets
            .iter()
            .find(|entry| entry.id == "audio-mix-main")
            .expect("main mix should exist")
            .volume;

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("output dial turn should succeed");
        assert_eq!(result["mixTargetId"], "audio-mix-main");
        let reported = result["volume"].as_f64().expect("volume should be numeric");
        assert!((reported - (main_volume + AUDIO_DECK_FADER_STEP)).abs() < 1e-9);

        assert!(matches!(
            handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("4:up")),
            Err(ControlSurfaceError::Rejected(_))
        ));
    }

    #[test]
    fn audio_gain_mode_steps_one_whole_db_and_clamps() {
        let test_dir = ready_audio_test_db("gain-mode");
        assert_eq!(
            handle_audio_action(test_dir.db_path().as_path(), "toggleDialMode", None)
                .expect("mode toggle should succeed")["dialMode"],
            "gain"
        );

        let before = audio_snapshot_for(&test_dir);
        let gain = before
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist")
            .gain;

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("gain turn should succeed");
        assert_eq!(result["gain"], gain + 1);

        let mut request = audio_channel_update_request("audio-input-9");
        request.gain = Some(AUDIO_PREAMP_GAIN_MAX);
        update_audio_channel(test_dir.db_path().as_path(), &request)
            .expect("gain should force to max");
        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("gain turn at max should clamp");
        assert_eq!(result["gain"], AUDIO_PREAMP_GAIN_MAX);
    }

    #[test]
    fn audio_talk_on_off_drives_main_talkback() {
        let test_dir = ready_audio_test_db("talkback");
        let result = handle_audio_action(test_dir.db_path().as_path(), "talkOn", None)
            .expect("talk on should succeed");
        assert_eq!(result["talkback"], true);
        assert!(
            audio_snapshot_for(&test_dir)
                .mix_targets
                .iter()
                .find(|entry| entry.id == "audio-mix-main")
                .expect("main mix should exist")
                .talkback
        );

        let result = handle_audio_action(test_dir.db_path().as_path(), "talkOff", None)
            .expect("talk off should succeed");
        assert_eq!(result["talkback"], false);
        assert!(
            !audio_snapshot_for(&test_dir)
                .mix_targets
                .iter()
                .find(|entry| entry.id == "audio-mix-main")
                .expect("main mix should exist")
                .talkback
        );
    }

    #[test]
    fn audio_talk_watchdog_release_clears_live_talkback() {
        let test_dir = ready_audio_test_db("talk-release");
        handle_audio_action(test_dir.db_path().as_path(), "talkOn", None)
            .expect("talk on should succeed");
        clear_audio_talk_deadline(test_dir.db_path().as_path());

        release_audio_talkback(test_dir.db_path().as_path())
            .expect("watchdog release should succeed");
        assert!(
            !audio_snapshot_for(&test_dir)
                .mix_targets
                .iter()
                .find(|entry| entry.id == "audio-mix-main")
                .expect("main mix should exist")
                .talkback
        );
    }

    #[test]
    fn audio_solo_clear_all_reports_cleared_count() {
        let test_dir = ready_audio_test_db("solo-clear");
        let mut request = audio_channel_update_request("audio-input-10");
        request.solo = Some(true);
        update_audio_channel(test_dir.db_path().as_path(), &request).expect("solo should engage");

        let result = handle_audio_action(test_dir.db_path().as_path(), "soloClearAll", None)
            .expect("solo clear should succeed");
        assert_eq!(result["cleared"], 1);
        assert!(audio_snapshot_for(&test_dir)
            .channels
            .iter()
            .all(|entry| !entry.solo));
    }

    #[test]
    fn audio_fader_db_label_mirrors_the_app_curve() {
        assert_eq!(audio_fader_db_label(0.0), "-\u{221e} dB");
        assert_eq!(audio_fader_db_label(0.35), "-35.0 dB");
        assert_eq!(audio_fader_db_label(0.7), "-10.0 dB");
        assert_eq!(audio_fader_db_label(0.75), "-5.0 dB");
        assert_eq!(audio_fader_db_label(0.8), "+0.0 dB");
        assert_eq!(audio_fader_db_label(0.9), "+3.0 dB");
        assert_eq!(audio_fader_db_label(1.0), "+6.0 dB");
    }

    #[test]
    fn audio_strip_lcd_shows_gate_reason_until_verified() {
        let test_dir = TestDir::new("lcd-gated");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

        let text = read_control_surface_lcd_text(test_dir.db_path().as_path(), "audio_strip_1")
            .expect("lcd text should render");
        assert_eq!(text, "AUDIO\\nNOT VERIFIED");
        let key_text = read_control_surface_lcd_text(test_dir.db_path().as_path(), "audio_key_5")
            .expect("lcd text should render");
        assert_eq!(key_text, "DIM\\n--");
    }

    #[test]
    fn audio_strip_lcd_renders_live_state_with_selection_and_mute() {
        let test_dir = ready_audio_test_db("lcd-live");
        let db_path = test_dir.db_path();

        let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
            .expect("lcd text should render");
        assert!(
            text.contains("Host"),
            "strip should name the channel: {text}"
        );
        assert!(text.contains("dB"), "strip should show a level: {text}");
        assert!(
            text.contains("\u{2192}MAIN"),
            "strip should show the active target: {text}"
        );

        handle_audio_action(db_path.as_path(), "stripTap", Some("1"))
            .expect("tap should select the strip");
        let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
            .expect("lcd text should render");
        assert!(
            text.starts_with("\u{2022} Host"),
            "selected strip should carry the marker: {text}"
        );

        handle_audio_action(db_path.as_path(), "dialPress", Some("1")).expect("mute should engage");
        let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
            .expect("lcd text should render");
        assert!(
            text.contains("MUTED"),
            "muted strip should say MUTED instead of a level: {text}"
        );

        handle_audio_action(db_path.as_path(), "toggleDialMode", None)
            .expect("gain mode should engage");
        let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
            .expect("lcd text should render");
        assert!(
            text.contains("GAIN 34 dB"),
            "gain mode should show the preamp gain: {text}"
        );
    }

    #[test]
    fn audio_key_lcd_reflects_target_bank_and_talk() {
        let test_dir = ready_audio_test_db("lcd-keys");
        let db_path = test_dir.db_path();

        assert_eq!(
            read_control_surface_lcd_text(db_path.as_path(), "audio_key_1")
                .expect("lcd text should render"),
            "\u{2192} MAIN\\n\u{25cf} ACTIVE"
        );
        assert_eq!(
            read_control_surface_lcd_text(db_path.as_path(), "audio_key_2")
                .expect("lcd text should render"),
            "\u{2192} PH1\\n"
        );

        handle_audio_action(db_path.as_path(), "setMixTarget", Some("phones-a"))
            .expect("target switch should succeed");
        assert_eq!(
            read_control_surface_lcd_text(db_path.as_path(), "audio_key_2")
                .expect("lcd text should render"),
            "\u{2192} PH1\\n\u{25cf} ACTIVE"
        );

        assert_eq!(
            read_control_surface_lcd_text(db_path.as_path(), "audio_key_4")
                .expect("lcd text should render"),
            "BANK\\nINPUTS"
        );
        assert_eq!(
            read_control_surface_lcd_text(db_path.as_path(), "audio_key_7")
                .expect("lcd text should render"),
            "TALK\\nHOLD"
        );
        handle_audio_action(db_path.as_path(), "talkOn", None).expect("talk should engage");
        assert_eq!(
            read_control_surface_lcd_text(db_path.as_path(), "audio_key_7")
                .expect("lcd text should render"),
            "TALK\\nLIVE"
        );
        handle_audio_action(db_path.as_path(), "talkOff", None).expect("talk should release");

        assert_eq!(
            read_control_surface_lcd_text(db_path.as_path(), "audio_key_8")
                .expect("lcd text should render"),
            "SOLO\\nCLEAR"
        );
    }

    #[test]
    fn workspace_lcd_key_reads_shell_workspace() {
        let test_dir = TestDir::new("workspace-key");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

        assert_eq!(
            read_control_surface_lcd_text(test_dir.db_path().as_path(), "workspace")
                .expect("workspace key should render"),
            DEFAULT_WORKSPACE
        );

        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(String::from(WORKSPACE_KEY), String::from("audio"))],
        )
        .expect("workspace should persist");
        assert_eq!(
            read_control_surface_lcd_text(test_dir.db_path().as_path(), "workspace")
                .expect("workspace key should render"),
            "audio"
        );
    }

    #[test]
    fn context_includes_workspace_and_audio_deck_block() {
        let test_dir = ready_audio_test_db("context-audio");
        let db_path = test_dir.db_path();

        let context = read_control_surface_context(db_path.as_path()).expect("context should load");
        assert_eq!(context["workspace"], DEFAULT_WORKSPACE);
        assert_eq!(context["audio"]["bank"], "inputs");
        assert_eq!(context["audio"]["gated"], false);
        let strips = context["audio"]["strips"]
            .as_array()
            .expect("strips should be an array");
        assert_eq!(strips.len(), 4);
        assert_eq!(strips[0]["id"], "audio-input-9");

        handle_audio_action(db_path.as_path(), "cycleBank", None).expect("cycle should succeed");
        handle_audio_action(db_path.as_path(), "cycleBank", None).expect("cycle should succeed");
        let context = read_control_surface_context(db_path.as_path()).expect("context should load");
        assert_eq!(context["audio"]["bank"], "outputs");
        assert_eq!(context["audio"]["strips"][3]["kind"], "empty");
    }

    #[test]
    fn legacy_audio_lcd_keys_are_gone() {
        let test_dir = ready_audio_test_db("lcd-legacy");
        assert!(matches!(
            read_control_surface_lcd_text(test_dir.db_path().as_path(), "audio_ch_nav"),
            Err(ControlSurfaceError::InvalidParams(_))
        ));
    }
}
