use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    clear_all_audio_solo, ensure_audio_action_allowed, parse_audio_snapshot_recall_request,
    read_audio_snapshot, recall_audio_snapshot, update_audio_channel, update_audio_mix_target,
    update_audio_settings, AudioChannelUpdateRequest, AudioCommandError,
    AudioMixTargetUpdateRequest, AudioSettingsUpdateRequest, AudioSnapshot,
};
use crate::control_surface::{
    clamp_i64, cycle_value, emit_audio_changed, map_planning_error, truncate, ControlSurfaceError,
};
use crate::planning::{parse_planning_settings_update, update_planning_settings};
use crate::storage::{list_settings_by_prefix, set_settings_owned};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const AUDIO_DECK_BANK_KEY: &str = "app.control_surface.audio.bank";
const AUDIO_DECK_DIAL_MODE_KEY: &str = "app.control_surface.audio.dial_mode";
const AUDIO_DECK_BANK_CYCLE: &[&str] = &["inputs", "playback", "outputs"];
const AUDIO_DECK_FADER_STEP: f64 = 0.01;
const AUDIO_DECK_FAST_TURN_WINDOW: Duration = Duration::from_millis(80);
const AUDIO_DECK_FAST_TURN_MULTIPLIER: f64 = 5.0;
const AUDIO_DECK_TALK_RELEASE: Duration = Duration::from_secs(2);
const AUDIO_ROLE_FRONT_PREAMP: &str = "front-preamp";
const AUDIO_ROLE_PLAYBACK_PAIR: &str = "playback-pair";
const AUDIO_MAIN_MIX_TARGET_ROLE: &str = "main-out";
const AUDIO_PREAMP_GAIN_MIN: i64 = 0;
const AUDIO_PREAMP_GAIN_MAX: i64 = 75;

#[derive(Debug)]
pub(crate) enum AudioDeckStrip {
    Channel(Box<crate::audio::AudioChannelSnapshot>),
    MixTarget(crate::audio::AudioMixTargetSnapshot),
}

static AUDIO_DIAL_TURN_TIMES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static AUDIO_TALK_DEADLINES: OnceLock<Mutex<HashMap<PathBuf, Instant>>> = OnceLock::new();
static AUDIO_TALK_WATCHDOG: OnceLock<()> = OnceLock::new();

fn audio_fader_db_label(value: f64) -> String {
    let normalized = if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    };
    if normalized <= 0.0 {
        return String::from("-\u{221e} dB");
    }
    let db = if normalized >= 1.0 {
        6.0
    } else if normalized <= 0.7 {
        -60.0 + (normalized / 0.7) * 50.0
    } else if normalized <= 0.8 {
        -10.0 + ((normalized - 0.7) / 0.1) * 10.0
    } else {
        ((normalized - 0.8) / 0.2) * 6.0
    };
    format!("{db:+.1} dB")
}

pub(crate) fn audio_deck_gate_label(snapshot: &AudioSnapshot) -> Option<&'static str> {
    if !snapshot.osc_enabled {
        return Some("OSC OFF");
    }
    match snapshot.status.as_str() {
        "ready" => None,
        "attention" => Some("CHECK OSC"),
        "not-verified" => Some("NOT VERIFIED"),
        _ => Some("OFFLINE"),
    }
}

pub(crate) fn audio_strip_lcd_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    strip_index: usize,
) -> String {
    if let Some(gate) = audio_deck_gate_label(snapshot) {
        return format!("AUDIO\\n{gate}");
    }

    let bank = audio_deck_bank(app_settings);
    let dial_mode = audio_deck_dial_mode(app_settings);
    match resolve_audio_deck_strip(snapshot, &bank, strip_index) {
        Ok(AudioDeckStrip::Channel(channel)) => {
            let marker = if snapshot.selected_channel_id.as_deref() == Some(channel.id.as_str()) {
                "\u{2022} "
            } else {
                ""
            };
            let name = truncate(&channel.name.to_uppercase(), 10);
            if bank == "inputs" && dial_mode == "gain" {
                format!("{marker}{name}\\nGAIN {} dB", channel.gain)
            } else {
                let level = channel
                    .mix_levels
                    .get(&snapshot.selected_mix_target_id)
                    .copied()
                    .unwrap_or(channel.fader);
                let level_line = if channel.mute {
                    String::from("MUTED")
                } else {
                    audio_fader_db_label(level)
                };
                format!("{marker}{name}\\n{level_line}")
            }
        }
        Ok(AudioDeckStrip::MixTarget(target)) => {
            let marker = if snapshot.selected_mix_target_id == target.id {
                "\u{2022} "
            } else {
                ""
            };
            let level_line = if target.mute {
                String::from("MUTED")
            } else {
                audio_fader_db_label(target.volume)
            };
            format!(
                "{marker}{}\\n{level_line}",
                truncate(&target.name.to_uppercase(), 10)
            )
        }
        Err(_) => String::from("\u{2014}"),
    }
}

pub(crate) fn audio_strip_key_index(key: &str) -> usize {
    key.trim_start_matches("audio_strip_")
        .split('_')
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
}

