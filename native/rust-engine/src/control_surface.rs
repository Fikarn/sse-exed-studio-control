use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::read_audio_snapshot;
use crate::bootstrap::RuntimeContext;
#[cfg(test)]
use crate::control_surface_audio::handle_audio_action;
use crate::control_surface_audio::{
    audio_deck_bank, audio_deck_dial_mode, audio_deck_gate_label, audio_key_lcd_text,
    audio_state_value_text, audio_strip_key_index, audio_strip_lcd_text, audio_strip_level_text,
    audio_strip_state_text, current_audio_snapshot, handle_audio_action_at,
    resolve_audio_deck_strip, AudioDeckStrip,
};
use crate::control_surface_presses::{
    ask, asked_key_acted, asking_key_text, dwelling_press, end_arm, release_dwelling_press,
    take_dwelling_press, Ask, AskTarget, AskingKey,
};
use crate::lighting::{
    create_lighting_scene_with_preview, delete_lighting_scene, load_lighting_editor_state,
    lock_shared_lighting_preview, parse_lighting_all_power_request,
    parse_lighting_fixture_update_request, parse_lighting_scene_create_request,
    parse_lighting_scene_delete_request, parse_lighting_scene_recall_request,
    read_lighting_fixture_levels, read_lighting_recall_fade_ms, recall_lighting_scene_with_preview,
    scene_state_in, set_lighting_all_power_with_preview, update_lighting_fixture_with_preview,
    with_lighting_state_and_preview, LightingCommandError, LightingEditorState,
    LightingFixtureLevels, LightingPreviewRuntimeState,
};
use crate::shell_settings::{DEFAULT_WORKSPACE, SHELL_SETTINGS_PREFIX, WORKSPACE_KEY};
use crate::storage::{
    list_settings_by_prefix, open_connection, set_settings_owned, set_settings_owned_and,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

pub const DEFAULT_CONTROL_SURFACE_HOST: &str = "127.0.0.1";
pub const DEFAULT_CONTROL_SURFACE_PORT: u16 = 38201;

const SELECTED_LIGHT_ID_KEY: &str = "app.control_surface.selected_light_id";
const SELECTED_SCENE_ID_KEY: &str = "app.control_surface.selected_scene_id";
const LAST_EVENT_KEY: &str = "app.control_surface.last_event";

#[derive(Debug, Clone, Serialize)]
pub struct ControlSurfaceBridgeInfo {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub port: u16,
    pub available: bool,
    pub status: String,
    pub summary: String,
    pub error: Option<String>,
}

#[derive(Debug)]
pub enum ControlSurfaceError {
    InvalidParams(String),
    Unsupported(String),
    Rejected(String),
    Storage(String),
    /// Missing or wrong bearer token (401) — `control_surface_http`.
    Unauthorized(String),
    /// A browser origin presented itself (403).
    Forbidden(String),
    /// The request did not arrive within the deadline (408).
    Timeout(String),
    /// A body without a usable `Content-Length` (411).
    LengthRequired(String),
    /// The declared body exceeds the cap (413).
    TooLarge(String),
    /// The headers exceed the cap (431).
    HeadersTooLarge(String),
    /// The worker queue is full (503).
    Busy(String),
}

impl ControlSurfaceError {
    pub(crate) fn status_code(&self) -> u16 {
        match self {
            Self::InvalidParams(_) => 400,
            Self::Unauthorized(_) => 401,
            Self::Forbidden(_) => 403,
            Self::Timeout(_) => 408,
            Self::Rejected(_) => 409,
            Self::LengthRequired(_) => 411,
            Self::TooLarge(_) => 413,
            Self::HeadersTooLarge(_) => 431,
            Self::Storage(_) => 500,
            Self::Unsupported(_) => 501,
            Self::Busy(_) => 503,
        }
    }

    pub(crate) fn message(&self) -> &str {
        match self {
            Self::InvalidParams(message)
            | Self::Unsupported(message)
            | Self::Rejected(message)
            | Self::Storage(message)
            | Self::Unauthorized(message)
            | Self::Forbidden(message)
            | Self::Timeout(message)
            | Self::LengthRequired(message)
            | Self::TooLarge(message)
            | Self::HeadersTooLarge(message)
            | Self::Busy(message) => message,
        }
    }
}

pub fn resolve_control_surface_port() -> u16 {
    std::env::var("SSE_CONTROL_SURFACE_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_CONTROL_SURFACE_PORT)
}

/// The bridge shares the engine-wide out-of-band event sender
/// (`engine_events`) with the console link; kept under its historical name
/// for the startup wiring in `main.rs`.
pub fn register_control_surface_event_sender(sender: Sender<Value>) {
    crate::engine_events::register_engine_event_sender(sender);
}

pub(crate) fn emit_audio_changed() {
    crate::engine_events::emit_audio_changed("control-surface");
}

// The listener, the bearer token, the request limits and the worker pool live
// in `control_surface_http`; this module owns what a request does.

pub fn read_control_surface_context(db_path: &Path) -> Result<Value, ControlSurfaceError> {
    let (app_settings, audio_snapshot) = current_audio_snapshot(db_path)?;
    let bank = audio_deck_bank(&app_settings);
    let strips = (1..=4)
        .map(
            |strip_index| match resolve_audio_deck_strip(&audio_snapshot, &bank, strip_index) {
                Ok(AudioDeckStrip::Channel(channel)) => json!({
                    "position": strip_index,
                    "kind": "channel",
                    "id": channel.id,
                    "name": channel.name,
                }),
                Ok(AudioDeckStrip::MixTarget(target)) => json!({
                    "position": strip_index,
                    "kind": "mixTarget",
                    "id": target.id,
                    "name": target.name,
                }),
                Err(_) => json!({
                    "position": strip_index,
                    "kind": "empty",
                    "id": Value::Null,
                    "name": Value::Null,
                }),
            },
        )
        .collect::<Vec<_>>();

    Ok(json!({
        "workspace": read_active_workspace(db_path)?,
        "audio": {
            "status": audio_snapshot.status,
            "gated": audio_deck_gate_label(&audio_snapshot).is_some(),
            "bank": bank,
            "dialMode": audio_deck_dial_mode(&app_settings),
            "selectedMixTargetId": audio_snapshot.selected_mix_target_id,
            "selectedChannelId": audio_snapshot.selected_channel_id,
            "strips": strips,
        },
    }))
}

/// What a display of the deck says, whatever its page. `cameras_simulated`
/// is `SSE_CAMERAS_SIMULATED`, read at the start: when the deck asks before
/// the screen does, the bridge is the cameras' first caller, and the cameras
/// it loads must be the ones the screen will get.
pub fn read_deck_lcd_text(
    db_path: &Path,
    cameras_simulated: bool,
    key: &str,
) -> Result<String, ControlSurfaceError> {
    read_deck_lcd_text_at(db_path, cameras_simulated, key, Instant::now())
}

/// `read_deck_lcd_text` at a moment of the caller's.
fn read_deck_lcd_text_at(
    db_path: &Path,
    cameras_simulated: bool,
    key: &str,
    at: Instant,
) -> Result<String, ControlSurfaceError> {
    // The PROMPTER and CAMERAS displays first: they need nothing of the
    // Console or the rig, and are read once for a whole poll.
    match crate::control_surface_pages::page_lcd_text(db_path, cameras_simulated, key, at) {
        Some(text) => text,
        None => lights_and_audio_lcd_text(&LightsAndAudio::read(db_path)?, db_path, key, at),
    }
}

/// The tests' short form: the simulated cameras, which every test has (D15).
#[cfg(test)]
pub fn read_control_surface_lcd_text(
    db_path: &Path,
    key: &str,
) -> Result<String, ControlSurfaceError> {
    read_deck_lcd_text(db_path, true, key)
}

/// The tests' short form at a moment of the test's.
#[cfg(test)]
pub fn read_control_surface_lcd_text_at(
    db_path: &Path,
    key: &str,
    at: Instant,
) -> Result<String, ControlSurfaceError> {
    read_deck_lcd_text_at(db_path, true, key, at)
}

/// How a display reaches the deck in `GET /api/deck/displays`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DisplayShape {
    /// One word, whole: a state word the deck's colours follow, or a value
    /// with no line above it.
    Word,
    /// A line above a value (`INTENSITY` over `76 %`): the deck draws the
    /// line from its label image where it is a fixed word, and the value in
    /// its own type.
    Lines,
}

/// Every display the deck's profile shows (2026-10-03), in one answer a
/// second: 6 of the LIGHTS page, 14 of the AUDIO page (with the page the
/// app is on, which every page's follow reads), 12 of the CAMERAS page and
/// 7 of the PROMPTER page. The deck reads nothing else; the displays that
/// left the profile (Del Scene's, the AUDIO page's strip states, its key
/// texts and dial mode, the script's name) are still answered one by one at
/// `GET /api/deck/lcd`, until a later cleanup.
pub(crate) const DECK_DISPLAYS: [(&str, DisplayShape); 39] = [
    ("light_nav", DisplayShape::Lines),
    ("light_intensity", DisplayShape::Lines),
    ("light_cct", DisplayShape::Lines),
    ("scene_nav", DisplayShape::Lines),
    ("light_key_off", DisplayShape::Word),
    ("scene_state", DisplayShape::Word),
    ("audio_strip_1", DisplayShape::Lines),
    ("audio_strip_2", DisplayShape::Lines),
    ("audio_strip_3", DisplayShape::Lines),
    ("audio_strip_4", DisplayShape::Lines),
    ("audio_strip_1_level", DisplayShape::Word),
    ("audio_strip_2_level", DisplayShape::Word),
    ("audio_strip_3_level", DisplayShape::Word),
    ("audio_strip_4_level", DisplayShape::Word),
    ("audio_state_target", DisplayShape::Word),
    ("audio_state_bank", DisplayShape::Word),
    ("audio_state_dim", DisplayShape::Word),
    ("audio_state_solo", DisplayShape::Word),
    ("audio_state_gated", DisplayShape::Word),
    ("workspace", DisplayShape::Word),
    ("camera_key_1", DisplayShape::Lines),
    ("camera_key_2", DisplayShape::Lines),
    ("camera_key_3", DisplayShape::Lines),
    ("camera_key_bank", DisplayShape::Lines),
    ("camera_key_rec", DisplayShape::Lines),
    ("camera_strip_1", DisplayShape::Lines),
    ("camera_strip_2", DisplayShape::Lines),
    ("camera_strip_3", DisplayShape::Lines),
    ("camera_strip_4", DisplayShape::Lines),
    ("camera_state_selected", DisplayShape::Word),
    ("camera_state_rec", DisplayShape::Word),
    ("camera_state_dials", DisplayShape::Word),
    ("prompter_speed", DisplayShape::Lines),
    ("prompter_line", DisplayShape::Lines),
    ("prompter_place", DisplayShape::Lines),
    ("prompter_size", DisplayShape::Lines),
    ("prompter_left", DisplayShape::Word),
    ("prompter_state_play", DisplayShape::Word),
    ("prompter_state_on", DisplayShape::Word),
];

/// What marks an answer of `GET /api/deck/displays` as the bridge's: an
/// error's body never carries it, so the deck keeps what it showed rather
/// than show the error (`exports`).
pub(crate) const DECK_DISPLAYS_MARK: &str = "deck";

/// Every display of `DECK_DISPLAYS` at `at`, in one answer
/// (`GET /api/deck/displays`, 2026-10-03): `sse` is the mark, `at` the
/// moment of the read in milliseconds since 1970 (the deck keeps the newer of
/// two answers that cross), `words` the displays that are one word and
/// `lines` the others as `head` over `value`. The pages are read as their
/// displays are one by one: the PROMPTER page's from the frame the prompter
/// published, the CAMERAS page's from the texts kept for a poll, the LIGHTS
/// and AUDIO pages' from one read of the saved data. A page that cannot be
/// read refuses the whole answer, and the deck keeps what it showed.
pub fn read_deck_displays(
    db_path: &Path,
    cameras_simulated: bool,
    at: Instant,
) -> Result<Value, ControlSurfaceError> {
    let mut texts: HashMap<&str, String> =
        crate::control_surface_pages::page_texts(db_path, cameras_simulated, at)?
            .into_iter()
            .collect();
    let lights_and_audio = LightsAndAudio::read(db_path)?;
    for (key, _) in DECK_DISPLAYS {
        if !texts.contains_key(key) {
            texts.insert(
                key,
                lights_and_audio_lcd_text(&lights_and_audio, db_path, key, at)?,
            );
        }
    }
    let mut words = serde_json::Map::new();
    let mut lines = serde_json::Map::new();
    for (key, shape) in DECK_DISPLAYS {
        let text = texts.remove(key).unwrap_or_default();
        match shape {
            DisplayShape::Word => {
                words.insert(String::from(key), Value::String(text));
            }
            DisplayShape::Lines => {
                let (head, value) = text.split_once("\\n").unwrap_or((text.as_str(), ""));
                lines.insert(String::from(key), json!({ "head": head, "value": value }));
            }
        }
    }
    let at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or(0);
    Ok(json!({
        "sse": DECK_DISPLAYS_MARK,
        "at": at_ms,
        "words": words,
        "lines": lines,
    }))
}

/// What the LIGHTS and AUDIO pages' displays are made of: one read of the
/// saved data, and the lighting preview as it was then. The read is a
/// reader's: it takes the shared preview alone and reads the settings under
/// it — a preview-aware change holds the preview from its first read to its
/// last write, so the pair read here is from one side of it, never the stored
/// value of one moment beside the preview of another.
struct LightsAndAudio {
    app_settings: HashMap<String, String>,
    audio_snapshot: crate::audio::AudioSnapshot,
    /// The rig as stored, a running fade not sampled.
    lighting_state: LightingEditorState,
    preview: LightingPreviewRuntimeState,
    /// The chosen light's levels as the operator means them: the preview's
    /// while previewing, else the stored ones with a running fade sampled.
    chosen_levels: Option<LightingFixtureLevels>,
}

impl LightsAndAudio {
    fn read(db_path: &Path) -> Result<Self, ControlSurfaceError> {
        let shared_preview = lock_shared_lighting_preview();
        let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
        let preview = shared_preview.clone();
        drop(shared_preview);
        let mut displays = Self {
            audio_snapshot: read_audio_snapshot(&app_settings),
            lighting_state: load_lighting_editor_state(&app_settings),
            app_settings,
            preview,
            chosen_levels: None,
        };
        let chosen_levels = displays.chosen_light().and_then(|(_, fixture)| {
            read_lighting_fixture_levels(&displays.app_settings, &displays.preview, &fixture.id)
        });
        displays.chosen_levels = chosen_levels;
        Ok(displays)
    }

    /// The light the deck has chosen, and its place among the rig's.
    fn chosen_light(&self) -> Option<(usize, &crate::lighting::LightingEditorFixtureState)> {
        let fixtures = &self.lighting_state.fixtures;
        let id = resolve_selected_inventory_id(
            &self.app_settings,
            SELECTED_LIGHT_ID_KEY,
            fixtures.iter().map(|fixture| fixture.id.as_str()),
        )?;
        fixtures
            .iter()
            .enumerate()
            .find(|(_, fixture)| fixture.id == id)
    }

    /// The scene the deck has chosen, and its place among the rig's.
    fn chosen_scene(&self) -> Option<(usize, &crate::lighting::LightingEditorSceneState)> {
        let scenes = &self.lighting_state.scenes;
        let id = resolve_selected_inventory_id(
            &self.app_settings,
            SELECTED_SCENE_ID_KEY,
            scenes.iter().map(|scene| scene.id.as_str()),
        )?;
        scenes.iter().enumerate().find(|(_, scene)| scene.id == id)
    }
}

/// A name as the deck's strip prints it: capitals, cut to 10 letters.
fn deck_name(name: &str) -> String {
    truncate(&name.to_uppercase(), 10)
}

fn lights_and_audio_lcd_text(
    displays: &LightsAndAudio,
    db_path: &Path,
    key: &str,
    at: Instant,
) -> Result<String, ControlSurfaceError> {
    let app_settings = &displays.app_settings;
    let audio_snapshot = &displays.audio_snapshot;
    match key {
        // The two keys that ask first read the hardware link's memory, not
        // the saved data: `OFF?` or `DEL?` while armed (2026-09-28).
        "light_key_off" => Ok(asking_key_text(db_path, AskingKey::AllOff, at)),
        "light_key_del" => Ok(asking_key_text(db_path, AskingKey::DeleteScene, at)),
        // Two lines a cell (2026-10-03): the dial's name over its value,
        // names in capitals cut to 10 letters, `--` for none. Preview shows
        // in the deck's colours, from `scene_state`, not as a third line.
        "light_nav" => Ok(match displays.chosen_light() {
            Some((index, fixture)) => format!(
                "LIGHT {}/{}\\n{}",
                index + 1,
                displays.lighting_state.fixtures.len(),
                deck_name(&fixture.name)
            ),
            None => String::from("LIGHT\\n--"),
        }),
        "light_intensity" => Ok(match displays.chosen_levels {
            Some(levels) if !levels.on => String::from("INTENSITY\\nOFF"),
            Some(levels) => format!("INTENSITY\\n{} %", levels.intensity),
            None => String::from("INTENSITY\\n--"),
        }),
        "light_cct" => Ok(match displays.chosen_levels {
            Some(levels) => format!("CCT\\n{} K", levels.cct),
            None => String::from("CCT\\n--"),
        }),
        "scene_nav" => Ok(match displays.chosen_scene() {
            Some((index, scene)) => format!(
                "SCENE {}/{}\\n{}",
                index + 1,
                displays.lighting_state.scenes.len(),
                deck_name(&scene.name)
            ),
            None => String::from("SCENE\\n--"),
        }),
        // Whether the deck's chosen scene is on the rig, decided as the
        // screen's is (`lighting::scene_state`).
        "scene_state" => Ok(String::from(scene_state_in(
            app_settings,
            &displays.lighting_state,
            displays.chosen_scene().map(|(_, scene)| scene.id.as_str()),
            displays.preview.enabled,
        ))),
        "audio_strip_1" | "audio_strip_2" | "audio_strip_3" | "audio_strip_4" => Ok(
            audio_strip_lcd_text(app_settings, audio_snapshot, audio_strip_key_index(key)),
        ),
        "audio_key_1" | "audio_key_2" | "audio_key_3" | "audio_key_4" | "audio_key_5"
        | "audio_key_6" | "audio_key_8" => {
            let key_index = key
                .rsplit('_')
                .next()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(1);
            Ok(audio_key_lcd_text(app_settings, audio_snapshot, key_index))
        }
        "audio_strip_1_state"
        | "audio_strip_2_state"
        | "audio_strip_3_state"
        | "audio_strip_4_state" => Ok(audio_strip_state_text(
            app_settings,
            audio_snapshot,
            audio_strip_key_index(key),
        )),
        "audio_strip_1_level"
        | "audio_strip_2_level"
        | "audio_strip_3_level"
        | "audio_strip_4_level" => Ok(audio_strip_level_text(
            app_settings,
            audio_snapshot,
            audio_strip_key_index(key),
        )),
        "audio_state_target" | "audio_state_bank" | "audio_state_mode" | "audio_state_dim"
        | "audio_state_solo" | "audio_state_gated" => audio_state_value_text(
            app_settings,
            audio_snapshot,
            key.trim_start_matches("audio_state_"),
        ),
        "workspace" => read_active_workspace(db_path),
        _ => Err(ControlSurfaceError::InvalidParams(format!(
            "Unsupported LCD key: {key}"
        ))),
    }
}

fn read_active_workspace(db_path: &Path) -> Result<String, ControlSurfaceError> {
    let shell_settings = list_settings_by_prefix(db_path, SHELL_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    Ok(shell_settings
        .get(WORKSPACE_KEY)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| String::from(DEFAULT_WORKSPACE)))
}

// Mirrors the operator app's fader curve (normalizedToFaderDb in
// frontend/app/src/app/audio/audioFormatting.ts) — the deck and the screen
// must always print the same dB number for the same wire value.
/// The tests' short form: the simulated cameras, which every test has (D15).
#[cfg(test)]
pub fn handle_control_surface_http_action(
    db_path: &Path,
    path: &str,
    body: &Value,
) -> Result<Value, ControlSurfaceError> {
    handle_deck_http_action(db_path, true, path, body)
}

/// The tests' short form at a moment of the test's.
#[cfg(test)]
pub fn handle_control_surface_http_action_at(
    db_path: &Path,
    path: &str,
    body: &Value,
    at: Instant,
) -> Result<Value, ControlSurfaceError> {
    handle_deck_http_action_at(db_path, true, path, body, at)
}

/// A key or a dial of the deck, whatever its page. `cameras_simulated` is
/// `SSE_CAMERAS_SIMULATED`, read at the start (`read_deck_lcd_text`). The
/// bridge calls `handle_deck_http_action_at` with the moment the request
/// arrived; this form, at the moment of the call, is the tests'.
#[cfg(test)]
pub fn handle_deck_http_action(
    db_path: &Path,
    cameras_simulated: bool,
    path: &str,
    body: &Value,
) -> Result<Value, ControlSurfaceError> {
    handle_deck_http_action_at(db_path, cameras_simulated, path, body, Instant::now())
}

/// `handle_deck_http_action` at a moment of the caller's: the CAMERAS page's
/// `REC` counts from it, and the two new pages keep their texts from it. The
/// bridge gives the moment the request arrived.
pub(crate) fn handle_deck_http_action_at(
    db_path: &Path,
    cameras_simulated: bool,
    path: &str,
    body: &Value,
    at: Instant,
) -> Result<Value, ControlSurfaceError> {
    let (response, events) = deck_key_stamped(db_path, cameras_simulated, path, body, at);
    // The screen hears of the key now, when the key is stamped and its row
    // written: a page that reads on the event finds the row.
    for event in events {
        match event {
            KeyEvent::Lighting => crate::engine_events::emit_lighting_changed("control-surface"),
            KeyEvent::Page(event, payload) => crate::engine_events::emit_event(event, payload),
        }
    }
    response
}

/// What the screen is to hear of a key of the deck.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum KeyEvent {
    /// `lighting.changed { reason: "control-surface" }`.
    Lighting,
    /// An event of the PROMPTER or the CAMERAS page, with its payload.
    Page(&'static str, Value),
}

/// A key of the deck: acted on, stamped as the last event and written to
/// Recent actions, in that order. It raises no event of the key's: it says
/// which the screen is to hear, for its caller to raise afterwards. (The
/// AUDIO page's keys announce themselves inside their action, as they did.)
pub(crate) fn deck_key_stamped(
    db_path: &Path,
    cameras_simulated: bool,
    path: &str,
    body: &Value,
    at: Instant,
) -> (Result<Value, ControlSurfaceError>, Vec<KeyEvent>) {
    let Some(action) = body
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return (
            Err(ControlSurfaceError::InvalidParams(String::from(
                "action is required",
            ))),
            Vec::new(),
        );
    };
    let value = body.get("value").and_then(Value::as_str);

    // `Toggle`, `DIM`, a mute and `PLAY` drop a second press within the
    // dwell (the owner's decision, 2026-09-28): it sends nothing, leaves no
    // row and raises nothing. Counted from the press that last acted, so a
    // steady stream of presses still switches at every other one.
    let dwelling = dwelling_press(path, action, value);
    let before = match &dwelling {
        Some(press) => match take_dwelling_press(db_path, press, at) {
            Some(before) => before,
            None => return (Ok(json!({ "ok": true, "did": "kept" })), Vec::new()),
        },
        None => None,
    };

    let mut events = Vec::new();
    let response = match path {
        "/api/deck/light-action" => handle_light_action(db_path, action, at),
        "/api/deck/audio-action" => handle_audio_action_at(db_path, action, value, at),
        _ => match crate::control_surface_pages::handle_page_action(
            db_path,
            cameras_simulated,
            path,
            action,
            value,
            at,
        ) {
            Some(Ok(page)) => {
                events.extend(
                    page.events
                        .into_iter()
                        .map(|(event, payload)| KeyEvent::Page(event, payload)),
                );
                Ok(page.answer)
            }
            Some(Err(error)) => Err(error),
            None => Err(ControlSurfaceError::InvalidParams(format!(
                "Unsupported action route: {path}"
            ))),
        },
    };
    let Ok(reply) = &response else {
        if let Some(press) = &dwelling {
            release_dwelling_press(db_path, press, before, at);
        }
        return (response, Vec::new());
    };
    // The action log (Slice 11 — F30): every key through the bridge is
    // the Stream Deck's, so this is where a row gets the source `deck`.
    // The reply says what the key did and whether it was staged in the
    // preview; the row rides the transaction that stamps the last
    // event, so a key waits for the disk no more often than before.
    let actions = crate::action_log::deck_actions(path, action, reply);
    // A PROMPTER key writes no row, and its last event is kept in memory
    // (2026-10-02): the dial waits for no disk before the glass hears of it.
    let order = LAST_EVENT_ORDER.fetch_add(1, Ordering::SeqCst);
    if path == crate::control_surface_pages::PROMPTER_ROUTE && actions.is_empty() {
        keep_last_event(db_path, order, last_event_value(path, action, value));
        return (response, events);
    }
    let stamped = stamp_control_surface_last_event(db_path, path, action, value, &actions);
    if stamped.is_ok() {
        note_saved_last_event(db_path, order);
    }
    if let Err(error) = stamped {
        crate::diagnostics::log_event(
            crate::diagnostics::LogLevel::Warn,
            &format!(
                "Stream Deck key {action}: the last event and {} action-log row(s) could not be written: {}",
                actions.len(),
                error.message()
            ),
        );
    }
    // An armed `All Off` or `Del Scene`, and a press that was the same press
    // again, changed nothing for the screen to hear of.
    let changed = !matches!(
        reply.get("did").and_then(Value::as_str),
        Some("armed" | "kept")
    );
    if let (true, Some(DeckChange::Lighting)) = (changed, deck_change_event(path, action)) {
        events.insert(0, KeyEvent::Lighting);
    }
    (response, events)
}

