use std::collections::HashMap;
use std::path::Path;

use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio_backend::AudioBackendConfig;
use crate::commissioning::{
    AUDIO_CHECK_ID, AUDIO_RECEIVE_PORT_KEY, AUDIO_SEND_HOST_KEY, AUDIO_SEND_PORT_KEY,
};
use crate::storage::{list_settings_by_prefix, open_connection, set_settings_owned};

use serde::{Deserialize, Serialize};

use super::types::*;
use super::*;

pub(super) fn load_audio_settings(
    db_path: &Path,
) -> Result<HashMap<String, String>, AudioCommandError> {
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

pub(super) fn apply_channel_state(
    settings: &HashMap<String, String>,
    channels: Vec<AudioChannelSnapshot>,
) -> Vec<AudioChannelSnapshot> {
    let stored_state = read_channel_state_map(settings);
    channels
        .into_iter()
        .map(|mut channel| {
            if let Some(state) = stored_state.get(&channel.id) {
                if let Some(name) = state
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    channel.name = String::from(name);
                }
                if channel_supports_gain(&channel) {
                    channel.gain = clamp_gain(state.gain);
                }
                channel.fader = clamp_level(state.fader);
                channel.clip = state.clip;
                channel.mute = state.mute;
                channel.solo = state.solo;
                if channel_supports_phantom(&channel) {
                    channel.phantom = state.phantom;
                }
                if channel_supports_phase(&channel) {
                    channel.phase = state.phase;
                }
                if channel_supports_pad(&channel) {
                    channel.pad = state.pad;
                }
                if channel_supports_instrument(&channel) {
                    channel.instrument = state.instrument;
                }
                if channel_supports_auto_set(&channel) {
                    channel.auto_set = state.auto_set;
                }
                channel.eq = state.eq.clone();
                channel.dynamics = state.dynamics.clone();
                channel.send_modes =
                    default_send_modes_for_mix_targets(channel.send_modes, &channel.mix_levels);
                for (mix_target_id, send_mode) in &state.send_modes {
                    channel
                        .send_modes
                        .insert(mix_target_id.clone(), send_mode.clone());
                }
                for (mix_target_id, level) in &state.mix_levels {
                    channel
                        .mix_levels
                        .insert(mix_target_id.clone(), clamp_level(*level));
                }
            }
            channel.send_modes =
                default_send_modes_for_mix_targets(channel.send_modes, &channel.mix_levels);
            channel
        })
        .collect()
}

pub(super) fn apply_mix_target_state(
    settings: &HashMap<String, String>,
    mix_targets: Vec<AudioMixTargetSnapshot>,
) -> Vec<AudioMixTargetSnapshot> {
    let stored_state = read_mix_target_state_map(settings);
    mix_targets
        .into_iter()
        .map(|mut mix_target| {
            if let Some(state) = stored_state.get(&mix_target.id) {
                mix_target.volume = clamp_level(state.volume);
                mix_target.mute = state.mute;
                mix_target.dim = state.dim;
                mix_target.mono = state.mono;
                mix_target.talkback = state.talkback;
            }
            mix_target
        })
        .collect()
}

pub(super) fn read_audio_snapshot_entries(
    settings: &HashMap<String, String>,
    inventory_snapshots: &[AudioSceneSnapshot],
) -> Vec<AudioSceneSnapshot> {
    let stored_state = settings
        .get(AUDIO_SNAPSHOTS_STATE_KEY)
        .and_then(|value| serde_json::from_str::<Vec<StoredAudioSnapshotState>>(value).ok());
    let source_state = stored_state.unwrap_or_else(|| {
        inventory_snapshots
            .iter()
            .map(|snapshot| StoredAudioSnapshotState {
                id: snapshot.id.clone(),
                name: snapshot.name.clone(),
                osc_index: snapshot.osc_index,
                order: snapshot.order,
                contents: snapshot.contents.clone(),
            })
            .collect()
    });
    normalize_audio_snapshot_entries(source_state)
}

