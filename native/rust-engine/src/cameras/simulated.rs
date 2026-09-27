//! The simulated cameras (D15 rules 1–2): every test, lane and scratch run
//! uses them (`SSE_CAMERAS_SIMULATED=1`). They live inside the hardware link
//! and touch no network and no radio: this module names no socket and no
//! Bluetooth crate, which `tests_link.rs` holds it to. Each starts with board
//! 2's values and reports what its model reports (`model.rs`).
//!
//! A simulated camera counts what it is sent, so the tests can hold the
//! design's rule that nothing but the operator's press sends anything
//! (D12). A read is not a send: it asks the camera what it reports. The
//! simulated cameras are the cameras, not the hardware link's view of them:
//! they outlive a restart of the link (`runtime::forget`), as a camera on the
//! desk would.

use crate::cameras::model::{model, AutoKind, Setting, CAMERA_NUMBERS};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// What a camera reports: each setting, or `None` when it does not report
/// it (or, in the hardware link's view, has not been read).
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct CameraReading {
    pub iso: Option<String>,
    pub shutter: Option<String>,
    pub iris: Option<String>,
    pub nd: Option<String>,
    pub white_balance: Option<f64>,
    pub tint: Option<f64>,
    pub focus: Option<f64>,
    pub resolution: Option<String>,
    pub frame_rate: Option<String>,
    pub dynamic_range: Option<String>,
    pub display_lut: Option<String>,
    pub display_lut_on: Option<bool>,
    /// `None` for a camera that does not record here.
    pub recording: Option<bool>,
    /// `HH:MM:SS:FF`; `None` for a camera that does not report one.
    pub timecode: Option<String>,
}

impl CameraReading {
    /// The same values, whatever the timecode says: a timecode that moved
    /// is not a change the camera made.
    pub(crate) fn same_values(&self, other: &Self) -> bool {
        let without = |reading: &Self| Self {
            timecode: None,
            ..reading.clone()
        };
        without(self) == without(other)
    }

    pub(crate) fn text(&self, setting: Setting) -> Option<&str> {
        match setting {
            Setting::Iso => self.iso.as_deref(),
            Setting::Shutter => self.shutter.as_deref(),
            Setting::Iris => self.iris.as_deref(),
            Setting::Nd => self.nd.as_deref(),
            Setting::Resolution => self.resolution.as_deref(),
            Setting::FrameRate => self.frame_rate.as_deref(),
            Setting::DynamicRange => self.dynamic_range.as_deref(),
            Setting::DisplayLut => self.display_lut.as_deref(),
            Setting::WhiteBalance | Setting::Tint | Setting::Focus | Setting::DisplayLutOn => None,
        }
    }

    pub(crate) fn number(&self, setting: Setting) -> Option<f64> {
        match setting {
            Setting::WhiteBalance => self.white_balance,
            Setting::Tint => self.tint,
            Setting::Focus => self.focus,
            _ => None,
        }
    }

    fn set(&mut self, setting: Setting, value: &CameraValue) {
        match (setting, value) {
            (Setting::Iso, CameraValue::Text(text)) => self.iso = Some(text.clone()),
            (Setting::Shutter, CameraValue::Text(text)) => self.shutter = Some(text.clone()),
            (Setting::Iris, CameraValue::Text(text)) => self.iris = Some(text.clone()),
            (Setting::Nd, CameraValue::Text(text)) => self.nd = Some(text.clone()),
            (Setting::Resolution, CameraValue::Text(text)) => self.resolution = Some(text.clone()),
            (Setting::FrameRate, CameraValue::Text(text)) => self.frame_rate = Some(text.clone()),
            (Setting::DynamicRange, CameraValue::Text(text)) => {
                self.dynamic_range = Some(text.clone());
            }
            (Setting::DisplayLut, CameraValue::Text(text)) => self.display_lut = Some(text.clone()),
            (Setting::WhiteBalance, CameraValue::Number(number)) => {
                self.white_balance = Some(*number);
            }
            (Setting::Tint, CameraValue::Number(number)) => self.tint = Some(*number),
            (Setting::Focus, CameraValue::Number(number)) => self.focus = Some(*number),
            (Setting::DisplayLutOn, CameraValue::Switch(on)) => self.display_lut_on = Some(*on),
            _ => {}
        }
    }
}

/// A value sent to a camera.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CameraValue {
    Text(String),
    Number(f64),
    Switch(bool),
}

/// What the hardware link sends a camera: only what the operator pressed
/// (D11, D12).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CameraCommand {
    Set(Setting, CameraValue),
    /// A BGH1's focus, nearer (`-`) or farther (`+`), without a position.
    FocusSteps(i64),
    Auto(AutoKind),
    RecordStart,
    RecordStop,
}

/// What a simulated autofocus, auto white balance and auto iris settle on.
const AUTO_FOCUS: f64 = 0.5;
const AUTO_WHITE_BALANCE: f64 = 5600.0;
const AUTO_IRIS: &str = "f/4.0";
/// Timecode runs at 25 frames a second (the studio's rate).
const TIMECODE_FPS: u32 = 25;

/// One simulated camera.
#[derive(Debug, Clone)]
pub(crate) struct SimulatedCamera {
    camera: u8,
    /// What it holds now: every value its model reports.
    values: CameraReading,
    answering: bool,
    /// Everything it was sent, oldest first.
    sent: Vec<CameraCommand>,
    /// The time of day its timecode reads; `None` runs it from this PC's
    /// clock (UTC).
    clock: Option<Duration>,
}

