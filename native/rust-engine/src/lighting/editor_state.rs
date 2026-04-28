use std::collections::HashMap;
use std::path::Path;

use crate::lighting_backend::{
    recall_default_lighting_scene, LightingBackendConfig, LightingBackendInventory,
};

use super::helpers::*;
use super::types::*;
use super::*;

pub fn load_lighting_editor_state(settings: &HashMap<String, String>) -> LightingEditorState {
    let config = resolve_lighting_config(settings);
    let inventory = read_lighting_editor_inventory(&config);
    load_lighting_editor_state_with_inventory(settings, &config, &inventory)
}

pub fn save_lighting_editor_state(
    db_path: &Path,
    state: &LightingEditorState,
) -> Result<(), LightingCommandError> {
    let updates = lighting_editor_state_updates(state)?;
    persist_lighting_state(db_path, &updates)
}

pub(super) fn load_lighting_editor_state_with_inventory(
    settings: &HashMap<String, String>,
    config: &LightingBackendConfig,
    inventory: &LightingBackendInventory,
) -> LightingEditorState {
    settings
        .get(LIGHTING_EDITOR_STATE_KEY)
        .and_then(|value| serde_json::from_str::<LightingEditorState>(value).ok())
        .map(|state| normalize_lighting_editor_state(state, config, inventory))
        .unwrap_or_else(|| default_lighting_editor_state(config, inventory))
}

pub(super) fn default_lighting_editor_state(
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
            intensity: DEFAULT_FIXTURE_INTENSITY,
            cct: DEFAULT_FIXTURE_CCT,
            on: false,
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

pub(super) fn normalize_lighting_editor_state(
    existing: LightingEditorState,
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
    append_missing_fixture_states(&mut fixtures, &removed_fixture_ids, inventory);
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

pub(super) fn default_lighting_group_states(
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

pub(super) fn normalize_lighting_group_states(
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

pub(super) fn append_missing_group_states(
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

pub(super) fn append_missing_fixture_states(
    fixtures: &mut Vec<LightingEditorFixtureState>,
    removed_fixture_ids: &[String],
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
            intensity: DEFAULT_FIXTURE_INTENSITY,
            cct: clamp_cct_for_type(
                DEFAULT_FIXTURE_CCT,
                fixture_type.as_str(),
                inventory_fixture.cct,
            ),
            on: false,
            effect: None,
        });
    }
}

pub(super) fn default_lighting_scene_states(
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

pub(super) fn default_lighting_scene_fixture_states(
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

pub(super) fn lighting_editor_state_updates(
    state: &LightingEditorState,
) -> Result<Vec<(String, String)>, LightingCommandError> {
    let serialized = serde_json::to_string(state)
        .map_err(|error| LightingCommandError::Storage(error.to_string()))?;
    Ok(vec![(String::from(LIGHTING_EDITOR_STATE_KEY), serialized)])
}

pub(super) fn lighting_group_snapshot_from_state(
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

pub(super) fn snapshot_fixtures(
    fixtures: &[LightingEditorFixtureState],
) -> Vec<LightingFixtureSnapshot> {
    fixtures
        .iter()
        .cloned()
        .map(lighting_fixture_snapshot_from_state)
        .collect()
}

pub(super) fn lighting_fixture_snapshot_from_state(
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

pub(super) fn lighting_scene_snapshot_from_state(
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

pub(super) fn capture_scene_fixture_states(
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

pub(super) fn next_custom_scene_id(scenes: &[LightingEditorSceneState]) -> String {
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

pub(super) fn next_custom_group_id(groups: &[LightingEditorGroupState]) -> String {
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

pub(super) fn next_custom_fixture_id(fixtures: &[LightingEditorFixtureState]) -> String {
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
