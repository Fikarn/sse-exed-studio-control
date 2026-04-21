use crate::app_state::APP_SETTINGS_PREFIX;
use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_CHECK_ID, LIGHTING_UNIVERSE_KEY};
use crate::lighting_backend::{
    read_default_lighting_inventory, recall_default_lighting_scene, LightingBackendConfig,
    LightingBackendInventory,
};
use crate::storage::{list_settings_by_prefix, open_connection, set_settings_owned};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use std::net::Ipv4Addr;
use std::path::Path;
use std::str::FromStr;

const DEFAULT_UNIVERSE: i64 = 1;
const DEFAULT_FIXTURE_INTENSITY: i64 = 100;
const DEFAULT_FIXTURE_CCT: i64 = 4500;
const MIN_FIXTURE_CCT: i64 = 2000;
const MAX_FIXTURE_CCT: i64 = 10000;

const LIGHTING_LAST_RECALLED_SCENE_ID_KEY: &str = "app.lighting.last_recalled_scene_id";
const LIGHTING_LAST_SCENE_RECALL_AT_KEY: &str = "app.lighting.last_scene_recall_at";
const LIGHTING_LAST_ACTION_STATUS_KEY: &str = "app.lighting.last_action_status";
const LIGHTING_LAST_ACTION_CODE_KEY: &str = "app.lighting.last_action_code";
const LIGHTING_LAST_ACTION_MESSAGE_KEY: &str = "app.lighting.last_action_message";
const LIGHTING_EDITOR_STATE_KEY: &str = "app.lighting.editor.state";
const LEGACY_LIGHTING_EDITOR_STATE_KEY: &str = "app.control_surface.lighting.state";
pub const LIGHTING_SELECTED_FIXTURE_ID_KEY: &str = "app.control_surface.selected_light_id";
const LIGHTING_ENABLED_KEY: &str = "app.lighting.enabled";
const LIGHTING_GRAND_MASTER_KEY: &str = "app.lighting.grand_master";
const LIGHTING_SELECTED_SCENE_ID_KEY: &str = "app.lighting.selected_scene_id";
const LIGHTING_CAMERA_MARKER_KEY: &str = "app.lighting.camera_marker";
const LIGHTING_SUBJECT_MARKER_KEY: &str = "app.lighting.subject_marker";
const LIGHTING_FIXTURE_STATE_PREFIX: &str = "app.lighting.fixture.";
const LIGHTING_CUSTOM_FIXTURE_ID_PREFIX: &str = "fixture-custom-";
const LIGHTING_CUSTOM_GROUP_ID_PREFIX: &str = "group-custom-";
const LIGHTING_CUSTOM_SCENE_ID_PREFIX: &str = "scene-custom-";
const LIGHTING_CUSTOM_CUE_ID_PREFIX: &str = "cue-custom-";
const DEFAULT_LIGHTING_FIXTURE_TYPE: &str = "astra-bicolor";

const LIGHTING_CUES_KEY: &str = "app.lighting.cues";
const LIGHTING_ACTIVE_CUE_ID_KEY: &str = "app.lighting.active_cue_id";
const MAX_FADE_MS: i64 = 60_000;
const MAX_FOLLOW_SECONDS: f64 = 3_600.0;
const MAX_CUE_LABEL_LEN: usize = 120;
const MAX_CUE_NOTES_LEN: usize = 500;