/// What a deck action changed, as the screen needs to hear it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeckChange {
    Lighting,
}

/// The event a successful deck action raises (2026-09 production readiness,
/// Slice 10), so an open workspace follows the deck instead of waiting for
/// its next request. The audio route announces itself (`emit_audio_changed`).
/// New pages program, Slice 2: the PROJECTS and TASKS keys, their route
/// (`/api/deck/action`) and their `planning.changed` left with Planning, and
/// so did the deck-mode key (`switchToDeckMode`), which stored a Planning
/// setting nothing read.
fn deck_change_event(path: &str, action: &str) -> Option<DeckChange> {
    match (path, action) {
        ("/api/deck/light-action", _) => Some(DeckChange::Lighting),
        _ => None,
    }
}

/// A key's last event as Setup's echo reads it: its route, action and value,
/// and when, in epoch milliseconds.
fn last_event_value(route: &str, action: &str, value: Option<&str>) -> Value {
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    json!({
        "route": route,
        "action": action,
        "value": value,
        "at": at,
    })
}

fn stamp_control_surface_last_event(
    db_path: &Path,
    route: &str,
    action: &str,
    value: Option<&str>,
    actions: &[crate::action_log::ActionRecord],
) -> Result<(), ControlSurfaceError> {
    let event = last_event_value(route, action, value);
    set_settings_owned_and(
        db_path,
        &[(String::from(LAST_EVENT_KEY), event.to_string())],
        |transaction| crate::action_log::insert_actions(transaction, actions),
    )
    .map_err(|error| ControlSurfaceError::Storage(error.to_string()))
}