pub(crate) fn audio_strip_state_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    strip_index: usize,
) -> String {
    if audio_deck_gate_label(snapshot).is_some() {
        return String::from("offline");
    }

    let bank = audio_deck_bank(app_settings);
    match resolve_audio_deck_strip(snapshot, &bank, strip_index) {
        Ok(AudioDeckStrip::Channel(channel)) => {
            if channel.mute {
                String::from("muted")
            } else if snapshot.selected_channel_id.as_deref() == Some(channel.id.as_str()) {
                String::from("selected")
            } else {
                String::from("normal")
            }
        }
        Ok(AudioDeckStrip::MixTarget(target)) => {
            if target.mute {
                String::from("muted")
            } else if snapshot.selected_mix_target_id == target.id {
                String::from("selected")
            } else {
                String::from("normal")
            }
        }
        Err(_) => String::from("empty"),
    }
}

pub(crate) fn audio_strip_level_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    strip_index: usize,
) -> String {
    if audio_deck_gate_label(snapshot).is_some() {
        return String::from("off");
    }

    let bank = audio_deck_bank(app_settings);
    let dial_mode = audio_deck_dial_mode(app_settings);
    let bucket_of = |value: f64| -> u32 { (value.clamp(0.0, 1.0) * 12.0).round() as u32 };
    match resolve_audio_deck_strip(snapshot, &bank, strip_index) {
        Ok(AudioDeckStrip::Channel(channel)) => {
            let bucket = if bank == "inputs" && dial_mode == "gain" {
                bucket_of(channel.gain as f64 / 75.0)
            } else {
                bucket_of(
                    channel
                        .mix_levels
                        .get(&snapshot.selected_mix_target_id)
                        .copied()
                        .unwrap_or(channel.fader),
                )
            };
            if channel.mute {
                format!("m{bucket}")
            } else {
                bucket.to_string()
            }
        }
        Ok(AudioDeckStrip::MixTarget(target)) => {
            let bucket = bucket_of(target.volume);
            if target.mute {
                format!("m{bucket}")
            } else {
                bucket.to_string()
            }
        }
        Err(_) => String::from("empty"),
    }
}

pub(crate) fn audio_state_value_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    which: &str,
) -> Result<String, ControlSurfaceError> {
    match which {
        "target" => Ok(snapshot
            .mix_targets
            .iter()
            .find(|target| target.id == snapshot.selected_mix_target_id)
            .map(|target| target.role.clone())
            .map(|role| {
                if role == "main-out" {
                    String::from("main")
                } else {
                    role
                }
            })
            .unwrap_or_else(|| String::from("main"))),
        "bank" => Ok(audio_deck_bank(app_settings)),
        "mode" => Ok(if audio_deck_bank(app_settings) == "inputs" {
            audio_deck_dial_mode(app_settings)
        } else {
            String::from("n/a")
        }),
        "dim" => Ok(audio_main_mix_target(snapshot)
            .map(|main| if main.dim { "on" } else { "off" })
            .unwrap_or("off")
            .to_string()),
        "talk" => Ok(audio_main_mix_target(snapshot)
            .map(|main| if main.talkback { "live" } else { "hold" })
            .unwrap_or("hold")
            .to_string()),
        "solo" => Ok(snapshot
            .channels
            .iter()
            .filter(|entry| entry.solo)
            .count()
            .to_string()),
        "gated" => Ok(if audio_deck_gate_label(snapshot).is_some() {
            String::from("yes")
        } else {
            String::from("no")
        }),
        other => Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported audio state key: {other}"
        ))),
    }
}

pub(crate) fn audio_key_lcd_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    key_index: usize,
) -> String {
    let gate = audio_deck_gate_label(snapshot);
    let main = audio_main_mix_target(snapshot);
    match key_index {
        // The active mix target reads through the amber feedback on the key;
        // the label itself stays static.
        1 => String::from("MAIN"),
        2 => String::from("PH 1"),
        3 => String::from("PH 2"),
        4 => format!("BANK\\n{}", audio_deck_bank(app_settings).to_uppercase()),
        5 => match (gate, main) {
            (None, Some(main)) => format!("DIM\\n{}", if main.dim { "ON" } else { "OFF" }),
            _ => String::from("DIM\\n--"),
        },
        6 => {
            if audio_deck_bank(app_settings) == "inputs" {
                format!(
                    "GAIN\\n{}",
                    if audio_deck_dial_mode(app_settings) == "gain" {
                        "ON"
                    } else {
                        "OFF"
                    }
                )
            } else {
                String::from("GAIN\\nN/A")
            }
        }
        7 => match (gate, main) {
            (None, Some(main)) => format!("TALK\\n{}", if main.talkback { "LIVE" } else { "HOLD" }),
            _ => String::from("TALK\\n--"),
        },
        8 => {
            if gate.is_some() {
                return String::from("SOLO\\n--");
            }
            let soloed = snapshot.channels.iter().filter(|entry| entry.solo).count();
            if soloed > 0 {
                format!("SOLO\\n{soloed} LIVE")
            } else {
                String::from("SOLO\\nCLEAR")
            }
        }
        _ => String::from("--"),
    }
}

