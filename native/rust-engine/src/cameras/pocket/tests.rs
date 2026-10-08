//! The Pocket's protocol, pure: what a press sends, byte for byte, and what
//! the camera's messages read into a reading. Nothing here meets a camera;
//! the bytes are Blackmagic's Developer Information's, read on the web on
//! 2026-10-06, and the attended check settles what the camera does.

use crate::cameras::model::{AutoKind, Setting};
use crate::cameras::pocket::format::RecordingFormat;
use crate::cameras::pocket::protocol::{
    aperture_value_of, apply, encode_commands, f_number_text, fixed16_from, fixed16_to, Message,
    Parameter, LENS_AUTOFOCUS, LENS_FOCUS, MEDIA_TRANSPORT_MODE, OPERATION_ASSIGN,
    OPERATION_OFFSET, TYPE_FIXED16, TYPE_INT16, TYPE_INT32, TYPE_INT8, VIDEO_DISPLAY_LUT,
    VIDEO_DYNAMIC_RANGE, VIDEO_ISO, VIDEO_ND_FILTER, VIDEO_RECORDING_FORMAT, VIDEO_SHUTTER_ANGLE,
    VIDEO_SHUTTER_SPEED, VIDEO_WHITE_BALANCE,
};
use crate::cameras::pocket::timecode::timecode_text;
use crate::cameras::simulated::{CameraCommand, CameraReading, CameraValue, SimulatedCameras};
use proptest::prelude::*;

fn text(value: &str) -> CameraValue {
    CameraValue::Text(String::from(value))
}

fn set(setting: Setting, value: CameraValue) -> CameraCommand {
    CameraCommand::Set(setting, value)
}

/// Board 2's CAM 1, as the simulated camera reports it: the reading every
/// test starts from.
fn board() -> CameraReading {
    SimulatedCameras::default()
        .read(1)
        .expect("the simulated CAM 1 answers")
}

fn one(command: CameraCommand, current: &CameraReading) -> Vec<u8> {
    encode_commands(&[command], current)
        .expect("the command encodes")
        .remove(0)
}

fn message(parameter: Parameter, data_type: u8, data: &[u8]) -> Message {
    Message {
        parameter,
        data_type,
        operation: 0,
        data: data.to_vec(),
    }
}

