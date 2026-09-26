// Release builds are a GUI app: without this, the console-subsystem default
// opens a terminal on every launch and the engine child inherits it, spilling
// engine stderr onto the operator monitor. Dev builds keep the console.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod shell_log;

use engine::{EngineBootstrapSummary, EngineBridge};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fs::{canonicalize, create_dir_all, read_to_string, remove_file, write};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use studio_control_protocol::RequestEnvelope;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

struct EngineState {
    /// Shared with the blocking tasks the async commands hand their waits to
    /// (2026-09 production readiness, Slice 4 — finding F07).
    bridge: Arc<EngineBridge>,
    /// Set by `shell_confirm_close` once the operator confirmed the close
    /// dialog; the `CloseRequested` hook lets the window close only then
    /// (2026-09 audit Slice 11).
    close_confirmed: AtomicBool,
}

/// Raised on the main window when the operator asks to close it and the
/// close still needs confirming; the frontend answers with the dialog and
/// `shell_confirm_close`.
const SHELL_CLOSE_REQUESTED_EVENT: &str = "shell://close-requested";
/// Automation that must close the shell without a dialog sets this to `1`.
const SHELL_SKIP_CLOSE_CONFIRM_ENV: &str = "SSE_SHELL_SKIP_CLOSE_CONFIRM";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClosePolicy {
    /// Keep the window, ask the operator.
    Prevent,
    /// Let the close through.
    Allow,
}

/// Pure close policy: a close goes through once the operator confirmed it or
/// when automation opted out of the dialog; anything else is prevented and
/// turned into a `shell://close-requested` event.
fn close_policy(confirmed: bool, skip_confirm_env: Option<&str>) -> ClosePolicy {
    if confirmed || skip_confirm_env.map(str::trim) == Some("1") {
        ClosePolicy::Allow
    } else {
        ClosePolicy::Prevent
    }
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

/// `shell-window-layout.json`: the display the window was last on, where the
/// next launch shows the screen. New pages program, Slice SW (D22): the
/// windowed layout's fields (`launchMode`, `lastLogicalSize`,
/// `lastLogicalPosition`) are no longer written. A file an older build wrote
/// still loads — serde skips the fields this struct does not name — and
/// whichever layout it saved opens fullscreen on its display.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellWindowPreferences {
    fullscreen: bool,
    monitor: Option<MonitorSnapshot>,
    scale_factor: Option<f64>,
    updated_at_epoch_seconds: u64,
}

/// Where the shell shows the screen, always fullscreen (new pages program,
/// Slice SW, D22).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FullscreenDisplay {
    /// The display the window was last on: its index among the monitors.
    Saved(usize),
    /// The 2560×1440 display: its index among the monitors.
    Studio(usize),
    /// Neither is there: the display the window is on.
    Current,
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
    parse_window_preferences(&payload)
}

fn parse_window_preferences(payload: &str) -> Option<ShellWindowPreferences> {
    serde_json::from_str(payload).ok()
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

/// The shell's one rule, over snapshots of the monitors so it can be tested
/// without a window: the saved display when it is there (matched by name, else
/// by its geometry), else the 2560×1440 display, else the display the window
/// is on.
fn fullscreen_display(
    monitors: &[AvailableMonitorSnapshot],
    saved: Option<&MonitorSnapshot>,
) -> FullscreenDisplay {
    if let Some(index) = saved_monitor_index_from_snapshots(monitors, saved) {
        return FullscreenDisplay::Saved(index);
    }
    monitors
        .iter()
        .position(|monitor| monitor_matches_logical_size(monitor, 2560, 1440))
        .map_or(FullscreenDisplay::Current, FullscreenDisplay::Studio)
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Main Tauri window is unavailable.".to_string())
}

/// Brings the operator's window forward when a second copy of the shell was
/// launched (2026-09 production readiness, Slice 5 — finding F19): the
/// second copy hands over and exits, and the one that is running may be
/// minimised behind the show.
fn focus_main_window(app: &AppHandle) {
    if let Ok(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
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

fn capture_current_window_preferences(window: &WebviewWindow) -> ShellWindowPreferences {
    ShellWindowPreferences {
        fullscreen: window.is_fullscreen().unwrap_or(false),
        monitor: window
            .current_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor_snapshot(&monitor)),
        scale_factor: Some(window_scale_factor(window)),
        updated_at_epoch_seconds: now_epoch_seconds(),
    }
}

fn persist_current_window_preferences(app: &AppHandle, window: &WebviewWindow) {
    let preferences = capture_current_window_preferences(window);
    let _ = write_window_preferences(app, &preferences);
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

/// Every shell command that can wait — for the engine's reply, for its exit,
/// for the file system, for Explorer — hands that wait to the async runtime's
/// blocking pool. The commands are `async fn`s, so Tauri never runs them on
/// the thread that paints the window and dispatches the next IPC call: until
/// this slice `engine_request` sat in `recv_timeout(10 s)` on exactly that
/// thread, and every click, status write and window event queued behind a
/// stalled engine reply (2026-09 production readiness, Slice 4 — finding F07).
async fn off_main_thread<T, F>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Shell task did not finish: {error}"))?
}

#[tauri::command]
async fn engine_start(
    app: AppHandle,
    state: tauri::State<'_, EngineState>,
) -> Result<EngineBootstrapSummary, ShellStartupFailure> {
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || bridge.start(&app))
        .await
        .map_err(|message| ShellStartupFailure {
            code: "BOOTSTRAP_FAILED".to_string(),
            message,
            paths: current_runtime_paths(),
            stage: "bootstrap".to_string(),
        })
}

#[tauri::command]
async fn engine_request(
    state: tauri::State<'_, EngineState>,
    request: RequestEnvelope,
) -> Result<studio_control_protocol::ResponseEnvelope, String> {
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || bridge.request(request)).await
}