#[derive(Debug, Serialize, Clone)]
pub struct LightingSnapshot {
    pub status: String,
    pub summary: String,
    #[serde(rename = "adapterMode")]
    pub adapter_mode: String,
    #[serde(rename = "bridgeIp")]
    pub bridge_ip: String,
    pub universe: i64,
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "grandMaster")]
    pub grand_master: i64,
    #[serde(rename = "connected")]
    pub connected: bool,
    #[serde(rename = "reachable")]
    pub reachable: bool,
    #[serde(rename = "lastRecalledSceneId")]
    pub last_recalled_scene_id: Option<String>,
    #[serde(rename = "lastSceneRecallAt")]
    pub last_scene_recall_at: Option<String>,
    #[serde(rename = "lastActionStatus")]
    pub last_action_status: String,
    #[serde(rename = "lastActionCode")]
    pub last_action_code: Option<String>,
    #[serde(rename = "lastActionMessage")]
    pub last_action_message: Option<String>,
    #[serde(rename = "selectedSceneId")]
    pub selected_scene_id: Option<String>,
    #[serde(rename = "selectedFixtureId")]
    pub selected_fixture_id: Option<String>,
    #[serde(rename = "cameraMarker")]
    pub camera_marker: Option<LightingSpatialMarker>,
    #[serde(rename = "subjectMarker")]
    pub subject_marker: Option<LightingSpatialMarker>,
    pub fixtures: Vec<LightingFixtureSnapshot>,
    pub groups: Vec<LightingGroupSnapshot>,
    pub scenes: Vec<LightingSceneSnapshot>,
    pub cues: Vec<LightingCueSnapshot>,
    #[serde(rename = "activeCueId")]
    pub active_cue_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingFixtureSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub fixture_type: String,
    #[serde(rename = "dmxStartAddress")]
    pub dmx_start_address: i64,
    pub kind: String,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "spatialX")]
    pub spatial_x: Option<f64>,
    #[serde(rename = "spatialY")]
    pub spatial_y: Option<f64>,
    #[serde(rename = "spatialRotation")]
    pub spatial_rotation: f64,
    #[serde(rename = "rigZ")]
    pub rig_z: Option<f64>,
    #[serde(rename = "beamAngleDegrees")]
    pub beam_angle_degrees: Option<f64>,
    pub on: bool,
    pub intensity: i64,
    pub cct: i64,
    pub effect: Option<LightingEffect>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingGroupSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "fixtureCount")]
    pub fixture_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingSceneSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "fixtureCount")]
    pub fixture_count: usize,
    #[serde(rename = "fixtureStates")]
    pub fixture_states: Vec<LightingSceneFixtureSnapshot>,
    #[serde(rename = "lastRecalled")]
    pub last_recalled: bool,
    #[serde(rename = "lastRecalledAt")]
    pub last_recalled_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingSceneFixtureSnapshot {
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    pub intensity: i64,
    pub cct: i64,
    pub on: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingCueSnapshot {
    pub id: String,
    pub ordinal: i64,
    pub label: String,
    #[serde(rename = "sceneId")]
    pub scene_id: Option<String>,
    #[serde(rename = "fadeInMs")]
    pub fade_in_ms: i64,
    #[serde(rename = "fadeOutMs")]
    pub fade_out_ms: i64,
    #[serde(rename = "followSeconds")]
    pub follow_seconds: Option<f64>,
    pub notes: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorState {
    #[serde(default)]
    pub groups: Vec<LightingEditorGroupState>,
    #[serde(default)]
    pub removed_fixture_ids: Vec<String>,
    pub fixtures: Vec<LightingEditorFixtureState>,
    pub scenes: Vec<LightingEditorSceneState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingSpatialMarker {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorGroupState {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorFixtureState {
    pub id: String,
    pub name: String,
    #[serde(rename = "type", default = "default_fixture_type")]
    pub fixture_type: String,
    #[serde(
        rename = "dmxStartAddress",
        default = "default_fixture_dmx_start_address"
    )]
    pub dmx_start_address: i64,
    pub kind: String,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "spatialX", default)]
    pub spatial_x: Option<f64>,
    #[serde(rename = "spatialY", default)]
    pub spatial_y: Option<f64>,
    #[serde(rename = "spatialRotation", default)]
    pub spatial_rotation: f64,
    #[serde(rename = "rigZ", default)]
    pub rig_z: Option<f64>,
    #[serde(rename = "beamAngleDegrees", default)]
    pub beam_angle_degrees: Option<f64>,
    pub intensity: i64,
    pub cct: i64,
    pub on: bool,
    #[serde(default)]
    pub effect: Option<LightingEffect>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LightingEffect {
    #[serde(rename = "type")]
    pub effect_type: String,
    pub speed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorSceneState {
    pub id: String,
    pub name: String,
    #[serde(rename = "fixtureStates")]
    pub fixture_states: Vec<LightingEditorSceneFixtureState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorSceneFixtureState {
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    pub intensity: i64,
    pub cct: i64,
    pub on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorCueState {
    pub id: String,
    pub ordinal: i64,
    pub label: String,
    #[serde(rename = "sceneId", default)]
    pub scene_id: Option<String>,
    #[serde(rename = "fadeInMs", default)]
    pub fade_in_ms: i64,
    #[serde(rename = "fadeOutMs", default)]
    pub fade_out_ms: i64,
    #[serde(rename = "followSeconds", default)]
    pub follow_seconds: Option<f64>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingHealthCheck {
    pub ok: bool,
    pub status: String,
    pub summary: String,
    #[serde(rename = "bridgeIp")]
    pub bridge_ip: String,
    pub universe: i64,
    pub reachable: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingDmxMonitorSnapshot {
    pub channels: Vec<LightingDmxChannelSnapshot>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LightingDmxChannelSnapshot {
    pub channel: i64,
    pub value: i64,
    #[serde(rename = "lightName")]
    pub light_name: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct LightingSceneRecallResult {
    pub recalled: bool,
    #[serde(rename = "sceneId")]
    pub scene_id: String,
    #[serde(rename = "sceneName")]
    pub scene_name: String,
    #[serde(rename = "recalledAt")]
    pub recalled_at: String,
    #[serde(rename = "fadeDurationSeconds")]
    pub fade_duration_seconds: f64,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingFixtureCreateResult {
    pub fixture: LightingFixtureSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingFixtureUpdateResult {
    pub fixture: LightingFixtureSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingFixtureDeleteResult {
    pub deleted: bool,
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingAllPowerResult {
    #[serde(rename = "affectedFixtures")]
    pub affected_fixtures: usize,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingGroupPowerResult {
    #[serde(rename = "groupId")]
    pub group_id: String,
    #[serde(rename = "groupName")]
    pub group_name: String,
    #[serde(rename = "affectedFixtures")]
    pub affected_fixtures: usize,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingGroupCreateResult {
    pub group: LightingGroupSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingGroupUpdateResult {
    pub group: LightingGroupSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingGroupDeleteResult {
    pub deleted: bool,
    #[serde(rename = "groupId")]
    pub group_id: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingSettingsUpdateResult {
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "bridgeIp")]
    pub bridge_ip: String,
    pub universe: i64,
    #[serde(rename = "grandMaster")]
    pub grand_master: i64,
    #[serde(rename = "selectedSceneId")]
    pub selected_scene_id: Option<String>,
    #[serde(rename = "selectedFixtureId")]
    pub selected_fixture_id: Option<String>,
    #[serde(rename = "cameraMarker")]
    pub camera_marker: Option<LightingSpatialMarker>,
    #[serde(rename = "subjectMarker")]
    pub subject_marker: Option<LightingSpatialMarker>,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingSceneCreateResult {
    pub scene: LightingSceneSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingSceneUpdateResult {
    pub scene: LightingSceneSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingSceneDeleteResult {
    pub deleted: bool,
    #[serde(rename = "sceneId")]
    pub scene_id: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingCueCreateResult {
    pub cue: LightingCueSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingCueUpdateResult {
    pub cue: LightingCueSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingCueDeleteResult {
    pub deleted: bool,
    #[serde(rename = "cueId")]
    pub cue_id: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingCueFireResult {
    #[serde(rename = "activeCueId")]
    pub active_cue_id: String,
    #[serde(rename = "previousCueId")]
    pub previous_cue_id: Option<String>,
    #[serde(rename = "appliedFadeMs")]
    pub applied_fade_ms: i64,
    pub summary: String,
}

#[derive(Debug)]
pub enum LightingCommandError {
    Rejected(&'static str, String),
    Storage(String),
}

impl fmt::Display for LightingCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(code, message) => write!(f, "{code}: {message}"),
            Self::Storage(message) => write!(f, "{message}"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LightingSceneRecallRequest {
    pub scene_id: String,
    pub fade_duration_seconds: f64,
}

#[derive(Debug, Clone)]
pub struct LightingFixtureCreateRequest {
    pub name: String,
    pub fixture_type: String,
    pub dmx_start_address: i64,
    pub group_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LightingFixtureUpdateRequest {
    pub fixture_id: String,
    pub name: Option<String>,
    pub fixture_type: Option<String>,
    pub dmx_start_address: Option<i64>,
    pub effect: Option<Option<LightingEffect>>,
    pub on: Option<bool>,
    pub intensity: Option<i64>,
    pub cct: Option<i64>,
    pub group_id: Option<Option<String>>,
    pub spatial_x: Option<Option<f64>>,
    pub spatial_y: Option<Option<f64>>,
    pub spatial_rotation: Option<f64>,
    pub rig_z: Option<Option<f64>>,
    pub beam_angle_degrees: Option<Option<f64>>,
}

#[derive(Debug, Clone)]
pub struct LightingGroupPowerRequest {
    pub group_id: String,
    pub on: bool,
}

#[derive(Debug, Clone)]
pub struct LightingAllPowerRequest {
    pub on: bool,
}

#[derive(Debug, Clone)]
pub struct LightingGroupCreateRequest {
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct LightingGroupUpdateRequest {
    pub group_id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct LightingGroupDeleteRequest {
    pub group_id: String,
}

#[derive(Debug, Clone)]
pub struct LightingFixtureDeleteRequest {
    pub fixture_id: String,
}

#[derive(Debug, Clone)]
pub struct LightingSettingsUpdateRequest {
    pub enabled: Option<bool>,
    pub bridge_ip: Option<String>,
    pub universe: Option<i64>,
    pub grand_master: Option<i64>,
    pub selected_scene_id: Option<Option<String>>,
    pub selected_fixture_id: Option<Option<String>>,
    pub camera_marker: Option<Option<LightingSpatialMarker>>,
    pub subject_marker: Option<Option<LightingSpatialMarker>>,
}

#[derive(Debug, Clone)]
pub struct LightingSceneCreateRequest {
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct LightingSceneUpdateRequest {
    pub scene_id: String,
    pub name: Option<String>,
    pub capture_current_state: bool,
}

#[derive(Debug, Clone)]
pub struct LightingSceneDeleteRequest {
    pub scene_id: String,
}

#[derive(Debug, Clone)]
pub struct LightingCueCreateRequest {
    pub label: String,
    pub after_cue_id: Option<String>,
    pub scene_id: Option<String>,
    pub fade_in_ms: Option<i64>,
    pub fade_out_ms: Option<i64>,
    pub follow_seconds: Option<Option<f64>>,
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Clone)]
pub struct LightingCueUpdateRequest {
    pub cue_id: String,
    pub label: Option<String>,
    pub scene_id: Option<Option<String>>,
    pub fade_in_ms: Option<i64>,
    pub fade_out_ms: Option<i64>,
    pub follow_seconds: Option<Option<f64>>,
    pub notes: Option<Option<String>>,
    pub ordinal: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LightingCueDeleteRequest {
    pub cue_id: String,
}

#[derive(Debug, Clone)]
pub struct LightingCueFireRequest {
    pub cue_id: String,
    pub fade_override_ms: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyLightingFixturePayloadWire {
    #[serde(default)]
    lights: Vec<LegacyLightingFixtureWire>,
    #[serde(default, rename = "lightGroups")]
    light_groups: Vec<LegacyLightingGroupWire>,
    #[serde(default, rename = "lightScenes")]
    light_scenes: Vec<LegacyLightingSceneWire>,
    #[serde(default, rename = "lightingSettings")]
    lighting_settings: LegacyLightingSettingsWire,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyLightingFixtureWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "type")]
    fixture_type: String,
    #[serde(default, rename = "dmxStartAddress")]
    dmx_start_address: i64,
    #[serde(default)]
    intensity: i64,
    #[serde(default)]
    cct: i64,
    #[serde(default)]
    on: bool,
    #[serde(default)]
    order: i64,
    #[serde(default, rename = "groupId")]
    group_id: Option<String>,
    #[serde(default)]
    effect: Option<LegacyLightingEffectWire>,
    #[serde(default, rename = "spatialX")]
    spatial_x: Option<f64>,
    #[serde(default, rename = "spatialY")]
    spatial_y: Option<f64>,
    #[serde(default, rename = "spatialRotation")]
    spatial_rotation: f64,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyLightingGroupWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    order: i64,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyLightingSceneWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    order: i64,
    #[serde(default, rename = "lightStates")]
    light_states: Vec<LegacyLightingSceneFixtureStateWire>,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyLightingSceneFixtureStateWire {
    #[serde(default, rename = "lightId")]
    light_id: String,
    #[serde(default)]
    intensity: i64,
    #[serde(default)]
    cct: i64,
    #[serde(default)]
    on: bool,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyLightingEffectWire {
    #[serde(default, rename = "type")]
    effect_type: String,
    #[serde(default)]
    speed: i64,
}

#[derive(Debug, Deserialize, Default)]
struct LegacyLightingSettingsWire {
    #[serde(default, rename = "apolloBridgeIp")]
    apollo_bridge_ip: String,
    #[serde(default, rename = "dmxUniverse")]
    dmx_universe: i64,
    #[serde(default, rename = "dmxEnabled")]
    dmx_enabled: bool,
    #[serde(default, rename = "selectedLightId")]
    selected_light_id: Option<String>,
    #[serde(default, rename = "selectedSceneId")]
    selected_scene_id: Option<String>,
    #[serde(default, rename = "grandMaster")]
    grand_master: i64,
    #[serde(default, rename = "cameraMarker")]
    camera_marker: Option<LightingSpatialMarker>,
    #[serde(default, rename = "subjectMarker")]
    subject_marker: Option<LightingSpatialMarker>,
}

pub fn parse_lighting_scene_recall_request(
    params: &Value,
) -> Result<LightingSceneRecallRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    let fade_duration_seconds = params
        .get("fadeDurationSeconds")
        .map(|value| {
            value
                .as_f64()
                .ok_or_else(|| String::from("fadeDurationSeconds must be a number"))
        })
        .transpose()?
        .unwrap_or(0.0);

    if !(0.0..=10.0).contains(&fade_duration_seconds) {
        return Err(String::from(
            "fadeDurationSeconds must be between 0 and 10 seconds",
        ));
    }

    Ok(LightingSceneRecallRequest {
        scene_id: String::from(scene_id),
        fade_duration_seconds,
    })
}

pub fn parse_lighting_fixture_create_request(
    params: &Value,
) -> Result<LightingFixtureCreateRequest, String> {
    let fixture_type = parse_required_fixture_type(params.get("type"))?;
    let dmx_start_address =
        parse_required_fixture_dmx_start_address(params.get("dmxStartAddress"), &fixture_type)?;
    let group_id = params
        .get("groupId")
        .map(parse_optional_group_id)
        .transpose()?
        .unwrap_or(None);

    Ok(LightingFixtureCreateRequest {
        name: parse_required_fixture_name(params.get("name"))?,
        fixture_type,
        dmx_start_address,
        group_id,
    })
}

pub fn parse_lighting_fixture_update_request(
    params: &Value,
) -> Result<LightingFixtureUpdateRequest, String> {
    let fixture_id = params
        .get("fixtureId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("fixtureId is required"))?;
    let name = params
        .get("name")
        .map(|value| parse_required_fixture_name(Some(value)))
        .transpose()?;
    let fixture_type = params
        .get("type")
        .map(|value| parse_required_fixture_type(Some(value)))
        .transpose()?;
    let dmx_start_address = params
        .get("dmxStartAddress")
        .map(parse_positive_i64_value)
        .transpose()?;
    let effect = params
        .get("effect")
        .map(|value| parse_optional_effect(value, "effect"))
        .transpose()?;

    let on = params
        .get("on")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("on must be a boolean"))
        })
        .transpose()?;

    let intensity = params
        .get("intensity")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 0, 100));

    let cct = params.get("cct").map(parse_i64_value).transpose()?;

    let group_id = params
        .get("groupId")
        .map(parse_optional_group_id)
        .transpose()?;
    let spatial_x = params
        .get("spatialX")
        .map(|value| parse_optional_spatial_coordinate(value, "spatialX"))
        .transpose()?;
    let spatial_y = params
        .get("spatialY")
        .map(|value| parse_optional_spatial_coordinate(value, "spatialY"))
        .transpose()?;
    let spatial_rotation = params
        .get("spatialRotation")
        .map(|value| parse_spatial_rotation_value(value, "spatialRotation"))
        .transpose()?;
    let rig_z = params
        .get("rigZ")
        .map(parse_optional_rig_z)
        .transpose()?;
    let beam_angle_degrees = params
        .get("beamAngleDegrees")
        .map(parse_optional_beam_angle_degrees)
        .transpose()?;

    if on.is_none()
        && name.is_none()
        && fixture_type.is_none()
        && dmx_start_address.is_none()
        && effect.is_none()
        && intensity.is_none()
        && cct.is_none()
        && group_id.is_none()
        && spatial_x.is_none()
        && spatial_y.is_none()
        && spatial_rotation.is_none()
        && rig_z.is_none()
        && beam_angle_degrees.is_none()
    {
        return Err(String::from(
            "lighting.fixture.update requires one or more supported fields",
        ));
    }

    Ok(LightingFixtureUpdateRequest {
        fixture_id: String::from(fixture_id),
        name,
        fixture_type,
        dmx_start_address,
        effect,
        on,
        intensity,
        cct,
        group_id,
        spatial_x,
        spatial_y,
        spatial_rotation,
        rig_z,
        beam_angle_degrees,
    })
}

pub fn parse_lighting_fixture_delete_request(
    params: &Value,
) -> Result<LightingFixtureDeleteRequest, String> {
    let fixture_id = params
        .get("fixtureId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("fixtureId is required"))?;

    Ok(LightingFixtureDeleteRequest {
        fixture_id: String::from(fixture_id),
    })
}

pub fn parse_lighting_group_power_request(
    params: &Value,
) -> Result<LightingGroupPowerRequest, String> {
    let group_id = params
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("groupId is required"))?;

    let on = params
        .get("on")
        .and_then(Value::as_bool)
        .ok_or_else(|| String::from("on must be a boolean"))?;

    Ok(LightingGroupPowerRequest {
        group_id: String::from(group_id),
        on,
    })
}

pub fn parse_lighting_all_power_request(params: &Value) -> Result<LightingAllPowerRequest, String> {
    let on = params
        .get("on")
        .and_then(Value::as_bool)
        .ok_or_else(|| String::from("on must be a boolean"))?;

    Ok(LightingAllPowerRequest { on })
}

pub fn parse_lighting_group_create_request(
    params: &Value,
) -> Result<LightingGroupCreateRequest, String> {
    let name = parse_required_group_name(params.get("name"))?;
    Ok(LightingGroupCreateRequest { name })
}

pub fn parse_lighting_group_update_request(
    params: &Value,
) -> Result<LightingGroupUpdateRequest, String> {
    let group_id = params
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("groupId is required"))?;
    let name = parse_required_group_name(params.get("name"))?;

    Ok(LightingGroupUpdateRequest {
        group_id: String::from(group_id),
        name,
    })
}

pub fn parse_lighting_group_delete_request(
    params: &Value,
) -> Result<LightingGroupDeleteRequest, String> {
    let group_id = params
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("groupId is required"))?;

    Ok(LightingGroupDeleteRequest {
        group_id: String::from(group_id),
    })
}

pub fn parse_lighting_settings_update_request(
    params: &Value,
) -> Result<LightingSettingsUpdateRequest, String> {
    let enabled = params
        .get("enabled")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("enabled must be a boolean"))
        })
        .transpose()?;
    let bridge_ip = params
        .get("bridgeIp")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("bridgeIp must be a string"))
                .map(|text| text.trim().to_string())
        })
        .transpose()?;
    let universe = params
        .get("universe")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 1, 63999));
    let grand_master = params
        .get("grandMaster")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 0, 100));
    let selected_scene_id = params
        .get("selectedSceneId")
        .map(|value| parse_optional_trimmed_string_or_null(value, "selectedSceneId"))
        .transpose()?;
    let selected_fixture_id = params
        .get("selectedFixtureId")
        .map(|value| parse_optional_trimmed_string_or_null(value, "selectedFixtureId"))
        .transpose()?;
    let camera_marker = params
        .get("cameraMarker")
        .map(|value| parse_optional_spatial_marker(value, "cameraMarker"))
        .transpose()?;
    let subject_marker = params
        .get("subjectMarker")
        .map(|value| parse_optional_spatial_marker(value, "subjectMarker"))
        .transpose()?;

    if enabled.is_none()
        && bridge_ip.is_none()
        && universe.is_none()
        && grand_master.is_none()
        && selected_scene_id.is_none()
        && selected_fixture_id.is_none()
        && camera_marker.is_none()
        && subject_marker.is_none()
    {
        return Err(String::from(
            "lighting.settings.update requires one or more supported fields",
        ));
    }

    Ok(LightingSettingsUpdateRequest {
        enabled,
        bridge_ip,
        universe,
        grand_master,
        selected_scene_id,
        selected_fixture_id,
        camera_marker,
        subject_marker,
    })
}

pub fn parse_lighting_scene_create_request(
    params: &Value,
) -> Result<LightingSceneCreateRequest, String> {
    let name = parse_required_scene_name(params.get("name"))?;
    Ok(LightingSceneCreateRequest { name })
}

pub fn parse_lighting_scene_update_request(
    params: &Value,
) -> Result<LightingSceneUpdateRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    let name = params
        .get("name")
        .map(|value| parse_required_scene_name(Some(value)))
        .transpose()?;
    let capture_current_state = params
        .get("captureCurrentState")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("captureCurrentState must be a boolean"))
        })
        .transpose()?
        .unwrap_or(false);

    if name.is_none() && !capture_current_state {
        return Err(String::from(
            "lighting.scene.update requires a name and/or captureCurrentState",
        ));
    }

    Ok(LightingSceneUpdateRequest {
        scene_id: String::from(scene_id),
        name,
        capture_current_state,
    })
}

pub fn parse_lighting_scene_delete_request(
    params: &Value,
) -> Result<LightingSceneDeleteRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    Ok(LightingSceneDeleteRequest {
        scene_id: String::from(scene_id),
    })
}

fn parse_required_cue_label(value: Option<&Value>) -> Result<String, String> {
    let label = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("label is required"))?;
    if label.chars().count() > MAX_CUE_LABEL_LEN {
        return Err(format!(
            "label must be {MAX_CUE_LABEL_LEN} characters or fewer"
        ));
    }
    Ok(label)
}

fn parse_optional_cue_notes(value: &Value) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let notes = value
        .as_str()
        .map(str::trim)
        .ok_or_else(|| String::from("notes must be a string or null"))?;
    if notes.is_empty() {
        return Ok(None);
    }
    if notes.chars().count() > MAX_CUE_NOTES_LEN {
        return Err(format!(
            "notes must be {MAX_CUE_NOTES_LEN} characters or fewer"
        ));
    }
    Ok(Some(String::from(notes)))
}

fn parse_optional_follow_seconds(value: &Value) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let seconds = value
        .as_f64()
        .ok_or_else(|| String::from("followSeconds must be a number or null"))?;
    if !(0.0..=MAX_FOLLOW_SECONDS).contains(&seconds) {
        return Err(format!(
            "followSeconds must be between 0 and {MAX_FOLLOW_SECONDS}"
        ));
    }
    Ok(Some(seconds))
}

fn parse_fade_ms(value: &Value, field: &str) -> Result<i64, String> {
    let ms = parse_i64_value(value)?;
    if !(0..=MAX_FADE_MS).contains(&ms) {
        return Err(format!("{field} must be between 0 and {MAX_FADE_MS} ms"));
    }
    Ok(ms)
}

pub fn parse_lighting_cue_create_request(
    params: &Value,
) -> Result<LightingCueCreateRequest, String> {
    let label = parse_required_cue_label(params.get("label"))?;
    let after_cue_id = params
        .get("afterCueId")
        .map(|value| parse_optional_trimmed_string_or_null(value, "afterCueId"))
        .transpose()?
        .unwrap_or(None);
    let scene_id = params
        .get("sceneId")
        .map(|value| parse_optional_trimmed_string_or_null(value, "sceneId"))
        .transpose()?
        .unwrap_or(None);
    let fade_in_ms = params
        .get("fadeInMs")
        .map(|value| parse_fade_ms(value, "fadeInMs"))
        .transpose()?;
    let fade_out_ms = params
        .get("fadeOutMs")
        .map(|value| parse_fade_ms(value, "fadeOutMs"))
        .transpose()?;
    let follow_seconds = params
        .get("followSeconds")
        .map(parse_optional_follow_seconds)
        .transpose()?;
    let notes = params
        .get("notes")
        .map(parse_optional_cue_notes)
        .transpose()?;

    Ok(LightingCueCreateRequest {
        label,
        after_cue_id,
        scene_id,
        fade_in_ms,
        fade_out_ms,
        follow_seconds,
        notes,
    })
}

pub fn parse_lighting_cue_update_request(
    params: &Value,
) -> Result<LightingCueUpdateRequest, String> {
    let cue_id = params
        .get("cueId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("cueId is required"))?;

    let label = params
        .get("label")
        .map(|value| parse_required_cue_label(Some(value)))
        .transpose()?;
    let scene_id = params
        .get("sceneId")
        .map(|value| parse_optional_trimmed_string_or_null(value, "sceneId"))
        .transpose()?;
    let fade_in_ms = params
        .get("fadeInMs")
        .map(|value| parse_fade_ms(value, "fadeInMs"))
        .transpose()?;
    let fade_out_ms = params
        .get("fadeOutMs")
        .map(|value| parse_fade_ms(value, "fadeOutMs"))
        .transpose()?;
    let follow_seconds = params
        .get("followSeconds")
        .map(parse_optional_follow_seconds)
        .transpose()?;
    let notes = params
        .get("notes")
        .map(parse_optional_cue_notes)
        .transpose()?;
    let ordinal = params
        .get("ordinal")
        .map(parse_positive_i64_value)
        .transpose()?;

    if label.is_none()
        && scene_id.is_none()
        && fade_in_ms.is_none()
        && fade_out_ms.is_none()
        && follow_seconds.is_none()
        && notes.is_none()
        && ordinal.is_none()
    {
        return Err(String::from(
            "lighting.cue.update requires one or more supported fields",
        ));
    }

    Ok(LightingCueUpdateRequest {
        cue_id: String::from(cue_id),
        label,
        scene_id,
        fade_in_ms,
        fade_out_ms,
        follow_seconds,
        notes,
        ordinal,
    })
}

pub fn parse_lighting_cue_delete_request(
    params: &Value,
) -> Result<LightingCueDeleteRequest, String> {
    let cue_id = params
        .get("cueId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("cueId is required"))?;

    Ok(LightingCueDeleteRequest {
        cue_id: String::from(cue_id),
    })
}

pub fn parse_lighting_cue_fire_request(
    params: &Value,
) -> Result<LightingCueFireRequest, String> {
    let cue_id = params
        .get("cueId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("cueId is required"))?;
    let fade_override_ms = params
        .get("fadeOverrideMs")
        .map(|value| {
            if value.is_null() {
                Ok(None)
            } else {
                parse_fade_ms(value, "fadeOverrideMs").map(Some)
            }
        })
        .transpose()?
        .flatten();

    Ok(LightingCueFireRequest {
        cue_id: String::from(cue_id),
        fade_override_ms,
    })
}

pub fn read_lighting_snapshot(settings: &HashMap<String, String>) -> LightingSnapshot {
    let config = resolve_lighting_config(settings);
    let check_status = lighting_check_status(settings);
    let enabled = config.enabled;
    let reachable = enabled && check_status == "passed";
    let inventory = read_lighting_editor_inventory(&config);
    let last_recalled_scene_id =
        read_optional_setting(settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY);
    let last_scene_recall_at = read_optional_setting(settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY);
    let last_action_status = read_optional_setting(settings, LIGHTING_LAST_ACTION_STATUS_KEY)
        .unwrap_or_else(|| String::from("idle"));
    let last_action_code = read_optional_setting(settings, LIGHTING_LAST_ACTION_CODE_KEY);
    let last_action_message = read_optional_setting(settings, LIGHTING_LAST_ACTION_MESSAGE_KEY);
    let grand_master = read_lighting_grand_master(settings);
    let editor_state = load_lighting_editor_state_with_inventory(settings, &config, &inventory);
    let fixtures = editor_state
        .fixtures
        .iter()
        .cloned()
        .map(lighting_fixture_snapshot_from_state)
        .collect::<Vec<_>>();
    let groups = editor_state
        .groups
        .iter()
        .map(|group| {
            let fixture_count = fixtures
                .iter()
                .filter(|fixture| fixture.group_id.as_deref() == Some(group.id.as_str()))
                .count();
            LightingGroupSnapshot {
                id: group.id.clone(),
                name: group.name.clone(),
                fixture_count,
            }
        })
        .collect::<Vec<_>>();
    let selected_fixture_id = read_selected_fixture_id(settings, &fixtures);
    let camera_marker = read_marker_setting(settings, LIGHTING_CAMERA_MARKER_KEY);
    let subject_marker = read_marker_setting(settings, LIGHTING_SUBJECT_MARKER_KEY);
    let scenes = editor_state
        .scenes
        .iter()
        .map(|scene| {
            lighting_scene_snapshot_from_state(
                scene,
                last_recalled_scene_id.as_deref(),
                last_scene_recall_at.as_deref(),
            )
        })
        .collect::<Vec<_>>();
    let selected_scene_id = read_selected_scene_id(settings, &scenes);
    let cue_states = load_lighting_cues(settings);
    let active_cue_id = read_optional_setting(settings, LIGHTING_ACTIVE_CUE_ID_KEY)
        .filter(|id| cue_states.iter().any(|cue| cue.id == *id));
    let cues = cue_states
        .iter()
        .map(|cue| lighting_cue_snapshot_from_state(cue, active_cue_id.as_deref()))
        .collect::<Vec<_>>();
    let status = if !enabled && config.bridge_ip.trim().is_empty() {
        String::from("unconfigured")
    } else if !enabled {
        String::from("disabled")
    } else if check_status == "passed" {
        String::from("ready")
    } else if check_status == "failed" {
        String::from("attention")
    } else {
        String::from("not-verified")
    };

    LightingSnapshot {
        summary: lighting_summary(
            &status,
            &config.bridge_ip,
            config.universe,
            fixtures.len(),
            groups.len(),
            scenes.len(),
            last_recalled_scene_id.as_deref(),
            last_scene_recall_at.as_deref(),
            &last_action_status,
            last_action_code.as_deref(),
            last_action_message.as_deref(),
        ),
        status,
        adapter_mode: inventory.adapter_mode,
        bridge_ip: config.bridge_ip,
        universe: config.universe,
        enabled,
        grand_master,
        connected: reachable,
        reachable,
        last_recalled_scene_id,
        last_scene_recall_at,
        last_action_status,
        last_action_code,
        last_action_message,
        selected_scene_id,
        selected_fixture_id,
        camera_marker,
        subject_marker,
        fixtures,
        groups,
        scenes,
        cues,
        active_cue_id,
    }
}

pub fn load_lighting_editor_state(settings: &HashMap<String, String>) -> LightingEditorState {
    let config = resolve_lighting_config(settings);
    let inventory = read_lighting_editor_inventory(&config);
    load_lighting_editor_state_with_inventory(settings, &config, &inventory)
}

pub fn read_lighting_dmx_monitor_snapshot(
    settings: &HashMap<String, String>,
) -> LightingDmxMonitorSnapshot {
    let snapshot = read_lighting_snapshot(settings);
    let channel_data = compute_dmx_channel_data(&snapshot);
    let mut channels = Vec::new();
    for fixture in &snapshot.fixtures {
        let labels = fixture_channel_labels(fixture.fixture_type.as_str());
        for offset in 0..fixture_channel_count(fixture.fixture_type.as_str()) {
            let channel = fixture.dmx_start_address + offset;
            channels.push(LightingDmxChannelSnapshot {
                channel,
                value: *channel_data.get(&channel).unwrap_or(&0),
                light_name: fixture.name.clone(),
                label: labels
                    .get(offset as usize)
                    .cloned()
                    .unwrap_or_else(|| format!("Ch{}", offset + 1)),
            });
        }
    }
    channels.sort_by(|left, right| left.channel.cmp(&right.channel));

    LightingDmxMonitorSnapshot { channels }
}

pub fn save_lighting_editor_state(
    db_path: &Path,
    state: &LightingEditorState,
) -> Result<(), LightingCommandError> {
    let updates = lighting_editor_state_updates(state)?;
    persist_lighting_state(db_path, &updates)
}

pub fn import_legacy_lighting_fixture(
    db_path: &Path,
    payload_json: &str,
) -> Result<(), LightingCommandError> {
    let wire = serde_json::from_str::<LegacyLightingFixturePayloadWire>(payload_json)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))?;
    let config = LightingBackendConfig {
        enabled: !wire.lighting_settings.apollo_bridge_ip.trim().is_empty(),
        bridge_ip: wire.lighting_settings.apollo_bridge_ip.clone(),
        universe: clamp_i64(wire.lighting_settings.dmx_universe, 1, 63999),
    };
    let inventory = read_default_lighting_inventory(&config);

    let mut groups = wire
        .light_groups
        .into_iter()
        .filter(|group| !group.id.trim().is_empty())
        .collect::<Vec<_>>();
    groups.sort_by_key(|group| group.order);

    let mut fixtures = wire
        .lights
        .into_iter()
        .filter(|fixture| !fixture.id.trim().is_empty())
        .collect::<Vec<_>>();
    fixtures.sort_by_key(|fixture| fixture.order);

    let fixture_states = fixtures
        .iter()
        .map(|fixture| {
            let fixture_type = normalized_fixture_type(
                Some(fixture.fixture_type.as_str()),
                None,
                fixture.id.as_str(),
            );
            LightingEditorFixtureState {
                id: fixture.id.clone(),
                name: if fixture.name.trim().is_empty() {
                    fixture.id.clone()
                } else {
                    fixture.name.clone()
                },
                fixture_type: fixture_type.clone(),
                dmx_start_address: normalize_dmx_start_address(
                    fixture.dmx_start_address,
                    fixture_type.as_str(),
                ),
                kind: lighting_kind_for_type(fixture_type.as_str()),
                group_id: fixture.group_id.clone(),
                spatial_x: normalize_optional_coordinate(fixture.spatial_x),
                spatial_y: normalize_optional_coordinate(fixture.spatial_y),
                spatial_rotation: normalize_rotation(fixture.spatial_rotation),
                rig_z: None,
                beam_angle_degrees: None,
                intensity: clamp_i64(fixture.intensity, 0, 100),
                cct: clamp_cct_for_type(
                    fixture.cct,
                    fixture_type.as_str(),
                    default_fixture_cct_for_type(fixture_type.as_str()),
                ),
                on: fixture.on,
                effect: fixture
                    .effect
                    .as_ref()
                    .and_then(|effect| validate_effect_type(effect.effect_type.as_str()))
                    .map(|effect_type| LightingEffect {
                        effect_type,
                        speed: clamp_i64(fixture.effect.as_ref().map(|effect| effect.speed).unwrap_or(1), 1, 10),
                    }),
            }
        })
        .collect::<Vec<_>>();

    let removed_fixture_ids = inventory
        .fixtures
        .iter()
        .filter(|inventory_fixture| {
            !fixture_states
                .iter()
                .any(|fixture| fixture.id == inventory_fixture.id)
        })
        .map(|fixture| fixture.id.clone())
        .collect::<Vec<_>>();

    let group_states = groups
        .iter()
        .map(|group| LightingEditorGroupState {
            id: group.id.clone(),
            name: if group.name.trim().is_empty() {
                group.id.clone()
            } else {
                group.name.clone()
            },
        })
        .collect::<Vec<_>>();

    let mut scenes = wire
        .light_scenes
        .into_iter()
        .filter(|scene| !scene.id.trim().is_empty())
        .collect::<Vec<_>>();
    scenes.sort_by_key(|scene| scene.order);

    let scene_states = scenes
        .iter()
        .map(|scene| LightingEditorSceneState {
            id: scene.id.clone(),
            name: if scene.name.trim().is_empty() {
                scene.id.clone()
            } else {
                scene.name.clone()
            },
            fixture_states: fixture_states
                .iter()
                .map(|fixture| {
                    let imported_state = scene
                        .light_states
                        .iter()
                        .find(|state| state.light_id == fixture.id);
                    LightingEditorSceneFixtureState {
                        fixture_id: fixture.id.clone(),
                        intensity: imported_state
                            .map(|state| clamp_i64(state.intensity, 0, 100))
                            .unwrap_or(fixture.intensity),
                        cct: imported_state
                            .map(|state| clamp_i64(state.cct, MIN_FIXTURE_CCT, MAX_FIXTURE_CCT))
                            .unwrap_or(fixture.cct),
                        on: imported_state.map(|state| state.on).unwrap_or(fixture.on),
                    }
                })
                .collect(),
        })
        .collect::<Vec<_>>();

    let editor_state = LightingEditorState {
        groups: group_states,
        removed_fixture_ids,
        fixtures: fixture_states.clone(),
        scenes: scene_states,
    };

    let selected_fixture_id = wire
        .lighting_settings
        .selected_light_id
        .filter(|fixture_id| fixture_states.iter().any(|fixture| fixture.id == *fixture_id));
    let selected_scene_id = wire
        .lighting_settings
        .selected_scene_id
        .filter(|scene_id| editor_state.scenes.iter().any(|scene| scene.id == *scene_id));

    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_ENABLED_KEY),
            wire.lighting_settings.dmx_enabled.to_string(),
        ),
        (
            String::from(LIGHTING_BRIDGE_IP_KEY),
            wire.lighting_settings.apollo_bridge_ip,
        ),
        (
            String::from(LIGHTING_UNIVERSE_KEY),
            clamp_i64(wire.lighting_settings.dmx_universe, 1, 63999).to_string(),
        ),
        (
            String::from(LIGHTING_GRAND_MASTER_KEY),
            clamp_i64(wire.lighting_settings.grand_master, 0, 100).to_string(),
        ),
        (
            String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
            selected_fixture_id.unwrap_or_default(),
        ),
        (
            String::from(LIGHTING_SELECTED_SCENE_ID_KEY),
            selected_scene_id.unwrap_or_default(),
        ),
        (
            String::from(LIGHTING_CAMERA_MARKER_KEY),
            serialize_optional_marker(wire.lighting_settings.camera_marker.as_ref())?,
        ),
        (
            String::from(LIGHTING_SUBJECT_MARKER_KEY),
            serialize_optional_marker(wire.lighting_settings.subject_marker.as_ref())?,
        ),
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("idle"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY), String::new()),
    ]);

    persist_lighting_state(db_path, &updates)
}

pub fn recall_lighting_scene(
    db_path: &Path,
    request: &LightingSceneRecallRequest,
) -> Result<LightingSceneRecallResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let snapshot = read_lighting_snapshot(&app_settings);
    ensure_lighting_action_allowed(db_path, &snapshot)?;
    let config = resolve_lighting_config(&app_settings);
    let inventory = read_default_lighting_inventory(&config);
    let mut editor_state =
        load_lighting_editor_state_with_inventory(&app_settings, &config, &inventory);
    let scene = editor_state
        .scenes
        .iter()
        .find(|scene| scene.id == request.scene_id)
        .cloned()
        .ok_or_else(|| {
            let message = format!(
                "Lighting scene '{}' is not exposed by the native editor state.",
                request.scene_id
            );
            let _ = record_lighting_action_failure(db_path, "LIGHTING_SCENE_NOT_FOUND", &message);
            LightingCommandError::Rejected("LIGHTING_SCENE_NOT_FOUND", message)
        })?;
    let recalled_at = current_timestamp(db_path)?;
    for fixture in &mut editor_state.fixtures {
        if let Some(scene_fixture_state) = scene
            .fixture_states
            .iter()
            .find(|fixture_state| fixture_state.fixture_id == fixture.id)
        {
            fixture.on = scene_fixture_state.on;
            fixture.intensity = scene_fixture_state.intensity;
            fixture.cct = scene_fixture_state.cct;
        }
    }

    let summary = format!(
        "{} lighting scene '{}' was recalled via {} on {} universe {}.",
        lighting_adapter_label(&snapshot.adapter_mode),
        scene.name,
        recall_mode_label(request.fade_duration_seconds),
        config.bridge_ip,
        config.universe
    );

    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_RECALLED_SCENE_ID_KEY),
            request.scene_id.clone(),
        ),
        (
            String::from(LIGHTING_LAST_SCENE_RECALL_AT_KEY),
            recalled_at.clone(),
        ),
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingSceneRecallResult {
        recalled: true,
        scene_id: request.scene_id.clone(),
        scene_name: scene.name,
        recalled_at,
        fade_duration_seconds: request.fade_duration_seconds,
        summary,
    })
}

