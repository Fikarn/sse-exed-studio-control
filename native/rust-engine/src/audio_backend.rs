use crate::audio::{
    default_audio_dynamics_snapshot, default_audio_eq_snapshot, default_audio_send_mode_snapshot,
    AudioChannelSnapshot, AudioChannelUpdateRequest, AudioEqUpdateRequest, AudioMixTargetSnapshot,
    AudioMixTargetUpdateRequest, AudioScenePreviewSnapshot, AudioSceneSnapshot,
};
use crate::audio_meter_fixture::{real_speech_body_level_at, real_speech_peak_level_at};
use crate::rme_totalmix_osc::{
    send_totalmix_eq_update, RME_TOTALMIX_OSC_SOURCE, SIMULATED_AUDIO_SOURCE,
};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const AUDIO_METER_FLOOR_DBFS: f64 = -60.0;
const FAIRLIGHT_PEAK_HOLD_MS: f64 = 1_500.0;
const FAIRLIGHT_PEAK_HISTORY_MS: f64 = 3_500.0;
const FAIRLIGHT_PEAK_SCAN_STEP_MS: f64 = 33.0;
const FAIRLIGHT_PEAK_FALL_DB_PER_SECOND: f64 = 20.0;

pub struct AudioBackendConfig {
    pub send_host: String,
    pub send_port: i64,
    pub receive_port: i64,
    pub metering_source: String,
}

pub struct AudioBackendInventory {
    pub adapter_mode: String,
    pub channels: Vec<AudioChannelSnapshot>,
    pub mix_targets: Vec<AudioMixTargetSnapshot>,
    pub snapshots: Vec<AudioSceneSnapshot>,
}

struct AudioMeterFrame {
    meter_left: f64,
    meter_right: f64,
    meter_level: f64,
    peak_hold: f64,
    peak_hold_left: f64,
    peak_hold_right: f64,
    clip: bool,
}

#[derive(Debug)]
pub struct AudioSyncOutcome {
    pub summary: String,
}

#[derive(Debug)]
pub struct AudioSnapshotRecallOutcome {
    pub snapshot_name: String,
    pub summary: String,
}

#[derive(Debug)]
pub struct AudioChannelUpdateOutcome {
    pub summary: String,
}

#[derive(Debug)]
pub struct AudioMixTargetUpdateOutcome {
    pub summary: String,
}

#[derive(Debug)]
pub struct AudioEqUpdateOutcome {
    pub summary: String,
    pub hardware_status: String,
}

pub trait AudioBackend {
    fn read_inventory(&self, config: &AudioBackendConfig) -> AudioBackendInventory;
    fn sync_console(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
    ) -> Result<AudioSyncOutcome, String>;
    fn recall_snapshot(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        snapshot_id: &str,
    ) -> Result<AudioSnapshotRecallOutcome, String>;
    fn update_channel(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioChannelUpdateRequest,
    ) -> Result<AudioChannelUpdateOutcome, String>;
    fn update_mix_target(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioMixTargetUpdateRequest,
    ) -> Result<AudioMixTargetUpdateOutcome, String>;
    fn update_eq(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioEqUpdateRequest,
    ) -> Result<AudioEqUpdateOutcome, String>;
}

pub struct SimulatedAudioBackend;

pub struct RmeTotalMixOscBackend;

