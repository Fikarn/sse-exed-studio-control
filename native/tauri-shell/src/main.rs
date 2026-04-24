mod engine;

use engine::{EngineBootstrapSummary, EngineBridge};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fs::{create_dir_all, read_to_string, write};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use studio_control_protocol::RequestEnvelope;
use tauri::{Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

struct EngineState {
    bridge: EngineBridge,
}

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

fn read_arg_value(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    args.iter()
        .find_map(|value| value.strip_prefix(&prefix).map(ToString::to_string))
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
    let app_data_dir = optional_env_path("SSE_APP_DATA_DIR").unwrap_or_else(|| {
        std::env::temp_dir()
            .join("sse-exed-tauri")
            .join("app-data")
            .display()
            .to_string()
    });
    let logs_dir = optional_env_path("SSE_LOG_DIR").unwrap_or_else(|| {
        PathBuf::from(&app_data_dir)
            .join("logs")
            .display()
            .to_string()
    });
    let backup_dir = PathBuf::from(&app_data_dir).join("backups");
    let db_path = PathBuf::from(&app_data_dir).join("studio-control.sqlite3");
    let log_file_path = PathBuf::from(&logs_dir).join("engine.log");

    let mut paths = BTreeMap::from([
        ("appDataDir".to_string(), app_data_dir),
        ("backupDir".to_string(), backup_dir.display().to_string()),
        ("dbPath".to_string(), db_path.display().to_string()),
        (
            "logFilePath".to_string(),
            log_file_path.display().to_string(),
        ),
        ("logsDir".to_string(), logs_dir),
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
        std::env::temp_dir()
            .join("sse-exed-tauri")
            .join("diagnostics")
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

fn route_window_to_preferred_monitor(window: &WebviewWindow) {
    let Some(monitor) = preferred_review_monitor(window) else {
        return;
    };

    let _ = window.set_fullscreen(false);
    let _ = window.set_position(PhysicalPosition::new(
        monitor.position().x,
        monitor.position().y,
    ));
    let _ = window.set_size(PhysicalSize::new(
        monitor.size().width,
        monitor.size().height,
    ));
    let _ = window.set_fullscreen(true);
}

fn main() {
    let args = env::args().collect::<Vec<_>>();
    if args.iter().any(|value| value == "--smoke-test") {
        std::process::exit(run_smoke_test(&args));
    }

    tauri::Builder::default()
        .manage(EngineState {
            bridge: EngineBridge::default(),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                route_window_to_preferred_monitor(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_start,
            engine_request,
            engine_stop,
            engine_summary,
            shell_open_path,
            shell_export_diagnostics,
            shell_test_bridge_config,
            shell_test_bridge_write_status,
            shell_test_bridge_read_command
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri shell");
}
