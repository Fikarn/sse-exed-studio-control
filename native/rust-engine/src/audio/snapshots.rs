use std::path::Path;

use crate::audio_backend::{read_default_audio_inventory, recall_default_audio_snapshot};

use super::helpers::*;
use super::types::*;
use super::*;

pub fn recall_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotRecallRequest,
) -> Result<AudioSnapshotRecallResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    ensure_audio_action_allowed(db_path, &snapshot)?;
    let config = resolve_audio_config(&app_settings);
    let mut inventory = read_default_audio_inventory(&config);
    inventory.snapshots =
        read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let recalled_at = current_timestamp(db_path)?;

    let outcome = recall_default_audio_snapshot(&config, &inventory, &request.snapshot_id)
        .map_err(|message| {
            let code = if message.contains("not exposed by the backend") {
                "AUDIO_SNAPSHOT_NOT_FOUND"
            } else {
                "AUDIO_SNAPSHOT_RECALL_FAILED"
            };
            let _ = record_audio_action_failure(db_path, code, &message);
            AudioCommandError::Rejected(code, message)
        })?;

    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
                String::from("assumed"),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                String::from("snapshot"),
            ),
            (
                String::from(AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY),
                request.snapshot_id.clone(),
            ),
            (
                String::from(AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY),
                recalled_at.clone(),
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                outcome.summary.clone(),
            ),
        ],
    )?;

    Ok(AudioSnapshotRecallResult {
        recalled: true,
        snapshot_id: request.snapshot_id.clone(),
        snapshot_name: outcome.snapshot_name,
        recalled_at,
        summary: outcome.summary,
        console_state_confidence: String::from("assumed"),
    })
}

pub fn create_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotCreateRequest,
) -> Result<AudioSnapshotCreateResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let mut snapshots = read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let snapshot = AudioSceneSnapshot {
        id: next_custom_audio_snapshot_id(&snapshots),
        name: request.name.clone(),
        osc_index: request.osc_index,
        order: snapshots.len() as i64,
        last_recalled: false,
        last_recalled_at: None,
    };
    snapshots.push(snapshot.clone());
    reindex_audio_snapshots(&mut snapshots);

    let summary = format!(
        "Audio snapshot '{}' was created on slot {}.",
        snapshot.name,
        snapshot.osc_index + 1
    );
    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_SNAPSHOTS_STATE_KEY),
                serialize_audio_snapshot_state(snapshots.as_slice())?,
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
        ],
    )?;

    Ok(AudioSnapshotCreateResult { snapshot, summary })
}

pub fn update_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotUpdateRequest,
) -> Result<AudioSnapshotUpdateResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let mut snapshots = read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let updated_snapshot = {
        let snapshot = snapshots
            .iter_mut()
            .find(|snapshot| snapshot.id == request.snapshot_id)
            .ok_or_else(|| {
                AudioCommandError::Rejected(
                    "AUDIO_SNAPSHOT_NOT_FOUND",
                    format!(
                        "Audio snapshot '{}' is not exposed by the native engine.",
                        request.snapshot_id
                    ),
                )
            })?;
        if let Some(name) = &request.name {
            snapshot.name = name.clone();
        }
        if let Some(osc_index) = request.osc_index {
            snapshot.osc_index = osc_index;
        }
        snapshot.clone()
    };
    reindex_audio_snapshots(&mut snapshots);

    let mut summary_parts = Vec::new();
    if request.name.is_some() {
        summary_parts.push(format!("name -> {}", updated_snapshot.name));
    }
    if request.osc_index.is_some() {
        summary_parts.push(format!("slot -> {}", updated_snapshot.osc_index + 1));
    }
    let summary = format!(
        "Audio snapshot '{}' updated: {}.",
        updated_snapshot.name,
        summary_parts.join(", ")
    );
    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_SNAPSHOTS_STATE_KEY),
                serialize_audio_snapshot_state(snapshots.as_slice())?,
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
        ],
    )?;

    Ok(AudioSnapshotUpdateResult {
        snapshot: updated_snapshot,
        summary,
    })
}

pub fn delete_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotDeleteRequest,
) -> Result<AudioSnapshotDeleteResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let mut snapshots = read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let deleted_snapshot = snapshots
        .iter()
        .find(|snapshot| snapshot.id == request.snapshot_id)
        .cloned()
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_SNAPSHOT_NOT_FOUND",
                format!(
                    "Audio snapshot '{}' is not exposed by the native engine.",
                    request.snapshot_id
                ),
            )
        })?;
    let clear_last_recalled =
        read_optional_setting(&app_settings, AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY).as_deref()
            == Some(request.snapshot_id.as_str());

    snapshots.retain(|snapshot| snapshot.id != request.snapshot_id);
    reindex_audio_snapshots(&mut snapshots);

    let summary = format!("Audio snapshot '{}' was deleted.", deleted_snapshot.name);
    let mut updates = vec![
        (
            String::from(AUDIO_SNAPSHOTS_STATE_KEY),
            serialize_audio_snapshot_state(snapshots.as_slice())?,
        ),
        (
            String::from(AUDIO_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
        (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
    ];
    if clear_last_recalled {
        updates.push((
            String::from(AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY),
            String::new(),
        ));
        updates.push((
            String::from(AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY),
            String::new(),
        ));
    }
    persist_audio_state(db_path, &updates)?;

    Ok(AudioSnapshotDeleteResult {
        deleted: true,
        snapshot_id: request.snapshot_id.clone(),
        summary,
    })
}