#[tauri::command]
async fn engine_stop(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || bridge.stop()).await
}

/// The operator confirmed "Close Studio Control?": stop the engine gracefully
/// (its stdin closes, its loop ends and releases any talkback hold, two
/// seconds of grace before a kill — waited for off the main thread), mark
/// the close confirmed so the `CloseRequested` hook lets it through, then
/// close the window — which also persists the window preferences on the way
/// out.
#[tauri::command]
async fn shell_confirm_close(
    app: AppHandle,
    state: tauri::State<'_, EngineState>,
) -> Result<(), String> {
    state.close_confirmed.store(true, Ordering::SeqCst);
    let bridge = Arc::clone(&state.bridge);
    if let Err(error) = off_main_thread(move || bridge.stop()).await {
        eprintln!("Engine stop before close failed: {error}");
    }
    let window = main_window(&app)?;
    window
        .close()
        .or_else(|_| window.destroy())
        .map_err(|error| format!("Failed to close the main window: {error}"))
}

#[tauri::command]
async fn engine_summary(
    state: tauri::State<'_, EngineState>,
) -> Result<Option<EngineBootstrapSummary>, String> {
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || bridge.summary()).await
}

/// Error code prefixes answered by `shell_open_path` (finding F15).
const PATH_OUTSIDE_APP_DATA_CODE: &str = "PATH_OUTSIDE_APP_DATA";
const PATH_NOT_FOUND_CODE: &str = "PATH_NOT_FOUND";

/// The folders the shell opens for the operator: the app-data directory
/// (which holds `backups` and `exports`), the logs directory (which may live
/// elsewhere through `SSE_LOG_DIR`) and the update repository when the
/// launcher configured one. Everything else is refused (2026-09 production
/// readiness, Slice 4 — finding F15): the command took any path the webview
/// named and handed it to Explorer.
fn allowed_open_roots() -> Result<Vec<PathBuf>, String> {
    let (app_data_dir, logs_dir) = engine::resolve_runtime_directories()?;
    let mut roots = vec![app_data_dir, logs_dir];
    if let Some(update_repository) = optional_env_path("SSE_UPDATE_REPOSITORY_PATH") {
        roots.push(PathBuf::from(update_repository));
    }
    Ok(roots)
}

/// `target` must exist and, once every symlink, junction and `..` is
/// resolved, sit inside one of `roots` (a root that does not exist cannot
/// admit anything). Returns the canonical path.
fn resolve_open_path(target: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical = canonicalize(target).map_err(|error| {
        format!(
            "{PATH_NOT_FOUND_CODE}: {} could not be opened: {error}",
            target.display()
        )
    })?;
    let inside_a_root = roots.iter().any(|root| {
        canonicalize(root)
            .map(|root| canonical.starts_with(root))
            .unwrap_or(false)
    });
    if inside_a_root {
        Ok(canonical)
    } else {
        Err(format!(
            "{PATH_OUTSIDE_APP_DATA_CODE}: {} is outside the app data, logs and update folders, so it was not opened.",
            target.display()
        ))
    }
}

#[tauri::command]
async fn shell_open_path(path: String) -> Result<(), String> {
    off_main_thread(move || {
        let target = PathBuf::from(path);
        let roots = allowed_open_roots()?;
        resolve_open_path(&target, &roots)?;
        open_path_with_system(&target)
    })
    .await
}