impl AudioBackend for SimulatedAudioBackend {
    fn read_inventory(&self, config: &AudioBackendConfig) -> AudioBackendInventory {
        if config.send_host.trim().is_empty() || config.send_port <= 0 || config.receive_port <= 0 {
            return AudioBackendInventory {
                adapter_mode: String::from("simulated"),
                channels: Vec::new(),
                mix_targets: Vec::new(),
                snapshots: Vec::new(),
            };
        }

        AudioBackendInventory {
            adapter_mode: String::from("simulated"),
            channels: vec![
                simulated_channel(
                    "audio-input-9",
                    "Host",
                    "HOST",
                    "front-preamp",
                    false,
                    34,
                    0.78,
                ),
                simulated_channel(
                    "audio-input-10",
                    "Guest",
                    "GST",
                    "front-preamp",
                    false,
                    34,
                    0.78,
                ),
                simulated_channel(
                    "audio-input-11",
                    "Boom",
                    "BOOM",
                    "front-preamp",
                    false,
                    32,
                    0.76,
                ),
                simulated_channel(
                    "audio-input-12",
                    "Guitar DI",
                    "GTR DI",
                    "front-preamp",
                    false,
                    32,
                    0.76,
                ),
                simulated_channel(
                    "audio-input-1",
                    "Line 1",
                    "L 1",
                    "rear-line",
                    false,
                    0,
                    0.68,
                ),
                simulated_channel(
                    "audio-input-2",
                    "Line 2",
                    "L 2",
                    "rear-line",
                    false,
                    0,
                    0.68,
                ),
                simulated_channel(
                    "audio-input-3",
                    "Remote A",
                    "REM A",
                    "rear-line",
                    false,
                    0,
                    0.66,
                ),
                simulated_channel(
                    "audio-input-4",
                    "Remote B",
                    "REM B",
                    "rear-line",
                    false,
                    0,
                    0.66,
                ),
                simulated_channel(
                    "audio-input-5",
                    "Line 5",
                    "L 5",
                    "rear-line",
                    false,
                    0,
                    0.64,
                ),
                simulated_channel(
                    "audio-input-6",
                    "Line 6",
                    "L 6",
                    "rear-line",
                    false,
                    0,
                    0.64,
                ),
                simulated_channel(
                    "audio-input-7",
                    "Line 7",
                    "L 7",
                    "rear-line",
                    false,
                    0,
                    0.62,
                ),
                simulated_channel(
                    "audio-input-8",
                    "Line 8",
                    "L 8",
                    "rear-line",
                    false,
                    0,
                    0.62,
                ),
                simulated_channel(
                    "audio-playback-1-2",
                    "Program 1/2",
                    "PGM",
                    "playback-pair",
                    true,
                    0,
                    0.58,
                ),
                simulated_channel(
                    "audio-playback-3-4",
                    "FX 3/4",
                    "FX",
                    "playback-pair",
                    true,
                    0,
                    0.56,
                ),
                simulated_channel(
                    "audio-playback-5-6",
                    "N-1 5/6",
                    "N-1",
                    "playback-pair",
                    true,
                    0,
                    0.54,
                ),
                simulated_channel(
                    "audio-playback-7-8",
                    "Music 7/8",
                    "MUS",
                    "playback-pair",
                    true,
                    0,
                    0.52,
                ),
                simulated_channel(
                    "audio-playback-9-10",
                    "Playback 9/10",
                    "PB 9/10",
                    "playback-pair",
                    true,
                    0,
                    0.52,
                ),
                simulated_channel(
                    "audio-playback-11-12",
                    "Playback 11/12",
                    "PB 11/12",
                    "playback-pair",
                    true,
                    0,
                    0.50,
                ),
            ],
            mix_targets: vec![
                AudioMixTargetSnapshot {
                    id: String::from("audio-mix-main"),
                    name: String::from("Main Out"),
                    short_name: String::from("MAIN"),
                    role: String::from("main-out"),
                    volume: 0.82,
                    meter_left: 0.0,
                    meter_right: 0.0,
                    meter_level: 0.0,
                    peak_hold: 0.0,
                    peak_hold_left: 0.0,
                    peak_hold_right: 0.0,
                    mute: false,
                    dim: false,
                    mono: false,
                    talkback: false,
                },
                AudioMixTargetSnapshot {
                    id: String::from("audio-mix-phones-a"),
                    name: String::from("Phones 1"),
                    short_name: String::from("HP 1"),
                    role: String::from("phones-a"),
                    volume: 0.64,
                    meter_left: 0.0,
                    meter_right: 0.0,
                    meter_level: 0.0,
                    peak_hold: 0.0,
                    peak_hold_left: 0.0,
                    peak_hold_right: 0.0,
                    mute: false,
                    dim: false,
                    mono: false,
                    talkback: false,
                },
                AudioMixTargetSnapshot {
                    id: String::from("audio-mix-phones-b"),
                    name: String::from("Phones 2"),
                    short_name: String::from("HP 2"),
                    role: String::from("phones-b"),
                    volume: 0.71,
                    meter_left: 0.0,
                    meter_right: 0.0,
                    meter_level: 0.0,
                    peak_hold: 0.0,
                    peak_hold_left: 0.0,
                    peak_hold_right: 0.0,
                    mute: false,
                    dim: false,
                    mono: false,
                    talkback: false,
                },
            ],
            snapshots: vec![
                AudioSceneSnapshot {
                    id: String::from("snapshot-default"),
                    name: String::from("Default"),
                    osc_index: 0,
                    order: 0,
                    last_recalled: false,
                    last_recalled_at: None,
                    contents: None,
                    preview: empty_audio_scene_preview(),
                },
                AudioSceneSnapshot {
                    id: String::from("snapshot-panel"),
                    name: String::from("Panel"),
                    osc_index: 1,
                    order: 1,
                    last_recalled: false,
                    last_recalled_at: None,
                    contents: None,
                    preview: empty_audio_scene_preview(),
                },
                AudioSceneSnapshot {
                    id: String::from("snapshot-broadcast"),
                    name: String::from("Broadcast"),
                    osc_index: 2,
                    order: 2,
                    last_recalled: false,
                    last_recalled_at: None,
                    contents: None,
                    preview: empty_audio_scene_preview(),
                },
            ],
        }
    }

    fn sync_console(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
    ) -> Result<AudioSyncOutcome, String> {
        ensure_transport_configured(config)?;

        if inventory.channels.is_empty() || inventory.mix_targets.is_empty() {
            return Err(String::from(
                "Audio inventory is empty, so the simulated backend cannot stage a console sync.",
            ));
        }

        Ok(AudioSyncOutcome {
            summary: format!(
                "Simulated console sync staged {} channels and {} mix targets over {}:{} / {}.",
                inventory.channels.len(),
                inventory.mix_targets.len(),
                config.send_host,
                config.send_port,
                config.receive_port
            ),
        })
    }

    fn recall_snapshot(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        snapshot_id: &str,
    ) -> Result<AudioSnapshotRecallOutcome, String> {
        ensure_transport_configured(config)?;

        let snapshot = inventory
            .snapshots
            .iter()
            .find(|entry| entry.id == snapshot_id)
            .ok_or_else(|| {
                format!("Audio snapshot '{snapshot_id}' is not exposed by the backend.")
            })?;

        Ok(AudioSnapshotRecallOutcome {
            snapshot_name: snapshot.name.clone(),
            summary: format!(
                "Simulated audio snapshot '{}' was recalled over {}:{} / {}.",
                snapshot.name, config.send_host, config.send_port, config.receive_port
            ),
        })
    }

