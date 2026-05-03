mod engine;

use engine::{EngineBootstrapSummary, EngineBridge};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fs::{create_dir_all, read_to_string, remove_file, write};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use studio_control_protocol::RequestEnvelope;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize,
    WebviewWindow,
};

struct EngineState {
    bridge: EngineBridge,
}

#[cfg(feature = "test-bridge")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellTestBridgeConfig {
    command_path: Option<String>,
    status_path: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellStartupFailure {
    code: String,
    message: String,
    paths: BTreeMap<String, String>,
    stage: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum ShellLaunchMode {
    StudioFullscreen,
    Windowed,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogicalSizeSnapshot {
    width: f64,
    height: f64,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogicalPositionSnapshot {
    x: f64,
    y: f64,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorSnapshot {
    name: Option<String>,
    physical_position: LogicalPositionSnapshot,
    physical_size: LogicalSizeSnapshot,
    logical_size: LogicalSizeSnapshot,
    scale_factor: f64,
}

#[derive(Clone)]
struct AvailableMonitorSnapshot {
    name: Option<String>,
    physical_position: LogicalPositionSnapshot,
    physical_size: LogicalSizeSnapshot,
    scale_factor: f64,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellWindowPreferences {
    launch_mode: ShellLaunchMode,
    last_logical_size: Option<LogicalSizeSnapshot>,
    last_logical_position: Option<LogicalPositionSnapshot>,
    fullscreen: bool,
    monitor: Option<MonitorSnapshot>,
    scale_factor: Option<f64>,
    updated_at_epoch_seconds: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SavedWindowRecoveryAction {
    FallbackWindowed,
    Restore {
        launch_mode: ShellLaunchMode,
        monitor_index: usize,
    },
}

fn read_arg_value(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    args.iter()
        .find_map(|value| value.strip_prefix(&prefix).map(ToString::to_string))
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn window_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve Tauri config directory: {error}"))?;
    Ok(config_dir.join("shell-window-layout.json"))
}

fn read_window_preferences(app: &AppHandle) -> Option<ShellWindowPreferences> {
    let path = window_preferences_path(app).ok()?;
    let payload = read_to_string(path).ok()?;
    serde_json::from_str(&payload).ok()
}

fn write_window_preferences(
    app: &AppHandle,
    preferences: &ShellWindowPreferences,
) -> Result<(), String> {
    let path = window_preferences_path(app)?;
    if let Some(parent) = path.parent() {
        create_dir_all(parent)
            .map_err(|error| format!("Failed to create shell config directory: {error}"))?;
    }
    let payload = serde_json::to_vec_pretty(preferences)
        .map_err(|error| format!("Failed to serialize shell window preferences: {error}"))?;
    write(&path, payload).map_err(|error| {
        format!(
            "Failed to write shell window preferences {}: {error}",
            path.display()
        )
    })
}

fn remove_window_preferences(app: &AppHandle) -> Result<(), String> {
    let path = window_preferences_path(app)?;
    if path.exists() {
        remove_file(&path).map_err(|error| {
            format!(
                "Failed to remove shell window preferences {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn logical_monitor_size(monitor: &Monitor) -> LogicalSizeSnapshot {
    let scale_factor = monitor.scale_factor();
    LogicalSizeSnapshot {
        width: monitor.size().width as f64 / scale_factor,
        height: monitor.size().height as f64 / scale_factor,
    }
}

fn monitor_snapshot(monitor: &Monitor) -> MonitorSnapshot {
    MonitorSnapshot {
        name: monitor.name().cloned(),
        physical_position: LogicalPositionSnapshot {
            x: monitor.position().x as f64,
            y: monitor.position().y as f64,
        },
        physical_size: LogicalSizeSnapshot {
            width: monitor.size().width as f64,
            height: monitor.size().height as f64,
        },
        logical_size: logical_monitor_size(monitor),
        scale_factor: monitor.scale_factor(),
    }
}

fn available_monitor_snapshot(monitor: &Monitor) -> AvailableMonitorSnapshot {
    AvailableMonitorSnapshot {
        name: monitor.name().cloned(),
        physical_position: LogicalPositionSnapshot {
            x: monitor.position().x as f64,
            y: monitor.position().y as f64,
        },
        physical_size: LogicalSizeSnapshot {
            width: monitor.size().width as f64,
            height: monitor.size().height as f64,
        },
        scale_factor: monitor.scale_factor(),
    }
}

fn available_monitor_matches_snapshot(
    monitor: &AvailableMonitorSnapshot,
    saved: &MonitorSnapshot,
) -> bool {
    if saved
        .name
        .as_ref()
        .zip(monitor.name.as_ref())
        .is_some_and(|(saved_name, monitor_name)| saved_name == monitor_name)
    {
        return true;
    }

    let size_matches = (saved.physical_size.width - monitor.physical_size.width).abs() < 1.0
        && (saved.physical_size.height - monitor.physical_size.height).abs() < 1.0;
    let position_matches = (saved.physical_position.x - monitor.physical_position.x).abs() < 1.0
        && (saved.physical_position.y - monitor.physical_position.y).abs() < 1.0;
    let scale_matches = (saved.scale_factor - monitor.scale_factor).abs() < 0.01;

    size_matches && position_matches && scale_matches
}

fn saved_monitor_index_from_snapshots(
    monitors: &[AvailableMonitorSnapshot],
    saved: Option<&MonitorSnapshot>,
) -> Option<usize> {
    let saved = saved?;
    monitors
        .iter()
        .position(|monitor| available_monitor_matches_snapshot(monitor, saved))
}

fn saved_window_recovery_action(
    monitors: &[AvailableMonitorSnapshot],
    preferences: &ShellWindowPreferences,
) -> SavedWindowRecoveryAction {
    match saved_monitor_index_from_snapshots(monitors, preferences.monitor.as_ref()) {
        Some(monitor_index) => SavedWindowRecoveryAction::Restore {
            launch_mode: preferences.launch_mode,
            monitor_index,
        },
        None => SavedWindowRecoveryAction::FallbackWindowed,
    }
}

#[cfg(test)]
fn saved_monitor_is_unavailable(
    monitors: &[AvailableMonitorSnapshot],
    preferences: &ShellWindowPreferences,
) -> bool {
    preferences
        .monitor
        .as_ref()
        .is_some_and(|saved| saved_monitor_index_from_snapshots(monitors, Some(saved)).is_none())
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Main Tauri window is unavailable.".to_string())
}

fn window_scale_factor(window: &WebviewWindow) -> f64 {
    window
        .scale_factor()
        .ok()
        .filter(|scale| scale.is_finite() && *scale > 0.0)
        .or_else(|| {
            window
                .current_monitor()
                .ok()
                .flatten()
                .map(|monitor| monitor.scale_factor())
        })
        .unwrap_or(1.0)
}

fn capture_current_window_preferences(
    app: &AppHandle,
    window: &WebviewWindow,
    launch_mode_override: Option<ShellLaunchMode>,
) -> ShellWindowPreferences {
    let existing = read_window_preferences(app);
    let scale_factor = window_scale_factor(window);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let launch_mode = launch_mode_override
        .or_else(|| existing.as_ref().map(|preferences| preferences.launch_mode))
        .unwrap_or(if fullscreen {
            ShellLaunchMode::StudioFullscreen
        } else {
            ShellLaunchMode::Windowed
        });

    let last_logical_size = window.inner_size().ok().map(|size| LogicalSizeSnapshot {
        width: size.width as f64 / scale_factor,
        height: size.height as f64 / scale_factor,
    });
    let last_logical_position =
        window
            .outer_position()
            .ok()
            .map(|position| LogicalPositionSnapshot {
                x: position.x as f64 / scale_factor,
                y: position.y as f64 / scale_factor,
            });

    ShellWindowPreferences {
        launch_mode,
        last_logical_size,
        last_logical_position,
        fullscreen,
        monitor: window
            .current_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor_snapshot(&monitor)),
        scale_factor: Some(scale_factor),
        updated_at_epoch_seconds: now_epoch_seconds(),
    }
}

fn persist_current_window_preferences(
    app: &AppHandle,
    window: &WebviewWindow,
    launch_mode_override: Option<ShellLaunchMode>,
) {
    let preferences = capture_current_window_preferences(app, window, launch_mode_override);
    let _ = write_window_preferences(app, &preferences);
}

fn apply_centered_windowed_layout(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_fullscreen(false)
        .map_err(|error| format!("Failed to leave fullscreen: {error}"))?;
    window
        .set_size(LogicalSize::new(1600.0, 960.0))
        .map_err(|error| format!("Failed to set fallback window size: {error}"))?;
    window
        .center()
        .map_err(|error| format!("Failed to center fallback window: {error}"))?;
    window
        .show()
        .map_err(|error| format!("Failed to show fallback window: {error}"))
}

fn write_smoke_status(status_path: Option<&str>, status: Value) {
    let Some(path) = status_path else {
        return;
    };

    let output_path = PathBuf::from(path);
    if let Some(parent) = output_path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(payload) = serde_json::to_vec_pretty(&status) {
        let _ = write(output_path, payload);
    }
}

fn spawn_smoke_reader(stdout: std::process::ChildStdout) -> Receiver<Value> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let _ = sender.send(message);
        }
    });
    receiver
}

fn wait_for_smoke_message(receiver: &Receiver<Value>, deadline: Instant) -> Result<Value, String> {
    let now = Instant::now();
    if now >= deadline {
        return Err("Timed out waiting for engine smoke output.".to_string());
    }

    receiver
        .recv_timeout(deadline.saturating_duration_since(now))
        .map_err(|_| "Timed out waiting for engine smoke output.".to_string())
}

fn write_engine_request(
    stdin: &mut std::process::ChildStdin,
    id: &str,
    method: &str,
) -> Result<(), String> {
    serde_json::to_writer(
        &mut *stdin,
        &json!({
            "type": "request",
            "id": id,
            "method": method,
            "params": {}
        }),
    )
    .map_err(|error| format!("Failed to serialize smoke request: {error}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed to write smoke request: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Failed to flush smoke request: {error}"))?;
    Ok(())
}

fn wait_for_smoke_startup(receiver: &Receiver<Value>, deadline: Instant) -> Result<(), String> {
    loop {
        let message = wait_for_smoke_message(receiver, deadline)?;
        let message_type = message
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if message_type != "event" {
            continue;
        }

        let event = message
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if event == "engine.ready" {
            return Ok(());
        }

        if event == "engine.startupFailed" {
            return Err(format!(
                "Engine startup failed during Tauri smoke: {}",
                message
                    .get("payload")
                    .and_then(|payload| payload.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("unknown startup failure")
            ));
        }
    }
}

fn wait_for_smoke_response(
    receiver: &Receiver<Value>,
    id: &str,
    deadline: Instant,
) -> Result<Value, String> {
    loop {
        let message = wait_for_smoke_message(receiver, deadline)?;
        if message.get("type").and_then(Value::as_str) != Some("response") {
            continue;
        }
        if message.get("id").and_then(Value::as_str) != Some(id) {
            continue;
        }
        if message.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(format!("Engine smoke request '{id}' failed: {message}"));
        }
        return Ok(message.get("result").cloned().unwrap_or_else(|| json!({})));
    }
}

fn run_smoke_test(args: &[String]) -> i32 {
    let status_path = read_arg_value(args, "--smoke-status-path");
    let binary_path = match engine::resolve_engine_binary() {
        Ok(path) => path,
        Err(message) => {
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 1,
                    "error": message,
                }),
            );
            eprintln!("{message}");
            return 1;
        }
    };
    let (app_data_dir, logs_dir) = match engine::resolve_runtime_directories() {
        Ok(paths) => paths,
        Err(message) => {
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 1,
                    "startedEnginePath": binary_path.display().to_string(),
                    "error": message,
                }),
            );
            eprintln!("{message}");
            return 1;
        }
    };

    let result = (|| -> Result<Value, String> {
        create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        create_dir_all(&logs_dir).map_err(|error| error.to_string())?;

        let mut child = Command::new(&binary_path)
            .env(
                "SSE_PROTOCOL_VERSION",
                studio_control_protocol::PROTOCOL_VERSION,
            )
            .env("SSE_APP_DATA_DIR", &app_data_dir)
            .env("SSE_LOG_DIR", &logs_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("Failed to start engine: {error}"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Engine stdin was unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Engine stdout was unavailable.".to_string())?;
        let receiver = spawn_smoke_reader(stdout);
        let deadline = Instant::now() + Duration::from_secs(15);

        wait_for_smoke_startup(&receiver, deadline)?;
        write_engine_request(&mut stdin, "tauri-smoke-app-snapshot", "app.snapshot")?;
        let app_snapshot =
            wait_for_smoke_response(&receiver, "tauri-smoke-app-snapshot", deadline)?;
        drop(stdin);

        let stop_deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < stop_deadline {
            if child
                .try_wait()
                .map_err(|error| format!("Failed to wait for engine smoke exit: {error}"))?
                .is_some()
            {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        if child
            .try_wait()
            .map_err(|error| format!("Failed to wait for engine smoke exit: {error}"))?
            .is_none()
        {
            let _ = child.kill();
            let _ = child.wait();
        }

        Ok(app_snapshot)
    })();

    match result {
        Ok(app_snapshot) => {
            let target_surface = app_snapshot
                .get("startup")
                .and_then(|startup| startup.get("targetSurface"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 0,
                    "startedEnginePath": binary_path.display().to_string(),
                    "targetSurface": target_surface,
                    "appDataPath": app_data_dir.display().to_string(),
                    "logsPath": logs_dir.display().to_string(),
                    "protocol": studio_control_protocol::PROTOCOL_VERSION,
                }),
            );
            0
        }
        Err(message) => {
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 1,
                    "startedEnginePath": binary_path.display().to_string(),
                    "error": message,
                    "appDataPath": app_data_dir.display().to_string(),
                    "logsPath": logs_dir.display().to_string(),
                    "protocol": studio_control_protocol::PROTOCOL_VERSION,
                }),
            );
            eprintln!("{message}");
            1
        }
    }
}

