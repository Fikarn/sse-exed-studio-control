//! The cameras' pictures as the hardware link reports them (D17, D28): for
//! each camera whether its picture arrives, and for the three what the state
//! display, the Pictures section and the footer say. The words are board 2's
//! (`docs/design/boards/A-cameras-2.html`, the states `no-pictures` and
//! `one-picture`).
//!
//! No studio build receives the cameras' own pictures yet: they come over
//! NDI from vMix's Outputs 2 to 4 on this PC with the studio build's step
//! (D31). Until then:
//!
//! - a build without the simulated cameras (the studio's) reads
//!   `NO PICTURES`, and says they come with a later version;
//! - a development run has the pictures helper, which the hardware link
//!   supervises (`pictures_helper.rs`): what it says it receives is what the
//!   page shows, and while it starts, restarts or is missing, `NO PICTURES`
//!   says so. Its source is the simulated one, or vMix's outputs in a run
//!   started with `npm run app -- --vmix-pictures` (D33), whose words name
//!   the outputs;
//! - with the simulated cameras and no helper (the engine's unit tests, a
//!   studio build's lanes) the simulated source's rule stands in for it.
//!
//! With vMix's pictures each camera's comes from its own output, fixed
//! (CAM 1 Output 2, CAM 2 Output 3, CAM 3 Output 4: `vmix_output`), and what
//! the rows say names it. The simulated source sends vMix inputs 1 to 4: a
//! camera whose saved input is another reads `PICTURE MISSING` (Setup no
//! longer offers the input; a fixture or a test sets it). A picture is
//! vMix's, not the camera's link's: a camera that is released, not set up or
//! does not answer keeps its picture.

use crate::cameras::model::{model, CAMERA_NUMBERS};
use crate::cameras::runtime::Cameras;
use crate::cameras::snapshot::{CameraPicture, CameraTone, CamerasPictures, PictureState};
use crate::pictures_helper::{helper, HelperStatus};
use studio_control_protocol::pictures::{
    vmix_output, HelperProblem, HelperSource, ReceivedCamera, SIMULATED_VMIX_INPUTS,
};

/// Where this build's pictures come from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PictureSource {
    /// No build receives the cameras' own pictures yet.
    NotBuilt,
    /// The simulated source's rule, with no helper to ask.
    Simulated,
    /// The pictures helper: the source it is told, and what it last said.
    Helper(HelperSource, HelperStatus),
}

/// Why no picture arrives at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Nothing {
    /// The pictures are not built in this build.
    NotBuilt,
    /// The helper started and has not said what it receives yet.
    Starting,
    /// The helper ended or went silent, and is started again.
    Stopped,
    /// The helper's program is not in this build.
    NoProgram,
    /// vMix sends none of its three outputs: it is closed, or they are not
    /// sent over NDI.
    NotSending,
    /// The helper was told vMix's pictures and does not take them.
    NotAllowed,
    /// NDI's library did not load.
    NoLibrary,
}

impl Nothing {
    /// The state display's sentence.
    fn sentence(self) -> String {
        String::from(match self {
            Self::NotBuilt => "Studio Control shows no pictures yet: they come with a later version, over NDI from vMix on this PC.",
            Self::Starting => "The pictures are starting.",
            Self::Stopped => "The pictures stopped. Studio Control starts them again.",
            Self::NoProgram => "The picture program is not beside this build, so it shows no pictures. npm run app builds it.",
            Self::NotSending => "No pictures from vMix. Open vMix and send Outputs 2, 3 and 4 over NDI.",
            Self::NotAllowed => "This run does not take vMix's pictures, so it shows none.",
            Self::NoLibrary => "NDI's library did not load, so there are no pictures from vMix.",
        })
    }

    /// In the picture's place.
    fn camera_sentence(self, tag: &str) -> String {
        match self {
            Self::NotBuilt => {
                String::from("No picture yet: the cameras' pictures come with a later version.")
            }
            Self::NotSending => format!("vMix is not sending {tag} over NDI."),
            Self::Starting
            | Self::Stopped
            | Self::NoProgram
            | Self::NotAllowed
            | Self::NoLibrary => self.sentence(),
        }
    }

    /// What to check, under it.
    fn advice(self) -> Option<String> {
        (self == Self::NotSending).then(|| {
            String::from(
                "Either vMix is closed, or its Outputs 2, 3 and 4 are not sent over NDI (Settings › Outputs).",
            )
        })
    }

