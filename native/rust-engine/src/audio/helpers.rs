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
                channel.eq = normalize_audio_eq_snapshot(&state.eq);
                channel.dynamics = state.dynamics.clone();
                for (mix_target_id, level) in &state.mix_levels {
                    channel
                        .mix_levels
                        .insert(mix_target_id.clone(), clamp_level(*level));
                }
            }
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
                if let Some(name) = state
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    mix_target.name = String::from(name);
                }
                mix_target.volume = clamp_level(state.volume);
                mix_target.mute = state.mute;
                mix_target.dim = state.dim;
                mix_target.mono = state.mono;
            }
            mix_target
        })
        .collect()
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
    let simulated_env_enabled = std::env::var("SSE_AUDIO_SIMULATED_INPUT_MODE")
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    let metering_source = if simulated_env_enabled {
        String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE)
    } else {
        settings
            .get(AUDIO_METERING_SOURCE_KEY)
            .filter(|value| value.as_str() == crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE)
            .cloned()
            .unwrap_or_else(|| String::from(DEFAULT_AUDIO_METERING_SOURCE))
    };

    AudioBackendConfig {
        send_host,
        send_port,
        receive_port,
        metering_source,
    }
}

pub(crate) fn ensure_audio_action_allowed(
    db_path: &Path,
    snapshot: &AudioSnapshot,
) -> Result<(), AudioCommandError> {
    if !snapshot.osc_enabled {
        let message = String::from(
            "Audio control is switched off in Setup. Turn OSC back on before changing console settings.",
        );
        record_audio_action_failure(db_path, "AUDIO_DISABLED", &message)?;
        return Err(AudioCommandError::Rejected("AUDIO_DISABLED", message));
    }

    let rejected = match snapshot.status.as_str() {
        "ready" => None,
        "attention" => Some((
            "AUDIO_PROBE_FAILED",
            String::from(
                "The console link failed its last probe. Check that TotalMix is running with remote 4 in Global OSC mode, then run the audio probe again.",
            ),
        )),
        "not-verified" => Some((
            "AUDIO_NOT_VERIFIED",
            String::from(
                "Audio is not verified yet. Run the audio probe before changing console settings.",
            ),
        )),
        _ => Some((
            "AUDIO_TRANSPORT_UNAVAILABLE",
            String::from(
                "The audio console link is not configured. Set the OSC ports in Setup before changing console settings.",
            ),
        )),
    };

    if let Some((code, message)) = rejected {
        record_audio_action_failure(db_path, code, &message)?;
        return Err(AudioCommandError::Rejected(code, message));
    }

    Ok(())
}

/// True when the resolved metering source is the simulated input mode
/// (`SSE_AUDIO_SIMULATED_INPUT_MODE` or the persisted setting). Commissioning
/// uses this to let the audio probe pass on hosts without TotalMix while the
/// UI keeps labelling the console "test simulation".
pub(crate) fn audio_metering_is_simulated(settings: &HashMap<String, String>) -> bool {
    resolve_audio_config(settings).metering_source
        == crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE
}

pub(super) fn persist_audio_state(
    db_path: &Path,
    updates: &[(String, String)],
) -> Result<(), AudioCommandError> {
    set_settings_owned(db_path, updates)
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

/// `persist_audio_state` with action-log rows in the same transaction: the
/// console flush runs on the metering thread, where a second wait for the
/// disk would show in the meters (Slice 11 — F30).
pub(super) fn persist_audio_state_with_actions(
    db_path: &Path,
    updates: &[(String, String)],
    actions: &[crate::action_log::ActionRecord],
) -> Result<(), AudioCommandError> {
    crate::storage::set_settings_owned_and(db_path, updates, |transaction| {
        crate::action_log::insert_actions(transaction, actions)
    })
    .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

/// Serialises every read-modify-write of the two JSON state blobs
/// (`channels_state`, `mix_targets_state`). SQLite already serialises the
/// writes themselves; this protects the read → modify → write window against
/// the console-link flush on the metering thread. Lock order everywhere:
/// `AUDIO_STATE_LOCK` first, then the shared console link.
static AUDIO_STATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(super) fn lock_audio_state() -> std::sync::MutexGuard<'static, ()> {
    AUDIO_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The only vocabulary for console-state confidence. `Aligned` is written
/// solely after a complete console pull (a Sync, or the read-back after a
/// load in TotalMix) or a load on the simulated console; `Assumed` when a
/// send goes unconfirmed; `Unknown` when the
/// transport changes, the console reports disconnected, a pull fails, or a
/// flush's write failed and dropped what the desk reported (written by the
/// next flush that works).
/// Ordinary edits never write confidence at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConsoleConfidence {
    Aligned,
    Assumed,
    Unknown,
}

impl ConsoleConfidence {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Aligned => "aligned",
            Self::Assumed => "assumed",
            Self::Unknown => "unknown",
        }
    }
}

