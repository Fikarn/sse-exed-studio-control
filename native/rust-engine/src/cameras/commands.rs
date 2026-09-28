//! The `cameras.*` methods (new pages program, Slice 8; `v1.md`'s "Cameras"
//! section). Each runs under the cameras' lock (`with_cameras`). What the
//! operator reads — a refusal, a change's sentence — is written here and in
//! `model.rs`.
//!
//! The rules the design sets: only the operator's press sends anything to a
//! camera (D11, D12) — a start, a snapshot, a selection, a connect, Setup and
//! a restore send nothing; the camera wins a disagreement, so each answer is
//! what the camera reports after the press; a change of format or look, a
//! record's stop and a release need `confirm: true` (the page's second
//! press, D19); the record acts on CAM 1 whichever camera is selected (D14);
//! nothing formats a card, updates firmware or resets a camera (D11).
//!
//! The order of the checks for a control on a camera: the request's shape
//! (`INVALID_PARAMS`), then not set up, released, unreachable, a setting the
//! camera does not report or offer, a value it does not allow, and last the
//! second press.

use crate::action_log::{list_recent_domain_actions, DOMAIN_CAMERAS};
use crate::cameras::model::{
    address_refusal, model, parse_camera_address, AutoKind, Setting, ALREADY_RECORDING,
    CAMERA_NUMBERS, NOT_CONFIRMED, NOT_RECORDING, RECORDING_CAMERA, STARTED_RECORDING,
    STOPPED_RECORDING, VMIX_INPUT_MAX, VMIX_INPUT_MIN,
};
use crate::cameras::runtime::{with_cameras, Cameras};
use crate::cameras::simulated::{CameraCommand, CameraReading, CameraValue, SimulatedCameras};
use crate::cameras::snapshot::{
    CameraDialBank, CameraRecentAction, CameraState, CamerasHealthCheck,
};
use crate::cameras::store::{read_setup, write_setup, StoredSetup};
use crate::cameras::{CameraError, CamerasReply};
use crate::diagnostics::{log_event, LogLevel};
use crate::storage::open_connection;
use serde_json::{json, Value};
use std::path::Path;
use std::time::SystemTime;

