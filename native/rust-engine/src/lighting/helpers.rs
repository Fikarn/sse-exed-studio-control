use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::Path;
use std::str::FromStr;

use crate::app_state::APP_SETTINGS_PREFIX;
use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_CHECK_ID, LIGHTING_UNIVERSE_KEY};
use crate::lighting_backend::{
    read_default_lighting_inventory, LightingBackendConfig, LightingBackendInventory,
};
use crate::storage::{list_settings_by_prefix, open_connection, set_settings_owned};

use super::fixture_catalog::ResolvedFixtureProfile;
use super::types::*;
use super::*;

pub(super) fn normalized_fixture_type(
    explicit_type: Option<&str>,
    legacy_kind: Option<&str>,
    fixture_id: &str,
) -> String {
    let definition = resolve_fixture_definition(None, explicit_type, legacy_kind, fixture_id);
    fixture_type_for_definition(definition.id.as_str())
}

pub(super) fn fixture_type_for_fixture(fixture: &LightingFixtureSnapshot) -> String {
    normalized_fixture_type(
        Some(fixture.fixture_type.as_str()),
        Some(fixture.kind.as_str()),
        fixture.id.as_str(),
    )
}

pub(super) fn validate_fixture_type(value: &str) -> Option<String> {
    resolve_fixture_alias(value)
        .map(|definition_id| fixture_type_for_definition(definition_id.as_str()))
}

pub(super) fn validate_effect_type(value: &str) -> Option<String> {
    match value {
        "pulse" | "strobe" | "candle" => Some(String::from(value)),
        _ => None,
    }
}

pub(super) fn fixture_channel_count(fixture_type: &str) -> i64 {
    resolve_fixture_profile(None, None, Some(fixture_type), None, "").channel_count
}

pub(super) fn fixture_cct_range(fixture_type: &str) -> (i64, i64) {
    fixture_cct_range_from_profile(&resolve_fixture_profile(
        None,
        None,
        Some(fixture_type),
        None,
        "",
    ))
}

pub(super) fn intensity_to_dmx(percent: i64) -> i64 {
    ((clamp_i64(percent, 0, 100) as f64) * 2.55).round() as i64
}

pub(super) fn cct_to_dmx(kelvin: i64, min: i64, max: i64) -> i64 {
    let clamped = clamp_i64(kelvin, min, max);
    (((clamped - min) as f64 / (max - min) as f64) * 255.0).round() as i64
}

pub(super) fn default_fixture_cct_for_type(fixture_type: &str) -> i64 {
    fixture_default_cct(&resolve_fixture_profile(
        None,
        None,
        Some(fixture_type),
        None,
        "",
    ))
}

pub(super) fn normalize_dmx_start_address(dmx_start_address: i64, fixture_type: &str) -> i64 {
    let channel_count = fixture_channel_count(fixture_type);
    if channel_count <= 0 {
        return 0;
    }
    let max_start = 512 - channel_count + 1;
    clamp_i64(dmx_start_address, 1, max_start)
}

pub(super) fn normalize_lighting_effect(effect: LightingEffect) -> LightingEffect {
    LightingEffect {
        effect_type: validate_effect_type(effect.effect_type.as_str())
            .unwrap_or_else(|| String::from("pulse")),
        speed: clamp_i64(effect.speed, 1, 10),
    }
}

pub(super) fn clamp_cct_for_type(cct: i64, fixture_type: &str, default_cct: i64) -> i64 {
    let (min_cct, max_cct) = fixture_cct_range(fixture_type);
    let seed = if cct == 0 { default_cct } else { cct };
    clamp_i64(seed, min_cct, max_cct)
}

pub(super) fn validate_group_exists(
    groups: &[LightingEditorGroupState],
    group_id: Option<&str>,
) -> Result<(), LightingCommandError> {
    if let Some(group_id) = group_id {
        if !groups.iter().any(|group| group.id == group_id) {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_GROUP_NOT_FOUND",
                format!(
                    "Lighting group '{}' is not exposed by the native editor state.",
                    group_id
                ),
            ));
        }
    }

    Ok(())
}

