use std::path::Path;

use super::editor_state::*;
use super::helpers::*;
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