/// Hands an allowed path to Explorer. The original spelling is used rather
/// than the canonical one: Explorer does not take the `\\?\` prefix
/// `canonicalize` produces on Windows.
fn open_path_with_system(target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|error| format!("Failed to open path {}: {error}", target.display()))?;
        Ok(())
    }

    // New pages program, Slice SW (D22): Studio Control runs on Windows only.
    // The Linux CI runners compile the shell, and none of their lanes opens a
    // folder.
    #[cfg(not(windows))]
    {
        Err(format!(
            "{} was not opened: Studio Control opens folders on Windows only.",
            target.display()
        ))
    }
}

/// UTC wall-clock time as `YYYY-MM-DDTHH-MM-SS-mmmZ` — the shape the engine's
/// database backups and support archives use, so a directory listing sorts
/// every export together (mirrors `storage_backups::file_timestamp`).
fn file_timestamp(time: SystemTime) -> String {
    let since_epoch = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_seconds = since_epoch.as_secs();
    let millis = since_epoch.subsec_millis();
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_from_days((total_seconds / 86_400) as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}-{:02}-{:02}-{millis:03}Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 to (y, m, d).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era as i64 + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// The name a diagnostics export gets: `diagnostics-<UTC ms timestamp>.json`.
fn diagnostics_file_name(time: SystemTime) -> String {
    format!("diagnostics-{}.json", file_timestamp(time))
}

/// Writes `report` under `directory` (created if needed) and returns the
/// file's path. Two exports in the same millisecond get two files.
fn write_diagnostics_report(directory: &Path, report: &Value) -> Result<PathBuf, String> {
    if !directory.is_absolute() {
        return Err("Diagnostics directory must be an absolute path.".to_string());
    }
    create_dir_all(directory).map_err(|error| {
        format!(
            "Failed to create diagnostics directory {}: {error}",
            directory.display()
        )
    })?;

    let payload = serde_json::to_vec_pretty(report)
        .map_err(|error| format!("Failed to serialize diagnostics report: {error}"))?;
    let mut attempts = 0;
    let output_path = loop {
        let candidate = directory.join(diagnostics_file_name(SystemTime::now()));
        if !candidate.exists() {
            break candidate;
        }
        attempts += 1;
        if attempts > 1_000 {
            return Err(format!(
                "Could not reserve a diagnostics file name in {}",
                directory.display()
            ));
        }
        thread::sleep(Duration::from_millis(1));
    };
    write(&output_path, payload).map_err(|error| {
        format!(
            "Failed to write diagnostics report {}: {error}",
            output_path.display()
        )
    })?;
    Ok(output_path)
}

/// Writes the report to `<app-data>/exports/diagnostics-<ts>.json` and
/// nowhere else (2026-09 production readiness, Slice 4 — finding F15): the
/// command used to take any directory, which made it a write-anywhere
/// primitive for whatever ran in the webview. Automation that needs another
/// directory has `shell_test_bridge_export_diagnostics_to` under the
/// `test-bridge` feature.
#[tauri::command]
async fn shell_export_diagnostics(report: Value) -> Result<String, String> {
    off_main_thread(move || {
        let (app_data_dir, _) = engine::resolve_runtime_directories()?;
        write_diagnostics_report(&engine::exports_dir_for(&app_data_dir), &report)
            .map(|path| path.display().to_string())
    })
    .await
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

/// Test-bridge only: the qualification lanes read the report back from a
/// directory of their own. Production builds do not carry this command.
#[cfg(feature = "test-bridge")]
#[tauri::command]
async fn shell_test_bridge_export_diagnostics_to(
    report: Value,
    directory: String,
) -> Result<String, String> {
    off_main_thread(move || {
        write_diagnostics_report(&PathBuf::from(directory), &report)
            .map(|path| path.display().to_string())
    })
    .await
}

fn monitor_matches_logical_size(
    monitor: &AvailableMonitorSnapshot,
    target_width: u32,
    target_height: u32,
) -> bool {
    let scale_factor = monitor.scale_factor;
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return false;
    }

    let logical_width = (monitor.physical_size.width / scale_factor).round() as u32;
    let logical_height = (monitor.physical_size.height / scale_factor).round() as u32;
    logical_width == target_width && logical_height == target_height
}

/// The monitor `fullscreen_display` names — the saved display (`saved`), else
/// the studio monitor, else the display the window is on. When the system
/// lists no monitors, only the last is left.
fn fullscreen_monitor(window: &WebviewWindow, saved: Option<&MonitorSnapshot>) -> Option<Monitor> {
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor_snapshots = monitors
        .iter()
        .map(available_monitor_snapshot)
        .collect::<Vec<_>>();
    let listed = match fullscreen_display(&monitor_snapshots, saved) {
        FullscreenDisplay::Saved(index) | FullscreenDisplay::Studio(index) => {
            monitors.get(index).cloned()
        }
        FullscreenDisplay::Current => None,
    };
    listed.or_else(|| window.current_monitor().ok().flatten())
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

/// Shows the screen fullscreen on the monitor `fullscreen_monitor` picks.
fn route_window_fullscreen(
    window: &WebviewWindow,
    saved: Option<&MonitorSnapshot>,
) -> Result<(), String> {
    let monitor = fullscreen_monitor(window, saved)
        .ok_or_else(|| NO_MONITOR_FOR_STUDIO_FULLSCREEN.to_string())?;
    route_window_to_monitor(window, &monitor)
}

/// New pages program, Slice SW (D22): the shell always shows the screen
/// fullscreen — on the display it was last on when that display is there,
/// else on the 2560×1440 display, else on the display the window is on. Until
/// then a saved windowed layout was restored as it was, and a missing display
/// (or no saved file and neither a 2560×1440 nor a 1920×1080 monitor) opened
/// the windowed layout, 1600 × 960 and centred.
fn restore_or_route_initial_window(app: &AppHandle, window: &WebviewWindow) {
    let saved = read_window_preferences(app).and_then(|preferences| preferences.monitor);
    match route_window_fullscreen(window, saved.as_ref()) {
        Ok(()) => persist_current_window_preferences(app, window),
        Err(detail) => log_shell_line(
            app,
            &format!("The window did not go fullscreen at launch: {detail}"),
        ),
    }
}

/// The one window-command refusal that is already the operator's sentence.
const NO_MONITOR_FOR_STUDIO_FULLSCREEN: &str = "No monitor is available for studio fullscreen.";

/// The two window commands: keys in Setup / Support › Workstation, and the
/// reset on the recovery screens too (new pages program, Slice 3, decision 2).
/// The windowed layout's command went with the windowed layout in Slice SW
/// (D22).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowCommand {
    StudioFullscreen,
    ResetLayout,
}

impl WindowCommand {
    /// What shell.log calls the command.
    fn log_name(self) -> &'static str {
        match self {
            WindowCommand::StudioFullscreen => "Studio fullscreen",
            WindowCommand::ResetLayout => "Window layout reset",
        }
    }
}