    fn update_channel(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioChannelUpdateRequest,
    ) -> Result<AudioChannelUpdateOutcome, String> {
        ensure_transport_configured(config)?;

        let channel = inventory
            .channels
            .iter()
            .find(|entry| entry.id == request.channel_id)
            .ok_or_else(|| {
                format!(
                    "Audio channel '{}' is not exposed by the backend.",
                    request.channel_id
                )
            })?;

        if let Some(mix_target_id) = request.mix_target_id.as_deref() {
            if !inventory
                .mix_targets
                .iter()
                .any(|entry| entry.id == mix_target_id)
            {
                return Err(format!(
                    "Audio mix target '{}' is not exposed by the backend.",
                    mix_target_id
                ));
            }
        }

        let mut changes = Vec::new();
        if let Some(name) = &request.name {
            changes.push(format!("name -> {}", name));
        }
        if let Some(fader) = request.fader {
            let mix_target = request
                .mix_target_id
                .clone()
                .unwrap_or_else(|| String::from("audio-mix-main"));
            changes.push(format!("send {} -> {:.2}", mix_target, fader));
        }
        if let Some(gain) = request.gain {
            changes.push(format!("gain -> {}", gain));
        }
        if let Some(mute) = request.mute {
            changes.push(format!("mute -> {}", bool_label(mute)));
        }
        if let Some(solo) = request.solo {
            changes.push(format!("solo -> {}", bool_label(solo)));
        }
        if let Some(phantom) = request.phantom {
            changes.push(format!("phantom -> {}", bool_label(phantom)));
        }
        if let Some(phase) = request.phase {
            changes.push(format!("phase -> {}", bool_label(phase)));
        }
        if let Some(pad) = request.pad {
            changes.push(format!("pad -> {}", bool_label(pad)));
        }
        if let Some(instrument) = request.instrument {
            changes.push(format!("instrument -> {}", bool_label(instrument)));
        }
        if let Some(auto_set) = request.auto_set {
            changes.push(format!("auto-set -> {}", bool_label(auto_set)));
        }

        Ok(AudioChannelUpdateOutcome {
            summary: format!(
                "Simulated audio channel '{}' updated over {}:{} / {} ({})",
                channel.name,
                config.send_host,
                config.send_port,
                config.receive_port,
                changes.join(", ")
            ),
        })
    }

    fn update_mix_target(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioMixTargetUpdateRequest,
    ) -> Result<AudioMixTargetUpdateOutcome, String> {
        ensure_transport_configured(config)?;

        let mix_target = inventory
            .mix_targets
            .iter()
            .find(|entry| entry.id == request.mix_target_id)
            .ok_or_else(|| {
                format!(
                    "Audio mix target '{}' is not exposed by the backend.",
                    request.mix_target_id
                )
            })?;

        let mut changes = Vec::new();
        if let Some(volume) = request.volume {
            changes.push(format!("volume -> {:.2}", volume));
        }
        if let Some(mute) = request.mute {
            changes.push(format!("mute -> {}", bool_label(mute)));
        }
        if let Some(dim) = request.dim {
            changes.push(format!("dim -> {}", bool_label(dim)));
        }
        if let Some(mono) = request.mono {
            changes.push(format!("mono -> {}", bool_label(mono)));
        }
        if let Some(talkback) = request.talkback {
            changes.push(format!("talkback -> {}", bool_label(talkback)));
        }

        Ok(AudioMixTargetUpdateOutcome {
            summary: format!(
                "Simulated mix target '{}' updated over {}:{} / {} ({})",
                mix_target.name,
                config.send_host,
                config.send_port,
                config.receive_port,
                changes.join(", ")
            ),
        })
    }

    fn update_eq(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioEqUpdateRequest,
    ) -> Result<AudioEqUpdateOutcome, String> {
        ensure_transport_configured(config)?;
        let channel = inventory
            .channels
            .iter()
            .find(|entry| entry.id == request.channel_id)
            .ok_or_else(|| {
                format!(
                    "Audio channel '{}' is not exposed by the backend.",
                    request.channel_id
                )
            })?;

        Ok(AudioEqUpdateOutcome {
            summary: format!(
                "Simulated audio EQ state for '{}' was updated.",
                channel.name
            ),
            hardware_status: String::from("local"),
        })
    }
}

impl AudioBackend for RmeTotalMixOscBackend {
    fn read_inventory(&self, config: &AudioBackendConfig) -> AudioBackendInventory {
        let mut inventory = SimulatedAudioBackend.read_inventory(config);
        inventory.adapter_mode = String::from(RME_TOTALMIX_OSC_SOURCE);
        for channel in &mut inventory.channels {
            clear_channel_meter(channel);
        }
        for mix_target in &mut inventory.mix_targets {
            clear_mix_target_meter(mix_target);
        }
        inventory
    }

    fn sync_console(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
    ) -> Result<AudioSyncOutcome, String> {
        ensure_transport_configured(config)?;

        if inventory.channels.is_empty() || inventory.mix_targets.is_empty() {
            return Err(String::from(
                "Audio inventory is empty, so the RME TotalMix OSC backend cannot prepare the console surface.",
            ));
        }

        Ok(AudioSyncOutcome {
            summary: format!(
                "RME TotalMix OSC metering is configured for {} channels and {} mix targets over receive ports {}-{}.",
                inventory.channels.len(),
                inventory.mix_targets.len(),
                config.receive_port,
                config.receive_port + 2
            ),
        })
    }

    fn recall_snapshot(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        snapshot_id: &str,
    ) -> Result<AudioSnapshotRecallOutcome, String> {
        ensure_transport_configured(config)?;

        let snapshot = inventory
            .snapshots
            .iter()
            .find(|entry| entry.id == snapshot_id)
            .ok_or_else(|| {
                format!("Audio snapshot '{snapshot_id}' is not exposed by the backend.")
            })?;

        Ok(AudioSnapshotRecallOutcome {
            snapshot_name: snapshot.name.clone(),
            summary: format!(
                "Native audio snapshot '{}' was recalled. RME OSC snapshot-write control is outside this metering pass.",
                snapshot.name
            ),
        })
    }

