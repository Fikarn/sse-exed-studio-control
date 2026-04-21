use crate::bootstrap::RuntimeContext;
use crate::planning_settings::{
    DASHBOARD_VIEW_KEY, DECK_MODE_KEY, MODE_SECTION_KEY, PLANNING_SETTINGS_PREFIX,
    SELECTED_PROJECT_ID_KEY, SELECTED_TASK_ID_KEY, SORT_BY_KEY, TIMELINE_END_HOUR_KEY,
    TIMELINE_START_HOUR_KEY, VIEW_FILTER_KEY,
};
use crate::shell_settings::ShellSettingsSnapshot;
use serde_json::{json, Value};
use std::collections::HashMap;

pub const APP_SETTINGS_PREFIX: &str = "app.";
pub const COMMISSIONING_COMPLETED_KEY: &str = "app.commissioning.completed";
pub const COMMISSIONING_STAGE_KEY: &str = "app.commissioning.stage";
pub const HARDWARE_PROFILE_KEY: &str = "app.hardware.profile";

const DEFAULT_COMMISSIONING_COMPLETED: bool = false;
const DEFAULT_COMMISSIONING_STAGE: &str = "setup-required";
const DEFAULT_HARDWARE_PROFILE: &str = "sse-fixed-studio-v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommissioningSnapshot {
    pub has_completed_setup: bool,
    pub stage: String,
    pub hardware_profile: String,
}

impl Default for CommissioningSnapshot {
    fn default() -> Self {
        Self {
            has_completed_setup: DEFAULT_COMMISSIONING_COMPLETED,
            stage: String::from(DEFAULT_COMMISSIONING_STAGE),
            hardware_profile: String::from(DEFAULT_HARDWARE_PROFILE),
        }
    }
}

impl CommissioningSnapshot {
    pub fn from_settings(settings: &HashMap<String, String>) -> Self {
        let mut snapshot = Self::default();

        if let Some(completed) = settings
            .get(COMMISSIONING_COMPLETED_KEY)
            .and_then(|value| parse_bool(value))
        {
            snapshot.has_completed_setup = completed;
        }

        if let Some(stage) = settings.get(COMMISSIONING_STAGE_KEY) {
            if is_valid_commissioning_stage(stage) {
                snapshot.stage = stage.clone();
            }
        }

        if let Some(profile) = settings.get(HARDWARE_PROFILE_KEY) {
            if !profile.trim().is_empty() {
                snapshot.hardware_profile = profile.clone();
            }
        }

        snapshot
    }

    pub fn startup_surface(&self) -> &'static str {
        if self.has_completed_setup {
            "dashboard"
        } else {
            "commissioning"
        }
    }
}

pub fn default_app_settings_entries() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            COMMISSIONING_COMPLETED_KEY,
            if DEFAULT_COMMISSIONING_COMPLETED {
                "true"
            } else {
                "false"
            },
        ),
        (COMMISSIONING_STAGE_KEY, DEFAULT_COMMISSIONING_STAGE),
        (HARDWARE_PROFILE_KEY, DEFAULT_HARDWARE_PROFILE),
    ]
}

