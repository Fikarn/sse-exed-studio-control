mod engine;

use engine::{EngineBootstrapSummary, EngineBridge};
use serde_json::Value;
use studio_control_protocol::RequestEnvelope;
use std::collections::BTreeMap;
use std::env;
use std::fs::{create_dir_all, read_to_string, write};
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
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

fn optional_env_path(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn current_runtime_paths() -> BTreeMap<String, String> {
    let app_data_dir = optional_env_path("SSE_APP_DATA_DIR")
        .unwrap_or_else(|| std::env::temp_dir().join("sse-exed-tauri").join("app-data").display().to_string());
    let logs_dir = optional_env_path("SSE_LOG_DIR")
        .unwrap_or_else(|| PathBuf::from(&app_data_dir).join("logs").display().to_string());
    let backup_dir = PathBuf::from(&app_data_dir).join("backups");
    let db_path = PathBuf::from(&app_data_dir).join("studio-control.sqlite3");
    let log_file_path = PathBuf::from(&logs_dir).join("engine.log");

    let mut paths = BTreeMap::from([
        ("appDataDir".to_string(), app_data_dir),
        ("backupDir".to_string(), backup_dir.display().to_string()),
        ("dbPath".to_string(), db_path.display().to_string()),
        ("logFilePath".to_string(), log_file_path.display().to_string()),
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
fn engine_request(state: tauri::State<'_, EngineState>, request: RequestEnvelope) -> Result<studio_control_protocol::ResponseEnvelope, String> {
    state.bridge.request(request)
}

#[tauri::command]
fn engine_stop(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    state.bridge.stop()
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
    let output_dir = directory
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("sse-exed-tauri").join("diagnostics"));

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
    write(&output_path, payload)
        .map_err(|error| format!("Failed to write shell test status {}: {error}", output_path.display()))?;

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

    let payload = read_to_string(&input_path)
        .map_err(|error| format!("Failed to read shell test command {}: {error}", input_path.display()))?;
    if payload.trim().is_empty() {
        return Ok(None);
    }

    let command = serde_json::from_str::<Value>(&payload)
        .map_err(|error| format!("Failed to parse shell test command {}: {error}", input_path.display()))?;
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

    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let work_area = monitor.work_area();
    let target_width = window_size.width.min(work_area.size.width);
    let target_height = window_size.height.min(work_area.size.height);
    let target_x = work_area.position.x + ((work_area.size.width as i32 - target_width as i32) / 2).max(0);
    let target_y = work_area.position.y + ((work_area.size.height as i32 - target_height as i32) / 2).max(0);

    let _ = window.set_size(PhysicalSize::new(target_width, target_height));
    let _ = window.set_position(PhysicalPosition::new(target_x, target_y));
}

fn main() {
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
            shell_open_path,
            shell_export_diagnostics,
            shell_test_bridge_config,
            shell_test_bridge_write_status,
            shell_test_bridge_read_command
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri shell");
}