/// A request's answer and its `cameras.changed { reason, camera }`.
pub(super) type Handled = Result<(Value, Option<(&'static str, Option<u8>)>), CameraError>;

/// How many of the cameras' Recent actions `cameras.snapshot` carries: what
/// the page's list holds.
pub(crate) const CAMERAS_RECENT_LIMIT: usize = 5;

/// Answers one `cameras.*` request. `simulated` is `SSE_CAMERAS_SIMULATED`,
/// read at the start.
pub(crate) fn handle_cameras_request(
    db_path: &Path,
    simulated: bool,
    method: &str,
    params: &Value,
) -> Result<CamerasReply, CameraError> {
    with_cameras(db_path, simulated, |cameras, bodies, now| {
        let before = cameras.health_check();
        let (result, event) = match method {
            "cameras.snapshot" => {
                let recent = recent_actions(db_path, cameras);
                (serde_json::to_value(cameras.snapshot(recent))?, None)
            }
            "cameras.select" => select_request(cameras, params)?,
            "cameras.bank.set" => bank_request(cameras, params)?,
            "cameras.set" => set_request(cameras, bodies, params, now)?,
            "cameras.step" => step_request(cameras, bodies, params, now)?,
            "cameras.auto" => auto_request(cameras, bodies, params, now)?,
            "cameras.format.set" => format_request(cameras, bodies, params, now)?,
            "cameras.look.set" => look_request(cameras, bodies, params, now)?,
            "cameras.record.start" => record_request(cameras, bodies, params, now, true)?,
            "cameras.record.stop" => record_request(cameras, bodies, params, now, false)?,
            "cameras.release" => release_request(cameras, params)?,
            "cameras.connect" => connect_request(cameras, bodies, params, now)?,
            "cameras.setup.update" => setup_update_request(db_path, cameras, bodies, params, now)?,
            "cameras.setup.pair" => setup_pair_request(db_path, cameras, bodies, params, now)?,
            "cameras.setup.forget" => setup_forget_request(db_path, cameras, bodies, params, now)?,
            other => return Err(CameraError::Invalid(format!("Unsupported method: {other}"))),
        };
        Ok(CamerasReply {
            result,
            event,
            health_changed: cameras.health_check() != before,
        })
    })
}

/// The cameras' newest Recent actions, as the action log holds them. A log
/// that cannot be read never fails the cameras' read: the list is `None`,
/// and the log says so once for as long as it lasts.
fn recent_actions(db_path: &Path, cameras: &mut Cameras) -> Option<Vec<CameraRecentAction>> {
    match list_recent_domain_actions(db_path, DOMAIN_CAMERAS, CAMERAS_RECENT_LIMIT) {
        Ok(rows) => {
            cameras.recent_unread = false;
            Some(
                rows.into_iter()
                    .map(|row| CameraRecentAction {
                        id: row.id,
                        at: row.at,
                        source: row.source,
                        action: row.action,
                        target: row.target,
                        detail: row.detail,
                    })
                    .collect(),
            )
        }
        Err(error) => {
            if !cameras.recent_unread {
                log_event(
                    LogLevel::Warn,
                    &format!("The cameras' Recent actions could not be read: {error}"),
                );
            }
            cameras.recent_unread = true;
            None
        }
    }
}

/// `checks.cameras` for `health.snapshot`.
pub(crate) fn cameras_health_check(
    db_path: &Path,
    simulated: bool,
) -> Result<CamerasHealthCheck, CameraError> {
    with_cameras(db_path, simulated, |cameras, _, _| {
        Ok(cameras.health_check())
    })
}

/// After an archive restore: the cameras take their new setup from the saved
/// data (a camera whose address or pairing changed starts again, held and
/// read — nothing is sent). Says whether `checks.cameras` changed.
pub(crate) fn after_archive_restore(db_path: &Path, simulated: bool) -> Result<bool, CameraError> {
    with_cameras(db_path, simulated, |cameras, bodies, now| {
        let before = cameras.health_check();
        for setup in read_setup(&open_connection(db_path)?)? {
            cameras.take_setup(setup, bodies, now, false);
        }
        Ok(cameras.health_check() != before)
    })
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

fn camera_param(params: &Value) -> Result<u8, CameraError> {
    params
        .get("camera")
        .and_then(Value::as_u64)
        .and_then(|camera| u8::try_from(camera).ok())
        .filter(|camera| CAMERA_NUMBERS.contains(camera))
        .ok_or_else(|| CameraError::Invalid(String::from("camera must be 1, 2 or 3.")))
}

/// `confirm`: the page's second press; absent is `false`.
fn confirm_param(params: &Value) -> Result<bool, CameraError> {
    match params.get("confirm") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(confirm)) => Ok(*confirm),
        Some(_) => Err(CameraError::Invalid(String::from(
            "confirm must be true or false.",
        ))),
    }
}

fn optional_text<'a>(params: &'a Value, key: &str) -> Result<Option<&'a str>, CameraError> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.as_str())),
        Some(_) => Err(CameraError::Invalid(format!(
            "{key} must be one of the camera's values, as text."
        ))),
    }
}

fn setting_param(params: &Value) -> Result<Setting, CameraError> {
    params
        .get("setting")
        .and_then(Value::as_str)
        .and_then(Setting::pressed)
        .ok_or_else(|| {
            CameraError::Invalid(String::from(
                "setting must be iso, shutter, iris, nd, whiteBalance, tint or focus.",
            ))
        })
}

/// `step`: a whole number of the camera's own steps, from −1000 to 1000, not
/// 0 (a range check, as `abs` would overflow on the smallest `i64`).
fn step_param(params: &Value) -> Result<i64, CameraError> {
    params
        .get("step")
        .and_then(Value::as_i64)
        .filter(|step| *step != 0 && (-1000..=1000).contains(step))
        .ok_or_else(|| {
            CameraError::Invalid(String::from("step must be a whole number of steps, not 0."))
        })
}

fn not_confirmed() -> CameraError {
    CameraError::Refused("CAMERA_CHANGE_NOT_CONFIRMED", String::from(NOT_CONFIRMED))
}

fn unsupported(sentence: String) -> CameraError {
    CameraError::Refused("CAMERA_SETTING_UNSUPPORTED", sentence)
}

