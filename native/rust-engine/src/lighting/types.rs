use serde::{Deserialize, Serialize};
use std::fmt;

use super::DEFAULT_LIGHTING_FIXTURE_TYPE;

pub(super) fn default_fixture_type() -> String {
    String::from(DEFAULT_LIGHTING_FIXTURE_TYPE)
}

pub(super) fn default_fixture_dmx_start_address() -> i64 {
    1
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingGroupSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "fixtureCount")]
    pub fixture_count: usize,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingSceneFixtureSnapshot {
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    pub intensity: i64,
    pub cct: i64,
    pub on: bool,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct LightingDmxMonitorSnapshot {
    pub channels: Vec<LightingDmxChannelSnapshot>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