pub fn create_lighting_fixture(
    db_path: &Path,
    request: &LightingFixtureCreateRequest,
) -> Result<LightingFixtureCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);

    validate_group_exists(editor_state.groups.as_slice(), request.group_id.as_deref())?;
    validate_dmx_start_address(
        editor_state.fixtures.as_slice(),
        &request.fixture_type,
        request.dmx_start_address,
        None,
    )?;

    let fixture = LightingEditorFixtureState {
        id: next_custom_fixture_id(editor_state.fixtures.as_slice()),
        name: request.name.clone(),
        fixture_type: request.fixture_type.clone(),
        dmx_start_address: request.dmx_start_address,
        kind: lighting_kind_for_type(&request.fixture_type),
        group_id: request.group_id.clone(),
        spatial_x: None,
        spatial_y: None,
        spatial_rotation: 0.0,
        rig_z: None,
        beam_angle_degrees: None,
        intensity: DEFAULT_FIXTURE_INTENSITY,
        cct: default_fixture_cct_for_type(&request.fixture_type),
        on: false,
        effect: None,
    };
    append_fixture_to_scenes(&mut editor_state.scenes, &fixture);
    editor_state.fixtures.push(fixture.clone());
    editor_state
        .removed_fixture_ids
        .retain(|fixture_id| fixture_id != &fixture.id);

    let summary = format!(
        "Lighting fixture '{}' was created as {} on DMX {}.",
        fixture.name, fixture.fixture_type, fixture.dmx_start_address
    );
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingFixtureCreateResult {
        fixture: lighting_fixture_snapshot_from_state(fixture),
        summary,
    })
}

pub fn update_lighting_fixture(
    db_path: &Path,
    request: &LightingFixtureUpdateRequest,
) -> Result<LightingFixtureUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    validate_group_exists(
        editor_state.groups.as_slice(),
        request
            .group_id
            .as_ref()
            .and_then(|group_id| group_id.as_deref()),
    )?;

    let existing_fixture = editor_state
        .fixtures
        .iter()
        .find(|entry| entry.id == request.fixture_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    request.fixture_id
                ),
            )
        })?;
    let next_fixture_type = request
        .fixture_type
        .clone()
        .unwrap_or_else(|| existing_fixture.fixture_type.clone());
    let next_dmx_start_address = request
        .dmx_start_address
        .unwrap_or(existing_fixture.dmx_start_address);
    validate_dmx_start_address(
        editor_state.fixtures.as_slice(),
        &next_fixture_type,
        next_dmx_start_address,
        Some(request.fixture_id.as_str()),
    )?;

    let updated_fixture = {
        let fixture = editor_state
            .fixtures
            .iter_mut()
            .find(|entry| entry.id == request.fixture_id)
            .expect("fixture presence already validated");

        if let Some(name) = &request.name {
            fixture.name = name.clone();
        }
        if let Some(fixture_type) = &request.fixture_type {
            fixture.fixture_type = fixture_type.clone();
            fixture.kind = lighting_kind_for_type(fixture_type);
            let default_cct = default_fixture_cct_for_type(fixture_type);
            fixture.cct = clamp_cct_for_type(fixture.cct, fixture_type, default_cct);
        }
        if let Some(dmx_start_address) = request.dmx_start_address {
            fixture.dmx_start_address = dmx_start_address;
        }
        if let Some(effect) = &request.effect {
            fixture.effect = effect.clone().map(normalize_lighting_effect);
        }

        if let Some(on) = request.on {
            fixture.on = on;
        }
        if let Some(intensity) = request.intensity {
            fixture.intensity = clamp_i64(intensity, 0, 100);
        }
        if let Some(cct) = request.cct {
            let default_cct = default_fixture_cct_for_type(&fixture.fixture_type);
            fixture.cct = clamp_cct_for_type(cct, &fixture.fixture_type, default_cct);
        }
        if let Some(group_id) = &request.group_id {
            fixture.group_id = group_id.clone();
        }
        if let Some(spatial_x) = request.spatial_x {
            fixture.spatial_x = spatial_x;
        }
        if let Some(spatial_y) = request.spatial_y {
            fixture.spatial_y = spatial_y;
        }
        if let Some(spatial_rotation) = request.spatial_rotation {
            fixture.spatial_rotation = normalize_rotation(spatial_rotation);
        }
        if let Some(rig_z) = request.rig_z {
            fixture.rig_z = rig_z;
        }
        if let Some(beam_angle_degrees) = request.beam_angle_degrees {
            fixture.beam_angle_degrees = beam_angle_degrees;
        }

        fixture.clone()
    };
    let summary = lighting_fixture_update_summary(&updated_fixture);
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingFixtureUpdateResult {
        fixture: lighting_fixture_snapshot_from_state(updated_fixture),
        summary,
    })
}