pub(super) fn validate_dmx_start_address(
    fixtures: &[LightingEditorFixtureState],
    profile: &ResolvedFixtureProfile,
    universe: i64,
    dmx_start_address: i64,
    exclude_fixture_id: Option<&str>,
) -> Result<(), LightingCommandError> {
    if profile.channel_count <= 0 {
        return Ok(());
    }
    let max_start = 512 - profile.channel_count + 1;
    if !(1..=max_start).contains(&dmx_start_address) {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_INVALID_DMX_ADDRESS",
            format!(
                "DMX start address must be between 1 and {} for fixture definition '{}' mode '{}'.",
                max_start, profile.definition_id, profile.mode_id
            ),
        ));
    }

    let new_end = dmx_start_address + profile.channel_count - 1;
    if let Some(overlap_fixture) = fixtures.iter().find(|fixture| {
        if exclude_fixture_id == Some(fixture.id.as_str()) {
            return false;
        }
        if fixture.universe != universe {
            return false;
        }
        let existing_profile = fixture_profile_for_state(fixture);
        if existing_profile.channel_count <= 0 {
            return false;
        }
        let existing_end = fixture.dmx_start_address + existing_profile.channel_count - 1;
        dmx_start_address <= existing_end && new_end >= fixture.dmx_start_address
    }) {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_DMX_OVERLAP",
            format!(
                "DMX address overlaps with '{}' at {}.",
                overlap_fixture.name, overlap_fixture.dmx_start_address
            ),
        ));
    }

    Ok(())
}

pub(super) fn fixture_profile_for_state(
    fixture: &LightingEditorFixtureState,
) -> ResolvedFixtureProfile {
    resolve_fixture_profile(
        fixture.definition_id.as_deref(),
        fixture.mode_id.as_deref(),
        Some(fixture.fixture_type.as_str()),
        Some(fixture.kind.as_str()),
        fixture.id.as_str(),
    )
}

pub(super) fn fixture_profile_for_snapshot(
    fixture: &LightingFixtureSnapshot,
) -> ResolvedFixtureProfile {
    resolve_fixture_profile(
        Some(fixture.definition_id.as_str()),
        Some(fixture.mode_id.as_str()),
        Some(fixture.fixture_type.as_str()),
        Some(fixture.kind.as_str()),
        fixture.id.as_str(),
    )
}

pub(super) fn normalize_fixture_control_values(
    profile: &ResolvedFixtureProfile,
    control_values: &HashMap<String, i64>,
) -> HashMap<String, i64> {
    let definition =
        resolve_fixture_definition(Some(profile.definition_id.as_str()), None, None, "");
    let mode = resolve_fixture_mode(&definition, Some(profile.mode_id.as_str()));
    let mut normalized = HashMap::new();
    for control in mode.controls {
        if matches!(control.id.as_str(), "intensity" | "cct") {
            continue;
        }
        let value = control_values
            .get(control.id.as_str())
            .copied()
            .unwrap_or(control.default_value);
        normalized.insert(control.id, clamp_i64(value, control.min, control.max));
    }
    normalized
}

pub(super) fn effective_fixture_control_values(
    fixture: &LightingEditorFixtureState,
) -> HashMap<String, i64> {
    let profile = fixture_profile_for_state(fixture);
    let mut values = normalize_fixture_control_values(&profile, &fixture.control_values);
    values.insert(
        String::from("intensity"),
        clamp_i64(fixture.intensity, 0, 100),
    );
    if profile.capabilities.iter().any(|value| value == "cct") {
        let (min_cct, max_cct) = fixture_cct_range_from_profile(&profile);
        values.insert(
            String::from("cct"),
            clamp_i64(fixture.cct, min_cct, max_cct),
        );
    }
    values
}

pub(super) fn append_fixture_to_scenes(
    scenes: &mut [LightingEditorSceneState],
    fixture: &LightingEditorFixtureState,
) {
    for scene in scenes {
        if scene
            .fixture_states
            .iter()
            .any(|fixture_state| fixture_state.fixture_id == fixture.id)
        {
            continue;
        }
        scene.fixture_states.push(LightingEditorSceneFixtureState {
            fixture_id: fixture.id.clone(),
            intensity: fixture.intensity,
            cct: fixture.cct,
            on: fixture.on,
            control_values: effective_fixture_control_values(fixture),
        });
    }
}

