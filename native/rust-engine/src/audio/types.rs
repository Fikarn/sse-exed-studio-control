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
    #[serde(rename = "meteringSource")]
    pub metering_source: String,
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
    #[serde(rename = "viewMode")]
    pub view_mode: String,
    pub capabilities: AudioCapabilitySnapshot,
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
    #[serde(rename = "peakHoldLeft")]
    pub peak_hold_left: f64,
    #[serde(rename = "peakHoldRight")]
    pub peak_hold_right: f64,
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
    pub eq: AudioEqSnapshot,
    pub dynamics: AudioDynamicsSnapshot,
    #[serde(rename = "sendModes")]
    pub send_modes: HashMap<String, AudioSendModeSnapshot>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioCapabilitySnapshot {
    #[serde(rename = "canEditMixerState")]
    pub can_edit_mixer_state: bool,
    #[serde(rename = "canSync")]
    pub can_sync: bool,
    #[serde(rename = "canRecallConsoleSnapshot")]
    pub can_recall_console_snapshot: bool,
    #[serde(rename = "canEditProcessing")]
    pub can_edit_processing: bool,
    #[serde(rename = "canClearClips")]
    pub can_clear_clips: bool,
    #[serde(rename = "canCaptureSnapshot")]
    pub can_capture_snapshot: bool,
    #[serde(rename = "canUseMasterView")]
    pub can_use_master_view: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioEqSnapshot {
    pub enabled: bool,
    #[serde(rename = "lowCut")]
    #[serde(default = "default_audio_low_cut_snapshot")]
    pub low_cut: AudioLowCutSnapshot,
    #[serde(rename = "hardwareStatus")]
    #[serde(default = "default_audio_eq_hardware_status")]
    pub hardware_status: String,
    pub bands: Vec<AudioEqBandSnapshot>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioLowCutSnapshot {
    pub enabled: bool,
    #[serde(rename = "frequencyHz")]
    pub frequency_hz: f64,
    #[serde(rename = "slopeDbPerOctave")]
    pub slope_db_per_octave: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioEqBandSnapshot {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    #[serde(rename = "frequencyHz")]
    pub frequency_hz: f64,
    #[serde(rename = "gainDb")]
    pub gain_db: f64,
    pub q: f64,
    #[serde(rename = "bandType")]
    pub band_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioDynamicsSnapshot {
    pub compressor: AudioDynamicsProcessorSnapshot,
    pub gate: AudioDynamicsProcessorSnapshot,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioDynamicsProcessorSnapshot {
    pub enabled: bool,
    #[serde(rename = "thresholdDb")]
    pub threshold_db: f64,
    pub ratio: f64,
    #[serde(rename = "attackMs")]
    pub attack_ms: f64,
    #[serde(rename = "releaseMs")]
    pub release_ms: f64,
    #[serde(rename = "makeupDb")]
    pub makeup_db: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioSendModeSnapshot {
    #[serde(rename = "preFader")]
    pub pre_fader: bool,
    pub mute: bool,
    #[serde(rename = "linkStereo")]
    pub link_stereo: bool,
    pub solo: bool,
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
    #[serde(rename = "meterLeft")]
    pub meter_left: f64,
    #[serde(rename = "meterRight")]
    pub meter_right: f64,
    #[serde(rename = "meterLevel")]
    pub meter_level: f64,
    #[serde(rename = "peakHold")]
    pub peak_hold: f64,
    #[serde(rename = "peakHoldLeft")]
    pub peak_hold_left: f64,
    #[serde(rename = "peakHoldRight")]
    pub peak_hold_right: f64,
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
    pub contents: Option<AudioSceneContentsSnapshot>,
    pub preview: AudioScenePreviewSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct StoredAudioChannelState {
    #[serde(default)]
    pub name: Option<String>,
    pub gain: i64,
    pub fader: f64,
    #[serde(default)]
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
    #[serde(default = "default_audio_eq_snapshot")]
    pub eq: AudioEqSnapshot,
    #[serde(default = "default_audio_dynamics_snapshot")]
    pub dynamics: AudioDynamicsSnapshot,
    #[serde(rename = "sendModes")]
    #[serde(default)]
    pub send_modes: HashMap<String, AudioSendModeSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct StoredAudioMixTargetState {
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
    #[serde(default)]
    pub contents: Option<AudioSceneContentsSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioSceneContentsSnapshot {
    #[serde(rename = "capturedAt")]
    pub captured_at: Option<String>,
    pub channels: HashMap<String, StoredAudioChannelState>,
    #[serde(rename = "mixTargets")]
    pub mix_targets: HashMap<String, StoredAudioMixTargetState>,
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioScenePreviewSnapshot {
    #[serde(rename = "hasContents")]
    pub has_contents: bool,
    #[serde(rename = "channelCount")]
    pub channel_count: i64,
    #[serde(rename = "mixTargetCount")]
    pub mix_target_count: i64,
    #[serde(rename = "changedChannels")]
    pub changed_channels: Vec<String>,
    #[serde(rename = "changedMixTargets")]
    pub changed_mix_targets: Vec<String>,
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
    #[serde(rename = "meteringSource")]
    pub metering_source: String,
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
    pub capture_current_state: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AudioSnapshotUpdateRequest {
    pub snapshot_id: String,
    pub name: Option<String>,
    pub osc_index: Option<i64>,
    pub capture_current_state: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AudioSnapshotDeleteRequest {
    pub snapshot_id: String,
}

#[derive(Debug, Clone)]
pub struct AudioChannelUpdateRequest {
    pub channel_id: String,
    pub mix_target_id: Option<String>,
    pub name: Option<String>,
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
    pub view_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AudioClipClearRequest {
    pub channel_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AudioClipClearResult {
    pub cleared: bool,
    #[serde(rename = "channelId")]
    pub channel_id: Option<String>,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct AudioEqUpdateRequest {
    pub channel_id: String,
    pub enabled: Option<bool>,
    pub low_cut_enabled: Option<bool>,
    pub low_cut_frequency_hz: Option<f64>,
    pub low_cut_slope_db_per_octave: Option<i64>,
    pub band_id: Option<String>,
    pub band_enabled: Option<bool>,
    pub band_type: Option<String>,
    pub frequency_hz: Option<f64>,
    pub gain_db: Option<f64>,
    pub q: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct AudioDynamicsUpdateRequest {
    pub channel_id: String,
    pub section: String,
    pub enabled: Option<bool>,
    pub threshold_db: Option<f64>,
    pub ratio: Option<f64>,
    pub attack_ms: Option<f64>,
    pub release_ms: Option<f64>,
    pub makeup_db: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct AudioSendModeUpdateRequest {
    pub channel_id: String,
    pub mix_target_id: String,
    pub pre_fader: Option<bool>,
    pub mute: Option<bool>,
    pub link_stereo: Option<bool>,
    pub solo: Option<bool>,
}

pub fn default_audio_eq_snapshot() -> AudioEqSnapshot {
    AudioEqSnapshot {
        enabled: false,
        low_cut: default_audio_low_cut_snapshot(),
        hardware_status: default_audio_eq_hardware_status(),
        bands: vec![
            AudioEqBandSnapshot {
                id: String::from("1"),
                label: String::from("1"),
                enabled: true,
                frequency_hz: 180.0,
                gain_db: 0.0,
                q: 0.9,
                band_type: String::from("bell"),
            },
            AudioEqBandSnapshot {
                id: String::from("2"),
                label: String::from("2"),
                enabled: true,
                frequency_hz: 1600.0,
                gain_db: 0.0,
                q: 1.2,
                band_type: String::from("bell"),
            },
            AudioEqBandSnapshot {
                id: String::from("3"),
                label: String::from("3"),
                enabled: true,
                frequency_hz: 8500.0,
                gain_db: 0.0,
                q: 0.8,
                band_type: String::from("high-shelf"),
            },
        ],
    }
}

pub fn default_audio_eq_hardware_status() -> String {
    String::from("local")
}

pub fn default_audio_low_cut_snapshot() -> AudioLowCutSnapshot {
    AudioLowCutSnapshot {
        enabled: false,
        frequency_hz: 80.0,
        slope_db_per_octave: 12,
    }
}

pub fn default_audio_dynamics_snapshot() -> AudioDynamicsSnapshot {
    AudioDynamicsSnapshot {
        compressor: AudioDynamicsProcessorSnapshot {
            enabled: false,
            threshold_db: -18.0,
            ratio: 2.0,
            attack_ms: 12.0,
            release_ms: 120.0,
            makeup_db: 0.0,
        },
        gate: AudioDynamicsProcessorSnapshot {
            enabled: false,
            threshold_db: -48.0,
            ratio: 1.5,
            attack_ms: 4.0,
            release_ms: 180.0,
            makeup_db: 0.0,
        },
    }
}

pub fn default_audio_send_mode_snapshot() -> AudioSendModeSnapshot {
    AudioSendModeSnapshot {
        pre_fader: false,
        mute: false,
        link_stereo: true,
        solo: false,
    }
}

impl Default for AudioEqSnapshot {
    fn default() -> Self {
        default_audio_eq_snapshot()
    }
}

impl Default for AudioDynamicsSnapshot {
    fn default() -> Self {
        default_audio_dynamics_snapshot()
    }
}

impl Default for AudioSendModeSnapshot {
    fn default() -> Self {
        default_audio_send_mode_snapshot()
    }
}
