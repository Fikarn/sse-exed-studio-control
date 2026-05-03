use std::collections::HashMap;

use crate::audio_backend::read_default_audio_inventory;

use super::helpers::*;
use super::types::*;
use super::*;

pub fn read_audio_snapshot(settings: &HashMap<String, String>) -> AudioSnapshot {
    let config = resolve_audio_config(settings);
    let check_status = audio_check_status(settings);
    let osc_enabled = audio_osc_enabled(settings);
    let status = match check_status.as_str() {
        "passed" => "ready",
        "failed" => "attention",
        "idle" => "not-verified",
        _ => "not-verified",
    }
    .to_string();
    let connected = check_status == "passed" && osc_enabled;
    let verified = check_status == "passed" && osc_enabled;
    let inventory = read_default_audio_inventory(&config);
    let snapshot_entries = read_audio_snapshot_entries(settings, inventory.snapshots.as_slice());
    let console_state_confidence = audio_console_state_confidence(settings);
    let last_console_sync_at = read_optional_setting(settings, AUDIO_LAST_CONSOLE_SYNC_AT_KEY);
    let last_console_sync_reason =
        read_optional_setting(settings, AUDIO_LAST_CONSOLE_SYNC_REASON_KEY);
    let last_recalled_snapshot_id =
        read_optional_setting(settings, AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY).filter(
            |snapshot_id| {
                snapshot_entries
                    .iter()
                    .any(|snapshot| snapshot.id == *snapshot_id)
            },
        );
    let last_snapshot_recall_at =
        read_optional_setting(settings, AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY);
    let last_action_status = read_optional_setting(settings, AUDIO_LAST_ACTION_STATUS_KEY)
        .unwrap_or_else(|| String::from("idle"));
    let last_action_code = read_optional_setting(settings, AUDIO_LAST_ACTION_CODE_KEY);
    let last_action_message = read_optional_setting(settings, AUDIO_LAST_ACTION_MESSAGE_KEY);
    let channels = apply_channel_state(settings, inventory.channels);
    let mix_targets = apply_mix_target_state(settings, inventory.mix_targets);
    let selected_channel_id = audio_selected_channel_id(settings, &channels);
    let selected_mix_target_id = audio_selected_mix_target_id(settings, &mix_targets);
    let expected_peak_data = audio_expected_peak_data(settings);
    let expected_submix_lock = audio_expected_submix_lock(settings);
    let expected_compatibility_mode = audio_expected_compatibility_mode(settings);
    let faders_per_bank = audio_faders_per_bank(settings);
    let snapshots = snapshot_entries
        .into_iter()
        .map(|snapshot| {
            let last_recalled = last_recalled_snapshot_id
                .as_deref()
                .map(|value| value == snapshot.id)
                .unwrap_or(false);
            AudioSceneSnapshot {
                last_recalled_at: if last_recalled {
                    last_snapshot_recall_at.clone()
                } else {
                    None
                },
                last_recalled,
                ..snapshot
            }
        })
        .collect::<Vec<_>>();
    let metering_state = if !osc_enabled {
        String::from("disabled")
    } else if verified {
        String::from("transport-only")
    } else if check_status == "failed" {
        String::from("offline")
    } else {
        String::from("disabled")
    };

    AudioSnapshot {
        summary: audio_summary(AudioSummaryContext {
            status: &status,
            config: &config,
            osc_enabled,
            channel_count: channels.len(),
            mix_target_count: mix_targets.len(),
            snapshot_count: snapshots.len(),
            last_console_sync_at: last_console_sync_at.as_deref(),
            last_console_sync_reason: last_console_sync_reason.as_deref(),
            last_recalled_snapshot_id: last_recalled_snapshot_id.as_deref(),
            last_snapshot_recall_at: last_snapshot_recall_at.as_deref(),
            last_action_status: &last_action_status,
            last_action_code: last_action_code.as_deref(),
            last_action_message: last_action_message.as_deref(),
        }),
        status,
        adapter_mode: inventory.adapter_mode,
        send_host: config.send_host,
        send_port: config.send_port,
        receive_port: config.receive_port,
        osc_enabled,
        connected,
        verified,
        metering_state,
        selected_channel_id,
        selected_mix_target_id,
        expected_peak_data,
        expected_submix_lock,
        expected_compatibility_mode,
        faders_per_bank,
        console_state_confidence,
        last_console_sync_at,
        last_console_sync_reason,
        last_recalled_snapshot_id,
        last_snapshot_recall_at,
        last_action_status,
        last_action_code,
        last_action_message,
        channels,
        mix_targets,
        snapshots,
    }
}

pub fn build_audio_health_check(settings: &HashMap<String, String>) -> AudioHealthCheck {
    let snapshot = read_audio_snapshot(settings);
    AudioHealthCheck {
        ok: snapshot.status == "ready",
        status: snapshot.status.clone(),
        summary: snapshot.summary.clone(),
        send_host: snapshot.send_host,
        send_port: snapshot.send_port,
        receive_port: snapshot.receive_port,
        verified: snapshot.verified,
        metering_state: snapshot.metering_state,
    }
}