pub(super) fn normalize_audio_snapshot_entries(
    snapshots: Vec<StoredAudioSnapshotState>,
) -> Vec<AudioSceneSnapshot> {
    let mut ordered = snapshots
        .into_iter()
        .enumerate()
        .filter_map(|(index, snapshot)| {
            let id = snapshot.id.trim();
            if id.is_empty() {
                return None;
            }
            let name = snapshot.name.trim();
            Some((
                snapshot.order.max(0),
                index,
                AudioSceneSnapshot {
                    id: String::from(id),
                    name: if name.is_empty() {
                        format!("Snapshot {}", clamp_snapshot_index(snapshot.osc_index) + 1)
                    } else {
                        String::from(name)
                    },
                    osc_index: clamp_snapshot_index(snapshot.osc_index),
                    order: snapshot.order.max(0),
                    last_recalled: false,
                    last_recalled_at: None,
                    contents: snapshot.contents,
                    preview: AudioScenePreviewSnapshot {
                        has_contents: false,
                        channel_count: 0,
                        mix_target_count: 0,
                        changed_channels: Vec::new(),
                        changed_mix_targets: Vec::new(),
                    },
                },
            ))
        })
        .collect::<Vec<_>>();
    ordered.sort_by_key(|(order, index, _)| (*order, *index));

    let mut normalized = ordered
        .into_iter()
        .map(|(_, _, snapshot)| snapshot)
        .collect::<Vec<_>>();
    reindex_audio_snapshots(&mut normalized);
    normalized
}

pub(super) fn serialize_audio_snapshot_state(
    snapshots: &[AudioSceneSnapshot],
) -> Result<String, AudioCommandError> {
    let stored_state = snapshots
        .iter()
        .enumerate()
        .map(|(order, snapshot)| StoredAudioSnapshotState {
            id: snapshot.id.clone(),
            name: snapshot.name.clone(),
            osc_index: clamp_snapshot_index(snapshot.osc_index),
            order: order as i64,
            contents: snapshot.contents.clone(),
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&stored_state)
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

pub(super) fn reindex_audio_snapshots(snapshots: &mut [AudioSceneSnapshot]) {
    for (index, snapshot) in snapshots.iter_mut().enumerate() {
        snapshot.order = index as i64;
    }
}

pub(super) fn read_channel_state_map(
    settings: &HashMap<String, String>,
) -> HashMap<String, StoredAudioChannelState> {
    read_json_state_map(settings, AUDIO_CHANNEL_STATE_KEY)
}

pub(super) fn read_mix_target_state_map(
    settings: &HashMap<String, String>,
) -> HashMap<String, StoredAudioMixTargetState> {
    read_json_state_map(settings, AUDIO_MIX_TARGET_STATE_KEY)
}

pub(super) fn read_json_state_map<T>(
    settings: &HashMap<String, String>,
    key: &str,
) -> HashMap<String, T>
where
    T: for<'de> Deserialize<'de>,
{
    settings
        .get(key)
        .and_then(|value| serde_json::from_str::<HashMap<String, T>>(value).ok())
        .unwrap_or_default()
}

pub(super) fn serialize_json_state<T>(
    state: &HashMap<String, T>,
) -> Result<String, AudioCommandError>
where
    T: Serialize,
{
    serde_json::to_string(state).map_err(|error| AudioCommandError::Storage(error.to_string()))
}

pub(super) fn resolve_audio_config(settings: &HashMap<String, String>) -> AudioBackendConfig {
    let send_host = settings
        .get(AUDIO_SEND_HOST_KEY)
        .cloned()
        .unwrap_or_else(|| String::from(DEFAULT_SEND_HOST));
    let send_port = settings
        .get(AUDIO_SEND_PORT_KEY)
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (1..=65535).contains(value))
        .unwrap_or(DEFAULT_SEND_PORT);
    let receive_port = settings
        .get(AUDIO_RECEIVE_PORT_KEY)
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (1..=65535).contains(value))
        .unwrap_or(DEFAULT_RECEIVE_PORT);

    AudioBackendConfig {
        send_host,
        send_port,
        receive_port,
    }
}