/// The sentence the operator reads when a window command did not finish. The
/// screens show a refusal as it stands, so it says in the app's words what
/// did not happen; the detail — the webview's own error, a file path — goes
/// to shell.log. Only the fullscreen command's missing monitor is said as is.
fn window_command_refusal(command: WindowCommand, detail: &str) -> String {
    let sentence = match command {
        WindowCommand::StudioFullscreen if detail == NO_MONITOR_FOR_STUDIO_FULLSCREEN => detail,
        WindowCommand::StudioFullscreen => "Studio fullscreen did not start.",
        WindowCommand::ResetLayout => "The window layout was not reset.",
    };
    sentence.to_string()
}

/// Runs a window command; a failure is logged in full and answered with the
/// operator's sentence.
fn run_window_command(
    app: &AppHandle,
    command: WindowCommand,
    run: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    run().map_err(|detail| {
        log_shell_line(
            app,
            &format!("{} did not finish: {detail}", command.log_name()),
        );
        window_command_refusal(command, &detail)
    })
}

/// One line in shell.log, through the handle the engine's stderr shares.
fn log_shell_line(app: &AppHandle, message: &str) {
    app.state::<EngineState>()
        .bridge
        .log_shell_line("SHELL", message);
}

/// Fullscreen on the studio monitor, else on the display the window is on,
/// remembered for the next launch.
#[tauri::command]
fn shell_enter_studio_fullscreen(app: AppHandle) -> Result<(), String> {
    run_window_command(&app, WindowCommand::StudioFullscreen, || {
        let window = main_window(&app)?;
        route_window_fullscreen(&window, None)?;
        persist_current_window_preferences(&app, &window);
        Ok(())
    })
}

/// Forgets the saved display, then goes fullscreen as Studio fullscreen does.
/// Until Slice SW a workstation without a studio monitor got the windowed
/// layout here.
#[tauri::command]
fn shell_reset_window_layout(app: AppHandle) -> Result<(), String> {
    run_window_command(&app, WindowCommand::ResetLayout, || {
        let window = main_window(&app)?;
        remove_window_preferences(&app)?;
        route_window_fullscreen(&window, None)?;
        persist_current_window_preferences(&app, &window);
        Ok(())
    })
}

