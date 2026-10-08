//! Blackmagic's SDI camera control protocol as the Pocket speaks it over
//! Bluetooth: the messages the camera notifies (read into a `CameraReading`)
//! and the messages a press sends (written from a `CameraCommand`). Read on
//! the web on 2026-10-06 from Blackmagic's Developer Information, and tried
//! on the camera in the attended run of 2026-10-07: what it reports is in
//! `docs/HARDWARE.md` (Cameras) and `docs/ROADMAP.md` (the Pocket's part).
//!
//! A message is a four-byte header — the destination (255, every camera),
//! the length of what follows without padding, the command (0, change a
//! setting) and a reserved byte — then the command: a category, a parameter,
//! a data type, an operation, and the data; the whole padded with zeros to a
//! multiple of four bytes, 64 bytes at most. The data types: 0 a void or a
//! boolean, 1 int8, 2 int16, 3 int32, 4 int64, 5 a UTF-8 string, 128 a 5.11
//! fixed-point number (the value × 2048). The operation: 0 assign, 1 offset
//! (the data added to the value the camera holds, says the protocol; the
//! Pocket took an offset of zero to its shutter angle and its aperture as an
//! assignment of zero, 2026-10-08, so none is ever sent); the camera's own
//! reports carry 2.
//!
//! The parameters CAM 1 reports and takes here: focus 0.0 (0.0 near to 1.0
//! far) and the autofocus 0.1; the aperture 0.2 as an aperture value (the
//! f-number is √2^AV) and the auto aperture 0.5; white balance and tint 1.2
//! and the auto white balance 1.3; the dynamic range 1.7; the recording
//! format 1.9 (`format.rs`); the shutter angle 1.11 (degrees × 100), or the
//! shutter speed 1.12 (1/x) when the camera shows speeds; ISO 1.14; the
//! display LUT 1.15 (which one, and whether it is on); the ND filter 1.16
//! (stops); and the transport mode 10.1, whose first byte is 2 while the
//! camera records. Everything else the camera sends is read past.

use crate::cameras::model::{AutoKind, Setting};
use crate::cameras::pocket::format::RecordingFormat;
use crate::cameras::simulated::{CameraCommand, CameraReading, CameraValue};

/// The largest message the camera takes.
pub(crate) const MAX_MESSAGE: usize = 64;
/// Every camera on the link.
const BROADCAST: u8 = 255;
/// The one command: change a setting.
const COMMAND_CHANGE: u8 = 0;
const HEADER: usize = 4;
const COMMAND_HEAD: usize = 4;

/// The data types' codes.
pub(crate) const TYPE_VOID: u8 = 0;
pub(crate) const TYPE_INT8: u8 = 1;
pub(crate) const TYPE_INT16: u8 = 2;
pub(crate) const TYPE_INT32: u8 = 3;
pub(crate) const TYPE_INT64: u8 = 4;
pub(crate) const TYPE_UTF8: u8 = 5;
pub(crate) const TYPE_FIXED16: u8 = 128;

/// The operations.
pub(crate) const OPERATION_ASSIGN: u8 = 0;
pub(crate) const OPERATION_OFFSET: u8 = 1;

/// A parameter: its category and its number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Parameter(pub u8, pub u8);

pub(crate) const LENS_FOCUS: Parameter = Parameter(0, 0);
pub(crate) const LENS_AUTOFOCUS: Parameter = Parameter(0, 1);
pub(crate) const LENS_APERTURE_VALUE: Parameter = Parameter(0, 2);
pub(crate) const LENS_AUTO_APERTURE: Parameter = Parameter(0, 5);
pub(crate) const VIDEO_WHITE_BALANCE: Parameter = Parameter(1, 2);
pub(crate) const VIDEO_AUTO_WHITE_BALANCE: Parameter = Parameter(1, 3);
pub(crate) const VIDEO_DYNAMIC_RANGE: Parameter = Parameter(1, 7);
pub(crate) const VIDEO_RECORDING_FORMAT: Parameter = Parameter(1, 9);
pub(crate) const VIDEO_SHUTTER_ANGLE: Parameter = Parameter(1, 11);
pub(crate) const VIDEO_SHUTTER_SPEED: Parameter = Parameter(1, 12);
pub(crate) const VIDEO_ISO: Parameter = Parameter(1, 14);
pub(crate) const VIDEO_DISPLAY_LUT: Parameter = Parameter(1, 15);
pub(crate) const VIDEO_ND_FILTER: Parameter = Parameter(1, 16);
pub(crate) const MEDIA_TRANSPORT_MODE: Parameter = Parameter(10, 1);