pub(crate) fn handle_audio_action(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    match action {
        "switchToDeckMode" => {
            let deck_mode = value.unwrap_or("audio");
            let result = update_planning_settings(
                db_path,
                &parse_planning_settings_update(&json!({ "deckMode": deck_mode }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_planning_error)?;
            Ok(json!({ "deckMode": result.settings.deck_mode }))
        }
        "recallSnapshot" => {
            let (_, audio_snapshot) = current_audio_snapshot(db_path)?;
            let Some(snapshot) = audio_snapshot.snapshots.first() else {
                return Err(ControlSurfaceError::Rejected(String::from(
                    "No audio snapshot is available.",
                )));
            };
            let result = recall_audio_snapshot(
                db_path,
                &parse_audio_snapshot_recall_request(&json!({
                    "snapshotId": snapshot.id
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({ "recalled": result.snapshot_name }))
        }
        "dialTurn" => handle_audio_dial_turn(db_path, value),
        "dialPress" => handle_audio_dial_press(db_path, value),
        "stripTap" => handle_audio_strip_tap(db_path, value),
        "setMixTarget" => handle_audio_set_mix_target(db_path, value),
        "cycleBank" => handle_audio_cycle_bank(db_path),
        "toggleDialMode" => handle_audio_toggle_dial_mode(db_path),
        "dimToggle" => handle_audio_dim_toggle(db_path),
        "talkOn" => handle_audio_talk(db_path, true),
        "talkOff" => handle_audio_talk(db_path, false),
        "soloClearAll" => handle_audio_solo_clear_all(db_path),
        _ => Err(ControlSurfaceError::Unsupported(format!(
            "Unsupported audio deck action: {action}"
        ))),
    }
}

fn map_audio_error(error: AudioCommandError) -> ControlSurfaceError {
    match error {
        AudioCommandError::Rejected(_, message) => ControlSurfaceError::Rejected(message),
        AudioCommandError::Storage(message) => ControlSurfaceError::Storage(message),
    }
}

pub(crate) fn current_audio_snapshot(
    db_path: &Path,
) -> Result<(HashMap<String, String>, AudioSnapshot), ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let snapshot = read_audio_snapshot(&app_settings);
    Ok((app_settings, snapshot))
}

pub(crate) fn audio_deck_bank(settings: &HashMap<String, String>) -> String {
    settings
        .get(AUDIO_DECK_BANK_KEY)
        .filter(|value| AUDIO_DECK_BANK_CYCLE.contains(&value.as_str()))
        .cloned()
        .unwrap_or_else(|| String::from("inputs"))
}

pub(crate) fn audio_deck_dial_mode(settings: &HashMap<String, String>) -> String {
    settings
        .get(AUDIO_DECK_DIAL_MODE_KEY)
        .filter(|value| value.as_str() == "gain")
        .cloned()
        .unwrap_or_else(|| String::from("fader"))
}

fn parse_audio_strip_index(value: &str) -> Result<usize, ControlSurfaceError> {
    let index = value.trim().parse::<usize>().map_err(|_| {
        ControlSurfaceError::InvalidParams(String::from("strip index must be an integer"))
    })?;
    if !(1..=4).contains(&index) {
        return Err(ControlSurfaceError::InvalidParams(String::from(
            "strip index must be between 1 and 4",
        )));
    }
    Ok(index)
}

pub(crate) fn resolve_audio_deck_strip(
    snapshot: &AudioSnapshot,
    bank: &str,
    strip_index: usize,
) -> Result<AudioDeckStrip, ControlSurfaceError> {
    match bank {
        "playback" => snapshot
            .channels
            .iter()
            .filter(|channel| channel.role == AUDIO_ROLE_PLAYBACK_PAIR)
            .nth(strip_index - 1)
            .cloned()
            .map(|channel| AudioDeckStrip::Channel(Box::new(channel)))
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(format!(
                    "No playback strip {strip_index} is available."
                ))
            }),
        "outputs" => snapshot
            .mix_targets
            .get(strip_index - 1)
            .cloned()
            .map(AudioDeckStrip::MixTarget)
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(format!(
                    "No output strip {strip_index} is available."
                ))
            }),
        _ => snapshot
            .channels
            .iter()
            .filter(|channel| channel.role == AUDIO_ROLE_FRONT_PREAMP)
            .nth(strip_index - 1)
            .cloned()
            .map(|channel| AudioDeckStrip::Channel(Box::new(channel)))
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(format!("No input strip {strip_index} is available."))
            }),
    }
}

fn audio_main_mix_target(
    snapshot: &AudioSnapshot,
) -> Option<&crate::audio::AudioMixTargetSnapshot> {
    snapshot
        .mix_targets
        .iter()
        .find(|target| target.role == AUDIO_MAIN_MIX_TARGET_ROLE)
        .or_else(|| snapshot.mix_targets.first())
}

fn audio_channel_update_request(channel_id: &str) -> AudioChannelUpdateRequest {
    AudioChannelUpdateRequest {
        channel_id: String::from(channel_id),
        mix_target_id: None,
        name: None,
        gain: None,
        fader: None,
        mute: None,
        solo: None,
        phantom: None,
        phase: None,
        pad: None,
        instrument: None,
        auto_set: None,
    }
}

fn audio_mix_target_update_request(mix_target_id: &str) -> AudioMixTargetUpdateRequest {
    AudioMixTargetUpdateRequest {
        mix_target_id: String::from(mix_target_id),
        volume: None,
        mute: None,
        dim: None,
        mono: None,
        talkback: None,
    }
}

fn audio_settings_update_request() -> AudioSettingsUpdateRequest {
    AudioSettingsUpdateRequest {
        osc_enabled: None,
        send_host: None,
        send_port: None,
        receive_port: None,
        selected_channel_id: None,
        selected_mix_target_id: None,
        expected_peak_data: None,
        expected_submix_lock: None,
        expected_compatibility_mode: None,
        faders_per_bank: None,
        view_mode: None,
    }
}

