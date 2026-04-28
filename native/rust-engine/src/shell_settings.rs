use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

pub const SHELL_SETTINGS_PREFIX: &str = "shell.";
pub const WORKSPACE_KEY: &str = "shell.workspace";
pub const SETUP_ACTIVE_SECTION_KEY: &str = "shell.setup.activeSection";
pub const LIGHTING_CURRENT_SECTION_ID_KEY: &str = "shell.lighting.currentSectionId";
pub const LIGHTING_SELECTED_CUE_ID_KEY: &str = "shell.lighting.selectedCueId";
pub const LIGHTING_SCENE_THUMBS_KEY: &str = "shell.lighting.sceneThumbs";
pub const WINDOW_WIDTH_KEY: &str = "shell.window.width";
pub const WINDOW_HEIGHT_KEY: &str = "shell.window.height";
pub const WINDOW_MAXIMIZED_KEY: &str = "shell.window.maximized";
pub const WINDOW_MODE_KEY: &str = "shell.window.mode";

pub const DEFAULT_WORKSPACE: &str = "planning";
pub const DEFAULT_SETUP_ACTIVE_SECTION: &str = "commissioning";
pub const DEFAULT_WINDOW_WIDTH: i64 = 1280;
pub const DEFAULT_WINDOW_HEIGHT: i64 = 800;
pub const DEFAULT_WINDOW_MAXIMIZED: bool = false;
pub const DEFAULT_WINDOW_MODE: &str = "fullscreen";

const MIN_WINDOW_WIDTH: i64 = 800;
const MAX_WINDOW_WIDTH: i64 = 8192;
const MIN_WINDOW_HEIGHT: i64 = 600;
const MAX_WINDOW_HEIGHT: i64 = 4320;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ShellSettingsSnapshot {
    pub workspace: String,
    pub setup_active_section: String,
    pub lighting_current_section_id: Option<String>,
    pub lighting_selected_cue_id: Option<String>,
    pub lighting_scene_thumbs: HashMap<String, String>,
    pub window_width: i64,
    pub window_height: i64,
    pub window_maximized: bool,
    pub window_mode: String,
}

impl Default for ShellSettingsSnapshot {
    fn default() -> Self {
        Self {
            workspace: String::from(DEFAULT_WORKSPACE),
            setup_active_section: String::from(DEFAULT_SETUP_ACTIVE_SECTION),
            lighting_current_section_id: None,
            lighting_selected_cue_id: None,
            lighting_scene_thumbs: HashMap::new(),
            window_width: DEFAULT_WINDOW_WIDTH,
            window_height: DEFAULT_WINDOW_HEIGHT,
            window_maximized: DEFAULT_WINDOW_MAXIMIZED,
            window_mode: String::from(DEFAULT_WINDOW_MODE),
        }
    }
}

impl ShellSettingsSnapshot {
    pub fn from_settings(settings: &HashMap<String, String>) -> Self {
        let mut snapshot = Self::default();

        if let Some(workspace) = settings.get(WORKSPACE_KEY) {
            if is_valid_workspace(workspace) {
                snapshot.workspace = workspace.clone();
            }
        }

        if let Some(section) = settings.get(SETUP_ACTIVE_SECTION_KEY) {
            if is_valid_setup_active_section(section) {
                snapshot.setup_active_section = section.clone();
            }
        }

        snapshot.lighting_current_section_id = settings
            .get(LIGHTING_CURRENT_SECTION_ID_KEY)
            .and_then(|value| parse_optional_shell_state_value(value));
        snapshot.lighting_selected_cue_id = settings
            .get(LIGHTING_SELECTED_CUE_ID_KEY)
            .and_then(|value| parse_optional_shell_state_value(value));
        snapshot.lighting_scene_thumbs = settings
            .get(LIGHTING_SCENE_THUMBS_KEY)
            .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(raw).ok())
            .unwrap_or_default();

        if let Some(width) = settings
            .get(WINDOW_WIDTH_KEY)
            .and_then(|value| parse_window_dimension(value, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH))
        {
            snapshot.window_width = width;
        }

        if let Some(height) = settings
            .get(WINDOW_HEIGHT_KEY)
            .and_then(|value| parse_window_dimension(value, MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT))
        {
            snapshot.window_height = height;
        }

