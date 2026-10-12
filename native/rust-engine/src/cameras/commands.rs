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

use crate::action_log::{
    list_domain_actions_today, list_recent_domain_actions, takes_today, DOMAIN_CAMERAS,
};
use crate::cameras::model::{
    address_refusal, model, parse_camera_address, step_choice, step_level, AutoKind, Setting,
    ALREADY_RECORDING, CAMERA_NUMBERS, NOT_CONFIRMED, NOT_RECORDING, RECORDING_CAMERA,
    STARTED_RECORDING, STOPPED_RECORDING, VMIX_INPUT_MAX, VMIX_INPUT_MIN,
};
use crate::cameras::pocket::pairing::{parse_pin, NOT_WANTED};
use crate::cameras::real_link::LinkFailure;
use crate::cameras::runtime::{with_cameras, Cameras};
use crate::cameras::simulated::{CameraCommand, CameraReading, CameraValue, SimulatedCameras};
use crate::cameras::snapshot::{
    CameraDialBank, CameraRecentAction, CameraState, CamerasHealthCheck, TakesToday,
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

/// The methods that send a camera a press and wait for its answer (the audit
/// of 2026-10-12, H1). They run as `press_request` runs them: two spells
/// under the cameras' lock with the camera's answer waited for between them,
/// the lock let go; and the request loop hands each to a thread of its own
/// (`main.rs`), so no page and no display waits on a camera.
pub(crate) const PRESS_METHODS: [&str; 7] = [
    "cameras.set",
    "cameras.step",
    "cameras.auto",
    "cameras.format.set",
    "cameras.look.set",
    "cameras.record.start",
    "cameras.record.stop",
];

pub(crate) fn is_press_method(method: &str) -> bool {
    PRESS_METHODS.contains(&method)
}

/// Answers one `cameras.*` request. `simulated` is `SSE_CAMERAS_SIMULATED`,
/// read at the start.
pub(crate) fn handle_cameras_request(
    db_path: &Path,
    simulated: bool,
    method: &str,
    params: &Value,
) -> Result<CamerasReply, CameraError> {
    if is_press_method(method) {
        return press_request(db_path, simulated, method, params);
    }
    with_cameras(db_path, simulated, |cameras, bodies, now| {
        let before = cameras.health_check();
        let (result, event) = match method {
            "cameras.snapshot" => {
                let (recent, takes_today) = from_the_log(db_path, cameras);
                (
                    serde_json::to_value(cameras.snapshot(recent, takes_today))?,
                    None,
                )
            }
            "cameras.select" => select_request(cameras, params)?,
            "cameras.bank.set" => bank_request(cameras, params)?,
            "cameras.release" => release_request(cameras, params)?,
            "cameras.connect" => connect_request(cameras, bodies, params, now)?,
            "cameras.setup.update" => setup_update_request(db_path, cameras, bodies, params, now)?,
            "cameras.setup.pair" => setup_pair_request(cameras, bodies, params, now)?,
            "cameras.setup.forget" => setup_forget_request(db_path, cameras, bodies, params, now)?,
            // The page shows the pictures: frames go while it says so, once a
            // second, and a while after. It changes nothing a camera holds.
            "cameras.pictures.showing" => {
                crate::pictures_helper::showing(db_path);
                (serde_json::json!({}), None)
            }
            other => return Err(CameraError::Invalid(format!("Unsupported method: {other}"))),
        };
        Ok(CamerasReply {
            result,
            event,
            health_changed: cameras.health_check() != before,
        })
    })
}

/// What the cameras' read takes from the action log: the newest Recent
/// actions, and CAM 1's takes since local midnight. A log that cannot be read
/// never fails the cameras' read: both are `None`, and the log says so once
/// for as long as it lasts.
fn from_the_log(
    db_path: &Path,
    cameras: &mut Cameras,
) -> (Option<Vec<CameraRecentAction>>, Option<TakesToday>) {
    let read = list_recent_domain_actions(db_path, DOMAIN_CAMERAS, CAMERAS_RECENT_LIMIT)
        .and_then(|recent| Ok((recent, list_domain_actions_today(db_path, DOMAIN_CAMERAS)?)));
    match read {
        Ok((recent, today)) => {
            cameras.recent_unread = false;
            let recent = recent
                .into_iter()
                .map(|row| CameraRecentAction {
                    id: row.id,
                    at: row.at,
                    source: row.source,
                    action: row.action,
                    target: row.target,
                    detail: row.detail,
                })
                .collect();
            let takes = takes_today(&today, SystemTime::now(), cameras.records_now());
            (Some(recent), Some(takes))
        }
        Err(error) => {
            if !cameras.recent_unread {
                log_event(
                    LogLevel::Warn,
                    &format!("The cameras' Recent actions and takes could not be read: {error}"),
                );
            }
            cameras.recent_unread = true;
            (None, None)
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

// ---------------------------------------------------------------------------
// A press, in two spells under the lock
// ---------------------------------------------------------------------------

/// A press as the checks settled it: what goes to which camera, and how the
/// camera's answer becomes the request's.
pub(super) struct Plan {
    pub(super) camera: u8,
    pub(super) commands: Vec<CameraCommand>,
    answer: Answer,
}

/// How a press answers, from what the camera reports after it.
enum Answer {
    /// `{ camera, setting, value }`, the value as the camera now reports it;
    /// `cameras.changed { reason: "setting" }`.
    Setting(Setting),
    /// `{ camera, sentence }` with the change; `format`.
    Format {
        resolution: Option<String>,
        frame_rate: Option<String>,
        old_resolution: String,
        old_frame_rate: String,
    },
    /// `{ camera, sentence }` with the change; `look`.
    Look {
        dynamic_range: bool,
        display_lut: bool,
        display_lut_on: bool,
        before: CameraReading,
    },
    /// `{ camera, recording, sentence }`; `record`.
    Record { start: bool },
}

impl Plan {
    /// The request's answer from what the camera reports after the press
    /// (the camera wins, D12).
    fn answer(
        self,
        cameras: &mut Cameras,
        after: &CameraReading,
    ) -> (Value, Option<(&'static str, Option<u8>)>) {
        let camera = self.camera;
        let tag = model(camera).tag;
        match self.answer {
            Answer::Setting(setting) => (
                json!({ "camera": camera, "setting": setting.key(), "value": reported(after, setting) }),
                Some(("setting", Some(camera))),
            ),
            Answer::Format {
                resolution,
                frame_rate,
                old_resolution,
                old_frame_rate,
            } => {
                let now_resolution = after.resolution.clone().unwrap_or_default();
                let now_frame_rate = after.frame_rate.clone().unwrap_or_default();
                let change = match (resolution.is_some(), frame_rate.is_some()) {
                    (true, true) => format!(
                        "{old_resolution} {old_frame_rate}p → {now_resolution} {now_frame_rate}p"
                    ),
                    (true, false) => format!("{old_resolution} → {now_resolution}"),
                    _ => format!("{old_frame_rate}p → {now_frame_rate}p"),
                };
                (
                    json!({ "camera": camera, "sentence": format!("{}: {change}.", tag) }),
                    Some(("format", Some(camera))),
                )
            }
            Answer::Look {
                dynamic_range,
                display_lut,
                display_lut_on,
                before,
            } => {
                let text = |reading: &CameraReading, setting| {
                    reading.text(setting).unwrap_or("").to_string()
                };
                let mut parts = Vec::new();
                if dynamic_range {
                    parts.push(format!(
                        "dynamic range {} → {}",
                        text(&before, Setting::DynamicRange),
                        text(after, Setting::DynamicRange)
                    ));
                }
                if display_lut {
                    parts.push(format!(
                        "display LUT {} → {}",
                        text(&before, Setting::DisplayLut),
                        text(after, Setting::DisplayLut)
                    ));
                }
                if display_lut_on {
                    parts.push(format!(
                        "display LUT {}",
                        if after.display_lut_on == Some(true) {
                            "on"
                        } else {
                            "off"
                        }
                    ));
                }
                (
                    json!({ "camera": camera, "sentence": format!("{}: {}.", tag, parts.join("; ")) }),
                    Some(("look", Some(camera))),
                )
            }
            Answer::Record { start } => {
                // A take that starts ends the deck's armed stop: nobody armed
                // the stop of the new take. A take that stops leaves the arm,
                // and spends it (the read after the press counts the change,
                // `take_changes`): the deck's next press within its 3 s was
                // the stop's second, and starts no take (`deck::rec`).
                if start {
                    cameras.stop_arm = None;
                }
                let sentence = if start {
                    STARTED_RECORDING
                } else {
                    STOPPED_RECORDING
                };
                (
                    json!({
                        "camera": camera,
                        "recording": after.recording == Some(true),
                        "sentence": sentence,
                    }),
                    Some(("record", Some(camera))),
                )
            }
        }
    }
}

/// A press (the audit of 2026-10-12, H1): the checks and the plan under the
/// cameras' lock, the camera's answer waited for with the lock let go
/// (`sending.rs`), then the answer read back from the camera under the lock
/// again. A press the checks refuse sends nothing and takes one spell.
fn press_request(
    db_path: &Path,
    simulated: bool,
    method: &str,
    params: &Value,
) -> Result<CamerasReply, CameraError> {
    // One press at a time to these cameras (`runtime::press_gate`): the
    // next plans from what the camera reported after this one.
    let gate = crate::cameras::runtime::press_gate(db_path);
    let _press = gate
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (before, plan, sending) = with_cameras(db_path, simulated, |cameras, bodies, _| {
        let before = cameras.health_check();
        let plan = match method {
            "cameras.set" => set_plan(cameras, params)?,
            "cameras.step" => step_plan(cameras, params)?,
            "cameras.auto" => auto_plan(cameras, params)?,
            "cameras.format.set" => format_plan(cameras, params)?,
            "cameras.look.set" => look_plan(cameras, params)?,
            "cameras.record.start" => record_plan(cameras, params, true)?,
            "cameras.record.stop" => record_plan(cameras, params, false)?,
            other => return Err(CameraError::Invalid(format!("Unsupported method: {other}"))),
        };
        let sending = cameras.begin_send(plan.camera, bodies, &plan.commands)?;
        Ok((before, plan, sending))
    })?;
    let outcome = sending.wait();
    with_cameras(db_path, simulated, |cameras, bodies, now| {
        let (result, event) = settle_press(cameras, bodies, now, plan, outcome)?;
        Ok(CamerasReply {
            result,
            event,
            health_changed: cameras.health_check() != before,
        })
    })
}

/// The second spell, under the lock: the camera's answer or its silence
/// taken, the camera read back (what it reports now is the answer: the camera
/// wins, D12), and the request's answer made. The deck's keys end here too.
pub(super) fn settle_press(
    cameras: &mut Cameras,
    bodies: &SimulatedCameras,
    now: SystemTime,
    plan: Plan,
    outcome: Result<(), LinkFailure>,
) -> Handled {
    cameras.finish_send(plan.camera, outcome)?;
    cameras.read_back(plan.camera, bodies, now);
    held(cameras, plan.camera)?;
    let after = reading(cameras, plan.camera);
    Ok(plan.answer(cameras, &after))
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
fn set_plan(cameras: &mut Cameras, params: &Value) -> Result<Plan, CameraError> {
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
    Ok(Plan {
        camera,
        commands: vec![CameraCommand::Set(setting, value)],
        answer: Answer::Setting(setting),
    })
}

/// `cameras.step { camera, setting, step }`: the deck's dials and the page's
/// steppers, in the camera's own steps, stopping at the ends. Focus on a
/// camera with `focusSteps` moves nearer (`-`) or farther (`+`) without a
/// position, and answers no value.
pub(super) fn step_plan(cameras: &mut Cameras, params: &Value) -> Result<Plan, CameraError> {
    let camera = camera_param(params)?;
    let setting = setting_param(params)?;
    let step = step_param(params)?;
    held(cameras, camera)?;
    let model = model(camera);
    // The step rule (2026-10-06): a step starts from what the camera
    // reports. From a value that is not on the list, or a level between
    // two steps, it moves from the nearest listed value in the step's
    // direction; a setting not read, or read with no number, is refused.
    let command = if setting == Setting::Focus && model.focus_steps() {
        CameraCommand::FocusSteps(step)
    } else if setting.is_level() {
        let scale = model.scale(setting).map_err(unsupported)?;
        let target = step_level(&scale, reading(cameras, camera).number(setting), step)
            .map_err(|from| not_allowed(model.step_refusal(setting, &from)))?;
        CameraCommand::Set(setting, CameraValue::Number(target))
    } else {
        let options = model.options(setting).map_err(unsupported)?;
        let current = reading(cameras, camera);
        let target = step_choice(options, current.text(setting), step)
            .map_err(|from| not_allowed(model.step_refusal(setting, &from)))?;
        CameraCommand::Set(setting, CameraValue::Text(String::from(options[target])))
    };
    Ok(Plan {
        camera,
        commands: vec![command],
        answer: Answer::Setting(setting),
    })
}

/// `cameras.auto { camera, what }`: a one-shot autofocus, auto white balance
/// or auto iris the camera offers; the answer is the value it settles on.
pub(super) fn auto_plan(cameras: &mut Cameras, params: &Value) -> Result<Plan, CameraError> {
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
    Ok(Plan {
        camera,
        commands: vec![CameraCommand::Auto(auto)],
        answer: Answer::Setting(auto.setting()),
    })
}

// ---------------------------------------------------------------------------
// The format and the look (armed: `confirm: true`)
// ---------------------------------------------------------------------------

/// `cameras.format.set { camera, resolution?, frameRate?, confirm }`.
fn format_plan(cameras: &mut Cameras, params: &Value) -> Result<Plan, CameraError> {
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
    Ok(Plan {
        camera,
        commands,
        answer: Answer::Format {
            resolution: resolution.map(str::to_string),
            frame_rate: frame_rate.map(str::to_string),
            old_resolution,
            old_frame_rate,
        },
    })
}

/// `cameras.look.set { camera, dynamicRange?, displayLut?, displayLutOn?,
/// confirm }`: the picture profile and the display LUT.
fn look_plan(cameras: &mut Cameras, params: &Value) -> Result<Plan, CameraError> {
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
        if let Some(sentence) = model.read_only(setting).filter(|_| given) {
            return Err(not_allowed(sentence));
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
    Ok(Plan {
        camera,
        commands,
        answer: Answer::Look {
            dynamic_range: dynamic_range.is_some(),
            display_lut: display_lut.is_some(),
            display_lut_on: display_lut_on.is_some(),
            before,
        },
    })
}

// ---------------------------------------------------------------------------
// The record (CAM 1, whichever camera is selected; D14)
// ---------------------------------------------------------------------------

/// `cameras.record.start` (one press) and `cameras.record.stop { confirm }`
/// (armed).
pub(super) fn record_plan(
    cameras: &mut Cameras,
    params: &Value,
    start: bool,
) -> Result<Plan, CameraError> {
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
    Ok(Plan {
        camera,
        commands: vec![command],
        answer: Answer::Record { start },
    })
}

// ---------------------------------------------------------------------------
// Release and Connect (D13)
// ---------------------------------------------------------------------------

/// `cameras.release { camera, confirm }`: lets the camera go, to nobody
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

/// `cameras.setup.pair { camera: 1, pin? }` (D15 rule 2; two steps since
/// 2026-10-06). Without `pin` a pairing begins, and one that runs starts
/// over: the link looks for the camera and Windows begins to pair, so the
/// camera shows a 6-digit PIN. With `pin` it hands that PIN over
/// (`CAMERA_PAIRING_NOT_WANTED` when no pairing waits for one). A step
/// raises `cameras.changed { reason: "pairing" }`; a pairing that succeeds
/// saves CAM 1's pairing and its Bluetooth address and holds it (`setup`).
/// The simulated camera shows its PIN at once and pairs at its own,
/// `123456`. In a build with no link to it, `CAMERA_NO_LINK`.
fn setup_pair_request(
    cameras: &mut Cameras,
    bodies: &SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    if camera != RECORDING_CAMERA {
        return Err(CameraError::Invalid(String::from(
            "Only CAM 1 is paired; CAM 2 and CAM 3 take an address.",
        )));
    }
    let pin_refused =
        || CameraError::Invalid(String::from("pin must be the 6 digits CAM 1 shows."));
    let pin = match params.get("pin") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(parse_pin(text).ok_or_else(pin_refused)?),
        Some(_) => return Err(pin_refused()),
    };
    if !cameras.camera(camera).has_link {
        return Err(CameraError::Refused(
            "CAMERA_NO_LINK",
            model(camera).no_link_refusal(),
        ));
    }
    let reason = match pin {
        None => {
            cameras.begin_pairing();
            "pairing"
        }
        Some(pin) => cameras.give_pin(pin, bodies, now)?.ok_or_else(|| {
            CameraError::Refused("CAMERA_PAIRING_NOT_WANTED", String::from(NOT_WANTED))
        })?,
    };
    Ok((
        json!({ "camera": camera, "setup": cameras.camera(camera).setup_summary() }),
        Some((reason, Some(camera))),
    ))
}

/// `cameras.setup.forget { camera }`: takes the address or the pairing away
/// (the vMix input stays), and stops CAM 1's pairing if one runs; the
/// camera is not set up again. Windows' own pairing stays: the next
/// pairing makes it afresh.
fn setup_forget_request(
    db_path: &Path,
    cameras: &mut Cameras,
    bodies: &SimulatedCameras,
    params: &Value,
    now: SystemTime,
) -> Handled {
    let camera = camera_param(params)?;
    if camera == RECORDING_CAMERA {
        cameras.cancel_pairing();
    }
    let mut setup = cameras.camera(camera).setup.clone();
    setup.address = None;
    setup.paired = false;
    save_setup(db_path, cameras, bodies, setup, now, true)
}
