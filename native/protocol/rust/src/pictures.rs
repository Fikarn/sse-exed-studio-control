//! The pictures helper's lines (the camera pictures, D28): what the engine
//! tells the helper on its stdin and what the helper tells the engine on its
//! stdout, one JSON object a line. The engine starts the helper, tells it the
//! vMix input of each camera, and hears at least once a second what it
//! receives; a helper that stays silent for longer is ended and started again.
//!
//! Both sides read and write these types, so a line has one shape. The
//! pictures themselves never pass the engine: the helper draws them itself
//! (D30).
//!
//! The helper's source is the simulated one, or, in a development run that
//! `npm run app -- --vmix-pictures` started and nothing else, vMix's Outputs
//! 2 to 4 over NDI on this PC (D31 to D33): the engine says which on each
//! want, and the helper takes vMix's only when its own environment holds the
//! switch as well.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::io::{self, BufRead};
use std::ops::RangeInclusive;
use std::time::Duration;

/// The helper's program, beside the engine's and nowhere else.
pub const HELPER_PROGRAM: &str = if cfg!(windows) {
    "studio-control-pictures.exe"
} else {
    "studio-control-pictures"
};

/// The vMix inputs the simulated source sends: the four DeckLink inputs of
/// the studio's vMix preset. Another input has no picture.
pub const SIMULATED_VMIX_INPUTS: RangeInclusive<u32> = 1..=4;

/// The helper says what it receives at least this often, and on every
/// change.
pub const STATE_INTERVAL: Duration = Duration::from_secs(1);

/// The switch of `npm run app -- --vmix-pictures` (D33): `1` asks a
/// development run's pictures helper for vMix's Outputs 2 to 4 over NDI, a
/// hardware test the owner asks for and attends. Only that command sets it:
/// every other run sets it to `0`, the lanes refuse it, the tests remove it,
/// and a studio build never reads it. The engine reads it in its own
/// environment and says the source on each want; the helper reads it again
/// in its own.
pub const VMIX_PICTURES_ENV: &str = "SSE_VMIX_PICTURES";

/// NDI's library for that run, by its full path: the NDI SDK's own file,
/// whose hash `npm run app` checks against the pin
/// (`native/pictures-link/ndi-library.json`) before the run starts.
pub const NDI_LIBRARY_ENV: &str = "SSE_NDI_LIBRARY";

/// Only `1` asks for vMix's pictures; the value is trimmed first, as the
/// simulated cameras' switch is.
pub fn vmix_pictures_requested(value: &str) -> bool {
    value.trim() == "1"
}

/// The vMix output each camera's picture comes from (D31): CAM 1 is Output
/// 2, CAM 2 Output 3 and CAM 3 Output 4. Which input an output carries is
/// set in vMix; Output 1 is vMix's own, what it records and streams.
pub const VMIX_OUTPUTS: [u8; 3] = [2, 3, 4];

/// Camera `camera`'s vMix output; `None` for a camera that is not one of
/// the three.
pub fn vmix_output(camera: u8) -> Option<u8> {
    VMIX_OUTPUTS
        .get(usize::from(camera).checked_sub(1)?)
        .copied()
}

/// The longest line either side reads; a longer one is refused whole.
pub const MAX_LINE_BYTES: usize = 4096;

/// One camera the engine wants the picture of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WantedCamera {
    /// 1, 2 or 3.
    pub camera: u8,
    /// The vMix input Setup holds for it.
    #[serde(rename = "vmixInput")]
    pub vmix_input: u32,
}

/// The frame listener's secret, as the helper is told it. It prints as
/// `…`, so a line that names it in a log or a panic says nothing of it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LinkSecret(pub String);

impl fmt::Debug for LinkSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("LinkSecret(…)")
    }
}

/// A line from the engine to the helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToHelper {
    /// The cameras and their vMix inputs, all three, each time one changes;
    /// the selected camera, which is sent big and the others small; whether
    /// the Cameras page shows the pictures, the only time they are drawn and
    /// vMix's are received; and where they come from (absent: the simulated
    /// source, so a line of the simulated source reads as it always did).
    Want {
        cameras: Vec<WantedCamera>,
        #[serde(default = "first_camera")]
        selected: u8,
        #[serde(default)]
        showing: bool,
        #[serde(default, skip_serializing_if = "HelperSource::is_simulated")]
        source: HelperSource,
    },
    /// Where the shell's frame listener is, `127.0.0.1:<port>`, and its
    /// secret: once, before the first want, when the shell opened one.
    Link { address: String, secret: LinkSecret },
}

