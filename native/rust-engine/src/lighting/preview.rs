use std::collections::HashMap;
use std::path::Path;

use super::editor_state::*;
use super::fade::apply_active_fade_sample;
use super::helpers::*;
use super::identify::current_unix_ms;
use super::types::*;
use super::*;

#[derive(Debug, Clone, Default)]
pub struct LightingPreviewRuntimeState {
    pub enabled: bool,
    pub target_scene_id: Option<String>,
    pub dirty: bool,
    pub fixture_states: HashMap<String, LightingEditorSceneFixtureState>,
}

impl LightingPreviewRuntimeState {
    fn enable_from_editor_state(
        &mut self,
        editor_state: &LightingEditorState,
        target_scene_id: Option<String>,
    ) {
        self.enabled = true;
        self.target_scene_id = target_scene_id;
        self.dirty = false;
        self.fixture_states = capture_scene_fixture_states(&editor_state.fixtures)
            .into_iter()
            .map(|state| (state.fixture_id.clone(), state))
            .collect();
    }

    fn load_scene(&mut self, scene: &LightingEditorSceneState) {
        self.enabled = true;
        self.target_scene_id = Some(scene.id.clone());
        self.dirty = false;
        self.fixture_states = scene
            .fixture_states
            .iter()
            .cloned()
            .map(|state| (state.fixture_id.clone(), state))
            .collect();
    }

    fn clear(&mut self) {
        self.enabled = false;
        self.target_scene_id = None;
        self.dirty = false;
        self.fixture_states.clear();
    }

    fn scene_fixture_states(
        &self,
        fixtures: &[LightingEditorFixtureState],
    ) -> Vec<LightingEditorSceneFixtureState> {
        fixtures
            .iter()
            .map(|fixture| {
                self.fixture_states
                    .get(fixture.id.as_str())
                    .cloned()
                    .unwrap_or_else(|| LightingEditorSceneFixtureState {
                        fixture_id: fixture.id.clone(),
                        intensity: clamp_i64(fixture.intensity, 0, 100),
                        cct: fixture.cct,
                        on: fixture.on,
                        control_values: effective_fixture_control_values(fixture),
                    })
            })
            .collect()
    }
}

pub fn read_lighting_snapshot_with_preview(
    settings: &HashMap<String, String>,
    preview: &LightingPreviewRuntimeState,
) -> LightingSnapshot {
    let mut snapshot = read_lighting_snapshot(settings);
    if !preview.enabled {
        return snapshot;
    }

    snapshot.preview_mode = true;
    snapshot.preview_dirty = preview.dirty;
    snapshot.preview_scene_id = preview.target_scene_id.clone();
    snapshot.preview_fixtures = snapshot
        .fixtures
        .iter()
        .cloned()
        .map(|mut fixture| {
            if let Some(preview_state) = preview.fixture_states.get(fixture.id.as_str()) {
                fixture.intensity = clamp_i64(preview_state.intensity, 0, 100);
                fixture.cct = preview_state.cct;
                fixture.on = preview_state.on;
                fixture.control_values = preview_state.control_values.clone();
            }
            fixture
        })
        .collect();
    snapshot
}

pub fn set_lighting_preview_mode(
    db_path: &Path,
    request: &LightingPreviewModeRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingPreviewModeResult, LightingCommandError> {
    if request.enabled && request.patch_mode_active {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PREVIEW_PATCH_MODE_CONFLICT",
            String::from("Exit patch mode before enabling lighting preview mode."),
        ));
    }

    if request.enabled {
        let app_settings = load_lighting_settings(db_path)?;
        let mut editor_state = load_lighting_editor_state(&app_settings);
        apply_active_fade_sample(&mut editor_state, current_unix_ms());
        let target_scene_id =
            read_optional_setting(&app_settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY);
        preview.enable_from_editor_state(&editor_state, target_scene_id);
        Ok(LightingPreviewModeResult {
            enabled: true,
            dirty: false,
            preview_scene_id: preview.target_scene_id.clone(),
            summary: String::from("Lighting preview mode enabled."),
        })
    } else {
        preview.clear();
        Ok(LightingPreviewModeResult {
            enabled: false,
            dirty: false,
            preview_scene_id: None,
            summary: String::from("Lighting preview mode disabled."),
        })
    }
}