fn audio_dial_turn_multiplier(turn_key: &str, now: Instant) -> f64 {
    let times = AUDIO_DIAL_TURN_TIMES.get_or_init(|| Mutex::new(HashMap::new()));
    let Ok(mut times) = times.lock() else {
        return 1.0;
    };
    let fast = times
        .get(turn_key)
        .is_some_and(|last| now.saturating_duration_since(*last) < AUDIO_DECK_FAST_TURN_WINDOW);
    times.insert(String::from(turn_key), now);
    if fast {
        AUDIO_DECK_FAST_TURN_MULTIPLIER
    } else {
        1.0
    }
}

fn audio_dial_turn_key(db_path: &Path, bank: &str, strip_index: usize) -> String {
    format!("{}|{bank}|{strip_index}", db_path.display())
}

fn handle_audio_dial_turn(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value.ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from(
            "dialTurn requires a value like \"1:up\" or \"3:down\"",
        ))
    })?;
    let (strip_raw, direction_raw) = value.split_once(':').ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from(
            "dialTurn requires a value like \"1:up\" or \"3:down\"",
        ))
    })?;
    let strip_index = parse_audio_strip_index(strip_raw)?;
    let step_sign: i64 = match direction_raw.trim() {
        "up" => 1,
        "down" => -1,
        _ => {
            return Err(ControlSurfaceError::InvalidParams(String::from(
                "dialTurn direction must be \"up\" or \"down\"",
            )))
        }
    };

    let (app_settings, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let bank = audio_deck_bank(&app_settings);
    let dial_mode = audio_deck_dial_mode(&app_settings);

    match resolve_audio_deck_strip(&snapshot, &bank, strip_index)? {
        AudioDeckStrip::Channel(channel) => {
            if bank == "inputs" && dial_mode == "gain" {
                let next_gain = clamp_i64(
                    channel.gain + step_sign,
                    AUDIO_PREAMP_GAIN_MIN,
                    AUDIO_PREAMP_GAIN_MAX,
                );
                let mut request = audio_channel_update_request(&channel.id);
                request.gain = Some(next_gain);
                let updated = update_audio_channel(db_path, &request).map_err(map_audio_error)?;
                emit_audio_changed();
                Ok(json!({
                    "strip": strip_index,
                    "channelId": updated.id,
                    "name": updated.name,
                    "gain": updated.gain,
                }))
            } else {
                let multiplier = audio_dial_turn_multiplier(
                    &audio_dial_turn_key(db_path, &bank, strip_index),
                    Instant::now(),
                );
                let mix_target_id = snapshot.selected_mix_target_id.clone();
                let current = channel
                    .mix_levels
                    .get(&mix_target_id)
                    .copied()
                    .unwrap_or(channel.fader);
                let next = (current + step_sign as f64 * AUDIO_DECK_FADER_STEP * multiplier)
                    .clamp(0.0, 1.0);
                let mut request = audio_channel_update_request(&channel.id);
                request.mix_target_id = Some(mix_target_id.clone());
                request.fader = Some(next);
                let updated = update_audio_channel(db_path, &request).map_err(map_audio_error)?;
                emit_audio_changed();
                let level = updated
                    .mix_levels
                    .get(&mix_target_id)
                    .copied()
                    .unwrap_or(updated.fader);
                Ok(json!({
                    "strip": strip_index,
                    "channelId": updated.id,
                    "name": updated.name,
                    "mixTargetId": mix_target_id,
                    "fader": level,
                }))
            }
        }
        AudioDeckStrip::MixTarget(target) => {
            let multiplier = audio_dial_turn_multiplier(
                &audio_dial_turn_key(db_path, &bank, strip_index),
                Instant::now(),
            );
            let next = (target.volume + step_sign as f64 * AUDIO_DECK_FADER_STEP * multiplier)
                .clamp(0.0, 1.0);
            let mut request = audio_mix_target_update_request(&target.id);
            request.volume = Some(next);
            let updated = update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "mixTargetId": updated.id,
                "name": updated.name,
                "volume": updated.volume,
            }))
        }
    }
}

fn handle_audio_dial_press(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value.ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from("dialPress requires a strip index value"))
    })?;
    let strip_index = parse_audio_strip_index(value)?;

    let (app_settings, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let bank = audio_deck_bank(&app_settings);

    match resolve_audio_deck_strip(&snapshot, &bank, strip_index)? {
        AudioDeckStrip::Channel(channel) => {
            let mut request = audio_channel_update_request(&channel.id);
            request.mute = Some(!channel.mute);
            let updated = update_audio_channel(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "channelId": updated.id,
                "name": updated.name,
                "mute": updated.mute,
            }))
        }
        AudioDeckStrip::MixTarget(target) => {
            let mut request = audio_mix_target_update_request(&target.id);
            request.mute = Some(!target.mute);
            let updated = update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "mixTargetId": updated.id,
                "name": updated.name,
                "mute": updated.mute,
            }))
        }
    }
}

fn handle_audio_strip_tap(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value.ok_or_else(|| {
        ControlSurfaceError::InvalidParams(String::from("stripTap requires a strip index value"))
    })?;
    let strip_index = parse_audio_strip_index(value)?;

    let (app_settings, snapshot) = current_audio_snapshot(db_path)?;
    let bank = audio_deck_bank(&app_settings);

    match resolve_audio_deck_strip(&snapshot, &bank, strip_index)? {
        AudioDeckStrip::Channel(channel) => {
            let mut request = audio_settings_update_request();
            request.selected_channel_id = Some(Some(channel.id.clone()));
            update_audio_settings(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "selectedChannelId": channel.id,
                "name": channel.name,
            }))
        }
        AudioDeckStrip::MixTarget(target) => {
            let mut request = audio_settings_update_request();
            request.selected_mix_target_id = Some(target.id.clone());
            update_audio_settings(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
            Ok(json!({
                "strip": strip_index,
                "selectedMixTargetId": target.id,
                "name": target.name,
            }))
        }
    }
}

