//! The Stream Deck's CAMERAS page in the hardware link (D14): what its keys
//! and dials do, and what its displays say. The bridge (`control_surface`)
//! hands a key over and asks for the displays; everything is decided here,
//! under the cameras' lock, through the functions the screen's requests run,
//! so the deck and the screen cannot disagree about what a press does.
//!
//! - `CAM 1`–`CAM 3` select the camera the dials, the plate and the big
//!   picture follow (D19): the page's selection.
//! - `BANK` puts the dials on exposure, colour or focus, in turn.
//! - A dial's detent is one of the camera's own steps on the selected
//!   camera; a push of the focus dial is a one-shot autofocus where the lens
//!   allows. A dial with nothing to set in the bank is refused, and says so.
//! - `REC` acts on CAM 1 whichever camera is selected. One press starts.
//!   While CAM 1 records, a press arms the stop and the key reads `STOP?`;
//!   a second press within 3 s stops. Nothing but these two starts or stops
//!   a take (`rec`): a press sooner than the dwell after the one before is
//!   the same press again, an arm stops the take it was made for and no
//!   other, and a press starts no take while the key can read `STOP?`.
//!
//! A display never reads a camera by itself. The cameras are read once for
//! all the displays of a poll, as the open page reads them once a second,
//! and once for a key, whose own read answers its displays
//! (`control_surface_pages`).

use crate::cameras::commands::{
    auto_request, held, reading, record_request, select_request, set_bank, step_request, Handled,
};
use crate::cameras::model::{model, Setting, RECORDING_CAMERA};
use crate::cameras::runtime::{with_cameras, Cameras, StopArm};
use crate::cameras::simulated::{CameraReading, SimulatedCameras};
use crate::cameras::snapshot::CameraState;
use crate::cameras::{CameraError, CamerasReply};
use serde_json::{json, Value};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

/// The deck's armed stop (D14): `STOP?` for 3 s.
pub(crate) const STOP_ARM_WINDOW: Duration = Duration::from_secs(3);
/// A press sooner than this after the one that armed the stop, started a
/// take or stopped one is the same press again, and changes nothing: the
/// dwell of every armed key on the screen.
pub(crate) const STOP_ARM_DWELL: Duration = Duration::from_millis(350);

/// The longest the key can read `STOP?` after the press that armed it: the
/// 3 s, and the time its display takes to follow (the deck polls once a
/// second, and a page's texts are kept for 250 ms). For as long, a press
/// starts no take.
pub(crate) const STOP_SHOWN_FOR: Duration = Duration::from_millis(4_250);