pub fn discard_lighting_preview(
    _db_path: &Path,
    _request: &LightingPreviewDiscardRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingPreviewDiscardResult, LightingCommandError> {
    preview.clear();
    Ok(LightingPreviewDiscardResult {
        discarded: true,
        summary: String::from("Lighting preview edits discarded."),
    })
}

pub fn update_lighting_fixture_with_preview(
    db_path: &Path,
    request: &LightingFixtureUpdateRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingFixtureUpdateResult, LightingCommandError> {
    if !preview.enabled {
        return update_lighting_fixture(db_path, request);
    }

    reject_preview_structural_fixture_update(request)?;
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    let fixture = editor_state
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
    let preview_state = preview
        .fixture_states
        .entry(fixture.id.clone())
        .or_insert_with(|| LightingEditorSceneFixtureState {
            fixture_id: fixture.id.clone(),
            intensity: clamp_i64(fixture.intensity, 0, 100),
            cct: fixture.cct,
            on: fixture.on,
            control_values: effective_fixture_control_values(&fixture),
        });
    if let Some(on) = request.on {
        preview_state.on = on;
    }
    if let Some(intensity) = request.intensity {
        preview_state.intensity = clamp_i64(intensity, 0, 100);
    }
    if let Some(cct) = request.cct {
        let default_cct = default_fixture_cct_for_type(&fixture.fixture_type);
        preview_state.cct = clamp_cct_for_type(cct, &fixture.fixture_type, default_cct);
    }
    if let Some(control_values) = &request.control_values {
        let profile = fixture_profile_for_state(&fixture);
        preview_state.control_values = normalize_fixture_control_values(&profile, control_values);
    }
    preview.dirty = true;

    let updated_fixture = preview_fixture_from_state(&fixture, preview_state);
    let summary = format!(
        "Lighting preview fixture '{}' staged as {} at {}% / {}K.",
        updated_fixture.name,
        if updated_fixture.on { "on" } else { "off" },
        updated_fixture.intensity,
        updated_fixture.cct
    );
    Ok(LightingFixtureUpdateResult {
        fixture: updated_fixture,
        source: String::from("preview"),
        summary,
    })
}

pub fn set_lighting_group_power_with_preview(
    db_path: &Path,
    request: &LightingGroupPowerRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingGroupPowerResult, LightingCommandError> {
    if !preview.enabled {
        return set_lighting_group_power(db_path, request);
    }

    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    let group = editor_state
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
    let mut affected_fixtures = 0usize;
    for fixture in &editor_state.fixtures {
        if fixture.group_id.as_deref() != Some(group.id.as_str()) {
            continue;
        }
        let preview_state = preview
            .fixture_states
            .entry(fixture.id.clone())
            .or_insert_with(|| LightingEditorSceneFixtureState {
                fixture_id: fixture.id.clone(),
                intensity: clamp_i64(fixture.intensity, 0, 100),
                cct: fixture.cct,
                on: fixture.on,
                control_values: effective_fixture_control_values(fixture),
            });
        preview_state.on = request.on;
        affected_fixtures += 1;
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
    preview.dirty = true;

    Ok(LightingGroupPowerResult {
        group_id: group.id,
        group_name: group.name.clone(),
        affected_fixtures,
        summary: format!(
            "Lighting preview group '{}' staged {} across {} fixtures.",
            group.name,
            if request.on { "on" } else { "off" },
            affected_fixtures
        ),
    })
}

pub fn set_lighting_all_power_with_preview(
    db_path: &Path,
    request: &LightingAllPowerRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingAllPowerResult, LightingCommandError> {
    if !preview.enabled {
        return set_lighting_all_power(db_path, request);
    }

    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    if editor_state.fixtures.is_empty() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_FIXTURES_EMPTY",
            String::from("No lighting fixtures are exposed by the native editor state."),
        ));
    }

    for fixture in &editor_state.fixtures {
        let preview_state = preview
            .fixture_states
            .entry(fixture.id.clone())
            .or_insert_with(|| LightingEditorSceneFixtureState {
                fixture_id: fixture.id.clone(),
                intensity: clamp_i64(fixture.intensity, 0, 100),
                cct: fixture.cct,
                on: fixture.on,
                control_values: effective_fixture_control_values(fixture),
            });
        preview_state.on = request.on;
    }
    preview.dirty = true;

    Ok(LightingAllPowerResult {
        affected_fixtures: editor_state.fixtures.len(),
        summary: format!(
            "All lighting preview fixtures staged {} across {} fixtures.",
            if request.on { "on" } else { "off" },
            editor_state.fixtures.len()
        ),
    })
}

pub fn recall_lighting_scene_with_preview(
    db_path: &Path,
    request: &LightingSceneRecallRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingSceneRecallResult, LightingCommandError> {
    if !preview.enabled {
        return recall_lighting_scene(db_path, request);
    }

    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    let scene = editor_state
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
    preview.load_scene(&scene);

    Ok(LightingSceneRecallResult {
        recalled: true,
        scene_id: request.scene_id.clone(),
        scene_name: scene.name.clone(),
        recalled_at: current_timestamp(db_path)?,
        fade_duration_seconds: 0.0,
        fade_ms: 0,
        preview_mode: true,
        summary: format!("Lighting scene '{}' was loaded into preview.", scene.name),
    })
}

pub fn update_lighting_scene_with_preview(
    db_path: &Path,
    request: &LightingSceneUpdateRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingSceneUpdateResult, LightingCommandError> {
    if !preview.enabled || !request.capture_current_state {
        return update_lighting_scene(db_path, request);
    }

    if let Some(target_scene_id) = preview.target_scene_id.as_deref() {
        if target_scene_id != request.scene_id {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_PREVIEW_SCENE_MISMATCH",
                format!(
                    "Lighting preview is targeting scene '{}' and cannot be saved into '{}'.",
                    target_scene_id, request.scene_id
                ),
            ));
        }
    }

    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let preview_fixture_states = preview.scene_fixture_states(&editor_state.fixtures);
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
        if let Some(color_index) = request.color_index {
            scene.color_index = color_index;
        }
        scene.fixture_states = preview_fixture_states;
        scene.clone()
    };

    let mut updates = lighting_editor_state_updates(&editor_state)?;
    let summary = format!(
        "Lighting scene '{}' saved from preview without changing live output.",
        updated_scene.name
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
    preview.clear();

    let pinned = editor_state
        .pinned_scene_ids
        .iter()
        .any(|id| id == &updated_scene.id);
    Ok(LightingSceneUpdateResult {
        scene: lighting_scene_snapshot_from_state(
            &updated_scene,
            read_optional_setting(&app_settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY).as_deref(),
            read_optional_setting(&app_settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY).as_deref(),
            pinned,
            None,
        ),
        summary,
    })
}

pub fn create_lighting_scene_with_preview(
    db_path: &Path,
    request: &LightingSceneCreateRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingSceneCreateResult, LightingCommandError> {
    if !preview.enabled {
        return create_lighting_scene(db_path, request);
    }

    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    if editor_state.fixtures.is_empty() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_NO_FIXTURES",
            String::from("No lighting fixtures are available for scene creation."),
        ));
    }

    let fixture_states = match &request.fixture_states {
        Some(states) => {
            super::scenes::validated_scene_fixture_states(&editor_state.fixtures, states)?
        }
        None => preview.scene_fixture_states(&editor_state.fixtures),
    };
    let color_index = super::scenes::validated_scene_color_index(request.color_index)?;
    let scene = LightingEditorSceneState {
        id: next_custom_scene_id(&editor_state.scenes),
        name: request.name.clone(),
        fixture_states,
        color_index,
    };
    editor_state.scenes.push(scene.clone());
    editor_state.scene_order.push(scene.id.clone());

    let summary = format!(
        "Lighting scene '{}' was saved from preview without changing live output.",
        scene.name
    );
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_SELECTED_SCENE_ID_KEY),
            scene.id.clone(),
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
    preview.clear();

    Ok(LightingSceneCreateResult {
        scene: lighting_scene_snapshot_from_state(
            &scene,
            read_optional_setting(&app_settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY).as_deref(),
            read_optional_setting(&app_settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY).as_deref(),
            false,
            None,
        ),
        summary,
    })
}

