//! The commands the pages call: start, ask and stop the hardware link, read
//! what it said at its start, and close the window once the operator
//! confirmed. Every one that can wait hands the wait to the blocking pool
//! (`off_main_thread`).
//!
//! Which window may call which command is decided here, by the window's
//! name (`window_may_call`, `window_may_send`). A capability cannot decide
//! it: Tauri's capabilities are for Tauri's own commands and its plugins',
//! and the shell's are open to every window of the app. So `main.rs` puts
//! every command behind `gated`. The operator's window may call them all
//! but the prompter's sign of life; the prompter's window may read the
//! glass, report its layout and say that it draws, and nothing else; a
//! window of another name may call nothing.

use crate::engine::{self, EngineBootstrapSummary};
use crate::shell_prompter_window::close_with_the_app;
use crate::shell_window_layout::main_window;
use crate::shell_windows::{MAIN_WINDOW_LABEL, PROMPTER_WINDOW_LABEL};
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

/// The prompter's sign of life, which only its own window gives.
const PROMPTER_WINDOW_ALIVE: &str = "prompter_window_alive";

/// The commands the prompter's window may call: the hardware link's answers
/// to its two requests, and its sign of life.
const PROMPTER_WINDOW_COMMANDS: &[&str] = &["engine_request", PROMPTER_WINDOW_ALIVE];

/// The requests the prompter's window may send: what the glass draws, and
/// the layout it measured. It starts, stops and changes nothing.
const PROMPTER_WINDOW_METHODS: &[&str] = &["prompter.glass.snapshot", "prompter.layout.report"];

/// Whether the window of this name may call this command of the shell.
pub(crate) fn window_may_call(label: &str, command: &str) -> bool {
    match label {
        MAIN_WINDOW_LABEL => command != PROMPTER_WINDOW_ALIVE,
        PROMPTER_WINDOW_LABEL => PROMPTER_WINDOW_COMMANDS.contains(&command),
        _ => false,
    }
}

/// Whether the window of this name may send this request to the hardware
/// link.
pub(crate) fn window_may_send(label: &str, method: &str) -> bool {
    match label {
        MAIN_WINDOW_LABEL => page_may_send(method),
        PROMPTER_WINDOW_LABEL => PROMPTER_WINDOW_METHODS.contains(&method),
        _ => false,
    }
}

/// The shell's commands behind the rule of `window_may_call`: a command is
/// refused before it runs, whatever it is, a command added later among
/// them.
pub(crate) fn gated(
    commands: impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    move |invoke| {
        let label = invoke.message.webview_ref().label().to_string();
        let command = invoke.message.command().to_string();
        if window_may_call(&label, &command) {
            commands(invoke)
        } else {
            invoke
                .resolver
                .reject(format!("The window {label} may not call {command}."));
            true
        }
    }
}

#[tauri::command]
pub(crate) async fn engine_request(
    webview: tauri::Webview,
    state: tauri::State<'_, EngineState>,
    request: RequestEnvelope,
) -> Result<studio_control_protocol::ResponseEnvelope, String> {
    if !page_may_send(&request.method) {
        return Err(format!(
            "{} is sent by Studio Control's shell, not by the page.",
            request.method
        ));
    }
    if !window_may_send(webview.label(), &request.method) {
        return Err(format!(
            "The window {} may not send {}.",
            webview.label(),
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
/// close the window. Nothing is saved at the close: the window's display is
/// saved while the app runs (`shell_window_layout.rs`).
#[tauri::command]
pub(crate) async fn shell_confirm_close(
    app: AppHandle,
    state: tauri::State<'_, EngineState>,
) -> Result<(), String> {
    state.close_confirmed.store(true, Ordering::SeqCst);
    // The prompter's window goes first: the glass is not left standing
    // while the hardware link stops, and Tauri ends the app when its last
    // window closes.
    close_with_the_app(&app);
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
mod window_gate_tests {
    use super::*;

    /// Every command of the shell, as `main.rs` registers them.
    const COMMANDS: &[&str] = &[
        "engine_start",
        "engine_request",
        "engine_stop",
        "engine_summary",
        "shell_open_path",
        "shell_export_diagnostics",
        "shell_enter_studio_fullscreen",
        "shell_reset_window_layout",
        "shell_confirm_close",
        "prompter_window_alive",
        "pictures_place",
        "shell_test_bridge_config",
        "shell_test_bridge_write_status",
        "shell_test_bridge_read_command",
        "shell_test_bridge_export_diagnostics_to",
    ];

    // The list above is the one `main.rs` registers, in both of its forms:
    // a command that is added there is added here, and is refused to the
    // prompter's window until this test says otherwise.
    #[test]
    fn the_list_of_commands_is_main_rs_s() {
        let main = include_str!("main.rs");
        let registered: Vec<&str> = main
            .lines()
            .map(str::trim)
            .filter_map(|line| line.strip_suffix(',').or(Some(line)))
            .filter_map(|line| line.rsplit_once("::"))
            .filter(|(module, _)| {
                [
                    "shell_commands",
                    "shell_paths",
                    "shell_window_layout",
                    "shell_prompter_window",
                    "shell_pictures",
                    "shell_test_bridge",
                ]
                .contains(module)
            })
            .map(|(_, command)| command)
            .collect();
        for command in COMMANDS {
            assert!(registered.contains(command), "{command} is not registered");
        }
        for command in &registered {
            assert!(COMMANDS.contains(command), "{command} is not in the list");
        }
    }

    // The map of the shell, 2026-09-28: the shell's own commands are open to
    // every window, so the prompter's window could start and stop the
    // hardware link, close the app and open folders. It is refused by its
    // name, everything but its reads and its sign of life.
    #[test]
    fn the_prompter_s_window_may_read_the_glass_and_nothing_else() {
        for command in COMMANDS {
            assert_eq!(
                window_may_call(PROMPTER_WINDOW_LABEL, command),
                ["engine_request", "prompter_window_alive"].contains(command),
                "{command}"
            );
            assert_eq!(
                window_may_call(MAIN_WINDOW_LABEL, command),
                *command != "prompter_window_alive",
                "{command}"
            );
            for label in ["", "Main", "prompter2", "main ", "probe", "glass"] {
                assert!(!window_may_call(label, command), "{label:?} {command}");
            }
        }
        assert!(!window_may_call(
            PROMPTER_WINDOW_LABEL,
            "a_command_added_later"
        ));
        // Where the pictures stand is the operator's window's to say: never
        // the prompter's, whose glass carries nothing of the cameras.
        assert!(window_may_call(MAIN_WINDOW_LABEL, "pictures_place"));
        assert!(!window_may_call(PROMPTER_WINDOW_LABEL, "pictures_place"));

        let contract: serde_json::Value =
            serde_json::from_str(include_str!("../../protocol/v1.contract.json"))
                .expect("the contract is JSON");
        let methods: Vec<&str> = contract["methods"]
            .as_array()
            .expect("the contract lists its methods")
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect();
        assert!(methods.len() > 90, "the contract's methods were read");
        for method in &methods {
            assert_eq!(
                window_may_send(PROMPTER_WINDOW_LABEL, method),
                ["prompter.glass.snapshot", "prompter.layout.report"].contains(method),
                "{method}"
            );
            assert_eq!(
                window_may_send(MAIN_WINDOW_LABEL, method),
                *method != "prompter.screen.report",
                "{method}"
            );
            assert!(!window_may_send("probe", method), "{method}");
        }
        for method in PROMPTER_WINDOW_METHODS {
            assert!(
                methods.contains(method),
                "{method} is a request of the contract"
            );
        }
    }
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
