//! The lighting part of the development parity fixtures: the settings the
//! `lighting-populated` fixture writes, from its bundled payload
//! (`fixtures/parity-lighting-populated.json`). New pages program, Slice 2b:
//! renamed from `legacy_import.rs` when the db.json import was retired. The
//! payload keeps the old db.json's names for its parts but holds nothing
//! else, and every part refuses a field it does not read.

use serde::Deserialize;
use std::collections::HashMap;

use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_UNIVERSE_KEY};
use crate::lighting_backend::{read_default_lighting_inventory, LightingBackendConfig};

use super::editor_state::*;
use super::helpers::*;
use super::types::*;
use super::*;

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ParityLightingPayloadWire {
    #[serde(default)]
    lights: Vec<ParityLightWire>,
    #[serde(default, rename = "lightGroups")]
    light_groups: Vec<ParityLightGroupWire>,
    #[serde(default, rename = "lightScenes")]
    light_scenes: Vec<ParityLightSceneWire>,
    #[serde(default, rename = "lightingSettings")]
    lighting_settings: ParityLightingSettingsWire,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ParityLightWire {
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
    effect: Option<ParityLightEffectWire>,
    #[serde(default, rename = "spatialX")]
    spatial_x: Option<f64>,
    #[serde(default, rename = "spatialY")]
    spatial_y: Option<f64>,
    #[serde(default, rename = "spatialRotation")]
    spatial_rotation: f64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ParityLightGroupWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    order: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ParityLightSceneWire {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    order: i64,
    #[serde(default, rename = "lightStates")]
    light_states: Vec<ParitySceneLightStateWire>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ParitySceneLightStateWire {
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
#[serde(deny_unknown_fields)]
struct ParityLightEffectWire {
    #[serde(default, rename = "type")]
    effect_type: String,
    #[serde(default)]
    speed: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct ParityLightingSettingsWire {
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
    camera_marker: Option<ParitySpatialMarkerWire>,
    #[serde(default, rename = "subjectMarker")]
    subject_marker: Option<ParitySpatialMarkerWire>,
}

/// The camera or subject marker. Its own wire struct, so that it refuses a
/// field it does not read like every other part of the payload: the shared
/// `LightingSpatialMarker` ignores one, and it stays so, because it also
/// reads the markers in the saved settings.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ParitySpatialMarkerWire {
    x: f64,
    y: f64,
    rotation: f64,
}

impl From<ParitySpatialMarkerWire> for LightingSpatialMarker {
    fn from(marker: ParitySpatialMarkerWire) -> Self {
        Self {
            x: marker.x,
            y: marker.y,
            rotation: marker.rotation,
        }
    }
}

/// The lighting settings a parity fixture's payload stands for. Slice 2b:
/// they are returned, not written, so the fixture load writes them in the
/// same transaction as its setup flag, its page and its other settings.
pub fn parity_lighting_settings(
    payload_json: &str,
) -> Result<Vec<(String, String)>, LightingCommandError> {
    let wire = serde_json::from_str::<ParityLightingPayloadWire>(payload_json)
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
            let profile = resolve_fixture_profile(
                None,
                None,
                Some(fixture_type.as_str()),
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
                definition_id: Some(profile.definition_id.clone()),
                mode_id: Some(profile.mode_id.clone()),
                universe: config.universe,
                dmx_start_address: normalize_dmx_start_address(
                    fixture.dmx_start_address,
                    fixture_type.as_str(),
                ),
                kind: profile.kind.clone(),
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
                control_values: HashMap::new(),
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
                        control_values: fixture.control_values.clone(),
                    }
                })
                .collect(),
            color_index: None,
        })
        .collect::<Vec<_>>();

    let scene_order = scene_states.iter().map(|scene| scene.id.clone()).collect();
    let group_order = group_states.iter().map(|group| group.id.clone()).collect();
    let palettes = default_lighting_palette_states();
    let palette_order = palettes.iter().map(|palette| palette.id.clone()).collect();
    let editor_state = LightingEditorState {
        groups: group_states,
        removed_fixture_ids,
        fixtures: fixture_states.clone(),
        scenes: scene_states,
        scene_order,
        pinned_scene_ids: Vec::new(),
        group_order,
        palettes,
        palette_order,
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
            serialize_optional_marker(
                wire.lighting_settings
                    .camera_marker
                    .map(LightingSpatialMarker::from)
                    .as_ref(),
            )?,
        ),
        (
            String::from(LIGHTING_SUBJECT_MARKER_KEY),
            serialize_optional_marker(
                wire.lighting_settings
                    .subject_marker
                    .map(LightingSpatialMarker::from)
                    .as_ref(),
            )?,
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

    Ok(updates)
}

#[cfg(test)]
mod tests {
    use super::{
        parity_lighting_settings, LIGHTING_CAMERA_MARKER_KEY, LIGHTING_SUBJECT_MARKER_KEY,
    };

    // New pages program, Slice 2b: the bundled payload holds only what the
    // fixture load reads. A field no part of it reads — the old db.json's
    // `schemaVersion` and `settings`, a light's colour, a scene's creation
    // time, a marker's height or label — is refused instead of being carried
    // along unread. A marker that holds only what is read is written as it
    // was.
    #[test]
    fn a_field_the_payload_reader_does_not_read_is_refused() {
        assert!(parity_lighting_settings(r#"{ "lights": [{ "id": "light-1" }] }"#).is_ok());
        let updates = parity_lighting_settings(
            r#"{ "lightingSettings": { "cameraMarker": { "x": 0.5, "y": 0.84, "rotation": 0 }, "subjectMarker": { "x": 0.5, "y": 0.46, "rotation": 180 } } }"#,
        )
        .expect("a payload with both markers loads");
        let written = |key: &str| {
            updates
                .iter()
                .find(|(name, _)| name == key)
                .and_then(|(_, value)| serde_json::from_str::<serde_json::Value>(value).ok())
        };
        assert_eq!(
            written(LIGHTING_CAMERA_MARKER_KEY),
            Some(serde_json::json!({ "x": 0.5, "y": 0.84, "rotation": 0.0 }))
        );
        assert_eq!(
            written(LIGHTING_SUBJECT_MARKER_KEY),
            Some(serde_json::json!({ "x": 0.5, "y": 0.46, "rotation": 180.0 }))
        );
        for payload in [
            r#"{ "schemaVersion": 1 }"#,
            r#"{ "settings": { "hasCompletedSetup": true } }"#,
            r#"{ "lights": [{ "id": "light-1", "red": 0 }] }"#,
            r#"{ "lightGroups": [{ "id": "group-key", "colorIndex": 1 }] }"#,
            r#"{ "lightScenes": [{ "id": "scene-1", "createdAt": "2026-04-18T08:00:00.000Z" }] }"#,
            r#"{ "lightScenes": [{ "id": "scene-1", "lightStates": [{ "lightId": "light-1", "gmTint": 0 }] }] }"#,
            r#"{ "lights": [{ "id": "light-1", "effect": { "type": "pulse", "depth": 3 } }] }"#,
            r#"{ "lightingSettings": { "dmxEnabled": false, "sacnPriority": 100 } }"#,
            r#"{ "lightingSettings": { "cameraMarker": { "x": 0.5, "y": 0.84, "rotation": 0, "z": 1 } } }"#,
            r#"{ "lightingSettings": { "subjectMarker": { "x": 0.5, "y": 0.46, "rotation": 180, "label": "Host" } } }"#,
        ] {
            assert!(
                parity_lighting_settings(payload).is_err(),
                "{payload} should be refused"
            );
        }
    }
}
