use std::path::Path;

use crate::audio_backend::{update_default_audio_channel, update_default_audio_eq};

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
        .map(stored_channel_state_from_snapshot)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Audio channel '{}' is not exposed by the engine.",
                    request.channel_id
                ),
            )
        })?;

    if let Some(name) = &request.name {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 50 {
            let message = String::from("Audio channel names must be 1-50 characters.");
            record_audio_action_failure(db_path, "AUDIO_CHANNEL_NAME_INVALID", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NAME_INVALID",
                message,
            ));
        }
        next_state.name = Some(String::from(trimmed));
    }
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

pub fn clear_all_audio_solo(db_path: &Path) -> Result<AudioSnapshot, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    let config = resolve_audio_config(&app_settings);
    let mut channel_state = read_channel_state_map(&app_settings);
    let mut cleared_count = 0usize;

    for channel in snapshot.channels.iter().filter(|entry| entry.solo) {
        let request = AudioChannelUpdateRequest {
            auto_set: None,
            channel_id: channel.id.clone(),
            fader: None,
            gain: None,
            instrument: None,
            mix_target_id: None,
            mute: None,
            name: None,
            pad: None,
            phantom: None,
            phase: None,
            solo: Some(false),
        };

        update_default_audio_channel(
            &config,
            &crate::audio_backend::AudioBackendInventory {
                adapter_mode: snapshot.adapter_mode.clone(),
                channels: snapshot.channels.clone(),
                mix_targets: snapshot.mix_targets.clone(),
                snapshots: snapshot.snapshots.clone(),
            },
            &request,
        )
        .map_err(|message| {
            let _ = record_audio_action_failure(db_path, "AUDIO_SOLO_CLEAR_FAILED", &message);
            AudioCommandError::Rejected("AUDIO_SOLO_CLEAR_FAILED", message)
        })?;

        let mut next_state = stored_channel_state_from_snapshot(channel);
        next_state.solo = false;
        channel_state.insert(channel.id.clone(), next_state);
        cleared_count += 1;
    }

    let summary = if cleared_count == 0 {
        String::from("No soloed audio channels to clear.")
    } else {
        format!("Cleared solo on {cleared_count} audio channel(s).")
    };

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
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary),
        ],
    )?;

    Ok(read_audio_snapshot(&load_audio_settings(db_path)?))
}

pub fn update_audio_channel_eq(
    db_path: &Path,
    request: &AudioEqUpdateRequest,
) -> Result<AudioChannelSnapshot, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    if !snapshot.capabilities.can_edit_processing {
        let message = String::from("Audio EQ editing is unavailable while OSC is disabled.");
        record_audio_action_failure(db_path, "AUDIO_PROCESSING_UNAVAILABLE", &message)?;
        return Err(AudioCommandError::Rejected(
            "AUDIO_PROCESSING_UNAVAILABLE",
            message,
        ));
    }

    let mut channel_state = read_channel_state_map(&app_settings);
    let mut next_state = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == request.channel_id)
        .map(stored_channel_state_from_snapshot)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Audio channel '{}' is not exposed by the engine.",
                    request.channel_id
                ),
            )
        })?;

    next_state.eq = normalize_audio_eq_snapshot(&next_state.eq);

    if let Some(enabled) = request.enabled {
        next_state.eq.enabled = enabled;
    }

    if let Some(enabled) = request.low_cut_enabled {
        next_state.eq.low_cut.enabled = enabled;
    }
    if let Some(frequency_hz) = request.low_cut_frequency_hz {
        next_state.eq.low_cut.frequency_hz = clamp_low_cut_frequency(frequency_hz);
    }
    if let Some(slope) = request.low_cut_slope_db_per_octave {
        next_state.eq.low_cut.slope_db_per_octave = normalize_low_cut_slope(slope);
    }

    if request.band_id.is_none()
        && (request.band_enabled.is_some()
            || request.band_type.is_some()
            || request.frequency_hz.is_some()
            || request.gain_db.is_some()
            || request.q.is_some())
    {
        let message = String::from("Audio EQ band updates require bandId.");
        record_audio_action_failure(db_path, "AUDIO_EQ_BAND_REQUIRED", &message)?;
        return Err(AudioCommandError::Rejected(
            "AUDIO_EQ_BAND_REQUIRED",
            message,
        ));
    }

    if let Some(band_id) = &request.band_id {
        let band = next_state
            .eq
            .bands
            .iter_mut()
            .find(|entry| entry.id == *band_id)
            .ok_or_else(|| {
                AudioCommandError::Rejected(
                    "AUDIO_EQ_BAND_NOT_FOUND",
                    format!("Audio EQ band '{band_id}' is not exposed by the engine."),
                )
            })?;
        if let Some(enabled) = request.band_enabled {
            band.enabled = enabled;
        }
        if let Some(band_type) = &request.band_type {
            if !eq_band_type_supported(band_id, band_type) {
                let message =
                    format!("Audio EQ band '{band_id}' does not support type '{band_type}'.");
                record_audio_action_failure(db_path, "AUDIO_EQ_BAND_TYPE_UNSUPPORTED", &message)?;
                return Err(AudioCommandError::Rejected(
                    "AUDIO_EQ_BAND_TYPE_UNSUPPORTED",
                    message,
                ));
            }
            band.band_type = normalize_eq_band_type(band_id, band_type);
        }
        if let Some(frequency_hz) = request.frequency_hz {
            band.frequency_hz = clamp_eq_frequency(frequency_hz);
        }
        if let Some(gain_db) = request.gain_db {
            band.gain_db = clamp_eq_gain(gain_db);
        }
        if let Some(q) = request.q {
            band.q = clamp_eq_q(q);
        }
    }

    let config = resolve_audio_config(&app_settings);
    let outcome = update_default_audio_eq(
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
        } else {
            "AUDIO_EQ_UPDATE_FAILED"
        };
        let _ = record_audio_action_failure(db_path, code, &message);
        AudioCommandError::Rejected(code, message)
    })?;
    next_state.eq.hardware_status = outcome.hardware_status;

    channel_state.insert(request.channel_id.clone(), next_state);
    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_CHANNEL_STATE_KEY),
                serialize_json_state(&channel_state)?,
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), outcome.summary),
        ],
    )?;

    read_audio_snapshot(&load_audio_settings(db_path)?)
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