pub(super) fn remove_fixture_from_scenes(
    scenes: &mut [LightingEditorSceneState],
    fixture_id: &str,
) {
    for scene in scenes {
        scene
            .fixture_states
            .retain(|fixture_state| fixture_state.fixture_id != fixture_id);
    }
}

pub(super) fn lighting_fixture_update_summary(fixture: &LightingEditorFixtureState) -> String {
    let spatial_summary = match (fixture.spatial_x, fixture.spatial_y) {
        (Some(x), Some(y)) => format!(
            "manual layout at {:.0}% / {:.0}% / {:.0}deg",
            x * 100.0,
            y * 100.0,
            fixture.spatial_rotation
        ),
        _ => format!("auto layout / {:.0}deg", fixture.spatial_rotation),
    };
    let effect_summary = fixture
        .effect
        .as_ref()
        .map(|effect| format!("{} at speed {}", effect.effect_type, effect.speed))
        .unwrap_or_else(|| String::from("no effect"));
    format!(
        "Lighting fixture '{}' ({}, DMX {}) saved as {} at {}% / {}K in {} with {} and {}.",
        fixture.name,
        fixture.fixture_type,
        fixture.dmx_start_address,
        if fixture.on { "on" } else { "off" },
        fixture.intensity,
        fixture.cct,
        fixture.group_id.as_deref().unwrap_or("ungrouped"),
        spatial_summary,
        effect_summary
    )
}

pub(super) fn lighting_scene_update_summary(
    scene: &LightingEditorSceneState,
    request: &LightingSceneUpdateRequest,
) -> String {
    let mut parts = Vec::new();
    if request.name.is_some() {
        parts.push(String::from("renamed"));
    }
    if request.capture_current_state {
        parts.push(String::from("captured current fixture state"));
    }
    if let Some(color_index) = request.color_index {
        parts.push(if color_index.is_some() {
            String::from("recolored")
        } else {
            String::from("color cleared")
        });
    }

    if parts.is_empty() {
        format!("Lighting scene '{}' was updated.", scene.name)
    } else {
        format!("Lighting scene '{}' {}.", scene.name, parts.join(" and "))
    }
}

pub(super) fn lighting_adapter_label(adapter_mode: &str) -> &'static str {
    if adapter_mode == "simulated" {
        "Simulated"
    } else {
        "Native"
    }
}

pub(super) fn is_valid_ipv4(value: &str) -> bool {
    Ipv4Addr::from_str(value.trim()).is_ok()
}

pub(super) fn recall_mode_label(fade_duration_seconds: f64) -> String {
    if fade_duration_seconds <= 0.0 {
        String::from("instant recall")
    } else if fade_duration_seconds.fract() == 0.0 {
        format!("{}s fade", fade_duration_seconds as i64)
    } else {
        format!("{fade_duration_seconds:.1}s fade")
    }
}

pub(super) fn load_lighting_settings(
    db_path: &Path,
) -> Result<HashMap<String, String>, LightingCommandError> {
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))
}

pub(super) fn resolve_lighting_config(settings: &HashMap<String, String>) -> LightingBackendConfig {
    let bridge_ip = settings
        .get(LIGHTING_BRIDGE_IP_KEY)
        .cloned()
        .unwrap_or_default();
    let enabled = read_lighting_output_enabled(settings, &bridge_ip);
    let universe = settings
        .get(LIGHTING_UNIVERSE_KEY)
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (1..=63999).contains(value))
        .unwrap_or(DEFAULT_UNIVERSE);

    LightingBackendConfig {
        enabled,
        bridge_ip,
        universe,
    }
}

pub(super) fn read_lighting_editor_inventory(
    config: &LightingBackendConfig,
) -> LightingBackendInventory {
    let inventory_config = LightingBackendConfig {
        enabled: !config.bridge_ip.trim().is_empty(),
        bridge_ip: config.bridge_ip.clone(),
        universe: config.universe,
    };
    read_default_lighting_inventory(&inventory_config)
}