/// The transport mode's first byte while the camera records.
const TRANSPORT_RECORD: i8 = 2;
/// … and while it does not: preview.
const TRANSPORT_PREVIEW: i8 = 0;

/// The dynamic ranges, by the protocol's number and the model's word.
const DYNAMIC_RANGES: [(i8, &str); 3] = [(0, "Film"), (1, "Video"), (2, "Extended video")];
/// The display LUTs, by the protocol's number and the model's word.
const DISPLAY_LUTS: [(i8, &str); 4] = [
    (0, "None"),
    (1, "Custom"),
    (2, "Film → Video"),
    (3, "Film → Ext. video"),
];

/// One message, framed or to be framed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Message {
    pub parameter: Parameter,
    pub data_type: u8,
    pub operation: u8,
    pub data: Vec<u8>,
}

impl Message {
    fn assign(parameter: Parameter, data_type: u8, data: Vec<u8>) -> Self {
        Self {
            parameter,
            data_type,
            operation: OPERATION_ASSIGN,
            data,
        }
    }

    fn void(parameter: Parameter) -> Self {
        Self::assign(parameter, TYPE_VOID, Vec::new())
    }

    fn int8(parameter: Parameter, values: &[i8]) -> Self {
        Self::assign(
            parameter,
            TYPE_INT8,
            values.iter().map(|value| *value as u8).collect(),
        )
    }

    fn int16(parameter: Parameter, values: &[i16]) -> Self {
        Self::assign(
            parameter,
            TYPE_INT16,
            values
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect(),
        )
    }

    fn int32(parameter: Parameter, value: i32) -> Self {
        Self::assign(parameter, TYPE_INT32, value.to_le_bytes().to_vec())
    }

    fn fixed16(parameter: Parameter, values: &[f64]) -> Self {
        Self::assign(
            parameter,
            TYPE_FIXED16,
            values
                .iter()
                .flat_map(|value| fixed16_from(*value).to_le_bytes())
                .collect(),
        )
    }

    /// The message's bytes as the camera takes them: the header, the
    /// command and its data, padded to four bytes. `Err` when the data is
    /// too long for one message.
    pub(crate) fn encode(&self) -> Result<Vec<u8>, String> {
        let length = COMMAND_HEAD + self.data.len();
        if length > usize::from(u8::MAX) || HEADER + length > MAX_MESSAGE {
            return Err(format!(
                "A camera message holds at most {} bytes of data; this one has {}.",
                MAX_MESSAGE - HEADER - COMMAND_HEAD,
                self.data.len()
            ));
        }
        let mut bytes = Vec::with_capacity(HEADER + length + 3);
        bytes.extend_from_slice(&[BROADCAST, length as u8, COMMAND_CHANGE, 0]);
        bytes.extend_from_slice(&[
            self.parameter.0,
            self.parameter.1,
            self.data_type,
            self.operation,
        ]);
        bytes.extend_from_slice(&self.data);
        while bytes.len() % 4 != 0 {
            bytes.push(0);
        }
        Ok(bytes)
    }

    /// Every message in `bytes`, as the camera framed them one after
    /// another. A header that does not fit, a length past the end or a
    /// command that is not a change stops or skips the reading without a
    /// panic: the bytes come from outside, and what cannot be read is read
    /// past.
    pub(crate) fn decode_all(bytes: &[u8]) -> Vec<Self> {
        let mut messages = Vec::new();
        let mut at = 0;
        while at + HEADER <= bytes.len() {
            let length = usize::from(bytes[at + 1]);
            let command = bytes[at + 2];
            let body = at + HEADER;
            let Some(end) = body.checked_add(length).filter(|end| *end <= bytes.len()) else {
                break;
            };
            if command == COMMAND_CHANGE && length >= COMMAND_HEAD {
                messages.push(Self {
                    parameter: Parameter(bytes[body], bytes[body + 1]),
                    data_type: bytes[body + 2],
                    operation: bytes[body + 3],
                    data: bytes[body + COMMAND_HEAD..end].to_vec(),
                });
            }
            // The padding to the next multiple of four, then the next header.
            at = end.div_ceil(4) * 4;
        }
        messages
    }

