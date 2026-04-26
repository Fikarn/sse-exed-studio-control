use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio_backend::{
    read_default_audio_inventory, recall_default_audio_snapshot, sync_default_audio_console,
    update_default_audio_channel, update_default_audio_mix_target, AudioBackendConfig,
};
use crate::commissioning::{
    AUDIO_CHECK_ID, AUDIO_RECEIVE_PORT_KEY, AUDIO_SEND_HOST_KEY, AUDIO_SEND_PORT_KEY,
};
use crate::storage::{list_settings_by_prefix, open_connection, set_settings_owned};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

const DEFAULT_SEND_HOST: &str = "127.0.0.1";
const DEFAULT_SEND_PORT: i64 = 7001;
const DEFAULT_RECEIVE_PORT: i64 = 9001;

const AUDIO_CONSOLE_STATE_CONFIDENCE_KEY: &str = "app.audio.console_state_confidence";
const AUDIO_LAST_CONSOLE_SYNC_AT_KEY: &str = "app.audio.last_console_sync_at";
const AUDIO_LAST_CONSOLE_SYNC_REASON_KEY: &str = "app.audio.last_console_sync_reason";
const AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY: &str = "app.audio.last_recalled_snapshot_id";
const AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY: &str = "app.audio.last_snapshot_recall_at";
const AUDIO_LAST_ACTION_STATUS_KEY: &str = "app.audio.last_action_status";
const AUDIO_LAST_ACTION_CODE_KEY: &str = "app.audio.last_action_code";
const AUDIO_LAST_ACTION_MESSAGE_KEY: &str = "app.audio.last_action_message";
const AUDIO_CHANNEL_STATE_KEY: &str = "app.audio.channels_state";
const AUDIO_MIX_TARGET_STATE_KEY: &str = "app.audio.mix_targets_state";
const AUDIO_SNAPSHOTS_STATE_KEY: &str = "app.audio.snapshots_state";
const AUDIO_OSC_ENABLED_KEY: &str = "app.audio.osc_enabled";
const AUDIO_SELECTED_CHANNEL_ID_KEY: &str = "app.audio.selected_channel_id";
const AUDIO_SELECTED_MIX_TARGET_ID_KEY: &str = "app.audio.selected_mix_target_id";
const AUDIO_EXPECTED_PEAK_DATA_KEY: &str = "app.audio.expected_peak_data";
const AUDIO_EXPECTED_SUBMIX_LOCK_KEY: &str = "app.audio.expected_submix_lock";
const AUDIO_EXPECTED_COMPATIBILITY_MODE_KEY: &str = "app.audio.expected_compatibility_mode";
const AUDIO_FADERS_PER_BANK_KEY: &str = "app.audio.faders_per_bank";
const AUDIO_CUSTOM_SNAPSHOT_ID_PREFIX: &str = "audio-snapshot-custom-";

const DEFAULT_AUDIO_OSC_ENABLED: bool = true;
const DEFAULT_AUDIO_EXPECTED_PEAK_DATA: bool = true;
const DEFAULT_AUDIO_EXPECTED_SUBMIX_LOCK: bool = true;
const DEFAULT_AUDIO_EXPECTED_COMPATIBILITY_MODE: bool = false;
const DEFAULT_AUDIO_FADERS_PER_BANK: i64 = 12;