pub(super) fn ensure_lighting_action_allowed(
    db_path: &Path,
    snapshot: &LightingSnapshot,
) -> Result<(), LightingCommandError> {
    let rejected = match snapshot.status.as_str() {
        "ready" => None,
        "attention" => Some((
            "LIGHTING_PROBE_FAILED",
            String::from(
                "Lighting transport is in attention state. Fix the bridge connection and rerun the commissioning lighting probe before recalling scenes.",
            ),
        )),
        "not-verified" => Some((
            "LIGHTING_NOT_VERIFIED",
            String::from(
                "Run the commissioning lighting probe before recalling native lighting scenes.",
            ),
        )),
        "disabled" => Some((
            "LIGHTING_DISABLED",
            String::from(
                "Lighting output is disabled. Enable the transport and rerun the commissioning lighting probe before recalling native lighting scenes.",
            ),
        )),
        _ => Some((
            "LIGHTING_UNCONFIGURED",
            String::from(
                "Lighting bridge settings are incomplete. Configure the bridge and universe before recalling native lighting scenes.",
            ),
        )),
    };

    if let Some((code, message)) = rejected {
        record_lighting_action_failure(db_path, code, &message)?;
        return Err(LightingCommandError::Rejected(code, message));
    }

    Ok(())
}

pub(super) fn persist_lighting_state(
    db_path: &Path,
    updates: &[(String, String)],
) -> Result<(), LightingCommandError> {
    set_settings_owned(db_path, updates)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))
}

pub(super) fn record_lighting_action_failure(
    db_path: &Path,
    code: &str,
    message: &str,
) -> Result<(), LightingCommandError> {
    persist_lighting_state(
        db_path,
        &[
            (
                String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
                String::from("failed"),
            ),
            (
                String::from(LIGHTING_LAST_ACTION_CODE_KEY),
                String::from(code),
            ),
            (
                String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
                String::from(message),
            ),
        ],
    )
}

pub(super) fn current_timestamp(db_path: &Path) -> Result<String, LightingCommandError> {
    let connection = open_connection(db_path)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))?;
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| LightingCommandError::Storage(error.to_string()))
}

pub(super) fn lighting_check_status(settings: &HashMap<String, String>) -> String {
    settings
        .get(&format!(
            "app.commissioning.check.{LIGHTING_CHECK_ID}.status"
        ))
        .cloned()
        .unwrap_or_else(|| String::from("idle"))
}

pub(super) fn read_optional_setting(
    settings: &HashMap<String, String>,
    key: &str,
) -> Option<String> {
    settings
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

pub(super) fn read_selected_fixture_id(
    settings: &HashMap<String, String>,
    fixtures: &[LightingFixtureSnapshot],
) -> Option<String> {
    read_optional_setting(settings, LIGHTING_SELECTED_FIXTURE_ID_KEY).filter(
        |selected_fixture_id| {
            fixtures
                .iter()
                .any(|fixture| fixture.id == *selected_fixture_id)
        },
    )
}

pub(super) fn read_selected_scene_id(
    settings: &HashMap<String, String>,
    scenes: &[LightingSceneSnapshot],
) -> Option<String> {
    read_optional_setting(settings, LIGHTING_SELECTED_SCENE_ID_KEY)
        .filter(|selected_scene_id| scenes.iter().any(|scene| scene.id == *selected_scene_id))
}

pub(super) fn read_lighting_grand_master(settings: &HashMap<String, String>) -> i64 {
    settings
        .get(LIGHTING_GRAND_MASTER_KEY)
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| clamp_i64(value, 0, 100))
        .unwrap_or(100)
}