    fn update_channel(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioChannelUpdateRequest,
    ) -> Result<AudioChannelUpdateOutcome, String> {
        SimulatedAudioBackend.update_channel(config, inventory, request)?;
        let channel = inventory
            .channels
            .iter()
            .find(|entry| entry.id == request.channel_id)
            .ok_or_else(|| {
                format!(
                    "Audio channel '{}' is not exposed by the backend.",
                    request.channel_id
                )
            })?;

        Ok(AudioChannelUpdateOutcome {
            summary: format!(
                "Native audio state for '{}' was updated. Live meter truth remains sourced from RME TotalMix OSC packets.",
                channel.name
            ),
        })
    }

    fn update_mix_target(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioMixTargetUpdateRequest,
    ) -> Result<AudioMixTargetUpdateOutcome, String> {
        SimulatedAudioBackend.update_mix_target(config, inventory, request)?;
        let mix_target = inventory
            .mix_targets
            .iter()
            .find(|entry| entry.id == request.mix_target_id)
            .ok_or_else(|| {
                format!(
                    "Audio mix target '{}' is not exposed by the backend.",
                    request.mix_target_id
                )
            })?;

        Ok(AudioMixTargetUpdateOutcome {
            summary: format!(
                "Native audio state for '{}' was updated. Live meter truth remains sourced from RME TotalMix OSC packets.",
                mix_target.name
            ),
        })
    }

    fn update_eq(
        &self,
        config: &AudioBackendConfig,
        inventory: &AudioBackendInventory,
        request: &AudioEqUpdateRequest,
    ) -> Result<AudioEqUpdateOutcome, String> {
        ensure_transport_configured(config)?;
        let channel = inventory
            .channels
            .iter()
            .find(|entry| entry.id == request.channel_id)
            .ok_or_else(|| {
                format!(
                    "Audio channel '{}' is not exposed by the backend.",
                    request.channel_id
                )
            })?;
        let sent =
            send_totalmix_eq_update(&config.send_host, config.send_port, &channel.id, request)?;

        if sent == 0 {
            return Ok(AudioEqUpdateOutcome {
                summary: format!(
                    "Updated local EQ state for '{}'; TotalMix exposes no OSC command for that field.",
                    channel.name
                ),
                hardware_status: String::from("local"),
            });
        }

        Ok(AudioEqUpdateOutcome {
            summary: format!(
                "Sent {} TotalMix EQ command{} for '{}'; hardware confirmation is pending.",
                sent,
                if sent == 1 { "" } else { "s" },
                channel.name
            ),
            hardware_status: String::from("pending"),
        })
    }
}

fn ensure_transport_configured(config: &AudioBackendConfig) -> Result<(), String> {
    if config.send_host.trim().is_empty() || config.send_port <= 0 || config.receive_port <= 0 {
        return Err(String::from("Audio OSC transport is not configured."));
    }

    Ok(())
}

fn bool_label(value: bool) -> &'static str {
    if value {
        "on"
    } else {
        "off"
    }
}

fn simulated_channel(
    id: &str,
    name: &str,
    short_name: &str,
    role: &str,
    stereo: bool,
    gain: i64,
    fader: f64,
) -> AudioChannelSnapshot {
    let meter_frame = simulated_meter_frame(id, role, stereo);

    AudioChannelSnapshot {
        id: String::from(id),
        name: String::from(name),
        short_name: String::from(short_name),
        role: String::from(role),
        stereo,
        gain,
        fader,
        meter_left: meter_frame.meter_left,
        meter_right: meter_frame.meter_right,
        meter_level: meter_frame.meter_level,
        peak_hold: meter_frame.peak_hold,
        peak_hold_left: meter_frame.peak_hold_left,
        peak_hold_right: meter_frame.peak_hold_right,
        clip: meter_frame.clip,
        mix_levels: default_mix_levels(fader, role),
        mute: matches!(id, "audio-input-3" | "audio-input-4"),
        solo: false,
        phantom: role == "front-preamp",
        phase: false,
        pad: false,
        instrument: id == "audio-input-12",
        auto_set: false,
        eq: default_audio_eq_snapshot(),
        dynamics: default_audio_dynamics_snapshot(),
        send_modes: default_send_modes(),
    }
}

fn clear_channel_meter(channel: &mut AudioChannelSnapshot) {
    channel.meter_left = 0.0;
    channel.meter_right = 0.0;
    channel.meter_level = 0.0;
    channel.peak_hold = 0.0;
    channel.peak_hold_left = 0.0;
    channel.peak_hold_right = 0.0;
    channel.clip = false;
}

fn clear_mix_target_meter(mix_target: &mut AudioMixTargetSnapshot) {
    mix_target.meter_left = 0.0;
    mix_target.meter_right = 0.0;
    mix_target.meter_level = 0.0;
    mix_target.peak_hold = 0.0;
    mix_target.peak_hold_left = 0.0;
    mix_target.peak_hold_right = 0.0;
}

fn empty_audio_scene_preview() -> AudioScenePreviewSnapshot {
    AudioScenePreviewSnapshot {
        has_contents: false,
        channel_count: 0,
        mix_target_count: 0,
        changed_channels: Vec::new(),
        changed_mix_targets: Vec::new(),
    }
}