    fn int8s(&self) -> Vec<i8> {
        self.data.iter().map(|byte| *byte as i8).collect()
    }

    fn int16s(&self) -> Vec<i16> {
        self.data
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect()
    }

    fn int32_value(&self) -> Option<i32> {
        <[u8; 4]>::try_from(self.data.get(..4)?)
            .ok()
            .map(i32::from_le_bytes)
    }

    fn fixed16s(&self) -> Vec<f64> {
        self.int16s().into_iter().map(fixed16_to).collect()
    }
}

/// A number as the protocol's 5.11 fixed point: the value × 2048, rounded
/// and held within the type.
pub(crate) fn fixed16_from(value: f64) -> i16 {
    (value * 2048.0)
        .round()
        .clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16
}

pub(crate) fn fixed16_to(raw: i16) -> f64 {
    f64::from(raw) / 2048.0
}

/// A value rounded to `decimals`, so a number read from the camera prints
/// as the camera would say it.
fn rounded(value: f64, decimals: i32) -> f64 {
    let factor = 10f64.powi(decimals);
    (value * factor).round() / factor
}

// ---------------------------------------------------------------------------
// What the camera reports
// ---------------------------------------------------------------------------

/// The conventional f-numbers, whose names round the exact values (√32 is
/// written f/5.6). An aperture value within 3 % of one prints its name;
/// any other prints with one decimal.
const F_NUMBERS: [f64; 28] = [
    1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8, 3.2, 3.5, 4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0,
    9.0, 10.0, 11.0, 13.0, 14.0, 16.0, 18.0, 20.0, 22.0,
];

