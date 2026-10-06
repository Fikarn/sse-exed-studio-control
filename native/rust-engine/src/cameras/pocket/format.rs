//! The Pocket's recording format (protocol parameter 1.9) in the model's
//! words: five 16-bit numbers — the file frame rate, the sensor frame rate
//! (0 for no change), the frame's width and height, and flags — read into
//! the resolution and the frame rate CAM 1 reports, and written back from
//! what the operator chose with everything else kept as the camera has it.
//!
//! The words are the model's (`model.rs`: `HD`, `UHD`, `4K DCI`, `6K`) and,
//! for the Pocket 6K Pro's other sizes, the camera's own names. A size that
//! is none of them prints as `width × height`, so a format the list does not
//! offer is still shown as the camera reports it (D10).

/// The flags' bits (Blackmagic's Developer Information, 1.9).
pub(crate) const FLAG_FILE_M_RATE: u16 = 1 << 0;
pub(crate) const FLAG_SENSOR_M_RATE: u16 = 1 << 1;
pub(crate) const FLAG_SENSOR_OFF_SPEED: u16 = 1 << 2;
pub(crate) const FLAG_INTERLACED: u16 = 1 << 3;
pub(crate) const FLAG_WINDOWED: u16 = 1 << 4;

/// The sizes the Pocket 6K Pro records, with the words the operator reads.
const SIZES: [(u16, u16, &str); 9] = [
    (1920, 1080, "HD"),
    (3840, 2160, "UHD"),
    (4096, 2160, "4K DCI"),
    (6144, 3456, "6K"),
    (6144, 2560, "6K 2.4:1"),
    (5744, 3024, "5.7K 17:9"),
    (4096, 1720, "4K 2.4:1"),
    (3728, 3104, "3.7K anamorphic"),
    (2868, 1512, "2.8K 17:9"),
];

/// The recording format as the message carries it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct RecordingFormat {
    pub file_frame_rate: i16,
    pub sensor_frame_rate: i16,
    pub width: i16,
    pub height: i16,
    pub flags: u16,
}

impl RecordingFormat {
    /// From the message's five numbers; `None` when there are fewer.
    pub(crate) fn from_values(values: &[i16]) -> Option<Self> {
        let [file_frame_rate, sensor_frame_rate, width, height, flags] =
            <[i16; 5]>::try_from(values.get(..5)?).ok()?;
        Some(Self {
            file_frame_rate,
            sensor_frame_rate,
            width,
            height,
            flags: flags as u16,
        })
    }

    pub(crate) fn to_values(self) -> [i16; 5] {
        [
            self.file_frame_rate,
            self.sensor_frame_rate,
            self.width,
            self.height,
            self.flags as i16,
        ]
    }

    /// The resolution's word: the model's, the camera's own, or the size.
    pub(crate) fn resolution(&self) -> String {
        SIZES
            .iter()
            .find(|(width, height, _)| {
                i32::from(*width) == i32::from(self.width)
                    && i32::from(*height) == i32::from(self.height)
            })
            .map_or_else(
                || format!("{} × {}", self.width, self.height),
                |(_, _, word)| String::from(*word),
            )
    }

    /// The frame rate's word: `25`, or `29.97` when the file rate is an
    /// M-rate (30 × 1000 ÷ 1001).
    pub(crate) fn frame_rate(&self) -> String {
        let rate = self.file_frame_rate;
        if self.flags & FLAG_FILE_M_RATE != 0 {
            match rate {
                24 => return String::from("23.98"),
                30 => return String::from("29.97"),
                60 => return String::from("59.94"),
                120 => return String::from("119.88"),
                _ => {}
            }
        }
        rate.to_string()
    }

    /// The format with another resolution, by the model's or the camera's
    /// word; `None` for a word that names no size.
    pub(crate) fn with_resolution(self, word: &str) -> Option<Self> {
        let (width, height, _) = SIZES.iter().find(|(_, _, name)| *name == word)?;
        Some(Self {
            width: *width as i16,
            height: *height as i16,
            // The sensor's rate is left as it is: 0 asks for no change.
            sensor_frame_rate: 0,
            ..self
        })
    }

    /// The format with another frame rate, by its word (`25`, `29.97`);
    /// `None` for a word that is no rate.
    pub(crate) fn with_frame_rate(self, word: &str) -> Option<Self> {
        let (rate, m_rate) = match word.trim() {
            "23.98" => (24, true),
            "29.97" => (30, true),
            "59.94" => (60, true),
            "119.88" => (120, true),
            other => (other.parse::<i16>().ok().filter(|rate| *rate > 0)?, false),
        };
        let flags = if m_rate {
            self.flags | FLAG_FILE_M_RATE
        } else {
            self.flags & !FLAG_FILE_M_RATE
        };
        Some(Self {
            file_frame_rate: rate,
            sensor_frame_rate: 0,
            flags,
            ..self
        })
    }
}