pub fn set_lighting_all_power(
    db_path: &Path,
    request: &LightingAllPowerRequest,
) -> Result<LightingAllPowerResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let affected_fixtures = editor_state.fixtures.len();

    if affected_fixtures == 0 {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_FIXTURES_EMPTY",
            String::from("No lighting fixtures are exposed by the native editor state."),
        ));
    }

    for fixture in &mut editor_state.fixtures {
        fixture.on = request.on;
    }

    let summary = format!(
        "All native lighting fixtures set {} across {} fixtures.",
        if request.on { "on" } else { "off" },
        affected_fixtures
    );
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingAllPowerResult {
        affected_fixtures,
        summary,
    })
}

pub fn delete_lighting_fixture(
    db_path: &Path,
    request: &LightingFixtureDeleteRequest,
) -> Result<LightingFixtureDeleteResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let config = resolve_lighting_config(&app_settings);
    let inventory = read_lighting_editor_inventory(&config);
    let mut editor_state =
        load_lighting_editor_state_with_inventory(&app_settings, &config, &inventory);

    let deleted_fixture = editor_state
        .fixtures
        .iter()
        .find(|fixture| fixture.id == request.fixture_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    request.fixture_id
                ),
            )
        })?;

    editor_state
        .fixtures
        .retain(|fixture| fixture.id != request.fixture_id);
    remove_fixture_from_scenes(&mut editor_state.scenes, request.fixture_id.as_str());
    if inventory
        .fixtures
        .iter()
        .any(|fixture| fixture.id == request.fixture_id)
        && !editor_state
            .removed_fixture_ids
            .iter()
            .any(|fixture_id| fixture_id == &request.fixture_id)
    {
        editor_state
            .removed_fixture_ids
            .push(request.fixture_id.clone());
    }

    let mut updates = lighting_editor_state_updates(&editor_state)?;
    if read_optional_setting(&app_settings, LIGHTING_SELECTED_FIXTURE_ID_KEY).as_deref()
        == Some(request.fixture_id.as_str())
    {
        updates.push((
            String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
            String::new(),
        ));
    }
    let summary = format!("Lighting fixture '{}' was deleted.", deleted_fixture.name);
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingFixtureDeleteResult {
        deleted: true,
        fixture_id: request.fixture_id.clone(),
        summary,
    })
}

pub fn update_lighting_settings(
    db_path: &Path,
    request: &LightingSettingsUpdateRequest,
) -> Result<LightingSettingsUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    let current_config = resolve_lighting_config(&app_settings);

    if let Some(Some(fixture_id)) = &request.selected_fixture_id {
        if !editor_state
            .fixtures
            .iter()
            .any(|fixture| fixture.id == *fixture_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    fixture_id
                ),
            ));
        }
    }
    if let Some(Some(scene_id)) = &request.selected_scene_id {
        if !editor_state
            .scenes
            .iter()
            .any(|scene| scene.id == *scene_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!(
                    "Lighting scene '{}' is not exposed by the native editor state.",
                    scene_id
                ),
            ));
        }
    }

    let enabled = request.enabled.unwrap_or(current_config.enabled);
    let bridge_ip = request
        .bridge_ip
        .clone()
        .unwrap_or_else(|| current_config.bridge_ip.clone());
    let universe = request.universe.unwrap_or(current_config.universe);
    let grand_master = request
        .grand_master
        .unwrap_or_else(|| read_lighting_grand_master(&app_settings));

    if enabled && bridge_ip.trim().is_empty() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_BRIDGE_REQUIRED",
            String::from("bridgeIp is required while native lighting output is enabled."),
        ));
    }
    if !bridge_ip.trim().is_empty() && !is_valid_ipv4(&bridge_ip) {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_BRIDGE_INVALID",
            String::from("bridgeIp must be a valid IPv4 address."),
        ));
    }

    let selected_fixture_id = request.selected_fixture_id.clone().unwrap_or_else(|| {
        read_selected_fixture_id(&app_settings, &snapshot_fixtures(&editor_state.fixtures))
    });
    let selected_scene_id = request.selected_scene_id.clone().unwrap_or_else(|| {
        read_optional_setting(&app_settings, LIGHTING_SELECTED_SCENE_ID_KEY).filter(|scene_id| {
            editor_state
                .scenes
                .iter()
                .any(|scene| scene.id == *scene_id)
        })
    });
    let camera_marker = request
        .camera_marker
        .clone()
        .unwrap_or_else(|| read_marker_setting(&app_settings, LIGHTING_CAMERA_MARKER_KEY));
    let subject_marker = request
        .subject_marker
        .clone()
        .unwrap_or_else(|| read_marker_setting(&app_settings, LIGHTING_SUBJECT_MARKER_KEY));
    let transport_changed =
        request.enabled.is_some() || request.bridge_ip.is_some() || request.universe.is_some();
    let mut updates = Vec::new();
    let mut summary_parts = Vec::new();

    if let Some(enabled) = request.enabled {
        updates.push((
            String::from(LIGHTING_ENABLED_KEY),
            if enabled {
                String::from("true")
            } else {
                String::from("false")
            },
        ));
        summary_parts.push(if enabled {
            String::from("lighting output enabled")
        } else {
            String::from("lighting output disabled")
        });
    }
    if let Some(bridge_ip) = &request.bridge_ip {
        updates.push((String::from(LIGHTING_BRIDGE_IP_KEY), bridge_ip.clone()));
        summary_parts.push(if bridge_ip.is_empty() {
            String::from("bridge cleared")
        } else {
            format!("bridge -> {}", bridge_ip)
        });
    }
    if let Some(universe) = request.universe {
        updates.push((String::from(LIGHTING_UNIVERSE_KEY), universe.to_string()));
        summary_parts.push(format!("universe -> {}", universe));
    }
    if let Some(grand_master) = request.grand_master {
        updates.push((
            String::from(LIGHTING_GRAND_MASTER_KEY),
            grand_master.to_string(),
        ));
        summary_parts.push(format!("grand master -> {}%", grand_master));
    }
    if let Some(selected_scene_id) = &request.selected_scene_id {
        let value = selected_scene_id.clone().unwrap_or_default();
        updates.push((String::from(LIGHTING_SELECTED_SCENE_ID_KEY), value.clone()));
        summary_parts.push(if value.is_empty() {
            String::from("selected scene cleared")
        } else {
            format!("selected scene -> {}", value)
        });
    }

    if let Some(selected_fixture_id) = &request.selected_fixture_id {
        updates.push((
            String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
            selected_fixture_id.clone().unwrap_or_default(),
        ));
        summary_parts.push(
            selected_fixture_id
                .as_ref()
                .and_then(|fixture_id| {
                    editor_state
                        .fixtures
                        .iter()
                        .find(|fixture| fixture.id == *fixture_id)
                        .map(|fixture| format!("selected fixture -> {}", fixture.name))
                })
                .unwrap_or_else(|| String::from("selected fixture cleared")),
        );
    }
    if let Some(camera_marker) = &request.camera_marker {
        updates.push((
            String::from(LIGHTING_CAMERA_MARKER_KEY),
            serialize_optional_marker(camera_marker.as_ref())?,
        ));
        summary_parts.push(if camera_marker.is_some() {
            String::from("camera marker set")
        } else {
            String::from("camera marker hidden")
        });
    }
    if let Some(subject_marker) = &request.subject_marker {
        updates.push((
            String::from(LIGHTING_SUBJECT_MARKER_KEY),
            serialize_optional_marker(subject_marker.as_ref())?,
        ));
        summary_parts.push(if subject_marker.is_some() {
            String::from("subject marker set")
        } else {
            String::from("subject marker hidden")
        });
    }
    if transport_changed {
        updates.push((
            format!("app.commissioning.check.{LIGHTING_CHECK_ID}.status"),
            String::from("idle"),
        ));
        updates.push((
            format!("app.commissioning.check.{LIGHTING_CHECK_ID}.message"),
            String::from(
                "Lighting transport settings changed in the native lighting workspace. Rerun the lighting probe.",
            ),
        ));
        updates.push((
            format!("app.commissioning.check.{LIGHTING_CHECK_ID}.checked_at"),
            String::new(),
        ));
        summary_parts.push(String::from("lighting probe reset"));
    }
    let summary = if summary_parts.is_empty() {
        String::from("Native lighting settings updated.")
    } else {
        format!(
            "Native lighting settings updated: {}.",
            summary_parts.join(", ")
        )
    };
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingSettingsUpdateResult {
        enabled,
        bridge_ip,
        universe,
        grand_master,
        selected_scene_id,
        selected_fixture_id,
        camera_marker,
        subject_marker,
        summary,
    })
}

pub fn create_lighting_group(
    db_path: &Path,
    request: &LightingGroupCreateRequest,
) -> Result<LightingGroupCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let group = LightingEditorGroupState {
        id: next_custom_group_id(&editor_state.groups),
        name: request.name.clone(),
    };
    editor_state.groups.push(group.clone());

    let summary = format!("Lighting group '{}' was created.", group.name);
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingGroupCreateResult {
        group: lighting_group_snapshot_from_state(&group, &editor_state.fixtures),
        summary,
    })
}

pub fn update_lighting_group(
    db_path: &Path,
    request: &LightingGroupUpdateRequest,
) -> Result<LightingGroupUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let updated_group = {
        let group = editor_state
            .groups
            .iter_mut()
            .find(|group| group.id == request.group_id)
            .ok_or_else(|| {
                LightingCommandError::Rejected(
                    "LIGHTING_GROUP_NOT_FOUND",
                    format!(
                        "Lighting group '{}' is not exposed by the native editor state.",
                        request.group_id
                    ),
                )
            })?;
        group.name = request.name.clone();
        group.clone()
    };

    let summary = format!("Lighting group '{}' was renamed.", updated_group.name);
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingGroupUpdateResult {
        group: lighting_group_snapshot_from_state(&updated_group, &editor_state.fixtures),
        summary,
    })
}

pub fn delete_lighting_group(
    db_path: &Path,
    request: &LightingGroupDeleteRequest,
) -> Result<LightingGroupDeleteResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let deleted_group = editor_state
        .groups
        .iter()
        .find(|group| group.id == request.group_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_GROUP_NOT_FOUND",
                format!(
                    "Lighting group '{}' is not exposed by the native editor state.",
                    request.group_id
                ),
            )
        })?;
    editor_state
        .groups
        .retain(|group| group.id != request.group_id);
    let mut affected_fixtures = 0usize;
    for fixture in &mut editor_state.fixtures {
        if fixture.group_id.as_deref() == Some(request.group_id.as_str()) {
            fixture.group_id = None;
            affected_fixtures += 1;
        }
    }

    let summary = if affected_fixtures == 0 {
        format!("Lighting group '{}' was deleted.", deleted_group.name)
    } else {
        format!(
            "Lighting group '{}' was deleted and {} fixtures were moved to ungrouped.",
            deleted_group.name, affected_fixtures
        )
    };
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingGroupDeleteResult {
        deleted: true,
        group_id: request.group_id.clone(),
        summary,
    })
}

pub fn set_lighting_group_power(
    db_path: &Path,
    request: &LightingGroupPowerRequest,
) -> Result<LightingGroupPowerResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let snapshot = read_lighting_snapshot(&app_settings);
    let group = snapshot
        .groups
        .iter()
        .find(|entry| entry.id == request.group_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_GROUP_NOT_FOUND",
                format!(
                    "Lighting group '{}' is not exposed by the native editor state.",
                    request.group_id
                ),
            )
        })?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let mut affected_fixtures = 0usize;
    for fixture in &mut editor_state.fixtures {
        if fixture.group_id.as_deref() == Some(group.id.as_str()) {
            fixture.on = request.on;
            affected_fixtures += 1;
        }
    }

    if affected_fixtures == 0 {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_GROUP_EMPTY",
            format!(
                "Lighting group '{}' does not currently contain fixtures.",
                group.name
            ),
        ));
    }

    let mut updates = lighting_editor_state_updates(&editor_state)?;
    let summary = format!(
        "Lighting group '{}' set {} across {} fixtures.",
        group.name,
        if request.on { "on" } else { "off" },
        affected_fixtures
    );
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingGroupPowerResult {
        group_id: group.id,
        group_name: group.name,
        affected_fixtures,
        summary,
    })
}

pub fn create_lighting_scene(
    db_path: &Path,
    request: &LightingSceneCreateRequest,
) -> Result<LightingSceneCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    if editor_state.fixtures.is_empty() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_NO_FIXTURES",
            String::from("No lighting fixtures are available for scene creation."),
        ));
    }

    let scene = LightingEditorSceneState {
        id: next_custom_scene_id(&editor_state.scenes),
        name: request.name.clone(),
        fixture_states: capture_scene_fixture_states(&editor_state.fixtures),
    };
    editor_state.scenes.push(scene.clone());

    let summary = format!(
        "Lighting scene '{}' was saved from the current fixture state.",
        scene.name
    );
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingSceneCreateResult {
        scene: lighting_scene_snapshot_from_state(
            &scene,
            read_optional_setting(&app_settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY).as_deref(),
            read_optional_setting(&app_settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY).as_deref(),
        ),
        summary,
    })
}

pub fn update_lighting_scene(
    db_path: &Path,
    request: &LightingSceneUpdateRequest,
) -> Result<LightingSceneUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let captured_fixture_states = request
        .capture_current_state
        .then(|| capture_scene_fixture_states(&editor_state.fixtures));
    let updated_scene = {
        let scene = editor_state
            .scenes
            .iter_mut()
            .find(|scene| scene.id == request.scene_id)
            .ok_or_else(|| {
                LightingCommandError::Rejected(
                    "LIGHTING_SCENE_NOT_FOUND",
                    format!(
                        "Lighting scene '{}' is not exposed by the native editor state.",
                        request.scene_id
                    ),
                )
            })?;

        if let Some(name) = &request.name {
            scene.name = name.clone();
        }
        if let Some(fixture_states) = captured_fixture_states {
            scene.fixture_states = fixture_states;
        }

        scene.clone()
    };
    let summary = lighting_scene_update_summary(&updated_scene, request);
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingSceneUpdateResult {
        scene: lighting_scene_snapshot_from_state(
            &updated_scene,
            read_optional_setting(&app_settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY).as_deref(),
            read_optional_setting(&app_settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY).as_deref(),
        ),
        summary,
    })
}

pub fn delete_lighting_scene(
    db_path: &Path,
    request: &LightingSceneDeleteRequest,
) -> Result<LightingSceneDeleteResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let deleted_scene = editor_state
        .scenes
        .iter()
        .find(|scene| scene.id == request.scene_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!(
                    "Lighting scene '{}' is not exposed by the native editor state.",
                    request.scene_id
                ),
            )
        })?;
    editor_state
        .scenes
        .retain(|scene| scene.id != request.scene_id);

    let last_recalled_scene_id =
        read_optional_setting(&app_settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY);
    let clear_last_recall = last_recalled_scene_id.as_deref() == Some(request.scene_id.as_str());
    let selected_scene_id = read_optional_setting(&app_settings, LIGHTING_SELECTED_SCENE_ID_KEY);
    let clear_selected_scene = selected_scene_id.as_deref() == Some(request.scene_id.as_str());

    let summary = format!(
        "Lighting scene '{}' was deleted from the native editor state.",
        deleted_scene.name
    );
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    if clear_last_recall {
        updates.extend_from_slice(&[
            (
                String::from(LIGHTING_LAST_RECALLED_SCENE_ID_KEY),
                String::new(),
            ),
            (
                String::from(LIGHTING_LAST_SCENE_RECALL_AT_KEY),
                String::new(),
            ),
        ]);
    }
    if clear_selected_scene {
        updates.push((String::from(LIGHTING_SELECTED_SCENE_ID_KEY), String::new()));
    }
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingSceneDeleteResult {
        deleted: true,
        scene_id: request.scene_id.clone(),
        summary,
    })
}

fn load_lighting_cues(settings: &HashMap<String, String>) -> Vec<LightingEditorCueState> {
    let mut cues = settings
        .get(LIGHTING_CUES_KEY)
        .and_then(|value| serde_json::from_str::<Vec<LightingEditorCueState>>(value).ok())
        .unwrap_or_default();
    cues.sort_by_key(|cue| cue.ordinal);
    resequence_cues(&mut cues);
    cues
}

