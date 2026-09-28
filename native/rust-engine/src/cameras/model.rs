//! The three cameras as the hardware link knows them (D10, D11; the slice's
//! first step 4): who each is, what each reports and allows, and the words
//! the operator reads about them. Each camera's model says what it reports,
//! so Slices 11 and 13 can narrow or widen it once the real links read the
//! cameras themselves. The values are board 2's
//! (`docs/design/boards/A-cameras-2.html`).

use crate::cameras::snapshot::{CameraAutos, CameraLink, CameraState, CameraTone};

/// The cameras, by number.
pub(crate) const CAMERA_NUMBERS: [u8; 3] = [1, 2, 3];
/// The camera that records here (D10, D14), and the one selected after a
/// start (D19).
pub(crate) const RECORDING_CAMERA: u8 = 1;
/// A vMix input is one of these (Setup; Slice 10 shows it).
pub(crate) const VMIX_INPUT_MIN: u32 = 1;
pub(crate) const VMIX_INPUT_MAX: u32 = 1000;

/// A setting a camera may report, by its name in the requests and the
/// snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Setting {
    Iso,
    Shutter,
    Iris,
    Nd,
    WhiteBalance,
    Tint,
    Focus,
    Resolution,
    FrameRate,
    DynamicRange,
    DisplayLut,
    DisplayLutOn,
}

/// The settings one press sets (`cameras.set`, `cameras.step`; D11).
pub(crate) const PRESS_SETTINGS: [Setting; 7] = [
    Setting::Iso,
    Setting::Shutter,
    Setting::Iris,
    Setting::Nd,
    Setting::WhiteBalance,
    Setting::Tint,
    Setting::Focus,
];

impl Setting {
    /// The name the requests and the snapshot use.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Iso => "iso",
            Self::Shutter => "shutter",
            Self::Iris => "iris",
            Self::Nd => "nd",
            Self::WhiteBalance => "whiteBalance",
            Self::Tint => "tint",
            Self::Focus => "focus",
            Self::Resolution => "resolution",
            Self::FrameRate => "frameRate",
            Self::DynamicRange => "dynamicRange",
            Self::DisplayLut => "displayLut",
            Self::DisplayLutOn => "displayLutOn",
        }
    }

    /// One of the settings a press sets, by its name; `None` for any other.
    pub(crate) fn pressed(key: &str) -> Option<Self> {
        PRESS_SETTINGS
            .into_iter()
            .find(|setting| setting.key() == key)
    }

    /// The setting's name in the operator's sentences.
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Iso => "ISO",
            Self::Shutter => "shutter",
            Self::Iris => "iris",
            Self::Nd => "ND",
            Self::WhiteBalance => "white balance",
            Self::Tint => "tint",
            Self::Focus => "focus",
            Self::Resolution => "resolution",
            Self::FrameRate => "frame rate",
            Self::DynamicRange => "dynamic range",
            Self::DisplayLut | Self::DisplayLutOn => "display LUT",
        }
    }

    /// A level (a number on a scale) rather than a choice from a list.
    pub(crate) fn is_level(self) -> bool {
        matches!(self, Self::WhiteBalance | Self::Tint | Self::Focus)
    }
}

/// A one-shot auto a camera may offer (`cameras.auto`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AutoKind {
    Focus,
    WhiteBalance,
    Iris,
}

impl AutoKind {
    pub(crate) fn from_key(key: &str) -> Option<Self> {
        match key {
            "focus" => Some(Self::Focus),
            "whiteBalance" => Some(Self::WhiteBalance),
            "iris" => Some(Self::Iris),
            _ => None,
        }
    }

    /// The setting the auto moves.
    pub(crate) fn setting(self) -> Setting {
        match self {
            Self::Focus => Setting::Focus,
            Self::WhiteBalance => Setting::WhiteBalance,
            Self::Iris => Setting::Iris,
        }
    }

    /// The auto's name in the operator's sentences.
    fn words(self) -> &'static str {
        match self {
            Self::Focus => "autofocus",
            Self::WhiteBalance => "auto white balance",
            Self::Iris => "auto iris",
        }
    }
}

/// A level's scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LevelScale {
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub unit: &'static str,
}

