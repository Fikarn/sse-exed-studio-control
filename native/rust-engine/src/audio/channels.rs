use std::path::Path;

use crate::audio_backend::update_default_audio_channel;

use super::helpers::*;
use super::types::*;
use super::*;

const MAIN_MIX_TARGET_ID: &str = "audio-mix-main";

pub fn update_audio_channel(
    db_path: &Path,
    request: &AudioChannelUpdateRequest,
) -> Result<AudioChannelSnapshot, AudioCommandError> {
    let _state_guard = lock_audio_state();
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);

    // Gate first: every field reaches TotalMix, so the request needs a
    // verified console link, exactly like sync, a load and the Stream Deck
    // path. (The channels' names are TotalMix's since 2026-10-01.)
    ensure_audio_action_allowed(db_path, &snapshot)?;

    // Every field is validated BEFORE anything goes on the wire, so a request
    // carrying one unsupported field can never half-apply to the console.
    let mut channel_state = read_channel_state_map(&app_settings);
    let entry = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == request.channel_id)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Channel '{}' is not part of this console.",
                    request.channel_id
                ),
            )
        })?;
    // A channel TotalMix hides (Setup's list, 2026-10-08) takes no change:
    // TotalMix would drop the write unanswered, and the Console would read
    // ASSUMED for nothing (the walk of 2026-10-07, finding 3).
    if entry.hidden {
        let message = hidden_channel_refusal(&entry.name);
        record_audio_action_failure(db_path, AUDIO_CHANNEL_HIDDEN, &message)?;
        return Err(AudioCommandError::Rejected(AUDIO_CHANNEL_HIDDEN, message));
    }
    let mut next_state = stored_channel_state_from_snapshot(entry);

    if let Some(gain) = request.gain {
        if !channel_supports_gain_from_role(&snapshot, &request.channel_id) {
            let message = format!(
                "Channel '{}' has no preamp gain — only the front preamp inputs do.",
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
            let message = format!("Output '{}' is not part of this console.", mix_target_id);
            record_audio_action_failure(db_path, "AUDIO_MIX_TARGET_NOT_FOUND", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_MIX_TARGET_NOT_FOUND",
                message,
            ));
        }
        // `fader` is the channel's Main Out level; every other output's level
        // lives in `mix_levels` alone, as the console link and Sync write them.
        // A phones edit used to overwrite `fader` too, so what the channel's
        // main fader showed depended on which was written last.
        if mix_target_id == MAIN_MIX_TARGET_ID {
            next_state.fader = fader;
        }
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
                "Channel '{}' has no 48V switch — only the front preamp inputs do.",
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
            let message = format!("Channel '{}' has no polarity switch.", request.channel_id);
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
            let message = format!("Channel '{}' has no pad switch.", request.channel_id);
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
                "Channel '{}' has no instrument (Hi-Z) switch.",
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
                "Channel '{}' has no AutoSet — only the front preamp inputs do.",
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
    let config = resolve_audio_config(&app_settings);
    let outcome = update_default_audio_channel(
        &config,
        &crate::audio_backend::AudioBackendInventory {
            adapter_mode: snapshot.adapter_mode.clone(),
            channels: snapshot.channels.clone(),
            mix_targets: snapshot.mix_targets.clone(),
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

    channel_state.insert(request.channel_id.clone(), next_state);

    // Console-state confidence is deliberately NOT written here: a UDP send
    // is not a confirmation. Only a completed pull (a Sync, or the read-back
    // after a load in TotalMix) or the console-link echo tracker may move it
    // (2026-09 audit remediation).
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

    let refreshed = read_audio_snapshot(&load_audio_settings(db_path)?);
    refreshed
        .channels
        .into_iter()
        .find(|entry| entry.id == request.channel_id)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Channel '{}' is not part of this console.",
                    request.channel_id
                ),
            )
        })
}

pub fn clear_all_audio_solo(db_path: &Path) -> Result<AudioSnapshot, AudioCommandError> {
    let _state_guard = lock_audio_state();
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    let config = resolve_audio_config(&app_settings);
    let mut channel_state = read_channel_state_map(&app_settings);
    let mut cleared_count = 0usize;

    // Clearing a solo is a console write; the idempotent no-op stays allowed.
    // A solo on a channel TotalMix hides is left as it is: nothing sent to a
    // hidden channel is answered (Setup's list, 2026-10-08).
    if snapshot
        .channels
        .iter()
        .any(|entry| entry.solo && !entry.hidden)
    {
        ensure_audio_action_allowed(db_path, &snapshot)?;
    }

    for channel in snapshot
        .channels
        .iter()
        .filter(|entry| entry.solo && !entry.hidden)
    {
        let request = AudioChannelUpdateRequest {
            auto_set: None,
            channel_id: channel.id.clone(),
            fader: None,
            gain: None,
            instrument: None,
            mix_target_id: None,
            mute: None,
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
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary),
        ],
    )?;

    Ok(read_audio_snapshot(&load_audio_settings(db_path)?))
}