fn first_camera() -> u8 {
    1
}

/// Where the helper's pictures come from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperSource {
    /// Test pictures of its own: the vMix inputs of `SIMULATED_VMIX_INPUTS`.
    #[default]
    Simulated,
    /// vMix's Outputs 2 to 4 over NDI on this PC (`VMIX_OUTPUTS`): only in a
    /// development run started with `npm run app -- --vmix-pictures` (D33).
    Vmix,
}

impl HelperSource {
    pub fn is_simulated(&self) -> bool {
        *self == Self::Simulated
    }
}

/// What a camera's picture arrives as: its size and its rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureFormat {
    pub width: u32,
    pub height: u32,
    /// Frames a second as a fraction: 30000 / 1001 is 29.97.
    pub rate_numerator: u32,
    pub rate_denominator: u32,
}

impl PictureFormat {
    /// `3840 × 2160 · 29.97`: the rate to two decimals at most, and none
    /// for a whole one.
    pub fn words(&self) -> String {
        let rate = if self.rate_denominator == 0 {
            String::from("?")
        } else {
            let text = format!(
                "{:.2}",
                f64::from(self.rate_numerator) / f64::from(self.rate_denominator)
            );
            text.trim_end_matches('0').trim_end_matches('.').to_string()
        };
        format!("{} × {} · {rate}", self.width, self.height)
    }
}

/// What the helper receives for one camera.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceivedCamera {
    pub camera: u8,
    #[serde(rename = "vmixInput")]
    pub vmix_input: u32,
    /// Its picture arrives.
    pub receiving: bool,
    /// What it arrives as, while it does (vMix's pictures only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<PictureFormat>,
}

/// Why the helper takes no pictures from its source at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperProblem {
    /// It was told vMix's pictures and does not take them: it was started
    /// without the switch in its own environment, or it is a studio build.
    NotAllowed,
    /// NDI's library was not given, is not the SDK's file, or did not load.
    NoLibrary,
}

/// A line from the helper to the engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FromHelper {
    /// What it receives, for the cameras of the last `Want`.
    State {
        source: HelperSource,
        /// The source sends pictures at all (vMix runs and sends at least
        /// one of the three outputs over NDI).
        sending: bool,
        /// Why it takes none at all; absent while it can.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        problem: Option<HelperProblem>,
        cameras: Vec<ReceivedCamera>,
    },
}

/// One line, without its line end.
pub fn to_line<T: Serialize>(message: &T) -> String {
    serde_json::to_string(message).unwrap_or_default()
}

/// A line read back; a line too long or of another shape is refused with
/// why.
pub fn from_line<T: for<'a> Deserialize<'a>>(line: &str) -> Result<T, String> {
    if line.len() > MAX_LINE_BYTES {
        return Err(format!(
            "a line of {} bytes, longer than {MAX_LINE_BYTES}",
            line.len()
        ));
    }
    serde_json::from_str(line.trim()).map_err(|error| error.to_string())
}

/// Reads one line of at most `MAX_LINE_BYTES`, without its line end: `None`
/// at the end of the input, `Err(length)` for a line that was longer (read
/// to its end and dropped), so a line never grows without bound.
pub fn read_line_bounded<R: BufRead>(reader: &mut R) -> io::Result<Option<Result<String, usize>>> {
    let mut line = Vec::new();
    let mut length = 0_usize;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            if length == 0 {
                return Ok(None);
            }
            break;
        }
        let (taken, ended) = match buffer.iter().position(|byte| *byte == b'\n') {
            Some(end) => (end + 1, true),
            None => (buffer.len(), false),
        };
        let content = &buffer[..if ended { taken - 1 } else { taken }];
        if length + content.len() <= MAX_LINE_BYTES {
            line.extend_from_slice(content);
        }
        length += content.len();
        reader.consume(taken);
        if ended {
            break;
        }
    }
    if length > MAX_LINE_BYTES {
        return Ok(Some(Err(length)));
    }
    let text = String::from_utf8_lossy(&line);
    Ok(Some(Ok(text.trim_end_matches('\r').to_string())))
}

