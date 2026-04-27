use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
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
pub(super) struct StoredAudioChannelState {
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
pub(super) struct StoredAudioMixTargetState {
    pub volume: f64,
    pub mute: bool,
    pub dim: bool,
    pub mono: bool,
    pub talkback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct StoredAudioSnapshotState {
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
