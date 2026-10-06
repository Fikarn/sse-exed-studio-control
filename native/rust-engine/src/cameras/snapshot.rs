//! What the cameras read out (`cameras.snapshot`, and `checks.cameras` in
//! `health.snapshot`): only what each camera reports and the hardware link
//! holds, never what was merely sent (D10). The shapes are `v1.md`'s
//! "Cameras" section.

use serde::Serialize;

/// A camera's link to Studio Control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum CameraLink {
    /// CAM 1, the Pocket 6K Pro.
    Bluetooth,
    /// CAM 2 and CAM 3, the BGH1s.
    Network,
}

/// Who holds a camera, and whether it answers (D13, D19).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum CameraState {
    /// Held and answering: `HELD`.
    Held,
    /// Handed back to the iPad or LUMIX Tether: `RELEASED`.
    Released,
    /// Setup holds no address or pairing for it: `NOT SET UP`.
    NotSetUp,
    /// Held, and it does not answer: `UNREACHABLE`.
    Unreachable,
}

/// A camera state's tone: the lamp's colour and how far it raises the status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum CameraTone {
    Ok,
    Attention,
    Error,
}

/// What Setup holds for a camera.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraSetupSummary {
    /// CAM 1 is paired, or CAM 2's or CAM 3's address is entered.
    #[serde(rename = "setUp")]
    pub set_up: bool,
    /// CAM 2's or CAM 3's address; always `null` for CAM 1.
    pub address: Option<String>,
    /// CAM 1 is paired; always `false` for CAM 2 and CAM 3.
    pub paired: bool,
    /// The vMix input saved for the camera (1–1000). The simulated test
    /// pictures stand in for inputs 1 to 4; Setup no longer offers it, and
    /// vMix's own pictures come by output.
    #[serde(rename = "vmixInput")]
    pub vmix_input: u32,
    /// The vMix output the camera's picture comes from, fixed (D31): CAM 1
    /// Output 2, CAM 2 Output 3, CAM 3 Output 4.
    #[serde(rename = "vmixOutput")]
    pub vmix_output: u8,
    /// Why Setup cannot pair this camera (CAM 1) or take its address (CAM 2,
    /// CAM 3): this build has no link to it yet. `null` when it can.
    #[serde(rename = "noLink")]
    pub no_link: Option<String>,
    /// CAM 1's pairing while it runs, or why the last one failed; `null`
    /// when none runs (always for CAM 2 and CAM 3).
    pub pairing: Option<CameraPairing>,
}

/// Where a pairing of CAM 1 stands (Setup's two steps, 2026-10-06).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum CameraPairingState {
    /// Looking for the camera.
    Finding,
    /// The camera shows a 6-digit PIN; Setup waits for it.
    Pin,
    /// The PIN is handed over and Windows pairs.
    Pairing,
    /// It did not pair; nothing was saved.
    Failed,
}

/// CAM 1's pairing as Setup shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraPairing {
    pub state: CameraPairingState,
    /// What the operator reads beside it: what to do, or why it failed.
    pub sentence: String,
}

/// A value a choice cannot take now, and why (a frame rate not at this
/// resolution).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraUnavailable {
    pub value: String,
    pub reason: String,
}

/// A setting chosen from a list, in the camera's own words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraChoice {
    /// The camera reports this setting.
    pub reported: bool,
    /// What it reports now; `null` when it does not, or has not been read.
    pub value: Option<String>,
    /// The values it allows, in order; empty when it does not report them.
    pub options: Vec<String>,
    /// Values among `options` it does not allow now, with the reason.
    pub unavailable: Vec<CameraUnavailable>,
    /// Why it does not report this setting, in the camera's own terms.
    #[serde(rename = "notReported")]
    pub not_reported: Option<String>,
}

/// A setting on a scale: white balance in kelvin, tint, focus from near 0 to
/// far 1.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraLevel {
    pub reported: bool,
    pub value: Option<f64>,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    /// `K` for white balance; empty for tint and focus.
    pub unit: String,
    #[serde(rename = "notReported")]
    pub not_reported: Option<String>,
}

/// A setting that is on or off (the display LUT).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraSwitch {
    pub reported: bool,
    pub value: Option<bool>,
    #[serde(rename = "notReported")]
    pub not_reported: Option<String>,
}

/// Every value D10 lists, as the camera reports it or why not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraValues {
    pub iso: CameraChoice,
    pub shutter: CameraChoice,
    pub iris: CameraChoice,
    pub nd: CameraChoice,
    #[serde(rename = "whiteBalance")]
    pub white_balance: CameraLevel,
    pub tint: CameraLevel,
    pub focus: CameraLevel,
    pub resolution: CameraChoice,
    #[serde(rename = "frameRate")]
    pub frame_rate: CameraChoice,
    #[serde(rename = "dynamicRange")]
    pub dynamic_range: CameraChoice,
    #[serde(rename = "displayLut")]
    pub display_lut: CameraChoice,
    #[serde(rename = "displayLutOn")]
    pub display_lut_on: CameraSwitch,
}

/// The one-shot autos a camera offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraAutos {
    pub focus: bool,
    #[serde(rename = "whiteBalance")]
    pub white_balance: bool,
    pub iris: bool,
}

