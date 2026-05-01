use serde::Deserialize;
use std::path::Path;

use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_UNIVERSE_KEY};
use crate::lighting_backend::{read_default_lighting_inventory, LightingBackendConfig};

use super::editor_state::*;
use super::helpers::*;
use super::types::*;
use super::*;

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
                        speed: clamp_i64(
                            fixture
                                .effect
                                .as_ref()
                                .map(|effect| effect.speed)
                                .unwrap_or(1),
                            1,
                            10,
                        ),
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
            color_index: None,
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
            color_index: None,
        })
        .collect::<Vec<_>>();

    let scene_order = scene_states.iter().map(|scene| scene.id.clone()).collect();
    let group_order = group_states.iter().map(|group| group.id.clone()).collect();
    let editor_state = LightingEditorState {
        groups: group_states,
        removed_fixture_ids,
        fixtures: fixture_states.clone(),
        scenes: scene_states,
        scene_order,
        pinned_scene_ids: Vec::new(),
        group_order,
        active_fade: None,
    };

    let selected_fixture_id = wire
        .lighting_settings
        .selected_light_id
        .filter(|fixture_id| {
            fixture_states
                .iter()
                .any(|fixture| fixture.id == *fixture_id)
        });
    let selected_scene_id = wire.lighting_settings.selected_scene_id.filter(|scene_id| {
        editor_state
            .scenes
            .iter()
            .any(|scene| scene.id == *scene_id)
    });

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
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            String::new(),
        ),
    ]);

    persist_lighting_state(db_path, &updates)
}