fn not_allowed(sentence: String) -> CameraError {
    CameraError::Refused("CAMERA_VALUE_NOT_ALLOWED", sentence)
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/// A control needs a held camera: `CAMERA_NOT_SET_UP`, `CAMERA_RELEASED` or
/// `CAMERA_UNREACHABLE` otherwise, with its sentence.
pub(super) fn held(cameras: &Cameras, camera: u8) -> Result<(), CameraError> {
    let runtime = cameras.camera(camera);
    let model = model(camera);
    match runtime.state() {
        CameraState::Held => Ok(()),
        CameraState::NotSetUp => Err(CameraError::Refused(
            "CAMERA_NOT_SET_UP",
            runtime.sentence(),
        )),
        CameraState::Released => Err(CameraError::Refused(
            "CAMERA_RELEASED",
            model.released_refusal(),
        )),
        CameraState::Unreachable => Err(CameraError::Refused(
            "CAMERA_UNREACHABLE",
            runtime.unreachable_sentence(),
        )),
    }
}

/// What a held camera last reported.
pub(super) fn reading(cameras: &Cameras, camera: u8) -> CameraReading {
    cameras.camera(camera).reading.clone().unwrap_or_default()
}

/// A choice's value the camera allows: `CAMERA_SETTING_UNSUPPORTED` when it
/// does not report the setting, `CAMERA_VALUE_NOT_ALLOWED` when the value is
/// not among its own.
fn allowed_choice(camera: u8, setting: Setting, value: &str) -> Result<(), CameraError> {
    let options = model(camera).options(setting).map_err(unsupported)?;
    if options.contains(&value) {
        Ok(())
    } else {
        Err(not_allowed(model(camera).value_refusal(setting, value)))
    }
}

/// The value as the camera reports it, for an answer.
fn reported(reading: &CameraReading, setting: Setting) -> Value {
    if setting.is_level() {
        json!(reading.number(setting))
    } else {
        json!(reading.text(setting))
    }
}

/// Sends the press and reads the camera back: the answer is what it reports
/// (the camera wins, D12).
fn press(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    camera: u8,
    commands: &[CameraCommand],
    now: SystemTime,
) -> Result<CameraReading, CameraError> {
    cameras.send(camera, bodies, commands)?;
    cameras.read_back(camera, bodies, now);
    held(cameras, camera)?;
    Ok(reading(cameras, camera))
}

// ---------------------------------------------------------------------------
// The selection, the settings
// ---------------------------------------------------------------------------

/// `cameras.select { camera }`: the big picture, the plate and the deck's
/// dials follow it (D19). A camera that is not set up can be selected.
pub(super) fn select_request(cameras: &mut Cameras, params: &Value) -> Handled {
    let camera = camera_param(params)?;
    cameras.selected = camera;
    Ok((
        json!({ "selected": camera }),
        Some(("select", Some(camera))),
    ))
}

/// `cameras.bank.set { bank }`: what the deck's dials set on the selected
/// camera (D14): `exposure`, `colour` or `focus`. Nothing reaches a camera.
fn bank_request(cameras: &mut Cameras, params: &Value) -> Handled {
    let bank = params
        .get("bank")
        .and_then(Value::as_str)
        .and_then(CameraDialBank::from_key)
        .ok_or_else(|| {
            CameraError::Invalid(String::from("bank must be exposure, colour or focus."))
        })?;
    Ok(set_bank(cameras, bank))
}

/// Puts the deck's dials on `bank`, for the page's key and the deck's.
pub(super) fn set_bank(
    cameras: &mut Cameras,
    bank: CameraDialBank,
) -> (Value, Option<(&'static str, Option<u8>)>) {
    cameras.bank = bank;
    (
        json!({ "bank": bank.key(), "dials": cameras.dials() }),
        Some(("bank", None)),
    )
}

/// `cameras.set { camera, setting, value }`: a choice's value from its
/// options, or a level's number in its range, on its step.
fn set_request(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let setting = setting_param(params)?;
    let raw = params.get("value").cloned().unwrap_or(Value::Null);
    let value = if setting.is_level() {
        CameraValue::Number(raw.as_f64().ok_or_else(|| {
            CameraError::Invalid(format!("value must be a number for {}.", setting.key()))
        })?)
    } else {
        CameraValue::Text(
            raw.as_str()
                .ok_or_else(|| {
                    CameraError::Invalid(format!(
                        "value must be one of the camera's values, as text, for {}.",
                        setting.key()
                    ))
                })?
                .to_string(),
        )
    };
    held(cameras, camera)?;
    let model = model(camera);
    let value = match value {
        CameraValue::Number(number) => {
            let scale = model.scale(setting).map_err(unsupported)?;
            if !scale.allows(number) {
                // The number as the page writes it: `5625`, not JSON's `5625.0`.
                return Err(not_allowed(
                    model.value_refusal(setting, &number.to_string()),
                ));
            }
            CameraValue::Number(scale.at(scale.steps_of(number)))
        }
        CameraValue::Text(text) => {
            allowed_choice(camera, setting, &text)?;
            CameraValue::Text(text)
        }
        CameraValue::Switch(_) => unreachable!("a press sets no switch"),
    };
    let after = press(
        cameras,
        bodies,
        camera,
        &[CameraCommand::Set(setting, value)],
        now,
    )?;
    Ok((
        json!({ "camera": camera, "setting": setting.key(), "value": reported(&after, setting) }),
        Some(("setting", Some(camera))),
    ))
}

/// `cameras.step { camera, setting, step }`: the deck's dials and the page's
/// steppers, in the camera's own steps, stopping at the ends. Focus on a
/// camera with `focusSteps` moves nearer (`-`) or farther (`+`) without a
/// position, and answers no value.
pub(super) fn step_request(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let setting = setting_param(params)?;
    let step = step_param(params)?;
    held(cameras, camera)?;
    let model = model(camera);
    let command = if setting == Setting::Focus && model.focus_steps() {
        CameraCommand::FocusSteps(step)
    } else if setting.is_level() {
        let scale = model.scale(setting).map_err(unsupported)?;
        let current = reading(cameras, camera)
            .number(setting)
            .map_or(0, |value| scale.steps_of(value));
        let target = (current + step).clamp(0, scale.last_step());
        CameraCommand::Set(setting, CameraValue::Number(scale.at(target)))
    } else {
        let options = model.options(setting).map_err(unsupported)?;
        let current = reading(cameras, camera);
        let index = current
            .text(setting)
            .and_then(|value| options.iter().position(|option| *option == value))
            .unwrap_or(0) as i64;
        let last = options.len().saturating_sub(1) as i64;
        let target = usize::try_from((index + step).clamp(0, last)).unwrap_or(0);
        CameraCommand::Set(setting, CameraValue::Text(String::from(options[target])))
    };
    let after = press(cameras, bodies, camera, &[command], now)?;
    Ok((
        json!({ "camera": camera, "setting": setting.key(), "value": reported(&after, setting) }),
        Some(("setting", Some(camera))),
    ))
}

/// `cameras.auto { camera, what }`: a one-shot autofocus, auto white balance
/// or auto iris the camera offers; the answer is the value it settles on.
pub(super) fn auto_request(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let auto = params
        .get("what")
        .and_then(Value::as_str)
        .and_then(AutoKind::from_key)
        .ok_or_else(|| {
            CameraError::Invalid(String::from("what must be focus, whiteBalance or iris."))
        })?;
    held(cameras, camera)?;
    if !model(camera).offers(auto) {
        return Err(unsupported(model(camera).auto_refusal(auto)));
    }
    let after = press(cameras, bodies, camera, &[CameraCommand::Auto(auto)], now)?;
    let setting = auto.setting();
    Ok((
        json!({ "camera": camera, "setting": setting.key(), "value": reported(&after, setting) }),
        Some(("setting", Some(camera))),
    ))
}

// ---------------------------------------------------------------------------
// The format and the look (armed: `confirm: true`)
// ---------------------------------------------------------------------------

/// `cameras.format.set { camera, resolution?, frameRate?, confirm }`.
fn format_request(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let resolution = optional_text(params, "resolution")?;
    let frame_rate = optional_text(params, "frameRate")?;
    let confirm = confirm_param(params)?;
    if resolution.is_none() && frame_rate.is_none() {
        return Err(CameraError::Invalid(String::from(
            "Send resolution, frameRate or both.",
        )));
    }
    held(cameras, camera)?;
    let model = model(camera);
    if let Some(resolution) = resolution {
        allowed_choice(camera, Setting::Resolution, resolution)?;
    }
    if let Some(frame_rate) = frame_rate {
        allowed_choice(camera, Setting::FrameRate, frame_rate)?;
    }
    let before = reading(cameras, camera);
    let old_resolution = before.resolution.clone().unwrap_or_default();
    let old_frame_rate = before.frame_rate.clone().unwrap_or_default();
    let new_resolution = resolution.map_or(old_resolution.clone(), str::to_string);
    let new_frame_rate = frame_rate.map_or(old_frame_rate.clone(), str::to_string);
    if model
        .unavailable_frame_rates(&new_resolution)
        .iter()
        .any(|(value, _)| *value == new_frame_rate)
    {
        return Err(CameraError::Refused(
            "CAMERA_FORMAT_NOT_ALLOWED",
            model.format_refusal(&new_frame_rate, &new_resolution),
        ));
    }
    if !confirm {
        return Err(not_confirmed());
    }
    let mut commands = Vec::new();
    if let Some(resolution) = resolution {
        commands.push(CameraCommand::Set(
            Setting::Resolution,
            CameraValue::Text(String::from(resolution)),
        ));
    }
    if let Some(frame_rate) = frame_rate {
        commands.push(CameraCommand::Set(
            Setting::FrameRate,
            CameraValue::Text(String::from(frame_rate)),
        ));
    }
    let after = press(cameras, bodies, camera, &commands, now)?;
    let now_resolution = after.resolution.clone().unwrap_or_default();
    let now_frame_rate = after.frame_rate.clone().unwrap_or_default();
    let change = match (resolution, frame_rate) {
        (Some(_), Some(_)) => {
            format!("{old_resolution} {old_frame_rate}p → {now_resolution} {now_frame_rate}p")
        }
        (Some(_), None) => format!("{old_resolution} → {now_resolution}"),
        _ => format!("{old_frame_rate}p → {now_frame_rate}p"),
    };
    let sentence = format!("{}: {change}.", model.tag);
    Ok((
        json!({ "camera": camera, "sentence": sentence }),
        Some(("format", Some(camera))),
    ))
}

/// `cameras.look.set { camera, dynamicRange?, displayLut?, displayLutOn?,
/// confirm }`: the picture profile and the display LUT.
fn look_request(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let dynamic_range = optional_text(params, "dynamicRange")?;
    let display_lut = optional_text(params, "displayLut")?;
    let display_lut_on = match params.get("displayLutOn") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(on)) => Some(*on),
        Some(_) => {
            return Err(CameraError::Invalid(String::from(
                "displayLutOn must be true or false.",
            )))
        }
    };
    let confirm = confirm_param(params)?;
    if dynamic_range.is_none() && display_lut.is_none() && display_lut_on.is_none() {
        return Err(CameraError::Invalid(String::from(
            "Send dynamicRange, displayLut, displayLutOn or several.",
        )));
    }
    held(cameras, camera)?;
    let model = model(camera);
    for (setting, given) in [
        (Setting::DynamicRange, dynamic_range.is_some()),
        (Setting::DisplayLut, display_lut.is_some()),
        (Setting::DisplayLutOn, display_lut_on.is_some()),
    ] {
        if let Some(sentence) = model.not_reported(setting).filter(|_| given) {
            return Err(unsupported(sentence));
        }
    }
    if let Some(dynamic_range) = dynamic_range {
        allowed_choice(camera, Setting::DynamicRange, dynamic_range)?;
    }
    if let Some(display_lut) = display_lut {
        allowed_choice(camera, Setting::DisplayLut, display_lut)?;
    }
    if !confirm {
        return Err(not_confirmed());
    }
    let before = reading(cameras, camera);
    let mut commands = Vec::new();
    if let Some(dynamic_range) = dynamic_range {
        commands.push(CameraCommand::Set(
            Setting::DynamicRange,
            CameraValue::Text(String::from(dynamic_range)),
        ));
    }
    if let Some(display_lut) = display_lut {
        commands.push(CameraCommand::Set(
            Setting::DisplayLut,
            CameraValue::Text(String::from(display_lut)),
        ));
    }
    if let Some(on) = display_lut_on {
        commands.push(CameraCommand::Set(
            Setting::DisplayLutOn,
            CameraValue::Switch(on),
        ));
    }
    let after = press(cameras, bodies, camera, &commands, now)?;
    let text = |reading: &CameraReading, setting| reading.text(setting).unwrap_or("").to_string();
    let mut parts = Vec::new();
    if dynamic_range.is_some() {
        parts.push(format!(
            "dynamic range {} → {}",
            text(&before, Setting::DynamicRange),
            text(&after, Setting::DynamicRange)
        ));
    }
    if display_lut.is_some() {
        parts.push(format!(
            "display LUT {} → {}",
            text(&before, Setting::DisplayLut),
            text(&after, Setting::DisplayLut)
        ));
    }
    if display_lut_on.is_some() {
        parts.push(format!(
            "display LUT {}",
            if after.display_lut_on == Some(true) {
                "on"
            } else {
                "off"
            }
        ));
    }
    let sentence = format!("{}: {}.", model.tag, parts.join("; "));
    Ok((
        json!({ "camera": camera, "sentence": sentence }),
        Some(("look", Some(camera))),
    ))
}

