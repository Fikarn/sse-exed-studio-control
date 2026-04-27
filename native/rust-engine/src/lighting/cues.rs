use std::path::Path;

use super::editor_state::*;
use super::helpers::*;
use super::types::*;
use super::*;

pub fn create_lighting_cue(
    db_path: &Path,
    request: &LightingCueCreateRequest,
) -> Result<LightingCueCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    if let Some(scene_id) = &request.scene_id {
        if !editor_state
            .scenes
            .iter()
            .any(|scene| &scene.id == scene_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!("Lighting cue references scene '{scene_id}' but no matching scene exists."),
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
        if !editor_state
            .scenes
            .iter()
            .any(|scene| &scene.id == scene_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!("Lighting cue references scene '{scene_id}' but no matching scene exists."),
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
                format!(
                    "Lighting cue '{}' is not present in the cue stack.",
                    request.cue_id
                ),
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
                format!(
                    "Lighting cue '{}' is not present in the cue stack.",
                    request.cue_id
                ),
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
                format!(
                    "Lighting cue '{}' is not present in the cue stack.",
                    request.cue_id
                ),
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
        (String::from(LIGHTING_ACTIVE_CUE_ID_KEY), target.id.clone()),
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