impl LevelScale {
    /// Whether `value` is on the scale and on one of its steps.
    pub(crate) fn allows(&self, value: f64) -> bool {
        if !value.is_finite() || value < self.min - 1e-9 || value > self.max + 1e-9 {
            return false;
        }
        let steps = (value - self.min) / self.step;
        (steps - steps.round()).abs() < 1e-6
    }

    /// `min + steps × step`, rounded to the step's own decimals so a sum of
    /// steps reads as the camera would say it (`0.62`, not
    /// `0.6200000000000001`).
    pub(crate) fn at(&self, steps: i64) -> f64 {
        let decimals = step_decimals(self.step);
        let factor = 10f64.powi(decimals);
        ((self.min + steps as f64 * self.step) * factor).round() / factor
    }

    /// The step `value` is on, counted from `min`.
    pub(crate) fn steps_of(&self, value: f64) -> i64 {
        ((value - self.min) / self.step).round() as i64
    }

    /// How many steps the scale has above `min`.
    pub(crate) fn last_step(&self) -> i64 {
        self.steps_of(self.max)
    }
}

fn step_decimals(step: f64) -> i32 {
    let mut decimals = 0;
    let mut scaled = step;
    while (scaled - scaled.round()).abs() > 1e-9 && decimals < 6 {
        scaled *= 10.0;
        decimals += 1;
    }
    decimals
}

const CAM1_ISO: &[&str] = &[
    "100", "125", "160", "200", "250", "320", "400", "500", "640", "800", "1000", "1250", "1600",
    "2000", "2500", "3200", "4000", "5000", "6400", "8000", "10000", "12800", "16000", "20000",
    "25600",
];
const CAM1_SHUTTER: &[&str] = &[
    "45°", "90°", "120°", "144°", "172.8°", "180°", "216°", "270°", "360°",
];
const CAM1_IRIS: &[&str] = &[
    "f/2.8", "f/3.2", "f/3.5", "f/4.0", "f/4.5", "f/5.0", "f/5.6", "f/6.3", "f/7.1", "f/8.0",
    "f/9.0", "f/10", "f/11", "f/13", "f/14", "f/16",
];
const CAM1_ND: &[&str] = &["Clear", "2 stops", "4 stops", "6 stops"];
const CAM1_RESOLUTION: &[&str] = &["HD", "UHD", "4K DCI", "6K"];
const CAM1_FRAME_RATE: &[&str] = &["24", "25", "30", "50", "60"];
const CAM1_DYNAMIC_RANGE: &[&str] = &["Film", "Extended video", "Video"];
const CAM1_DISPLAY_LUT: &[&str] = &["None", "Custom", "Film → Video", "Film → Ext. video"];

const BGH1_ISO: &[&str] = &[
    "100", "125", "160", "200", "250", "320", "400", "500", "640", "800", "1000", "1250", "1600",
    "2000", "2500", "3200", "4000", "5000", "6400", "8000", "10000", "12800", "16000", "20000",
    "25600", "32000", "40000", "51200",
];
const BGH1_SHUTTER: &[&str] = &[
    "1/25", "1/30", "1/40", "1/50", "1/60", "1/80", "1/100", "1/120", "1/125", "1/160", "1/200",
    "1/250", "1/320", "1/400", "1/500", "1/640", "1/800", "1/1000",
];
const CAM2_IRIS: &[&str] = &[
    "f/4.0", "f/4.5", "f/5.0", "f/5.6", "f/6.3", "f/7.1", "f/8.0", "f/9.0", "f/10", "f/11", "f/13",
    "f/14", "f/16", "f/18", "f/20", "f/22",
];
const CAM3_IRIS: &[&str] = CAM1_IRIS;
const BGH1_RESOLUTION: &[&str] = &["FHD", "UHD", "C4K"];
const BGH1_FRAME_RATE: &[&str] = &["25", "50"];

/// What one camera is and what it reports (D10).
#[derive(Debug, Clone, Copy)]
pub(crate) struct CameraModel {
    pub camera: u8,
    /// `CAM 1`, `CAM 2`, `CAM 3`.
    pub tag: &'static str,
    /// The camera's make and model.
    pub model: &'static str,
    pub link: CameraLink,
    /// Who a release hands the camera to: the iPad (CAM 1), LUMIX Tether
    /// (CAM 2, CAM 3).
    pub app: &'static str,
    /// A BGH1: no ND, tint, focus position, dynamic range, display LUT or
    /// recording here.
    bgh1: bool,
    iris: &'static [&'static str],
}