fn default_send_modes() -> HashMap<String, crate::audio::AudioSendModeSnapshot> {
    HashMap::from([
        (
            String::from("audio-mix-main"),
            default_audio_send_mode_snapshot(),
        ),
        (
            String::from("audio-mix-phones-a"),
            default_audio_send_mode_snapshot(),
        ),
        (
            String::from("audio-mix-phones-b"),
            default_audio_send_mode_snapshot(),
        ),
    ])
}

fn simulated_meter_frame(id: &str, role: &str, stereo: bool) -> AudioMeterFrame {
    let elapsed_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or(0.0);
    let (meter_left, meter_right) = simulated_body_level_pair_at(elapsed_ms, id, role, stereo);
    let meter_level = meter_left.max(meter_right);
    let (peak_hold_left, peak_hold_right) =
        simulated_peak_hold_pair_at(elapsed_ms, id, role, stereo, meter_left, meter_right);
    let peak_hold = peak_hold_left.max(peak_hold_right);
    let clip = simulated_recent_raw_peak_at(elapsed_ms, id, role, stereo, 700.0) >= 0.985;

    AudioMeterFrame {
        meter_left,
        meter_right,
        meter_level,
        peak_hold,
        peak_hold_left,
        peak_hold_right,
        clip,
    }
}

fn simulated_body_level_pair_at(elapsed_ms: f64, id: &str, role: &str, stereo: bool) -> (f64, f64) {
    let samples = [
        (0.0, 0.30),
        (85.0, 0.24),
        (170.0, 0.18),
        (270.0, 0.14),
        (390.0, 0.10),
        (480.0, 0.04),
    ];
    let mut left = 0.0;
    let mut right = 0.0;
    let mut total_weight = 0.0;
    for (age_ms, weight) in samples {
        let (sample_left, sample_right) =
            simulated_raw_body_level_pair_at((elapsed_ms - age_ms).max(0.0), id, role, stereo);
        left += sample_left * weight;
        right += sample_right * weight;
        total_weight += weight;
    }

    (
        (left / total_weight).clamp(0.0, 0.96),
        (right / total_weight).clamp(0.0, 0.96),
    )
}

fn simulated_peak_hold_pair_at(
    elapsed_ms: f64,
    id: &str,
    role: &str,
    stereo: bool,
    meter_left: f64,
    meter_right: f64,
) -> (f64, f64) {
    let mut peak_left = meter_left;
    let mut peak_right = meter_right;
    let mut age_ms = 0.0;
    while age_ms <= FAIRLIGHT_PEAK_HISTORY_MS {
        let (raw_left, raw_right) =
            simulated_raw_peak_level_pair_at((elapsed_ms - age_ms).max(0.0), id, role, stereo);
        peak_left = peak_left.max(fairlight_held_peak_at_age(raw_left, meter_left, age_ms));
        peak_right = peak_right.max(fairlight_held_peak_at_age(raw_right, meter_right, age_ms));
        age_ms += FAIRLIGHT_PEAK_SCAN_STEP_MS;
    }

    (
        peak_left.clamp(meter_left, 1.0),
        peak_right.clamp(meter_right, 1.0),
    )
}

fn fairlight_held_peak_at_age(raw: f64, body: f64, age_ms: f64) -> f64 {
    if !raw.is_finite() || raw <= 0.0 {
        return body.clamp(0.0, 1.0);
    }

    let fall_db =
        ((age_ms - FAIRLIGHT_PEAK_HOLD_MS).max(0.0) / 1000.0) * FAIRLIGHT_PEAK_FALL_DB_PER_SECOND;
    let dbfs = normalized_to_dbfs(raw) - fall_db;
    dbfs_to_normalized(dbfs).max(body).clamp(body, 1.0)
}

fn normalized_to_dbfs(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return AUDIO_METER_FLOOR_DBFS;
    }
    (20.0 * value.clamp(0.0, 1.0).log10()).clamp(AUDIO_METER_FLOOR_DBFS, 0.0)
}

fn dbfs_to_normalized(dbfs: f64) -> f64 {
    if !dbfs.is_finite() {
        return 0.0;
    }
    10.0_f64.powf(dbfs.clamp(AUDIO_METER_FLOOR_DBFS, 0.0) / 20.0)
}

fn simulated_recent_raw_peak_at(
    elapsed_ms: f64,
    id: &str,
    role: &str,
    stereo: bool,
    window_ms: f64,
) -> f64 {
    let mut peak = 0.0_f64;
    let mut age_ms = 0.0;
    while age_ms <= window_ms {
        let (left, right) =
            simulated_raw_peak_level_pair_at((elapsed_ms - age_ms).max(0.0), id, role, stereo);
        peak = peak.max(left.max(right));
        age_ms += 140.0;
    }
    peak
}

fn simulated_raw_body_level_pair_at(
    elapsed_ms: f64,
    id: &str,
    role: &str,
    stereo: bool,
) -> (f64, f64) {
    simulated_raw_level_pair_at(elapsed_ms, id, role, stereo, SimulatedMeterDetector::Body)
}