/// What the simulated source receives for the cameras of `want`.
pub fn simulated_state(want: &[WantedCamera]) -> FromHelper {
    FromHelper::State {
        source: HelperSource::Simulated,
        sending: true,
        problem: None,
        cameras: want
            .iter()
            .map(|wanted| ReceivedCamera {
                camera: wanted.camera,
                vmix_input: wanted.vmix_input,
                receiving: SIMULATED_VMIX_INPUTS.contains(&wanted.vmix_input),
                format: None,
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------
// The frame link: helper to shell, never through the engine
// ---------------------------------------------------------------------------

/// Where the shell's frame listener is, `127.0.0.1:<port>`: in the engine's
/// environment, which the shell sets at each engine start.
pub const LINK_ADDRESS_ENV: &str = "SSE_PICTURES_LINK";
/// The listener's secret for that start, 64 hex characters: in the engine's
/// environment, which the engine clears at once and hands to the helper on
/// its stdin alone. It never reaches the page, a log or a snapshot.
pub const LINK_SECRET_ENV: &str = "SSE_PICTURES_SECRET";
/// The secret's length in hex characters (32 bytes of OS randomness).
pub const LINK_SECRET_HEX: usize = 64;

/// A frame's first four bytes.
pub const FRAME_MAGIC: [u8; 4] = *b"SCPF";
pub const FRAME_VERSION: u8 = 1;
/// The header's length: magic, version, camera, format, a spare byte,
/// width, height (each `u16`), the sequence (`u64`) and the length (`u32`),
/// little-endian.
pub const FRAME_HEADER_LEN: usize = 24;
/// The largest picture a frame carries: the page's picture (a 4K source is
/// scaled to it in the helper).
pub const FRAME_MAX_WIDTH: u16 = 1920;
pub const FRAME_MAX_HEIGHT: u16 = 1080;
/// The largest JPEG a frame carries.
pub const FRAME_MAX_JPEG_BYTES: u32 = 8 * 1024 * 1024;

/// How a frame's picture is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameFormat {
    /// 4:2:2, two bytes a pixel as U Y V Y, BT.709 video range: NDI's own.
    Uyvy,
    /// Four bytes a pixel, full range.
    Rgba8,
    /// A JPEG, full range (reserved: no encoder yet).
    Jpeg,
}

impl FrameFormat {
    fn code(self) -> u8 {
        match self {
            Self::Uyvy => 1,
            Self::Rgba8 => 2,
            Self::Jpeg => 3,
        }
    }

    fn from_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::Uyvy),
            2 => Some(Self::Rgba8),
            3 => Some(Self::Jpeg),
            _ => None,
        }
    }
}

/// A frame's header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    /// 1, 2 or 3.
    pub camera: u8,
    pub format: FrameFormat,
    pub width: u16,
    pub height: u16,
    /// Counts the frames of this camera from 1; a gap is a frame dropped.
    pub sequence: u64,
    /// The picture's bytes after the header.
    pub length: u32,
}

impl FrameHeader {
    /// A raw picture's header: its length follows from its size.
    pub fn raw(camera: u8, format: FrameFormat, width: u16, height: u16, sequence: u64) -> Self {
        let bytes_a_pixel = if format == FrameFormat::Uyvy { 2 } else { 4 };
        Self {
            camera,
            format,
            width,
            height,
            sequence,
            length: u32::from(width) * u32::from(height) * bytes_a_pixel,
        }
    }

    pub fn encode(&self) -> [u8; FRAME_HEADER_LEN] {
        let mut bytes = [0_u8; FRAME_HEADER_LEN];
        bytes[..4].copy_from_slice(&FRAME_MAGIC);
        bytes[4] = FRAME_VERSION;
        bytes[5] = self.camera;
        bytes[6] = self.format.code();
        bytes[8..10].copy_from_slice(&self.width.to_le_bytes());
        bytes[10..12].copy_from_slice(&self.height.to_le_bytes());
        bytes[12..20].copy_from_slice(&self.sequence.to_le_bytes());
        bytes[20..24].copy_from_slice(&self.length.to_le_bytes());
        bytes
    }