/// What the page's displays say, by their LCD keys.
pub(crate) type DeckTexts = Vec<(&'static str, String)>;

/// The displays of the CAMERAS page, by their LCD keys: the three camera
/// keys, `BANK` and `REC`, the four touch-strip cells, and the three words
/// the keys' colours follow.
pub(crate) const CAMERA_LCD_KEYS: [&str; 12] = [
    "camera_key_1",
    "camera_key_2",
    "camera_key_3",
    "camera_key_bank",
    "camera_key_rec",
    "camera_strip_1",
    "camera_strip_2",
    "camera_strip_3",
    "camera_strip_4",
    "camera_state_selected",
    "camera_state_rec",
    "camera_state_dials",
];

/// A dial with nothing to set, or a push that does nothing: refused with the
/// reason, and nothing reaches a camera.
const DIAL_UNUSED: &str = "CAMERA_DIAL_UNUSED";

fn invalid(message: &str) -> CameraError {
    CameraError::Invalid(String::from(message))
}

/// `1`–`4`: one of the deck's dials.
fn dial_number(text: &str) -> Result<usize, CameraError> {
    match text {
        "1" => Ok(1),
        "2" => Ok(2),
        "3" => Ok(3),
        "4" => Ok(4),
        _ => Err(invalid("A dial is 1, 2, 3 or 4.")),
    }
}

/// One key or dial of the CAMERAS page, now (the tests' short form).
#[cfg(test)]
pub(crate) fn handle_deck_action(
    db_path: &Path,
    simulated: bool,
    action: &str,
    value: Option<&str>,
) -> Result<(CamerasReply, DeckTexts), CameraError> {
    handle_deck_action_at(db_path, simulated, action, value, Instant::now())
}

/// One key or dial of the CAMERAS page, pressed at `at`, and what the page's
/// displays say after it: the key's own read of the cameras answers them.
/// `action` and `value` are the profile's: `select` with `1`–`3`, `bank`,
/// `dial` with `2:up` or `2:down`, `dialPush` with `1`–`4`, and `rec`, which
/// counts its dwell and its 3 s from `at`.
pub(crate) fn handle_deck_action_at(
    db_path: &Path,
    simulated: bool,
    action: &str,
    value: Option<&str>,
    at: Instant,
) -> Result<(CamerasReply, DeckTexts), CameraError> {
    with_cameras(db_path, simulated, |cameras, bodies, now| {
        let before = cameras.health_check();
        let (result, event) = match action {
            "select" => {
                let camera = value
                    .and_then(|value| value.parse::<u8>().ok())
                    .ok_or_else(|| invalid("select needs the camera: 1, 2 or 3."))?;
                select_request(cameras, &json!({ "camera": camera }))?
            }
            "bank" => set_bank(cameras, cameras.bank.next()),
            "dial" => {
                let (dial, direction) = value
                    .and_then(|value| value.split_once(':'))
                    .ok_or_else(|| invalid("dial needs the dial and the way: 2:up or 2:down."))?;
                let dial = dial_number(dial)?;
                let step = match direction {
                    "up" => 1,
                    "down" => -1,
                    _ => return Err(invalid("A dial turns up or down.")),
                };
                let setting = dial_setting(cameras, dial)?;
                step_request(
                    cameras,
                    bodies,
                    &json!({ "camera": cameras.selected, "setting": setting.key(), "step": step }),
                    now,
                )?
            }
            "dialPush" => {
                let dial =
                    dial_number(value.ok_or_else(|| invalid("dialPush needs the dial: 1 to 4."))?)?;
                if dial_setting(cameras, dial).ok() != Some(Setting::Focus) {
                    return Err(CameraError::Refused(
                        DIAL_UNUSED,
                        format!(
                            "A push of dial {dial} does nothing while the dials set the {}.",
                            cameras.bank.key()
                        ),
                    ));
                }
                auto_request(
                    cameras,
                    bodies,
                    &json!({ "camera": cameras.selected, "what": "focus" }),
                    now,
                )?
            }
            "rec" => rec(cameras, bodies, now, at)?,
            other => {
                return Err(CameraError::Invalid(format!(
                    "Unsupported CAMERAS key: {other}"
                )))
            }
        };
        let reply = CamerasReply {
            result,
            event,
            health_changed: cameras.health_check() != before,
        };
        Ok((reply, texts(cameras, at, now)))
    })
}

/// What dial `dial` sets in the bank the dials are on.
fn dial_setting(cameras: &Cameras, dial: usize) -> Result<Setting, CameraError> {
    cameras.bank.dials()[dial - 1].ok_or_else(|| {
        CameraError::Refused(
            DIAL_UNUSED,
            format!(
                "Dial {dial} sets nothing while the dials set the {}.",
                cameras.bank.key()
            ),
        )
    })
}

/// Whether the deck's stop is armed at `at`: armed for the take that runs,
/// and the 3 s not over.
fn stop_armed(cameras: &Cameras, at: Instant) -> bool {
    cameras.stop_arm.is_some_and(|arm| {
        at.saturating_duration_since(arm.at) <= STOP_ARM_WINDOW && arm.take == cameras.take_changes
    })
}

/// The deck's `REC` (D14). The answer's `did` says what the press did:
/// `started`, `armed`, `stopped`, or `kept` for a press that sent nothing
/// and changed no take.
///
/// A take is started by one press and stopped by two, and by nothing else:
///
/// - A press sooner than the dwell after the deck's `REC` started or stopped
///   a take is the same press again. Without this the second of a double
///   press would arm the stop of the take the first began, or begin a take
///   after the one the first ended.
/// - A press within the 3 s of an armed stop is the stop's second press. It
///   stops the take the arm was made for, and no other: when that take is
///   over, or may be (the screen stopped it, it ended on the camera itself,
///   another began, CAM 1 did not answer for a while), the press ends the
///   arm and sends nothing.
/// - For as long as the key can still read `STOP?` a press starts no take.
///
/// The deck's own stop ends the arm, so that one press after the dwell
/// starts the next take (D11).
fn rec(
    cameras: &mut Cameras,
    bodies: &mut SimulatedCameras,
    now: SystemTime,
    at: Instant,
) -> Handled {
    let camera = RECORDING_CAMERA;
    held(cameras, camera)?;
    let recording = reading(cameras, camera).recording == Some(true);
    let kept = |recording: bool| -> Handled {
        Ok((
            json!({ "camera": camera, "recording": recording, "did": "kept" }),
            None,
        ))
    };
    let did = |did: &str, (mut result, event): (Value, Option<(&'static str, Option<u8>)>)| {
        if let Some(result) = result.as_object_mut() {
            result.insert(String::from("did"), json!(did));
        }
        (result, event)
    };

    if cameras
        .deck_rec_at
        .is_some_and(|acted| at.saturating_duration_since(acted) < STOP_ARM_DWELL)
    {
        return kept(recording);
    }
    if let Some(arm) = cameras.stop_arm {
        let since = at.saturating_duration_since(arm.at);
        let its_take_runs = recording && arm.take == cameras.take_changes;
        if since <= STOP_ARM_WINDOW {
            if !its_take_runs {
                cameras.stop_arm = None;
                return kept(recording);
            }
            if since < STOP_ARM_DWELL {
                return kept(true);
            }
            let stopped = record_request(cameras, bodies, &json!({ "confirm": true }), now, false)?;
            cameras.stop_arm = None;
            cameras.deck_rec_at = Some(at);
            return Ok(did("stopped", stopped));
        }
        if since <= STOP_SHOWN_FOR && !recording {
            cameras.stop_arm = None;
            return kept(false);
        }
    }
    if !recording {
        let started = record_request(cameras, bodies, &json!({}), now, true)?;
        cameras.deck_rec_at = Some(at);
        return Ok(did("started", started));
    }
    cameras.stop_arm = Some(StopArm {
        at,
        take: cameras.take_changes,
    });
    Ok((
        json!({ "camera": camera, "recording": true, "did": "armed" }),
        None,
    ))
}

// ---------------------------------------------------------------------------
// The displays
// ---------------------------------------------------------------------------

/// Every display of the CAMERAS page, now (the tests' short form).
#[cfg(test)]
pub(crate) fn deck_texts(db_path: &Path, simulated: bool) -> Result<DeckTexts, CameraError> {
    deck_texts_at(db_path, simulated, Instant::now())
}

/// Every display of the CAMERAS page at `at`. The cameras are read first,
/// once for all the displays (a read sends nothing): what a camera changed
/// itself is announced as any request would announce it.
pub(crate) fn deck_texts_at(
    db_path: &Path,
    simulated: bool,
    at: Instant,
) -> Result<DeckTexts, CameraError> {
    with_cameras(db_path, simulated, |cameras, _, now| {
        Ok(texts(cameras, at, now))
    })
}

/// A take's length as the page counts it (`formatTakeLength`): whole
/// seconds, `4:07`, `1:02:05`.
pub(crate) fn take_length_text(seconds: u64) -> String {
    let (hours, minutes, rest) = (seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{rest:02}")
    } else {
        format!("{minutes}:{rest:02}")
    }
}

/// `REC` (D14, D19; 2026-10-03): its word, and under it the take's length
/// while CAM 1 records, counted from the start the hardware link saw as the
/// page counts it (`--` for a take that began before it looked), `STOP?`
/// over the length while the stop is armed, and `LAST KNOWN` while CAM 1
/// does not answer mid-take. Nothing is asked of a camera for it.
fn rec_text(rec_state: &str, take: Option<String>) -> String {
    let take = take.unwrap_or_else(|| String::from("--"));
    match rec_state {
        "armed" => format!("STOP?\\n{take}"),
        "recording" => format!("REC\\n{take}"),
        "last-known" => String::from("REC\\nLAST KNOWN"),
        _ => String::from("REC"),
    }
}

fn texts(cameras: &Cameras, at: Instant, now: SystemTime) -> DeckTexts {
    let mut texts = Vec::with_capacity(CAMERA_LCD_KEYS.len());
    for (key, camera) in [
        ("camera_key_1", 1),
        ("camera_key_2", 2),
        ("camera_key_3", 3),
    ] {
        let runtime = cameras.camera(camera);
        texts.push((
            key,
            format!("{}\\n{}", model(camera).tag, runtime.state().word()),
        ));
    }
    texts.push((
        "camera_key_bank",
        format!("BANK\\n{}", cameras.bank.key().to_uppercase()),
    ));

    let main = cameras.camera(RECORDING_CAMERA);
    let recording = main.reading.as_ref().and_then(|reading| reading.recording) == Some(true);
    let rec_state = match main.state() {
        CameraState::Held if recording && stop_armed(cameras, at) => "armed",
        CameraState::Held if recording => "recording",
        CameraState::Held => "ready",
        CameraState::Unreachable if recording => "last-known",
        _ => "locked",
    };
    let take = main
        .started_at
        .filter(|_| recording)
        .and_then(|started| now.duration_since(started).ok())
        .map(|length| take_length_text(length.as_secs()));
    texts.push(("camera_key_rec", rec_text(rec_state, take)));

    let selected = cameras.camera(cameras.selected);
    let state = selected.state();
    let shown = matches!(state, CameraState::Held | CameraState::Unreachable);
    let empty = CameraReading::default();
    let reading = selected
        .reading
        .as_ref()
        .filter(|_| shown)
        .unwrap_or(&empty);
    let strips = [
        "camera_strip_1",
        "camera_strip_2",
        "camera_strip_3",
        "camera_strip_4",
    ];
    for (key, setting) in strips.into_iter().zip(cameras.bank.dials()) {
        texts.push((
            key,
            setting.map_or_else(String::new, |setting| {
                strip_text(cameras.selected, setting, reading, shown)
            }),
        ));
    }

    texts.push(("camera_state_selected", cameras.selected.to_string()));
    texts.push(("camera_state_rec", String::from(rec_state)));
    texts.push((
        "camera_state_dials",
        String::from(match state {
            CameraState::Held => "live",
            CameraState::Unreachable => "doubt",
            CameraState::Released | CameraState::NotSetUp => "locked",
        }),
    ));
    texts
}

/// A setting's word on the strip.
fn strip_label(setting: Setting) -> &'static str {
    match setting {
        Setting::Iso => "ISO",
        Setting::Shutter => "SHUTTER",
        Setting::Iris => "IRIS",
        Setting::Nd => "ND",
        Setting::WhiteBalance => "WB",
        Setting::Tint => "TINT",
        _ => "FOCUS",
    }
}

/// A number as the camera would say it: `5600`, `0.62`, never `5600.0`.
fn plain_number(value: f64) -> String {
    if value.fract().abs() < 1e-9 {
        format!("{}", value.round() as i64)
    } else {
        format!("{value}")
    }
}

/// A strip cell: the setting's word over what the camera reports, `--` for
/// what it does not report, and for a camera that is not read (`shown` is
/// false: released, or not set up).
fn strip_text(camera: u8, setting: Setting, reading: &CameraReading, shown: bool) -> String {
    let model = model(camera);
    let value = if !shown {
        None
    } else if setting == Setting::Focus && model.focus_steps() {
        // Nearer and farther, without a position to show.
        Some(String::from("NEAR · FAR"))
    } else if setting.is_level() {
        model.scale(setting).ok().and_then(|scale| {
            reading.number(setting).map(|value| {
                let number = if setting == Setting::Tint && value > 0.0 {
                    format!("+{}", plain_number(value))
                } else {
                    plain_number(value)
                };
                if scale.unit.is_empty() {
                    number
                } else {
                    format!("{number} {}", scale.unit)
                }
            })
        })
    } else {
        model
            .options(setting)
            .ok()
            .and_then(|_| reading.text(setting).map(String::from))
    };
    format!(
        "{}\\n{}",
        strip_label(setting),
        value.unwrap_or_else(|| String::from("--"))
    )
}