const MODELS: [CameraModel; 3] = [
    CameraModel {
        camera: 1,
        tag: "CAM 1",
        model: "Blackmagic Pocket Cinema Camera 6K Pro",
        link: CameraLink::Bluetooth,
        app: "the iPad",
        bgh1: false,
        iris: CAM1_IRIS,
    },
    CameraModel {
        camera: 2,
        tag: "CAM 2",
        model: "Panasonic LUMIX BGH1",
        link: CameraLink::Network,
        app: "LUMIX Tether",
        bgh1: true,
        iris: CAM2_IRIS,
    },
    CameraModel {
        camera: 3,
        tag: "CAM 3",
        model: "Panasonic LUMIX BGH1",
        link: CameraLink::Network,
        app: "LUMIX Tether",
        bgh1: true,
        iris: CAM3_IRIS,
    },
];

/// The model of camera `camera` (1, 2 or 3).
pub(crate) fn model(camera: u8) -> &'static CameraModel {
    &MODELS[usize::from(camera.clamp(1, 3)) - 1]
}

impl CameraModel {
    /// The values a choice allows, in order; the sentence that says why the
    /// camera does not report it otherwise.
    pub(crate) fn options(&self, setting: Setting) -> Result<&'static [&'static str], String> {
        let tag = self.tag;
        match (setting, self.bgh1) {
            (Setting::Iso, false) => Ok(CAM1_ISO),
            (Setting::Iso, true) => Ok(BGH1_ISO),
            (Setting::Shutter, false) => Ok(CAM1_SHUTTER),
            (Setting::Shutter, true) => Ok(BGH1_SHUTTER),
            (Setting::Iris, _) => Ok(self.iris),
            (Setting::Nd, false) => Ok(CAM1_ND),
            (Setting::Nd, true) => Err(String::from("The BGH1 has no ND filter.")),
            (Setting::Resolution, false) => Ok(CAM1_RESOLUTION),
            (Setting::Resolution, true) => Ok(BGH1_RESOLUTION),
            (Setting::FrameRate, false) => Ok(CAM1_FRAME_RATE),
            (Setting::FrameRate, true) => Ok(BGH1_FRAME_RATE),
            (Setting::DynamicRange, false) => Ok(CAM1_DYNAMIC_RANGE),
            (Setting::DynamicRange, true) => {
                Err(format!("{tag} does not report its dynamic range."))
            }
            (Setting::DisplayLut, false) => Ok(CAM1_DISPLAY_LUT),
            (Setting::DisplayLut | Setting::DisplayLutOn, true) => {
                Err(format!("{tag} does not report a display LUT."))
            }
            (Setting::DisplayLutOn, false) => Ok(&[]),
            (Setting::WhiteBalance | Setting::Tint | Setting::Focus, _) => Ok(&[]),
        }
    }

    /// A level's scale; the sentence that says why the camera does not
    /// report it otherwise.
    pub(crate) fn scale(&self, setting: Setting) -> Result<LevelScale, String> {
        let tag = self.tag;
        match (setting, self.bgh1) {
            (Setting::WhiteBalance, bgh1) => Ok(LevelScale {
                min: 2500.0,
                max: 10000.0,
                step: if bgh1 { 100.0 } else { 50.0 },
                unit: "K",
            }),
            (Setting::Tint, false) => Ok(LevelScale {
                min: -50.0,
                max: 50.0,
                step: 1.0,
                unit: "",
            }),
            (Setting::Tint, true) => Err(format!("{tag} does not report tint.")),
            (Setting::Focus, false) => Ok(LevelScale {
                min: 0.0,
                max: 1.0,
                step: 0.01,
                unit: "",
            }),
            (Setting::Focus, true) => Err(format!("{tag} does not report a focus position.")),
            _ => Err(format!(
                "{tag} does not report {} as a level.",
                setting.label()
            )),
        }
    }

    /// Why the camera does not report `setting`; `None` when it does.
    pub(crate) fn not_reported(&self, setting: Setting) -> Option<String> {
        if setting.is_level() {
            self.scale(setting).err()
        } else {
            self.options(setting).err()
        }
    }

    /// The frame rates the camera does not allow at `resolution`, with the
    /// reason: the Pocket 6K Pro has no 60p at 6K.
    pub(crate) fn unavailable_frame_rates(&self, resolution: &str) -> Vec<(&'static str, String)> {
        if !self.bgh1 && resolution == "6K" {
            vec![("60", String::from("not at 6K"))]
        } else {
            Vec::new()
        }
    }

    /// The one-shot autos it offers.
    pub(crate) fn autos(&self) -> CameraAutos {
        CameraAutos {
            focus: true,
            white_balance: !self.bgh1,
            iris: !self.bgh1,
        }
    }

    pub(crate) fn offers(&self, auto: AutoKind) -> bool {
        let autos = self.autos();
        match auto {
            AutoKind::Focus => autos.focus,
            AutoKind::WhiteBalance => autos.white_balance,
            AutoKind::Iris => autos.iris,
        }
    }

    /// Focus moves nearer and farther without a reported position.
    pub(crate) fn focus_steps(&self) -> bool {
        self.bgh1
    }

    /// It records here (D10, D14).
    pub(crate) fn records(&self) -> bool {
        !self.bgh1
    }

    /// It reports a timecode.
    pub(crate) fn timecode_reported(&self) -> bool {
        !self.bgh1
    }

    /// Why it does not report its card's time left; `None` for a camera that
    /// does not record here.
    pub(crate) fn card_time_not_reported(&self) -> Option<String> {
        (!self.bgh1).then(|| format!("{} does not report its card time over Bluetooth.", self.tag))
    }

    // -----------------------------------------------------------------------
    // The words
    // -----------------------------------------------------------------------

    /// The state's sentence. `unreachable` is the sentence of a held camera
    /// that does not answer, which depends on the link
    /// (`unreachable_sentence`, `no_link_sentence`). A camera that is not
    /// set up in a build with no link to it says that, not what to enter in
    /// Setup.
    pub(crate) fn state_sentence(
        &self,
        state: CameraState,
        has_link: bool,
        unreachable: &str,
    ) -> String {
        let tag = self.tag;
        match state {
            CameraState::NotSetUp if !has_link => self.no_link_sentence(),
            CameraState::Held => {
                format!("{tag} is held: Studio Control reads it and sends only what you press.")
            }
            CameraState::Released => format!(
                "{tag} is released to {}. Studio Control does not read it or send it anything until you connect it again.",
                self.app
            ),
            CameraState::NotSetUp if self.bgh1 => format!("{tag} has no address. Enter it in Setup."),
            CameraState::NotSetUp => format!(
                "{tag} is not paired. Pair it in Setup, with the camera beside you."
            ),
            CameraState::Unreachable => unreachable.to_string(),
        }
    }

    /// A held camera that does not answer.
    pub(crate) fn unreachable_sentence(&self, address: Option<&str>) -> String {
        let tag = self.tag;
        if self.bgh1 {
            format!(
                "{tag} does not answer at {}. Check that it is on and on the network.",
                address.unwrap_or("its address")
            )
        } else {
            format!(
                "{tag} does not answer over Bluetooth. Check that it is on and within reach of this PC."
            )
        }
    }

    /// A camera in a build with no link to it, before Slices 11 and 13.
    pub(crate) fn no_link_sentence(&self) -> String {
        format!(
            "Studio Control has no link to {} yet: it comes with a later version.",
            self.tag
        )
    }

    /// `CAMERA_NO_LINK`: why Setup cannot pair the camera or take its
    /// address in a build with no link to it.
    pub(crate) fn no_link_refusal(&self) -> String {
        if self.bgh1 {
            format!(
                "Studio Control cannot take {}'s address yet: its network link comes with a later version.",
                self.tag
            )
        } else {
            String::from(NO_LINK_TO_PAIR)
        }
    }

    /// `CAMERA_RELEASED`.
    pub(crate) fn released_refusal(&self) -> String {
        format!("{} is released. Connect it to set it from here.", self.tag)
    }

    /// `CAMERA_ALREADY_HELD`.
    pub(crate) fn already_held_refusal(&self) -> String {
        format!("{} is already held.", self.tag)
    }

    /// `CAMERA_SETTING_UNSUPPORTED` for an auto the camera does not offer.
    pub(crate) fn auto_refusal(&self, auto: AutoKind) -> String {
        format!("{} does not offer {} once.", self.tag, auto.words())
    }

    /// `CAMERA_VALUE_NOT_ALLOWED`: the value as it was sent.
    pub(crate) fn value_refusal(&self, setting: Setting, value: &str) -> String {
        format!("{} does not allow {} {value}.", self.tag, setting.label())
    }

    /// `CAMERA_FORMAT_NOT_ALLOWED`.
    pub(crate) fn format_refusal(&self, frame_rate: &str, resolution: &str) -> String {
        format!("{} does not allow {frame_rate}p at {resolution}.", self.tag)
    }

    /// The release's sentence (its answer and its Recent actions row).
    pub(crate) fn released_sentence(&self) -> String {
        format!("{} released to {}.", self.tag, self.app)
    }

    /// Connect's sentence when the camera is held again.
    pub(crate) fn held_again_sentence(&self) -> String {
        format!("{} held again.", self.tag)
    }
}