// ---------------------------------------------------------------------------
// The record (CAM 1, whichever camera is selected; D14)
// ---------------------------------------------------------------------------

/// `cameras.record.start` (one press) and `cameras.record.stop { confirm }`
/// (armed).
pub(super) fn record_request(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    params: &Value,
    now: SystemTime,
    start: bool,
) -> Handled {
    let confirm = if start { true } else { confirm_param(params)? };
    let camera = RECORDING_CAMERA;
    held(cameras, camera)?;
    let recording = reading(cameras, camera).recording == Some(true);
    if start && recording {
        return Err(CameraError::Refused(
            "CAMERA_ALREADY_RECORDING",
            String::from(ALREADY_RECORDING),
        ));
    }
    if !start && !recording {
        return Err(CameraError::Refused(
            "CAMERA_NOT_RECORDING",
            String::from(NOT_RECORDING),
        ));
    }
    if !confirm {
        return Err(not_confirmed());
    }
    let command = if start {
        CameraCommand::RecordStart
    } else {
        CameraCommand::RecordStop
    };
    let after = press(cameras, bodies, camera, &[command], now)?;
    // A take that starts or stops, from the screen or the deck, ends the
    // deck's armed stop: `STOP?` is about the take that was running.
    cameras.stop_armed_at = None;
    let sentence = if start {
        STARTED_RECORDING
    } else {
        STOPPED_RECORDING
    };
    Ok((
        json!({
            "camera": camera,
            "recording": after.recording == Some(true),
            "sentence": sentence,
        }),
        Some(("record", Some(camera))),
    ))
}

