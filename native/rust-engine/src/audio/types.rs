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
    #[serde(rename = "consoleLink")]
    pub console_link: AudioConsoleLinkSnapshot,
    #[serde(rename = "lastConsoleSyncAt")]
    pub last_console_sync_at: Option<String>,
    #[serde(rename = "lastConsoleSyncReason")]
    pub last_console_sync_reason: Option<String>,
    #[serde(rename = "lastActionStatus")]
    pub last_action_status: String,
    #[serde(rename = "lastActionCode")]
    pub last_action_code: Option<String>,
    #[serde(rename = "lastActionMessage")]
    pub last_action_message: Option<String>,
    pub channels: Vec<AudioChannelSnapshot>,
    #[serde(rename = "mixTargets")]
    pub mix_targets: Vec<AudioMixTargetSnapshot>,
    /// TotalMix's own eight snapshots (2026-10-01): the Console lists and
    /// loads these; the app keeps no snapshots of its own.
    #[serde(rename = "consoleSnapshots")]
    pub console_snapshots: AudioConsoleSnapshots,
}

/// TotalMix's eight snapshot slots, as the desk reports them and under the
/// names TotalMix last saved.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioConsoleSnapshots {
    /// Always eight, slot 1 first.
    pub slots: Vec<AudioConsoleSnapshotSlot>,
    /// When TotalMix last saved the names (its settings file's time), or
    /// `null` when the names do not come from that file.
    #[serde(rename = "namesSavedAt")]
    pub names_saved_at: Option<String>,
    /// Why there are no names to show, for the screen; `null` when there is
    /// nothing to say.
    #[serde(rename = "namesNote")]
    pub names_note: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioConsoleSnapshotSlot {
    /// 1 to 8, as TotalMix numbers them.
    pub slot: i64,
    /// The name TotalMix saved for the slot; `null` when it has none.
    pub name: Option<String>,
    /// `unknown` until TotalMix reported the slot, then `off`, `active` (the
    /// one loaded) or `changed` (the active one, changed since it was loaded).
    pub state: String,
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
}

#[derive(Debug, Serialize, Clone)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioConsoleLinkSnapshot {
    /// The engine holds the Global OSC receive port (`receive_port + 3`).
    #[serde(rename = "slotBound")]
    pub slot_bound: bool,
    /// `connected` / `disconnected` from TotalMix's `/status/connection`,
    /// `unknown` until the console has reported.
    pub connection: String,
    pub device: Option<String>,
    #[serde(rename = "dspLoad")]
    pub dsp_load: Option<f64>,
    #[serde(rename = "lastEchoAgeMs")]
    pub last_echo_age_ms: Option<i64>,
    #[serde(rename = "pendingSends")]
    pub pending_sends: i64,
    #[serde(rename = "unconfirmedSends")]
    pub unconfirmed_sends: i64,
    #[serde(rename = "unconfirmedAddresses")]
    pub unconfirmed_addresses: Vec<String>,
    #[serde(rename = "confirmedSends")]
    pub confirmed_sends: i64,
    #[serde(rename = "adjustedSends")]
    pub adjusted_sends: i64,
    #[serde(rename = "externalChanges")]
    pub external_changes: i64,
    #[serde(rename = "lastPullAt")]
    pub last_pull_at: Option<String>,
    #[serde(rename = "lastPullValues")]
    pub last_pull_values: Option<i64>,
}

impl Default for AudioConsoleLinkSnapshot {
    fn default() -> Self {
        Self {
            slot_bound: false,
            connection: String::from("unknown"),
            device: None,
            dsp_load: None,
            last_echo_age_ms: None,
            pending_sends: 0,
            unconfirmed_sends: 0,
            unconfirmed_addresses: Vec::new(),
            confirmed_sends: 0,
            adjusted_sends: 0,
            external_changes: 0,
            last_pull_at: None,
            last_pull_values: None,
        }
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct AudioCapabilitySnapshot {
    #[serde(rename = "canEditMixerState")]
    pub can_edit_mixer_state: bool,
    #[serde(rename = "canSync")]
    pub can_sync: bool,
    #[serde(rename = "canRecallConsoleSnapshot")]
    pub can_recall_console_snapshot: bool,
    #[serde(rename = "canClearClips")]
    pub can_clear_clips: bool,
    #[serde(rename = "canUseMasterView")]
    pub can_use_master_view: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct StoredAudioChannelState {
    // Every field defaults so a blob written by a future engine (or one
    // missing a field) never drops the whole channel map on read.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub gain: i64,
    #[serde(default)]
    pub fader: f64,
    #[serde(default)]
    pub clip: bool,
    #[serde(rename = "mixLevels")]
    #[serde(default)]
    pub mix_levels: HashMap<String, f64>,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default)]
    pub phantom: bool,
    #[serde(default)]
    pub phase: bool,
    #[serde(default)]
    pub pad: bool,
    #[serde(default)]
    pub instrument: bool,
    #[serde(rename = "autoSet")]
    #[serde(default)]
    pub auto_set: bool,
    // 2026-10-04 (the owner's decisions): the per-send modes (pre fader, mute
    // send, link, solo send) and the dynamics (a compressor and a gate) went:
    // they were only ever kept here and never reached TotalMix. The equaliser
    // and Low Cut went the same day: they went out over TotalMix's classic
    // page-2 commands, whose on/off only flips, whose channel selection did not
    // match the layout, and which nothing read back. Saved data written before
    // still carries `sendModes`, `dynamics` and `eq`; they are read past (no
    // field here denies an unknown one) and dropped at the next write.
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct StoredAudioMixTargetState {
    /// The output's name: as TotalMix reported it, else the name shown when
    /// the entry was written; `None` in state saved before outputs had one.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub volume: f64,
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub dim: bool,
    #[serde(default)]
    pub mono: bool,
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
    /// Console parameters the pull could map to app state (0 when simulated).
    #[serde(rename = "pulledValues")]
    pub pulled_values: i64,
    /// Distinct hardware channels the dump reported.
    pub channels: i64,
    /// Distinct hardware outputs the dump reported.
    #[serde(rename = "mixTargets")]
    pub mix_targets: i64,
    /// The dump ended (went quiet) before the timeout.
    pub complete: bool,
    /// `connected` / `disconnected` / `unknown` / `simulated`.
    pub connection: String,
}

#[derive(Debug, Serialize)]
pub struct AudioSnapshotLoadResult {
    /// The load went to TotalMix (or, simulated, to the simulated console).
    pub loaded: bool,
    pub slot: i64,
    /// The slot's name as TotalMix last saved it, when it has one.
    pub name: Option<String>,
    #[serde(rename = "loadedAt")]
    pub loaded_at: String,
    pub summary: String,
    #[serde(rename = "consoleStateConfidence")]
    pub console_state_confidence: String,
    /// Console parameters the read-back after the load could map to app
    /// state (0 when simulated or when the read-back failed).
    #[serde(rename = "pulledValues")]
    pub pulled_values: i64,
    /// TotalMix itself reported the slot as loaded. When it did not, the app
    /// marks the slot active only after the desk was read back.
    #[serde(rename = "totalMixReported")]
    pub total_mix_reported: bool,
}

#[derive(Debug)]
pub enum AudioCommandError {
    Rejected(&'static str, String),
    Storage(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioSnapshotLoadRequest {
    /// TotalMix's slot, 1 to 8.
    pub slot: usize,
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