fn optional_env_path(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn current_runtime_paths() -> BTreeMap<String, String> {
    let (app_data_dir, logs_dir) = engine::resolve_runtime_directories().unwrap_or_else(|_| {
        let app_data_dir = optional_env_path("SSE_APP_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("<unresolved app data directory>"));
        let logs_dir = optional_env_path("SSE_LOG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| app_data_dir.join("logs"));
        (app_data_dir, logs_dir)
    });
    let backup_dir = app_data_dir.join("backups");
    let db_path = app_data_dir.join("studio-control.sqlite3");
    let log_file_path = logs_dir.join("engine.log");

    let mut paths = BTreeMap::from([
        ("appDataDir".to_string(), app_data_dir.display().to_string()),
        ("backupDir".to_string(), backup_dir.display().to_string()),
        ("dbPath".to_string(), db_path.display().to_string()),
        (
            "logFilePath".to_string(),
            log_file_path.display().to_string(),
        ),
        ("logsDir".to_string(), logs_dir.display().to_string()),
    ]);

    if let Some(update_repository_path) = optional_env_path("SSE_UPDATE_REPOSITORY_PATH") {
        paths.insert("updateRepositoryPath".to_string(), update_repository_path);
    }

    paths
}

#[tauri::command]
fn engine_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineState>,
) -> Result<EngineBootstrapSummary, ShellStartupFailure> {
    state
        .bridge
        .start(&app)
        .map_err(|message| ShellStartupFailure {
            code: "BOOTSTRAP_FAILED".to_string(),
            message,
            paths: current_runtime_paths(),
            stage: "bootstrap".to_string(),
        })
}

#[tauri::command]
fn engine_request(
    state: tauri::State<'_, EngineState>,
    request: RequestEnvelope,
) -> Result<studio_control_protocol::ResponseEnvelope, String> {
    state.bridge.request(request)
}

#[tauri::command]
fn engine_stop(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    state.bridge.stop()
}

#[tauri::command]
fn engine_summary(
    state: tauri::State<'_, EngineState>,
) -> Result<Option<EngineBootstrapSummary>, String> {
    state.bridge.summary()
}

#[tauri::command]
fn shell_open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&target);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(&target);
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&target);
        command
    };

    command
        .spawn()
        .map_err(|error| format!("Failed to open path {}: {error}", target.display()))?;
    Ok(())
}