pub fn build_app_snapshot(
    runtime: &RuntimeContext,
    shell_settings: &HashMap<String, String>,
    app_settings: &HashMap<String, String>,
    planning_settings: &HashMap<String, String>,
) -> Value {
    let shell = ShellSettingsSnapshot::from_settings(shell_settings);
    let commissioning = CommissioningSnapshot::from_settings(app_settings);
    let shell_summary = format!(
        "Workspace '{}', window {}x{} ({}).",
        shell.workspace, shell.window_width, shell.window_height, shell.window_mode
    );
    let commissioning_summary = format!(
        "Commissioning stage '{}', hardware profile '{}', setup {}.",
        commissioning.stage,
        commissioning.hardware_profile,
        if commissioning.has_completed_setup {
            "complete"
        } else {
            "incomplete"
        }
    );
    let app_summary = format!(
        "Target surface '{}', workspace '{}', commissioning stage '{}', control surface '{}'.",
        commissioning.startup_surface(),
        shell.workspace,
        commissioning.stage,
        runtime.control_surface_bridge.summary
    );

    json!({
        "runtime": {
            "protocol": runtime.protocol_version,
            "engineVersion": env!("CARGO_PKG_VERSION"),
            "paths": {
                "appDataDir": runtime.app_data_dir.display().to_string(),
                "logsDir": runtime.logs_dir.display().to_string(),
                "logFilePath": runtime.log_file_path.display().to_string(),
                "dbPath": runtime.db_path.display().to_string(),
                "backupDir": runtime.backups_dir.display().to_string(),
            },
            "controlSurface": {
                "available": runtime.control_surface_bridge.available,
                "status": runtime.control_surface_bridge.status,
                "summary": runtime.control_surface_bridge.summary,
                "baseUrl": runtime.control_surface_bridge.base_url,
                "port": runtime.control_surface_bridge.port,
                "error": runtime.control_surface_bridge.error,
            },
        },
        "shell": {
            "workspace": shell.workspace,
            "window": {
                "width": shell.window_width,
                "height": shell.window_height,
                "maximized": shell.window_maximized,
                "mode": shell.window_mode,
            },
            "summary": shell_summary,
        },
        "commissioning": {
            "hasCompletedSetup": commissioning.has_completed_setup,
            "stage": commissioning.stage,
            "hardwareProfile": commissioning.hardware_profile,
            "summary": commissioning_summary,
        },
        "planning": {
            "settingsPrefix": PLANNING_SETTINGS_PREFIX,
            "viewFilter": planning_settings.get(VIEW_FILTER_KEY).cloned().unwrap_or_else(|| String::from("all")),
            "sortBy": planning_settings.get(SORT_BY_KEY).cloned().unwrap_or_else(|| String::from("manual")),
            "dashboardView": planning_settings.get(DASHBOARD_VIEW_KEY).cloned().unwrap_or_else(|| String::from("kanban")),
            "deckMode": planning_settings.get(DECK_MODE_KEY).cloned().unwrap_or_else(|| String::from("project")),
            "modeSection": planning_settings.get(MODE_SECTION_KEY).cloned().unwrap_or_else(|| String::from("timeline")),
            "timelineStartHour": planning_settings
                .get(TIMELINE_START_HOUR_KEY)
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(9),
            "timelineEndHour": planning_settings
                .get(TIMELINE_END_HOUR_KEY)
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(22),
            "selectedProjectId": planning_settings.get(SELECTED_PROJECT_ID_KEY).cloned(),
            "selectedTaskId": planning_settings.get(SELECTED_TASK_ID_KEY).cloned(),
        },
        "startup": {
            "targetSurface": commissioning.startup_surface(),
            "operatorUiAllowed": commissioning.has_completed_setup,
        },
        "summary": app_summary,
    })
}

