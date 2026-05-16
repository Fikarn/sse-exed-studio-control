use std::path::Path;

use super::helpers::*;
use super::types::*;
use super::*;

pub fn clear_audio_clips(
    db_path: &Path,
    request: &AudioClipClearRequest,
) -> Result<AudioClipClearResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    if !snapshot.capabilities.can_clear_clips {
        let message = String::from("Audio clip reset is unavailable while OSC is disabled.");
        record_audio_action_failure(db_path, "AUDIO_CLIP_CLEAR_UNAVAILABLE", &message)?;
        return Err(AudioCommandError::Rejected(
            "AUDIO_CLIP_CLEAR_UNAVAILABLE",
            message,
        ));
    }

    if let Some(channel_id) = &request.channel_id {
        if !snapshot
            .channels
            .iter()
            .any(|entry| entry.id == *channel_id)
        {
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!("Audio channel '{channel_id}' is not exposed by the engine."),
            ));
        }
    }

    let mut channel_state = read_channel_state_map(&app_settings);
    let affected = snapshot
        .channels
        .iter()
        .filter(|channel| {
            request
                .channel_id
                .as_ref()
                .map(|channel_id| channel.id == *channel_id)
                .unwrap_or(true)
        })
        .map(|channel| {
            let mut next_state = channel_state
                .get(&channel.id)
                .cloned()
                .unwrap_or_else(|| stored_channel_state_from_snapshot(channel));
            next_state.clip = false;
            channel_state.insert(channel.id.clone(), next_state);
            channel.name.clone()
        })
        .collect::<Vec<_>>();

    let summary = if let Some(channel_id) = &request.channel_id {
        format!("Clip hold cleared for audio channel '{channel_id}'.")
    } else {
        format!("Clip hold cleared for {} audio channels.", affected.len())
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
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
        ],
    )?;

    Ok(AudioClipClearResult {
        cleared: true,
        channel_id: request.channel_id.clone(),
        summary,
    })
}
