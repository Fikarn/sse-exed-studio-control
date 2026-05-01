use std::path::Path;

use super::editor_state::*;
use super::fade::{apply_active_fade_sample, remove_fixture_from_active_fade};
use super::helpers::*;
use super::identify::current_unix_ms;
use super::types::*;
use super::*;

pub fn create_lighting_group(
    db_path: &Path,
    request: &LightingGroupCreateRequest,
) -> Result<LightingGroupCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let group = LightingEditorGroupState {
        id: next_custom_group_id(&editor_state.groups),
        name: request.name.clone(),
        color_index: None,
    };
    editor_state.groups.push(group.clone());
    // Append the new id to group_order so the rail emits the group at
    // the end of the sequence (mirrors create_lighting_scene's
    // scene_order maintenance).
    editor_state.group_order.push(group.id.clone());

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
        if let Some(name) = &request.name {
            group.name = name.clone();
        }
        if let Some(color_index) = request.color_index {
            group.color_index = color_index;
        }
        group.clone()
    };

    let mut parts = Vec::new();
    if request.name.is_some() {
        parts.push("renamed");
    }
    if let Some(color_index) = request.color_index {
        parts.push(if color_index.is_some() {
            "recolored"
        } else {
            "color cleared"
        });
    }
    let summary = if parts.is_empty() {
        format!("Lighting group '{}' was updated.", updated_group.name)
    } else {
        format!(
            "Lighting group '{}' {}.",
            updated_group.name,
            parts.join(" and ")
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
    editor_state
        .group_order
        .retain(|id| id != &request.group_id);
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
    apply_active_fade_sample(&mut editor_state, current_unix_ms());
    let mut affected_fixtures = 0usize;
    let mut affected_fixture_ids = Vec::new();
    for fixture in &mut editor_state.fixtures {
        if fixture.group_id.as_deref() == Some(group.id.as_str()) {
            fixture.on = request.on;
            affected_fixtures += 1;
            affected_fixture_ids.push(fixture.id.clone());
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
    for fixture_id in &affected_fixture_ids {
        remove_fixture_from_active_fade(&mut editor_state, fixture_id);
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

pub fn reorder_lighting_group(
    db_path: &Path,
    request: &LightingGroupReorderRequest,
) -> Result<LightingGroupReorderResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);

    if !editor_state
        .groups
        .iter()
        .any(|group| group.id == request.group_id)
    {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_GROUP_NOT_FOUND",
            format!(
                "Lighting group '{}' is not exposed by the native editor state.",
                request.group_id
            ),
        ));
    }

    if let Some(before_id) = &request.before_group_id {
        if !editor_state
            .groups
            .iter()
            .any(|group| &group.id == before_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_GROUP_NOT_FOUND",
                format!(
                    "Reorder anchor group '{}' is not exposed by the native editor state.",
                    before_id
                ),
            ));
        }
    }

    // Drop the moved id, then insert before the anchor (or push when no
    // anchor is provided — "move to end"). Mirrors reorder_lighting_scene.
    editor_state
        .group_order
        .retain(|id| id != &request.group_id);
    if let Some(before_id) = &request.before_group_id {
        let position = editor_state
            .group_order
            .iter()
            .position(|id| id == before_id);
        match position {
            Some(idx) => editor_state
                .group_order
                .insert(idx, request.group_id.clone()),
            None => editor_state.group_order.push(request.group_id.clone()),
        }
    } else {
        editor_state.group_order.push(request.group_id.clone());
    }

    let summary = format!(
        "Lighting group '{}' was reordered in the rail.",
        request.group_id
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

    Ok(LightingGroupReorderResult {
        group_id: request.group_id.clone(),
        summary,
    })
}