// ---------------------------------------------------------------------------
// Release and Connect (D13)
// ---------------------------------------------------------------------------

/// `cameras.release { camera, confirm }`: hands the camera back to the iPad
/// or LUMIX Tether. Nothing is sent: the hardware link stops reading it, and
/// a take CAM 1 is recording goes on.
fn release_request(cameras: &mut Cameras, params: &Value) -> Handled {
    let camera = camera_param(params)?;
    let confirm = confirm_param(params)?;
    let model = model(camera);
    match cameras.camera(camera).state() {
        CameraState::NotSetUp => {
            return Err(CameraError::Refused(
                "CAMERA_NOT_SET_UP",
                cameras.camera(camera).sentence(),
            ))
        }
        CameraState::Released => {
            return Err(CameraError::Refused(
                "CAMERA_RELEASED",
                model.released_refusal(),
            ))
        }
        CameraState::Held | CameraState::Unreachable => {}
    }
    if !confirm {
        return Err(not_confirmed());
    }
    cameras.release(camera);
    Ok((
        json!({
            "camera": camera,
            "state": cameras.camera(camera).state().key(),
            "sentence": model.released_sentence(),
        }),
        Some(("release", Some(camera))),
    ))
}

/// `cameras.connect { camera }`: takes a released camera back and reads it
/// again, or tries an unreachable one again; answers its state. Nothing is
/// sent.
fn connect_request(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let model = model(camera);
    match cameras.camera(camera).state() {
        CameraState::NotSetUp => {
            return Err(CameraError::Refused(
                "CAMERA_NOT_SET_UP",
                cameras.camera(camera).sentence(),
            ))
        }
        CameraState::Held => {
            return Err(CameraError::Refused(
                "CAMERA_ALREADY_HELD",
                model.already_held_refusal(),
            ))
        }
        CameraState::Released | CameraState::Unreachable => {}
    }
    cameras.connect(camera, bodies, now);
    let runtime = cameras.camera(camera);
    let state = runtime.state();
    let sentence = if state == CameraState::Held {
        model.held_again_sentence()
    } else {
        runtime.sentence()
    };
    Ok((
        json!({ "camera": camera, "state": state.key(), "sentence": sentence }),
        Some(("connect", Some(camera))),
    ))
}