/// The order the keys of the deck came in, for every saved data: which of
/// the saved and the kept last events is the later is told by it, not by the
/// wall clock, which Windows may set back (the review of #288).
static LAST_EVENT_ORDER: AtomicU64 = AtomicU64::new(1);

/// For each saved data: the PROMPTER page's last key, kept in memory and not
/// written (2026-10-02), and the order of the last key that was written; a
/// restart forgets both.
#[derive(Default)]
struct LastEvents {
    kept: Option<(u64, Value)>,
    saved_order: u64,
}

static LAST_EVENTS: OnceLock<Mutex<HashMap<PathBuf, LastEvents>>> = OnceLock::new();

fn last_events() -> MutexGuard<'static, HashMap<PathBuf, LastEvents>> {
    LAST_EVENTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn keep_last_event(db_path: &Path, order: u64, event: Value) {
    last_events().entry(db_path.to_path_buf()).or_default().kept = Some((order, event));
}

fn note_saved_last_event(db_path: &Path, order: u64) {
    let mut events = last_events();
    let events = events.entry(db_path.to_path_buf()).or_default();
    events.saved_order = events.saved_order.max(order);
}

/// The last key of the deck: the PROMPTER page's kept in memory when it came
/// after the last one written, else the saved one.
pub fn control_surface_last_event(db_path: &Path) -> Value {
    let kept = last_events().get(db_path).and_then(|events| {
        events
            .kept
            .as_ref()
            .filter(|(order, _)| *order > events.saved_order)
            .map(|(_, event)| event.clone())
    });
    if let Some(kept) = kept {
        return kept;
    }
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .ok()
        .and_then(|settings| settings.get(LAST_EVENT_KEY).cloned())
        .and_then(|serialized| serde_json::from_str::<Value>(&serialized).ok())
        .unwrap_or(Value::Null)
}