#[derive(Debug, Serialize, Clone)]
pub struct AudioSnapshot {
    pub status: String,
    pub summary: String,
    #[serde(rename = "adapterMode")]
    pub adapter_mode: String,
    #[serde(rename = "sendHost")]
    pub send_host: String,
    #[serde(rename = "sendPort")]
    pub send_port: i64,
    #[serde(rename = "receivePort")]
    pub receive_port: i64,
    #[serde(rename = "oscEnabled")]
    pub osc_enabled: bool,
    pub connected: bool,
    pub verified: bool,
    #[serde(rename = "meteringState")]
    pub metering_state: String,
    #[serde(rename = "selectedChannelId")]
    pub selected_channel_id: Option<String>,
    #[serde(rename = "selectedMixTargetId")]
    pub selected_mix_target_id: String,
    #[serde(rename = "expectedPeakData")]
    pub expected_peak_data: bool,
    #[serde(rename = "expectedSubmixLock")]
    pub expected_submix_lock: bool,
    #[serde(rename = "expectedCompatibilityMode")]
    pub expected_compatibility_mode: bool,
    #[serde(rename = "fadersPerBank")]
    pub faders_per_bank: i64,
    #[serde(rename = "consoleStateConfidence")]
    pub console_state_confidence: String,
    #[serde(rename = "lastConsoleSyncAt")]
    pub last_console_sync_at: Option<String>,
    #[serde(rename = "lastConsoleSyncReason")]
    pub last_console_sync_reason: Option<String>,
    #[serde(rename = "lastRecalledSnapshotId")]
    pub last_recalled_snapshot_id: Option<String>,
    #[serde(rename = "lastSnapshotRecallAt")]
    pub last_snapshot_recall_at: Option<String>,
    #[serde(rename = "lastActionStatus")]
    pub last_action_status: String,
    #[serde(rename = "lastActionCode")]
    pub last_action_code: Option<String>,
    #[serde(rename = "lastActionMessage")]
    pub last_action_message: Option<String>,
    pub channels: Vec<AudioChannelSnapshot>,
    #[serde(rename = "mixTargets")]
    pub mix_targets: Vec<AudioMixTargetSnapshot>,
    pub snapshots: Vec<AudioSceneSnapshot>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioChannelSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "shortName")]
    pub short_name: String,
    pub role: String,
    pub stereo: bool,
    pub gain: i64,
    pub fader: f64,
    #[serde(rename = "meterLeft")]
    pub meter_left: f64,
    #[serde(rename = "meterRight")]
    pub meter_right: f64,
    #[serde(rename = "meterLevel")]
    pub meter_level: f64,
    #[serde(rename = "peakHold")]
    pub peak_hold: f64,
    pub clip: bool,
    #[serde(rename = "mixLevels")]
    pub mix_levels: HashMap<String, f64>,
    pub mute: bool,
    pub solo: bool,
    pub phantom: bool,
    pub phase: bool,
    pub pad: bool,
    pub instrument: bool,
    #[serde(rename = "autoSet")]
    pub auto_set: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioMixTargetSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "shortName")]
    pub short_name: String,
    pub role: String,
    pub volume: f64,
    pub mute: bool,
    pub dim: bool,
    pub mono: bool,
    pub talkback: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioSceneSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "oscIndex")]
    pub osc_index: i64,
    pub order: i64,
    #[serde(rename = "lastRecalled")]
    pub last_recalled: bool,
    #[serde(rename = "lastRecalledAt")]
    pub last_recalled_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAudioChannelState {
    pub gain: i64,
    pub fader: f64,
    #[serde(rename = "mixLevels")]
    pub mix_levels: HashMap<String, f64>,
    pub mute: bool,
    pub solo: bool,
    pub phantom: bool,
    pub phase: bool,
    pub pad: bool,
    pub instrument: bool,
    #[serde(rename = "autoSet")]
    pub auto_set: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAudioMixTargetState {
    pub volume: f64,
    pub mute: bool,
    pub dim: bool,
    pub mono: bool,
    pub talkback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAudioSnapshotState {
    pub id: String,
    pub name: String,
    #[serde(rename = "oscIndex")]
    pub osc_index: i64,
    pub order: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioHealthCheck {
    pub ok: bool,
    pub status: String,
    pub summary: String,
    #[serde(rename = "sendHost")]
    pub send_host: String,
    #[serde(rename = "sendPort")]
    pub send_port: i64,
    #[serde(rename = "receivePort")]
    pub receive_port: i64,
    pub verified: bool,
    #[serde(rename = "meteringState")]
    pub metering_state: String,
}

#[derive(Debug, Serialize)]
pub struct AudioSyncResult {
    pub synced: bool,
    #[serde(rename = "syncedAt")]
    pub synced_at: String,
    pub summary: String,
    #[serde(rename = "consoleStateConfidence")]
    pub console_state_confidence: String,
}

#[derive(Debug, Serialize)]
pub struct AudioSnapshotCreateResult {
    pub snapshot: AudioSceneSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct AudioSnapshotUpdateResult {
    pub snapshot: AudioSceneSnapshot,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct AudioSnapshotDeleteResult {
    pub deleted: bool,
    #[serde(rename = "snapshotId")]
    pub snapshot_id: String,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct AudioSnapshotRecallResult {
    pub recalled: bool,
    #[serde(rename = "snapshotId")]
    pub snapshot_id: String,
    #[serde(rename = "snapshotName")]
    pub snapshot_name: String,
    #[serde(rename = "recalledAt")]
    pub recalled_at: String,
    pub summary: String,
    #[serde(rename = "consoleStateConfidence")]
    pub console_state_confidence: String,
}

#[derive(Debug)]
pub enum AudioCommandError {
    Rejected(&'static str, String),
    Storage(String),
}

#[derive(Debug, Clone)]
pub struct AudioSnapshotRecallRequest {
    pub snapshot_id: String,
}

#[derive(Debug, Clone)]
pub struct AudioSnapshotCreateRequest {
    pub name: String,
    pub osc_index: i64,
}

#[derive(Debug, Clone)]
pub struct AudioSnapshotUpdateRequest {
    pub snapshot_id: String,
    pub name: Option<String>,
    pub osc_index: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct AudioSnapshotDeleteRequest {
    pub snapshot_id: String,
}

#[derive(Debug, Clone)]
pub struct AudioChannelUpdateRequest {
    pub channel_id: String,
    pub mix_target_id: Option<String>,
    pub gain: Option<i64>,
    pub fader: Option<f64>,
    pub mute: Option<bool>,
    pub solo: Option<bool>,
    pub phantom: Option<bool>,
    pub phase: Option<bool>,
    pub pad: Option<bool>,
    pub instrument: Option<bool>,
    pub auto_set: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AudioMixTargetUpdateRequest {
    pub mix_target_id: String,
    pub volume: Option<f64>,
    pub mute: Option<bool>,
    pub dim: Option<bool>,
    pub mono: Option<bool>,
    pub talkback: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AudioSettingsUpdateRequest {
    pub osc_enabled: Option<bool>,
    pub send_host: Option<String>,
    pub send_port: Option<i64>,
    pub receive_port: Option<i64>,
    pub selected_channel_id: Option<Option<String>>,
    pub selected_mix_target_id: Option<String>,
    pub expected_peak_data: Option<bool>,
    pub expected_submix_lock: Option<bool>,
    pub expected_compatibility_mode: Option<bool>,
    pub faders_per_bank: Option<i64>,
}

pub fn parse_audio_snapshot_recall_request(
    params: &Value,
) -> Result<AudioSnapshotRecallRequest, String> {
    let snapshot_id = params
        .get("snapshotId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("snapshotId is required"))?;

    Ok(AudioSnapshotRecallRequest {
        snapshot_id: String::from(snapshot_id),
    })
}

pub fn parse_audio_snapshot_create_request(
    params: &Value,
) -> Result<AudioSnapshotCreateRequest, String> {
    let name = optional_trimmed_string(params.get("name"), "name")?
        .map(|value| validate_audio_snapshot_name(value, "name"))
        .transpose()?
        .ok_or_else(|| String::from("name is required"))?;
    let osc_index = optional_integer_range(params.get("oscIndex"), "oscIndex", 0, 7)?
        .ok_or_else(|| String::from("oscIndex is required"))?;

    Ok(AudioSnapshotCreateRequest { name, osc_index })
}

pub fn parse_audio_snapshot_update_request(
    params: &Value,
) -> Result<AudioSnapshotUpdateRequest, String> {
    let snapshot_id = params
        .get("snapshotId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("snapshotId is required"))?;
    let name = optional_trimmed_string(params.get("name"), "name")?
        .map(|value| validate_audio_snapshot_name(value, "name"))
        .transpose()?;
    let osc_index = optional_integer_range(params.get("oscIndex"), "oscIndex", 0, 7)?;

    if name.is_none() && osc_index.is_none() {
        return Err(String::from(
            "audio.snapshot.update requires one or more supported fields",
        ));
    }

    Ok(AudioSnapshotUpdateRequest {
        snapshot_id: String::from(snapshot_id),
        name,
        osc_index,
    })
}

pub fn parse_audio_snapshot_delete_request(
    params: &Value,
) -> Result<AudioSnapshotDeleteRequest, String> {
    let snapshot_id = params
        .get("snapshotId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("snapshotId is required"))?;

    Ok(AudioSnapshotDeleteRequest {
        snapshot_id: String::from(snapshot_id),
    })
}

pub fn parse_audio_channel_update_request(
    params: &Value,
) -> Result<AudioChannelUpdateRequest, String> {
    let channel_id = params
        .get("channelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("channelId is required"))?;

    let mix_target_id = params
        .get("mixTargetId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);
    let gain = optional_gain(params.get("gain"), "gain")?;
    let fader = optional_level(params.get("fader"), "fader")?;
    let mute = optional_bool(params.get("mute"), "mute")?;
    let solo = optional_bool(params.get("solo"), "solo")?;
    let phantom = optional_bool(params.get("phantom"), "phantom")?;
    let phase = optional_bool(params.get("phase"), "phase")?;
    let pad = optional_bool(params.get("pad"), "pad")?;
    let instrument = optional_bool(params.get("instrument"), "instrument")?;
    let auto_set = optional_bool(params.get("autoSet"), "autoSet")?;

    if gain.is_none()
        && fader.is_none()
        && mute.is_none()
        && solo.is_none()
        && phantom.is_none()
        && phase.is_none()
        && pad.is_none()
        && instrument.is_none()
        && auto_set.is_none()
    {
        return Err(String::from(
            "audio.channel.update requires one or more supported fields",
        ));
    }

    Ok(AudioChannelUpdateRequest {
        channel_id: String::from(channel_id),
        mix_target_id,
        gain,
        fader,
        mute,
        solo,
        phantom,
        phase,
        pad,
        instrument,
        auto_set,
    })
}

pub fn parse_audio_mix_target_update_request(
    params: &Value,
) -> Result<AudioMixTargetUpdateRequest, String> {
    let mix_target_id = params
        .get("mixTargetId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("mixTargetId is required"))?;

    let volume = optional_level(params.get("volume"), "volume")?;
    let mute = optional_bool(params.get("mute"), "mute")?;
    let dim = optional_bool(params.get("dim"), "dim")?;
    let mono = optional_bool(params.get("mono"), "mono")?;
    let talkback = optional_bool(params.get("talkback"), "talkback")?;

    if volume.is_none() && mute.is_none() && dim.is_none() && mono.is_none() && talkback.is_none() {
        return Err(String::from(
            "audio.mixTarget.update requires one or more supported fields",
        ));
    }

    Ok(AudioMixTargetUpdateRequest {
        mix_target_id: String::from(mix_target_id),
        volume,
        mute,
        dim,
        mono,
        talkback,
    })
}

pub fn parse_audio_settings_update_request(
    params: &Value,
) -> Result<AudioSettingsUpdateRequest, String> {
    let osc_enabled = optional_bool(params.get("oscEnabled"), "oscEnabled")?;
    let send_host = optional_trimmed_string(params.get("sendHost"), "sendHost")?;
    let send_port = optional_port(params.get("sendPort"), "sendPort")?;
    let receive_port = optional_port(params.get("receivePort"), "receivePort")?;
    let selected_channel_id =
        optional_nullable_trimmed_string(params.get("selectedChannelId"), "selectedChannelId")?;
    let selected_mix_target_id =
        optional_trimmed_string(params.get("selectedMixTargetId"), "selectedMixTargetId")?;
    let expected_peak_data = optional_bool(params.get("expectedPeakData"), "expectedPeakData")?;
    let expected_submix_lock =
        optional_bool(params.get("expectedSubmixLock"), "expectedSubmixLock")?;
    let expected_compatibility_mode = optional_bool(
        params.get("expectedCompatibilityMode"),
        "expectedCompatibilityMode",
    )?;
    let faders_per_bank =
        optional_integer_range(params.get("fadersPerBank"), "fadersPerBank", 1, 24)?;

    if osc_enabled.is_none()
        && send_host.is_none()
        && send_port.is_none()
        && receive_port.is_none()
        && selected_channel_id.is_none()
        && selected_mix_target_id.is_none()
        && expected_peak_data.is_none()
        && expected_submix_lock.is_none()
        && expected_compatibility_mode.is_none()
        && faders_per_bank.is_none()
    {
        return Err(String::from(
            "audio.settings.update requires one or more supported fields",
        ));
    }

    Ok(AudioSettingsUpdateRequest {
        osc_enabled,
        send_host,
        send_port,
        receive_port,
        selected_channel_id,
        selected_mix_target_id,
        expected_peak_data,
        expected_submix_lock,
        expected_compatibility_mode,
        faders_per_bank,
    })
}

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
        summary: audio_summary(
            &status,
            &config,
            osc_enabled,
            channels.len(),
            mix_targets.len(),
            snapshots.len(),
            last_console_sync_at.as_deref(),
            last_console_sync_reason.as_deref(),
            last_recalled_snapshot_id.as_deref(),
            last_snapshot_recall_at.as_deref(),
            &last_action_status,
            last_action_code.as_deref(),
            last_action_message.as_deref(),
        ),
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

pub fn sync_audio_console(db_path: &Path) -> Result<AudioSyncResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    ensure_audio_action_allowed(db_path, &snapshot)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let synced_at = current_timestamp(db_path)?;

    let outcome = sync_default_audio_console(&config, &inventory).map_err(|message| {
        let _ = record_audio_action_failure(db_path, "AUDIO_SYNC_FAILED", &message);
        AudioCommandError::Rejected("AUDIO_SYNC_FAILED", message)
    })?;

    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
                String::from("aligned"),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                synced_at.clone(),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                String::from("manual-sync"),
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                outcome.summary.clone(),
            ),
        ],
    )?;

    Ok(AudioSyncResult {
        synced: true,
        synced_at,
        summary: outcome.summary,
        console_state_confidence: String::from("aligned"),
    })
}

pub fn recall_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotRecallRequest,
) -> Result<AudioSnapshotRecallResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    ensure_audio_action_allowed(db_path, &snapshot)?;
    let config = resolve_audio_config(&app_settings);
    let mut inventory = read_default_audio_inventory(&config);
    inventory.snapshots =
        read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let recalled_at = current_timestamp(db_path)?;

    let outcome = recall_default_audio_snapshot(&config, &inventory, &request.snapshot_id)
        .map_err(|message| {
            let code = if message.contains("not exposed by the backend") {
                "AUDIO_SNAPSHOT_NOT_FOUND"
            } else {
                "AUDIO_SNAPSHOT_RECALL_FAILED"
            };
            let _ = record_audio_action_failure(db_path, code, &message);
            AudioCommandError::Rejected(code, message)
        })?;

    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
                String::from("assumed"),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                String::from("snapshot"),
            ),
            (
                String::from(AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY),
                request.snapshot_id.clone(),
            ),
            (
                String::from(AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY),
                recalled_at.clone(),
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                outcome.summary.clone(),
            ),
        ],
    )?;

    Ok(AudioSnapshotRecallResult {
        recalled: true,
        snapshot_id: request.snapshot_id.clone(),
        snapshot_name: outcome.snapshot_name,
        recalled_at,
        summary: outcome.summary,
        console_state_confidence: String::from("assumed"),
    })
}

pub fn create_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotCreateRequest,
) -> Result<AudioSnapshotCreateResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let mut snapshots = read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let snapshot = AudioSceneSnapshot {
        id: next_custom_audio_snapshot_id(&snapshots),
        name: request.name.clone(),
        osc_index: request.osc_index,
        order: snapshots.len() as i64,
        last_recalled: false,
        last_recalled_at: None,
    };
    snapshots.push(snapshot.clone());
    reindex_audio_snapshots(&mut snapshots);

    let summary = format!(
        "Audio snapshot '{}' was created on slot {}.",
        snapshot.name,
        snapshot.osc_index + 1
    );
    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_SNAPSHOTS_STATE_KEY),
                serialize_audio_snapshot_state(snapshots.as_slice())?,
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
        ],
    )?;

    Ok(AudioSnapshotCreateResult { snapshot, summary })
}

pub fn update_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotUpdateRequest,
) -> Result<AudioSnapshotUpdateResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let mut snapshots = read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let updated_snapshot = {
        let snapshot = snapshots
            .iter_mut()
            .find(|snapshot| snapshot.id == request.snapshot_id)
            .ok_or_else(|| {
                AudioCommandError::Rejected(
                    "AUDIO_SNAPSHOT_NOT_FOUND",
                    format!(
                        "Audio snapshot '{}' is not exposed by the native engine.",
                        request.snapshot_id
                    ),
                )
            })?;
        if let Some(name) = &request.name {
            snapshot.name = name.clone();
        }
        if let Some(osc_index) = request.osc_index {
            snapshot.osc_index = osc_index;
        }
        snapshot.clone()
    };
    reindex_audio_snapshots(&mut snapshots);

    let mut summary_parts = Vec::new();
    if request.name.is_some() {
        summary_parts.push(format!("name -> {}", updated_snapshot.name));
    }
    if request.osc_index.is_some() {
        summary_parts.push(format!("slot -> {}", updated_snapshot.osc_index + 1));
    }
    let summary = format!(
        "Audio snapshot '{}' updated: {}.",
        updated_snapshot.name,
        summary_parts.join(", ")
    );
    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_SNAPSHOTS_STATE_KEY),
                serialize_audio_snapshot_state(snapshots.as_slice())?,
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
        ],
    )?;

    Ok(AudioSnapshotUpdateResult {
        snapshot: updated_snapshot,
        summary,
    })
}

