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
    /// Fixture ids the operator has placed under the Highlight overlay.
    /// Empty when Highlight is not active. Surfaced so the frontend can
    /// reflect overlay state in the toolbar after a page reload — the
    /// engine is the source of truth.
    #[serde(rename = "highlightFixtureIds")]
    pub highlight_fixture_ids: Vec<String>,
    /// Fixture ids the operator has placed under the Solo overlay.
    /// Empty when Solo is not active. See `highlight_fixture_ids`.
    #[serde(rename = "soloFixtureIds")]
    pub solo_fixture_ids: Vec<String>,
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
    /// Operator-assigned color tag (Ableton-style). Palette index 0..=7
    /// or `None` for no tag. Drives the GroupChip color accent.
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
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
    /// True when the scene is in the operator's pinned set. Pinned
    /// scenes sort to the top of the rail (snapshot ordering already
    /// reflects this, but the flag drives the rail's visual treatment).
    #[serde(default)]
    pub pinned: bool,
    /// Operator-assigned color tag (Ableton-style). Palette index 0..=7
    /// or `None` for no tag. Frontend renders as a 4 px left accent bar.
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorState {
    #[serde(default)]
    pub groups: Vec<LightingEditorGroupState>,
    #[serde(default)]
    pub removed_fixture_ids: Vec<String>,
    pub fixtures: Vec<LightingEditorFixtureState>,
    pub scenes: Vec<LightingEditorSceneState>,
    /// Display order for scenes. Stores scene ids; the snapshot emits
    /// scenes in this order. Empty on legacy state — populated from
    /// insertion order at load time (see `load_lighting_editor_state`).
    /// Reordered via the `lighting.scene.reorder` IPC; create / delete
    /// keep the vec in sync. Pinned scenes (#56) are tracked separately
    /// via `pinned_scene_ids` so reorder stays orthogonal to favourites.
    #[serde(default, rename = "sceneOrder")]
    pub scene_order: Vec<String>,
    /// Ids of scenes the operator has pinned to the top of the rail.
    /// Empty for new / legacy state. Maintained alongside scene mutations
    /// so deletes remove stale ids and creates leave new scenes unpinned.
    #[serde(default, rename = "pinnedSceneIds")]
    pub pinned_scene_ids: Vec<String>,
    /// Display order for groups. Mirrors `scene_order`. Empty on legacy
    /// state — populated from groups insertion order at load time (see
    /// `normalize_lighting_editor_state`). Reordered via the
    /// `lighting.group.reorder` IPC; create / delete keep the vec in sync.
    #[serde(default, rename = "groupOrder")]
    pub group_order: Vec<String>,
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
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
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
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorSceneFixtureState {
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    pub intensity: i64,
    pub cct: i64,
    pub on: bool,
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
pub struct LightingSceneReorderResult {
    #[serde(rename = "sceneId")]
    pub scene_id: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingGroupReorderResult {
    #[serde(rename = "groupId")]
    pub group_id: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingScenePinResult {
    pub scene: LightingSceneSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct LightingFixtureIdentifyResult {
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    pub summary: String,
}

/// Persistent record of an in-flight identify burst. Stored under
/// `app.lighting.identify_bursts` as a JSON map keyed by fixture id.
/// Bursts may be scheduled into the future via `started_at_ms` so the
/// `lighting.fixture.identifySequence` IPC can pre-write a staggered
/// run that the snapshot reader activates as time advances.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentifyBurst {
    #[serde(rename = "startedAtMs")]
    pub started_at_ms: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
}

/// Highlight / Solo overlay mode. `Off` clears whichever state is
/// currently active (highlight or solo); setting `Highlight` or `Solo`
/// while the opposite is active is rejected by the engine with
/// `LIGHTING_HIGHLIGHT_SOLO_CONFLICT`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixtureHighlightMode {
    Highlight,
    Solo,
    Off,
}

#[derive(Debug, Clone)]
pub struct LightingFixtureHighlightRequest {
    pub fixture_ids: Vec<String>,
    pub mode: FixtureHighlightMode,
}

#[derive(Debug, Serialize)]
pub struct LightingFixtureHighlightResult {
    pub mode: String,
    #[serde(rename = "fixtureCount")]
    pub fixture_count: usize,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct LightingFixtureIdentifySequenceRequest {
    pub fixture_ids: Vec<String>,
    pub step_ms: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct LightingFixtureIdentifySequenceResult {
    #[serde(rename = "fixtureCount")]
    pub fixture_count: usize,
    #[serde(rename = "stepMs")]
    pub step_ms: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    #[serde(rename = "totalDurationMs")]
    pub total_duration_ms: i64,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct LightingFixtureIdentifyClearAllRequest;

#[derive(Debug, Serialize)]
pub struct LightingFixtureIdentifyClearAllResult {
    #[serde(rename = "clearedCount")]
    pub cleared_count: usize,
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
pub struct LightingFixtureIdentifyRequest {
    pub fixture_id: String,
    pub duration_ms: Option<i64>,
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
    pub name: Option<String>,
    /// Outer `Option`: was the field supplied. Inner `Option<u8>`: the
    /// new value (None = clear, Some(idx) = set to palette index 0..=7).
    pub color_index: Option<Option<u8>>,
}

/// Reorder a group by moving it before another group id, or to the end
/// of the list when `before_group_id` is `None`. Mirrors the scene
/// reorder shape so the GroupRail dnd-kit consumer can lift the
/// SceneRail pattern verbatim.
#[derive(Debug, Clone)]
pub struct LightingGroupReorderRequest {
    pub group_id: String,
    pub before_group_id: Option<String>,
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
    /// Outer `Option`: was the field supplied. Inner `Option<u8>`: the
    /// new value (None = clear, Some(idx) = set to palette index 0..=7).
    pub color_index: Option<Option<u8>>,
}

#[derive(Debug, Clone)]
pub struct LightingSceneDeleteRequest {
    pub scene_id: String,
}

/// Reorder a scene by moving it before another scene id, or to the
/// end of the list when `before_scene_id` is `None`. Pinned scenes are
/// reordered within the pinned cluster — moving a pinned scene to the
/// "end" places it last among pinned scenes (still ahead of unpinned).
#[derive(Debug, Clone)]
pub struct LightingSceneReorderRequest {
    pub scene_id: String,
    pub before_scene_id: Option<String>,
}

/// Toggle a scene's pinned status. Pinned scenes float to the top of
/// the rail; unpinning moves the scene back to its position in
/// `scene_order` among the unpinned cluster.
#[derive(Debug, Clone)]
pub struct LightingScenePinRequest {
    pub scene_id: String,
    pub pinned: bool,
}