impl CameraState {
    /// `HELD`, `RELEASED`, `NOT SET UP`, `UNREACHABLE`.
    pub(crate) fn word(self) -> &'static str {
        match self {
            Self::Held => "HELD",
            Self::Released => "RELEASED",
            Self::NotSetUp => "NOT SET UP",
            Self::Unreachable => "UNREACHABLE",
        }
    }

    pub(crate) fn tone(self) -> CameraTone {
        match self {
            Self::Held => CameraTone::Ok,
            Self::Released | Self::NotSetUp => CameraTone::Attention,
            Self::Unreachable => CameraTone::Error,
        }
    }

    /// The state's name in the answers (`held`, `not-set-up`, …).
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Held => "held",
            Self::Released => "released",
            Self::NotSetUp => "not-set-up",
            Self::Unreachable => "unreachable",
        }
    }
}

/// `CAMERA_CHANGE_NOT_CONFIRMED`.
pub(crate) const NOT_CONFIRMED: &str = "This change needs a second press to confirm.";
/// `CAMERA_ALREADY_RECORDING`.
pub(crate) const ALREADY_RECORDING: &str = "CAM 1 is already recording.";
/// `CAMERA_NOT_RECORDING`.
pub(crate) const NOT_RECORDING: &str = "CAM 1 is not recording.";
/// `CAMERA_NO_LINK` for CAM 1 (`CameraModel::no_link_refusal`).
pub(crate) const NO_LINK_TO_PAIR: &str =
    "Studio Control cannot pair CAM 1 yet: its Bluetooth link comes with a later version.";