fn simulated_raw_peak_level_pair_at(
    elapsed_ms: f64,
    id: &str,
    role: &str,
    stereo: bool,
) -> (f64, f64) {
    simulated_raw_level_pair_at(elapsed_ms, id, role, stereo, SimulatedMeterDetector::Peak)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SimulatedMeterDetector {
    Body,
    Peak,
}

fn simulated_raw_level_pair_at(
    elapsed_ms: f64,
    id: &str,
    role: &str,
    stereo: bool,
    detector: SimulatedMeterDetector,
) -> (f64, f64) {
    let seed = id.bytes().fold(0_u64, |accumulator, byte| {
        accumulator.wrapping_mul(33).wrapping_add(byte as u64)
    });
    let phase_offset_seconds = ((seed % 100_000) as f64 / 100_000.0) * 17.0;
    let t = (elapsed_ms / 1000.0) + phase_offset_seconds;
    let channel_index = id
        .split('-')
        .next_back()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or((seed % 11) as f64);

    let (left, right) = if role == "front-preamp" {
        recorded_speech_pair(t, channel_index, 1.0, detector)
    } else if role == "rear-line" {
        if id.contains("remote") || id.ends_with("-3") || id.ends_with("-4") {
            recorded_speech_pair(t + 21.0, channel_index, 0.42, detector)
        } else {
            let room = real_speech_profile_at(t + channel_index * 3.1, detector) * 0.12;
            let floor = 0.004 + 0.004 * lfo(t, 0.41, 0.0).max(0.0);
            let level = (floor + room).clamp(0.003, 0.12);
            (level, level * 0.9)
        }
    } else if id == "audio-playback-1-2" {
        recorded_program_pair(t, channel_index, 0.92, detector)
    } else if id == "audio-playback-3-4" {
        let sting = pulse(t % 11.0, 1.1, 0.22) + 0.72 * pulse(t % 11.0, 6.7, 0.32);
        let bed = 0.07 + 0.02 * lfo(t, 0.9, 0.0);
        let left = (bed + 0.62 * sting).clamp(0.04, 0.84);
        let right = (bed * 0.92 + 0.56 * sting + 0.02 * lfo(t, 2.1, 0.8)).clamp(0.04, 0.8);
        (left, right)
    } else if id == "audio-playback-5-6" {
        recorded_program_pair(t + 37.0, channel_index, 0.58, detector)
    } else if id == "audio-playback-7-8" {
        let groove = 0.34 + 0.12 * lfo(t, 0.36, 0.0) + 0.06 * lfo(t, 1.8, 0.2);
        let width = 0.08 * lfo(t, 0.71, 1.4);
        (
            (groove - width).clamp(0.16, 0.76),
            (groove + width * 0.86).clamp(0.16, 0.78),
        )
    } else if role == "playback-pair" {
        let level = (0.11 + 0.035 * lfo(t, 0.31, 0.5) + 0.018 * lfo(t, 1.4, 1.1)).clamp(0.04, 0.22);
        (
            level,
            (level * 0.92 + 0.02 * lfo(t, 0.8, 0.6)).clamp(0.04, 0.24),
        )
    } else {
        let level = (0.06 + 0.025 * lfo(t, 0.8, 0.0)).clamp(0.02, 0.16);
        (level, level * 0.9)
    };

    if stereo {
        (left.clamp(0.0, 0.96), right.clamp(0.0, 0.96))
    } else {
        let mono = left.max(right).clamp(0.0, 0.96);
        (mono, mono)
    }
}

fn real_speech_profile_at(seconds: f64, detector: SimulatedMeterDetector) -> f64 {
    match detector {
        SimulatedMeterDetector::Body => real_speech_body_level_at(seconds),
        SimulatedMeterDetector::Peak => real_speech_peak_level_at(seconds),
    }
}

fn recorded_speech_pair(
    t: f64,
    channel_index: f64,
    gain: f64,
    detector: SimulatedMeterDetector,
) -> (f64, f64) {
    let offset = channel_index * 11.9;
    let left = real_speech_profile_at(t + offset, detector) * gain;
    let right = real_speech_profile_at(t + offset + 0.11, detector) * gain * 0.96;

    (left.clamp(0.0, 0.96), right.clamp(0.0, 0.96))
}

fn recorded_program_pair(
    t: f64,
    channel_index: f64,
    gain: f64,
    detector: SimulatedMeterDetector,
) -> (f64, f64) {
    let offset = channel_index * 4.7;
    let host = real_speech_profile_at(t + offset, detector);
    let guest = real_speech_profile_at(t + offset + 23.0, detector);
    let remote = real_speech_profile_at(t + offset + 51.0, detector);
    let host_right = real_speech_profile_at(t + offset + 1.3, detector);
    let guest_right = real_speech_profile_at(t + offset + 24.8, detector);
    let bed = 0.006;
    let left = bed + gain * (host * 0.72 + guest * 0.34 + remote * 0.08);
    let right = bed + gain * (host_right * 0.62 + guest_right * 0.42 + remote * 0.07);

    (left.clamp(0.0, 0.96), right.clamp(0.0, 0.96))
}

fn pulse(phase: f64, center: f64, width: f64) -> f64 {
    let distance = ((phase - center) / width).abs();
    if distance >= 1.0 {
        0.0
    } else {
        let shaped = 1.0 - distance;
        shaped * shaped * (3.0 - 2.0 * shaped)
    }
}

fn lfo(t: f64, hz: f64, offset: f64) -> f64 {
    ((t * hz * std::f64::consts::TAU) + offset).sin()
}

fn default_mix_levels(main: f64, role: &str) -> HashMap<String, f64> {
    let (phones_a_pad, phones_b_pad) = if role == "playback-pair" {
        (0.04, 0.08)
    } else {
        (0.06, 0.10)
    };

    HashMap::from([
        (String::from("audio-mix-main"), main),
        (
            String::from("audio-mix-phones-a"),
            (main - phones_a_pad).clamp(0.0, 1.0),
        ),
        (
            String::from("audio-mix-phones-b"),
            (main - phones_b_pad).clamp(0.0, 1.0),
        ),
    ])
}

pub fn read_default_audio_inventory(config: &AudioBackendConfig) -> AudioBackendInventory {
    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        SimulatedAudioBackend.read_inventory(config)
    } else {
        RmeTotalMixOscBackend.read_inventory(config)
    }
}

