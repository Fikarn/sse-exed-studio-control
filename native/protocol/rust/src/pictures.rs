//! The pictures helper's lines (the camera pictures, D28): what the engine
//! tells the helper on its stdin and what the helper tells the engine on its
//! stdout, one JSON object a line. The engine starts the helper, tells it the
//! vMix input of each camera, and hears at least once a second what it
//! receives; a helper that stays silent for longer is ended and started again.
//!
//! Both sides read and write these types, so a line has one shape. The
//! frames themselves never pass the engine: they come with the shell's frame
//! route, which is not this file's.

use serde::{Deserialize, Serialize};
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

/// A line from the engine to the helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ToHelper {
    /// The cameras and their vMix inputs, all three, each time one changes.
    Want { cameras: Vec<WantedCamera> },
}

/// Where the helper's pictures come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperSource {
    /// Test pictures of its own: the vMix inputs of `SIMULATED_VMIX_INPUTS`.
    Simulated,
}

/// What the helper receives for one camera.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceivedCamera {
    pub camera: u8,
    #[serde(rename = "vmixInput")]
    pub vmix_input: u32,
    /// Its picture arrives.
    pub receiving: bool,
}

/// A line from the helper to the engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FromHelper {
    /// What it receives, for the cameras of the last `Want`.
    State {
        source: HelperSource,
        /// The source sends pictures at all (vMix runs and sends over NDI).
        sending: bool,
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
        cameras: want
            .iter()
            .map(|wanted| ReceivedCamera {
                camera: wanted.camera,
                vmix_input: wanted.vmix_input,
                receiving: SIMULATED_VMIX_INPUTS.contains(&wanted.vmix_input),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        let line = to_line(&wanted);
        assert_eq!(
            line,
            r#"{"type":"want","cameras":[{"camera":1,"vmixInput":1},{"camera":2,"vmixInput":7},{"camera":3,"vmixInput":3}]}"#
        );
        assert_eq!(from_line::<ToHelper>(&line), Ok(wanted));

        let state = simulated_state(&want([1, 7, 3]));
        let line = to_line(&state);
        assert_eq!(
            line,
            r#"{"type":"state","source":"simulated","sending":true,"cameras":[{"camera":1,"vmixInput":1,"receiving":true},{"camera":2,"vmixInput":7,"receiving":false},{"camera":3,"vmixInput":3,"receiving":true}]}"#
        );
        assert_eq!(from_line::<FromHelper>(&line), Ok(state));
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