fn int16s(values: &[i16]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn applied(messages: &[Message]) -> CameraReading {
    let mut reading = CameraReading::default();
    for message in messages {
        apply(&mut reading, message);
    }
    reading
}

// The frame: four bytes of header (every camera, the length without
// padding, the one command, a zero), the category, the parameter, the type
// and the operation, the data, and zeros to a multiple of four.
#[test]
fn a_message_is_framed_with_its_length_and_padded_to_four_bytes() {
    let current = board();
    assert_eq!(
        one(set(Setting::Iso, text("400")), &current),
        [255, 8, 0, 0, 1, 14, 3, 0, 0x90, 0x01, 0, 0],
        "ISO 400 as a little-endian int32"
    );
    assert_eq!(
        one(set(Setting::Nd, text("2 stops")), &current),
        [255, 6, 0, 0, 1, 16, 128, 0, 0x00, 0x10, 0, 0],
        "two stops as fixed16 (4096), the length 6 without the padding"
    );
    assert_eq!(
        one(CameraCommand::Auto(AutoKind::Focus), &current),
        [255, 4, 0, 0, 0, 1, 0, 0],
        "a void message has no data and no padding"
    );
    for command in [
        set(Setting::Iso, text("3200")),
        set(Setting::Shutter, text("172.8°")),
        set(Setting::Iris, text("f/5.6")),
        set(Setting::Nd, text("Clear")),
        set(Setting::WhiteBalance, CameraValue::Number(4300.0)),
        set(Setting::Tint, CameraValue::Number(-12.0)),
        set(Setting::Focus, CameraValue::Number(0.5)),
        set(Setting::Resolution, text("UHD")),
        set(Setting::FrameRate, text("29.97")),
        set(Setting::DynamicRange, text("Video")),
        set(Setting::DisplayLut, text("Custom")),
        set(Setting::DisplayLutOn, CameraValue::Switch(false)),
        CameraCommand::Auto(AutoKind::Iris),
        CameraCommand::Auto(AutoKind::WhiteBalance),
        CameraCommand::RecordStart,
        CameraCommand::RecordStop,
    ] {
        let bytes = one(command.clone(), &current);
        assert_eq!(bytes.len() % 4, 0, "{command:?} is padded");
        assert!(bytes.len() <= 64, "{command:?} fits one message");
        assert_eq!(bytes[0], 255, "{command:?} goes to every camera");
        assert_eq!(bytes[2], 0, "{command:?} changes a setting");
        let counted = 4 + usize::from(bytes[1]);
        assert!(
            counted <= bytes.len() && bytes.len() < counted + 4,
            "{command:?}: the length counts the command and its data, the padding is under four bytes"
        );
        assert!(
            bytes[counted..].iter().all(|byte| *byte == 0),
            "{command:?}: the padding is zeros"
        );
        let decoded = Message::decode_all(&bytes);
        assert_eq!(decoded.len(), 1, "{command:?} decodes as one message");
        assert_eq!(decoded[0].encode().expect("it encodes again"), bytes);
    }
}

// The record is the transport mode's first byte: 2 records, 0 is preview.
#[test]
fn the_record_is_the_transport_mode() {
    let current = board();
    assert_eq!(
        one(CameraCommand::RecordStart, &current),
        [255, 5, 0, 0, 10, 1, 1, 0, 2, 0, 0, 0]
    );
    assert_eq!(
        one(CameraCommand::RecordStop, &current),
        [255, 5, 0, 0, 10, 1, 1, 0, 0, 0, 0, 0]
    );
    let mut reading = CameraReading::default();
    assert!(apply(
        &mut reading,
        &message(MEDIA_TRANSPORT_MODE, TYPE_INT8, &[2, 0, 0, 1, 1])
    ));
    assert_eq!(reading.recording, Some(true));
    apply(
        &mut reading,
        &message(MEDIA_TRANSPORT_MODE, TYPE_INT8, &[0, 0, 0, 1, 1]),
    );
    assert_eq!(reading.recording, Some(false));
}

#[test]
fn fixed16_is_the_value_times_2048_both_ways() {
    assert_eq!(fixed16_from(1.0), 2048);
    assert_eq!(fixed16_from(0.5), 1024);
    assert_eq!(fixed16_from(-1.0), -2048);
    assert_eq!(fixed16_from(0.62), 1270, "rounded");
    assert_eq!(fixed16_from(100.0), i16::MAX, "held within the type");
    assert_eq!(fixed16_to(2048), 1.0);
    assert_eq!(fixed16_to(1024), 0.5);
    assert!((fixed16_to(1270) - 0.62).abs() < 0.001);
}

// The iris goes as an aperture value (f = √2^AV) and comes back as the
// conventional f-number's name.
#[test]
fn an_iris_is_an_aperture_value_and_reads_back_as_an_f_number() {
    let av = aperture_value_of("f/2.8").expect("an f-number");
    assert!((av - 2.9708).abs() < 0.001);
    assert_eq!(aperture_value_of("f/4.0"), Some(4.0));
    assert_eq!(aperture_value_of("4.0"), None);
    assert_eq!(aperture_value_of("f/0"), None);
    let bytes = one(set(Setting::Iris, text("f/2.8")), &board());
    assert_eq!(&bytes[..8], [255, 6, 0, 0, 0, 2, 128, 0]);
    assert_eq!(
        i16::from_le_bytes([bytes[8], bytes[9]]),
        fixed16_from(av),
        "the aperture value as fixed16"
    );

    assert_eq!(f_number_text(3.0), "f/2.8", "√8 is written f/2.8");
    assert_eq!(f_number_text(4.0), "f/4.0");
    assert_eq!(f_number_text(5.0), "f/5.6", "√32 is written f/5.6");
    assert_eq!(f_number_text(6.6), "f/10", "within 3 % of a name");
    assert_eq!(f_number_text(8.0), "f/16");
    assert_eq!(f_number_text(2.5), "f/2.4", "no name near: one decimal");

    let mut reading = CameraReading::default();
    apply(
        &mut reading,
        &message(
            Parameter(0, 2),
            TYPE_FIXED16,
            &fixed16_from(5.0).to_le_bytes(),
        ),
    );
    assert_eq!(reading.iris.as_deref(), Some("f/5.6"));
}

// The shutter is the angle, degrees × 100; a speed is sent as 1/x and
// read only while no angle has been read.
#[test]
fn the_shutter_is_an_angle_or_a_speed() {
    let current = board();
    assert_eq!(
        one(set(Setting::Shutter, text("172.8°")), &current),
        [255, 8, 0, 0, 1, 11, 3, 0, 0x80, 0x43, 0, 0],
        "17280"
    );
    assert_eq!(
        one(set(Setting::Shutter, text("1/50")), &current),
        [255, 8, 0, 0, 1, 12, 3, 0, 50, 0, 0, 0]
    );
    let mut reading = CameraReading::default();
    apply(
        &mut reading,
        &message(VIDEO_SHUTTER_SPEED, TYPE_INT32, &50i32.to_le_bytes()),
    );
    assert_eq!(reading.shutter.as_deref(), Some("1/50"));
    apply(
        &mut reading,
        &message(VIDEO_SHUTTER_ANGLE, TYPE_INT32, &18000i32.to_le_bytes()),
    );
    assert_eq!(reading.shutter.as_deref(), Some("180°"));
    apply(
        &mut reading,
        &message(VIDEO_SHUTTER_SPEED, TYPE_INT32, &60i32.to_le_bytes()),
    );
    assert_eq!(
        reading.shutter.as_deref(),
        Some("180°"),
        "the angle is the model's word"
    );
    apply(
        &mut reading,
        &message(VIDEO_SHUTTER_ANGLE, TYPE_INT32, &17280i32.to_le_bytes()),
    );
    assert_eq!(reading.shutter.as_deref(), Some("172.8°"));
    apply(
        &mut reading,
        &message(VIDEO_SHUTTER_ANGLE, TYPE_INT32, &0i32.to_le_bytes()),
    );
    assert_eq!(reading.shutter.as_deref(), Some("172.8°"), "0 is no angle");
}

// White balance and tint travel together: a change of one carries the
// other as the camera last reported it.
#[test]
fn white_balance_and_tint_go_together() {
    let current = board();
    assert_eq!(
        one(
            set(Setting::WhiteBalance, CameraValue::Number(5600.0)),
            &current
        ),
        [255, 8, 0, 0, 1, 2, 2, 0, 0xE0, 0x15, 0x02, 0x00],
        "5600 K with the board's tint of 2"
    );
    assert_eq!(
        one(set(Setting::Tint, CameraValue::Number(-5.0)), &current),
        [255, 8, 0, 0, 1, 2, 2, 0, 0xE0, 0x15, 0xFB, 0xFF],
        "a tint of −5 with the board's 5600 K"
    );
    // Neither half is ever guessed (D12): until the camera has reported the
    // other half, the press is refused.
    let unread = CameraReading::default();
    assert_eq!(
        encode_commands(&[set(Setting::Tint, CameraValue::Number(1.0))], &unread)
            .expect_err("no white balance to send the tint with"),
        "CAM 1 has not reported its white balance yet, so a tint cannot be sent with it."
    );
    assert_eq!(
        encode_commands(
            &[set(Setting::WhiteBalance, CameraValue::Number(3200.0))],
            &unread
        )
        .expect_err("no tint to send the white balance with"),
        "CAM 1 has not reported its tint yet, so a white balance cannot be sent with it."
    );
    let mut reading = CameraReading::default();
    apply(
        &mut reading,
        &message(VIDEO_WHITE_BALANCE, TYPE_INT16, &int16s(&[4300, -12])),
    );
    assert_eq!(reading.white_balance, Some(4300.0));
    assert_eq!(reading.tint, Some(-12.0));
}

#[test]
fn focus_is_a_position_from_near_to_far() {
    let current = board();
    let bytes = one(set(Setting::Focus, CameraValue::Number(0.62)), &current);
    assert_eq!(&bytes[..8], [255, 6, 0, 0, 0, 0, 128, 0]);
    assert_eq!(i16::from_le_bytes([bytes[8], bytes[9]]), 1270);
    assert!(encode_commands(&[set(Setting::Focus, CameraValue::Number(1.5))], &current).is_err());
    let mut reading = CameraReading::default();
    apply(
        &mut reading,
        &message(LENS_FOCUS, TYPE_FIXED16, &1270i16.to_le_bytes()),
    );
    assert_eq!(reading.focus, Some(0.62));
    assert_eq!(
        one(CameraCommand::Auto(AutoKind::Focus), &current)[4..6],
        [LENS_AUTOFOCUS.0, LENS_AUTOFOCUS.1]
    );
}

#[test]
fn the_nd_filter_is_in_stops() {
    let current = board();
    assert_eq!(
        one(set(Setting::Nd, text("Clear")), &current)[8..10],
        [0, 0]
    );
    assert_eq!(
        i16::from_le_bytes(
            one(set(Setting::Nd, text("6 stops")), &current)[8..10]
                .try_into()
                .expect("two bytes")
        ),
        6 * 2048
    );
    let mut reading = CameraReading::default();
    for (stops, word) in [
        (0.0, "Clear"),
        (2.0, "2 stops"),
        (4.0, "4 stops"),
        (1.5, "1.5 stops"),
    ] {
        apply(
            &mut reading,
            &message(
                VIDEO_ND_FILTER,
                TYPE_FIXED16,
                &fixed16_from(stops).to_le_bytes(),
            ),
        );
        assert_eq!(reading.nd.as_deref(), Some(word));
    }
}

// The recording format: five numbers, read into the resolution's and the
// frame rate's words, and written back with what was not set kept.
#[test]
fn the_recording_format_reads_into_resolution_and_frame_rate() {
    let format = |values: &[i16]| {
        let mut reading = CameraReading::default();
        apply(
            &mut reading,
            &message(VIDEO_RECORDING_FORMAT, TYPE_INT16, &int16s(values)),
        );
        (reading.resolution, reading.frame_rate)
    };
    assert_eq!(
        format(&[25, 0, 6144, 3456, 0]),
        (Some(String::from("6K")), Some(String::from("25")))
    );
    assert_eq!(
        format(&[30, 0, 3840, 2160, 1]),
        (Some(String::from("UHD")), Some(String::from("29.97"))),
        "an M-rate"
    );
    assert_eq!(
        format(&[24, 0, 1920, 1080, 0]),
        (Some(String::from("HD")), Some(String::from("24")))
    );
    assert_eq!(
        format(&[60, 0, 4096, 2160, 1]),
        (Some(String::from("4K DCI")), Some(String::from("59.94")))
    );
    assert_eq!(
        format(&[50, 0, 6144, 2560, 0]),
        (Some(String::from("6K 2.4:1")), Some(String::from("50")))
    );
    assert_eq!(
        format(&[25, 0, 2048, 1080, 0]),
        (Some(String::from("2048 × 1080")), Some(String::from("25"))),
        "a size the words do not name"
    );
    assert_eq!(
        format(&[25, 0, 1920]),
        (None, None),
        "too few numbers: nothing read"
    );

    // Written back: the other half is kept as the camera reported it. The
    // ten data bytes stand after the eight of the header and the command,
    // before two of padding.
    let current = board(); // 6K at 25
    assert_eq!(
        one(set(Setting::Resolution, text("UHD")), &current)[8..18],
        int16s(&[25, 0, 3840, 2160, 0])
    );
    assert_eq!(
        one(set(Setting::FrameRate, text("29.97")), &current)[8..18],
        int16s(&[30, 0, 6144, 3456, 1])
    );
    let both = encode_commands(
        &[
            set(Setting::Resolution, text("UHD")),
            set(Setting::FrameRate, text("29.97")),
        ],
        &current,
    )
    .expect("both encode");
    assert_eq!(both[1].len(), 20, "eighteen bytes, padded to twenty");
    assert_eq!(
        both[1][8..18],
        int16s(&[30, 0, 3840, 2160, 1]),
        "the second carries the first's change"
    );
    let mut at_m_rate = current.clone();
    at_m_rate.frame_rate = Some(String::from("29.97"));
    assert_eq!(
        one(set(Setting::FrameRate, text("25")), &at_m_rate)[8..18],
        int16s(&[25, 0, 6144, 3456, 0]),
        "a plain rate clears the M-rate flag"
    );
    assert!(encode_commands(&[set(Setting::Resolution, text("8K"))], &current).is_err());
    assert!(encode_commands(&[set(Setting::FrameRate, text("fast"))], &current).is_err());
    assert_eq!(
        RecordingFormat::from_values(&[30, 0, 1920, 1080, 1])
            .expect("five numbers")
            .with_resolution("6K")
            .expect("a size")
            .to_values(),
        [30, 0, 6144, 3456, 1],
        "the flags stay through a size change"
    );
}

#[test]
fn the_dynamic_range_and_the_display_lut_are_small_numbers() {
    let current = board();
    assert_eq!(
        one(set(Setting::DynamicRange, text("Video")), &current),
        [255, 5, 0, 0, 1, 7, 1, 0, 1, 0, 0, 0]
    );
    assert_eq!(
        one(set(Setting::DisplayLut, text("None")), &current),
        [255, 6, 0, 0, 1, 15, 1, 0, 0, 1, 0, 0],
        "the board's LUT is on, and stays on"
    );
    let mut custom = current.clone();
    custom.display_lut = Some(String::from("Custom"));
    assert_eq!(
        one(
            set(Setting::DisplayLutOn, CameraValue::Switch(false)),
            &custom
        ),
        [255, 6, 0, 0, 1, 15, 1, 0, 1, 0, 0, 0],
        "the switch carries the LUT the camera reported"
    );
    assert!(encode_commands(&[set(Setting::DynamicRange, text("HDR"))], &current).is_err());

    let mut reading = CameraReading::default();
    apply(&mut reading, &message(VIDEO_DYNAMIC_RANGE, TYPE_INT8, &[2]));
    assert_eq!(reading.dynamic_range.as_deref(), Some("Extended video"));
    apply(
        &mut reading,
        &message(VIDEO_DISPLAY_LUT, TYPE_INT8, &[3, 1]),
    );
    assert_eq!(reading.display_lut.as_deref(), Some("Film → Ext. video"));
    assert_eq!(reading.display_lut_on, Some(true));
    apply(&mut reading, &message(VIDEO_DYNAMIC_RANGE, TYPE_INT8, &[9]));
    assert_eq!(
        reading.dynamic_range.as_deref(),
        Some("Extended video"),
        "a number without a word leaves the reading"
    );
}

// The camera sends every setting once after the connection: read one after
// another, the messages make the whole reading. Board 2's camera, as the
// simulated CAM 1 reports it, is the check.
#[test]
fn the_initial_payload_is_read_into_one_reading() {
    let payload: Vec<u8> = [
        message(VIDEO_ISO, TYPE_INT32, &400i32.to_le_bytes()),
        message(VIDEO_SHUTTER_ANGLE, TYPE_INT32, &18000i32.to_le_bytes()),
        message(
            Parameter(0, 2),
            TYPE_FIXED16,
            &fixed16_from(aperture_value_of("f/2.8").expect("an f-number")).to_le_bytes(),
        ),
        message(
            VIDEO_ND_FILTER,
            TYPE_FIXED16,
            &fixed16_from(2.0).to_le_bytes(),
        ),
        message(VIDEO_WHITE_BALANCE, TYPE_INT16, &int16s(&[5600, 2])),
        message(LENS_FOCUS, TYPE_FIXED16, &fixed16_from(0.62).to_le_bytes()),
        message(
            VIDEO_RECORDING_FORMAT,
            TYPE_INT16,
            &int16s(&[25, 0, 6144, 3456, 0]),
        ),
        message(VIDEO_DYNAMIC_RANGE, TYPE_INT8, &[0]),
        message(VIDEO_DISPLAY_LUT, TYPE_INT8, &[3, 1]),
        message(MEDIA_TRANSPORT_MODE, TYPE_INT8, &[0, 0, 0, 1, 1]),
        // Something the model does not know: the audio's level (2.0).
        message(
            Parameter(2, 0),
            TYPE_FIXED16,
            &fixed16_from(0.5).to_le_bytes(),
        ),
    ]
    .iter()
    .flat_map(|message| message.encode().expect("it encodes"))
    .collect();
    let messages = Message::decode_all(&payload);
    assert_eq!(messages.len(), 11);
    let reading = applied(&messages);
    assert!(
        reading.same_values(&board()),
        "{reading:?} is not board 2's camera"
    );
    assert_eq!(reading.timecode, None, "the timecode comes on its own");
}

// Bytes from outside: a header that does not fit, a length past the end, a
// command that is not a change, or a parameter nobody knows are read past
// without a panic, and what follows is still read.
#[test]
fn what_cannot_be_read_is_read_past() {
    let iso = message(VIDEO_ISO, TYPE_INT32, &800i32.to_le_bytes())
        .encode()
        .expect("it encodes");
    assert!(Message::decode_all(&[]).is_empty());
    assert!(Message::decode_all(&[255, 8, 0]).is_empty(), "no header");
    assert!(
        Message::decode_all(&[255, 8, 0, 0, 1, 14]).is_empty(),
        "a length past the end"
    );
    let mut other_command = iso.clone();
    other_command[2] = 1;
    let mut bytes = other_command;
    bytes.extend_from_slice(&[255, 0, 0, 0]);
    bytes.extend_from_slice(&iso);
    let messages = Message::decode_all(&bytes);
    assert_eq!(
        messages.len(),
        1,
        "the other command and the empty one are skipped"
    );
    assert_eq!(messages[0].parameter, VIDEO_ISO);
    let mut reading = CameraReading::default();
    assert!(
        !apply(&mut reading, &message(Parameter(2, 0), TYPE_INT8, &[1])),
        "the audio's category is nobody's here"
    );
    assert!(
        !apply(&mut reading, &message(VIDEO_ISO, TYPE_INT8, &[1])),
        "ISO as another type is not read"
    );
    assert_eq!(reading, CameraReading::default());
    assert!(
        message(VIDEO_ISO, TYPE_INT32, &[0; 57]).encode().is_err(),
        "too long for one message"
    );
    assert!(message(VIDEO_ISO, TYPE_INT32, &[0; 56]).encode().is_ok());
}

#[test]
fn the_timecode_is_four_bcd_bytes() {
    assert_eq!(
        timecode_text(&[0x10, 0x53, 0x12, 0x09]).as_deref(),
        Some("09:12:53:10")
    );
    assert_eq!(timecode_text(&[0, 0, 0, 0]).as_deref(), Some("00:00:00:00"));
    assert_eq!(
        timecode_text(&[0x24, 0x59, 0x59, 0x23]).as_deref(),
        Some("23:59:59:24")
    );
    assert_eq!(timecode_text(&[0x10, 0x53, 0x12]), None);
    assert_eq!(timecode_text(&[0x10, 0x53, 0x12, 0x09, 0x00]), None);
    // The camera notifies twelve bytes: the timecode is the last four.
    assert_eq!(
        timecode_text(&[255, 8, 0, 0, 9, 4, 3, 0, 0x10, 0x53, 0x12, 0x09]).as_deref(),
        Some("09:12:53:10")
    );
    assert_eq!(timecode_text(&[0; 11]), None);
    assert_eq!(timecode_text(&[0; 13]), None);
}

// An offset (operation 1) is a change to a value, never the value itself,
// so one met in a notification is not read; the camera's own reports carry
// operation 2 and are, as an assignment is. Nothing sends an offset: the
// Pocket took an offset of zero as an assignment of zero (2026-10-08).
#[test]
fn an_offset_is_not_read_as_a_value() {
    let mut reading = board();
    let offset = Message {
        parameter: VIDEO_ISO,
        data_type: TYPE_INT32,
        operation: OPERATION_OFFSET,
        data: 800i32.to_le_bytes().to_vec(),
    };
    assert!(!apply(&mut reading, &offset));
    assert_eq!(reading.iso, board().iso);
    let report = Message {
        operation: 2,
        data: 1600i32.to_le_bytes().to_vec(),
        ..offset.clone()
    };
    assert!(apply(&mut reading, &report));
    assert_eq!(reading.iso.as_deref(), Some("1600"));
    let assigned = Message {
        operation: OPERATION_ASSIGN,
        ..offset
    };
    assert!(apply(&mut reading, &assigned));
    assert_eq!(reading.iso.as_deref(), Some("800"));
    // Nothing a press sends is an offset.
    for bytes in encode_commands(
        &[
            set(Setting::Iso, text("400")),
            set(Setting::Shutter, text("180°")),
            set(Setting::Iris, text("f/4.0")),
            CameraCommand::RecordStart,
        ],
        &board(),
    )
    .expect("they encode")
    {
        assert_eq!(bytes[7], OPERATION_ASSIGN, "{bytes:?}");
    }
}

// What the Pocket does not take is refused before anything is sent.
#[test]
fn what_the_pocket_does_not_take_is_refused() {
    let current = board();
    let refusal = encode_commands(&[CameraCommand::FocusSteps(1)], &current)
        .expect_err("a focus step is a BGH1's");
    assert!(refusal.contains("position"), "{refusal}");
    let refusal =
        encode_commands(&[set(Setting::Iso, text("Auto"))], &current).expect_err("Auto is no ISO");
    assert_eq!(refusal, "The Pocket's protocol cannot carry ISO Auto.");
    assert!(encode_commands(&[set(Setting::Iris, text("wide"))], &current).is_err());
    assert!(encode_commands(&[set(Setting::Nd, text("dark"))], &current).is_err());
    assert!(encode_commands(&[set(Setting::Iso, CameraValue::Number(400.0))], &current).is_err());
    assert!(
        encode_commands(
            &[
                set(Setting::Iso, text("800")),
                set(Setting::Iso, text("Auto"))
            ],
            &current
        )
        .is_err(),
        "one refused command refuses the press"
    );
}

// A press that sets half a parameter carries the other half as the camera
// reported it, never a guess (D12): right after a connection, before the
// camera has sent its settings, such a press is refused and nothing is sent.
#[test]
fn a_press_before_the_camera_reported_the_other_half_is_refused() {
    let unread = CameraReading::default();
    for (command, sentence) in [
        (
            set(Setting::Resolution, text("UHD")),
            "CAM 1 has not reported its recording format yet, so a resolution cannot be sent with it.",
        ),
        (
            set(Setting::FrameRate, text("25")),
            "CAM 1 has not reported its recording format yet, so a frame rate cannot be sent with it.",
        ),
        (
            set(Setting::DisplayLut, text("None")),
            "CAM 1 has not reported whether its display LUT is on yet, so a display LUT cannot be sent with it.",
        ),
        (
            set(Setting::DisplayLutOn, CameraValue::Switch(true)),
            "CAM 1 has not reported its display LUT yet, so the switch cannot be sent with it.",
        ),
    ] {
        assert_eq!(
            encode_commands(std::slice::from_ref(&command), &unread).expect_err("refused"),
            sentence,
            "{command:?}"
        );
    }
    // Half a format is not enough either.
    let half = CameraReading {
        resolution: Some(String::from("6K")),
        ..CameraReading::default()
    };
    assert!(encode_commands(&[set(Setting::FrameRate, text("25"))], &half).is_err());
    // What needs no other half goes through unread.
    for command in [
        set(Setting::Iso, text("400")),
        set(Setting::Shutter, text("180°")),
        set(Setting::Iris, text("f/4.0")),
        set(Setting::Nd, text("Clear")),
        set(Setting::Focus, CameraValue::Number(0.5)),
        set(Setting::DynamicRange, text("Film")),
        CameraCommand::RecordStart,
        CameraCommand::Auto(AutoKind::Focus),
    ] {
        assert!(
            encode_commands(std::slice::from_ref(&command), &unread).is_ok(),
            "{command:?}"
        );
    }
}

proptest! {
    // The bytes come from outside: however they fall, reading them never
    // panics.
    #[test]
    fn any_bytes_are_read_without_a_panic(bytes in proptest::collection::vec(any::<u8>(), 0..200)) {
        let messages = Message::decode_all(&bytes);
        let mut reading = CameraReading::default();
        for message in &messages {
            apply(&mut reading, message);
        }
        let _ = timecode_text(&bytes);
    }
}