pub fn sync_default_audio_console(
    config: &AudioBackendConfig,
    inventory: &AudioBackendInventory,
) -> Result<AudioSyncOutcome, String> {
    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        SimulatedAudioBackend.sync_console(config, inventory)
    } else {
        RmeTotalMixOscBackend.sync_console(config, inventory)
    }
}

pub fn recall_default_audio_snapshot(
    config: &AudioBackendConfig,
    inventory: &AudioBackendInventory,
    snapshot_id: &str,
) -> Result<AudioSnapshotRecallOutcome, String> {
    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        SimulatedAudioBackend.recall_snapshot(config, inventory, snapshot_id)
    } else {
        RmeTotalMixOscBackend.recall_snapshot(config, inventory, snapshot_id)
    }
}

pub fn update_default_audio_channel(
    config: &AudioBackendConfig,
    inventory: &AudioBackendInventory,
    request: &AudioChannelUpdateRequest,
) -> Result<AudioChannelUpdateOutcome, String> {
    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        SimulatedAudioBackend.update_channel(config, inventory, request)
    } else {
        RmeTotalMixOscBackend.update_channel(config, inventory, request)
    }
}

pub fn update_default_audio_mix_target(
    config: &AudioBackendConfig,
    inventory: &AudioBackendInventory,
    request: &AudioMixTargetUpdateRequest,
) -> Result<AudioMixTargetUpdateOutcome, String> {
    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        SimulatedAudioBackend.update_mix_target(config, inventory, request)
    } else {
        RmeTotalMixOscBackend.update_mix_target(config, inventory, request)
    }
}