        if let Some(maximized) = settings
            .get(WINDOW_MAXIMIZED_KEY)
            .and_then(|value| parse_bool(value))
        {
            snapshot.window_maximized = maximized;
        }

        if let Some(window_mode) = settings.get(WINDOW_MODE_KEY) {
            if is_valid_window_mode(window_mode) {
                snapshot.window_mode = window_mode.clone();
                snapshot.window_maximized = window_mode == "maximized";
            }
        } else {
            snapshot.window_mode = if snapshot.window_maximized {
                String::from("maximized")
            } else {
                String::from(DEFAULT_WINDOW_MODE)
            };
        }

        snapshot
    }

    pub fn to_response_payload(&self, settings: &HashMap<String, String>) -> Value {
        json!({
            "settings": settings,
            "shell": {
                "workspace": self.workspace,
                "setup": {
                    "activeSection": self.setup_active_section,
                },
                "lighting": {
                    "currentSectionId": self.lighting_current_section_id,
                    "selectedCueId": self.lighting_selected_cue_id,
                    "sceneThumbs": self.lighting_scene_thumbs,
                },
                "window": {
                    "width": self.window_width,
                    "height": self.window_height,
                    "maximized": self.window_maximized,
                    "mode": self.window_mode,
                }
            }
        })
    }
}

pub fn default_settings_entries() -> Vec<(&'static str, &'static str)> {
    vec![
        (WORKSPACE_KEY, DEFAULT_WORKSPACE),
        (SETUP_ACTIVE_SECTION_KEY, DEFAULT_SETUP_ACTIVE_SECTION),
        (LIGHTING_CURRENT_SECTION_ID_KEY, ""),
        (LIGHTING_SELECTED_CUE_ID_KEY, ""),
        (LIGHTING_SCENE_THUMBS_KEY, "{}"),
        (WINDOW_WIDTH_KEY, "1280"),
        (WINDOW_HEIGHT_KEY, "800"),
        (WINDOW_MAXIMIZED_KEY, "false"),
        (WINDOW_MODE_KEY, DEFAULT_WINDOW_MODE),
    ]
}