pub fn parse_commissioning_update(params: &Value) -> Result<Vec<(&'static str, String)>, String> {
    let mut updates = Vec::new();

    if let Some(stage_value) = params.get("stage") {
        let stage = stage_value
            .as_str()
            .ok_or_else(|| String::from("stage must be a string"))?;

        if !is_valid_commissioning_stage(stage) {
            return Err(String::from(
                "stage must be one of: setup-required, in-progress, ready",
            ));
        }

        updates.push((COMMISSIONING_STAGE_KEY, stage.to_string()));
        updates.push((COMMISSIONING_COMPLETED_KEY, (stage == "ready").to_string()));
    }

    if let Some(profile_value) = params.get("hardwareProfile") {
        let profile = profile_value
            .as_str()
            .ok_or_else(|| String::from("hardwareProfile must be a string"))?
            .trim();

        if profile.is_empty() {
            return Err(String::from("hardwareProfile must be a non-empty string"));
        }

        updates.push((HARDWARE_PROFILE_KEY, profile.to_string()));
    }

    if updates.is_empty() {
        return Err(String::from(
            "commissioning.update requires one or more supported fields",
        ));
    }

    Ok(updates)
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn is_valid_commissioning_stage(stage: &str) -> bool {
    matches!(stage, "setup-required" | "in-progress" | "ready")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bootstrap::RuntimeContext;
    use crate::control_surface::ControlSurfaceBridgeInfo;
    use crate::storage::StorageBootstrap;
    use std::path::PathBuf;

    #[test]
    fn commissioning_defaults_block_operator_ui() {
        let settings = HashMap::new();
        let snapshot = CommissioningSnapshot::from_settings(&settings);

        assert!(!snapshot.has_completed_setup);
        assert_eq!(snapshot.stage, "setup-required");
        assert_eq!(snapshot.hardware_profile, "sse-fixed-studio-v1");
        assert_eq!(snapshot.startup_surface(), "commissioning");
    }

    #[test]
    fn commissioning_snapshot_accepts_ready_state() {
        let settings = HashMap::from([
            (
                String::from(COMMISSIONING_COMPLETED_KEY),
                String::from("true"),
            ),
            (String::from(COMMISSIONING_STAGE_KEY), String::from("ready")),
            (
                String::from(HARDWARE_PROFILE_KEY),
                String::from("sse-fixed-studio-v2"),
            ),
        ]);

        let snapshot = CommissioningSnapshot::from_settings(&settings);

        assert!(snapshot.has_completed_setup);
        assert_eq!(snapshot.stage, "ready");
        assert_eq!(snapshot.hardware_profile, "sse-fixed-studio-v2");
        assert_eq!(snapshot.startup_surface(), "dashboard");
    }

    #[test]
    fn commissioning_update_accepts_stage_and_profile() {
        let params = json!({
            "stage": "in-progress",
            "hardwareProfile": "sse-fixed-studio-v2"
        });

        let updates =
            parse_commissioning_update(&params).expect("commissioning update should parse");

        assert_eq!(
            updates,
            vec![
                (COMMISSIONING_STAGE_KEY, String::from("in-progress")),
                (COMMISSIONING_COMPLETED_KEY, String::from("false")),
                (HARDWARE_PROFILE_KEY, String::from("sse-fixed-studio-v2")),
            ]
        );
    }

    #[test]
    fn commissioning_update_rejects_empty_profile() {
        let params = json!({
            "hardwareProfile": "   "
        });

        let error = parse_commissioning_update(&params)
            .expect_err("empty hardware profile should be rejected");
        assert_eq!(error, "hardwareProfile must be a non-empty string");
    }

    #[test]
    fn app_snapshot_includes_shell_and_top_level_summaries() {
        let runtime = RuntimeContext {
            app_data_dir: PathBuf::from("/tmp/app-data"),
            logs_dir: PathBuf::from("/tmp/logs"),
            db_path: PathBuf::from("/tmp/studio-control.sqlite3"),
            log_file_path: PathBuf::from("/tmp/logs/engine.log"),
            backups_dir: PathBuf::from("/tmp/backups"),
            protocol_version: String::from("1"),
            storage_ready: true,
            storage_bootstrap: StorageBootstrap {
                schema_version: 3,
                journal_mode: String::from("wal"),
                integrity_check: String::from("ok"),
            },
            control_surface_bridge: ControlSurfaceBridgeInfo {
                available: true,
                status: String::from("ready"),
                summary: String::from("Bridge ready at http://127.0.0.1:38201"),
                base_url: String::from("http://127.0.0.1:38201"),
                port: 38201,
                error: None,
            },
        };
        let shell_settings = HashMap::from([
            (String::from("shell.workspace"), String::from("audio")),
            (String::from("shell.window.width"), String::from("1440")),
            (String::from("shell.window.height"), String::from("900")),
            (String::from("shell.window.maximized"), String::from("true")),
        ]);
        let app_settings = HashMap::from([
            (
                String::from(COMMISSIONING_COMPLETED_KEY),
                String::from("true"),
            ),
            (String::from(COMMISSIONING_STAGE_KEY), String::from("ready")),
            (
                String::from(HARDWARE_PROFILE_KEY),
                String::from("sse-fixed-studio-v2"),
            ),
        ]);

        let snapshot =
            build_app_snapshot(&runtime, &shell_settings, &app_settings, &HashMap::new());

        assert_eq!(
            snapshot["shell"]["summary"],
            Value::String(String::from(
                "Workspace 'audio', window 1440x900 (maximized)."
            ))
        );
        assert_eq!(
            snapshot["summary"],
            Value::String(String::from(
                "Target surface 'dashboard', workspace 'audio', commissioning stage 'ready', control surface 'Bridge ready at http://127.0.0.1:38201'."
            ))
        );
    }
}