fn resequence_cues(cues: &mut [LightingEditorCueState]) {
    for (index, cue) in cues.iter_mut().enumerate() {
        cue.ordinal = (index as i64) + 1;
    }
}

fn serialize_lighting_cues(
    cues: &[LightingEditorCueState],
) -> Result<String, LightingCommandError> {
    serde_json::to_string(cues).map_err(|error| LightingCommandError::Storage(error.to_string()))
}

fn lighting_cue_snapshot_from_state(
    cue: &LightingEditorCueState,
    active_cue_id: Option<&str>,
) -> LightingCueSnapshot {
    let state = match active_cue_id {
        Some(id) if id == cue.id => String::from("active"),
        _ => String::from("pending"),
    };
    LightingCueSnapshot {
        id: cue.id.clone(),
        ordinal: cue.ordinal,
        label: cue.label.clone(),
        scene_id: cue.scene_id.clone(),
        fade_in_ms: cue.fade_in_ms,
        fade_out_ms: cue.fade_out_ms,
        follow_seconds: cue.follow_seconds,
        notes: cue.notes.clone(),
        state,
    }
}

fn next_custom_cue_id(cues: &[LightingEditorCueState]) -> String {
    let next_index = cues
        .iter()
        .filter_map(|cue| {
            cue.id
                .strip_prefix(LIGHTING_CUSTOM_CUE_ID_PREFIX)
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;

    format!("{LIGHTING_CUSTOM_CUE_ID_PREFIX}{next_index}")
}

pub fn create_lighting_cue(
    db_path: &Path,
    request: &LightingCueCreateRequest,
) -> Result<LightingCueCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    if let Some(scene_id) = &request.scene_id {
        if !editor_state.scenes.iter().any(|scene| &scene.id == scene_id) {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!(
                    "Lighting cue references scene '{scene_id}' but no matching scene exists."
                ),
            ));
        }
    }

    let mut cues = load_lighting_cues(&app_settings);
    let new_id = next_custom_cue_id(&cues);
    let follow_seconds = request.follow_seconds.unwrap_or(None);
    let notes = request.notes.clone().unwrap_or(None);

    let insert_index = match &request.after_cue_id {
        Some(after_id) => cues
            .iter()
            .position(|cue| &cue.id == after_id)
            .map(|idx| idx + 1)
            .ok_or_else(|| {
                LightingCommandError::Rejected(
                    "LIGHTING_CUE_NOT_FOUND",
                    format!("Lighting cue '{after_id}' is not present in the cue stack."),
                )
            })?,
        None => cues.len(),
    };

    let new_cue = LightingEditorCueState {
        id: new_id.clone(),
        ordinal: (insert_index as i64) + 1,
        label: request.label.clone(),
        scene_id: request.scene_id.clone(),
        fade_in_ms: request.fade_in_ms.unwrap_or(0),
        fade_out_ms: request.fade_out_ms.unwrap_or(0),
        follow_seconds,
        notes,
    };
    cues.insert(insert_index, new_cue.clone());
    resequence_cues(&mut cues);
    let stored = cues.iter().find(|cue| cue.id == new_id).cloned().unwrap();

    let summary = format!("Lighting cue '{}' was added.", stored.label);
    let updates = vec![
        (
            String::from(LIGHTING_CUES_KEY),
            serialize_lighting_cues(&cues)?,
        ),
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ];
    persist_lighting_state(db_path, &updates)?;

    let active_cue_id = read_optional_setting(&app_settings, LIGHTING_ACTIVE_CUE_ID_KEY);
    Ok(LightingCueCreateResult {
        cue: lighting_cue_snapshot_from_state(&stored, active_cue_id.as_deref()),
        summary,
    })
}

pub fn update_lighting_cue(
    db_path: &Path,
    request: &LightingCueUpdateRequest,
) -> Result<LightingCueUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    if let Some(Some(scene_id)) = &request.scene_id {
        if !editor_state.scenes.iter().any(|scene| &scene.id == scene_id) {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!(
                    "Lighting cue references scene '{scene_id}' but no matching scene exists."
                ),
            ));
        }
    }

    let mut cues = load_lighting_cues(&app_settings);
    let current_index = cues
        .iter()
        .position(|cue| cue.id == request.cue_id)
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_CUE_NOT_FOUND",
                format!("Lighting cue '{}' is not present in the cue stack.", request.cue_id),
            )
        })?;

    {
        let cue = &mut cues[current_index];
        if let Some(label) = &request.label {
            cue.label = label.clone();
        }
        if let Some(scene_id) = &request.scene_id {
            cue.scene_id = scene_id.clone();
        }
        if let Some(fade_in_ms) = request.fade_in_ms {
            cue.fade_in_ms = fade_in_ms;
        }
        if let Some(fade_out_ms) = request.fade_out_ms {
            cue.fade_out_ms = fade_out_ms;
        }
        if let Some(follow_seconds) = &request.follow_seconds {
            cue.follow_seconds = *follow_seconds;
        }
        if let Some(notes) = &request.notes {
            cue.notes = notes.clone();
        }
    }

    if let Some(target_ordinal) = request.ordinal {
        let target_index = (target_ordinal.max(1) as usize).saturating_sub(1);
        let target_index = target_index.min(cues.len().saturating_sub(1));
        if target_index != current_index {
            let cue = cues.remove(current_index);
            cues.insert(target_index, cue);
        }
    }
    resequence_cues(&mut cues);
    let stored = cues
        .iter()
        .find(|cue| cue.id == request.cue_id)
        .cloned()
        .unwrap();

    let summary = format!("Lighting cue '{}' was updated.", stored.label);
    let updates = vec![
        (
            String::from(LIGHTING_CUES_KEY),
            serialize_lighting_cues(&cues)?,
        ),
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ];
    persist_lighting_state(db_path, &updates)?;

    let active_cue_id = read_optional_setting(&app_settings, LIGHTING_ACTIVE_CUE_ID_KEY);
    Ok(LightingCueUpdateResult {
        cue: lighting_cue_snapshot_from_state(&stored, active_cue_id.as_deref()),
        summary,
    })
}

pub fn delete_lighting_cue(
    db_path: &Path,
    request: &LightingCueDeleteRequest,
) -> Result<LightingCueDeleteResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut cues = load_lighting_cues(&app_settings);
    let index = cues
        .iter()
        .position(|cue| cue.id == request.cue_id)
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_CUE_NOT_FOUND",
                format!("Lighting cue '{}' is not present in the cue stack.", request.cue_id),
            )
        })?;
    let removed = cues.remove(index);
    resequence_cues(&mut cues);

    let active_cue_id = read_optional_setting(&app_settings, LIGHTING_ACTIVE_CUE_ID_KEY);
    let clear_active = active_cue_id.as_deref() == Some(request.cue_id.as_str());

    let summary = format!("Lighting cue '{}' was deleted.", removed.label);
    let mut updates = vec![
        (
            String::from(LIGHTING_CUES_KEY),
            serialize_lighting_cues(&cues)?,
        ),
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ];
    if clear_active {
        updates.push((String::from(LIGHTING_ACTIVE_CUE_ID_KEY), String::new()));
    }
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingCueDeleteResult {
        deleted: true,
        cue_id: request.cue_id.clone(),
        summary,
    })
}

pub fn fire_lighting_cue(
    db_path: &Path,
    request: &LightingCueFireRequest,
) -> Result<LightingCueFireResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let cues = load_lighting_cues(&app_settings);
    let target = cues
        .iter()
        .find(|cue| cue.id == request.cue_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_CUE_NOT_FOUND",
                format!("Lighting cue '{}' is not present in the cue stack.", request.cue_id),
            )
        })?;

    let previous_cue_id = read_optional_setting(&app_settings, LIGHTING_ACTIVE_CUE_ID_KEY);
    let applied_fade_ms = request.fade_override_ms.unwrap_or(target.fade_in_ms);

    if let Some(scene_id) = &target.scene_id {
        let fade_seconds = (applied_fade_ms as f64) / 1000.0;
        let recall_request = LightingSceneRecallRequest {
            scene_id: scene_id.clone(),
            fade_duration_seconds: fade_seconds.clamp(0.0, 10.0),
        };
        recall_lighting_scene(db_path, &recall_request)?;
    }

    let summary = format!("Lighting cue '{}' fired.", target.label);
    let updates = vec![
        (
            String::from(LIGHTING_ACTIVE_CUE_ID_KEY),
            target.id.clone(),
        ),
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ];
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingCueFireResult {
        active_cue_id: target.id,
        previous_cue_id,
        applied_fade_ms,
        summary,
    })
}

pub fn build_lighting_health_check(settings: &HashMap<String, String>) -> LightingHealthCheck {
    let snapshot = read_lighting_snapshot(settings);
    LightingHealthCheck {
        ok: snapshot.status == "ready",
        status: snapshot.status.clone(),
        summary: snapshot.summary.clone(),
        bridge_ip: snapshot.bridge_ip,
        universe: snapshot.universe,
        reachable: snapshot.reachable,
    }
}

fn load_lighting_editor_state_with_inventory(
    settings: &HashMap<String, String>,
    config: &LightingBackendConfig,
    inventory: &LightingBackendInventory,
) -> LightingEditorState {
    settings
        .get(LIGHTING_EDITOR_STATE_KEY)
        .or_else(|| settings.get(LEGACY_LIGHTING_EDITOR_STATE_KEY))
        .and_then(|value| serde_json::from_str::<LightingEditorState>(value).ok())
        .map(|state| normalize_lighting_editor_state(state, settings, config, inventory))
        .unwrap_or_else(|| default_lighting_editor_state(settings, config, inventory))
}

fn default_lighting_editor_state(
    settings: &HashMap<String, String>,
    config: &LightingBackendConfig,
    inventory: &LightingBackendInventory,
) -> LightingEditorState {
    let fixtures = inventory
        .fixtures
        .iter()
        .map(|fixture| LightingEditorFixtureState {
            id: fixture.id.clone(),
            name: fixture.name.clone(),
            fixture_type: normalized_fixture_type(
                Some(fixture.fixture_type.as_str()),
                Some(fixture.kind.as_str()),
                fixture.id.as_str(),
            ),
            dmx_start_address: normalize_dmx_start_address(
                fixture.dmx_start_address,
                fixture_type_for_fixture(fixture).as_str(),
            ),
            kind: fixture.kind.clone(),
            group_id: fixture.group_id.clone(),
            spatial_x: fixture.spatial_x,
            spatial_y: fixture.spatial_y,
            spatial_rotation: normalize_rotation(fixture.spatial_rotation),
            rig_z: None,
            beam_angle_degrees: None,
            intensity: read_fixture_intensity(settings, &fixture.id),
            cct: read_fixture_cct(settings, &fixture.id),
            on: read_fixture_on(settings, &fixture.id),
            effect: None,
        })
        .collect::<Vec<_>>();
    let groups = default_lighting_group_states(inventory, &fixtures);

    LightingEditorState {
        groups,
        removed_fixture_ids: Vec::new(),
        scenes: default_lighting_scene_states(config, inventory, &fixtures),
        fixtures,
    }
}

fn normalize_lighting_editor_state(
    existing: LightingEditorState,
    settings: &HashMap<String, String>,
    config: &LightingBackendConfig,
    inventory: &LightingBackendInventory,
) -> LightingEditorState {
    let removed_fixture_ids = existing.removed_fixture_ids.clone();
    let inventory_fixtures_by_id = inventory
        .fixtures
        .iter()
        .map(|fixture| (fixture.id.as_str(), fixture))
        .collect::<HashMap<_, _>>();
    let mut fixtures = existing
        .fixtures
        .iter()
        .filter(|fixture| {
            !removed_fixture_ids
                .iter()
                .any(|removed_id| removed_id == &fixture.id)
        })
        .map(|fixture| {
            let inventory_fixture = inventory_fixtures_by_id.get(fixture.id.as_str()).copied();
            let fixture_type = normalized_fixture_type(
                Some(fixture.fixture_type.as_str()),
                Some(fixture.kind.as_str()),
                fixture.id.as_str(),
            );
            LightingEditorFixtureState {
                id: fixture.id.clone(),
                name: if fixture.name.trim().is_empty() {
                    inventory_fixture
                        .map(|inventory_fixture| inventory_fixture.name.clone())
                        .unwrap_or_else(|| fixture.id.clone())
                } else {
                    fixture.name.clone()
                },
                fixture_type: fixture_type.clone(),
                dmx_start_address: normalize_dmx_start_address(
                    fixture.dmx_start_address,
                    fixture_type.as_str(),
                ),
                kind: lighting_kind_for_type(&fixture_type),
                group_id: fixture.group_id.clone(),
                spatial_x: normalize_optional_coordinate(fixture.spatial_x),
                spatial_y: normalize_optional_coordinate(fixture.spatial_y),
                spatial_rotation: normalize_rotation(fixture.spatial_rotation),
                rig_z: fixture.rig_z,
                beam_angle_degrees: fixture.beam_angle_degrees,
                intensity: clamp_i64(fixture.intensity, 0, 100),
                cct: clamp_cct_for_type(
                    fixture.cct,
                    fixture_type.as_str(),
                    inventory_fixture
                        .map(|inventory_fixture| inventory_fixture.cct)
                        .unwrap_or_else(|| default_fixture_cct_for_type(fixture_type.as_str())),
                ),
                on: fixture.on,
                effect: fixture.effect.clone().map(normalize_lighting_effect),
            }
        })
        .collect::<Vec<_>>();
    append_missing_fixture_states(&mut fixtures, &removed_fixture_ids, settings, inventory);
    let groups = normalize_lighting_group_states(&existing.groups, inventory, &fixtures);
    let scenes = if existing.scenes.is_empty() {
        default_lighting_scene_states(config, inventory, &fixtures)
    } else {
        existing
            .scenes
            .iter()
            .map(|scene| LightingEditorSceneState {
                id: scene.id.clone(),
                name: scene.name.clone(),
                fixture_states: fixtures
                    .iter()
                    .map(|fixture| {
                        let existing_fixture_state = scene
                            .fixture_states
                            .iter()
                            .find(|state| state.fixture_id == fixture.id);
                        LightingEditorSceneFixtureState {
                            fixture_id: fixture.id.clone(),
                            intensity: existing_fixture_state
                                .map(|state| clamp_i64(state.intensity, 0, 100))
                                .unwrap_or(fixture.intensity),
                            cct: existing_fixture_state
                                .map(|state| clamp_i64(state.cct, MIN_FIXTURE_CCT, MAX_FIXTURE_CCT))
                                .unwrap_or(fixture.cct),
                            on: existing_fixture_state
                                .map(|state| state.on)
                                .unwrap_or(fixture.on),
                        }
                    })
                    .collect(),
            })
            .collect()
    };

    LightingEditorState {
        groups,
        removed_fixture_ids,
        fixtures,
        scenes,
    }
}

fn default_lighting_group_states(
    inventory: &LightingBackendInventory,
    fixtures: &[LightingEditorFixtureState],
) -> Vec<LightingEditorGroupState> {
    let mut groups = inventory
        .groups
        .iter()
        .map(|group| LightingEditorGroupState {
            id: group.id.clone(),
            name: group.name.clone(),
        })
        .collect::<Vec<_>>();
    append_missing_group_states(&mut groups, fixtures, inventory);
    groups
}

fn normalize_lighting_group_states(
    existing_groups: &[LightingEditorGroupState],
    inventory: &LightingBackendInventory,
    fixtures: &[LightingEditorFixtureState],
) -> Vec<LightingEditorGroupState> {
    if existing_groups.is_empty() {
        return default_lighting_group_states(inventory, fixtures);
    }

    let mut groups = existing_groups.to_vec();
    append_missing_group_states(&mut groups, fixtures, inventory);
    groups
}

fn append_missing_group_states(
    groups: &mut Vec<LightingEditorGroupState>,
    fixtures: &[LightingEditorFixtureState],
    inventory: &LightingBackendInventory,
) {
    let inventory_group_names = inventory
        .groups
        .iter()
        .map(|group| (group.id.as_str(), group.name.as_str()))
        .collect::<HashMap<_, _>>();
    let mut known_ids = groups
        .iter()
        .map(|group| group.id.clone())
        .collect::<Vec<_>>();

    for fixture in fixtures {
        if let Some(group_id) = fixture.group_id.as_deref() {
            if known_ids.iter().any(|known_id| known_id == group_id) {
                continue;
            }
            groups.push(LightingEditorGroupState {
                id: String::from(group_id),
                name: inventory_group_names
                    .get(group_id)
                    .map(|name| String::from(*name))
                    .unwrap_or_else(|| String::from(group_id)),
            });
            known_ids.push(String::from(group_id));
        }
    }
}