pub fn parse_settings_update(params: &Value) -> Result<Vec<(&'static str, String)>, String> {
    let mut updates = Vec::new();

    if let Some(workspace_value) = params.get("workspace") {
        let workspace = workspace_value
            .as_str()
            .ok_or_else(|| String::from("workspace must be a string"))?;

        if !is_valid_workspace(workspace) {
            return Err(String::from(
                "workspace must be one of: planning, lighting, audio, setup",
            ));
        }

        updates.push((WORKSPACE_KEY, workspace.to_string()));
    }

    if let Some(setup_value) = params.get("setup") {
        let setup = setup_value
            .as_object()
            .ok_or_else(|| String::from("setup must be an object"))?;

        if let Some(active_section_value) = setup.get("activeSection") {
            let active_section = active_section_value
                .as_str()
                .ok_or_else(|| String::from("setup.activeSection must be a string"))?;

            if !is_valid_setup_active_section(active_section) {
                return Err(String::from(
                    "setup.activeSection must be one of: commissioning, support",
                ));
            }

            updates.push((SETUP_ACTIVE_SECTION_KEY, active_section.to_string()));
        }
    }

    if let Some(lighting_value) = params.get("lighting") {
        let lighting = lighting_value
            .as_object()
            .ok_or_else(|| String::from("lighting must be an object"))?;

        if let Some(current_section_id_value) = lighting.get("currentSectionId") {
            let current_section_id = parse_optional_shell_state_update_value(
                current_section_id_value,
                "lighting.currentSectionId",
            )?;
            updates.push((
                LIGHTING_CURRENT_SECTION_ID_KEY,
                current_section_id.unwrap_or_default(),
            ));
        }

        if let Some(selected_cue_id_value) = lighting.get("selectedCueId") {
            let selected_cue_id = parse_optional_shell_state_update_value(
                selected_cue_id_value,
                "lighting.selectedCueId",
            )?;
            updates.push((
                LIGHTING_SELECTED_CUE_ID_KEY,
                selected_cue_id.unwrap_or_default(),
            ));
        }

        if let Some(scene_thumbs_value) = lighting.get("sceneThumbs") {
            let scene_thumbs = scene_thumbs_value
                .as_object()
                .ok_or_else(|| String::from("lighting.sceneThumbs must be an object"))?;

            let mut thumbs: HashMap<String, String> = HashMap::with_capacity(scene_thumbs.len());
            for (scene_id, thumb_value) in scene_thumbs {
                let thumb = thumb_value
                    .as_str()
                    .ok_or_else(|| format!("lighting.sceneThumbs.{scene_id} must be a string"))?;
                thumbs.insert(scene_id.clone(), thumb.to_string());
            }

            let serialized = serde_json::to_string(&thumbs)
                .map_err(|err| format!("lighting.sceneThumbs failed to serialize: {err}"))?;
            updates.push((LIGHTING_SCENE_THUMBS_KEY, serialized));
        }
    }

    if let Some(window_value) = params.get("window") {
        let window = window_value
            .as_object()
            .ok_or_else(|| String::from("window must be an object"))?;

        if let Some(width_value) = window.get("width") {
            let width = width_value
                .as_i64()
                .ok_or_else(|| String::from("window.width must be an integer"))?;
            validate_window_dimension(width, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH, "window.width")?;
            updates.push((WINDOW_WIDTH_KEY, width.to_string()));
        }

        if let Some(height_value) = window.get("height") {
            let height = height_value
                .as_i64()
                .ok_or_else(|| String::from("window.height must be an integer"))?;
            validate_window_dimension(
                height,
                MIN_WINDOW_HEIGHT,
                MAX_WINDOW_HEIGHT,
                "window.height",
            )?;
            updates.push((WINDOW_HEIGHT_KEY, height.to_string()));
        }

        if let Some(maximized_value) = window.get("maximized") {
            let maximized = maximized_value
                .as_bool()
                .ok_or_else(|| String::from("window.maximized must be a boolean"))?;
            updates.push((WINDOW_MAXIMIZED_KEY, maximized.to_string()));
        }

        if let Some(mode_value) = window.get("mode") {
            let mode = mode_value
                .as_str()
                .ok_or_else(|| String::from("window.mode must be a string"))?;

            if !is_valid_window_mode(mode) {
                return Err(String::from(
                    "window.mode must be one of: windowed, maximized, fullscreen",
                ));
            }

            updates.push((WINDOW_MODE_KEY, mode.to_string()));
            updates.push((WINDOW_MAXIMIZED_KEY, (mode == "maximized").to_string()));
        }
    }

    if updates.is_empty() {
        return Err(String::from(
            "settings.update requires one or more supported fields",
        ));
    }

    Ok(updates)
}

pub fn is_valid_workspace(workspace: &str) -> bool {
    matches!(workspace, "planning" | "lighting" | "audio" | "setup")
}

pub fn is_valid_setup_active_section(active_section: &str) -> bool {
    matches!(active_section, "commissioning" | "support")
}

pub fn is_valid_window_mode(window_mode: &str) -> bool {
    matches!(window_mode, "windowed" | "maximized" | "fullscreen")
}

fn parse_window_dimension(value: &str, minimum: i64, maximum: i64) -> Option<i64> {
    let parsed = value.parse::<i64>().ok()?;
    if parsed < minimum || parsed > maximum {
        return None;
    }

    Some(parsed)
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn parse_optional_shell_state_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(String::from(trimmed))
    }
}

fn parse_optional_shell_state_update_value(
    value: &Value,
    field: &str,
) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let parsed = value
        .as_str()
        .map(str::trim)
        .ok_or_else(|| format!("{field} must be a string or null"))?;
    if parsed.is_empty() {
        return Ok(None);
    }

    Ok(Some(String::from(parsed)))
}