    /// What arrives, in the Pictures rows (`PictureSource::detail`).
    fn detail(self) -> &'static str {
        match self {
            Self::NotBuilt => "not built yet",
            Self::Starting => "starting",
            Self::Stopped => "stopped",
            Self::NoProgram => "no picture program",
            Self::NotSending => "nothing received",
            Self::NotAllowed => "not taken",
            Self::NoLibrary => "NDI not loaded",
        }
    }
}

impl PictureSource {
    pub(crate) fn of(cameras: &Cameras) -> Self {
        match helper(&cameras.db_path) {
            Some((source, status)) => Self::Helper(source, status),
            None if cameras.simulated => Self::Simulated,
            None => Self::NotBuilt,
        }
    }

    /// The pictures come from vMix's outputs.
    fn vmix(&self) -> bool {
        matches!(self, Self::Helper(HelperSource::Vmix, _))
    }

    /// Why no picture arrives at all; `None` when the source sends.
    fn nothing(&self) -> Option<Nothing> {
        match self {
            Self::NotBuilt => Some(Nothing::NotBuilt),
            Self::Simulated => None,
            Self::Helper(_, HelperStatus::Starting) => Some(Nothing::Starting),
            Self::Helper(_, HelperStatus::Restarting) => Some(Nothing::Stopped),
            Self::Helper(_, HelperStatus::Missing) => Some(Nothing::NoProgram),
            Self::Helper(
                _,
                HelperStatus::Running {
                    problem: Some(problem),
                    ..
                },
            ) => Some(match problem {
                HelperProblem::NotAllowed => Nothing::NotAllowed,
                HelperProblem::NoLibrary => Nothing::NoLibrary,
            }),
            Self::Helper(_, HelperStatus::Running { sending, .. }) => {
                (!sending).then_some(Nothing::NotSending)
            }
        }
    }

    /// What the helper said of camera `camera`, for the input it was told.
    /// Until it answers a changed input, nothing is claimed for it.
    fn received(&self, camera: u8, vmix_input: u32) -> Option<&ReceivedCamera> {
        match self {
            Self::Helper(_, HelperStatus::Running { cameras, .. }) => cameras
                .iter()
                .find(|received| received.camera == camera && received.vmix_input == vmix_input),
            _ => None,
        }
    }

    /// Camera `camera`'s picture arrives, while the source sends.
    fn carries(&self, camera: u8, vmix_input: u32) -> bool {
        match self {
            Self::Helper(_, HelperStatus::Running { .. }) => self
                .received(camera, vmix_input)
                .is_some_and(|received| received.receiving),
            _ => SIMULATED_VMIX_INPUTS.contains(&vmix_input),
        }
    }

    /// What arrives of camera `camera`, as the Pictures rows and the page
    /// print it: `what`, after the camera's output with vMix's pictures
    /// (`vMix Output 4 · nothing received`), alone with the test pictures.
    fn detail(&self, camera: u8, what: &str) -> String {
        match (self.vmix(), vmix_output(camera)) {
            (true, Some(output)) => format!("vMix Output {output} · {what}"),
            _ => String::from(what),
        }
    }

    /// What arrives while the picture does: the test picture, or vMix's
    /// output with its size and rate (`vMix Output 2 · 3840 × 2160 ·
    /// 29.97`).
    fn live_detail(&self, camera: u8, vmix_input: u32) -> String {
        match (self.vmix(), vmix_output(camera)) {
            (true, Some(output)) => match self
                .received(camera, vmix_input)
                .and_then(|received| received.format)
            {
                Some(format) => self.detail(camera, &format.words()),
                None => format!("vMix Output {output}"),
            },
            _ => String::from("test picture"),
        }
    }