fn append_missing_fixture_states(
    fixtures: &mut Vec<LightingEditorFixtureState>,
    removed_fixture_ids: &[String],
    settings: &HashMap<String, String>,
    inventory: &LightingBackendInventory,
) {
    let known_ids = fixtures
        .iter()
        .map(|fixture| fixture.id.clone())
        .collect::<Vec<_>>();

    for inventory_fixture in &inventory.fixtures {
        if known_ids
            .iter()
            .any(|fixture_id| fixture_id == &inventory_fixture.id)
            || removed_fixture_ids
                .iter()
                .any(|fixture_id| fixture_id == &inventory_fixture.id)
        {
            continue;
        }

        let fixture_type = fixture_type_for_fixture(inventory_fixture);
        fixtures.push(LightingEditorFixtureState {
            id: inventory_fixture.id.clone(),
            name: inventory_fixture.name.clone(),
            fixture_type: fixture_type.clone(),
            dmx_start_address: normalize_dmx_start_address(
                inventory_fixture.dmx_start_address,
                fixture_type.as_str(),
            ),
            kind: lighting_kind_for_type(fixture_type.as_str()),
            group_id: inventory_fixture.group_id.clone(),
            spatial_x: normalize_optional_coordinate(inventory_fixture.spatial_x),
            spatial_y: normalize_optional_coordinate(inventory_fixture.spatial_y),
            spatial_rotation: normalize_rotation(inventory_fixture.spatial_rotation),
            rig_z: None,
            beam_angle_degrees: None,
            intensity: read_fixture_intensity(settings, &inventory_fixture.id),
            cct: clamp_cct_for_type(
                read_fixture_cct(settings, &inventory_fixture.id),
                fixture_type.as_str(),
                inventory_fixture.cct,
            ),
            on: read_fixture_on(settings, &inventory_fixture.id),
            effect: None,
        });
    }
}

fn default_lighting_scene_states(
    config: &LightingBackendConfig,
    inventory: &LightingBackendInventory,
    fixtures: &[LightingEditorFixtureState],
) -> Vec<LightingEditorSceneState> {
    inventory
        .scenes
        .iter()
        .map(|scene| LightingEditorSceneState {
            id: scene.id.clone(),
            name: scene.name.clone(),
            fixture_states: default_lighting_scene_fixture_states(
                config, inventory, &scene.id, fixtures,
            ),
        })
        .collect()
}

fn default_lighting_scene_fixture_states(
    config: &LightingBackendConfig,
    inventory: &LightingBackendInventory,
    scene_id: &str,
    fixtures: &[LightingEditorFixtureState],
) -> Vec<LightingEditorSceneFixtureState> {
    let backend_updates = recall_default_lighting_scene(config, inventory, scene_id, 0.0)
        .ok()
        .map(|outcome| {
            outcome
                .fixture_updates
                .into_iter()
                .map(|update| (update.fixture_id.clone(), update))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();

    fixtures
        .iter()
        .map(|fixture| {
            let backend_update = backend_updates.get(&fixture.id);
            LightingEditorSceneFixtureState {
                fixture_id: fixture.id.clone(),
                intensity: backend_update
                    .map(|update| clamp_i64(update.intensity, 0, 100))
                    .unwrap_or(fixture.intensity),
                cct: fixture.cct,
                on: backend_update.map(|update| update.on).unwrap_or(fixture.on),
            }
        })
        .collect()
}

fn lighting_editor_state_updates(
    state: &LightingEditorState,
) -> Result<Vec<(String, String)>, LightingCommandError> {
    let serialized = serde_json::to_string(state)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))?;
    let mut updates = vec![(String::from(LIGHTING_EDITOR_STATE_KEY), serialized)];
    for fixture in &state.fixtures {
        updates.extend_from_slice(&[
            (fixture_on_key(&fixture.id), fixture.on.to_string()),
            (
                fixture_intensity_key(&fixture.id),
                fixture.intensity.to_string(),
            ),
            (fixture_cct_key(&fixture.id), fixture.cct.to_string()),
        ]);
    }
    Ok(updates)
}

fn lighting_group_snapshot_from_state(
    group: &LightingEditorGroupState,
    fixtures: &[LightingEditorFixtureState],
) -> LightingGroupSnapshot {
    LightingGroupSnapshot {
        id: group.id.clone(),
        name: group.name.clone(),
        fixture_count: fixtures
            .iter()
            .filter(|fixture| fixture.group_id.as_deref() == Some(group.id.as_str()))
            .count(),
    }
}

fn snapshot_fixtures(fixtures: &[LightingEditorFixtureState]) -> Vec<LightingFixtureSnapshot> {
    fixtures
        .iter()
        .cloned()
        .map(lighting_fixture_snapshot_from_state)
        .collect()
}

fn lighting_fixture_snapshot_from_state(
    fixture: LightingEditorFixtureState,
) -> LightingFixtureSnapshot {
    LightingFixtureSnapshot {
        id: fixture.id,
        name: fixture.name,
        fixture_type: fixture.fixture_type,
        dmx_start_address: fixture.dmx_start_address,
        kind: fixture.kind,
        group_id: fixture.group_id,
        spatial_x: fixture.spatial_x,
        spatial_y: fixture.spatial_y,
        spatial_rotation: normalize_rotation(fixture.spatial_rotation),
        rig_z: fixture.rig_z,
        beam_angle_degrees: fixture.beam_angle_degrees,
        on: fixture.on,
        intensity: fixture.intensity,
        cct: fixture.cct,
        effect: fixture.effect.map(normalize_lighting_effect),
    }
}

fn lighting_scene_snapshot_from_state(
    scene: &LightingEditorSceneState,
    last_recalled_scene_id: Option<&str>,
    last_scene_recall_at: Option<&str>,
) -> LightingSceneSnapshot {
    let last_recalled = last_recalled_scene_id
        .map(|value| value == scene.id)
        .unwrap_or(false);
    LightingSceneSnapshot {
        id: scene.id.clone(),
        name: scene.name.clone(),
        fixture_count: scene.fixture_states.len(),
        fixture_states: scene
            .fixture_states
            .iter()
            .map(|state| LightingSceneFixtureSnapshot {
                fixture_id: state.fixture_id.clone(),
                intensity: state.intensity,
                cct: state.cct,
                on: state.on,
            })
            .collect(),
        last_recalled,
        last_recalled_at: if last_recalled {
            last_scene_recall_at.map(String::from)
        } else {
            None
        },
    }
}

fn capture_scene_fixture_states(
    fixtures: &[LightingEditorFixtureState],
) -> Vec<LightingEditorSceneFixtureState> {
    fixtures
        .iter()
        .map(|fixture| LightingEditorSceneFixtureState {
            fixture_id: fixture.id.clone(),
            intensity: fixture.intensity,
            cct: fixture.cct,
            on: fixture.on,
        })
        .collect()
}

fn next_custom_scene_id(scenes: &[LightingEditorSceneState]) -> String {
    let next_index = scenes
        .iter()
        .filter_map(|scene| {
            scene
                .id
                .strip_prefix(LIGHTING_CUSTOM_SCENE_ID_PREFIX)
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;

    format!("{LIGHTING_CUSTOM_SCENE_ID_PREFIX}{next_index}")
}

fn next_custom_group_id(groups: &[LightingEditorGroupState]) -> String {
    let next_index = groups
        .iter()
        .filter_map(|group| {
            group
                .id
                .strip_prefix(LIGHTING_CUSTOM_GROUP_ID_PREFIX)
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;

    format!("{LIGHTING_CUSTOM_GROUP_ID_PREFIX}{next_index}")
}

fn next_custom_fixture_id(fixtures: &[LightingEditorFixtureState]) -> String {
    let next_index = fixtures
        .iter()
        .filter_map(|fixture| {
            fixture
                .id
                .strip_prefix(LIGHTING_CUSTOM_FIXTURE_ID_PREFIX)
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;

    format!("{LIGHTING_CUSTOM_FIXTURE_ID_PREFIX}{next_index}")
}

fn default_fixture_type() -> String {
    String::from(DEFAULT_LIGHTING_FIXTURE_TYPE)
}

fn default_fixture_dmx_start_address() -> i64 {
    1
}

fn normalized_fixture_type(
    explicit_type: Option<&str>,
    legacy_kind: Option<&str>,
    fixture_id: &str,
) -> String {
    explicit_type
        .and_then(validate_fixture_type)
        .or_else(|| legacy_kind.and_then(validate_fixture_type))
        .or_else(|| infer_fixture_type_from_legacy_kind(legacy_kind))
        .or_else(|| infer_fixture_type_from_fixture_id(fixture_id))
        .unwrap_or_else(default_fixture_type)
}

fn fixture_type_for_fixture(fixture: &LightingFixtureSnapshot) -> String {
    normalized_fixture_type(
        Some(fixture.fixture_type.as_str()),
        Some(fixture.kind.as_str()),
        fixture.id.as_str(),
    )
}

fn validate_fixture_type(value: &str) -> Option<String> {
    match value {
        "astra-bicolor" | "infinimat" | "infinibar-pb12" => Some(String::from(value)),
        _ => None,
    }
}

fn validate_effect_type(value: &str) -> Option<String> {
    match value {
        "pulse" | "strobe" | "candle" => Some(String::from(value)),
        _ => None,
    }
}

fn infer_fixture_type_from_legacy_kind(value: Option<&str>) -> Option<String> {
    match value.unwrap_or_default() {
        "profile" => Some(String::from("astra-bicolor")),
        "wash" => Some(String::from("infinimat")),
        "practical" => Some(String::from("infinibar-pb12")),
        _ => None,
    }
}

fn infer_fixture_type_from_fixture_id(fixture_id: &str) -> Option<String> {
    if fixture_id.contains("wash") {
        Some(String::from("infinimat"))
    } else if fixture_id.contains("practical") || fixture_id.contains("house") {
        Some(String::from("infinibar-pb12"))
    } else if fixture_id.contains("key") {
        Some(String::from("astra-bicolor"))
    } else {
        None
    }
}

fn lighting_kind_for_type(fixture_type: &str) -> String {
    match fixture_type {
        "infinimat" => String::from("wash"),
        "infinibar-pb12" => String::from("practical"),
        _ => String::from("profile"),
    }
}

fn fixture_channel_count(fixture_type: &str) -> i64 {
    match fixture_type {
        "infinimat" => 4,
        "infinibar-pb12" => 8,
        _ => 2,
    }
}

fn fixture_cct_range(fixture_type: &str) -> (i64, i64) {
    match fixture_type {
        "infinimat" | "infinibar-pb12" => (2000, 10000),
        _ => (3200, 5600),
    }
}

fn fixture_channel_labels(fixture_type: &str) -> Vec<String> {
    match fixture_type {
        "astra-bicolor" => vec![String::from("Dimmer"), String::from("CCT")],
        "infinimat" => vec![
            String::from("Dimmer"),
            String::from("CCT"),
            String::from("±G/M"),
            String::from("Strobe"),
        ],
        "infinibar-pb12" => vec![
            String::from("Dimmer"),
            String::from("CCT"),
            String::from("Mix"),
            String::from("Red"),
            String::from("Green"),
            String::from("Blue"),
            String::from("FX"),
            String::from("Speed"),
        ],
        _ => Vec::new(),
    }
}

fn intensity_to_dmx(percent: i64) -> i64 {
    ((clamp_i64(percent, 0, 100) as f64) * 2.55).round() as i64
}

fn cct_to_dmx(kelvin: i64, min: i64, max: i64) -> i64 {
    let clamped = clamp_i64(kelvin, min, max);
    (((clamped - min) as f64 / (max - min) as f64) * 255.0).round() as i64
}

fn compute_dmx_channel_data(snapshot: &LightingSnapshot) -> HashMap<i64, i64> {
    let mut channel_data = HashMap::new();
    let grand_master = (snapshot.grand_master as f64 / 100.0).clamp(0.0, 1.0);

    for fixture in &snapshot.fixtures {
        let address = fixture.dmx_start_address;
        let dimmer = if fixture.on {
            ((intensity_to_dmx(fixture.intensity) as f64) * grand_master).round() as i64
        } else {
            0
        };
        let (cct_min, cct_max) = fixture_cct_range(fixture.fixture_type.as_str());

        channel_data.insert(address, dimmer);
        channel_data.insert(address + 1, cct_to_dmx(fixture.cct, cct_min, cct_max));

        match fixture_channel_count(fixture.fixture_type.as_str()) {
            8 => {
                channel_data.insert(address + 2, 0);
                channel_data.insert(address + 3, 0);
                channel_data.insert(address + 4, 0);
                channel_data.insert(address + 5, 0);
                channel_data.insert(address + 6, 0);
                channel_data.insert(address + 7, 0);
            }
            4 => {
                channel_data.insert(address + 2, 0);
                channel_data.insert(address + 3, 0);
            }
            _ => {}
        }
    }

    channel_data
}

fn default_fixture_cct_for_type(fixture_type: &str) -> i64 {
    match fixture_type {
        "infinimat" | "infinibar-pb12" => 5600,
        _ => 4400,
    }
}

fn normalize_dmx_start_address(dmx_start_address: i64, fixture_type: &str) -> i64 {
    let max_start = 512 - fixture_channel_count(fixture_type) + 1;
    clamp_i64(dmx_start_address, 1, max_start)
}

fn normalize_lighting_effect(effect: LightingEffect) -> LightingEffect {
    LightingEffect {
        effect_type: validate_effect_type(effect.effect_type.as_str())
            .unwrap_or_else(|| String::from("pulse")),
        speed: clamp_i64(effect.speed, 1, 10),
    }
}

fn clamp_cct_for_type(cct: i64, fixture_type: &str, default_cct: i64) -> i64 {
    let (min_cct, max_cct) = fixture_cct_range(fixture_type);
    let seed = if cct == 0 { default_cct } else { cct };
    clamp_i64(seed, min_cct, max_cct)
}

fn validate_group_exists(
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

fn validate_dmx_start_address(
    fixtures: &[LightingEditorFixtureState],
    fixture_type: &str,
    dmx_start_address: i64,
    exclude_fixture_id: Option<&str>,
) -> Result<(), LightingCommandError> {
    let max_start = 512 - fixture_channel_count(fixture_type) + 1;
    if !(1..=max_start).contains(&dmx_start_address) {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_INVALID_DMX_ADDRESS",
            format!(
                "DMX start address must be between 1 and {} for fixture type '{}'.",
                max_start, fixture_type
            ),
        ));
    }

    let new_end = dmx_start_address + fixture_channel_count(fixture_type) - 1;
    if let Some(overlap_fixture) = fixtures.iter().find(|fixture| {
        if exclude_fixture_id == Some(fixture.id.as_str()) {
            return false;
        }
        let existing_end =
            fixture.dmx_start_address + fixture_channel_count(fixture.fixture_type.as_str()) - 1;
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

fn append_fixture_to_scenes(
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
        });
    }
}

fn remove_fixture_from_scenes(scenes: &mut [LightingEditorSceneState], fixture_id: &str) {
    for scene in scenes {
        scene
            .fixture_states
            .retain(|fixture_state| fixture_state.fixture_id != fixture_id);
    }
}

fn lighting_fixture_update_summary(fixture: &LightingEditorFixtureState) -> String {
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

fn lighting_scene_update_summary(
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

    if parts.is_empty() {
        format!("Lighting scene '{}' was updated.", scene.name)
    } else {
        format!("Lighting scene '{}' {}.", scene.name, parts.join(" and "))
    }
}

fn lighting_adapter_label(adapter_mode: &str) -> &'static str {
    if adapter_mode == "simulated" {
        "Simulated"
    } else {
        "Native"
    }
}

fn is_valid_ipv4(value: &str) -> bool {
    Ipv4Addr::from_str(value.trim()).is_ok()
}

fn recall_mode_label(fade_duration_seconds: f64) -> String {
    if fade_duration_seconds <= 0.0 {
        String::from("instant recall")
    } else if fade_duration_seconds.fract() == 0.0 {
        format!("{}s fade", fade_duration_seconds as i64)
    } else {
        format!("{fade_duration_seconds:.1}s fade")
    }
}

fn load_lighting_settings(db_path: &Path) -> Result<HashMap<String, String>, LightingCommandError> {
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))
}

fn resolve_lighting_config(settings: &HashMap<String, String>) -> LightingBackendConfig {
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

fn read_lighting_editor_inventory(config: &LightingBackendConfig) -> LightingBackendInventory {
    let inventory_config = LightingBackendConfig {
        enabled: !config.bridge_ip.trim().is_empty(),
        bridge_ip: config.bridge_ip.clone(),
        universe: config.universe,
    };
    read_default_lighting_inventory(&inventory_config)
}

fn ensure_lighting_action_allowed(
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

fn persist_lighting_state(
    db_path: &Path,
    updates: &[(String, String)],
) -> Result<(), LightingCommandError> {
    set_settings_owned(db_path, updates)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))
}

fn record_lighting_action_failure(
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

fn current_timestamp(db_path: &Path) -> Result<String, LightingCommandError> {
    let connection = open_connection(db_path)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))?;
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| LightingCommandError::Storage(error.to_string()))
}

fn lighting_check_status(settings: &HashMap<String, String>) -> String {
    settings
        .get(&format!(
            "app.commissioning.check.{LIGHTING_CHECK_ID}.status"
        ))
        .cloned()
        .unwrap_or_else(|| String::from("idle"))
}

fn parse_required_scene_name(value: Option<&Value>) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("name is required"))
}