fn validate_window_dimension(
    value: i64,
    minimum: i64,
    maximum: i64,
    name: &str,
) -> Result<(), String> {
    if value < minimum || value > maximum {
        return Err(format!("{name} must be between {minimum} and {maximum}"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_uses_defaults_when_values_are_missing() {
        let settings = HashMap::new();
        let snapshot = ShellSettingsSnapshot::from_settings(&settings);

        assert_eq!(snapshot.workspace, DEFAULT_WORKSPACE);
        assert_eq!(snapshot.setup_active_section, DEFAULT_SETUP_ACTIVE_SECTION);
        assert_eq!(snapshot.lighting_current_section_id, None);
        assert_eq!(snapshot.lighting_selected_cue_id, None);
        assert_eq!(snapshot.window_width, DEFAULT_WINDOW_WIDTH);
        assert_eq!(snapshot.window_height, DEFAULT_WINDOW_HEIGHT);
        assert_eq!(snapshot.window_maximized, DEFAULT_WINDOW_MAXIMIZED);
        assert_eq!(snapshot.window_mode, DEFAULT_WINDOW_MODE);
    }

    #[test]
    fn snapshot_parses_valid_window_settings() {
        let settings = HashMap::from([
            (String::from(WORKSPACE_KEY), String::from("audio")),
            (
                String::from(SETUP_ACTIVE_SECTION_KEY),
                String::from("support"),
            ),
            (
                String::from(LIGHTING_CURRENT_SECTION_ID_KEY),
                String::from("stage-left"),
            ),
            (
                String::from(LIGHTING_SELECTED_CUE_ID_KEY),
                String::from("cue-14"),
            ),
            (String::from(WINDOW_WIDTH_KEY), String::from("1440")),
            (String::from(WINDOW_HEIGHT_KEY), String::from("900")),
            (String::from(WINDOW_MAXIMIZED_KEY), String::from("true")),
            (String::from(WINDOW_MODE_KEY), String::from("maximized")),
        ]);

        let snapshot = ShellSettingsSnapshot::from_settings(&settings);

        assert_eq!(snapshot.workspace, "audio");
        assert_eq!(snapshot.setup_active_section, "support");
        assert_eq!(
            snapshot.lighting_current_section_id.as_deref(),
            Some("stage-left")
        );
        assert_eq!(snapshot.lighting_selected_cue_id.as_deref(), Some("cue-14"));
        assert_eq!(snapshot.window_width, 1440);
        assert_eq!(snapshot.window_height, 900);
        assert!(snapshot.window_maximized);
        assert_eq!(snapshot.window_mode, "maximized");
    }

    #[test]
    fn settings_update_accepts_workspace_and_window_state() {
        let params = json!({
            "workspace": "lighting",
            "setup": {
                "activeSection": "support"
            },
            "lighting": {
                "currentSectionId": "stage-left",
                "selectedCueId": "cue-14"
            },
            "window": {
                "width": 1600,
                "height": 900,
                "mode": "fullscreen"
            }
        });

        let updates = parse_settings_update(&params).expect("updates should parse");

        assert_eq!(
            updates,
            vec![
                (WORKSPACE_KEY, String::from("lighting")),
                (SETUP_ACTIVE_SECTION_KEY, String::from("support")),
                (LIGHTING_CURRENT_SECTION_ID_KEY, String::from("stage-left")),
                (LIGHTING_SELECTED_CUE_ID_KEY, String::from("cue-14")),
                (WINDOW_WIDTH_KEY, String::from("1600")),
                (WINDOW_HEIGHT_KEY, String::from("900")),
                (WINDOW_MODE_KEY, String::from("fullscreen")),
                (WINDOW_MAXIMIZED_KEY, String::from("false")),
            ]
        );
    }

    #[test]
    fn settings_update_accepts_lighting_scene_thumbs() {
        let params = json!({
            "lighting": {
                "sceneThumbs": {
                    "scene-a": "data:image/svg+xml;base64,AAA",
                    "scene-b": "data:image/svg+xml;base64,BBB"
                }
            }
        });

        let updates = parse_settings_update(&params).expect("scene thumbs should parse");

        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].0, LIGHTING_SCENE_THUMBS_KEY);

        let parsed: HashMap<String, String> =
            serde_json::from_str(&updates[0].1).expect("serialised thumbs should parse");
        assert_eq!(parsed.len(), 2);
        assert_eq!(
            parsed.get("scene-a").map(String::as_str),
            Some("data:image/svg+xml;base64,AAA")
        );
        assert_eq!(
            parsed.get("scene-b").map(String::as_str),
            Some("data:image/svg+xml;base64,BBB")
        );
    }

    #[test]
    fn settings_update_rejects_non_string_scene_thumb_entry() {
        let params = json!({
            "lighting": {
                "sceneThumbs": {
                    "scene-a": 42
                }
            }
        });

        let error =
            parse_settings_update(&params).expect_err("non-string thumb should be rejected");
        assert_eq!(error, "lighting.sceneThumbs.scene-a must be a string");
    }

    #[test]
    fn settings_update_rejects_non_object_scene_thumbs() {
        let params = json!({
            "lighting": {
                "sceneThumbs": "not-an-object"
            }
        });

        let error =
            parse_settings_update(&params).expect_err("non-object thumbs should be rejected");
        assert_eq!(error, "lighting.sceneThumbs must be an object");
    }

    #[test]
    fn snapshot_round_trips_lighting_scene_thumbs() {
        let mut thumbs = HashMap::new();
        thumbs.insert(
            String::from("scene-a"),
            String::from("data:image/svg+xml;base64,AAA"),
        );
        thumbs.insert(
            String::from("scene-b"),
            String::from("data:image/svg+xml;base64,BBB"),
        );
        let serialised = serde_json::to_string(&thumbs).expect("serialise");

        let settings = HashMap::from([(String::from(LIGHTING_SCENE_THUMBS_KEY), serialised)]);
        let snapshot = ShellSettingsSnapshot::from_settings(&settings);

        assert_eq!(snapshot.lighting_scene_thumbs.len(), 2);
        assert_eq!(
            snapshot
                .lighting_scene_thumbs
                .get("scene-a")
                .map(String::as_str),
            Some("data:image/svg+xml;base64,AAA")
        );
    }

    #[test]
    fn snapshot_falls_back_to_empty_thumbs_when_blob_is_invalid() {
        let settings = HashMap::from([(
            String::from(LIGHTING_SCENE_THUMBS_KEY),
            String::from("not-json"),
        )]);
        let snapshot = ShellSettingsSnapshot::from_settings(&settings);

        assert!(snapshot.lighting_scene_thumbs.is_empty());
    }

    #[test]
    fn snapshot_upgrades_legacy_maximized_without_window_mode() {
        let settings = HashMap::from([(String::from(WINDOW_MAXIMIZED_KEY), String::from("true"))]);

        let snapshot = ShellSettingsSnapshot::from_settings(&settings);

        assert!(snapshot.window_maximized);
        assert_eq!(snapshot.window_mode, "maximized");
    }

    #[test]
    fn snapshot_defaults_legacy_windowed_state_to_fullscreen() {
        let settings = HashMap::from([(String::from(WINDOW_MAXIMIZED_KEY), String::from("false"))]);

        let snapshot = ShellSettingsSnapshot::from_settings(&settings);

        assert!(!snapshot.window_maximized);
        assert_eq!(snapshot.window_mode, "fullscreen");
    }

    #[test]
    fn settings_update_rejects_invalid_window_width() {
        let params = json!({
            "window": {
                "width": 200
            }
        });

        let error = parse_settings_update(&params).expect_err("width should be rejected");
        assert_eq!(error, "window.width must be between 800 and 8192");
    }

    #[test]
    fn settings_update_rejects_invalid_setup_active_section() {
        let params = json!({
            "setup": {
                "activeSection": "runner"
            }
        });

        let error = parse_settings_update(&params).expect_err("section should be rejected");
        assert_eq!(
            error,
            "setup.activeSection must be one of: commissioning, support"
        );
    }

    #[test]
    fn settings_update_accepts_null_lighting_shell_state_values() {
        let params = json!({
            "lighting": {
                "currentSectionId": null,
                "selectedCueId": null
            }
        });

        let updates = parse_settings_update(&params).expect("lighting state should parse");

        assert_eq!(
            updates,
            vec![
                (LIGHTING_CURRENT_SECTION_ID_KEY, String::new()),
                (LIGHTING_SELECTED_CUE_ID_KEY, String::new()),
            ]
        );
    }

    #[test]
    fn settings_update_rejects_invalid_lighting_shell_state_values() {
        let params = json!({
            "lighting": {
                "currentSectionId": 14
            }
        });

        let error = parse_settings_update(&params).expect_err("lighting state should be rejected");
        assert_eq!(error, "lighting.currentSectionId must be a string or null");
    }
}