pub(super) fn ensure_audio_action_allowed(
    db_path: &Path,
    snapshot: &AudioSnapshot,
) -> Result<(), AudioCommandError> {
    if !snapshot.osc_enabled {
        let message = String::from(
            "Audio OSC transport is disabled in native audio settings. Re-enable it before sending native audio commands.",
        );
        record_audio_action_failure(db_path, "AUDIO_DISABLED", &message)?;
        return Err(AudioCommandError::Rejected("AUDIO_DISABLED", message));
    }

    let rejected = match snapshot.status.as_str() {
        "ready" => None,
        "attention" => Some((
            "AUDIO_PROBE_FAILED",
            String::from(
                "Audio transport is in attention state. Fix the OSC configuration and rerun the commissioning audio probe before sending native commands.",
            ),
        )),
        "not-verified" => Some((
            "AUDIO_NOT_VERIFIED",
            String::from(
                "Run the commissioning audio probe before syncing the console or recalling snapshots from the native engine.",
            ),
        )),
        _ => Some((
            "AUDIO_TRANSPORT_UNAVAILABLE",
            String::from(
                "Audio transport is unavailable. Configure OSC settings before sending native audio commands.",
            ),
        )),
    };

    if let Some((code, message)) = rejected {
        record_audio_action_failure(db_path, code, &message)?;
        return Err(AudioCommandError::Rejected(code, message));
    }

    Ok(())
}

pub(super) fn persist_audio_state(
    db_path: &Path,
    updates: &[(String, String)],
) -> Result<(), AudioCommandError> {
    set_settings_owned(db_path, updates)
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

pub(super) fn record_audio_action_failure(
    db_path: &Path,
    code: &str,
    message: &str,
) -> Result<(), AudioCommandError> {
    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("failed"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::from(code)),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                String::from(message),
            ),
        ],
    )
}