fn parse_required_group_name(value: Option<&Value>) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("name is required"))
}

fn parse_required_fixture_name(value: Option<&Value>) -> Result<String, String> {
    let name = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("name is required"))?;
    if name.len() > 50 {
        return Err(String::from("name must be 50 characters or fewer"));
    }
    Ok(name)
}

fn parse_required_fixture_type(value: Option<&Value>) -> Result<String, String> {
    let fixture_type = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("type is required"))?;

    validate_fixture_type(fixture_type).ok_or_else(|| {
        String::from("type must be one of astra-bicolor, infinimat, or infinibar-pb12")
    })
}

fn parse_required_fixture_dmx_start_address(
    value: Option<&Value>,
    fixture_type: &str,
) -> Result<i64, String> {
    let dmx_start_address = value
        .ok_or_else(|| String::from("dmxStartAddress is required"))
        .and_then(parse_positive_i64_value)?;
    let max_start = 512 - fixture_channel_count(fixture_type) + 1;
    if !(1..=max_start).contains(&dmx_start_address) {
        return Err(format!(
            "dmxStartAddress must be between 1 and {} for type '{}'",
            max_start, fixture_type
        ));
    }
    Ok(dmx_start_address)
}

fn parse_optional_trimmed_string_or_null(
    value: &Value,
    field: &str,
) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }

    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .map(Some)
        .ok_or_else(|| format!("{field} must be a string or null"))
}

fn parse_optional_group_id(value: &Value) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }

    value
        .as_str()
        .map(str::trim)
        .filter(|group_id| !group_id.is_empty())
        .map(String::from)
        .map(Some)
        .ok_or_else(|| String::from("groupId must be a string or null"))
}

fn parse_optional_effect(value: &Value, field: &str) -> Result<Option<LightingEffect>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let object = value
        .as_object()
        .ok_or_else(|| format!("{field} must be an object or null"))?;
    let effect_type = object
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{field}.type is required"))?;
    let normalized_type = validate_effect_type(effect_type)
        .ok_or_else(|| format!("{field}.type must be one of pulse, strobe, or candle"))?;
    let speed = object
        .get("speed")
        .map(parse_i64_value)
        .transpose()?
        .unwrap_or(5);

    Ok(Some(LightingEffect {
        effect_type: normalized_type,
        speed: clamp_i64(speed, 1, 10),
    }))
}

fn parse_optional_spatial_coordinate(value: &Value, field: &str) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let coordinate = value
        .as_f64()
        .ok_or_else(|| format!("{field} must be a finite number or null"))?;
    if !coordinate.is_finite() {
        return Err(format!("{field} must be a finite number or null"));
    }

    Ok(Some(clamp_f64(coordinate, 0.0, 1.0)))
}

fn parse_spatial_rotation_value(value: &Value, field: &str) -> Result<f64, String> {
    let rotation = value
        .as_f64()
        .ok_or_else(|| format!("{field} must be a finite number"))?;
    if !rotation.is_finite() {
        return Err(format!("{field} must be a finite number"));
    }
    Ok(normalize_rotation(rotation))
}

fn parse_optional_rig_z(value: &Value) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let meters = value
        .as_f64()
        .ok_or_else(|| String::from("rigZ must be a finite number or null"))?;
    if !meters.is_finite() {
        return Err(String::from("rigZ must be a finite number or null"));
    }
    Ok(Some(clamp_f64(meters, 0.0, 20.0)))
}

fn parse_optional_beam_angle_degrees(value: &Value) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let degrees = value
        .as_f64()
        .ok_or_else(|| String::from("beamAngleDegrees must be a finite number or null"))?;
    if !degrees.is_finite() {
        return Err(String::from("beamAngleDegrees must be a finite number or null"));
    }
    Ok(Some(clamp_f64(degrees, 1.0, 180.0)))
}

fn parse_optional_spatial_marker(
    value: &Value,
    field: &str,
) -> Result<Option<LightingSpatialMarker>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let object = value
        .as_object()
        .ok_or_else(|| format!("{field} must be an object or null"))?;
    let x = parse_optional_spatial_coordinate(
        object
            .get("x")
            .ok_or_else(|| format!("{field}.x is required"))?,
        &format!("{field}.x"),
    )?
    .ok_or_else(|| format!("{field}.x is required"))?;
    let y = parse_optional_spatial_coordinate(
        object
            .get("y")
            .ok_or_else(|| format!("{field}.y is required"))?,
        &format!("{field}.y"),
    )?
    .ok_or_else(|| format!("{field}.y is required"))?;
    let rotation = parse_spatial_rotation_value(
        object
            .get("rotation")
            .ok_or_else(|| format!("{field}.rotation is required"))?,
        &format!("{field}.rotation"),
    )?;

    Ok(Some(LightingSpatialMarker {
        x: clamp_f64(x, 0.0, 1.0),
        y: clamp_f64(y, 0.0, 1.0),
        rotation,
    }))
}

fn parse_i64_value(value: &Value) -> Result<i64, String> {
    if let Some(number) = value.as_i64() {
        Ok(number)
    } else if let Some(number) = value.as_f64() {
        if number.is_finite() {
            Ok(number.round() as i64)
        } else {
            Err(String::from("value must be a finite number"))
        }
    } else {
        Err(String::from("value must be a number"))
    }
}

fn parse_positive_i64_value(value: &Value) -> Result<i64, String> {
    let number = parse_i64_value(value)?;
    if number < 1 {
        return Err(String::from("value must be a positive integer"));
    }
    Ok(number)
}