fn handle_audio_set_mix_target(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ControlSurfaceError::InvalidParams(String::from(
                "setMixTarget requires a value of main, phones-a, or phones-b",
            ))
        })?;
    let mix_target_id = match value {
        "main" => "audio-mix-main",
        "phones-a" => "audio-mix-phones-a",
        "phones-b" => "audio-mix-phones-b",
        other => other,
    };

    let mut request = audio_settings_update_request();
    request.selected_mix_target_id = Some(String::from(mix_target_id));
    update_audio_settings(db_path, &request).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(json!({ "selectedMixTargetId": mix_target_id }))
}

fn handle_audio_cycle_bank(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let next = cycle_value(AUDIO_DECK_BANK_CYCLE, &audio_deck_bank(&app_settings), true);
    set_settings_owned(
        db_path,
        &[(String::from(AUDIO_DECK_BANK_KEY), next.clone())],
    )
    .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    Ok(json!({ "bank": next }))
}

fn handle_audio_toggle_dial_mode(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let next = if audio_deck_dial_mode(&app_settings) == "gain" {
        String::from("fader")
    } else {
        String::from("gain")
    };
    set_settings_owned(
        db_path,
        &[(String::from(AUDIO_DECK_DIAL_MODE_KEY), next.clone())],
    )
    .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    Ok(json!({ "dialMode": next }))
}

fn handle_audio_dim_toggle(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let main = audio_main_mix_target(&snapshot).ok_or_else(|| {
        ControlSurfaceError::Rejected(String::from("No main output mix target is available."))
    })?;
    let mut request = audio_mix_target_update_request(&main.id);
    request.dim = Some(!main.dim);
    let updated = update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(json!({ "mixTargetId": updated.id, "dim": updated.dim }))
}

fn handle_audio_talk(db_path: &Path, engage: bool) -> Result<Value, ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    let main = audio_main_mix_target(&snapshot).ok_or_else(|| {
        ControlSurfaceError::Rejected(String::from("No main output mix target is available."))
    })?;
    let main_id = main.id.clone();
    let currently_on = main.talkback;

    if engage {
        ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
        arm_audio_talk_watchdog(db_path);
        if !currently_on {
            let mut request = audio_mix_target_update_request(&main_id);
            request.talkback = Some(true);
            update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
        }
        Ok(json!({ "mixTargetId": main_id, "talkback": true }))
    } else {
        clear_audio_talk_deadline(db_path);
        if currently_on {
            let mut request = audio_mix_target_update_request(&main_id);
            request.talkback = Some(false);
            update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
            emit_audio_changed();
        }
        Ok(json!({ "mixTargetId": main_id, "talkback": false }))
    }
}

fn handle_audio_solo_clear_all(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let soloed = snapshot.channels.iter().filter(|entry| entry.solo).count();
    clear_all_audio_solo(db_path).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(json!({ "cleared": soloed }))
}

fn arm_audio_talk_watchdog(db_path: &Path) {
    let deadlines = AUDIO_TALK_DEADLINES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut deadlines) = deadlines.lock() {
        deadlines.insert(
            db_path.to_path_buf(),
            Instant::now() + AUDIO_DECK_TALK_RELEASE,
        );
    }
    AUDIO_TALK_WATCHDOG.get_or_init(|| {
        thread::spawn(run_audio_talk_watchdog);
    });
}

fn clear_audio_talk_deadline(db_path: &Path) {
    if let Some(deadlines) = AUDIO_TALK_DEADLINES.get() {
        if let Ok(mut deadlines) = deadlines.lock() {
            deadlines.remove(db_path);
        }
    }
}

fn run_audio_talk_watchdog() {
    loop {
        thread::sleep(Duration::from_millis(250));
        let Some(deadlines) = AUDIO_TALK_DEADLINES.get() else {
            continue;
        };
        let expired: Vec<PathBuf> = {
            let Ok(mut deadlines) = deadlines.lock() else {
                continue;
            };
            let now = Instant::now();
            let expired = deadlines
                .iter()
                .filter(|(_, deadline)| now >= **deadline)
                .map(|(path, _)| path.clone())
                .collect::<Vec<_>>();
            for path in &expired {
                deadlines.remove(path);
            }
            expired
        };
        for db_path in expired {
            if let Err(error) = release_audio_talkback(&db_path) {
                eprintln!(
                    "Control-surface talkback watchdog release failed: {}",
                    error.message()
                );
            }
        }
    }
}

