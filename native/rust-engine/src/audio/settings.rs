use std::path::Path;

use crate::commissioning::{
    AUDIO_CHECK_ID, AUDIO_RECEIVE_PORT_KEY, AUDIO_SEND_HOST_KEY, AUDIO_SEND_PORT_KEY,
};

use super::helpers::*;
use super::types::*;
use super::*;

pub fn update_audio_settings(
    db_path: &Path,
    request: &AudioSettingsUpdateRequest,
) -> Result<AudioSnapshot, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);

    if let Some(Some(channel_id)) = &request.selected_channel_id {
        if !snapshot
            .channels
            .iter()
            .any(|entry| entry.id == *channel_id)
        {
            return Err(AudioCommandError::Rejected(
                "AUDIO_CHANNEL_NOT_FOUND",
                format!(
                    "Audio channel '{}' is not exposed by the engine.",
                    channel_id
                ),
            ));
        }
    }

    if let Some(mix_target_id) = &request.selected_mix_target_id {
        if !snapshot
            .mix_targets
            .iter()
            .any(|entry| entry.id == *mix_target_id)
        {
            return Err(AudioCommandError::Rejected(
                "AUDIO_MIX_TARGET_NOT_FOUND",
                format!(
                    "Audio mix target '{}' is not exposed by the engine.",
                    mix_target_id
                ),
            ));
        }
    }

    let transport_changed = request.osc_enabled.is_some()
        || request.send_host.is_some()
        || request.send_port.is_some()
        || request.receive_port.is_some();

    let mut updates: Vec<(String, String)> = Vec::new();
    let mut summary_parts: Vec<String> = Vec::new();

    if let Some(osc_enabled) = request.osc_enabled {
        updates.push((
            String::from(AUDIO_OSC_ENABLED_KEY),
            if osc_enabled {
                String::from("true")
            } else {
                String::from("false")
            },
        ));
        summary_parts.push(format!(
            "OSC transport {}",
            if osc_enabled { "enabled" } else { "disabled" }
        ));
    }

    if let Some(send_host) = &request.send_host {
        updates.push((String::from(AUDIO_SEND_HOST_KEY), send_host.clone()));
        summary_parts.push(format!("send host -> {}", send_host));
    }

    if let Some(send_port) = request.send_port {
        updates.push((String::from(AUDIO_SEND_PORT_KEY), send_port.to_string()));
        summary_parts.push(format!("send port -> {}", send_port));
    }

    if let Some(receive_port) = request.receive_port {
        updates.push((
            String::from(AUDIO_RECEIVE_PORT_KEY),
            receive_port.to_string(),
        ));
        summary_parts.push(format!("receive port -> {}", receive_port));
    }

    if let Some(selected_channel_id) = &request.selected_channel_id {
        let value = selected_channel_id.clone().unwrap_or_default();
        updates.push((String::from(AUDIO_SELECTED_CHANNEL_ID_KEY), value.clone()));
        summary_parts.push(if value.is_empty() {
            String::from("selected strip cleared")
        } else {
            format!("selected strip -> {}", value)
        });
    }

    if let Some(selected_mix_target_id) = &request.selected_mix_target_id {
        updates.push((
            String::from(AUDIO_SELECTED_MIX_TARGET_ID_KEY),
            selected_mix_target_id.clone(),
        ));
        summary_parts.push(format!("selected mix -> {}", selected_mix_target_id));
    }

    if let Some(expected_peak_data) = request.expected_peak_data {
        updates.push((
            String::from(AUDIO_EXPECTED_PEAK_DATA_KEY),
            if expected_peak_data {
                String::from("true")
            } else {
                String::from("false")
            },
        ));
        summary_parts.push(format!(
            "peak data {}",
            if expected_peak_data {
                "expected"
            } else {
                "optional"
            }
        ));
    }

    if let Some(expected_submix_lock) = request.expected_submix_lock {
        updates.push((
            String::from(AUDIO_EXPECTED_SUBMIX_LOCK_KEY),
            if expected_submix_lock {
                String::from("true")
            } else {
                String::from("false")
            },
        ));
        summary_parts.push(format!(
            "submix lock {}",
            if expected_submix_lock {
                "expected"
            } else {
                "reviewed"
            }
        ));
    }

    if let Some(expected_compatibility_mode) = request.expected_compatibility_mode {
        updates.push((
            String::from(AUDIO_EXPECTED_COMPATIBILITY_MODE_KEY),
            if expected_compatibility_mode {
                String::from("true")
            } else {
                String::from("false")
            },
        ));
        summary_parts.push(format!(
            "compatibility mode {}",
            if expected_compatibility_mode {
                "noted"
            } else {
                "modern"
            }
        ));
    }

    if let Some(faders_per_bank) = request.faders_per_bank {
        updates.push((
            String::from(AUDIO_FADERS_PER_BANK_KEY),
            faders_per_bank.to_string(),
        ));
        summary_parts.push(format!("bank size -> {} faders", faders_per_bank));
    }

    if transport_changed {
        updates.push((
            format!("app.commissioning.check.{AUDIO_CHECK_ID}.status"),
            String::from("idle"),
        ));
        updates.push((
            format!("app.commissioning.check.{AUDIO_CHECK_ID}.message"),
            String::from(
                "Audio transport settings changed in the native audio workspace. Rerun the audio probe.",
            ),
        ));
        updates.push((
            format!("app.commissioning.check.{AUDIO_CHECK_ID}.checked_at"),
            String::new(),
        ));
        updates.push((
            String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
            String::from("unknown"),
        ));
        updates.push((String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY), String::new()));
        updates.push((
            String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
            String::new(),
        ));
        updates.push((
            String::from(AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY),
            String::new(),
        ));
        updates.push((
            String::from(AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY),
            String::new(),
        ));
        summary_parts.push(String::from("audio probe reset"));
    }

    let summary = if summary_parts.is_empty() {
        String::from("Native audio settings updated.")
    } else {
        format!(
            "Native audio settings updated: {}.",
            summary_parts.join(", ")
        )
    };

    updates.push((
        String::from(AUDIO_LAST_ACTION_STATUS_KEY),
        String::from("succeeded"),
    ));
    updates.push((String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()));
    updates.push((String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary));

    persist_audio_state(db_path, &updates)?;
    Ok(read_audio_snapshot(&load_audio_settings(db_path)?))
}