// ---------------------------------------------------------------------------
// Setup (not Recent actions)
// ---------------------------------------------------------------------------

/// Saves a camera's row and hands it to the hardware link.
fn save_setup(
    db_path: &Path,
    cameras: &mut Cameras,
    bodies: &SimulatedCameras,
    setup: StoredSetup,
    now: SystemTime,
    hold: bool,
) -> Handled {
    write_setup(&open_connection(db_path)?, &setup)?;
    let camera = setup.camera;
    cameras.take_setup(setup, bodies, now, hold);
    Ok((
        json!({ "camera": camera, "setup": cameras.camera(camera).setup_summary() }),
        Some(("setup", Some(camera))),
    ))
}

/// `cameras.setup.update { camera, address?, vmixInput? }`: CAM 2's or CAM
/// 3's address (`null` takes it away), and any camera's vMix input. Saving
/// an address holds the camera and reads it at once; nothing is sent. In a
/// build with no link to the camera an address is refused
/// (`CAMERA_NO_LINK`), after its shape and its form were checked; taking
/// one away and the vMix input stay.
fn setup_update_request(
    db_path: &Path,
    cameras: &mut Cameras,
    bodies: &SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let address = match params.get("address") {
        None => None,
        Some(_) if camera == 1 => {
            return Err(CameraError::Invalid(String::from(
                "CAM 1 has no address: it is paired over Bluetooth.",
            )))
        }
        Some(Value::Null) => Some(None),
        Some(Value::String(text)) if !text.trim().is_empty() => Some(Some(text.trim())),
        Some(_) => {
            return Err(CameraError::Invalid(String::from(
                "address must be the camera's IPv4 address, or null to take it away.",
            )))
        }
    };
    let vmix_input = match params.get("vmixInput") {
        None => None,
        Some(value) => Some(
            value
                .as_u64()
                .and_then(|input| u32::try_from(input).ok())
                .filter(|input| (VMIX_INPUT_MIN..=VMIX_INPUT_MAX).contains(input))
                .ok_or_else(|| {
                    CameraError::Invalid(String::from(
                        "vmixInput must be a whole number from 1 to 1000.",
                    ))
                })?,
        ),
    };
    if address.is_none() && vmix_input.is_none() {
        return Err(CameraError::Invalid(String::from(
            "Send address, vmixInput or both.",
        )));
    }
    let address = match address {
        Some(Some(text)) => Some(Some(parse_camera_address(text).ok_or_else(|| {
            CameraError::Refused("CAMERA_ADDRESS_INVALID", address_refusal(text))
        })?)),
        other => other.map(|_| None),
    };
    if matches!(address, Some(Some(_))) && !cameras.camera(camera).has_link {
        return Err(CameraError::Refused(
            "CAMERA_NO_LINK",
            model(camera).no_link_refusal(),
        ));
    }
    let mut setup = cameras.camera(camera).setup.clone();
    if let Some(input) = vmix_input {
        setup.vmix_input = input;
    }
    let hold = address.is_some();
    if let Some(address) = address {
        setup.address = address;
    }
    save_setup(db_path, cameras, bodies, setup, now, hold)
}

/// `cameras.setup.pair { camera: 1 }`: with the simulated link at once; the
/// real one comes in Slice 11 (`CAMERA_NO_LINK` until then).
fn setup_pair_request(
    db_path: &Path,
    cameras: &mut Cameras,
    bodies: &SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    if camera != 1 {
        return Err(CameraError::Invalid(String::from(
            "Only CAM 1 is paired; CAM 2 and CAM 3 take an address.",
        )));
    }
    if !cameras.camera(camera).has_link {
        return Err(CameraError::Refused(
            "CAMERA_NO_LINK",
            model(camera).no_link_refusal(),
        ));
    }
    let mut setup = cameras.camera(camera).setup.clone();
    setup.paired = true;
    save_setup(db_path, cameras, bodies, setup, now, true)
}

/// `cameras.setup.forget { camera }`: takes the address or the pairing away
/// (the vMix input stays); the camera is not set up again.
fn setup_forget_request(
    db_path: &Path,
    cameras: &mut Cameras,
    bodies: &SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    let mut setup = cameras.camera(camera).setup.clone();
    setup.address = None;
    setup.paired = false;
    save_setup(db_path, cameras, bodies, setup, now, true)
}