pub fn delete_audio_snapshot(
    db_path: &Path,
    request: &AudioSnapshotDeleteRequest,
) -> Result<AudioSnapshotDeleteResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let mut snapshots = read_audio_snapshot_entries(&app_settings, inventory.snapshots.as_slice());
    let deleted_snapshot = snapshots
        .iter()
        .find(|snapshot| snapshot.id == request.snapshot_id)
        .cloned()
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_SNAPSHOT_NOT_FOUND",
                format!(
                    "Audio snapshot '{}' is not exposed by the native engine.",
                    request.snapshot_id
                ),
            )
        })?;
    let clear_last_recalled =
        read_optional_setting(&app_settings, AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY).as_deref()
            == Some(request.snapshot_id.as_str());

    snapshots.retain(|snapshot| snapshot.id != request.snapshot_id);
    reindex_audio_snapshots(&mut snapshots);

    let summary = format!("Audio snapshot '{}' was deleted.", deleted_snapshot.name);
    let mut updates = vec![
        (
            String::from(AUDIO_SNAPSHOTS_STATE_KEY),
            serialize_audio_snapshot_state(snapshots.as_slice())?,
        ),
        (
            String::from(AUDIO_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
        (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
    ];
    if clear_last_recalled {
        updates.push((
            String::from(AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY),
            String::new(),
        ));
        updates.push((
            String::from(AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY),
            String::new(),
        ));
    }
    persist_audio_state(db_path, &updates)?;

    Ok(AudioSnapshotDeleteResult {
        deleted: true,
        snapshot_id: request.snapshot_id.clone(),
        summary,
    })
}

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

pub fn update_audio_mix_target(
    db_path: &Path,
    request: &AudioMixTargetUpdateRequest,
) -> Result<AudioMixTargetSnapshot, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);

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
        .map(|target| StoredAudioMixTargetState {
            volume: target.volume,
            mute: target.mute,
            dim: target.dim,
            mono: target.mono,
            talkback: target.talkback,
        })
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_MIX_TARGET_NOT_FOUND",
                format!(
                    "Audio mix target '{}' is not exposed by the engine.",
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
        .mix_targets
        .into_iter()
        .find(|entry| entry.id == request.mix_target_id)
        .ok_or_else(|| {
            AudioCommandError::Rejected(
                "AUDIO_MIX_TARGET_NOT_FOUND",
                format!(
                    "Audio mix target '{}' is not exposed by the engine.",
                    request.mix_target_id
                ),
            )
        })
}

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

fn load_audio_settings(db_path: &Path) -> Result<HashMap<String, String>, AudioCommandError> {
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

fn apply_channel_state(
    settings: &HashMap<String, String>,
    channels: Vec<AudioChannelSnapshot>,
) -> Vec<AudioChannelSnapshot> {
    let stored_state = read_channel_state_map(settings);
    channels
        .into_iter()
        .map(|mut channel| {
            if let Some(state) = stored_state.get(&channel.id) {
                if channel_supports_gain(&channel) {
                    channel.gain = clamp_gain(state.gain);
                }
                channel.fader = clamp_level(state.fader);
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

fn apply_mix_target_state(
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

fn read_audio_snapshot_entries(
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
            })
            .collect()
    });
    normalize_audio_snapshot_entries(source_state)
}

fn normalize_audio_snapshot_entries(
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

fn serialize_audio_snapshot_state(
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
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&stored_state)
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

fn reindex_audio_snapshots(snapshots: &mut [AudioSceneSnapshot]) {
    for (index, snapshot) in snapshots.iter_mut().enumerate() {
        snapshot.order = index as i64;
    }
}

fn read_channel_state_map(
    settings: &HashMap<String, String>,
) -> HashMap<String, StoredAudioChannelState> {
    read_json_state_map(settings, AUDIO_CHANNEL_STATE_KEY)
}

fn read_mix_target_state_map(
    settings: &HashMap<String, String>,
) -> HashMap<String, StoredAudioMixTargetState> {
    read_json_state_map(settings, AUDIO_MIX_TARGET_STATE_KEY)
}

fn read_json_state_map<T>(settings: &HashMap<String, String>, key: &str) -> HashMap<String, T>
where
    T: for<'de> Deserialize<'de>,
{
    settings
        .get(key)
        .and_then(|value| serde_json::from_str::<HashMap<String, T>>(value).ok())
        .unwrap_or_default()
}

fn serialize_json_state<T>(state: &HashMap<String, T>) -> Result<String, AudioCommandError>
where
    T: Serialize,
{
    serde_json::to_string(state).map_err(|error| AudioCommandError::Storage(error.to_string()))
}

fn resolve_audio_config(settings: &HashMap<String, String>) -> AudioBackendConfig {
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

fn ensure_audio_action_allowed(
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

fn persist_audio_state(
    db_path: &Path,
    updates: &[(String, String)],
) -> Result<(), AudioCommandError> {
    set_settings_owned(db_path, updates)
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

fn record_audio_action_failure(
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

fn current_timestamp(db_path: &Path) -> Result<String, AudioCommandError> {
    let connection =
        open_connection(db_path).map_err(|error| AudioCommandError::Storage(error.to_string()))?;
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| AudioCommandError::Storage(error.to_string()))
}

fn audio_check_status(settings: &HashMap<String, String>) -> String {
    settings
        .get(&format!("app.commissioning.check.{AUDIO_CHECK_ID}.status"))
        .cloned()
        .unwrap_or_else(|| String::from("idle"))
}

fn audio_console_state_confidence(settings: &HashMap<String, String>) -> String {
    match settings
        .get(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY)
        .map(String::as_str)
    {
        Some("aligned") => String::from("aligned"),
        Some("assumed") => String::from("assumed"),
        _ => String::from("unknown"),
    }
}

fn read_optional_setting(settings: &HashMap<String, String>, key: &str) -> Option<String> {
    settings
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

fn read_bool_setting(settings: &HashMap<String, String>, key: &str, default: bool) -> bool {
    match settings.get(key).map(String::as_str) {
        Some("true") => true,
        Some("false") => false,
        _ => default,
    }
}

fn read_i64_setting(settings: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    settings
        .get(key)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(default)
}

fn audio_osc_enabled(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(settings, AUDIO_OSC_ENABLED_KEY, DEFAULT_AUDIO_OSC_ENABLED)
}

fn audio_expected_peak_data(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(
        settings,
        AUDIO_EXPECTED_PEAK_DATA_KEY,
        DEFAULT_AUDIO_EXPECTED_PEAK_DATA,
    )
}

fn audio_expected_submix_lock(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(
        settings,
        AUDIO_EXPECTED_SUBMIX_LOCK_KEY,
        DEFAULT_AUDIO_EXPECTED_SUBMIX_LOCK,
    )
}

fn audio_expected_compatibility_mode(settings: &HashMap<String, String>) -> bool {
    read_bool_setting(
        settings,
        AUDIO_EXPECTED_COMPATIBILITY_MODE_KEY,
        DEFAULT_AUDIO_EXPECTED_COMPATIBILITY_MODE,
    )
}

fn audio_faders_per_bank(settings: &HashMap<String, String>) -> i64 {
    read_i64_setting(
        settings,
        AUDIO_FADERS_PER_BANK_KEY,
        DEFAULT_AUDIO_FADERS_PER_BANK,
    )
    .clamp(1, 24)
}

fn audio_selected_channel_id(
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

fn audio_selected_mix_target_id(
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

fn optional_level(value: Option<&Value>, field_name: &str) -> Result<Option<f64>, String> {
    match value {
        Some(raw) => {
            let number = raw
                .as_f64()
                .ok_or_else(|| format!("{field_name} must be a number"))?;
            if !(0.0..=1.0).contains(&number) {
                return Err(format!("{field_name} must be between 0.0 and 1.0"));
            }
            Ok(Some(clamp_level(number)))
        }
        None => Ok(None),
    }
}

fn optional_trimmed_string(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<String>, String> {
    match value {
        Some(raw) => {
            let parsed = raw
                .as_str()
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(String::from)
                .ok_or_else(|| format!("{field_name} must be a non-empty string"))?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}

fn validate_audio_snapshot_name(value: String, field_name: &str) -> Result<String, String> {
    if value.len() > 50 {
        return Err(format!("{field_name} must be 50 characters or fewer"));
    }
    Ok(value)
}

fn optional_nullable_trimmed_string(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<Option<String>>, String> {
    match value {
        Some(Value::Null) => Ok(Some(None)),
        Some(raw) => raw
            .as_str()
            .map(str::trim)
            .map(|entry| {
                if entry.is_empty() {
                    None
                } else {
                    Some(String::from(entry))
                }
            })
            .map(Some)
            .ok_or_else(|| format!("{field_name} must be a string or null")),
        None => Ok(None),
    }
}

fn optional_integer_range(
    value: Option<&Value>,
    field_name: &str,
    minimum: i64,
    maximum: i64,
) -> Result<Option<i64>, String> {
    match value {
        Some(raw) => {
            let number = raw
                .as_i64()
                .ok_or_else(|| format!("{field_name} must be an integer"))?;
            if !(minimum..=maximum).contains(&number) {
                return Err(format!(
                    "{field_name} must be between {minimum} and {maximum}"
                ));
            }
            Ok(Some(number))
        }
        None => Ok(None),
    }
}

fn optional_port(value: Option<&Value>, field_name: &str) -> Result<Option<i64>, String> {
    optional_integer_range(value, field_name, 1, 65535)
}

fn optional_gain(value: Option<&Value>, field_name: &str) -> Result<Option<i64>, String> {
    match value {
        Some(raw) => {
            let number = raw
                .as_i64()
                .ok_or_else(|| format!("{field_name} must be an integer"))?;
            if !(0..=75).contains(&number) {
                return Err(format!("{field_name} must be between 0 and 75"));
            }
            Ok(Some(clamp_gain(number)))
        }
        None => Ok(None),
    }
}

fn optional_bool(value: Option<&Value>, field_name: &str) -> Result<Option<bool>, String> {
    match value {
        Some(raw) => raw
            .as_bool()
            .map(Some)
            .ok_or_else(|| format!("{field_name} must be a boolean")),
        None => Ok(None),
    }
}

fn clamp_level(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn clamp_gain(value: i64) -> i64 {
    value.clamp(0, 75)
}

fn clamp_snapshot_index(value: i64) -> i64 {
    value.clamp(0, 7)
}

fn next_custom_audio_snapshot_id(snapshots: &[AudioSceneSnapshot]) -> String {
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

fn channel_supports_gain(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

fn channel_supports_phantom(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

fn channel_supports_pad(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

fn channel_supports_instrument(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

fn channel_supports_auto_set(channel: &AudioChannelSnapshot) -> bool {
    channel.role == "front-preamp"
}

fn channel_supports_phase(channel: &AudioChannelSnapshot) -> bool {
    channel.role != "playback-pair"
}

fn channel_supports_gain_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_gain)
        .unwrap_or(false)
}

fn channel_supports_phantom_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_phantom)
        .unwrap_or(false)
}

fn channel_supports_phase_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_phase)
        .unwrap_or(false)
}

fn channel_supports_pad_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_pad)
        .unwrap_or(false)
}

fn channel_supports_instrument_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_instrument)
        .unwrap_or(false)
}

fn channel_supports_auto_set_from_role(snapshot: &AudioSnapshot, channel_id: &str) -> bool {
    snapshot
        .channels
        .iter()
        .find(|entry| entry.id == channel_id)
        .map(channel_supports_auto_set)
        .unwrap_or(false)
}

fn audio_summary(
    status: &str,
    config: &AudioBackendConfig,
    osc_enabled: bool,
    channel_count: usize,
    mix_target_count: usize,
    snapshot_count: usize,
    last_console_sync_at: Option<&str>,
    last_console_sync_reason: Option<&str>,
    last_recalled_snapshot_id: Option<&str>,
    last_snapshot_recall_at: Option<&str>,
    last_action_status: &str,
    last_action_code: Option<&str>,
    last_action_message: Option<&str>,
) -> String {
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

#[cfg(test)]
mod tests;