impl SimulatedCamera {
    /// Board 2's camera.
    fn new(camera: u8) -> Self {
        let text = |value: &str| Some(String::from(value));
        let values = match camera {
            1 => CameraReading {
                iso: text("400"),
                shutter: text("180°"),
                iris: text("f/2.8"),
                nd: text("2 stops"),
                white_balance: Some(5600.0),
                tint: Some(2.0),
                focus: Some(0.62),
                resolution: text("6K"),
                frame_rate: text("25"),
                dynamic_range: text("Film"),
                display_lut: text("Film → Ext. video"),
                display_lut_on: Some(true),
                recording: Some(false),
                timecode: None,
            },
            2 => CameraReading {
                iso: text("800"),
                shutter: text("1/50"),
                iris: text("f/4.0"),
                white_balance: Some(5600.0),
                resolution: text("FHD"),
                frame_rate: text("25"),
                ..CameraReading::default()
            },
            _ => CameraReading {
                iso: text("1600"),
                shutter: text("1/50"),
                iris: text("f/2.8"),
                white_balance: Some(4300.0),
                resolution: text("FHD"),
                frame_rate: text("25"),
                ..CameraReading::default()
            },
        };
        Self {
            camera,
            values,
            answering: true,
            sent: Vec::new(),
            clock: None,
        }
    }

    /// What it reports now, or `None` when it does not answer.
    fn read(&self) -> Option<CameraReading> {
        if !self.answering {
            return None;
        }
        let mut reading = self.values.clone();
        reading.timecode = model(self.camera)
            .timecode_reported()
            .then(|| self.timecode());
        Some(reading)
    }

    fn timecode(&self) -> String {
        let time_of_day = self.clock.unwrap_or_else(|| {
            let since_epoch = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();
            Duration::from_millis((since_epoch.as_millis() % 86_400_000) as u64)
        });
        let seconds = time_of_day.as_secs() % 86_400;
        let frame = time_of_day.subsec_millis() * TIMECODE_FPS / 1000;
        format!(
            "{:02}:{:02}:{:02}:{frame:02}",
            seconds / 3_600,
            (seconds % 3_600) / 60,
            seconds % 60
        )
    }

    /// Takes one command; `false` when the camera does not answer, so it
    /// never got it.
    fn receive(&mut self, command: &CameraCommand) -> bool {
        if !self.answering {
            return false;
        }
        match command {
            CameraCommand::Set(setting, value) => self.values.set(*setting, value),
            CameraCommand::FocusSteps(_) => {}
            CameraCommand::Auto(AutoKind::Focus) => {
                if self.values.focus.is_some() {
                    self.values.focus = Some(AUTO_FOCUS);
                }
            }
            CameraCommand::Auto(AutoKind::WhiteBalance) => {
                self.values.white_balance = Some(AUTO_WHITE_BALANCE);
            }
            CameraCommand::Auto(AutoKind::Iris) => self.values.iris = Some(String::from(AUTO_IRIS)),
            CameraCommand::RecordStart => self.values.recording = Some(true),
            CameraCommand::RecordStop => self.values.recording = Some(false),
        }
        self.sent.push(command.clone());
        true
    }
}

/// The three simulated cameras of one saved data.
#[derive(Debug, Clone)]
pub(crate) struct SimulatedCameras {
    cameras: [SimulatedCamera; 3],
}

impl Default for SimulatedCameras {
    fn default() -> Self {
        Self {
            cameras: CAMERA_NUMBERS.map(SimulatedCamera::new),
        }
    }
}

impl SimulatedCameras {
    fn camera(&self, camera: u8) -> &SimulatedCamera {
        &self.cameras[usize::from(camera.clamp(1, 3)) - 1]
    }

    fn camera_mut(&mut self, camera: u8) -> &mut SimulatedCamera {
        &mut self.cameras[usize::from(camera.clamp(1, 3)) - 1]
    }

    /// What camera `camera` reports, or `None` when it does not answer.
    pub(crate) fn read(&self, camera: u8) -> Option<CameraReading> {
        self.camera(camera).read()
    }

    /// Sends the commands in order; `false` when the camera does not answer.
    pub(crate) fn send(&mut self, camera: u8, commands: &[CameraCommand]) -> bool {
        let target = self.camera_mut(camera);
        commands.iter().all(|command| target.receive(command))
    }

    /// Everything camera `camera` was sent, oldest first.
    #[cfg(test)]
    pub(crate) fn sent(&self, camera: u8) -> &[CameraCommand] {
        &self.camera(camera).sent
    }

    /// The body: a value changed on the camera itself, or from the iPad
    /// (test hook).
    #[cfg(test)]
    pub(crate) fn body_sets(&mut self, camera: u8, setting: Setting, value: CameraValue) {
        self.camera_mut(camera).values.set(setting, &value);
    }

    /// The body starts or stops a take (test hook): the iPad, or the
    /// camera's own button.
    #[cfg(test)]
    pub(crate) fn body_records(&mut self, camera: u8, recording: bool) {
        self.camera_mut(camera).values.recording = Some(recording);
    }

    /// The camera stops answering, or answers again (test hook).
    #[cfg(test)]
    pub(crate) fn set_answering(&mut self, camera: u8, answering: bool) {
        self.camera_mut(camera).answering = answering;
    }

    /// Sets the time of day the camera's timecode reads (test hook).
    #[cfg(test)]
    pub(crate) fn set_clock(&mut self, camera: u8, time_of_day: Duration) {
        self.camera_mut(camera).clock = Some(time_of_day);
    }
}
