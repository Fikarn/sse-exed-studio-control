use std::path::Path;

use crate::audio_backend::update_default_audio_mix_target;

use super::helpers::*;
use super::types::*;
use super::*;

pub fn update_audio_mix_target(
    db_path: &Path,
    request: &AudioMixTargetUpdateRequest,
) -> Result<AudioMixTargetSnapshot, AudioCommandError> {
    let _state_guard = lock_audio_state();
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    // Every mix-target field (level, mute, dim, mono, talkback) is a console
    // write, so the whole request passes the console gate first.
    ensure_audio_action_allowed(db_path, &snapshot)?;

    let outcome = update_default_audio_mix_target(
        &resolve_audio_config(&app_settings),
        &crate::audio_backend::AudioBackendInventory {
            adapter_mode: snapshot.adapter_mode.clone(),
            channels: snapshot.channels.clone(),
            mix_targets: snapshot.mix_targets.clone(),
            snapshots: snapshot.snapshots.clone(),
        },
        request,
    )
    .map_err(|message| {
        let code = if message.contains("mix target") {
            "AUDIO_MIX_TARGET_NOT_FOUND"
        } else {
            "AUDIO_MIX_TARGET_UPDATE_FAILED"
        };
        let _ = record_audio_action_failure(db_path, code, &message);
        AudioCommandError::Rejected(code, message)
    })?;

    let mut mix_target_state = read_mix_target_state_map(&app_settings);
    let mut next_state = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == request.mix_target_id)
        .map(stored_mix_target_state_from_snapshot)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_MIX_TARGET_NOT_FOUND",
                format!(
                    "Output '{}' is not part of this console.",
                    request.mix_target_id
                ),
            )
        })?;

    if let Some(volume) = request.volume {
        next_state.volume = volume;
    }
    if let Some(mute) = request.mute {
        next_state.mute = mute;
    }
    if let Some(dim) = request.dim {
        next_state.dim = dim;
    }
    if let Some(mono) = request.mono {
        next_state.mono = mono;
    }
    if let Some(talkback) = request.talkback {
        next_state.talkback = talkback;
    }
    mix_target_state.insert(request.mix_target_id.clone(), next_state);

    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_MIX_TARGET_STATE_KEY),
                serialize_json_state(&mix_target_state)?,
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), outcome.summary),
        ],
    )?;

    // Talkback is momentary on every surface (2026-09 audit, Slice 6): any
    // caller that turns it on arms the watchdog, any caller that turns it off
    // clears it, so nothing can latch talkback by construction.
    if let Some(talkback) = request.talkback {
        if talkback {
            super::talkback::arm_talkback_hold(db_path, &request.mix_target_id);
        } else {
            super::talkback::clear_talkback_hold(db_path, &request.mix_target_id);
        }
    }

    let refreshed = read_audio_snapshot(&load_audio_settings(db_path)?);
    refreshed
        .mix_targets
        .into_iter()
        .find(|entry| entry.id == request.mix_target_id)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_MIX_TARGET_NOT_FOUND",
                format!(
                    "Output '{}' is not part of this console.",
                    request.mix_target_id
                ),
            )
        })
}