#[tauri::command]
fn shell_export_diagnostics(report: Value, directory: Option<String>) -> Result<String, String> {
    let output_dir = directory.map(PathBuf::from).unwrap_or_else(|| {
        engine::resolve_runtime_directories()
            .map(|(_, logs_dir)| logs_dir)
            .unwrap_or_else(|_| {
                std::env::temp_dir()
                    .join("sse-exed-tauri")
                    .join("diagnostics")
            })
    });

    if !output_dir.is_absolute() {
        return Err("Diagnostics directory must be an absolute path.".to_string());
    }

    create_dir_all(&output_dir)
        .map_err(|error| format!("Failed to create diagnostics directory: {error}"))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let output_path = output_dir.join(format!("shell-diagnostics-{timestamp}.json"));
    let payload = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("Failed to serialize diagnostics report: {error}"))?;

    write(&output_path, payload)
        .map_err(|error| format!("Failed to write diagnostics report: {error}"))?;

    Ok(output_path.display().to_string())
}

#[cfg(feature = "test-bridge")]
#[tauri::command]
fn shell_test_bridge_config() -> Option<ShellTestBridgeConfig> {
    let status_path = optional_env_path("SSE_TAURI_TEST_STATUS_PATH");
    let command_path = optional_env_path("SSE_TAURI_TEST_COMMAND_PATH");

    if status_path.is_none() && command_path.is_none() {
        return None;
    }

    Some(ShellTestBridgeConfig {
        command_path,
        status_path,
    })
}