pub(super) fn read_lighting_output_enabled(
    settings: &HashMap<String, String>,
    bridge_ip: &str,
) -> bool {
    settings
        .get(LIGHTING_ENABLED_KEY)
        .and_then(|value| match value.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
        .unwrap_or_else(|| !bridge_ip.trim().is_empty())
}

pub(super) fn read_marker_setting(
    settings: &HashMap<String, String>,
    key: &str,
) -> Option<LightingSpatialMarker> {
    read_optional_setting(settings, key)
        .and_then(|value| serde_json::from_str::<LightingSpatialMarker>(&value).ok())
        .map(normalize_marker)
}

pub(super) fn serialize_optional_marker(
    marker: Option<&LightingSpatialMarker>,
) -> Result<String, LightingCommandError> {
    marker
        .cloned()
        .map(normalize_marker)
        .map(|marker| serde_json::to_string(&marker))
        .transpose()
        .map_err(|error| LightingCommandError::Storage(error.to_string()))
        .map(|value| value.unwrap_or_default())
}

pub(super) fn normalize_optional_coordinate(value: Option<f64>) -> Option<f64> {
    value
        .filter(|coordinate| coordinate.is_finite())
        .map(|coordinate| clamp_f64(coordinate, 0.0, 1.0))
}

pub(super) fn normalize_rotation(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }

    let normalized = value.rem_euclid(360.0);
    if normalized == 360.0 {
        0.0
    } else {
        normalized
    }
}

pub(super) fn normalize_marker(marker: LightingSpatialMarker) -> LightingSpatialMarker {
    LightingSpatialMarker {
        x: clamp_f64(marker.x, 0.0, 1.0),
        y: clamp_f64(marker.y, 0.0, 1.0),
        rotation: normalize_rotation(marker.rotation),
    }
}

pub(super) fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

pub(super) fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

pub(super) struct LightingSummaryContext<'a> {
    pub(super) status: &'a str,
    pub(super) bridge_ip: &'a str,
    pub(super) universe: i64,
    pub(super) fixture_count: usize,
    pub(super) group_count: usize,
    pub(super) scene_count: usize,
    pub(super) last_recalled_scene_id: Option<&'a str>,
    pub(super) last_scene_recall_at: Option<&'a str>,
    pub(super) last_action_status: &'a str,
    pub(super) last_action_code: Option<&'a str>,
    pub(super) last_action_message: Option<&'a str>,
}

pub(super) fn lighting_summary(context: LightingSummaryContext<'_>) -> String {
    let LightingSummaryContext {
        status,
        bridge_ip,
        universe,
        fixture_count,
        group_count,
        scene_count,
        last_recalled_scene_id,
        last_scene_recall_at,
        last_action_status,
        last_action_code,
        last_action_message,
    } = context;

    let transport_summary = match status {
        "ready" => format!(
            "Bridge {} responded on universe {}. Native lighting state currently tracks {} fixtures, {} groups, and {} scenes.",
            bridge_ip, universe, fixture_count, group_count, scene_count
        ),
        "disabled" => format!(
            "Lighting output is disabled. Bridge {} remains configured on universe {} while native lighting continues tracking {} fixtures, {} groups, and {} scenes.",
            bridge_ip, universe, fixture_count, group_count, scene_count
        ),
        "attention" => format!(
            "Bridge {} did not respond on universe {}. Native lighting state still tracks {} fixtures, {} groups, and {} scenes while connectivity is corrected.",
            bridge_ip, universe, fixture_count, group_count, scene_count
        ),
        "not-verified" => format!(
            "Bridge {} is configured on universe {}. Native lighting state currently tracks {} fixtures, {} groups, and {} scenes before the lighting probe runs.",
            bridge_ip, universe, fixture_count, group_count, scene_count
        ),
        _ => String::from(
            "No lighting bridge is configured yet. Run the commissioning lighting probe before adapter work lands.",
        ),
    };

    let recall_summary = match last_recalled_scene_id {
        Some(scene_id) => format!(
            " Last scene recall: {}{}.",
            scene_id,
            last_scene_recall_at
                .map(|timestamp| format!(" at {timestamp}"))
                .unwrap_or_default()
        ),
        None => String::from(" No lighting scene recall has been recorded yet."),
    };

    let action_summary = match last_action_status {
        "failed" => format!(
            " Last action failed{}{}",
            last_action_code
                .map(|code| format!(" ({code})"))
                .unwrap_or_default(),
            last_action_message
                .map(|message| format!(": {message}."))
                .unwrap_or_else(|| String::from("."))
        ),
        "succeeded" => last_action_message
            .map(|message| format!(" Last action: {message}."))
            .unwrap_or_default(),
        _ => String::new(),
    };

    format!("{transport_summary}{recall_summary}{action_summary}")
}
