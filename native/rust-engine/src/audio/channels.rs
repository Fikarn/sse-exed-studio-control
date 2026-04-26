use std::path::Path;

use crate::audio_backend::update_default_audio_channel;

use super::helpers::*;
use super::types::*;
use super::*;

pub fn update_audio_channel(
    db_path: &Path,
    request: &AudioChannelUpdateRequest,
) -> Result<AudioChannelSnapshot, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);

    let config = resolve_audio_config(&app_settings);
    let outcome = update_default_audio_channel(
        &config,
        &crate::audio_backend::AudioBackendInventory {
            adapter_mode: snapshot.adapter_mode.clone(),
            channels: snapshot.channels.clone(),
            mix_targets: snapshot.mix_targets.clone(),
            snapshots: snapshot.snapshots.clone(),
        },
        request,
    )
    .map_err(|message| {
        let code = if message.contains("channel") {
            "AUDIO_CHANNEL_NOT_FOUND"
        } else if message.contains("mix target") {
            "AUDIO_MIX_TARGET_NOT_FOUND"
        } else {
            "AUDIO_CHANNEL_UPDATE_FAILED"
        };
        let _ = record_audio_action_failure(db_path, code, &message);
        AudioCommandError::Rejected(code, message)
    })?;

    let mut channel_state = read_channel_state_map(&app_settings);
    let mut next_state = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == request.channel_id)
        .map(|channel| StoredAudioChannelState {
            gain: channel.gain,
            fader: channel.fader,
            mix_levels: channel.mix_levels.clone(),
            mute: channel.mute,
            solo: channel.solo,
            phantom: channel.phantom,
            phase: channel.phase,
            pad: channel.pad,
            instrument: channel.instrument,
            auto_set: channel.auto_set,
        })
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Audio channel '{}' is not exposed by the engine.",
                    request.channel_id
                ),
            )
        })?;

    if let Some(gain) = request.gain {
        if !channel_supports_gain_from_role(&snapshot, &request.channel_id) {
            let message = format!(
                "Audio channel '{}' does not expose gain in the native engine.",
                request.channel_id
            );
            record_audio_action_failure(db_path, "AUDIO_CHANNEL_FIELD_UNSUPPORTED", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_FIELD_UNSUPPORTED",
                message,
            ));
        }
        next_state.gain = gain;
    }
    if let Some(fader) = request.fader {
        let mix_target_id = request
            .mix_target_id
            .clone()
            .unwrap_or_else(|| String::from("audio-mix-main"));
        if !snapshot
            .mix_targets
            .iter()
            .any(|entry| entry.id == mix_target_id)
        {
            let message = format!(
                "Audio mix target '{}' is not exposed by the engine.",
                mix_target_id
            );
            record_audio_action_failure(db_path, "AUDIO_MIX_TARGET_NOT_FOUND", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_MIX_TARGET_NOT_FOUND",
                message,
            ));
        }
        next_state.fader = fader;
        next_state.mix_levels.insert(mix_target_id, fader);
    }
    if let Some(mute) = request.mute {
        next_state.mute = mute;
    }
    if let Some(solo) = request.solo {
        next_state.solo = solo;
    }
    if let Some(phantom) = request.phantom {
        if !channel_supports_phantom_from_role(&snapshot, &request.channel_id) {
            let message = format!(
                "Audio channel '{}' does not expose phantom power in the native engine.",
                request.channel_id
            );
            record_audio_action_failure(db_path, "AUDIO_CHANNEL_FIELD_UNSUPPORTED", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_FIELD_UNSUPPORTED",
                message,
            ));
        }
        next_state.phantom = phantom;
    }
    if let Some(phase) = request.phase {
        if !channel_supports_phase_from_role(&snapshot, &request.channel_id) {
            let message = format!(
                "Audio channel '{}' does not expose phase inversion in the native engine.",
                request.channel_id
            );
            record_audio_action_failure(db_path, "AUDIO_CHANNEL_FIELD_UNSUPPORTED", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_FIELD_UNSUPPORTED",
                message,
            ));
        }
        next_state.phase = phase;
    }
    if let Some(pad) = request.pad {
        if !channel_supports_pad_from_role(&snapshot, &request.channel_id) {
            let message = format!(
                "Audio channel '{}' does not expose pad in the native engine.",
                request.channel_id
            );
            record_audio_action_failure(db_path, "AUDIO_CHANNEL_FIELD_UNSUPPORTED", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_FIELD_UNSUPPORTED",
                message,
            ));
        }
        next_state.pad = pad;
    }
    if let Some(instrument) = request.instrument {
        if !channel_supports_instrument_from_role(&snapshot, &request.channel_id) {
            let message = format!(
                "Audio channel '{}' does not expose instrument mode in the native engine.",
                request.channel_id
            );
            record_audio_action_failure(db_path, "AUDIO_CHANNEL_FIELD_UNSUPPORTED", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_FIELD_UNSUPPORTED",
                message,
            ));
        }
        next_state.instrument = instrument;
    }
    if let Some(auto_set) = request.auto_set {
        if !channel_supports_auto_set_from_role(&snapshot, &request.channel_id) {
            let message = format!(
                "Audio channel '{}' does not expose AutoSet in the native engine.",
                request.channel_id
            );
            record_audio_action_failure(db_path, "AUDIO_CHANNEL_FIELD_UNSUPPORTED", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_FIELD_UNSUPPORTED",
                message,
            ));
        }
        next_state.auto_set = auto_set;
    }
    channel_state.insert(request.channel_id.clone(), next_state);

    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_CHANNEL_STATE_KEY),
                serialize_json_state(&channel_state)?,
            ),
            (
                String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
                String::from("aligned"),
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), outcome.summary),
        ],
    )?;

    let refreshed = read_audio_snapshot(&load_audio_settings(db_path)?);
    refreshed
        .channels
        .into_iter()
        .find(|entry| entry.id == request.channel_id)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Audio channel '{}' is not exposed by the engine.",
                    request.channel_id
                ),
            )
        })
}