#[cfg(feature = "test-bridge")]
#[tauri::command]
fn shell_test_bridge_write_status(status: Value) -> Result<(), String> {
    let status_path = optional_env_path("SSE_TAURI_TEST_STATUS_PATH")
        .ok_or_else(|| "Shell test status path is not configured.".to_string())?;
    let output_path = PathBuf::from(status_path);

    let parent = output_path
        .parent()
        .ok_or_else(|| "Shell test status path must include a parent directory.".to_string())?;
    create_dir_all(parent)
        .map_err(|error| format!("Failed to create shell test status directory: {error}"))?;

    let payload = serde_json::to_vec_pretty(&status)
        .map_err(|error| format!("Failed to serialize shell test status: {error}"))?;
    write(&output_path, payload).map_err(|error| {
        format!(
            "Failed to write shell test status {}: {error}",
            output_path.display()
        )
    })?;

    Ok(())
}

#[cfg(feature = "test-bridge")]
#[tauri::command]
fn shell_test_bridge_read_command() -> Result<Option<Value>, String> {
    let Some(command_path) = optional_env_path("SSE_TAURI_TEST_COMMAND_PATH") else {
        return Ok(None);
    };

    let input_path = PathBuf::from(command_path);
    if !input_path.exists() {
        return Ok(None);
    }

    let payload = read_to_string(&input_path).map_err(|error| {
        format!(
            "Failed to read shell test command {}: {error}",
            input_path.display()
        )
    })?;
    if payload.trim().is_empty() {
        return Ok(None);
    }

    let command = serde_json::from_str::<Value>(&payload).map_err(|error| {
        format!(
            "Failed to parse shell test command {}: {error}",
            input_path.display()
        )
    })?;
    Ok(Some(command))
}