fn read_optional_setting(settings: &HashMap<String, String>, key: &str) -> Option<String> {
    settings
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

fn read_selected_fixture_id(
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

fn read_selected_scene_id(
    settings: &HashMap<String, String>,
    scenes: &[LightingSceneSnapshot],
) -> Option<String> {
    read_optional_setting(settings, LIGHTING_SELECTED_SCENE_ID_KEY)
        .filter(|selected_scene_id| scenes.iter().any(|scene| scene.id == *selected_scene_id))
}

fn read_lighting_grand_master(settings: &HashMap<String, String>) -> i64 {
    settings
        .get(LIGHTING_GRAND_MASTER_KEY)
        .and_then(|value| value.parse::<i64>().ok())
        .map(|value| clamp_i64(value, 0, 100))
        .unwrap_or(100)
}

fn read_lighting_output_enabled(settings: &HashMap<String, String>, bridge_ip: &str) -> bool {
    settings
        .get(LIGHTING_ENABLED_KEY)
        .and_then(|value| match value.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
        .unwrap_or_else(|| !bridge_ip.trim().is_empty())
}

fn read_marker_setting(
    settings: &HashMap<String, String>,
    key: &str,
) -> Option<LightingSpatialMarker> {
    read_optional_setting(settings, key)
        .and_then(|value| serde_json::from_str::<LightingSpatialMarker>(&value).ok())
        .map(normalize_marker)
}

fn serialize_optional_marker(
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

fn fixture_on_key(fixture_id: &str) -> String {
    format!("{LIGHTING_FIXTURE_STATE_PREFIX}{fixture_id}.on")
}

fn fixture_intensity_key(fixture_id: &str) -> String {
    format!("{LIGHTING_FIXTURE_STATE_PREFIX}{fixture_id}.intensity")
}

fn fixture_cct_key(fixture_id: &str) -> String {
    format!("{LIGHTING_FIXTURE_STATE_PREFIX}{fixture_id}.cct")
}

fn read_fixture_on(settings: &HashMap<String, String>, fixture_id: &str) -> bool {
    settings
        .get(&fixture_on_key(fixture_id))
        .and_then(|value| match value.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        })
        .unwrap_or(false)
}

fn read_fixture_intensity(settings: &HashMap<String, String>, fixture_id: &str) -> i64 {
    settings
        .get(&fixture_intensity_key(fixture_id))
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (0..=100).contains(value))
        .unwrap_or(DEFAULT_FIXTURE_INTENSITY)
}

fn read_fixture_cct(settings: &HashMap<String, String>, fixture_id: &str) -> i64 {
    settings
        .get(&fixture_cct_key(fixture_id))
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (MIN_FIXTURE_CCT..=MAX_FIXTURE_CCT).contains(value))
        .unwrap_or(DEFAULT_FIXTURE_CCT)
}

fn normalize_optional_coordinate(value: Option<f64>) -> Option<f64> {
    value
        .filter(|coordinate| coordinate.is_finite())
        .map(|coordinate| clamp_f64(coordinate, 0.0, 1.0))
}

fn normalize_rotation(value: f64) -> f64 {
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

fn normalize_marker(marker: LightingSpatialMarker) -> LightingSpatialMarker {
    LightingSpatialMarker {
        x: clamp_f64(marker.x, 0.0, 1.0),
        y: clamp_f64(marker.y, 0.0, 1.0),
        rotation: normalize_rotation(marker.rotation),
    }
}

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

fn lighting_summary(
    status: &str,
    bridge_ip: &str,
    universe: i64,
    fixture_count: usize,
    group_count: usize,
    scene_count: usize,
    last_recalled_scene_id: Option<&str>,
    last_scene_recall_at: Option<&str>,
    last_action_status: &str,
    last_action_code: Option<&str>,
    last_action_message: Option<&str>,
) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{initialize_database, set_settings_owned};
    use std::fs;
    use std::path::PathBuf;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "studio-control-engine-lighting-{label}-{}-{unique}",
                process::id()
            ));
            fs::create_dir_all(&path).expect("test dir should be created");
            Self { path }
        }

        fn db_path(&self) -> PathBuf {
            self.path.join("native.sqlite3")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn lighting_snapshot_reports_unconfigured_when_no_bridge_exists() {
        let snapshot = read_lighting_snapshot(&HashMap::new());
        assert_eq!(snapshot.status, "unconfigured");
        assert!(!snapshot.enabled);
        assert!(!snapshot.connected);
    }

    #[test]
    fn lighting_snapshot_reports_ready_when_probe_passed() {
        let settings = HashMap::from([
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ]);

        let snapshot = read_lighting_snapshot(&settings);
        assert_eq!(snapshot.status, "ready");
        assert!(snapshot.reachable);
        assert!(snapshot.connected);
        assert_eq!(snapshot.fixtures.len(), 4);
        assert_eq!(snapshot.groups.len(), 2);
        assert_eq!(snapshot.scenes.len(), 3);
        assert_eq!(snapshot.groups[0].fixture_count, 3);
    }

    #[test]
    fn lighting_dmx_monitor_matches_legacy_channel_shape() {
        let settings = HashMap::from([
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (String::from(LIGHTING_ENABLED_KEY), String::from("true")),
            (String::from(LIGHTING_GRAND_MASTER_KEY), String::from("50")),
        ]);

        let monitor = read_lighting_dmx_monitor_snapshot(&settings);
        assert!(!monitor.channels.is_empty());
        assert_eq!(monitor.channels[0].channel, 1);
        assert_eq!(monitor.channels[0].light_name, "Key Left");
        assert_eq!(monitor.channels[0].label, "Dimmer");
        assert_eq!(monitor.channels[0].value, 0);
        assert!(monitor
            .channels
            .iter()
            .any(|channel| channel.label == "CCT" && channel.channel == 2));
        assert!(monitor
            .channels
            .iter()
            .any(|channel| channel.light_name == "Backline Wash" && channel.label == "±G/M"));
        assert!(monitor
            .channels
            .iter()
            .any(|channel| channel.light_name == "House Practicals" && channel.label == "FX"));
    }

    #[test]
    fn lighting_scene_recall_rejects_until_probe_passes() {
        let test_dir = TestDir::new("scene-rejects");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            )],
        )
        .expect("bridge ip should persist");

        let error = recall_lighting_scene(
            test_dir.db_path().as_path(),
            &LightingSceneRecallRequest {
                scene_id: String::from("scene-prep"),
                fade_duration_seconds: 0.0,
            },
        )
        .expect_err("scene recall should reject");

        match error {
            LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_NOT_VERIFIED"),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn lighting_scene_recall_updates_last_recalled_scene() {
        let test_dir = TestDir::new("scene-ready");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from(LIGHTING_BRIDGE_IP_KEY),
                    String::from("2.0.0.10"),
                ),
                (
                    String::from("app.commissioning.check.lighting.status"),
                    String::from("passed"),
                ),
            ],
        )
        .expect("lighting state should persist");

        let result = recall_lighting_scene(
            test_dir.db_path().as_path(),
            &LightingSceneRecallRequest {
                scene_id: String::from("scene-stream"),
                fade_duration_seconds: 1.5,
            },
        )
        .expect("scene recall should succeed");

        assert!(result.recalled);
        assert_eq!(result.scene_name, "Stream");
        assert_eq!(result.fade_duration_seconds, 1.5);

        let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load");
        let snapshot = read_lighting_snapshot(&settings);
        assert_eq!(
            snapshot.last_recalled_scene_id.as_deref(),
            Some("scene-stream")
        );
        assert!(snapshot
            .scenes
            .iter()
            .any(|entry| entry.id == "scene-stream" && entry.last_recalled));
        assert_eq!(snapshot.last_action_status, "succeeded");
        assert!(snapshot
            .fixtures
            .iter()
            .any(|entry| entry.id == "fixture-key-left" && entry.on && entry.intensity == 90));
    }

    #[test]
    fn lighting_fixture_effect_and_all_power_refresh_snapshot_state() {
        let test_dir = TestDir::new("fixture-update");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from(LIGHTING_BRIDGE_IP_KEY),
                    String::from("2.0.0.10"),
                ),
                (
                    String::from("app.commissioning.check.lighting.status"),
                    String::from("passed"),
                ),
            ],
        )
        .expect("lighting state should persist");

        let updated = update_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureUpdateRequest {
                fixture_id: String::from("fixture-key-left"),
                name: None,
                fixture_type: None,
                dmx_start_address: None,
                effect: Some(Some(LightingEffect {
                    effect_type: String::from("strobe"),
                    speed: 7,
                })),
                on: Some(true),
                intensity: Some(72),
                cct: Some(5100),
                group_id: Some(Some(String::from("group-room"))),
                spatial_x: None,
                spatial_y: None,
                spatial_rotation: None,
                rig_z: None,
                beam_angle_degrees: None,
            },
        )
        .expect("fixture update should succeed");
        assert!(updated.fixture.on);
        assert_eq!(updated.fixture.intensity, 72);
        assert_eq!(updated.fixture.cct, 5100);
        assert_eq!(updated.fixture.group_id.as_deref(), Some("group-room"));
        assert_eq!(
            updated
                .fixture
                .effect
                .as_ref()
                .map(|effect| effect.effect_type.as_str()),
            Some("strobe")
        );

        let power = set_lighting_all_power(
            test_dir.db_path().as_path(),
            &LightingAllPowerRequest { on: false },
        )
        .expect("all power should succeed");
        assert_eq!(power.affected_fixtures, 4);

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert!(snapshot.fixtures.iter().all(|entry| !entry.on));
        assert_eq!(
            snapshot
                .fixtures
                .iter()
                .find(|entry| entry.id == "fixture-key-left")
                .and_then(|entry| entry.effect.as_ref())
                .map(|effect| effect.effect_type.as_str()),
            Some("strobe")
        );
        assert_eq!(snapshot.last_action_status, "succeeded");
    }

    #[test]
    fn lighting_group_crud_updates_fixture_assignments() {
        let test_dir = TestDir::new("group-crud");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            )],
        )
        .expect("lighting state should persist");

        let created = create_lighting_group(
            test_dir.db_path().as_path(),
            &LightingGroupCreateRequest {
                name: String::from("Audience"),
            },
        )
        .expect("group create should succeed");
        assert_eq!(created.group.name, "Audience");

        let reassigned_fixture = update_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureUpdateRequest {
                fixture_id: String::from("fixture-house-practicals"),
                name: None,
                fixture_type: None,
                dmx_start_address: None,
                effect: None,
                on: None,
                intensity: None,
                cct: None,
                group_id: Some(Some(created.group.id.clone())),
                spatial_x: None,
                spatial_y: None,
                spatial_rotation: None,
                rig_z: None,
                beam_angle_degrees: None,
            },
        )
        .expect("fixture reassignment should succeed");
        assert_eq!(
            reassigned_fixture.fixture.group_id.as_deref(),
            Some(created.group.id.as_str())
        );

        let renamed = update_lighting_group(
            test_dir.db_path().as_path(),
            &LightingGroupUpdateRequest {
                group_id: created.group.id.clone(),
                name: String::from("Audience Fill"),
            },
        )
        .expect("group rename should succeed");
        assert_eq!(renamed.group.name, "Audience Fill");
        assert_eq!(renamed.group.fixture_count, 1);

        let deleted = delete_lighting_group(
            test_dir.db_path().as_path(),
            &LightingGroupDeleteRequest {
                group_id: created.group.id.clone(),
            },
        )
        .expect("group delete should succeed");
        assert!(deleted.deleted);

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert!(snapshot
            .groups
            .iter()
            .all(|group| group.id != created.group.id));
        assert_eq!(
            snapshot
                .fixtures
                .iter()
                .find(|fixture| fixture.id == "fixture-house-practicals")
                .and_then(|fixture| fixture.group_id.as_deref()),
            None
        );
    }

    #[test]
    fn lighting_spatial_updates_and_markers_round_trip() {
        let test_dir = TestDir::new("spatial-state");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            )],
        )
        .expect("lighting state should persist");

        let fixture_update = update_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureUpdateRequest {
                fixture_id: String::from("fixture-key-left"),
                name: None,
                fixture_type: None,
                dmx_start_address: None,
                effect: None,
                on: None,
                intensity: None,
                cct: None,
                group_id: None,
                spatial_x: Some(Some(0.62)),
                spatial_y: Some(Some(0.38)),
                spatial_rotation: Some(225.0),
                rig_z: None,
                beam_angle_degrees: None,
            },
        )
        .expect("fixture spatial update should succeed");
        assert_eq!(fixture_update.fixture.spatial_x, Some(0.62));
        assert_eq!(fixture_update.fixture.spatial_y, Some(0.38));
        assert_eq!(fixture_update.fixture.spatial_rotation, 225.0);

        let settings_update = update_lighting_settings(
            test_dir.db_path().as_path(),
            &LightingSettingsUpdateRequest {
                enabled: None,
                bridge_ip: None,
                universe: None,
                grand_master: None,
                selected_scene_id: None,
                selected_fixture_id: Some(Some(String::from("fixture-key-left"))),
                camera_marker: Some(Some(LightingSpatialMarker {
                    x: 0.5,
                    y: 0.82,
                    rotation: 0.0,
                })),
                subject_marker: Some(Some(LightingSpatialMarker {
                    x: 0.5,
                    y: 0.44,
                    rotation: 180.0,
                })),
            },
        )
        .expect("lighting settings update should succeed");
        assert_eq!(
            settings_update.selected_fixture_id.as_deref(),
            Some("fixture-key-left")
        );
        assert!(settings_update.camera_marker.is_some());
        assert!(settings_update.subject_marker.is_some());

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        let fixture = snapshot
            .fixtures
            .iter()
            .find(|fixture| fixture.id == "fixture-key-left")
            .expect("fixture should remain present");
        assert_eq!(fixture.spatial_x, Some(0.62));
        assert_eq!(fixture.spatial_y, Some(0.38));
        assert_eq!(fixture.spatial_rotation, 225.0);
        assert_eq!(
            snapshot.selected_fixture_id.as_deref(),
            Some("fixture-key-left")
        );
        assert_eq!(
            snapshot.camera_marker.as_ref().map(|marker| marker.y),
            Some(0.82)
        );
        assert_eq!(
            snapshot
                .subject_marker
                .as_ref()
                .map(|marker| marker.rotation),
            Some(180.0)
        );
    }

    #[test]
    fn lighting_settings_update_persists_transport_scene_focus_and_grand_master() {
        let test_dir = TestDir::new("lighting-settings");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from(LIGHTING_BRIDGE_IP_KEY),
                    String::from("2.0.0.10"),
                ),
                (
                    String::from(format!(
                        "app.commissioning.check.{LIGHTING_CHECK_ID}.status"
                    )),
                    String::from("passed"),
                ),
            ],
        )
        .expect("lighting state should persist");

        let updated = update_lighting_settings(
            test_dir.db_path().as_path(),
            &LightingSettingsUpdateRequest {
                enabled: Some(false),
                bridge_ip: Some(String::from("2.0.0.20")),
                universe: Some(4),
                grand_master: Some(68),
                selected_scene_id: Some(Some(String::from("scene-stream"))),
                selected_fixture_id: None,
                camera_marker: None,
                subject_marker: None,
            },
        )
        .expect("lighting settings update should succeed");

        assert!(!updated.enabled);
        assert_eq!(updated.bridge_ip, "2.0.0.20");
        assert_eq!(updated.universe, 4);
        assert_eq!(updated.grand_master, 68);
        assert_eq!(updated.selected_scene_id.as_deref(), Some("scene-stream"));

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert_eq!(snapshot.status, "disabled");
        assert!(!snapshot.enabled);
        assert!(!snapshot.connected);
        assert!(!snapshot.reachable);
        assert_eq!(snapshot.bridge_ip, "2.0.0.20");
        assert_eq!(snapshot.universe, 4);
        assert_eq!(snapshot.grand_master, 68);
        assert_eq!(snapshot.fixtures.len(), 4);
        assert_eq!(snapshot.scenes.len(), 3);
        assert_eq!(snapshot.selected_scene_id.as_deref(), Some("scene-stream"));
    }

    #[test]
    fn lighting_fixture_crud_preserves_custom_and_deleted_inventory_state() {
        let test_dir = TestDir::new("fixture-crud");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            )],
        )
        .expect("lighting state should persist");

        let created = create_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureCreateRequest {
                name: String::from("Audience Key"),
                fixture_type: String::from("astra-bicolor"),
                dmx_start_address: 33,
                group_id: Some(String::from("group-room")),
            },
        )
        .expect("fixture create should succeed");
        assert_eq!(created.fixture.fixture_type, "astra-bicolor");
        assert_eq!(created.fixture.dmx_start_address, 33);

        let updated = update_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureUpdateRequest {
                fixture_id: created.fixture.id.clone(),
                name: Some(String::from("Audience Fill")),
                fixture_type: Some(String::from("infinimat")),
                dmx_start_address: Some(41),
                effect: Some(Some(LightingEffect {
                    effect_type: String::from("candle"),
                    speed: 4,
                })),
                on: None,
                intensity: None,
                cct: Some(6100),
                group_id: Some(Some(String::from("group-stage"))),
                spatial_x: None,
                spatial_y: None,
                spatial_rotation: None,
                rig_z: None,
                beam_angle_degrees: None,
            },
        )
        .expect("fixture update should succeed");
        assert_eq!(updated.fixture.name, "Audience Fill");
        assert_eq!(updated.fixture.fixture_type, "infinimat");
        assert_eq!(updated.fixture.dmx_start_address, 41);
        assert_eq!(updated.fixture.group_id.as_deref(), Some("group-stage"));
        assert_eq!(
            updated
                .fixture
                .effect
                .as_ref()
                .map(|effect| effect.effect_type.as_str()),
            Some("candle")
        );

        let deleted = delete_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureDeleteRequest {
                fixture_id: String::from("fixture-key-left"),
            },
        )
        .expect("fixture delete should succeed");
        assert!(deleted.deleted);

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert!(snapshot
            .fixtures
            .iter()
            .all(|fixture| fixture.id != "fixture-key-left"));
        assert!(snapshot
            .fixtures
            .iter()
            .any(|fixture| fixture.id == created.fixture.id && fixture.dmx_start_address == 41));

        let reloaded_state = load_lighting_editor_state(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert!(reloaded_state
            .fixtures
            .iter()
            .all(|fixture| fixture.id != "fixture-key-left"));
        assert!(reloaded_state
            .fixtures
            .iter()
            .any(|fixture| fixture.id == created.fixture.id));
    }

    #[test]
    fn lighting_scene_crud_uses_shared_editor_state() {
        let test_dir = TestDir::new("scene-crud");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            )],
        )
        .expect("lighting state should persist");

        update_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureUpdateRequest {
                fixture_id: String::from("fixture-key-left"),
                name: None,
                fixture_type: None,
                dmx_start_address: None,
                effect: None,
                on: Some(true),
                intensity: Some(61),
                cct: Some(4900),
                group_id: None,
                spatial_x: None,
                spatial_y: None,
                spatial_rotation: None,
                rig_z: None,
                beam_angle_degrees: None,
            },
        )
        .expect("fixture update should succeed");

        let created = create_lighting_scene(
            test_dir.db_path().as_path(),
            &LightingSceneCreateRequest {
                name: String::from("Cue A"),
            },
        )
        .expect("scene create should succeed");
        assert_eq!(created.scene.name, "Cue A");

        let renamed = update_lighting_scene(
            test_dir.db_path().as_path(),
            &LightingSceneUpdateRequest {
                scene_id: created.scene.id.clone(),
                name: Some(String::from("Cue B")),
                capture_current_state: true,
            },
        )
        .expect("scene update should succeed");
        assert_eq!(renamed.scene.name, "Cue B");

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert!(snapshot.scenes.iter().any(|scene| scene.name == "Cue B"));

        let deleted = delete_lighting_scene(
            test_dir.db_path().as_path(),
            &LightingSceneDeleteRequest {
                scene_id: created.scene.id.clone(),
            },
        )
        .expect("scene delete should succeed");
        assert!(deleted.deleted);

        let final_snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert!(final_snapshot
            .scenes
            .iter()
            .all(|scene| scene.id != created.scene.id));
    }

    #[test]
    fn lighting_cue_crud_round_trip_persists_through_snapshot() {
        let test_dir = TestDir::new("cue-crud");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from(LIGHTING_BRIDGE_IP_KEY),
                    String::from("2.0.0.10"),
                ),
                (
                    String::from("app.commissioning.check.lighting.status"),
                    String::from("passed"),
                ),
            ],
        )
        .expect("lighting state should persist");

        let scene = create_lighting_scene(
            test_dir.db_path().as_path(),
            &LightingSceneCreateRequest {
                name: String::from("Open on Host"),
            },
        )
        .expect("scene create should succeed");

        let first = create_lighting_cue(
            test_dir.db_path().as_path(),
            &LightingCueCreateRequest {
                label: String::from("Cue 1 — Opening"),
                after_cue_id: None,
                scene_id: Some(scene.scene.id.clone()),
                fade_in_ms: Some(1500),
                fade_out_ms: Some(1500),
                follow_seconds: Some(Some(4.0)),
                notes: Some(Some(String::from("hold for applause"))),
            },
        )
        .expect("first cue create should succeed");
        assert_eq!(first.cue.ordinal, 1);
        assert_eq!(first.cue.state, "pending");

        let second = create_lighting_cue(
            test_dir.db_path().as_path(),
            &LightingCueCreateRequest {
                label: String::from("Cue 2 — Interview"),
                after_cue_id: None,
                scene_id: None,
                fade_in_ms: None,
                fade_out_ms: None,
                follow_seconds: None,
                notes: None,
            },
        )
        .expect("second cue create should succeed");
        assert_eq!(second.cue.ordinal, 2);

        let relabeled = update_lighting_cue(
            test_dir.db_path().as_path(),
            &LightingCueUpdateRequest {
                cue_id: first.cue.id.clone(),
                label: Some(String::from("Cue 1 — Walk On")),
                scene_id: None,
                fade_in_ms: None,
                fade_out_ms: None,
                follow_seconds: Some(None),
                notes: Some(None),
                ordinal: Some(2),
            },
        )
        .expect("cue update should succeed");
        assert_eq!(relabeled.cue.label, "Cue 1 — Walk On");
        assert_eq!(relabeled.cue.follow_seconds, None);
        assert_eq!(relabeled.cue.notes, None);
        assert_eq!(relabeled.cue.ordinal, 2);

        let fired = fire_lighting_cue(
            test_dir.db_path().as_path(),
            &LightingCueFireRequest {
                cue_id: relabeled.cue.id.clone(),
                fade_override_ms: Some(500),
            },
        )
        .expect("cue fire should succeed");
        assert_eq!(fired.active_cue_id, relabeled.cue.id);
        assert_eq!(fired.applied_fade_ms, 500);

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert_eq!(snapshot.cues.len(), 2);
        assert_eq!(snapshot.active_cue_id.as_deref(), Some(relabeled.cue.id.as_str()));
        let active_cue = snapshot
            .cues
            .iter()
            .find(|cue| cue.id == relabeled.cue.id)
            .expect("fired cue should appear in snapshot");
        assert_eq!(active_cue.state, "active");

        let deleted = delete_lighting_cue(
            test_dir.db_path().as_path(),
            &LightingCueDeleteRequest {
                cue_id: relabeled.cue.id.clone(),
            },
        )
        .expect("cue delete should succeed");
        assert!(deleted.deleted);

        let final_snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        assert_eq!(final_snapshot.cues.len(), 1);
        assert!(final_snapshot.active_cue_id.is_none());
        assert_eq!(final_snapshot.cues[0].ordinal, 1);
    }

    #[test]
    fn lighting_cue_create_rejects_missing_scene() {
        let test_dir = TestDir::new("cue-missing-scene");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            )],
        )
        .expect("lighting state should persist");

        let result = create_lighting_cue(
            test_dir.db_path().as_path(),
            &LightingCueCreateRequest {
                label: String::from("Orphan Cue"),
                after_cue_id: None,
                scene_id: Some(String::from("scene-does-not-exist")),
                fade_in_ms: None,
                fade_out_ms: None,
                follow_seconds: None,
                notes: None,
            },
        );
        match result {
            Err(LightingCommandError::Rejected(code, _)) => {
                assert_eq!(code, "LIGHTING_SCENE_NOT_FOUND");
            }
            other => panic!("expected LIGHTING_SCENE_NOT_FOUND, got {:?}", other),
        }
    }

    #[test]
    fn lighting_fixture_rig_z_and_beam_angle_round_trip() {
        let test_dir = TestDir::new("fixture-rig-beam");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[(
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            )],
        )
        .expect("lighting state should persist");

        let updated = update_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureUpdateRequest {
                fixture_id: String::from("fixture-key-left"),
                name: None,
                fixture_type: None,
                dmx_start_address: None,
                effect: None,
                on: None,
                intensity: None,
                cct: None,
                group_id: None,
                spatial_x: None,
                spatial_y: None,
                spatial_rotation: None,
                rig_z: Some(Some(4.5)),
                beam_angle_degrees: Some(Some(36.0)),
            },
        )
        .expect("fixture update should succeed");
        assert_eq!(updated.fixture.rig_z, Some(4.5));
        assert_eq!(updated.fixture.beam_angle_degrees, Some(36.0));

        let snapshot = read_lighting_snapshot(
            &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load"),
        );
        let fixture = snapshot
            .fixtures
            .iter()
            .find(|fixture| fixture.id == "fixture-key-left")
            .expect("fixture should round-trip through snapshot");
        assert_eq!(fixture.rig_z, Some(4.5));
        assert_eq!(fixture.beam_angle_degrees, Some(36.0));

        let cleared = update_lighting_fixture(
            test_dir.db_path().as_path(),
            &LightingFixtureUpdateRequest {
                fixture_id: String::from("fixture-key-left"),
                name: None,
                fixture_type: None,
                dmx_start_address: None,
                effect: None,
                on: None,
                intensity: None,
                cct: None,
                group_id: None,
                spatial_x: None,
                spatial_y: None,
                spatial_rotation: None,
                rig_z: Some(None),
                beam_angle_degrees: Some(None),
            },
        )
        .expect("fixture clear should succeed");
        assert_eq!(cleared.fixture.rig_z, None);
        assert_eq!(cleared.fixture.beam_angle_degrees, None);
    }
}