fn handle_light_action(
    db_path: &Path,
    action: &str,
    at: Instant,
) -> Result<Value, ControlSurfaceError> {
    // Every lighting key reads, decides and writes under the lighting state
    // lock, with the preview the IPC loop uses, and changes lighting state
    // only through the functions the screen's requests run (2026-09
    // production readiness, Slice 10 — F12): two keys, or a key and the
    // screen, can no longer overwrite each other's change, and a key pressed
    // while previewing edits the preview buffer, not the light output.
    with_lighting_state_and_preview(|preview| asked_light_action(db_path, action, preview, at))
}

/// `All Off` and `Del Scene` ask first (the owner's decision, 2026-09-28):
/// the first press arms and the key reads `OFF?` or `DEL?`, and a second
/// press within 3 s, about the same rig, acts. Any other key of the page
/// ends an arm. The answer's `did` says what the press did: `armed`, `kept`
/// (nothing), or `switched` and `deleted` for the press that acted.
fn asked_light_action(
    db_path: &Path,
    action: &str,
    preview: &mut LightingPreviewRuntimeState,
    at: Instant,
) -> Result<Value, ControlSurfaceError> {
    let Some(key) = AskingKey::from_action(action) else {
        end_arm(db_path);
        return locked_light_action(db_path, action, preview);
    };
    let target = match key {
        AskingKey::AllOff => Ok(AskTarget::Previewing(preview.enabled)),
        AskingKey::DeleteScene => list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))
            .and_then(|app_settings| {
                let lighting_state = load_lighting_editor_state(&app_settings);
                resolve_selected_inventory_id(
                    &app_settings,
                    SELECTED_SCENE_ID_KEY,
                    lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
                )
                .map(AskTarget::Scene)
                .ok_or_else(|| {
                    ControlSurfaceError::Rejected(String::from("No lighting scene is selected."))
                })
            }),
    };
    // A refused press is a press of the page too: it ends another key's arm
    // (the review of #254).
    let target = match target {
        Ok(target) => target,
        Err(error) => {
            end_arm(db_path);
            return Err(error);
        }
    };
    match ask(db_path, key, target, at) {
        Ask::Armed => return Ok(json!({ "did": "armed" })),
        Ask::Kept => return Ok(json!({ "did": "kept" })),
        Ask::Act => {}
    }
    match locked_light_action(db_path, action, preview) {
        Ok(mut reply) => {
            asked_key_acted(db_path, key, at);
            if let Some(fields) = reply.as_object_mut() {
                let did = match key {
                    AskingKey::AllOff => "switched",
                    AskingKey::DeleteScene => "deleted",
                };
                fields.insert(String::from("did"), json!(did));
            }
            Ok(reply)
        }
        Err(error) => {
            end_arm(db_path);
            Err(error)
        }
    }
}