fn monitor_matches_logical_size(monitor: &Monitor, target_width: u32, target_height: u32) -> bool {
    let scale_factor = monitor.scale_factor();
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return false;
    }

    let logical_width = (monitor.size().width as f64 / scale_factor).round() as u32;
    let logical_height = (monitor.size().height as f64 / scale_factor).round() as u32;
    logical_width == target_width && logical_height == target_height
}

fn preferred_review_monitor(window: &WebviewWindow) -> Option<Monitor> {
    let monitors = window.available_monitors().ok()?;
    monitors
        .iter()
        .find(|monitor| monitor_matches_logical_size(monitor, 2560, 1440))
        .cloned()
        .or_else(|| {
            monitors
                .iter()
                .find(|monitor| monitor_matches_logical_size(monitor, 1920, 1080))
                .cloned()
        })
}

fn route_window_to_monitor(window: &WebviewWindow, monitor: &Monitor) -> Result<(), String> {
    let _ = window.set_fullscreen(false);
    window
        .set_position(PhysicalPosition::new(
            monitor.position().x,
            monitor.position().y,
        ))
        .map_err(|error| format!("Failed to position window on monitor: {error}"))?;
    window
        .set_size(PhysicalSize::new(
            monitor.size().width,
            monitor.size().height,
        ))
        .map_err(|error| format!("Failed to size window for monitor: {error}"))?;
    window
        .set_fullscreen(true)
        .map_err(|error| format!("Failed to enter fullscreen: {error}"))
}

