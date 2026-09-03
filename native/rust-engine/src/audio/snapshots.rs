use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use crate::audio_backend::read_default_audio_inventory;
use crate::rme_console_link::{shared_console_link, PushProgress};
use crate::rme_totalmix_osc::{send_totalmix_recall_plan, SIMULATED_AUDIO_SOURCE};

use super::helpers::*;
use super::recall::{build_recall_plan, recalled_state_maps};
use super::types::*;
use super::*;

pub fn recall_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotRecallRequest,
) -> Result<AudioSnapshotRecallResult, AudioCommandError> {
    recall_audio_snapshot_with_timing(db_path, request, PushTiming::default())
}

/// Recall = push (Slice 4). App state is written first and marked `assumed`;
/// the console link's read-backs decide whether it becomes `aligned`.
pub fn recall_audio_snapshot_with_timing(
    db_path: &Path,
    request: &AudioSnapshotRecallRequest,
    timing: PushTiming,
) -> Result<AudioSnapshotRecallResult, AudioCommandError> {
    let (config, recalled_snapshot, current, recalled_at) = {
        let _state_guard = lock_audio_state();
        let app_settings = load_audio_settings(db_path)?;
        let snapshot = read_audio_snapshot(&app_settings);
        ensure_audio_action_allowed(db_path, &snapshot)?;
        let config = resolve_audio_config(&app_settings);
        let mut inventory = read_default_audio_inventory(&config);
        inventory.snapshots =
            read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
        let recalled_snapshot = inventory
            .snapshots
            .iter()
            .find(|entry| entry.id == request.snapshot_id)
            .cloned()
            .ok_or_else(|| {
                let message = format!(
                    "Audio snapshot '{}' is not exposed by the native engine.",
                    request.snapshot_id
                );
                let _ = record_audio_action_failure(db_path, "AUDIO_SNAPSHOT_NOT_FOUND", &message);
                AudioCommandError::Rejected("AUDIO_SNAPSHOT_NOT_FOUND", message)
            })?;
        let recalled_at = current_timestamp(db_path)?;
        (config, recalled_snapshot, snapshot, recalled_at)
    };
    let simulated = config.metering_source == SIMULATED_AUDIO_SOURCE;
    let markers = |summary: &str| {
        vec![
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
                String::from(summary),
            ),
        ]
    };
    let result = |summary: String,
                  confidence: &str,
                  progress: Option<&PushProgress>,
                  pushed: usize,
                  phantom_differences: Vec<PhantomDifference>| {
        AudioSnapshotRecallResult {
            recalled: true,
            snapshot_id: request.snapshot_id.clone(),
            snapshot_name: recalled_snapshot.name.clone(),
            recalled_at: recalled_at.clone(),
            summary,
            console_state_confidence: String::from(confidence),
            pushed: pushed as i64,
            confirmed: progress.map(|p| p.confirmed as i64).unwrap_or(0),
            adjusted: progress.map(|p| p.adjusted as i64).unwrap_or(0),
            unconfirmed: progress
                .map(|p| (p.unconfirmed + p.pending) as i64)
                .unwrap_or(0),
            phantom_differences,
        }
    };

    let Some(contents) = recalled_snapshot.contents.clone() else {
        // Nothing was captured: only the markers move; the console is untouched.
        let summary = format!(
            "Recalled {}: the snapshot has no captured console state, nothing was pushed.",
            recalled_snapshot.name
        );
        let _state_guard = lock_audio_state();
        let mut writes = markers(&summary);
        writes.push((
            String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
            String::from("snapshot"),
        ));
        persist_audio_state(db_path, &writes)?;
        let confidence = current.console_state_confidence.clone();
        return Ok(result(summary, &confidence, None, 0, Vec::new()));
    };

    let plan = build_recall_plan(&current, &contents);
    let (channels_state, mix_targets_state) = recalled_state_maps(&current, &contents);
    let phantom_note = if plan.phantom_differences.is_empty() {
        String::new()
    } else {
        format!(
            " · 48V differs on {}",
            plan.phantom_differences
                .iter()
                .map(|difference| difference.channel_name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    // 1. App state follows the snapshot (48V / talkback keep the console's
    //    values) and is honest about it: assumed until the console confirms.
    {
        let _state_guard = lock_audio_state();
        let preliminary = if simulated {
            format!(
                "Recalled {} on the simulated console (mirrors the app){phantom_note}.",
                recalled_snapshot.name
            )
        } else {
            format!(
                "Recalled {}: pushing {} values to TotalMix{phantom_note}.",
                recalled_snapshot.name,
                plan.message_count()
            )
        };
        let mut writes = markers(&preliminary);
        writes.push((
            String::from(AUDIO_CHANNEL_STATE_KEY),
            serialize_json_state(&channels_state)?,
        ));
        writes.push((
            String::from(AUDIO_MIX_TARGET_STATE_KEY),
            serialize_json_state(&mix_targets_state)?,
        ));
        writes.push((
            String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
            String::from("snapshot"),
        ));
        writes.push(confidence_setting(if simulated {
            ConsoleConfidence::Aligned
        } else {
            ConsoleConfidence::Assumed
        }));
        persist_audio_state(db_path, &writes)?;
        if simulated {
            return Ok(result(
                preliminary,
                "aligned",
                None,
                0,
                plan.phantom_differences.clone(),
            ));
        }
    }

    // 2. Push, phase by phase, tracked on the console link.
    let link = shared_console_link();
    if let Ok(mut guard) = link.lock() {
        guard.begin_push(plan.keys.clone());
    }
    let pushed = match send_totalmix_recall_plan(&config.send_host, config.send_port, &plan.phases)
    {
        Ok(pushed) => pushed,
        Err(message) => {
            if let Ok(mut guard) = link.lock() {
                guard.finish_push();
            }
            let _ = record_audio_action_failure(db_path, "AUDIO_SNAPSHOT_RECALL_FAILED", &message);
            return Err(AudioCommandError::Rejected(
                "AUDIO_SNAPSHOT_RECALL_FAILED",
                message,
            ));
        }
    };

    // 3. Wait for the read-backs (the metering thread ingests and expires).
    let started = Instant::now();
    let wait = Duration::from_millis(timing.confirm_wait_ms);
    loop {
        thread::sleep(Duration::from_millis(timing.poll_ms.max(1)));
        let pending = link
            .lock()
            .ok()
            .and_then(|guard| guard.push_progress())
            .map(|progress| progress.pending)
            .unwrap_or(0);
        if pending == 0 || started.elapsed() >= wait {
            break;
        }
    }
    let progress = link
        .lock()
        .ok()
        .and_then(|mut guard| guard.finish_push())
        .unwrap_or(PushProgress {
            total: plan.keys.len(),
            confirmed: 0,
            adjusted: 0,
            unconfirmed: 0,
            pending: plan.keys.len(),
            unconfirmed_names: Vec::new(),
            adjusted_names: Vec::new(),
        });
    // Adjusted values and expiries land in the database now.
    flush_console_link(db_path)?;

    // 4. Verdict.
    let settled = progress.pending == 0 && progress.unconfirmed == 0;
    let mut summary = format!(
        "Recalled {}: {} values pushed, {} confirmed",
        recalled_snapshot.name, pushed, progress.confirmed
    );
    if progress.adjusted > 0 {
        summary.push_str(&format!(
            " · {} adjusted by the console ({})",
            progress.adjusted,
            progress.adjusted_names.join(", ")
        ));
    }
    if !settled {
        let outstanding = progress.unconfirmed + progress.pending;
        summary.push_str(&format!(
            " · {} unconfirmed ({})",
            outstanding,
            progress.unconfirmed_names.join(", ")
        ));
    }
    summary.push_str(&phantom_note);
    summary.push('.');

    {
        let _state_guard = lock_audio_state();
        if settled {
            persist_audio_state(
                db_path,
                &[
                    confidence_setting(ConsoleConfidence::Aligned),
                    (
                        String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                        String::from("snapshot-push"),
                    ),
                    (
                        String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                        recalled_at.clone(),
                    ),
                    (
                        String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                        String::from("succeeded"),
                    ),
                    (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
                    (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
                ],
            )?;
        } else {
            // Confidence stays assumed (written above); the console link's
            // expiry flush reports the unconfirmed sends as
            // AUDIO_CONSOLE_UNCONFIRMED. Only the operator message moves.
            persist_audio_state(
                db_path,
                &[(String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone())],
            )?;
        }
    }

    Ok(result(
        summary,
        if settled { "aligned" } else { "assumed" },
        Some(&progress),
        pushed,
        plan.phantom_differences,
    ))
}

pub fn create_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotCreateRequest,
) -> Result<AudioSnapshotCreateResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let mut snapshots = read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let contents = if request.capture_current_state.unwrap_or(false) {
        Some(capture_audio_scene_contents(
            &read_audio_snapshot(&app_settings),
            Some(current_timestamp(db_path)?),
        ))
    } else {
        None
    };
    let snapshot = AudioSceneSnapshot {
        id: next_custom_audio_snapshot_id(&snapshots),
        name: request.name.clone(),
        osc_index: request.osc_index,
        order: snapshots.len() as i64,
        last_recalled: false,
        last_recalled_at: None,
        contents,
        preview: AudioScenePreviewSnapshot {
            has_contents: false,
            channel_count: 0,
            mix_target_count: 0,
            changed_channels: Vec::new(),
            changed_mix_targets: Vec::new(),
        },
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
    let captured_contents = if request.capture_current_state.unwrap_or(false) {
        Some(capture_audio_scene_contents(
            &read_audio_snapshot(&app_settings),
            Some(current_timestamp(db_path)?),
        ))
    } else {
        None
    };
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
        if let Some(contents) = captured_contents {
            snapshot.contents = Some(contents);
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
    if request.capture_current_state.unwrap_or(false) {
        summary_parts.push(String::from("contents captured"));
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
