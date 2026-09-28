//! The commands of the `test-bridge` feature: the page tests and the smoke
//! harness drive the shell through a status file and a command file.
//! Production builds must not enable the feature, and do not carry these.

use crate::shell_commands::{off_main_thread, optional_env_path};
use crate::shell_paths::write_diagnostics_report;
use serde_json::Value;
use std::fs::{create_dir_all, read_to_string, write};
use std::path::PathBuf;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellTestBridgeConfig {
    command_path: Option<String>,
    status_path: Option<String>,
}

#[tauri::command]
pub(crate) fn shell_test_bridge_config() -> Option<ShellTestBridgeConfig> {
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
pub(crate) fn shell_test_bridge_write_status(status: Value) -> Result<(), String> {
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
pub(crate) fn shell_test_bridge_read_command() -> Result<Option<Value>, String> {
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
#[tauri::command]
pub(crate) async fn shell_test_bridge_export_diagnostics_to(
    report: Value,
    directory: String,
) -> Result<String, String> {
    off_main_thread(move || {
        write_diagnostics_report(&PathBuf::from(directory), &report)
            .map(|path| path.display().to_string())
    })
    .await
}