fn route_window_to_preferred_monitor(window: &WebviewWindow) -> Result<(), String> {
    let Some(monitor) = preferred_review_monitor(window) else {
        return apply_centered_windowed_layout(window);
    };

    route_window_to_monitor(window, &monitor)
}

fn restore_saved_window_layout(
    window: &WebviewWindow,
    preferences: &ShellWindowPreferences,
) -> Result<bool, String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Failed to list monitors for saved window restore: {error}"))?;
    let monitor_snapshots = monitors
        .iter()
        .map(available_monitor_snapshot)
        .collect::<Vec<_>>();

    let (launch_mode, monitor) = match saved_window_recovery_action(&monitor_snapshots, preferences)
    {
        SavedWindowRecoveryAction::FallbackWindowed => {
            apply_centered_windowed_layout(window)?;
            return Ok(false);
        }
        SavedWindowRecoveryAction::Restore {
            launch_mode,
            monitor_index,
        } => {
            let monitor = monitors.get(monitor_index).ok_or_else(|| {
                "Saved window monitor restore index was unavailable after matching.".to_string()
            })?;
            (launch_mode, monitor)
        }
    };

    match launch_mode {
        ShellLaunchMode::StudioFullscreen => {
            route_window_to_monitor(window, monitor)?;
            Ok(true)
        }
        ShellLaunchMode::Windowed => {
            window
                .set_fullscreen(false)
                .map_err(|error| format!("Failed to leave fullscreen: {error}"))?;
            if let Some(size) = preferences.last_logical_size.as_ref() {
                window
                    .set_size(LogicalSize::new(size.width, size.height))
                    .map_err(|error| format!("Failed to restore saved window size: {error}"))?;
            } else {
                window
                    .set_size(LogicalSize::new(1600.0, 960.0))
                    .map_err(|error| format!("Failed to set default window size: {error}"))?;
            }
            if let Some(position) = preferences.last_logical_position.as_ref() {
                window
                    .set_position(LogicalPosition::new(position.x, position.y))
                    .map_err(|error| format!("Failed to restore saved window position: {error}"))?;
            } else {
                window
                    .center()
                    .map_err(|error| format!("Failed to center restored window: {error}"))?;
            }
            window
                .show()
                .map_err(|error| format!("Failed to show restored window: {error}"))?;
            Ok(true)
        }
    }
}

