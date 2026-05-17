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
    let mut mix_targets = apply_mix_target_state(settings, inventory.mix_targets);
    apply_mix_target_metering(&channels, &mut mix_targets);
    let selected_channel_id = audio_selected_channel_id(settings, &channels);
    let selected_mix_target_id = audio_selected_mix_target_id(settings, &mix_targets);
    let expected_peak_data = audio_expected_peak_data(settings);
    let expected_submix_lock = audio_expected_submix_lock(settings);
    let expected_compatibility_mode = audio_expected_compatibility_mode(settings);
    let faders_per_bank = audio_faders_per_bank(settings);
    let view_mode = audio_view_mode(settings);
    let capabilities = audio_capabilities(&status, osc_enabled);
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
                preview: audio_scene_preview(snapshot.contents.as_ref(), &channels, &mix_targets),
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
        view_mode,
        capabilities,
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

fn apply_mix_target_metering(
    channels: &[AudioChannelSnapshot],
    mix_targets: &mut [AudioMixTargetSnapshot],
) {
    for mix_target in mix_targets {
        if mix_target.mute {
            mix_target.meter_left = 0.0;
            mix_target.meter_right = 0.0;
            mix_target.meter_level = 0.0;
            mix_target.peak_hold = 0.0;
            mix_target.peak_hold_left = 0.0;
            mix_target.peak_hold_right = 0.0;
            continue;
        }

        let mut left_energy = 0.0_f64;
        let mut right_energy = 0.0_f64;
        let mut peak_left_energy = 0.0_f64;
        let mut peak_right_energy = 0.0_f64;
        for channel in channels {
            if channel.mute {
                continue;
            }

            let send_mode = channel.send_modes.get(&mix_target.id);
            if send_mode.is_some_and(|mode| mode.mute) {
                continue;
            }

            let send_level = channel
                .mix_levels
                .get(&mix_target.id)
                .copied()
                .unwrap_or(channel.fader)
                .clamp(0.0, 1.0);
            if send_level <= 0.01 {
                continue;
            }

            let source_left = if channel.stereo {
                channel.meter_left
            } else {
                channel.meter_level
            };
            let source_right = if channel.stereo {
                channel.meter_right
            } else {
                channel.meter_level
            };
            let source_peak_left = if channel.stereo {
                channel.peak_hold_left
            } else {
                channel.peak_hold_left.max(channel.peak_hold)
            };
            let source_peak_right = if channel.stereo {
                channel.peak_hold_right
            } else {
                channel.peak_hold_right.max(channel.peak_hold)
            };
            let dim_scale = if mix_target.dim { 0.42 } else { 1.0 };
            let gain = (send_level * mix_target.volume * dim_scale * 0.5).clamp(0.0, 1.0);
            left_energy += (source_left * gain).powi(2);
            right_energy += (source_right * gain).powi(2);
            peak_left_energy += (source_peak_left * gain).powi(2);
            peak_right_energy += (source_peak_right * gain).powi(2);
        }

        let mut meter_left = left_energy.sqrt().clamp(0.0, 0.98);
        let mut meter_right = right_energy.sqrt().clamp(0.0, 0.98);
        let mut peak_hold_left = (peak_left_energy.sqrt() * 0.98)
            .max(meter_left)
            .clamp(meter_left, 1.0);
        let mut peak_hold_right = (peak_right_energy.sqrt() * 0.98)
            .max(meter_right)
            .clamp(meter_right, 1.0);
        if mix_target.mono {
            let mono = ((meter_left + meter_right) * 0.5).clamp(0.0, 0.98);
            meter_left = mono;
            meter_right = mono;
            let mono_peak = peak_hold_left.max(peak_hold_right).max(mono);
            peak_hold_left = mono_peak;
            peak_hold_right = mono_peak;
        }
        let meter_level = meter_left.max(meter_right);
        let peak_hold = peak_hold_left.max(peak_hold_right).max(meter_level);

        mix_target.meter_left = meter_left;
        mix_target.meter_right = meter_right;
        mix_target.meter_level = meter_level;
        mix_target.peak_hold = peak_hold;
        mix_target.peak_hold_left = peak_hold_left;
        mix_target.peak_hold_right = peak_hold_right;
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
