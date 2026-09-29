//! What the cameras read out: `cameras.snapshot` and `checks.cameras` in
//! `health.snapshot`, built from what the hardware link holds — each value
//! as the camera last reported it, never what was merely sent (D10).

use crate::cameras::model::{model, CameraModel, Setting, CAMERA_NUMBERS, RECORDING_CAMERA};
use crate::cameras::runtime::{CameraRuntime, Cameras};
use crate::cameras::simulated::CameraReading;
use crate::cameras::snapshot::{
    CameraChoice, CameraDials, CameraHealthEntry, CameraLevel, CameraPicture, CameraRecentAction,
    CameraRecording, CameraSnapshot, CameraState, CameraSwitch, CameraTone, CameraUnavailable,
    CameraValues, CamerasHealthCheck, CamerasSnapshot, PictureState,
};

fn choice(model: &CameraModel, reading: &CameraReading, setting: Setting) -> CameraChoice {
    match model.options(setting) {
        Ok(options) => {
            let value = reading.text(setting).map(str::to_string);
            let unavailable = if setting == Setting::FrameRate {
                reading
                    .resolution
                    .as_deref()
                    .map(|resolution| model.unavailable_frame_rates(resolution))
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(value, reason)| CameraUnavailable {
                        value: String::from(value),
                        reason,
                    })
                    .collect()
            } else {
                Vec::new()
            };
            CameraChoice {
                reported: true,
                value,
                options: options.iter().map(|option| String::from(*option)).collect(),
                unavailable,
                not_reported: None,
            }
        }
        Err(sentence) => CameraChoice {
            reported: false,
            value: None,
            options: Vec::new(),
            unavailable: Vec::new(),
            not_reported: Some(sentence),
        },
    }
}

fn level(model: &CameraModel, reading: &CameraReading, setting: Setting) -> CameraLevel {
    match model.scale(setting) {
        Ok(scale) => CameraLevel {
            reported: true,
            value: reading.number(setting),
            min: scale.min,
            max: scale.max,
            step: scale.step,
            unit: String::from(scale.unit),
            not_reported: None,
        },
        // A level the camera does not report has no scale to show.
        Err(sentence) => CameraLevel {
            reported: false,
            value: None,
            min: 0.0,
            max: 0.0,
            step: 0.0,
            unit: String::new(),
            not_reported: Some(sentence),
        },
    }
}

fn values(model: &CameraModel, reading: &CameraReading) -> CameraValues {
    let lut_on = model.not_reported(Setting::DisplayLutOn);
    CameraValues {
        iso: choice(model, reading, Setting::Iso),
        shutter: choice(model, reading, Setting::Shutter),
        iris: choice(model, reading, Setting::Iris),
        nd: choice(model, reading, Setting::Nd),
        white_balance: level(model, reading, Setting::WhiteBalance),
        tint: level(model, reading, Setting::Tint),
        focus: level(model, reading, Setting::Focus),
        resolution: choice(model, reading, Setting::Resolution),
        frame_rate: choice(model, reading, Setting::FrameRate),
        dynamic_range: choice(model, reading, Setting::DynamicRange),
        display_lut: choice(model, reading, Setting::DisplayLut),
        display_lut_on: CameraSwitch {
            reported: lut_on.is_none(),
            value: reading.display_lut_on.filter(|_| lut_on.is_none()),
            not_reported: lut_on,
        },
    }
}

/// One camera as `cameras.snapshot` shows it, with its picture. A camera
/// never read since the start, or released, shows no value; an unreachable
/// one keeps what it last reported, and when.
pub(crate) fn camera_snapshot(runtime: &CameraRuntime, picture: CameraPicture) -> CameraSnapshot {
    let model = model(runtime.camera());
    let state = runtime.state();
    let shown = matches!(state, CameraState::Held | CameraState::Unreachable);
    let empty = CameraReading::default();
    let reading = runtime.reading.as_ref().filter(|_| shown).unwrap_or(&empty);
    let recording = reading.recording.filter(|_| model.records());
    CameraSnapshot {
        camera: model.camera,
        tag: String::from(model.tag),
        model: String::from(model.model),
        link: model.link,
        setup: runtime.setup_summary(),
        state,
        word: String::from(state.word()),
        tone: state.tone(),
        sentence: runtime.sentence(),
        read_at: runtime.read_at.clone().filter(|_| shown),
        values: values(model, reading),
        auto: model.autos(),
        focus_steps: model.focus_steps(),
        recording: CameraRecording {
            records: model.records(),
            recording,
            timecode: reading
                .timecode
                .clone()
                .filter(|_| model.timecode_reported()),
            timecode_reported: model.timecode_reported(),
            started_at: runtime
                .started_at
                .clone()
                .filter(|_| shown && recording == Some(true)),
            card_time_left: None,
            card_time_not_reported: model.card_time_not_reported(),
        },
        picture,
    }
}