    /// Where the pictures come from, as the Pictures section and the footer
    /// say it.
    fn words(&self) -> &'static str {
        match self {
            Self::NotBuilt => "not built yet",
            Self::Helper(HelperSource::Vmix, _) => "vMix Outputs 2 to 4",
            Self::Simulated | Self::Helper(HelperSource::Simulated, _) => "test pictures",
        }
    }

    /// The Pictures section's fine print.
    fn note(&self) -> String {
        match self {
            Self::NotBuilt => String::from(
                "The cameras' own pictures come with a later version, over NDI from vMix on this PC.",
            ),
            Self::Helper(HelperSource::Vmix, _) => format!(
                "The pictures come over NDI from vMix's Outputs 2, 3 and 4 on this PC: CAM 1 from Output {}, CAM 2 from Output {}, CAM 3 from Output {}.",
                vmix_output(1).unwrap_or_default(),
                vmix_output(2).unwrap_or_default(),
                vmix_output(3).unwrap_or_default()
            ),
            Self::Simulated | Self::Helper(HelperSource::Simulated, _) => format!(
                "Test pictures stand in for vMix inputs {} to {}. The cameras' own come with a later version, over NDI from vMix on this PC.",
                SIMULATED_VMIX_INPUTS.start(),
                SIMULATED_VMIX_INPUTS.end()
            ),
        }
    }
}

/// One camera's picture: it arrives, the source sends others and not this
/// one, or no picture arrives at all.
fn camera_picture(source: &PictureSource, camera: u8, vmix_input: u32) -> CameraPicture {
    let tag = model(camera).tag;
    if let Some(nothing) = source.nothing() {
        return CameraPicture {
            state: PictureState::NoPictures,
            word: String::from(NO_PICTURE),
            tone: CameraTone::Attention,
            detail: source.detail(camera, nothing.detail()),
            sentence: Some(nothing.camera_sentence(tag)),
            advice: nothing.advice(),
        };
    }
    if source.carries(camera, vmix_input) {
        return CameraPicture {
            state: PictureState::Showing,
            word: String::from("LIVE"),
            tone: CameraTone::Ok,
            detail: source.live_detail(camera, vmix_input),
            sentence: None,
            advice: None,
        };
    }
    let advice = match (source.vmix(), vmix_output(camera)) {
        (true, Some(output)) => format!(
            "vMix sends other outputs: check that Output {output} is on and sent over NDI (Settings › Outputs)."
        ),
        _ => format!(
            "vMix sends other inputs: check that vMix input {vmix_input} is still there and live."
        ),
    };
    CameraPicture {
        state: PictureState::Missing,
        word: String::from(NO_PICTURE),
        tone: CameraTone::Attention,
        detail: source.detail(camera, "nothing received"),
        sentence: Some(format!("vMix is not sending {tag} over NDI.")),
        advice: Some(advice),
    }
}

/// A picture that does not arrive, in its place on the page.
const NO_PICTURE: &str = "NO PICTURE";

impl Cameras {
    /// Camera `camera`'s picture.
    pub(crate) fn picture(&self, camera: u8) -> CameraPicture {
        camera_picture(
            &PictureSource::of(self),
            camera,
            self.camera(camera).setup.vmix_input,
        )
    }

    /// The three pictures together. When not every picture arrives, the
    /// state display speaks of one camera: the selected one when its picture
    /// is missing, otherwise the first whose picture is.
    pub(crate) fn pictures(&self) -> CamerasPictures {
        let source = PictureSource::of(self);
        let missing: Vec<u8> = CAMERA_NUMBERS
            .into_iter()
            .filter(|camera| {
                camera_picture(&source, *camera, self.camera(*camera).setup.vmix_input).state
                    != PictureState::Showing
            })
            .collect();
        let spoken = missing
            .iter()
            .copied()
            .find(|camera| *camera == self.selected)
            .or_else(|| missing.first().copied());
        let (state, word, sentence) = match (source.nothing(), spoken) {
            (Some(nothing), _) => (
                PictureState::NoPictures,
                Some(String::from("NO PICTURES")),
                Some(nothing.sentence()),
            ),
            (None, Some(camera)) => {
                let tag = model(camera).tag;
                let sentence = match (source.vmix(), vmix_output(camera)) {
                    (true, Some(output)) => format!(
                        "vMix sends no picture for {tag}. Check that vMix's Output {output} is on and sent over NDI."
                    ),
                    _ => {
                        let input = self.camera(camera).setup.vmix_input;
                        format!(
                            "vMix sends no picture for {tag}. Check that vMix input {input} is still there and live."
                        )
                    }
                };
                (
                    PictureState::Missing,
                    Some(String::from("PICTURE MISSING")),
                    Some(sentence),
                )
            }
            (None, None) => (PictureState::Showing, None, None),
        };
        CamerasPictures {
            state,
            word,
            tone: if state == PictureState::Showing {
                CameraTone::Ok
            } else {
                CameraTone::Attention
            },
            sentence,
            source: String::from(source.words()),
            note: source.note(),
        }
    }
}
