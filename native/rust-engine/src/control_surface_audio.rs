use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::fader_curve::fader_lin_to_db;
use crate::audio::{
    clear_all_audio_solo, ensure_audio_action_allowed, read_audio_snapshot, update_audio_channel,
    update_audio_mix_target, update_audio_settings, AudioChannelUpdateRequest, AudioCommandError,
    AudioMixTargetUpdateRequest, AudioSettingsUpdateRequest, AudioSnapshot,
};
use crate::control_surface::{cycle_value, emit_audio_changed, truncate, ControlSurfaceError};
use crate::storage::{list_settings_by_prefix, set_settings_owned};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const AUDIO_DECK_BANK_KEY: &str = "app.control_surface.audio.bank";
/// The dials' mode, as the deck's displays and context report it: always
/// `fader` since GAIN left the deck (2026-10-03). The review of #293: a gain
/// mode an old profile's GAIN key saved (`app.control_surface.audio.dial_mode`)
/// is no longer read, as it no longer turns the dials, so it is not reported
/// either; the switch itself (`toggleDialMode`) is refused.
pub(crate) const AUDIO_DECK_DIAL_MODE: &str = "fader";
const AUDIO_DECK_BANK_CYCLE: &[&str] = &["inputs", "playback", "outputs"];
const AUDIO_DECK_FADER_STEP: f64 = 0.01;
const AUDIO_DECK_FAST_TURN_WINDOW: Duration = Duration::from_millis(80);
const AUDIO_DECK_FAST_TURN_MULTIPLIER: f64 = 5.0;
const AUDIO_ROLE_FRONT_PREAMP: &str = "front-preamp";
const AUDIO_ROLE_PLAYBACK_PAIR: &str = "playback-pair";
const AUDIO_MAIN_MIX_TARGET_ROLE: &str = "main-out";

#[derive(Debug)]
pub(crate) enum AudioDeckStrip {
    Channel(Box<crate::audio::AudioChannelSnapshot>),
    MixTarget(crate::audio::AudioMixTargetSnapshot),
}

static AUDIO_DIAL_TURN_TIMES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

/// Deck LCD dB label: RME's fader curve (`audio::fader_curve`), the same law
/// the on-screen fader prints (`audioFormatting.ts`), so the deck and the app
/// always show the same dB for the same position.
fn audio_fader_db_label(value: f64) -> String {
    let position = if value.is_finite() { value } else { 0.0 };
    let Some(db) = fader_lin_to_db(position) else {
        return String::from("\u{2212}\u{221e} dB");
    };
    // One decimal, and never "-0.0" at unity; the real minus, as the
    // Console prints it (the walk of 2026-10-07, finding 1).
    let rounded = (db * 10.0).round() / 10.0;
    let rounded = if rounded == 0.0 { 0.0 } else { rounded };
    format!("{rounded:+.1} dB").replacen('-', "\u{2212}", 1)
}