    /// A header read back, held to what a frame may be before a byte of its
    /// picture is read or kept: a camera of the three, a known format, a size
    /// no larger than the page's picture (an even width for UYVY), and the
    /// length its size gives.
    pub fn decode(bytes: &[u8; FRAME_HEADER_LEN]) -> Result<Self, String> {
        if bytes[..4] != FRAME_MAGIC || bytes[4] != FRAME_VERSION {
            return Err(String::from("not a frame of this version"));
        }
        let camera = bytes[5];
        if !(1..=3).contains(&camera) {
            return Err(format!("camera {camera}"));
        }
        let format =
            FrameFormat::from_code(bytes[6]).ok_or_else(|| format!("format {}", bytes[6]))?;
        let width = u16::from_le_bytes([bytes[8], bytes[9]]);
        let height = u16::from_le_bytes([bytes[10], bytes[11]]);
        if width == 0 || height == 0 || width > FRAME_MAX_WIDTH || height > FRAME_MAX_HEIGHT {
            return Err(format!("a picture of {width} × {height}"));
        }
        let mut sequence = [0_u8; 8];
        sequence.copy_from_slice(&bytes[12..20]);
        let length = u32::from_le_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        let header = Self {
            camera,
            format,
            width,
            height,
            sequence: u64::from_le_bytes(sequence),
            length,
        };
        let fits = match format {
            FrameFormat::Uyvy => {
                width.is_multiple_of(2)
                    && length == Self::raw(camera, format, width, height, 0).length
            }
            FrameFormat::Rgba8 => length == Self::raw(camera, format, width, height, 0).length,
            FrameFormat::Jpeg => length > 0 && length <= FRAME_MAX_JPEG_BYTES,
        };
        if !fits {
            return Err(format!(
                "{length} bytes for a {format:?} picture of {width} × {height}"
            ));
        }
        Ok(header)
    }
}

/// Two secrets compared in the same time whatever their difference, as the
/// deck's bridge compares its token.
pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (a, b) in left.iter().zip(right) {
        difference |= a ^ b;
    }
    difference == 0
}