/// New pages program, Slice 3, decision 12: the one guard against keys Studio
/// Control does not bind itself. The screen runs in WebView2, which has keys of
/// its own — reload (F5, Ctrl+R, Ctrl+Shift+R), find (Ctrl+F, F3), print
/// (Ctrl+P), zoom, back and forward, the developer tools. With its browser
/// accelerator keys switched off none of them acts on the operator's screen
/// during a show, while the keys that move and edit — Home, End, Page Up, Page
/// Down, cut, copy, paste, select-all and undo in text fields — keep working.
/// The guard binds no function; the page sees nothing of it. A refusal is one
/// line in shell.log and the shell carries on with WebView2's defaults.
///
/// Called from `.setup`, which runs on the main thread, where `with_webview`
/// runs its closure at once: after the webview is built and before the event
/// loop delivers its first `NavigationStarting`. That matters, because WebView2
/// applies most settings changed after `NavigationStarting` only from the next
/// top-level navigation — and the operator's screen never navigates again.
#[cfg(windows)]
fn switch_off_browser_keys(app: &AppHandle, window: &WebviewWindow) {
    let app_for_webview = app.clone();
    let queued = window.with_webview(move |webview| {
        if let Err(error) = set_browser_accelerator_keys_off(&webview.controller()) {
            log_browser_keys_left_on(&app_for_webview, &error.to_string());
        }
    });
    if let Err(error) = queued {
        log_browser_keys_left_on(app, &error.to_string());
    }
}

/// `ICoreWebView2Controller` → `CoreWebView2` → `Settings` →
/// `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)`, the
/// setting wry applies when a webview is built with its browser accelerator
/// keys off (Tauri does not expose that option).
#[cfg(windows)]
#[allow(unsafe_code)]
fn set_browser_accelerator_keys_off(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    // SAFETY: `controller` is the live controller Tauri passes to
    // `with_webview`, on the thread that owns the webview. These are two COM
    // getters and one setter on it, each checked through the `Result` the
    // bindings return; the interfaces are reference-counted and released when
    // they drop at the end of this function.
    unsafe {
        let settings = controller.CoreWebView2()?.Settings()?;
        settings
            .cast::<ICoreWebView2Settings3>()?
            .SetAreBrowserAcceleratorKeysEnabled(false)
    }
}

#[cfg(windows)]
fn log_browser_keys_left_on(app: &AppHandle, error: &str) {
    log_shell_line(
        app,
        &format!("WebView2's browser keys stayed on (reload, find, print, zoom): {error}"),
    );
}