/// A strip's name on the deck: upper case, cut to what one line of the
/// cell holds. Cut to ten, `WINDOWS OUT` read `WINDOWS OU` on two lines on
/// the walk of 2026-10-07 (finding 2): eight now, with no space left at the
/// end, so a name stays on one line as DESIGN asks.
fn strip_name(name: &str) -> String {
    truncate(&name.to_uppercase(), 8).trim_end().to_string()
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

/// A strip cell of the AUDIO page: the strip's name in capitals, cut to 10
/// letters, over its level into the mix target, or `MUTED`; `AUDIO` over the
/// reason while the Console is locked; nothing for a strip the bank does not
/// have (the fourth on OUTPUTS). Since 2026-10-03 the deck's dials always
/// ride the level (GAIN left the deck), and the screen's selected strip is no
/// longer marked (the strip taps left with it).
pub(crate) fn audio_strip_lcd_text(
    app_settings: &HashMap<String, String>,
    snapshot: &AudioSnapshot,
    strip_index: usize,
) -> String {
    if let Some(gate) = audio_deck_gate_label(snapshot) {
        return format!("AUDIO\\n{gate}");
    }

    let bank = audio_deck_bank(app_settings);
    match resolve_audio_deck_strip(snapshot, &bank, strip_index) {
        Ok(AudioDeckStrip::Channel(channel)) => {
            let name = strip_name(&channel.name);
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
            format!("{name}\\n{level_line}")
        }
        Ok(AudioDeckStrip::MixTarget(target)) => {
            let level_line = if target.mute {
                String::from("MUTED")
            } else {
                audio_fader_db_label(target.volume)
            };
            format!("{}\\n{level_line}", strip_name(&target.name))
        }
        Err(_) => String::new(),
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
    let bucket_of = |value: f64| -> u32 { (value.clamp(0.0, 1.0) * 12.0).round() as u32 };
    match resolve_audio_deck_strip(snapshot, &bank, strip_index) {
        Ok(AudioDeckStrip::Channel(channel)) => {
            // The level into the mix target, whatever the saved dial mode:
            // the deck's dials ride nothing else (2026-10-03).
            let bucket = bucket_of(
                channel
                    .mix_levels
                    .get(&snapshot.selected_mix_target_id)
                    .copied()
                    .unwrap_or(channel.fader),
            );
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
            String::from(AUDIO_DECK_DIAL_MODE)
        } else {
            String::from("n/a")
        }),
        "dim" => Ok(audio_main_mix_target(snapshot)
            .map(|main| if main.dim { "on" } else { "off" })
            .unwrap_or("off")
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
            // The old profile's GAIN key: off, as the dials never ride the
            // gain (2026-10-03).
            if audio_deck_bank(app_settings) == "inputs" {
                String::from("GAIN\\nOFF")
            } else {
                String::from("GAIN\\nN/A")
            }
        }
        // Key 7 held TALK until 2026-09-28 (D26): its place on the deck is
        // empty, and the keys after it keep their numbers.
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

/// An AUDIO key or dial at the moment of the call: the tests' form. The
/// bridge calls `handle_audio_action_at` with the moment the request arrived.
#[cfg(test)]
pub(crate) fn handle_audio_action(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    handle_audio_action_at(db_path, action, value, Instant::now())
}

/// An AUDIO key or dial that arrived at `at`. A dial's turn counts its
/// acceleration from the arrival (Found, to check, 2026-09-28, from the
/// review of #254): a detent that waited behind the deck's poll was taken for
/// part of a fast turn.
pub(crate) fn handle_audio_action_at(
    db_path: &Path,
    action: &str,
    value: Option<&str>,
    at: Instant,
) -> Result<Value, ControlSurfaceError> {
    // New pages program, Slice 2: `switchToDeckMode` left with Planning (it
    // stored the Planning setting `planning.deck_mode`, which nothing read);
    // the page keys only turn Companion's page now. `recallSnapshot` left on
    // 2026-10-01: the Console's snapshots are TotalMix's, and one loads only
    // at a second press on screen, never at one press of a key.
    // `toggleDialMode`, the old profile's GAIN key, is refused since the
    // review of #293 (2026-10-03), as `talkOn` is: the dials ride the level
    // whatever it saved, so it switched nothing a deck could see.
    match action {
        "dialTurn" => handle_audio_dial_turn(db_path, value, at),
        "dialPress" => handle_audio_dial_press(db_path, value),
        "stripTap" => handle_audio_strip_tap(db_path, value),
        "setMixTarget" => handle_audio_set_mix_target(db_path, value),
        "cycleBank" => handle_audio_cycle_bank(db_path),
        "dimToggle" => handle_audio_dim_toggle(db_path),
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

/// Whether a detent that arrived at `at` is part of a fast turn: another of
/// the same dial arrived within `AUDIO_DECK_FAST_TURN_WINDOW` of it. The
/// bridge's four workers can handle two detents of one dial out of their
/// order, so the gap is taken either way round, and the time kept is the
/// later arrival.
fn audio_dial_turn_multiplier(turn_key: &str, at: Instant) -> f64 {
    let times = AUDIO_DIAL_TURN_TIMES.get_or_init(|| Mutex::new(HashMap::new()));
    let Ok(mut times) = times.lock() else {
        return 1.0;
    };
    let last = times.get(turn_key).copied();
    let fast = last.is_some_and(|last| {
        let gap = if at >= last { at - last } else { last - at };
        gap < AUDIO_DECK_FAST_TURN_WINDOW
    });
    times.insert(String::from(turn_key), last.map_or(at, |last| last.max(at)));
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
    at: Instant,
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

    // A turn always rides the level into the mix target (2026-10-03: GAIN
    // left the deck). A dial mode saved by the old profile's GAIN key no
    // longer turns the dials into preamp gain, where nothing on the deck
    // would show it.
    match resolve_audio_deck_strip(&snapshot, &bank, strip_index)? {
        AudioDeckStrip::Channel(channel) => {
            let multiplier =
                audio_dial_turn_multiplier(&audio_dial_turn_key(db_path, &bank, strip_index), at);
            let mix_target_id = snapshot.selected_mix_target_id.clone();
            let current = channel
                .mix_levels
                .get(&mix_target_id)
                .copied()
                .unwrap_or(channel.fader);
            let next =
                (current + step_sign as f64 * AUDIO_DECK_FADER_STEP * multiplier).clamp(0.0, 1.0);
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
        AudioDeckStrip::MixTarget(target) => {
            let multiplier =
                audio_dial_turn_multiplier(&audio_dial_turn_key(db_path, &bank, strip_index), at);
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

/// The mix target the dials send into. `main`, `phones-a` and `phones-b`
/// name one; `phones` (2026-10-03, the deck's PHONES key) is the next phones
/// mix: Phones 1 from Main Out, Phones 2 from Phones 1, and Phones 1 again
/// from Phones 2. Either way the saved mix target is written, as the screen
/// writes it, and nothing goes to TotalMix.
fn handle_audio_set_mix_target(
    db_path: &Path,
    value: Option<&str>,
) -> Result<Value, ControlSurfaceError> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ControlSurfaceError::InvalidParams(String::from(
                "setMixTarget requires a value of main, phones, phones-a, or phones-b",
            ))
        })?;
    let value = if value == "phones" {
        let (app_settings, snapshot) = current_audio_snapshot(db_path)?;
        match audio_state_value_text(&app_settings, &snapshot, "target")?.as_str() {
            "phones-a" => "phones-b",
            _ => "phones-a",
        }
    } else {
        value
    };
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
    // The name the screen's row gives the output, so Recent actions names the
    // main output one way, from the deck as from the screen (2026-09-28).
    Ok(json!({ "mixTargetId": updated.id, "name": updated.name, "dim": updated.dim }))
}

fn handle_audio_solo_clear_all(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let (_, snapshot) = current_audio_snapshot(db_path)?;
    ensure_audio_action_allowed(db_path, &snapshot).map_err(map_audio_error)?;
    let soloed = snapshot.channels.iter().filter(|entry| entry.solo).count();
    clear_all_audio_solo(db_path).map_err(map_audio_error)?;
    emit_audio_changed();
    Ok(json!({ "cleared": soloed }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::initialize_test_database;
    use std::fs;
    use std::path::PathBuf;
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
        initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
        initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");

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

    // Found, to check (2026-09-28, from the review of #254): the acceleration
    // read when a detent was handled. Two detents that arrived half a second
    // apart, handled back to back (the second waited behind the deck's poll),
    // are two slow steps; two that arrived 10 ms apart are a fast turn.
    #[test]
    fn a_dial_turn_counts_its_acceleration_from_its_arrival() {
        let test_dir = ready_audio_test_db("dial-arrival");
        let db_path = test_dir.db_path();
        let level = || {
            let snapshot = audio_snapshot_for(&test_dir);
            let target_id = snapshot.selected_mix_target_id.clone();
            let channel = snapshot
                .channels
                .iter()
                .find(|entry| entry.id == "audio-input-9")
                .expect("host input should exist")
                .clone();
            channel
                .mix_levels
                .get(&target_id)
                .copied()
                .unwrap_or(channel.fader)
        };
        let t0 = Instant::now();
        let start = level();

        for at in [t0, t0 + Duration::from_millis(500)] {
            handle_audio_action_at(db_path.as_path(), "dialTurn", Some("1:down"), at)
                .expect("dial turn should succeed");
        }
        assert!(
            (level() - (start - 2.0 * AUDIO_DECK_FADER_STEP)).abs() < 1e-9,
            "two slow steps, however quickly they were handled"
        );

        handle_audio_action_at(
            db_path.as_path(),
            "dialTurn",
            Some("1:down"),
            t0 + Duration::from_millis(510),
        )
        .expect("dial turn should succeed");
        assert!(
            (level() - (start - (2.0 + AUDIO_DECK_FAST_TURN_MULTIPLIER) * AUDIO_DECK_FADER_STEP))
                .abs()
                < 1e-9,
            "a detent 10 ms after the last is a fast turn"
        );
    }

    // Two detents of one dial handled out of their order are still two
    // within the window, and the later arrival is kept.
    #[test]
    fn a_detent_handled_after_a_later_one_is_still_a_fast_turn() {
        let t0 = Instant::now();
        let key = "accel-order-test|inputs|1";
        assert_eq!(
            audio_dial_turn_multiplier(key, t0 + Duration::from_millis(50)),
            1.0
        );
        assert_eq!(
            audio_dial_turn_multiplier(key, t0),
            AUDIO_DECK_FAST_TURN_MULTIPLIER
        );
        assert_eq!(
            audio_dial_turn_multiplier(key, t0 + Duration::from_millis(120)),
            AUDIO_DECK_FAST_TURN_MULTIPLIER,
            "70 ms after the later arrival, not 120 ms after the earlier"
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

    /// The setting the old profile's GAIN key saved, as an old build left it.
    fn save_the_old_gain_mode(db_path: &Path) {
        set_settings_owned(
            db_path,
            &[(
                String::from("app.control_surface.audio.dial_mode"),
                String::from("gain"),
            )],
        )
        .expect("the old gain mode is saved");
    }

    // 2026-10-03: GAIN left the deck. A dial mode the old profile's GAIN key
    // saved no longer turns the dials into preamp gain, where nothing on the
    // deck would show it: a turn rides the level, the strip shows the level.
    // The review of #293: the mode reads `fader`, and the key's switch is
    // refused (501) and saves nothing.
    #[test]
    fn a_saved_gain_mode_no_longer_turns_the_dials_into_gain() {
        let test_dir = ready_audio_test_db("gain-mode-gone");
        let db_path = test_dir.db_path();
        save_the_old_gain_mode(db_path.as_path());
        let settings_before =
            list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX).expect("settings");
        let refused = handle_audio_action(db_path.as_path(), "toggleDialMode", None)
            .expect_err("the GAIN key left the deck");
        assert!(
            matches!(refused, ControlSurfaceError::Unsupported(_)),
            "{refused:?}"
        );
        assert_eq!(refused.status_code(), 501);
        assert_eq!(
            list_settings_by_prefix(db_path.as_path(), APP_SETTINGS_PREFIX).expect("settings"),
            settings_before,
            "a refused GAIN key writes nothing"
        );
        let (app_settings, snapshot) =
            current_audio_snapshot(db_path.as_path()).expect("the snapshot");
        assert_eq!(
            audio_state_value_text(&app_settings, &snapshot, "mode").expect("mode state"),
            "fader"
        );
        assert_eq!(
            audio_key_lcd_text(&app_settings, &snapshot, 6),
            "GAIN\\nOFF"
        );

        let before = audio_snapshot_for(&test_dir);
        let host = before
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist")
            .clone();

        let result = handle_audio_action(db_path.as_path(), "dialTurn", Some("1:up"))
            .expect("the turn rides the level");
        assert!(result.get("gain").is_none(), "{result}");
        assert!(result["fader"].is_number(), "{result}");
        let after = audio_snapshot_for(&test_dir);
        let host_after = after
            .channels
            .iter()
            .find(|entry| entry.id == "audio-input-9")
            .expect("host input should exist");
        assert_eq!(host_after.gain, host.gain, "the preamp gain is untouched");

        let (app_settings, snapshot) =
            current_audio_snapshot(db_path.as_path()).expect("the snapshot");
        let strip = audio_strip_lcd_text(&app_settings, &snapshot, 1);
        assert!(strip.ends_with(" dB") && !strip.contains("GAIN"), "{strip}");
    }

    // 2026-10-03: the deck's PHONES key. Main Out goes to Phones 1, Phones 1
    // to Phones 2, Phones 2 back to Phones 1; the saved mix target is
    // written as MAIN OUT writes it.
    #[test]
    fn the_phones_key_goes_round_the_phones_mixes() {
        let test_dir = ready_audio_test_db("phones-key");
        let db_path = test_dir.db_path();
        let target = |db_path: &Path| {
            let (app_settings, snapshot) = current_audio_snapshot(db_path).expect("the snapshot");
            audio_state_value_text(&app_settings, &snapshot, "target").expect("the target")
        };
        assert_eq!(target(db_path.as_path()), "main");
        for expected in ["phones-a", "phones-b", "phones-a", "phones-b"] {
            let answer = handle_audio_action(db_path.as_path(), "setMixTarget", Some("phones"))
                .expect("the phones key");
            assert_eq!(
                answer["selectedMixTargetId"],
                format!("audio-mix-{expected}")
            );
            assert_eq!(target(db_path.as_path()), expected);
        }
        handle_audio_action(db_path.as_path(), "setMixTarget", Some("main")).expect("MAIN OUT");
        assert_eq!(target(db_path.as_path()), "main");
        handle_audio_action(db_path.as_path(), "setMixTarget", Some("phones"))
            .expect("the phones key");
        assert_eq!(target(db_path.as_path()), "phones-a");
    }

    // D26 (2026-09-28): talkback is gone. The deck's old profile still has
    // the key, and its presses are refused like any action there is not.
    #[test]
    fn the_deck_has_no_talk_key() {
        let test_dir = ready_audio_test_db("no-talk");
        for action in ["talkOn", "talkOff"] {
            let error = handle_audio_action(test_dir.db_path().as_path(), action, None)
                .expect_err("talkback is not an action");
            assert!(
                matches!(error, ControlSurfaceError::Unsupported(_)),
                "{action}: {error:?}"
            );
        }
        let (app_settings, snapshot) =
            current_audio_snapshot(test_dir.db_path().as_path()).expect("the snapshot");
        assert!(audio_state_value_text(&app_settings, &snapshot, "talk").is_err());
        assert_eq!(audio_key_lcd_text(&app_settings, &snapshot, 7), "--");
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

        save_the_old_gain_mode(db_path.as_path());
        let app_settings = settings();
        let live = snapshot(&app_settings);
        // GAIN left the deck (2026-10-03): the bar is the level, whatever the
        // saved mode (fader 0.78 -> bucket 9, not the preamp's 34 dB), and the
        // mode reads `fader` (the review of #293).
        assert_eq!(audio_strip_level_text(&app_settings, &live, 1), "9");
        assert_eq!(
            audio_state_value_text(&app_settings, &live, "mode").expect("mode state"),
            "fader"
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
        initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    // Same anchors as the frontend (engine-client faderCurve.test.ts and
    // audioFormatting.test.ts): RME published fader curve, unity at 836/1023.
    fn audio_fader_db_label_prints_the_rme_fader_curve() {
        assert_eq!(audio_fader_db_label(0.0), "\u{2212}\u{221e} dB");
        assert_eq!(audio_fader_db_label(f64::NAN), audio_fader_db_label(0.0));
        assert_eq!(audio_fader_db_label(0.35), "\u{2212}23.0 dB");
        assert_eq!(audio_fader_db_label(0.5), "\u{2212}12.1 dB");
        assert_eq!(audio_fader_db_label(649.0 / 1023.0), "\u{2212}6.0 dB");
        assert_eq!(audio_fader_db_label(0.7), "\u{2212}3.8 dB");
        assert_eq!(audio_fader_db_label(0.75), "\u{2212}2.2 dB");
        assert_eq!(audio_fader_db_label(0.8), "\u{2212}0.6 dB");
        // The walk of 2026-10-07, finding 2: a name stays on one line.
        assert_eq!(strip_name("Windows Out"), "WINDOWS");
        assert_eq!(strip_name("SM7B 1"), "SM7B 1");
        assert_eq!(strip_name("Backlight Left"), "BACKLIGH");
        assert_eq!(
            audio_fader_db_label(crate::audio::fader_curve::AUDIO_FADER_UNITY),
            "+0.0 dB"
        );
        assert_eq!(audio_fader_db_label(0.9), "+2.7 dB");
        assert_eq!(audio_fader_db_label(1.0), "+6.0 dB");
    }
}