/// A secret of `LINK_SECRET_HEX` hex characters.
pub fn is_link_secret(value: &str) -> bool {
    value.len() == LINK_SECRET_HEX && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_header_reads_back_and_holds_its_picture_to_its_size() {
        let header = FrameHeader::raw(2, FrameFormat::Uyvy, 1920, 1080, 77);
        assert_eq!(header.length, 1920 * 1080 * 2);
        let bytes = header.encode();
        assert_eq!(&bytes[..4], b"SCPF");
        assert_eq!(FrameHeader::decode(&bytes), Ok(header));
        let small = FrameHeader::raw(3, FrameFormat::Rgba8, 544, 306, 1);
        assert_eq!(FrameHeader::decode(&small.encode()), Ok(small));

        let refused = |mutate: &dyn Fn(&mut [u8; FRAME_HEADER_LEN])| {
            let mut bytes = header.encode();
            mutate(&mut bytes);
            FrameHeader::decode(&bytes).is_err()
        };
        assert!(refused(&|bytes| bytes[0] = b'X'), "magic");
        assert!(refused(&|bytes| bytes[4] = 2), "version");
        assert!(refused(&|bytes| bytes[5] = 4), "camera");
        assert!(refused(&|bytes| bytes[5] = 0), "camera 0");
        assert!(refused(&|bytes| bytes[6] = 9), "format");
        assert!(
            refused(&|bytes| bytes[8..10].copy_from_slice(&1921_u16.to_le_bytes())),
            "width"
        );
        assert!(
            refused(&|bytes| bytes[10..12].copy_from_slice(&0_u16.to_le_bytes())),
            "height"
        );
        assert!(
            refused(&|bytes| bytes[8..10].copy_from_slice(&1919_u16.to_le_bytes())),
            "odd UYVY"
        );
        assert!(
            refused(&|bytes| bytes[20..24].copy_from_slice(&u32::MAX.to_le_bytes())),
            "length"
        );
        let mut jpeg = FrameHeader::raw(1, FrameFormat::Jpeg, 1920, 1080, 1);
        jpeg.length = FRAME_MAX_JPEG_BYTES + 1;
        assert!(
            FrameHeader::decode(&jpeg.encode()).is_err(),
            "a JPEG too large"
        );
    }

    #[test]
    fn a_secret_is_compared_whole() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(is_link_secret(&"0f".repeat(32)));
        assert!(!is_link_secret(&"0f".repeat(31)));
        assert!(!is_link_secret(&"zz".repeat(32)));
    }

    fn want(inputs: [u32; 3]) -> Vec<WantedCamera> {
        inputs
            .iter()
            .zip(1_u8..)
            .map(|(input, camera)| WantedCamera {
                camera,
                vmix_input: *input,
            })
            .collect()
    }

    #[test]
    fn the_lines_have_one_shape_both_ways() {
        let wanted = ToHelper::Want {
            cameras: want([1, 7, 3]),
            selected: 2,
            showing: true,
            source: HelperSource::Simulated,
        };
        let line = to_line(&wanted);
        assert_eq!(
            line,
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":1},{"camera":2,"vmixInput":7},{"camera":3,"vmixInput":3}],"selected":2,"showing":true}"#
        );
        assert_eq!(from_line::<ToHelper>(&line), Ok(wanted));
        assert_eq!(
            from_line::<ToHelper>(r#"{"type":"want","cameras":[]}"#),
            Ok(ToHelper::Want {
                cameras: Vec::new(),
                selected: 1,
                showing: false,
                source: HelperSource::Simulated,
            }),
            "a want that names neither selects CAM 1, shows nothing and is the simulated source's"
        );

        let link = ToHelper::Link {
            address: String::from("127.0.0.1:49152"),
            secret: LinkSecret("ab".repeat(32)),
        };
        let line = to_line(&link);
        assert!(line.contains(&"ab".repeat(32)), "the helper is told it");
        assert_eq!(from_line::<ToHelper>(&line), Ok(link.clone()));
        assert!(
            !format!("{link:?}").contains("abab"),
            "no debug print names the secret"
        );

        let state = simulated_state(&want([1, 7, 3]));
        let line = to_line(&state);
        assert_eq!(
            line,
            r#"{"type":"state","source":"simulated","sending":true,"cameras":[{"camera":1,"vmixInput":1,"receiving":true},{"camera":2,"vmixInput":7,"receiving":false},{"camera":3,"vmixInput":3,"receiving":true}]}"#
        );
        assert_eq!(from_line::<FromHelper>(&line), Ok(state));
    }

    #[test]
    fn vmix_s_pictures_are_said_on_the_want_and_in_the_state() {
        let wanted = ToHelper::Want {
            cameras: want([1, 2, 3]),
            selected: 1,
            showing: false,
            source: HelperSource::Vmix,
        };
        let line = to_line(&wanted);
        assert_eq!(
            line,
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":1},{"camera":2,"vmixInput":2},{"camera":3,"vmixInput":3}],"selected":1,"showing":false,"source":"vmix"}"#
        );
        assert_eq!(from_line::<ToHelper>(&line), Ok(wanted));

        let state = FromHelper::State {
            source: HelperSource::Vmix,
            sending: true,
            problem: None,
            cameras: vec![
                ReceivedCamera {
                    camera: 1,
                    vmix_input: 1,
                    receiving: true,
                    format: Some(PictureFormat {
                        width: 3840,
                        height: 2160,
                        rate_numerator: 30000,
                        rate_denominator: 1001,
                    }),
                },
                ReceivedCamera {
                    camera: 2,
                    vmix_input: 2,
                    receiving: false,
                    format: None,
                },
            ],
        };
        let line = to_line(&state);
        assert_eq!(
            line,
            r#"{"type":"state","source":"vmix","sending":true,"cameras":[{"camera":1,"vmixInput":1,"receiving":true,"format":{"width":3840,"height":2160,"rateNumerator":30000,"rateDenominator":1001}},{"camera":2,"vmixInput":2,"receiving":false}]}"#
        );
        assert_eq!(from_line::<FromHelper>(&line), Ok(state));

        let refused = FromHelper::State {
            source: HelperSource::Vmix,
            sending: false,
            problem: Some(HelperProblem::NotAllowed),
            cameras: Vec::new(),
        };
        let line = to_line(&refused);
        assert_eq!(
            line,
            r#"{"type":"state","source":"vmix","sending":false,"problem":"notAllowed","cameras":[]}"#
        );
        assert_eq!(from_line::<FromHelper>(&line), Ok(refused));
        assert_eq!(
            from_line::<FromHelper>(
                r#"{"type":"state","source":"vmix","sending":false,"problem":"noLibrary","cameras":[]}"#
            )
            .map(|FromHelper::State { problem, .. }| problem),
            Ok(Some(HelperProblem::NoLibrary))
        );
    }

    #[test]
    fn the_cameras_are_vmix_s_outputs_two_to_four() {
        assert_eq!(vmix_output(1), Some(2));
        assert_eq!(vmix_output(2), Some(3));
        assert_eq!(vmix_output(3), Some(4));
        assert_eq!(vmix_output(0), None);
        assert_eq!(vmix_output(4), None);
    }

    #[test]
    fn only_one_asks_for_vmix_s_pictures() {
        assert!(vmix_pictures_requested("1"));
        assert!(vmix_pictures_requested(" 1\n"));
        for refused in ["", "0", "true", "yes", "2", "01", "on"] {
            assert!(!vmix_pictures_requested(refused), "{refused:?}");
        }
        assert_eq!(VMIX_PICTURES_ENV, "SSE_VMIX_PICTURES");
        assert_eq!(NDI_LIBRARY_ENV, "SSE_NDI_LIBRARY");
    }

    #[test]
    fn a_format_says_its_size_and_its_rate() {
        let format = |rate_numerator, rate_denominator| PictureFormat {
            width: 1920,
            height: 1080,
            rate_numerator,
            rate_denominator,
        };
        assert_eq!(format(30000, 1001).words(), "1920 × 1080 · 29.97");
        assert_eq!(format(25, 1).words(), "1920 × 1080 · 25");
        assert_eq!(format(60000, 1001).words(), "1920 × 1080 · 59.94");
        assert_eq!(format(50, 2).words(), "1920 × 1080 · 25");
        assert_eq!(format(24000, 1001).words(), "1920 × 1080 · 23.98");
        assert_eq!(format(30, 0).words(), "1920 × 1080 · ?");
    }

    #[test]
    fn a_line_of_another_shape_or_too_long_is_refused() {
        assert!(from_line::<ToHelper>("{}").is_err());
        assert!(from_line::<ToHelper>(r#"{"type":"frame"}"#).is_err());
        assert!(from_line::<FromHelper>("not json").is_err());
        let long = format!(
            r#"{{"type":"want","cameras":[],"pad":"{}"}}"#,
            "x".repeat(MAX_LINE_BYTES)
        );
        let refused = from_line::<ToHelper>(&long).expect_err("too long");
        assert!(refused.contains("longer than 4096"), "{refused}");
    }

    #[test]
    fn a_line_is_read_whole_and_a_long_one_is_dropped_whole() {
        let long = "y".repeat(MAX_LINE_BYTES + 10);
        let input = format!("first\r\n{long}\nlast");
        let mut reader = io::BufReader::with_capacity(16, input.as_bytes());
        let mut read = || read_line_bounded(&mut reader).expect("reads");
        assert_eq!(read(), Some(Ok(String::from("first"))));
        assert_eq!(read(), Some(Err(MAX_LINE_BYTES + 10)));
        assert_eq!(read(), Some(Ok(String::from("last"))));
        assert_eq!(read(), None);
    }

    #[test]
    fn the_simulated_source_sends_vmix_inputs_one_to_four() {
        let FromHelper::State {
            sending, cameras, ..
        } = simulated_state(&want([4, 5, 1000]));
        assert!(sending);
        assert_eq!(
            cameras
                .iter()
                .map(|camera| camera.receiving)
                .collect::<Vec<_>>(),
            [true, false, false]
        );
    }
}