fn restore_or_route_initial_window(app: &AppHandle, window: &WebviewWindow) {
    let restored = read_window_preferences(app)
        .as_ref()
        .map(|preferences| restore_saved_window_layout(window, preferences).unwrap_or(false));

    match restored {
        Some(true) => persist_current_window_preferences(app, window, None),
        Some(false) => {
            persist_current_window_preferences(app, window, Some(ShellLaunchMode::Windowed))
        }
        None => {
            if route_window_to_preferred_monitor(window).is_ok() {
                let mode = if window.is_fullscreen().unwrap_or(false) {
                    ShellLaunchMode::StudioFullscreen
                } else {
                    ShellLaunchMode::Windowed
                };
                persist_current_window_preferences(app, window, Some(mode));
            }
        }
    }
}

#[tauri::command]
fn shell_enter_studio_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    let monitor = preferred_review_monitor(&window)
        .or_else(|| window.current_monitor().ok().flatten())
        .ok_or_else(|| "No monitor is available for studio fullscreen.".to_string())?;
    route_window_to_monitor(&window, &monitor)?;
    persist_current_window_preferences(&app, &window, Some(ShellLaunchMode::StudioFullscreen));
    Ok(())
}

#[tauri::command]
fn shell_use_windowed_layout(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    apply_centered_windowed_layout(&window)?;
    persist_current_window_preferences(&app, &window, Some(ShellLaunchMode::Windowed));
    Ok(())
}

#[tauri::command]
fn shell_reset_window_layout(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    remove_window_preferences(&app)?;
    if let Some(monitor) = preferred_review_monitor(&window) {
        route_window_to_monitor(&window, &monitor)?;
        persist_current_window_preferences(&app, &window, Some(ShellLaunchMode::StudioFullscreen));
    } else {
        apply_centered_windowed_layout(&window)?;
        persist_current_window_preferences(&app, &window, Some(ShellLaunchMode::Windowed));
    }
    Ok(())
}

fn main() {
    let args = env::args().collect::<Vec<_>>();
    if args.iter().any(|value| value == "--smoke-test") {
        std::process::exit(run_smoke_test(&args));
    }

    let builder = tauri::Builder::default()
        .manage(EngineState {
            bridge: EngineBridge::default(),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let app_handle = app.handle().clone();
                restore_or_route_initial_window(&app_handle, &window);
                let window_for_events = window.clone();
                window.on_window_event(move |event| {
                    if !matches!(
                        event,
                        tauri::WindowEvent::Resized(_)
                            | tauri::WindowEvent::Moved(_)
                            | tauri::WindowEvent::ScaleFactorChanged { .. }
                            | tauri::WindowEvent::Focused(false)
                            | tauri::WindowEvent::CloseRequested { .. }
                    ) {
                        return;
                    }
                    persist_current_window_preferences(&app_handle, &window_for_events, None);
                });
            }
            Ok(())
        });

    #[cfg(feature = "test-bridge")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        engine_start,
        engine_request,
        engine_stop,
        engine_summary,
        shell_open_path,
        shell_export_diagnostics,
        shell_enter_studio_fullscreen,
        shell_use_windowed_layout,
        shell_reset_window_layout,
        shell_test_bridge_config,
        shell_test_bridge_write_status,
        shell_test_bridge_read_command
    ]);

    #[cfg(not(feature = "test-bridge"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        engine_start,
        engine_request,
        engine_stop,
        engine_summary,
        shell_open_path,
        shell_export_diagnostics,
        shell_enter_studio_fullscreen,
        shell_use_windowed_layout,
        shell_reset_window_layout
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("failed to run tauri shell");
}

#[cfg(test)]
mod shell_window_preferences_tests {
    use super::*;

    fn logical_size(width: f64, height: f64) -> LogicalSizeSnapshot {
        LogicalSizeSnapshot { width, height }
    }

    fn logical_position(x: f64, y: f64) -> LogicalPositionSnapshot {
        LogicalPositionSnapshot { x, y }
    }