fn release_audio_talkback(db_path: &Path) -> Result<(), ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    let Some(main) = audio_main_mix_target(&snapshot) else {
        return Ok(());
    };
    if !main.talkback {
        return Ok(());
    }
    let mut request = audio_mix_target_update_request(&main.id);
    request.talkback = Some(false);
    update_audio_mix_target(db_path, &request).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::initialize_database;
    use std::fs;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "studio-control-engine-deck-{label}-{}-{unique}",
                process::id()
            ));
            fs::create_dir_all(&path).expect("test dir should be created");
            Self { path }
        }

        fn db_path(&self) -> PathBuf {
            self.path.join("native.sqlite3")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn ready_audio_test_db(label: &str) -> TestDir {
        let test_dir = TestDir::new(label);
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        set_settings_owned(
            test_dir.db_path().as_path(),
            &[
                (
                    String::from("app.commissioning.check.audio.status"),
                    String::from("passed"),
                ),
                (
                    String::from("app.audio.send_host"),
                    String::from("127.0.0.1"),
                ),
                (
                    String::from("app.audio.metering_source"),
                    String::from(crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE),
                ),
            ],
        )
        .expect("ready audio settings should persist");
        test_dir
    }

    fn audio_snapshot_for(test_dir: &TestDir) -> AudioSnapshot {
        current_audio_snapshot(test_dir.db_path().as_path())
            .expect("audio snapshot should load")
            .1
    }

    #[test]
    fn audio_deck_bank_defaults_to_inputs_and_validates() {
        assert_eq!(audio_deck_bank(&HashMap::new()), "inputs");
        assert_eq!(
            audio_deck_bank(&HashMap::from([(
                String::from(AUDIO_DECK_BANK_KEY),
                String::from("playback"),
            )])),
            "playback"
        );
        assert_eq!(
            audio_deck_bank(&HashMap::from([(
                String::from(AUDIO_DECK_BANK_KEY),
                String::from("nonsense"),
            )])),
            "inputs"
        );
        assert_eq!(audio_deck_dial_mode(&HashMap::new()), "fader");
    }

    #[test]
    fn resolve_audio_deck_strip_maps_the_three_banks() {
        let snapshot = read_audio_snapshot(&HashMap::new());

        let inputs = (1..=4)
            .map(
                |strip| match resolve_audio_deck_strip(&snapshot, "inputs", strip) {
                    Ok(AudioDeckStrip::Channel(channel)) => channel.id,
                    other => panic!("input strip {strip} should resolve to a channel: {other:?}"),
                },
            )
            .collect::<Vec<_>>();
        assert_eq!(
            inputs,
            vec![
                "audio-input-9",
                "audio-input-10",
                "audio-input-11",
                "audio-input-12"
            ]
        );

        let playback = (1..=4)
            .map(
                |strip| match resolve_audio_deck_strip(&snapshot, "playback", strip) {
                    Ok(AudioDeckStrip::Channel(channel)) => channel.id,
                    other => {
                        panic!("playback strip {strip} should resolve to a channel: {other:?}")
                    }
                },
            )
            .collect::<Vec<_>>();
        assert_eq!(
            playback,
            vec![
                "audio-playback-1-2",
                "audio-playback-3-4",
                "audio-playback-5-6",
                "audio-playback-7-8"
            ]
        );

        let outputs = (1..=3)
            .map(
                |strip| match resolve_audio_deck_strip(&snapshot, "outputs", strip) {
                    Ok(AudioDeckStrip::MixTarget(target)) => target.id,
                    other => {
                        panic!("output strip {strip} should resolve to a mix target: {other:?}")
                    }
                },
            )
            .collect::<Vec<_>>();
        assert_eq!(
            outputs,
            vec!["audio-mix-main", "audio-mix-phones-a", "audio-mix-phones-b"]
        );
        assert!(matches!(
            resolve_audio_deck_strip(&snapshot, "outputs", 4),
            Err(ControlSurfaceError::Rejected(_))
        ));
    }

    #[test]
    fn audio_dial_turn_is_gated_until_probe_passes() {
        let test_dir = TestDir::new("gated");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

        let error = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect_err("dial turn should be gated");
        assert!(matches!(error, ControlSurfaceError::Rejected(_)));

        let snapshot = audio_snapshot_for(&test_dir);
        assert_eq!(snapshot.last_action_status, "failed");
        assert_eq!(
            snapshot.last_action_code.as_deref(),
            Some("AUDIO_NOT_VERIFIED")
        );
    }

    #[test]
    fn audio_dial_turn_moves_the_selected_send_level() {
        let test_dir = ready_audio_test_db("dial-turn");
        let before = audio_snapshot_for(&test_dir);
        let target_id = before.selected_mix_target_id.clone();
        let channel = before
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist")
            .clone();
        let current = channel
            .mix_levels
            .get(&target_id)
            .copied()
            .unwrap_or(channel.fader);

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("dial turn should succeed");
        assert_eq!(result["channelId"], "audio-input-9");
        assert_eq!(result["mixTargetId"], target_id.as_str());
        let reported = result["fader"].as_f64().expect("fader should be numeric");
        assert!((reported - (current + AUDIO_DECK_FADER_STEP)).abs() < 1e-9);

        let after = audio_snapshot_for(&test_dir);
        let updated = after
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist");
        let level = updated
            .mix_levels
            .get(&target_id)
            .copied()
            .expect("send level should be recorded for the selected mix target");
        assert!((level - (current + AUDIO_DECK_FADER_STEP)).abs() < 1e-9);
    }

    #[test]
    fn audio_dial_turn_acceleration_uses_fast_window() {
        let t0 = Instant::now();
        assert_eq!(audio_dial_turn_multiplier("accel-test|inputs|1", t0), 1.0);
        assert_eq!(
            audio_dial_turn_multiplier("accel-test|inputs|1", t0 + Duration::from_millis(10)),
            AUDIO_DECK_FAST_TURN_MULTIPLIER
        );
        assert_eq!(
            audio_dial_turn_multiplier("accel-test|inputs|1", t0 + Duration::from_millis(500)),
            1.0
        );
        assert_eq!(
            audio_dial_turn_multiplier("accel-test|inputs|2", t0 + Duration::from_millis(505)),
            1.0
        );
    }

    #[test]
    fn audio_dial_press_toggles_channel_mute_through_the_real_path() {
        let test_dir = ready_audio_test_db("dial-press");
        let before = audio_snapshot_for(&test_dir);
        let was_muted = before
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist")
            .mute;

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialPress", Some("1"))
            .expect("dial press should succeed");
        assert_eq!(result["mute"], !was_muted);

        let after = audio_snapshot_for(&test_dir);
        assert_eq!(
            after
                .channels
                .iter()
                .find(|entry| entry.id == "audio-input-9")
                .expect("host input should exist")
                .mute,
            !was_muted
        );

        let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load");
        assert!(
            !settings.contains_key("app.control_surface.audio.state"),
            "the legacy deck shadow state must stay deleted"
        );
    }

    #[test]
    fn audio_strip_tap_selects_the_channel_for_the_inspector() {
        let test_dir = ready_audio_test_db("strip-tap");
        let result = handle_audio_action(test_dir.db_path().as_path(), "stripTap", Some("2"))
            .expect("strip tap should succeed");
        assert_eq!(result["selectedChannelId"], "audio-input-10");

        let after = audio_snapshot_for(&test_dir);
        assert_eq!(after.selected_channel_id.as_deref(), Some("audio-input-10"));
    }

    #[test]
    fn audio_set_mix_target_shares_selection_and_retargets_dials() {
        let test_dir = ready_audio_test_db("mix-target");
        let result = handle_audio_action(
            test_dir.db_path().as_path(),
            "setMixTarget",
            Some("phones-a"),
        )
        .expect("set mix target should succeed");
        assert_eq!(result["selectedMixTargetId"], "audio-mix-phones-a");

        let after = audio_snapshot_for(&test_dir);
        assert_eq!(after.selected_mix_target_id, "audio-mix-phones-a");

        handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("dial turn should succeed");
        let final_snapshot = audio_snapshot_for(&test_dir);
        let channel = final_snapshot
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist");
        assert!(
            channel.mix_levels.contains_key("audio-mix-phones-a"),
            "the dial should now write the phones-a send"
        );
    }

    #[test]
    fn audio_cycle_bank_reaches_outputs_and_rides_output_volume() {
        let test_dir = ready_audio_test_db("bank-outputs");
        assert_eq!(
            handle_audio_action(test_dir.db_path().as_path(), "cycleBank", None)
                .expect("cycle should succeed")["bank"],
            "playback"
        );
        assert_eq!(
            handle_audio_action(test_dir.db_path().as_path(), "cycleBank", None)
                .expect("cycle should succeed")["bank"],
            "outputs"
        );

        let before = audio_snapshot_for(&test_dir);
        let main_volume = before
            .mix_targets
            .iter()
            .find(|entry| entry.id == "audio-mix-main")
            .expect("main mix should exist")
            .volume;

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("output dial turn should succeed");
        assert_eq!(result["mixTargetId"], "audio-mix-main");
        let reported = result["volume"].as_f64().expect("volume should be numeric");
        assert!((reported - (main_volume + AUDIO_DECK_FADER_STEP)).abs() < 1e-9);

        assert!(matches!(
            handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("4:up")),
            Err(ControlSurfaceError::Rejected(_))
        ));
    }

    #[test]
    fn audio_gain_mode_steps_one_whole_db_and_clamps() {
        let test_dir = ready_audio_test_db("gain-mode");
        assert_eq!(
            handle_audio_action(test_dir.db_path().as_path(), "toggleDialMode", None)
                .expect("mode toggle should succeed")["dialMode"],
            "gain"
        );

        let before = audio_snapshot_for(&test_dir);
        let gain = before
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist")
            .gain;

        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("gain turn should succeed");
        assert_eq!(result["gain"], gain + 1);

        let mut request = audio_channel_update_request("audio-input-9");
        request.gain = Some(AUDIO_PREAMP_GAIN_MAX);
        update_audio_channel(test_dir.db_path().as_path(), &request)
            .expect("gain should force to max");
        let result = handle_audio_action(test_dir.db_path().as_path(), "dialTurn", Some("1:up"))
            .expect("gain turn at max should clamp");
        assert_eq!(result["gain"], AUDIO_PREAMP_GAIN_MAX);
    }

    #[test]
    fn audio_talk_on_off_drives_main_talkback() {
        let test_dir = ready_audio_test_db("talkback");
        let result = handle_audio_action(test_dir.db_path().as_path(), "talkOn", None)
            .expect("talk on should succeed");
        assert_eq!(result["talkback"], true);
        assert!(
            audio_snapshot_for(&test_dir)
                .mix_targets
                .iter()
                .find(|entry| entry.id == "audio-mix-main")
                .expect("main mix should exist")
                .talkback
        );

        let result = handle_audio_action(test_dir.db_path().as_path(), "talkOff", None)
            .expect("talk off should succeed");
        assert_eq!(result["talkback"], false);
        assert!(
            !audio_snapshot_for(&test_dir)
                .mix_targets
                .iter()
                .find(|entry| entry.id == "audio-mix-main")
                .expect("main mix should exist")
                .talkback
        );
    }

    #[test]
    fn audio_talk_watchdog_release_clears_live_talkback() {
        let test_dir = ready_audio_test_db("talk-release");
        handle_audio_action(test_dir.db_path().as_path(), "talkOn", None)
            .expect("talk on should succeed");
        clear_audio_talk_deadline(test_dir.db_path().as_path());

        release_audio_talkback(test_dir.db_path().as_path())
            .expect("watchdog release should succeed");
        assert!(
            !audio_snapshot_for(&test_dir)
                .mix_targets
                .iter()
                .find(|entry| entry.id == "audio-mix-main")
                .expect("main mix should exist")
                .talkback
        );
    }

    #[test]
    fn audio_solo_clear_all_reports_cleared_count() {
        let test_dir = ready_audio_test_db("solo-clear");
        let mut request = audio_channel_update_request("audio-input-10");
        request.solo = Some(true);
        update_audio_channel(test_dir.db_path().as_path(), &request).expect("solo should engage");

        let result = handle_audio_action(test_dir.db_path().as_path(), "soloClearAll", None)
            .expect("solo clear should succeed");
        assert_eq!(result["cleared"], 1);
        assert!(audio_snapshot_for(&test_dir)
            .channels
            .iter()
            .all(|entry| !entry.solo));
    }

    #[test]
    fn audio_strip_state_and_level_keys_feed_the_deck_feedbacks() {
        let test_dir = ready_audio_test_db("state-level");
        let db_path = test_dir.db_path();
        let settings = || {
            crate::storage::list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX)
                .expect("settings should load")
        };
        let snapshot = |settings: &HashMap<String, String>| read_audio_snapshot(settings);

        let app_settings = settings();
        let live = snapshot(&app_settings);
        // Fresh ready db: Host is fader 0.78 -> bucket 9, and the engine's
        // selection fallback makes the first inventory channel (Host) selected.
        assert_eq!(audio_strip_level_text(&app_settings, &live, 1), "9");
        assert_eq!(audio_strip_state_text(&app_settings, &live, 1), "selected");
        assert_eq!(audio_strip_state_text(&app_settings, &live, 2), "normal");

        handle_audio_action(db_path.as_path(), "stripTap", Some("3")).expect("tap selects");
        handle_audio_action(db_path.as_path(), "dialPress", Some("2")).expect("mute strip 2");
        let app_settings = settings();
        let live = snapshot(&app_settings);
        assert_eq!(audio_strip_state_text(&app_settings, &live, 1), "normal");
        assert_eq!(audio_strip_state_text(&app_settings, &live, 3), "selected");
        assert_eq!(audio_strip_state_text(&app_settings, &live, 2), "muted");
        assert!(
            audio_strip_level_text(&app_settings, &live, 2).starts_with('m'),
            "muted strips carry the ember bar prefix"
        );

        handle_audio_action(db_path.as_path(), "toggleDialMode", None).expect("gain mode");
        let app_settings = settings();
        let live = snapshot(&app_settings);
        // Host preamp default 34 dB over 0-75 -> bucket 5.
        assert_eq!(audio_strip_level_text(&app_settings, &live, 1), "5");
        assert_eq!(
            audio_state_value_text(&app_settings, &live, "mode").expect("mode state"),
            "gain"
        );

        handle_audio_action(db_path.as_path(), "cycleBank", None).expect("to playback");
        handle_audio_action(db_path.as_path(), "cycleBank", None).expect("to outputs");
        let app_settings = settings();
        let live = snapshot(&app_settings);
        assert_eq!(
            audio_state_value_text(&app_settings, &live, "mode").expect("mode state"),
            "n/a"
        );
        assert_eq!(audio_strip_state_text(&app_settings, &live, 4), "empty");
        assert_eq!(audio_strip_level_text(&app_settings, &live, 4), "empty");
        assert_eq!(
            audio_state_value_text(&app_settings, &live, "target").expect("target state"),
            "main"
        );
        assert_eq!(
            audio_state_value_text(&app_settings, &live, "gated").expect("gated state"),
            "no"
        );
    }

    #[test]
    fn audio_state_keys_report_offline_when_gated() {
        let test_dir = TestDir::new("state-gated");
        initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
        let app_settings = crate::storage::list_settings_by_prefix(
            test_dir.db_path().as_path(),
            APP_SETTINGS_PREFIX,
        )
        .expect("settings should load");
        let live = read_audio_snapshot(&app_settings);

        assert_eq!(audio_strip_state_text(&app_settings, &live, 1), "offline");
        assert_eq!(audio_strip_level_text(&app_settings, &live, 1), "off");
        assert_eq!(
            audio_state_value_text(&app_settings, &live, "gated").expect("gated state"),
            "yes"
        );
    }

    #[test]
    fn audio_fader_db_label_mirrors_the_app_curve() {
        assert_eq!(audio_fader_db_label(0.0), "-\u{221e} dB");
        assert_eq!(audio_fader_db_label(0.35), "-35.0 dB");
        assert_eq!(audio_fader_db_label(0.7), "-10.0 dB");
        assert_eq!(audio_fader_db_label(0.75), "-5.0 dB");
        assert_eq!(audio_fader_db_label(0.8), "+0.0 dB");
        assert_eq!(audio_fader_db_label(0.9), "+3.0 dB");
        assert_eq!(audio_fader_db_label(1.0), "+6.0 dB");
    }
}