fn locked_light_action(
    db_path: &Path,
    action: &str,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<Value, ControlSurfaceError> {
    let app_settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
        .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    let lighting_state = load_lighting_editor_state(&app_settings);

    match action {
        "selectNextLight" | "selectPrevLight" => {
            let selected_light_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_LIGHT_ID_KEY,
                lighting_state
                    .fixtures
                    .iter()
                    .map(|fixture| fixture.id.as_str()),
            );
            let next_light_id = cycle_inventory_id(
                lighting_state
                    .fixtures
                    .iter()
                    .map(|fixture| fixture.id.as_str()),
                selected_light_id.as_deref(),
                action == "selectNextLight",
            );
            persist_optional_setting(db_path, SELECTED_LIGHT_ID_KEY, next_light_id.as_deref())?;
            Ok(json!({ "selectedLightId": next_light_id }))
        }
        "selectNextScene" | "selectPrevScene" => {
            let selected_scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            );
            let next_scene_id = cycle_inventory_id(
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
                selected_scene_id.as_deref(),
                action == "selectNextScene",
            );
            persist_optional_setting(db_path, SELECTED_SCENE_ID_KEY, next_scene_id.as_deref())?;
            Ok(json!({ "selectedSceneId": next_scene_id }))
        }
        "toggleLight" | "intensityUp" | "intensityDown" | "cctUp" | "cctDown"
        | "resetIntensity" | "resetCct" => {
            let fixture_id = selected_lighting_fixture_id(&app_settings, &lighting_state)?;
            // The relative keys start from what the operator means the
            // fixture to be: the preview buffer while previewing, otherwise
            // the stored value with a running fade sampled now.
            let levels = read_lighting_fixture_levels(&app_settings, preview, &fixture_id)
                .ok_or_else(|| {
                    ControlSurfaceError::Rejected(String::from(
                        "Selected lighting fixture was not found.",
                    ))
                })?;
            let (field, change) = match action {
                "toggleLight" => ("on", json!(!levels.on)),
                "intensityUp" => ("intensity", json!(clamp_i64(levels.intensity + 5, 0, 100))),
                "intensityDown" => ("intensity", json!(clamp_i64(levels.intensity - 5, 0, 100))),
                "cctUp" => ("cct", json!(clamp_i64(levels.cct + 200, 2700, 6500))),
                "cctDown" => ("cct", json!(clamp_i64(levels.cct - 200, 2700, 6500))),
                "resetIntensity" => ("intensity", json!(100)),
                _ => ("cct", json!(4500)),
            };
            let mut params = json!({ "fixtureId": fixture_id });
            params[field] = change;
            let result = update_lighting_fixture_with_preview(
                db_path,
                &parse_lighting_fixture_update_request(&params)
                    .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            // The reply carries what was stored — the fixture's own CCT range
            // may be narrower than the deck's 2700–6500 K.
            let stored = match field {
                "on" => json!(result.fixture.on),
                "intensity" => json!(result.fixture.intensity),
                _ => json!(result.fixture.cct),
            };
            let mut light = json!({ "id": result.fixture.id, "name": result.fixture.name });
            light[field] = stored;
            Ok(json!({ "light": light, "preview": result.source == "preview" }))
        }
        "allOn" | "allOff" => {
            let next_on = action == "allOn";
            let previewing = preview.enabled;
            set_lighting_all_power_with_preview(
                db_path,
                &parse_lighting_all_power_request(&json!({ "on": next_on }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            Ok(json!({ "on": next_on, "preview": previewing }))
        }
        "saveScene" => {
            // The deck keeps its own name for the scene ("Scene N"); the id
            // comes from the rule the screen's scenes use, which never hands
            // out an id a live scene already has.
            let scene_name = format!("Scene {}", lighting_state.scenes.len() + 1);
            let result = create_lighting_scene_with_preview(
                db_path,
                &parse_lighting_scene_create_request(&json!({ "name": scene_name }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            persist_optional_setting(db_path, SELECTED_SCENE_ID_KEY, Some(&result.scene.id))?;
            Ok(json!({ "scene": { "id": result.scene.id, "name": result.scene.name } }))
        }
        "deleteScene" => {
            let selected_scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            )
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(String::from("No lighting scene is selected."))
            })?;
            let current_index = lighting_state
                .scenes
                .iter()
                .position(|scene| scene.id == selected_scene_id)
                .unwrap_or(0);
            delete_lighting_scene(
                db_path,
                &parse_lighting_scene_delete_request(&json!({ "sceneId": selected_scene_id }))
                    .map_err(ControlSurfaceError::InvalidParams)?,
            )
            .map_err(map_lighting_error)?;
            let remaining = lighting_state
                .scenes
                .iter()
                .filter(|scene| scene.id != selected_scene_id)
                .collect::<Vec<_>>();
            let next_scene_id = remaining
                .get(current_index.min(remaining.len().saturating_sub(1)))
                .map(|scene| scene.id.clone());
            persist_optional_setting(db_path, SELECTED_SCENE_ID_KEY, next_scene_id.as_deref())?;
            Ok(json!({ "deleted": true, "sceneId": selected_scene_id }))
        }
        "recallScene" => {
            let scene_id = resolve_selected_inventory_id(
                &app_settings,
                SELECTED_SCENE_ID_KEY,
                lighting_state.scenes.iter().map(|scene| scene.id.as_str()),
            )
            .ok_or_else(|| {
                ControlSurfaceError::Rejected(String::from("No lighting scene is available."))
            })?;
            // The recall writes everything a recall writes; nothing is saved
            // after it (the deck used to save its pre-recall copy of the
            // state over what the recall had just written). It fades as the
            // Lighting page's recall does (the owner's decision, 2026-10-03:
            // until then the deck always recalled at once): the page's Fade,
            // and none into the preview, which the page loads at once too.
            let fade_ms = if preview.enabled {
                0
            } else {
                read_lighting_recall_fade_ms(&app_settings)
            };
            let result = recall_lighting_scene_with_preview(
                db_path,
                &parse_lighting_scene_recall_request(&json!({
                    "sceneId": scene_id,
                    "fadeMs": fade_ms
                }))
                .map_err(ControlSurfaceError::InvalidParams)?,
                preview,
            )
            .map_err(map_lighting_error)?;
            Ok(json!({ "recalled": result.scene_name, "preview": result.preview_mode }))
        }
        _ => Err(ControlSurfaceError::Unsupported(format!(
            "Unsupported lighting deck action: {action}"
        ))),
    }
}

fn map_lighting_error(error: LightingCommandError) -> ControlSurfaceError {
    match error {
        LightingCommandError::Rejected(_, message) => ControlSurfaceError::Rejected(message),
        LightingCommandError::Storage(message) => ControlSurfaceError::Storage(message),
    }
}

fn resolve_selected_inventory_id<'a>(
    settings: &HashMap<String, String>,
    key: &str,
    inventory_ids: impl Iterator<Item = &'a str>,
) -> Option<String> {
    let inventory_ids = inventory_ids.map(str::to_string).collect::<Vec<_>>();
    let configured = settings.get(key).cloned();
    if let Some(configured) = configured {
        if inventory_ids.iter().any(|value| value == &configured) {
            return Some(configured);
        }
    }
    inventory_ids.into_iter().next()
}

fn cycle_inventory_id<'a>(
    inventory_ids: impl Iterator<Item = &'a str>,
    current_id: Option<&str>,
    forward: bool,
) -> Option<String> {
    let values = inventory_ids.map(str::to_string).collect::<Vec<_>>();
    if values.is_empty() {
        return None;
    }

    let index = current_id
        .and_then(|current_id| values.iter().position(|value| value == current_id))
        .unwrap_or(0);
    let next = if forward {
        (index + 1) % values.len()
    } else if index == 0 {
        values.len() - 1
    } else {
        index - 1
    };
    values.get(next).cloned()
}

fn persist_optional_setting(
    db_path: &Path,
    key: &str,
    value: Option<&str>,
) -> Result<(), ControlSurfaceError> {
    let mut updates = Vec::new();
    let mut deletes = Vec::new();
    if let Some(value) = value {
        updates.push((key.to_string(), value.to_string()));
    } else {
        deletes.push(key.to_string());
    }
    if !updates.is_empty() {
        set_settings_owned(db_path, &updates)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
    }
    if !deletes.is_empty() {
        let connection = open_connection(db_path)
            .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
        for key in deletes {
            connection
                .execute("DELETE FROM app_settings WHERE key = ?1", [key])
                .map_err(|error| ControlSurfaceError::Storage(error.to_string()))?;
        }
    }
    Ok(())
}

fn selected_lighting_fixture_id(
    settings: &HashMap<String, String>,
    state: &LightingEditorState,
) -> Result<String, ControlSurfaceError> {
    resolve_selected_inventory_id(
        settings,
        SELECTED_LIGHT_ID_KEY,
        state.fixtures.iter().map(|fixture| fixture.id.as_str()),
    )
    .ok_or_else(|| ControlSurfaceError::Rejected(String::from("No lighting fixture is available.")))
}

pub(crate) fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

pub(crate) fn truncate(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        return value.to_string();
    }
    chars.truncate(max_chars);
    chars.into_iter().collect()
}