pub(super) fn current_timestamp(db_path: &Path) -> Result<String, AudioCommandError> {
    let connection =
        open_connection(db_path).map_err(|error| AudioCommandError::Storage(error.to_string()))?;
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

pub(super) fn audio_check_status(settings: &HashMap<String, String>) -> String {
    settings
        .get(&format!("app.commissioning.check.{AUDIO_CHECK_ID}.status"))
        .cloned()
        .unwrap_or_else(|| String::from("idle"))
}

pub(super) fn audio_console_state_confidence(settings: &HashMap<String, String>) -> String {
    match settings
        .get(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY)
        .map(String::as_str)
    {
        Some("aligned") => String::from("aligned"),
        Some("assumed") => String::from("assumed"),
        _ => String::from("unknown"),
    }
}

pub(super) fn read_optional_setting(
    settings: &HashMap<String, String>,
    key: &str,
) -> Option<String> {
    settings
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

pub(super) fn read_bool_setting(
    settings: &HashMap<String, String>,
    key: &str,
    default: bool,
) -> bool {
    match settings.get(key).map(String::as_str) {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    }
}

pub(super) fn read_i64_setting(settings: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    settings
        .get(key)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(default)
}

pub(super) fn audio_osc_enabled(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(settings, AUDIO_OSC_ENABLED_KEY, DEFAULT_AUDIO_OSC_ENABLED)
}

pub(super) fn audio_expected_peak_data(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(
        settings,
        AUDIO_EXPECTED_PEAK_DATA_KEY,
        DEFAULT_AUDIO_EXPECTED_PEAK_DATA,
    )
}

pub(super) fn audio_expected_submix_lock(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(
        settings,
        AUDIO_EXPECTED_SUBMIX_LOCK_KEY,
        DEFAULT_AUDIO_EXPECTED_SUBMIX_LOCK,
    )
}

pub(super) fn audio_expected_compatibility_mode(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(
        settings,
        AUDIO_EXPECTED_COMPATIBILITY_MODE_KEY,
        DEFAULT_AUDIO_EXPECTED_COMPATIBILITY_MODE,
    )
}

pub(super) fn audio_faders_per_bank(settings: &HashMap<String, String>) -> i64 {
    read_i64_setting(
        settings,
        AUDIO_FADERS_PER_BANK_KEY,
        DEFAULT_AUDIO_FADERS_PER_BANK,
    )
    .clamp(1, 24)
}

pub(super) fn audio_view_mode(settings: &HashMap<String, String>) -> String {
    match settings.get(AUDIO_VIEW_MODE_KEY).map(String::as_str) {
        Some("master") => String::from("master"),
        _ => String::from("submix"),
    }
}

pub(super) fn audio_capabilities(status: &str, osc_enabled: bool) -> AudioCapabilitySnapshot {
    AudioCapabilitySnapshot {
        can_edit_mixer_state: osc_enabled,
        can_sync: osc_enabled,
        can_recall_console_snapshot: osc_enabled && status == "ready",
        can_edit_processing: osc_enabled,
        can_clear_clips: osc_enabled,
        can_capture_snapshot: osc_enabled,
        can_use_master_view: osc_enabled,
    }
}

pub(super) fn audio_selected_channel_id(
    settings: &HashMap<String, String>,
    channels: &[AudioChannelSnapshot],
) -> Option<String> {
    let selected = read_optional_setting(settings, AUDIO_SELECTED_CHANNEL_ID_KEY);
    if let Some(value) = selected {
        if channels.iter().any(|entry| entry.id == value) {
            return Some(value);
        }
    }

    channels.first().map(|entry| entry.id.clone())
}

pub(super) fn audio_selected_mix_target_id(
    settings: &HashMap<String, String>,
    mix_targets: &[AudioMixTargetSnapshot],
) -> String {
    let selected = read_optional_setting(settings, AUDIO_SELECTED_MIX_TARGET_ID_KEY);
    if let Some(value) = selected {
        if mix_targets.iter().any(|entry| entry.id == value) {
            return value;
        }
    }

    mix_targets
        .first()
        .map(|entry| entry.id.clone())
        .unwrap_or_else(|| String::from("audio-mix-main"))
}

pub(super) fn clamp_level(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

pub(super) fn clamp_gain(value: i64) -> i64 {
    value.clamp(0, 75)
}

pub(super) fn clamp_snapshot_index(value: i64) -> i64 {
    value.clamp(0, 7)
}

pub(super) fn clamp_eq_frequency(value: f64) -> f64 {
    value.clamp(20.0, 20_000.0)
}

pub(super) fn clamp_eq_gain(value: f64) -> f64 {
    value.clamp(-12.0, 12.0)
}

pub(super) fn clamp_eq_q(value: f64) -> f64 {
    value.clamp(0.1, 12.0)
}

pub(super) fn clamp_dynamics_threshold(value: f64) -> f64 {
    value.clamp(-80.0, 0.0)
}

pub(super) fn clamp_dynamics_ratio(value: f64) -> f64 {
    value.clamp(1.0, 20.0)
}

pub(super) fn clamp_dynamics_time(value: f64) -> f64 {
    value.clamp(0.1, 2000.0)
}

pub(super) fn clamp_dynamics_makeup(value: f64) -> f64 {
    value.clamp(0.0, 24.0)
}

pub(super) fn next_custom_audio_snapshot_id(snapshots: &[AudioSceneSnapshot]) -> String {
    let next_index = snapshots
        .iter()
        .filter_map(|snapshot| {
            snapshot
                .id
                .strip_prefix(AUDIO_CUSTOM_SNAPSHOT_ID_PREFIX)
                .and_then(|value| value.parse::<usize>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;

    format!("{AUDIO_CUSTOM_SNAPSHOT_ID_PREFIX}{next_index}")
}

pub(super) fn channel_supports_gain(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

pub(super) fn channel_supports_phantom(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

pub(super) fn channel_supports_pad(channel: &AudioChannelSnapshot) -> bool {
    let _ = channel;
    false
}

pub(super) fn channel_supports_instrument(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

pub(super) fn channel_supports_auto_set(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

pub(super) fn channel_supports_phase(channel: &AudioChannelSnapshot) -> bool {
    channel.role != "playback-pair"
}

pub(super) fn channel_supports_gain_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_gain)
        .unwrap_or(false)
}

pub(super) fn channel_supports_phantom_from_role(
    snapshot: &AudioSnapshot,
    channel_id: &str,
) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_phantom)
        .unwrap_or(false)
}

pub(super) fn channel_supports_phase_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_phase)
        .unwrap_or(false)
}

pub(super) fn channel_supports_pad_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_pad)
        .unwrap_or(false)
}

pub(super) fn stored_channel_state_from_snapshot(
    channel: &AudioChannelSnapshot,
) -> StoredAudioChannelState {
    StoredAudioChannelState {
        name: Some(channel.name.clone()),
        gain: channel.gain,
        fader: channel.fader,
        clip: channel.clip,
        mix_levels: channel.mix_levels.clone(),
        mute: channel.mute,
        solo: channel.solo,
        phantom: channel.phantom,
        phase: channel.phase,
        pad: false,
        instrument: channel.instrument,
        auto_set: channel.auto_set,
        eq: channel.eq.clone(),
        dynamics: channel.dynamics.clone(),
        send_modes: channel.send_modes.clone(),
    }
}

pub(super) fn stored_mix_target_state_from_snapshot(
    mix_target: &AudioMixTargetSnapshot,
) -> StoredAudioMixTargetState {
    StoredAudioMixTargetState {
        volume: mix_target.volume,
        mute: mix_target.mute,
        dim: mix_target.dim,
        mono: mix_target.mono,
        talkback: mix_target.talkback,
    }
}

pub(super) fn capture_audio_scene_contents(
    snapshot: &AudioSnapshot,
    captured_at: Option<String>,
) -> AudioSceneContentsSnapshot {
    AudioSceneContentsSnapshot {
        captured_at,
        channels: snapshot
            .channels
            .iter()
            .map(|channel| {
                (
                    channel.id.clone(),
                    stored_channel_state_from_snapshot(channel),
                )
            })
            .collect(),
        mix_targets: snapshot
            .mix_targets
            .iter()
            .map(|target| {
                (
                    target.id.clone(),
                    stored_mix_target_state_from_snapshot(target),
                )
            })
            .collect(),
    }
}

pub(super) fn audio_scene_preview(
    contents: Option<&AudioSceneContentsSnapshot>,
    channels: &[AudioChannelSnapshot],
    mix_targets: &[AudioMixTargetSnapshot],
) -> AudioScenePreviewSnapshot {
    let Some(contents) = contents else {
        return AudioScenePreviewSnapshot {
            has_contents: false,
            channel_count: 0,
            mix_target_count: 0,
            changed_channels: Vec::new(),
            changed_mix_targets: Vec::new(),
        };
    };

    let changed_channels = channels
        .iter()
        .filter_map(|channel| {
            let state = contents.channels.get(&channel.id)?;
            let current = stored_channel_state_from_snapshot(channel);
            if audio_channel_state_changed(&current, state) {
                Some(channel.name.clone())
            } else {
                None
            }
        })
        .take(6)
        .collect::<Vec<_>>();
    let changed_mix_targets = mix_targets
        .iter()
        .filter_map(|target| {
            let state = contents.mix_targets.get(&target.id)?;
            let current = stored_mix_target_state_from_snapshot(target);
            if audio_mix_target_state_changed(&current, state) {
                Some(target.name.clone())
            } else {
                None
            }
        })
        .take(4)
        .collect::<Vec<_>>();

    AudioScenePreviewSnapshot {
        has_contents: true,
        channel_count: contents.channels.len() as i64,
        mix_target_count: contents.mix_targets.len() as i64,
        changed_channels,
        changed_mix_targets,
    }
}

pub(super) fn default_send_modes_for_mix_targets(
    existing: HashMap<String, AudioSendModeSnapshot>,
    mix_levels: &HashMap<String, f64>,
) -> HashMap<String, AudioSendModeSnapshot> {
    let mut send_modes = existing;
    for mix_target_id in mix_levels.keys() {
        send_modes
            .entry(mix_target_id.clone())
            .or_insert_with(default_audio_send_mode_snapshot);
    }
    send_modes
}

fn audio_channel_state_changed(
    current: &StoredAudioChannelState,
    stored: &StoredAudioChannelState,
) -> bool {
    current.name != stored.name
        || current.gain != stored.gain
        || (current.fader - stored.fader).abs() > f64::EPSILON
        || current.clip != stored.clip
        || current.mute != stored.mute
        || current.solo != stored.solo
        || current.phantom != stored.phantom
        || current.phase != stored.phase
        || current.instrument != stored.instrument
        || current.auto_set != stored.auto_set
        || current.mix_levels != stored.mix_levels
        || current.send_modes != stored.send_modes
}

fn audio_mix_target_state_changed(
    current: &StoredAudioMixTargetState,
    stored: &StoredAudioMixTargetState,
) -> bool {
    (current.volume - stored.volume).abs() > f64::EPSILON
        || current.mute != stored.mute
        || current.dim != stored.dim
        || current.mono != stored.mono
        || current.talkback != stored.talkback
}

pub(super) fn channel_supports_instrument_from_role(
    snapshot: &AudioSnapshot,
    channel_id: &str,
) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_instrument)
        .unwrap_or(false)
}