/// The single producer of the confidence setting write; every persist batch
/// that moves confidence goes through here (see the source-scan test).
pub(crate) fn confidence_setting(value: ConsoleConfidence) -> (String, String) {
    (
        String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
        String::from(value.as_str()),
    )
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
    // Hardware-facing capabilities follow the same gate as the engine commands
    // (`ensure_audio_action_allowed`): OSC must be on AND the audio probe must
    // have passed. App-local capabilities (clip latches, the master view) only
    // need OSC on, because they never reach TotalMix.
    let console_ready = osc_enabled && status == "ready";
    AudioCapabilitySnapshot {
        can_edit_mixer_state: console_ready,
        can_sync: console_ready,
        can_recall_console_snapshot: console_ready,
        can_edit_processing: console_ready,
        can_clear_clips: osc_enabled,
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

pub(super) fn clamp_eq_frequency(value: f64) -> f64 {
    value.clamp(20.0, 20_000.0)
}

pub(super) fn clamp_eq_gain(value: f64) -> f64 {
    value.clamp(-20.0, 20.0)
}

pub(super) fn clamp_eq_q(value: f64) -> f64 {
    value.clamp(0.4, 9.9)
}

pub(super) fn clamp_low_cut_frequency(value: f64) -> f64 {
    value.clamp(20.0, 500.0)
}

pub(super) fn normalize_low_cut_slope(value: i64) -> i64 {
    match value {
        6 | 12 | 18 | 24 => value,
        _ if value < 9 => 6,
        _ if value < 15 => 12,
        _ if value < 21 => 18,
        _ => 24,
    }
}

pub(super) fn normalize_audio_eq_snapshot(eq: &AudioEqSnapshot) -> AudioEqSnapshot {
    let defaults = default_audio_eq_snapshot();
    let old_low_cut = eq.bands.iter().find(|band| band.id == "lc");
    let low_cut = AudioLowCutSnapshot {
        enabled: old_low_cut
            .map(|band| band.enabled)
            .unwrap_or(eq.low_cut.enabled),
        frequency_hz: clamp_low_cut_frequency(
            old_low_cut
                .map(|band| band.frequency_hz)
                .unwrap_or(eq.low_cut.frequency_hz),
        ),
        slope_db_per_octave: normalize_low_cut_slope(eq.low_cut.slope_db_per_octave),
    };

    let mut bands = Vec::with_capacity(3);
    for default_band in defaults.bands {
        let legacy_id = match default_band.id.as_str() {
            "1" => "lo",
            "2" => "mid",
            "3" => "hi",
            _ => default_band.id.as_str(),
        };
        let source = eq
            .bands
            .iter()
            .find(|band| band.id == default_band.id || band.id == legacy_id);
        let source_enabled = source.map(|band| band.enabled).unwrap_or(true);
        let mut band = source.cloned().unwrap_or(default_band.clone());
        band.id = default_band.id;
        band.label = default_band.label;
        band.frequency_hz = clamp_eq_frequency(band.frequency_hz);
        band.gain_db = clamp_eq_gain(band.gain_db);
        if !source_enabled {
            band.gain_db = 0.0;
        }
        band.q = clamp_eq_q(band.q);
        band.band_type = normalize_eq_band_type(&band.id, &band.band_type);
        band.enabled = true;
        bands.push(band);
    }

    AudioEqSnapshot {
        enabled: eq.enabled,
        low_cut,
        hardware_status: match eq.hardware_status.as_str() {
            "pending" | "confirmed" => eq.hardware_status.clone(),
            _ => String::from("local"),
        },
        bands,
    }
}

pub(super) fn normalize_eq_band_type(band_id: &str, band_type: &str) -> String {
    match band_id {
        "1" => match band_type {
            "low-shelf" | "high-pass" | "low-pass" => String::from(band_type),
            _ => String::from("bell"),
        },
        "2" => String::from("bell"),
        "3" => match band_type {
            "high-shelf" | "low-pass" | "high-pass" => String::from(band_type),
            "shelf" => String::from("high-shelf"),
            _ => String::from("bell"),
        },
        _ => String::from("bell"),
    }
}

pub(super) fn eq_band_type_supported(band_id: &str, band_type: &str) -> bool {
    match band_id {
        "1" => matches!(band_type, "bell" | "low-shelf" | "high-pass" | "low-pass"),
        "2" => band_type == "bell",
        "3" => matches!(band_type, "bell" | "high-shelf" | "low-pass" | "high-pass"),
        _ => false,
    }
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
    }
}

pub(super) fn stored_mix_target_state_from_snapshot(
    mix_target: &AudioMixTargetSnapshot,
) -> StoredAudioMixTargetState {
    StoredAudioMixTargetState {
        name: Some(mix_target.name.clone()),
        volume: mix_target.volume,
        mute: mix_target.mute,
        dim: mix_target.dim,
        mono: mix_target.mono,
    }
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
    pub(super) metering_source: &'a str,
    pub(super) channel_count: usize,
    pub(super) mix_target_count: usize,
    pub(super) last_console_sync_at: Option<&'a str>,
    pub(super) last_console_sync_reason: Option<&'a str>,
    pub(super) last_action_status: &'a str,
    pub(super) last_action_code: Option<&'a str>,
    pub(super) last_action_message: Option<&'a str>,
}

pub(super) fn audio_summary(context: AudioSummaryContext<'_>) -> String {
    let AudioSummaryContext {
        status,
        config,
        osc_enabled,
        metering_source,
        channel_count,
        mix_target_count,
        last_console_sync_at,
        last_console_sync_reason,
        last_action_status,
        last_action_code,
        last_action_message,
    } = context;

    let transport_summary = if !osc_enabled {
        format!(
            "OSC control is switched off in Setup. The last endpoint was {}:{} (receive ports {}-{}).",
            config.send_host,
            config.send_port,
            config.receive_port,
            config.receive_port.saturating_add(2)
        )
    } else if metering_source == crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE {
        format!(
            "Test mode: the console is simulated and nothing reaches TotalMix. {} channels and {} outputs.",
            channel_count, mix_target_count
        )
    } else {
        match status {
            "ready" => format!(
                "TotalMix on {} is answering (port incoming {}-{}, port outgoing {}-{}): {} channels and {} outputs.",
                config.send_host,
                config.send_port,
                config.send_port.saturating_add(2),
                config.receive_port,
                config.receive_port.saturating_add(2),
                channel_count,
                mix_target_count
            ),
            "attention" => format!(
                "No meter data from TotalMix on {}. In TotalMix Options › Settings › OSC, check remote controllers 1–3 (port incoming {}-{}, port outgoing {}-{}), turn on Send Peak Level Data, and keep remote 4 in Global OSC mode.",
                config.send_host,
                config.send_port,
                config.send_port.saturating_add(2),
                config.receive_port,
                config.receive_port.saturating_add(2)
            ),
            _ => format!(
                "TotalMix is not verified yet. In TotalMix Options › Settings › OSC, set remote controllers 1–3 to port incoming {}-{} and port outgoing {}-{}, turn on Send Peak Level Data, then run the audio probe.",
                config.send_port,
                config.send_port.saturating_add(2),
                config.receive_port,
                config.receive_port.saturating_add(2)
            ),
        }
    };

    let sync_summary = match last_console_sync_at {
        Some(timestamp) => format!(
            " Last console sync: {}{}.",
            timestamp,
            last_console_sync_reason
                .map(|reason| format!(" ({})", sync_reason_words(reason)))
                .unwrap_or_default()
        ),
        None => String::from(" No console sync has been recorded yet."),
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

    format!("{transport_summary}{sync_summary}{action_summary}")
}

/// What brought the console in line, in the operator's words: the saved
/// reasons are codes, and some say "snapshot".
fn sync_reason_words(reason: &str) -> &str {
    match reason {
        "console-pull" => "Sync from TotalMix",
        "snapshot-load" => "a mix loaded in TotalMix",
        "simulated-load" => "a mix loaded on the simulated console",
        "simulated-sync" => "Sync on the simulated console",
        // The builds before 2026-10-01 wrote these for their own recall.
        "snapshot" | "snapshot-push" => "a recall",
        other => other,
    }
}