fn reject_preview_structural_fixture_update(
    request: &LightingFixtureUpdateRequest,
) -> Result<(), LightingCommandError> {
    if request.name.is_some()
        || request.fixture_type.is_some()
        || request.definition_id.is_some()
        || request.mode_id.is_some()
        || request.universe.is_some()
        || request.dmx_start_address.is_some()
        || request.effect.is_some()
        || request.group_id.is_some()
        || request.spatial_x.is_some()
        || request.spatial_y.is_some()
        || request.spatial_rotation.is_some()
        || request.rig_z.is_some()
        || request.beam_angle_degrees.is_some()
    {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PREVIEW_UNSUPPORTED_UPDATE",
            String::from(
                "Preview mode only stages fixture output values. Exit preview before changing fixture identity, patch, grouping, or placement.",
            ),
        ));
    }

    Ok(())
}

fn preview_fixture_from_state(
    fixture: &LightingEditorFixtureState,
    preview_state: &LightingEditorSceneFixtureState,
) -> LightingFixtureSnapshot {
    let mut fixture = fixture.clone();
    fixture.intensity = clamp_i64(preview_state.intensity, 0, 100);
    fixture.cct = preview_state.cct;
    fixture.on = preview_state.on;
    lighting_fixture_snapshot_from_state(fixture)
}