fn main() {
    let args = env::args().collect::<Vec<_>>();
    if args.iter().any(|value| value == "--smoke-test") {
        std::process::exit(run_smoke_test(&args));
    }

    let builder = tauri::Builder::default()
        // One shell per workstation (2026-09 production readiness, Slice 5 —
        // finding F19): registered first so it runs before anything else
        // initialises and before the window exists. A second launch hands
        // its arguments to the running shell, which brings its window
        // forward, and exits. The engine's own lock on
        // `<app-data>/engine.lock` guards the database and the light
        // outputs even where this plugin cannot (a Linux CI runner's session
        // without a D-Bus session bus).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .manage(EngineState {
            bridge: Arc::new(EngineBridge::default()),
            close_confirmed: AtomicBool::new(false),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Decision 12: WebView2's own reload, find, print and zoom
                // keys go off first — before WebView2 delivers the page's
                // first NavigationStarting, and before the window shows.
                #[cfg(windows)]
                switch_off_browser_keys(app.handle(), &window);
                let _ = window.show();
                let app_handle = app.handle().clone();
                restore_or_route_initial_window(&app_handle, &window);
                let window_for_events = window.clone();
                window.on_window_event(move |event| {
                    // 2026-09 audit Slice 11: closing asks first. Until the
                    // operator confirms (or automation opts out), keep the
                    // window and let the frontend raise the dialog.
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let confirmed = app_handle
                            .state::<EngineState>()
                            .close_confirmed
                            .load(Ordering::SeqCst);
                        let skip = env::var(SHELL_SKIP_CLOSE_CONFIRM_ENV).ok();
                        if close_policy(confirmed, skip.as_deref()) == ClosePolicy::Prevent {
                            api.prevent_close();
                            let _ = window_for_events.emit(SHELL_CLOSE_REQUESTED_EVENT, ());
                            return;
                        }
                    }
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
                    persist_current_window_preferences(&app_handle, &window_for_events);
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
        shell_reset_window_layout,
        shell_confirm_close,
        shell_test_bridge_config,
        shell_test_bridge_write_status,
        shell_test_bridge_read_command,
        shell_test_bridge_export_diagnostics_to
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
        shell_reset_window_layout,
        shell_confirm_close
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("failed to run tauri shell");
}

#[cfg(test)]
mod shell_close_policy_tests {
    use super::*;

    // 2026-09 audit Slice 11: the only two ways past the close dialog are the
    // operator's confirmation and the explicit automation opt-out.
    #[test]
    fn close_is_prevented_until_confirmed_or_opted_out() {
        assert_eq!(close_policy(false, None), ClosePolicy::Prevent);
        assert_eq!(close_policy(false, Some("0")), ClosePolicy::Prevent);
        assert_eq!(close_policy(false, Some("")), ClosePolicy::Prevent);
        assert_eq!(close_policy(false, Some("true")), ClosePolicy::Prevent);
        assert_eq!(close_policy(true, None), ClosePolicy::Allow);
        assert_eq!(close_policy(false, Some("1")), ClosePolicy::Allow);
        assert_eq!(close_policy(false, Some(" 1 ")), ClosePolicy::Allow);
        assert_eq!(close_policy(true, Some("0")), ClosePolicy::Allow);
    }
}

#[cfg(test)]
mod shell_window_command_tests {
    use super::*;

    // New pages program, Slice 3 (decision 2): the window commands are keys on
    // the operator's screens now, and a refusal is shown as it stands. Old: the
    // shell's own errors — "Main Tauri window is unavailable.", "Failed to
    // remove shell window preferences <path>: …", "Failed to leave
    // fullscreen: …", "Failed to set fallback window size: …", "Failed to
    // position window on monitor: …". New: one sentence per command in the
    // app's words; the detail goes to shell.log. The missing monitor is said as
    // it always was. Slice SW (D22): the windowed layout's command, and the
    // details only it gave, went with the windowed layout.
    #[test]
    fn window_command_refusals_are_the_operators_sentences() {
        assert_eq!(
            window_command_refusal(
                WindowCommand::StudioFullscreen,
                NO_MONITOR_FOR_STUDIO_FULLSCREEN
            ),
            "No monitor is available for studio fullscreen."
        );

        let details = [
            "Main Tauri window is unavailable.",
            r"Failed to remove shell window preferences C:\Users\operator\AppData\Roaming\com.sse.exedstudiocontrol\shell-window-layout.json: Access is denied. (os error 5)",
            "Failed to resolve Tauri config directory: unknown path",
            "Failed to position window on monitor: the underlying handle is not available",
            "Failed to size window for monitor: the underlying handle is not available",
            "Failed to enter fullscreen: the underlying handle is not available",
        ];
        for (command, sentence) in [
            (
                WindowCommand::StudioFullscreen,
                "Studio fullscreen did not start.",
            ),
            (
                WindowCommand::ResetLayout,
                "The window layout was not reset.",
            ),
        ] {
            for detail in details {
                let refusal = window_command_refusal(command, detail);
                assert_eq!(refusal, sentence, "{command:?} refusing {detail:?}");
                for word in ["Tauri", "fallback", "Failed", "error", "engine", "\\"] {
                    assert!(!refusal.contains(word), "{refusal:?} carries {word:?}");
                }
            }
        }

        // The missing-monitor sentence is the fullscreen command's alone.
        assert_eq!(
            window_command_refusal(WindowCommand::ResetLayout, NO_MONITOR_FOR_STUDIO_FULLSCREEN),
            "The window layout was not reset."
        );
    }
}

#[cfg(test)]
mod shell_path_policy_tests {
    use super::*;
    use std::fs::{self, File};

    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "sse-tauri-shell-paths-{label}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("test temp root should be creatable");
            Self { root }
        }

        fn path(&self, path: &str) -> PathBuf {
            self.root.join(path)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().expect("test path should have a parent"))
            .expect("test parent directory should be creatable");
        File::create(path).expect("test file should be creatable");
    }

    // 2026-09 production readiness, Slice 4 (finding F15): the shell opens
    // only what sits inside its own folders. Anything else — a system
    // directory, a sibling of the app-data directory, a `..` that climbs out,
    // a path that does not exist — is refused with a code the surface can show.
    #[test]
    fn open_path_rejects_outside_app_data() {
        let tree = TempTree::new("open-path");
        let app_data = tree.path("app-data");
        let logs = tree.path("elsewhere/logs");
        let update_repository = tree.path("updates");
        let backup = app_data
            .join("backups")
            .join("db-2026-09-10T00-00-00-000Z-daily.sqlite3");
        let export = app_data
            .join("exports")
            .join("diagnostics-2026-09-10T00-00-00-000Z.json");
        let engine_log = logs.join("engine.log");
        let sibling = tree.path("app-data-sibling/secret.txt");
        let missing_root = tree.path("never-created");
        touch(&backup);
        touch(&export);
        touch(&engine_log);
        touch(&sibling);
        touch(&update_repository.join("Updates.xml"));
        let roots = vec![
            app_data.clone(),
            logs.clone(),
            update_repository.clone(),
            missing_root,
        ];

        // Inside a root: the roots themselves, and files beneath them.
        for allowed in [
            app_data.clone(),
            app_data.join("backups"),
            backup.clone(),
            export.clone(),
            logs.clone(),
            engine_log.clone(),
            update_repository.clone(),
            update_repository.join("Updates.xml"),
        ] {
            let resolved = resolve_open_path(&allowed, &roots)
                .unwrap_or_else(|error| panic!("{} should open: {error}", allowed.display()));
            assert_eq!(
                resolved,
                canonicalize(&allowed).expect("allowed path should canonicalize")
            );
        }

        // Outside every root, by any spelling.
        let climbs_out = app_data
            .join("..")
            .join("app-data-sibling")
            .join("secret.txt");
        for refused in [
            sibling.clone(),
            climbs_out,
            tree.root.clone(),
            std::env::temp_dir(),
        ] {
            let error = resolve_open_path(&refused, &roots)
                .expect_err(&format!("{} must be refused", refused.display()));
            assert!(
                error.starts_with(PATH_OUTSIDE_APP_DATA_CODE),
                "{}: {error}",
                refused.display()
            );
        }

        #[cfg(target_os = "windows")]
        {
            let windows = PathBuf::from(r"C:\Windows");
            if windows.exists() {
                let error = resolve_open_path(&windows, &roots)
                    .expect_err("the Windows directory must be refused");
                assert!(error.starts_with(PATH_OUTSIDE_APP_DATA_CODE), "{error}");
            }
        }

        // A path that does not exist is refused before Explorer sees it.
        let missing = app_data.join("backups").join("missing.sqlite3");
        let error =
            resolve_open_path(&missing, &roots).expect_err("a missing path must be refused");
        assert!(error.starts_with(PATH_NOT_FOUND_CODE), "{error}");

        // No roots at all admit nothing.
        let error = resolve_open_path(&backup, &[]).expect_err("no roots admit nothing");
        assert!(error.starts_with(PATH_OUTSIDE_APP_DATA_CODE), "{error}");
    }

    // Diagnostics exports get a UTC millisecond stamp, land where they are
    // told, and never overwrite each other.
    #[test]
    fn diagnostics_report_lands_with_a_utc_stamp_and_never_overwrites() {
        let tree = TempTree::new("diagnostics");
        let exports = tree.path("app-data/exports");
        let report = json!({ "lifecycle": "ready", "activeWorkspace": "lighting" });

        let first = write_diagnostics_report(&exports, &report)
            .expect("the exports directory is created on demand");
        let second = write_diagnostics_report(&exports, &report)
            .expect("a second export in the same instant still gets its own file");

        assert_ne!(first, second);
        for path in [&first, &second] {
            assert_eq!(path.parent(), Some(exports.as_path()));
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .expect("export names are UTF-8");
            assert!(
                name.starts_with("diagnostics-") && name.ends_with("Z.json"),
                "{name}"
            );
            assert_eq!(
                name.len(),
                "diagnostics-2026-09-10T00-00-00-000Z.json".len(),
                "{name}"
            );
            let written: Value =
                serde_json::from_slice(&fs::read(path).expect("export is readable"))
                    .expect("export is JSON");
            assert_eq!(written, report);
        }

        let relative = PathBuf::from("relative/exports");
        let error = write_diagnostics_report(&relative, &report)
            .expect_err("a relative directory is refused");
        assert!(error.contains("absolute"), "{error}");
    }

    #[test]
    fn file_timestamp_is_utc_to_the_millisecond() {
        assert_eq!(file_timestamp(UNIX_EPOCH), "1970-01-01T00-00-00-000Z");
        assert_eq!(
            file_timestamp(UNIX_EPOCH + Duration::from_millis(1_000_000_000_500)),
            "2001-09-09T01-46-40-500Z"
        );
        assert_eq!(
            file_timestamp(UNIX_EPOCH + Duration::from_secs(1_709_164_800)),
            "2024-02-29T00-00-00-000Z"
        );
        assert_eq!(
            diagnostics_file_name(UNIX_EPOCH + Duration::from_secs(1_709_164_800)),
            "diagnostics-2024-02-29T00-00-00-000Z.json"
        );
    }
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
            fullscreen: true,
            monitor,
            scale_factor: Some(1.0),
            updated_at_epoch_seconds: 1,
        }
    }

    fn studio_review_saved() -> ShellWindowPreferences {
        preferences_with_monitor(Some(saved_monitor(
            Some("Studio Review"),
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        )))
    }

    // New pages program, Slice SW (D22): the screen is always fullscreen — on
    // the display it was last on when that display is there, else on the
    // 2560×1440 display, else on the display the window is on. Until then a
    // missing display opened the windowed layout, and a 1920×1080 monitor
    // stood in for the studio one.
    #[test]
    fn shell_window_preferences_saved_monitor_matches_by_name() {
        let preferences = studio_review_saved();
        let available = [
            available_monitor(Some("Studio"), (0.0, 0.0), (2560.0, 1440.0), 1.0),
            available_monitor(Some("Studio Review"), (100.0, 100.0), (1920.0, 1080.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            Some(1)
        );
        // The display it was last on comes before the studio display.
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Saved(1)
        );
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
            available_monitor(Some("Side"), (0.0, 0.0), (1920.0, 1080.0), 1.0),
            available_monitor(Some("Renamed Studio"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            Some(1)
        );
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Saved(1)
        );
    }

    #[test]
    fn shell_window_preferences_saved_monitor_missing_goes_to_the_studio_display() {
        let preferences = studio_review_saved();
        let available = [
            available_monitor(Some("Side"), (0.0, 0.0), (1920.0, 1080.0), 1.0),
            available_monitor(Some("Studio"), (1920.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            None
        );
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Studio(1)
        );
        // A file that saved no display, and no file at all, go there too.
        assert_eq!(
            fullscreen_display(&available, preferences_with_monitor(None).monitor.as_ref()),
            FullscreenDisplay::Studio(1)
        );
        assert_eq!(
            fullscreen_display(&available, None),
            FullscreenDisplay::Studio(1)
        );
    }

    #[test]
    fn shell_window_preferences_without_saved_or_studio_monitor_use_the_current_display() {
        // The studio display is 2560×1440 in logical pixels: a 2560×1440 panel
        // at 125 % is 2048×1152 and is not it, and a 1920×1080 one no longer
        // stands in for it.
        let preferences = studio_review_saved();
        let available = [
            available_monitor(Some("Side"), (0.0, 0.0), (1920.0, 1080.0), 1.0),
            available_monitor(
                Some("Studio at 125 %"),
                (1920.0, 0.0),
                (2560.0, 1440.0),
                1.25,
            ),
        ];

        for saved in [preferences.monitor.as_ref(), None] {
            assert_eq!(
                fullscreen_display(&available, saved),
                FullscreenDisplay::Current
            );
        }
        // No monitor listed at all.
        assert_eq!(
            fullscreen_display(&[], preferences.monitor.as_ref()),
            FullscreenDisplay::Current
        );
    }

    // Slice SW (D22): a file an older build wrote still loads — the windowed
    // layout's too — and opens fullscreen on its display. What is written now
    // carries the display and none of the windowed layout's fields.
    #[test]
    fn shell_window_preferences_from_an_older_build_still_load() {
        let windowed = r#"{
  "launchMode": "windowed",
  "lastLogicalSize": { "width": 1600.0, "height": 960.0 },
  "lastLogicalPosition": { "x": 3040.0, "y": 240.0 },
  "fullscreen": false,
  "monitor": {
    "name": "\\\\.\\DISPLAY3",
    "physicalPosition": { "x": 2560.0, "y": 0.0 },
    "physicalSize": { "width": 2560.0, "height": 1440.0 },
    "logicalSize": { "width": 2560.0, "height": 1440.0 },
    "scaleFactor": 1.0
  },
  "scaleFactor": 1.0,
  "updatedAtEpochSeconds": 1790000000
}"#;
        let studio_fullscreen = windowed
            .replace(r#""windowed""#, r#""studioFullscreen""#)
            .replace(r#""fullscreen": false"#, r#""fullscreen": true"#);
        let available = [
            available_monitor(Some(r"\\.\DISPLAY1"), (0.0, 0.0), (2560.0, 1440.0), 1.0),
            available_monitor(Some(r"\\.\DISPLAY3"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        for payload in [windowed, studio_fullscreen.as_str()] {
            let preferences =
                parse_window_preferences(payload).expect("an older build's file loads");
            assert_eq!(
                fullscreen_display(&available, preferences.monitor.as_ref()),
                FullscreenDisplay::Saved(1),
                "{payload}"
            );
        }

        let no_display = r#"{"launchMode":"windowed","lastLogicalSize":null,"lastLogicalPosition":null,"fullscreen":false,"monitor":null,"scaleFactor":null,"updatedAtEpochSeconds":1}"#;
        let preferences =
            parse_window_preferences(no_display).expect("a file without a display loads");
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Studio(0)
        );

        let written = serde_json::to_value(preferences_with_monitor(Some(saved_monitor(
            Some(r"\\.\DISPLAY3"),
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        ))))
        .expect("the preferences serialise");
        for gone in ["launchMode", "lastLogicalSize", "lastLogicalPosition"] {
            assert!(written.get(gone).is_none(), "{gone} is still written");
        }
        let read_back =
            parse_window_preferences(&written.to_string()).expect("what is written loads");
        assert_eq!(
            fullscreen_display(&available, read_back.monitor.as_ref()),
            FullscreenDisplay::Saved(1)
        );
    }
}
