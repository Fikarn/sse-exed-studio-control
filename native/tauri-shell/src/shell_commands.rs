//! The commands the pages call: start, ask and stop the hardware link, read
//! what it said at its start, and close the window once the operator
//! confirmed. Every one that can wait hands the wait to the blocking pool
//! (`off_main_thread`).

use crate::engine::{self, EngineBootstrapSummary};
use crate::shell_window_layout::main_window;
use crate::EngineState;
use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use studio_control_protocol::RequestEnvelope;
use tauri::AppHandle;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellStartupFailure {
    code: String,
    message: String,
    paths: BTreeMap<String, String>,
    stage: String,
}

pub(crate) fn optional_env_path(name: &str) -> Option<String> {
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

    BTreeMap::from([
        ("appDataDir".to_string(), app_data_dir.display().to_string()),
        ("backupDir".to_string(), backup_dir.display().to_string()),
        ("dbPath".to_string(), db_path.display().to_string()),
        (
            "logFilePath".to_string(),
            log_file_path.display().to_string(),
        ),
        ("logsDir".to_string(), logs_dir.display().to_string()),
    ])
}

/// Every shell command that can wait — for the engine's reply, for its exit,
/// for the file system, for Explorer — hands that wait to the async runtime's
/// blocking pool. The commands are `async fn`s, so Tauri never runs them on
/// the thread that paints the window and dispatches the next IPC call: until
/// this slice `engine_request` sat in `recv_timeout(10 s)` on exactly that
/// thread, and every click, status write and window event queued behind a
/// stalled engine reply (2026-09 production readiness, Slice 4 — finding F07).
pub(crate) async fn off_main_thread<T, F>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Shell task did not finish: {error}"))?
}

#[tauri::command]
pub(crate) async fn engine_start(
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

/// Requests only the shell sends to the hardware link, never the page: what
/// the shell reads of Windows (the new pages program's Slice 5a — the Prompter
/// XL, as Windows' display configuration shows it, sent from Slice 5b). A page
/// that could send it could unlock `PLAY` with nothing drawn on the glass.
const SHELL_ONLY_METHODS: &[&str] = &["prompter.screen.report"];

fn page_may_send(method: &str) -> bool {
    !SHELL_ONLY_METHODS.contains(&method)
}

#[tauri::command]
pub(crate) async fn engine_request(
    state: tauri::State<'_, EngineState>,
    request: RequestEnvelope,
) -> Result<studio_control_protocol::ResponseEnvelope, String> {
    if !page_may_send(&request.method) {
        return Err(format!(
            "{} is sent by Studio Control's shell, not by the page.",
            request.method
        ));
    }
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || bridge.request(request)).await
}

#[tauri::command]
pub(crate) async fn engine_stop(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || bridge.stop()).await
}

/// The operator confirmed "Close Studio Control?": stop the engine gracefully
/// (its stdin closes and its loop ends, two
/// seconds of grace before a kill — waited for off the main thread), mark
/// the close confirmed so the `CloseRequested` hook lets it through, then
/// close the window — which also persists the window preferences on the way
/// out.
#[tauri::command]
pub(crate) async fn shell_confirm_close(
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
pub(crate) async fn engine_summary(
    state: tauri::State<'_, EngineState>,
) -> Result<Option<EngineBootstrapSummary>, String> {
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || bridge.summary()).await
}

#[cfg(test)]
mod shell_only_method_tests {
    use super::page_may_send;

    // New pages program, Slice 5a (review of its push): the Prompter XL's
    // state reaches the hardware link from the shell alone; the page's
    // request path refuses it, and nothing else.
    #[test]
    fn the_page_cannot_report_the_prompter_xl() {
        assert!(!page_may_send("prompter.screen.report"));
        for method in [
            "prompter.play",
            "prompter.layout.report",
            "prompter.snapshot",
            "health.snapshot",
            "settings.update",
        ] {
            assert!(page_may_send(method), "{method}");
        }
    }
}