    fn saved_monitor(
        name: Option<&str>,
        position: (f64, f64),
        physical_size: (f64, f64),
        scale_factor: f64,
    ) -> MonitorSnapshot {
        MonitorSnapshot {
            name: name.map(ToString::to_string),
            physical_position: logical_position(position.0, position.1),
            physical_size: logical_size(physical_size.0, physical_size.1),
            logical_size: logical_size(
                physical_size.0 / scale_factor,
                physical_size.1 / scale_factor,
            ),
            scale_factor,
        }
    }

    fn available_monitor(
        name: Option<&str>,
        position: (f64, f64),
        physical_size: (f64, f64),
        scale_factor: f64,
    ) -> AvailableMonitorSnapshot {
        AvailableMonitorSnapshot {
            name: name.map(ToString::to_string),
            physical_position: logical_position(position.0, position.1),
            physical_size: logical_size(physical_size.0, physical_size.1),
            scale_factor,
        }
    }

    fn preferences_with_monitor(monitor: Option<MonitorSnapshot>) -> ShellWindowPreferences {
        ShellWindowPreferences {
            launch_mode: ShellLaunchMode::StudioFullscreen,
            last_logical_size: Some(logical_size(2560.0, 1440.0)),
            last_logical_position: Some(logical_position(0.0, 0.0)),
            fullscreen: true,
            monitor,
            scale_factor: Some(1.0),
            updated_at_epoch_seconds: 1,
        }
    }

    #[test]
    fn shell_window_preferences_saved_monitor_missing_falls_back_to_windowed_layout() {
        let preferences = preferences_with_monitor(Some(saved_monitor(
            Some("Studio Review"),
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        )));
        let available = [available_monitor(
            Some("Laptop"),
            (0.0, 0.0),
            (1728.0, 1117.0),
            2.0,
        )];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            None
        );
        assert_eq!(
            saved_window_recovery_action(&available, &preferences),
            SavedWindowRecoveryAction::FallbackWindowed
        );
        assert!(saved_monitor_is_unavailable(&available, &preferences));
    }

    #[test]
    fn shell_window_preferences_saved_monitor_matches_by_name() {
        let preferences = preferences_with_monitor(Some(saved_monitor(
            Some("Studio Review"),
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        )));
        let available = [
            available_monitor(Some("Laptop"), (0.0, 0.0), (1728.0, 1117.0), 2.0),
            available_monitor(Some("Studio Review"), (100.0, 100.0), (1920.0, 1080.0), 2.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            Some(1)
        );
        assert_eq!(
            saved_window_recovery_action(&available, &preferences),
            SavedWindowRecoveryAction::Restore {
                launch_mode: ShellLaunchMode::StudioFullscreen,
                monitor_index: 1,
            }
        );
        assert!(!saved_monitor_is_unavailable(&available, &preferences));
    }

    #[test]
    fn shell_window_preferences_saved_monitor_matches_by_geometry_without_name() {
        let preferences = preferences_with_monitor(Some(saved_monitor(
            None,
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        )));
        let available = [
            available_monitor(Some("Laptop"), (0.0, 0.0), (1728.0, 1117.0), 2.0),
            available_monitor(Some("Renamed Studio"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            Some(1)
        );
        assert_eq!(
            saved_window_recovery_action(&available, &preferences),
            SavedWindowRecoveryAction::Restore {
                launch_mode: ShellLaunchMode::StudioFullscreen,
                monitor_index: 1,
            }
        );
        assert!(!saved_monitor_is_unavailable(&available, &preferences));
    }

    #[test]
    fn shell_window_preferences_without_saved_monitor_uses_safe_windowed_fallback() {
        let preferences = preferences_with_monitor(None);
        let available = [available_monitor(
            Some("Laptop"),
            (0.0, 0.0),
            (1728.0, 1117.0),
            2.0,
        )];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            None
        );
        assert_eq!(
            saved_window_recovery_action(&available, &preferences),
            SavedWindowRecoveryAction::FallbackWindowed
        );
        assert!(!saved_monitor_is_unavailable(&available, &preferences));
    }
}