/// Recording, which CAM 1 alone does (D10, D14).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraRecording {
    /// This camera records here.
    pub records: bool,
    /// It reports recording; `null` when it does not record here or has not
    /// been read.
    pub recording: Option<bool>,
    /// Its timecode, when it reports one.
    pub timecode: Option<String>,
    #[serde(rename = "timecodeReported")]
    pub timecode_reported: bool,
    /// When the hardware link saw the take start; `null` when it started
    /// before the hardware link looked, or nothing records.
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
    /// The card's time left, when it reports it.
    #[serde(rename = "cardTimeLeft")]
    pub card_time_left: Option<String>,
    /// Why it does not report its card time.
    #[serde(rename = "cardTimeNotReported")]
    pub card_time_not_reported: Option<String>,
}

/// Whether the pictures arrive (D17, D28).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum PictureState {
    /// It arrives; for the three, every one does.
    Showing,
    /// The source sends pictures, and not this one; for the three, not
    /// every one: `PICTURE MISSING`.
    Missing,
    /// No picture arrives at all: `NO PICTURES`.
    NoPictures,
}

/// One camera's picture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraPicture {
    pub state: PictureState,
    /// `LIVE`, `NO PICTURE`.
    pub word: String,
    pub tone: CameraTone,
    /// What arrives, as the page prints it: `test picture`, or vMix's
    /// output with its size and rate (`vMix Output 2 · 3840 × 2160 ·
    /// 29.97`); `nothing received`, or why nothing can (`not started`),
    /// after the output with vMix's pictures.
    pub detail: String,
    /// Why no picture arrives, said in its place; `null` while it arrives.
    pub sentence: Option<String>,
    /// What to check, under the sentence; `null` when there is nothing to
    /// check.
    pub advice: Option<String>,
}

/// The three pictures together: the state display, the Pictures section and
/// the footer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CamerasPictures {
    pub state: PictureState,
    /// `PICTURE MISSING`, `NO PICTURES`; `null` while every picture arrives.
    pub word: Option<String>,
    pub tone: CameraTone,
    /// The state display's sentence; `null` while every picture arrives.
    pub sentence: Option<String>,
    /// Where the pictures come from: `test pictures`, `vMix Outputs 2 to 4`,
    /// `not started`.
    pub source: String,
    /// The Pictures section's fine print.
    pub note: String,
}

/// One camera.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraSnapshot {
    /// 1, 2 or 3.
    pub camera: u8,
    /// `CAM 1`, `CAM 2`, `CAM 3`.
    pub tag: String,
    /// The camera's make and model.
    pub model: String,
    pub link: CameraLink,
    pub setup: CameraSetupSummary,
    pub state: CameraState,
    /// `HELD`, `RELEASED`, `NOT SET UP`, `UNREACHABLE`.
    pub word: String,
    pub tone: CameraTone,
    pub sentence: String,
    /// When the camera last answered; `null` when it never has since the
    /// start, or it is released.
    #[serde(rename = "readAt")]
    pub read_at: Option<String>,
    pub values: CameraValues,
    pub auto: CameraAutos,
    /// Focus moves nearer and farther without a reported position.
    #[serde(rename = "focusSteps")]
    pub focus_steps: bool,
    pub recording: CameraRecording,
    /// Its picture, whatever state the camera is in: the picture comes from
    /// vMix, not from the camera's link.
    pub picture: CameraPicture,
}

/// One of the cameras' Recent actions: a row of the action log, as it was
/// written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraRecentAction {
    pub id: i64,
    /// UTC, `2026-09-27T14:03:22.123Z`.
    pub at: String,
    /// `ui` (the screen) or `deck` (the Stream Deck).
    pub source: String,
    /// `recording-started`, `recording-stopped`, `format-changed`,
    /// `look-changed`, `released`, `held-again`.
    pub action: String,
    /// `CAM 1`, `CAM 2`, `CAM 3`.
    pub target: String,
    /// The sentence the operator read.
    pub detail: String,
}

/// What the Stream Deck's four dials set on the selected camera (D14): the
/// deck's `BANK` key and the page's keys choose one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
#[serde(rename_all = "lowercase")]
pub enum CameraDialBank {
    /// ISO, shutter, iris and ND: the bank after a start.
    #[default]
    Exposure,
    /// White balance and tint.
    Colour,
    /// Focus; a push is a one-shot autofocus where the lens allows.
    Focus,
}

/// The deck's dials, as the page says them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraDials {
    pub bank: CameraDialBank,
    /// The setting each dial sets, left to right, by its name in the
    /// requests; `null` for a dial that sets nothing in this bank.
    pub sets: Vec<Option<String>>,
}

/// `cameras.snapshot`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CamerasSnapshot {
    /// The camera the big picture, the plate and the deck's dials set (D19).
    pub selected: u8,
    /// What the deck's dials set on it.
    pub dials: CameraDials,
    pub cameras: Vec<CameraSnapshot>,
    /// The three pictures together.
    pub pictures: CamerasPictures,
    /// The cameras' newest Recent actions, newest first; `null` when the
    /// action log could not be read.
    pub recent: Option<Vec<CameraRecentAction>>,
}

/// One camera in `checks.cameras`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CameraHealthEntry {
    pub camera: u8,
    pub tag: String,
    pub state: CameraState,
    pub word: String,
    pub tone: CameraTone,
    pub sentence: String,
}

/// `health.snapshot`'s `checks.cameras`: the Cameras lamp and what it adds to
/// the whole status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(export))]
pub struct CamerasHealthCheck {
    pub ok: bool,
    /// The worst camera's tone.
    pub status: CameraTone,
    /// The worst camera's word.
    pub word: String,
    /// The worst camera's sentence.
    pub summary: String,
    /// CAM 1 reports recording.
    pub recording: bool,
    pub cameras: Vec<CameraHealthEntry>,
}
