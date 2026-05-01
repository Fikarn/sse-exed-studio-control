use std::path::Path;

use crate::lighting_backend::read_default_lighting_inventory;

use super::editor_state::*;
use super::helpers::*;
use super::types::*;
use super::*;

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
        color_index: None,
    };
    editor_state.scenes.push(scene.clone());
    // New scenes append to the display order. Pinned scenes float to
    // the top of the rail (snapshot ordering rule), so a fresh scene
    // is not pinned by default; operators can pin via the lighting
    // .scene.pin IPC.
    editor_state.scene_order.push(scene.id.clone());

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
            false,
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
        if let Some(color_index) = request.color_index {
            scene.color_index = color_index;
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
    editor_state
        .scene_order
        .retain(|id| id != &request.scene_id);
    editor_state
        .pinned_scene_ids
        .retain(|id| id != &request.scene_id);

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

pub fn reorder_lighting_scene(
    db_path: &Path,
    request: &LightingSceneReorderRequest,
) -> Result<LightingSceneReorderResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);

    if !editor_state
        .scenes
        .iter()
        .any(|scene| scene.id == request.scene_id)
    {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_SCENE_NOT_FOUND",
            format!(
                "Lighting scene '{}' is not exposed by the native editor state.",
                request.scene_id
            ),
        ));
    }

    if let Some(before_id) = &request.before_scene_id {
        if !editor_state
            .scenes
            .iter()
            .any(|scene| &scene.id == before_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!(
                    "Reorder anchor scene '{}' is not exposed by the native editor state.",
                    before_id
                ),
            ));
        }
    }

    // Drop the moved id, then insert before the anchor (or push when no
    // anchor is provided — "move to end").
    editor_state
        .scene_order
        .retain(|id| id != &request.scene_id);
    if let Some(before_id) = &request.before_scene_id {
        let position = editor_state
            .scene_order
            .iter()
            .position(|id| id == before_id);
        match position {
            Some(idx) => editor_state
                .scene_order
                .insert(idx, request.scene_id.clone()),
            None => editor_state.scene_order.push(request.scene_id.clone()),
        }
    } else {
        editor_state.scene_order.push(request.scene_id.clone());
    }

    let summary = format!(
        "Lighting scene '{}' was reordered in the rail.",
        request.scene_id
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

    Ok(LightingSceneReorderResult {
        scene_id: request.scene_id.clone(),
        summary,
    })
}

pub fn pin_lighting_scene(
    db_path: &Path,
    request: &LightingScenePinRequest,
) -> Result<LightingScenePinResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);

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

    let already_pinned = editor_state
        .pinned_scene_ids
        .iter()
        .any(|id| id == &request.scene_id);
    if request.pinned && !already_pinned {
        editor_state.pinned_scene_ids.push(request.scene_id.clone());
    } else if !request.pinned && already_pinned {
        editor_state
            .pinned_scene_ids
            .retain(|id| id != &request.scene_id);
    }

    let summary = if request.pinned {
        format!("Lighting scene '{}' was pinned.", scene.name)
    } else {
        format!("Lighting scene '{}' was unpinned.", scene.name)
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

    Ok(LightingScenePinResult {
        scene: lighting_scene_snapshot_from_state(
            &scene,
            read_optional_setting(&app_settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY).as_deref(),
            read_optional_setting(&app_settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY).as_deref(),
            request.pinned,
        ),
        summary,
    })
}