pub(super) fn channel_supports_auto_set_from_role(
    snapshot: &AudioSnapshot,
    channel_id: &str,
) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_auto_set)
        .unwrap_or(false)
}

pub(super) struct AudioSummaryContext<'a> {
    pub(super) status: &'a str,
    pub(super) config: &'a AudioBackendConfig,
    pub(super) osc_enabled: bool,
    pub(super) channel_count: usize,
    pub(super) mix_target_count: usize,
    pub(super) snapshot_count: usize,
    pub(super) last_console_sync_at: Option<&'a str>,
    pub(super) last_console_sync_reason: Option<&'a str>,
    pub(super) last_recalled_snapshot_id: Option<&'a str>,
    pub(super) last_snapshot_recall_at: Option<&'a str>,
    pub(super) last_action_status: &'a str,
    pub(super) last_action_code: Option<&'a str>,
    pub(super) last_action_message: Option<&'a str>,
}

pub(super) fn audio_summary(context: AudioSummaryContext<'_>) -> String {
    let AudioSummaryContext {
        status,
        config,
        osc_enabled,
        channel_count,
        mix_target_count,
        snapshot_count,
        last_console_sync_at,
        last_console_sync_reason,
        last_recalled_snapshot_id,
        last_snapshot_recall_at,
        last_action_status,
        last_action_code,
        last_action_message,
    } = context;

    let transport_summary = if !osc_enabled {
        format!(
            "OSC transport is disabled in native audio settings. Last configured endpoint is {}:{} with receive port {}. Simulated inventory still exposes {} channels, {} mix targets, and {} snapshots.",
            config.send_host, config.send_port, config.receive_port, channel_count, mix_target_count, snapshot_count
        )
    } else {
        match status {
            "ready" => format!(
                "OSC transport is configured for {}:{} with receive port {}. Simulated inventory exposes {} channels, {} mix targets, and {} snapshots for native audio development.",
                config.send_host, config.send_port, config.receive_port, channel_count, mix_target_count, snapshot_count
            ),
            "attention" => format!(
                "OSC transport check failed for {}:{} / {}. Simulated inventory still exposes {} channels, {} mix targets, and {} snapshots while connectivity is corrected.",
                config.send_host, config.send_port, config.receive_port, channel_count, mix_target_count, snapshot_count
            ),
            _ => format!(
                "OSC transport is configured for {}:{} with receive port {}. Simulated inventory exposes {} channels, {} mix targets, and {} snapshots before the native audio probe runs.",
                config.send_host, config.send_port, config.receive_port, channel_count, mix_target_count, snapshot_count
            ),
        }
    };

    let sync_summary = match last_console_sync_at {
        Some(timestamp) => format!(
            " Last console sync: {}{}.",
            timestamp,
            last_console_sync_reason
                .map(|reason| format!(" ({reason})"))
                .unwrap_or_default()
        ),
        None => String::from(" No console sync has been recorded yet."),
    };

    let recall_summary = match last_recalled_snapshot_id {
        Some(snapshot_id) => format!(
            " Last snapshot recall: {}{}.",
            snapshot_id,
            last_snapshot_recall_at
                .map(|timestamp| format!(" at {timestamp}"))
                .unwrap_or_default()
        ),
        None => String::from(" No audio snapshot recall has been recorded yet."),
    };

    let action_summary = match last_action_status {
        "failed" => format!(
            " Last action failed{}{}",
            last_action_code
                .map(|code| format!(" ({code})"))
                .unwrap_or_default(),
            last_action_message
                .map(|message| format!(": {message}."))
                .unwrap_or_else(|| String::from("."))
        ),
        "succeeded" => last_action_message
            .map(|message| format!(" Last action: {message}."))
            .unwrap_or_default(),
        _ => String::new(),
    };

    format!("{transport_summary}{sync_summary}{recall_summary}{action_summary}")
}