pub fn update_default_audio_eq(
    config: &AudioBackendConfig,
    inventory: &AudioBackendInventory,
    request: &AudioEqUpdateRequest,
) -> Result<AudioEqUpdateOutcome, String> {
    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        SimulatedAudioBackend.update_eq(config, inventory, request)
    } else {
        RmeTotalMixOscBackend.update_eq(config, inventory, request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_config() -> AudioBackendConfig {
        AudioBackendConfig {
            send_host: String::from("127.0.0.1"),
            send_port: 7001,
            receive_port: 9001,
            metering_source: String::from(SIMULATED_AUDIO_SOURCE),
        }
    }

    #[test]
    fn simulated_audio_backend_returns_empty_inventory_for_invalid_transport() {
        let inventory = read_default_audio_inventory(&AudioBackendConfig {
            send_host: String::new(),
            send_port: 0,
            receive_port: 0,
            metering_source: String::from(SIMULATED_AUDIO_SOURCE),
        });

        assert_eq!(inventory.adapter_mode, "simulated");
        assert!(inventory.channels.is_empty());
        assert!(inventory.mix_targets.is_empty());
        assert!(inventory.snapshots.is_empty());
    }

    #[test]
    fn simulated_audio_backend_returns_inventory_for_valid_transport() {
        let inventory = read_default_audio_inventory(&valid_config());

        assert_eq!(inventory.adapter_mode, "simulated");
        assert_eq!(inventory.channels.len(), 18);
        assert_eq!(inventory.mix_targets.len(), 3);
        assert_eq!(inventory.snapshots.len(), 3);
    }

    #[test]
    fn simulated_audio_backend_syncs_when_transport_and_inventory_exist() {
        let config = valid_config();
        let inventory = read_default_audio_inventory(&config);

        let outcome =
            sync_default_audio_console(&config, &inventory).expect("simulated sync should succeed");

        assert!(outcome.summary.contains("Simulated console sync"));
    }

    #[test]
    fn simulated_audio_backend_rejects_unknown_snapshot() {
        let config = valid_config();
        let inventory = read_default_audio_inventory(&config);

        let error = recall_default_audio_snapshot(&config, &inventory, "snapshot-missing")
            .expect_err("unknown snapshot should be rejected");

        assert!(error.contains("snapshot-missing"));
    }

    #[test]
    fn simulated_audio_backend_updates_channels() {
        let config = valid_config();
        let inventory = read_default_audio_inventory(&config);

        let outcome = update_default_audio_channel(
            &config,
            &inventory,
            &AudioChannelUpdateRequest {
                channel_id: String::from("audio-input-9"),
                mix_target_id: Some(String::from("audio-mix-main")),
                name: None,
                gain: None,
                fader: Some(0.82),
                mute: Some(true),
                solo: None,
                phantom: None,
                phase: None,
                pad: None,
                instrument: None,
                auto_set: None,
            },
        )
        .expect("channel update should succeed");

        assert!(outcome.summary.contains("Host"));
        assert!(outcome.summary.contains("mute -> on"));
    }

    #[test]
    fn simulated_audio_backend_updates_mix_targets() {
        let config = valid_config();
        let inventory = read_default_audio_inventory(&config);

        let outcome = update_default_audio_mix_target(
            &config,
            &inventory,
            &AudioMixTargetUpdateRequest {
                mix_target_id: String::from("audio-mix-main"),
                volume: Some(0.88),
                mute: Some(false),
                dim: Some(true),
                mono: None,
                talkback: None,
            },
        )
        .expect("mix target update should succeed");

        assert!(outcome.summary.contains("Main Out"));
        assert!(outcome.summary.contains("dim -> on"));
    }

    #[test]
    fn simulated_meter_seed_does_not_quantize_thirty_hz_motion() {
        let base_epoch_ms = 1_768_563_000_000.0;
        let mut previous_level: Option<f64> = None;
        let mut current_unchanged_run = 0;
        let mut longest_unchanged_run = 0;

        for tick in 0..90 {
            let (level, _) = simulated_body_level_pair_at(
                base_epoch_ms + f64::from(tick) * 33.0,
                "audio-input-9",
                "front-preamp",
                false,
            );
            if previous_level.is_some_and(|previous| (previous - level).abs() < 0.000_001) {
                current_unchanged_run += 1;
                longest_unchanged_run = longest_unchanged_run.max(current_unchanged_run);
            } else {
                current_unchanged_run = 0;
            }
            previous_level = Some(level);
        }

        assert!(
            longest_unchanged_run <= 3,
            "simulated meter body should not hold the exact same value for long 30 Hz runs; longest unchanged run was {longest_unchanged_run}"
        );
    }

    #[test]
    fn simulated_front_preamp_meter_has_speech_like_dynamics_and_pauses() {
        let levels = sampled_meter_levels("audio-input-9", "front-preamp", false, 60_000.0);
        let p05 = percentile(&levels, 0.05);
        let p50 = percentile(&levels, 0.50);
        let p95 = percentile(&levels, 0.95);
        let low_count = levels.iter().filter(|level| **level <= 0.018).count();
        let hot_count = levels.iter().filter(|level| **level >= 0.50).count();

        assert!(
            p05 < 0.04,
            "speech simulation should regularly fall back toward room/noise-floor levels; p05={p05:.3}"
        );
        assert!(
            p95 > 0.10 && p95 < 0.22,
            "speech simulation should produce a true RMS speech body without behaving like pinned program audio; p95={p95:.3}"
        );
        assert!(
            p50 > 0.04 && p50 < 0.14,
            "speech simulation should sit in a plausible spoken-word RMS body range; p50={p50:.3}"
        );
        assert!(
            low_count * 20 > levels.len(),
            "speech simulation should include real rests and low-level gaps; low_count={low_count}, total={}",
            levels.len()
        );
        assert!(
            hot_count * 20 < levels.len(),
            "speech simulation should almost never sit at -6 dBFS or hotter; hot_count={hot_count}, total={}",
            levels.len()
        );
    }

    #[test]
    fn simulated_program_playback_has_stereo_width_without_meter_lockstep() {
        let base_epoch_ms = 1_768_563_000_000.0;
        let mut left_levels = Vec::new();
        let mut right_levels = Vec::new();

        for tick in 0..900 {
            let (left, right) = simulated_body_level_pair_at(
                base_epoch_ms + f64::from(tick) * 33.0,
                "audio-playback-1-2",
                "playback-pair",
                true,
            );
            left_levels.push(left);
            right_levels.push(right);
        }

        let median_side_delta = median(
            left_levels
                .iter()
                .zip(&right_levels)
                .map(|(left, right)| (left - right).abs())
                .collect(),
        );
        assert!(
            median_side_delta > 0.025,
            "stereo program simulation should not move as two locked mono bars"
        );
        assert!(
            correlation(&left_levels, &right_levels) < 0.985,
            "stereo program simulation should have related but not identical channel movement"
        );
    }

    #[test]
    fn simulated_peak_hold_falls_in_db_after_fairlight_hold_window() {
        let raw = 0.80;
        let body = 0.01;
        let held = fairlight_held_peak_at_age(raw, body, FAIRLIGHT_PEAK_HOLD_MS);
        let decayed = fairlight_held_peak_at_age(raw, body, FAIRLIGHT_PEAK_HOLD_MS + 1_000.0);

        assert!((held - raw).abs() < 0.000_001);
        assert!(
            (normalized_to_dbfs(decayed) - (normalized_to_dbfs(raw) - 20.0)).abs() < 0.001,
            "peak hold should fall by 20 dB after one second past the hold window"
        );
    }

    fn sampled_meter_levels(id: &str, role: &str, stereo: bool, duration_ms: f64) -> Vec<f64> {
        let base_epoch_ms = 1_768_563_000_000.0;
        let ticks = (duration_ms / 33.0).round() as i32;
        (0..ticks)
            .map(|tick| {
                let (left, right) = simulated_body_level_pair_at(
                    base_epoch_ms + f64::from(tick) * 33.0,
                    id,
                    role,
                    stereo,
                );
                left.max(right)
            })
            .collect()
    }

    fn percentile(levels: &[f64], quantile: f64) -> f64 {
        let mut sorted = levels.to_vec();
        sorted.sort_by(f64::total_cmp);
        let index = ((sorted.len() - 1) as f64 * quantile).round() as usize;
        sorted[index]
    }

    fn median(levels: Vec<f64>) -> f64 {
        percentile(&levels, 0.5)
    }

    fn correlation(left: &[f64], right: &[f64]) -> f64 {
        let left_mean = left.iter().sum::<f64>() / left.len() as f64;
        let right_mean = right.iter().sum::<f64>() / right.len() as f64;
        let covariance = left
            .iter()
            .zip(right)
            .map(|(left, right)| (left - left_mean) * (right - right_mean))
            .sum::<f64>()
            / left.len() as f64;
        let left_std = (left
            .iter()
            .map(|level| (level - left_mean).powi(2))
            .sum::<f64>()
            / left.len() as f64)
            .sqrt();
        let right_std = (right
            .iter()
            .map(|level| (level - right_mean).powi(2))
            .sum::<f64>()
            / right.len() as f64)
            .sqrt();

        covariance / (left_std * right_std)
    }
}