pub fn update_audio_channel_dynamics(
    db_path: &Path,
    request: &AudioDynamicsUpdateRequest,
) -> Result<AudioChannelSnapshot, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    if !snapshot.capabilities.can_edit_processing {
        let message = String::from("Audio dynamics editing is unavailable while OSC is disabled.");
        record_audio_action_failure(db_path, "AUDIO_PROCESSING_UNAVAILABLE", &message)?;
        return Err(AudioCommandError::Rejected(
            "AUDIO_PROCESSING_UNAVAILABLE",
            message,
        ));
    }

    let mut channel_state = read_channel_state_map(&app_settings);
    let mut next_state = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == request.channel_id)
        .map(stored_channel_state_from_snapshot)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Audio channel '{}' is not exposed by the engine.",
                    request.channel_id
                ),
            )
        })?;

    let processor = match request.section.as_str() {
        "gate" => &mut next_state.dynamics.gate,
        _ => &mut next_state.dynamics.compressor,
    };
    if let Some(enabled) = request.enabled {
        processor.enabled = enabled;
    }
    if let Some(threshold_db) = request.threshold_db {
        processor.threshold_db = clamp_dynamics_threshold(threshold_db);
    }
    if let Some(ratio) = request.ratio {
        processor.ratio = clamp_dynamics_ratio(ratio);
    }
    if let Some(attack_ms) = request.attack_ms {
        processor.attack_ms = clamp_dynamics_time(attack_ms);
    }
    if let Some(release_ms) = request.release_ms {
        processor.release_ms = clamp_dynamics_time(release_ms);
    }
    if let Some(makeup_db) = request.makeup_db {
        processor.makeup_db = clamp_dynamics_makeup(makeup_db);
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
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                String::from("Audio dynamics updated."),
            ),
        ],
    )?;

    read_audio_snapshot(&load_audio_settings(db_path)?)
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

pub fn update_audio_channel_send_mode(
    db_path: &Path,
    request: &AudioSendModeUpdateRequest,
) -> Result<AudioChannelSnapshot, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    if !snapshot.capabilities.can_edit_mixer_state {
        let message = String::from("Audio send controls are unavailable while OSC is disabled.");
        record_audio_action_failure(db_path, "AUDIO_SEND_UNAVAILABLE", &message)?;
        return Err(AudioCommandError::Rejected(
            "AUDIO_SEND_UNAVAILABLE",
            message,
        ));
    }
    if !snapshot
        .mix_targets
        .iter()
        .any(|entry| entry.id == request.mix_target_id)
    {
        return Err(AudioCommandError::Rejected(
            "AUDIO_MIX_TARGET_NOT_FOUND",
            format!(
                "Audio mix target '{}' is not exposed by the engine.",
                request.mix_target_id
            ),
        ));
    }

    let mut channel_state = read_channel_state_map(&app_settings);
    let mut next_state = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == request.channel_id)
        .map(stored_channel_state_from_snapshot)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Audio channel '{}' is not exposed by the engine.",
                    request.channel_id
                ),
            )
        })?;

    let send_mode = next_state
        .send_modes
        .entry(request.mix_target_id.clone())
        .or_insert_with(default_audio_send_mode_snapshot);
    if let Some(pre_fader) = request.pre_fader {
        send_mode.pre_fader = pre_fader;
    }
    if let Some(mute) = request.mute {
        send_mode.mute = mute;
    }
    if let Some(link_stereo) = request.link_stereo {
        send_mode.link_stereo = link_stereo;
    }
    if let Some(solo) = request.solo {
        send_mode.solo = solo;
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
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                String::from("Audio send mode updated."),
            ),
        ],
    )?;

    read_audio_snapshot(&load_audio_settings(db_path)?)
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