pub(crate) fn cycle_value(values: &[&str], current: &str, forward: bool) -> String {
    let index = values
        .iter()
        .position(|value| *value == current)
        .unwrap_or(0);
    let next = if forward {
        (index + 1) % values.len()
    } else if index == 0 {
        values.len() - 1
    } else {
        index - 1
    };
    values[next].to_string()
}

/// The Surface lamp's check. A bridge that serves reads `ready` while the
/// deck has asked within `DECK_QUIET_AFTER`, and `quiet` while it has not
/// (2026-09-29): the lamp says `no deck`, and nothing else changes. `ok`
/// stays whether the bridge serves, as the lanes and the pages read it.
pub fn build_control_surface_health_check(runtime: &RuntimeContext) -> Value {
    let bridge = &runtime.control_surface_bridge;
    let now = std::time::Instant::now();
    let quiet = bridge.available && !crate::deck_heard::deck_heard_lately(&runtime.db_path, now);
    let (status, summary) = if quiet {
        (
            String::from("quiet"),
            crate::deck_heard::deck_quiet_sentence(&runtime.db_path, now),
        )
    } else {
        (bridge.status.clone(), bridge.summary.clone())
    };
    json!({
        "ok": bridge.available,
        "status": status,
        "summary": summary,
        "baseUrl": bridge.base_url,
        "port": bridge.port,
        "error": bridge.error,
    })
}

/// Test fixtures shared with `control_surface_http::tests`.
#[cfg(test)]
pub(crate) mod test_support {
    use crate::storage::{initialize_test_database, set_settings_owned};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(crate) struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        pub(crate) fn new(label: &str) -> Self {
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

        pub(crate) fn path(&self) -> &Path {
            &self.path
        }

        pub(crate) fn db_path(&self) -> PathBuf {
            self.path.join("native.sqlite3")
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    pub(crate) fn ready_audio_test_db(label: &str) -> TestDir {
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
}

#[cfg(test)]
mod tests;