/// The record's sentences (its answers and its Recent actions rows).
pub(crate) const STARTED_RECORDING: &str = "CAM 1 started recording.";
pub(crate) const STOPPED_RECORDING: &str = "CAM 1 stopped recording.";

/// What an archive restore says of the addresses it left out, in a build
/// with no link to those cameras; `None` when it left none out.
pub(crate) fn addresses_not_restored(cameras: &[u8]) -> Option<String> {
    if cameras.is_empty() {
        return None;
    }
    let whose: Vec<String> = cameras
        .iter()
        .map(|camera| format!("{}'s", model(*camera).tag))
        .collect();
    let (what, which) = if whose.len() == 1 {
        ("address was", "it")
    } else {
        ("addresses were", "them")
    };
    Some(format!(
        "{} {what} not restored: Studio Control has no link to {which} yet.",
        whose.join(" and ")
    ))
}

/// `CAMERA_ADDRESS_INVALID`.
pub(crate) fn address_refusal(value: &str) -> String {
    format!(
        "{value} is not the address of one machine. Enter the camera's IPv4 address: four numbers from 0 to 255, such as 172.16.16.85."
    )
}

/// An IPv4 address of one machine, as Setup takes it (D15 rule 1): four
/// decimal numbers from 0 to 255 (no sign), trimmed; not `0.0.0.0`, the
/// broadcast `255.255.255.255` or a multicast address (`224.0.0.0/4`). The
/// address as the camera's link will use it (`010.0.0.1` is `10.0.0.1`);
/// `None` when it is not one.
pub(crate) fn parse_camera_address(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.trim().split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (octet, part) in octets.iter_mut().zip(&parts) {
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        *octet = part
            .parse::<u16>()
            .ok()
            .and_then(|n| u8::try_from(n).ok())?;
    }
    let address = std::net::Ipv4Addr::from(octets);
    if address.is_unspecified() || address.is_broadcast() || address.is_multicast() {
        return None;
    }
    Some(address.to_string())
}