/// `f/2.8`, `f/4.0`, `f/16` from an aperture value.
pub(crate) fn f_number_text(aperture_value: f64) -> String {
    let exact = 2f64.powf(aperture_value / 2.0);
    let named = F_NUMBERS
        .iter()
        .copied()
        .min_by(|a, b| {
            (a - exact)
                .abs()
                .partial_cmp(&(b - exact).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .filter(|name| ((name - exact) / exact).abs() <= 0.03)
        .unwrap_or_else(|| rounded(exact, 1));
    f_number_word(named)
}

fn f_number_word(f_number: f64) -> String {
    if f_number >= 10.0 {
        format!("f/{}", f_number.round() as i64)
    } else {
        format!("f/{f_number:.1}")
    }
}

/// The aperture value of an f-number's word (`f/2.8`); `None` for a word
/// that is no f-number.
pub(crate) fn aperture_value_of(word: &str) -> Option<f64> {
    let number: f64 = word.trim().strip_prefix("f/")?.trim().parse().ok()?;
    (number > 0.0).then(|| 2.0 * number.log2())
}

/// `180°`, `172.8°` from the angle × 100.
fn shutter_angle_text(hundredths: i32) -> String {
    let degrees = f64::from(hundredths) / 100.0;
    if (degrees - degrees.round()).abs() < 1e-9 {
        format!("{}°", degrees.round() as i64)
    } else {
        format!("{}°", rounded(degrees, 2))
    }
}

/// The angle × 100 of a shutter word (`172.8°`); `None` for a word that is
/// no angle (`1/50` is a speed).
fn shutter_angle_of(word: &str) -> Option<i32> {
    let degrees: f64 = word.trim().strip_suffix('°')?.trim().parse().ok()?;
    (degrees > 0.0).then(|| (degrees * 100.0).round() as i32)
}

/// `Clear`, `2 stops` from the filter's stops.
fn nd_text(stops: f64) -> String {
    let stops = rounded(stops, 1);
    if stops <= 0.0 {
        String::from("Clear")
    } else if (stops - stops.round()).abs() < 1e-9 {
        format!("{} stops", stops.round() as i64)
    } else {
        format!("{stops} stops")
    }
}

/// The stops of an ND word; `None` for a word that is none.
fn nd_of(word: &str) -> Option<f64> {
    let word = word.trim();
    if word.eq_ignore_ascii_case("clear") {
        return Some(0.0);
    }
    word.strip_suffix("stops")
        .or_else(|| word.strip_suffix("stop"))?
        .trim()
        .parse()
        .ok()
}

fn dynamic_range_text(code: i8) -> Option<&'static str> {
    DYNAMIC_RANGES
        .iter()
        .find(|(number, _)| *number == code)
        .map(|(_, word)| *word)
}

fn dynamic_range_of(word: &str) -> Option<i8> {
    DYNAMIC_RANGES
        .iter()
        .find(|(_, name)| *name == word.trim())
        .map(|(number, _)| *number)
}

fn display_lut_text(code: i8) -> Option<&'static str> {
    DISPLAY_LUTS
        .iter()
        .find(|(number, _)| *number == code)
        .map(|(_, word)| *word)
}

fn display_lut_of(word: &str) -> Option<i8> {
    DISPLAY_LUTS
        .iter()
        .find(|(_, name)| *name == word.trim())
        .map(|(number, _)| *number)
}

/// Reads one of the camera's messages into the reading: what it says of a
/// setting the model knows replaces what the reading held. `true` when the
/// message was one of them; anything else is read past, and a value that
/// cannot be read leaves the reading as it was.
pub(crate) fn apply(reading: &mut CameraReading, message: &Message) -> bool {
    // An offset is a change to a value, never the value itself: it is not
    // read (nothing sends one; the camera's reports carry their own
    // operation code, 2, and are read).
    if message.operation == OPERATION_OFFSET {
        return false;
    }
    match (message.parameter, message.data_type) {
        (LENS_FOCUS, TYPE_FIXED16) => {
            if let Some(position) = message.fixed16s().first() {
                reading.focus = Some(rounded(position.clamp(0.0, 1.0), 2));
            }
        }
        (LENS_APERTURE_VALUE, TYPE_FIXED16) => {
            if let Some(aperture_value) = message.fixed16s().first() {
                reading.iris = Some(f_number_text(*aperture_value));
            }
        }
        (VIDEO_WHITE_BALANCE, TYPE_INT16) => {
            let values = message.int16s();
            if let Some(kelvin) = values.first() {
                reading.white_balance = Some(f64::from(*kelvin));
            }
            if let Some(tint) = values.get(1) {
                reading.tint = Some(f64::from(*tint));
            }
        }
        (VIDEO_DYNAMIC_RANGE, TYPE_INT8) => {
            if let Some(word) = message
                .int8s()
                .first()
                .and_then(|code| dynamic_range_text(*code))
            {
                reading.dynamic_range = Some(String::from(word));
            }
        }
        (VIDEO_RECORDING_FORMAT, TYPE_INT16) => {
            if let Some(format) = RecordingFormat::from_values(&message.int16s()) {
                reading.resolution = Some(format.resolution());
                reading.frame_rate = Some(format.frame_rate());
            }
        }
        (VIDEO_SHUTTER_ANGLE, TYPE_INT32) => {
            if let Some(hundredths) = message.int32_value().filter(|value| *value > 0) {
                reading.shutter = Some(shutter_angle_text(hundredths));
            }
        }
        (VIDEO_SHUTTER_SPEED, TYPE_INT32) => {
            // The angle is the model's word; a speed stands in only while
            // no angle has been read.
            if let Some(speed) = message.int32_value().filter(|value| *value > 0) {
                let angle_known = reading
                    .shutter
                    .as_deref()
                    .is_some_and(|shutter| shutter.ends_with('°'));
                if !angle_known {
                    reading.shutter = Some(format!("1/{speed}"));
                }
            }
        }
        (VIDEO_ISO, TYPE_INT32) => {
            if let Some(iso) = message.int32_value().filter(|value| *value > 0) {
                reading.iso = Some(iso.to_string());
            }
        }
        (VIDEO_DISPLAY_LUT, TYPE_INT8) => {
            let values = message.int8s();
            if let Some(word) = values.first().and_then(|code| display_lut_text(*code)) {
                reading.display_lut = Some(String::from(word));
            }
            if let Some(enabled) = values.get(1) {
                reading.display_lut_on = Some(*enabled != 0);
            }
        }
        (VIDEO_ND_FILTER, TYPE_FIXED16) => {
            if let Some(stops) = message.fixed16s().first() {
                reading.nd = Some(nd_text(*stops));
            }
        }
        (MEDIA_TRANSPORT_MODE, TYPE_INT8) => {
            if let Some(mode) = message.int8s().first() {
                reading.recording = Some(*mode == TRANSPORT_RECORD);
            }
        }
        _ => return false,
    }
    true
}

// ---------------------------------------------------------------------------
// What a press sends
// ---------------------------------------------------------------------------

/// The messages that carry the operator's presses to the camera, each
/// framed, in order. A message that sets part of a parameter (the tint
/// beside the white balance, the display LUT's switch beside its choice, one
/// half of the recording format) carries the other part as the camera last
/// reported it, and a press of several commands folds each into what the
/// next carries. `Err` for a command the Pocket does not take, or a value
/// the protocol cannot carry; nothing is sent then.
pub(crate) fn encode_commands(
    commands: &[CameraCommand],
    current: &CameraReading,
) -> Result<Vec<Vec<u8>>, String> {
    let mut working = current.clone();
    let mut messages = Vec::with_capacity(commands.len());
    for command in commands {
        let message = message_for(command, &working)?;
        messages.push(message.encode()?);
        apply(&mut working, &message);
    }
    Ok(messages)
}

fn message_for(command: &CameraCommand, current: &CameraReading) -> Result<Message, String> {
    match command {
        CameraCommand::RecordStart => Ok(Message::int8(MEDIA_TRANSPORT_MODE, &[TRANSPORT_RECORD])),
        CameraCommand::RecordStop => Ok(Message::int8(MEDIA_TRANSPORT_MODE, &[TRANSPORT_PREVIEW])),
        CameraCommand::Auto(AutoKind::Focus) => Ok(Message::void(LENS_AUTOFOCUS)),
        CameraCommand::Auto(AutoKind::Iris) => Ok(Message::void(LENS_AUTO_APERTURE)),
        CameraCommand::Auto(AutoKind::WhiteBalance) => Ok(Message::void(VIDEO_AUTO_WHITE_BALANCE)),
        CameraCommand::FocusSteps(_) => Err(String::from(
            "CAM 1's focus is a position, not a step: the Pocket takes no focus step.",
        )),
        CameraCommand::Set(setting, value) => set_message(*setting, value, current),
    }
}

fn cannot_carry(setting: Setting, value: &CameraValue) -> String {
    format!(
        "The Pocket's protocol cannot carry {} {}.",
        setting.label(),
        match value {
            CameraValue::Text(text) => text.clone(),
            CameraValue::Number(number) => number.to_string(),
            CameraValue::Switch(on) => String::from(if *on { "on" } else { "off" }),
        }
    )
}

/// A press that sets half a parameter needs the other half as the camera
/// reported it, never a guess (D12): until the camera has reported it, the
/// press is refused with this sentence.
fn not_yet(what: &str, press: &str) -> String {
    format!("CAM 1 has not reported {what} yet, so {press} cannot be sent with it.")
}

fn set_message(
    setting: Setting,
    value: &CameraValue,
    current: &CameraReading,
) -> Result<Message, String> {
    let refused = || cannot_carry(setting, value);
    match (setting, value) {
        (Setting::Iso, CameraValue::Text(text)) => {
            let iso: i32 = text
                .trim()
                .parse()
                .ok()
                .filter(|iso| *iso > 0)
                .ok_or_else(refused)?;
            Ok(Message::int32(VIDEO_ISO, iso))
        }
        (Setting::Shutter, CameraValue::Text(text)) => {
            if let Some(hundredths) = shutter_angle_of(text) {
                return Ok(Message::int32(VIDEO_SHUTTER_ANGLE, hundredths));
            }
            let speed: i32 = text
                .trim()
                .strip_prefix("1/")
                .and_then(|speed| speed.trim().parse().ok())
                .filter(|speed| *speed > 0)
                .ok_or_else(refused)?;
            Ok(Message::int32(VIDEO_SHUTTER_SPEED, speed))
        }
        (Setting::Iris, CameraValue::Text(text)) => {
            let aperture_value = aperture_value_of(text).ok_or_else(refused)?;
            Ok(Message::fixed16(LENS_APERTURE_VALUE, &[aperture_value]))
        }
        (Setting::Nd, CameraValue::Text(text)) => {
            let stops = nd_of(text).ok_or_else(refused)?;
            Ok(Message::fixed16(VIDEO_ND_FILTER, &[stops]))
        }
        (Setting::WhiteBalance, CameraValue::Number(kelvin)) => {
            let tint = current
                .tint
                .ok_or_else(|| not_yet("its tint", "a white balance"))?;
            Ok(Message::int16(
                VIDEO_WHITE_BALANCE,
                &[
                    int16_of(*kelvin).ok_or_else(refused)?,
                    int16_of(tint).ok_or_else(refused)?,
                ],
            ))
        }
        (Setting::Tint, CameraValue::Number(tint)) => {
            let kelvin = current
                .white_balance
                .ok_or_else(|| not_yet("its white balance", "a tint"))?;
            Ok(Message::int16(
                VIDEO_WHITE_BALANCE,
                &[
                    int16_of(kelvin).ok_or_else(refused)?,
                    int16_of(*tint).ok_or_else(refused)?,
                ],
            ))
        }
        (Setting::Focus, CameraValue::Number(position)) => {
            if !(0.0..=1.0).contains(position) {
                return Err(refused());
            }
            Ok(Message::fixed16(LENS_FOCUS, &[*position]))
        }
        (Setting::Resolution, CameraValue::Text(word)) => {
            let format = current_format(current)
                .ok_or_else(|| not_yet("its recording format", "a resolution"))?
                .with_resolution(word)
                .ok_or_else(refused)?;
            Ok(Message::int16(VIDEO_RECORDING_FORMAT, &format.to_values()))
        }
        (Setting::FrameRate, CameraValue::Text(word)) => {
            let format = current_format(current)
                .ok_or_else(|| not_yet("its recording format", "a frame rate"))?
                .with_frame_rate(word)
                .ok_or_else(refused)?;
            Ok(Message::int16(VIDEO_RECORDING_FORMAT, &format.to_values()))
        }
        (Setting::DynamicRange, CameraValue::Text(word)) => {
            let code = dynamic_range_of(word).ok_or_else(refused)?;
            Ok(Message::int8(VIDEO_DYNAMIC_RANGE, &[code]))
        }
        (Setting::DisplayLut, CameraValue::Text(word)) => {
            let code = display_lut_of(word).ok_or_else(refused)?;
            let enabled = current
                .display_lut_on
                .ok_or_else(|| not_yet("whether its display LUT is on", "a display LUT"))?;
            Ok(Message::int8(VIDEO_DISPLAY_LUT, &[code, i8::from(enabled)]))
        }
        (Setting::DisplayLutOn, CameraValue::Switch(on)) => {
            let code = current
                .display_lut
                .as_deref()
                .and_then(display_lut_of)
                .ok_or_else(|| not_yet("its display LUT", "the switch"))?;
            Ok(Message::int8(VIDEO_DISPLAY_LUT, &[code, i8::from(*on)]))
        }
        _ => Err(refused()),
    }
}

fn int16_of(value: f64) -> Option<i16> {
    let rounded = value.round();
    (f64::from(i16::MIN)..=f64::from(i16::MAX))
        .contains(&rounded)
        .then_some(rounded as i16)
}

/// The recording format as the camera last reported it, from the reading's
/// words; `None` until the camera has reported both its resolution and its
/// frame rate (never a guess, D12).
fn current_format(current: &CameraReading) -> Option<RecordingFormat> {
    let format = RecordingFormat::default()
        .with_resolution(current.resolution.as_deref()?)?
        .with_frame_rate(current.frame_rate.as_deref()?)?;
    Some(format)
}