impl Cameras {
    /// `cameras.snapshot`, with the cameras' Recent actions as the action
    /// log holds them (`None` when it could not be read).
    pub(crate) fn snapshot(&self, recent: Option<Vec<CameraRecentAction>>) -> CamerasSnapshot {
        CamerasSnapshot {
            selected: self.selected,
            dials: self.dials(),
            cameras: self
                .all()
                .iter()
                .map(|runtime| camera_snapshot(runtime, self.picture(runtime.camera())))
                .collect(),
            pictures: self.pictures(),
            recent,
        }
    }

    /// What the deck's dials set, as the snapshot says it.
    pub(crate) fn dials(&self) -> CameraDials {
        CameraDials {
            bank: self.bank,
            sets: self
                .bank
                .dials()
                .into_iter()
                .map(|setting| setting.map(|setting| String::from(setting.key())))
                .collect(),
        }
    }

    /// `checks.cameras`: the worst camera's state and sentence (the state
    /// latest in `CameraState`'s order; among equals, the lowest number), and
    /// whether CAM 1 records. While every camera is held, the pictures speak
    /// instead when not every one arrives (board 2's `no-pictures`): the
    /// Cameras lamp reads `no pictures` or `picture missing`.
    pub(crate) fn health_check(&self) -> CamerasHealthCheck {
        let cameras: Vec<CameraHealthEntry> = self
            .all()
            .iter()
            .map(|runtime| {
                let state = runtime.state();
                CameraHealthEntry {
                    camera: runtime.camera(),
                    tag: String::from(model(runtime.camera()).tag),
                    state,
                    word: String::from(state.word()),
                    tone: state.tone(),
                    sentence: runtime.sentence(),
                }
            })
            .collect();
        let worst = cameras
            .iter()
            .fold(None::<&CameraHealthEntry>, |worst, entry| match worst {
                Some(worst) if worst.state >= entry.state => Some(worst),
                _ => Some(entry),
            })
            .cloned()
            .expect("three cameras");
        let recording = camera_snapshot(
            self.camera(RECORDING_CAMERA),
            self.picture(RECORDING_CAMERA),
        )
        .recording
        .recording
            == Some(true);
        debug_assert_eq!(cameras.len(), CAMERA_NUMBERS.len());
        let pictures = self.pictures();
        let (status, word, summary) =
            match (worst.tone, pictures.state, pictures.word, pictures.sentence) {
                (CameraTone::Ok, state, Some(word), Some(sentence))
                    if state != PictureState::Showing =>
                {
                    (pictures.tone, word, sentence)
                }
                _ => (worst.tone, worst.word, worst.sentence),
            };
        CamerasHealthCheck {
            ok: status == CameraTone::Ok,
            status,
            word,
            summary,
            recording,
            cameras,
        }
    }
}

impl CamerasHealthCheck {
    /// The camera that takes the whole status to attention (the slice's
    /// first step 3): a held camera that does not answer — one that is set
    /// up and not released. A camera not set up or released lights the
    /// Cameras lamp only.
    fn counted(&self) -> Option<&CameraHealthEntry> {
        self.cameras
            .iter()
            .find(|entry| entry.state == CameraState::Unreachable)
    }

    /// The whole status takes attention from the cameras, at most.
    pub(crate) fn raises_whole_status(&self) -> bool {
        self.counted().is_some()
    }

    /// The sentence the top-level summary ends with after ` Cameras: `.
    pub(crate) fn whole_status_sentence(&self) -> Option<&str> {
        self.counted().map(|entry| entry.sentence.as_str())
    }
}
