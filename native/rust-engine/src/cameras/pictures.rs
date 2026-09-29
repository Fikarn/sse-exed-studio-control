//! The cameras' pictures as the hardware link reports them (D17, D28): for
//! each camera whether its picture arrives, and for the three what the state
//! display, the Pictures section and the footer say. The words are board 2's
//! (`docs/design/boards/A-cameras-2.html`, the states `no-pictures` and
//! `one-picture`).
//!
//! No build receives the cameras' own pictures yet: they come over NDI from
//! vMix on this PC with a later version. Until then a build without the
//! simulated cameras (the studio's) reads `NO PICTURES`, and the simulated
//! cameras' test pictures stand in for vMix inputs 1 to 4, so a camera on
//! another input reads `PICTURE MISSING` and the page's states can be tried
//! in a development run. A picture is vMix's, not the camera's link's: a
//! camera that is released, not set up or does not answer keeps its picture.

use crate::cameras::model::{model, CAMERA_NUMBERS};
use crate::cameras::runtime::Cameras;
use crate::cameras::snapshot::{CameraPicture, CameraTone, CamerasPictures, PictureState};
use std::ops::RangeInclusive;

/// The vMix inputs the simulated cameras' test pictures stand in for: the
/// four DeckLink inputs of the studio's vMix preset.
pub(crate) const SIMULATED_VMIX_INPUTS: RangeInclusive<u32> = 1..=4;

/// Where this build's pictures come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PictureSource {
    /// No build receives the cameras' own pictures yet.
    NotBuilt,
    /// The simulated cameras' test pictures (`SSE_CAMERAS_SIMULATED=1`).
    Simulated,
}

impl PictureSource {
    pub(crate) fn of(cameras: &Cameras) -> Self {
        if cameras.simulated {
            Self::Simulated
        } else {
            Self::NotBuilt
        }
    }

    /// Where the pictures come from, as the Pictures section and the footer
    /// say it.
    fn words(self) -> &'static str {
        match self {
            Self::NotBuilt => "not built yet",
            Self::Simulated => "test pictures",
        }
    }

    /// The Pictures section's fine print.
    fn note(self) -> String {
        match self {
            Self::NotBuilt => String::from(
                "The cameras' own pictures come with a later version, over NDI from vMix on this PC.",
            ),
            Self::Simulated => format!(
                "Test pictures stand in for vMix inputs {} to {}. The cameras' own come with a later version, over NDI from vMix on this PC.",
                SIMULATED_VMIX_INPUTS.start(),
                SIMULATED_VMIX_INPUTS.end()
            ),
        }
    }

    /// The source sends pictures at all.
    fn sends(self) -> bool {
        self == Self::Simulated
    }

    /// The source sends this vMix input's picture; `None` when it sends no
    /// picture at all.
    fn carries(self, vmix_input: u32) -> Option<bool> {
        self.sends()
            .then(|| SIMULATED_VMIX_INPUTS.contains(&vmix_input))
    }
}

/// One camera's picture: it arrives, the source sends others and not this
/// one, or no picture arrives at all.
fn camera_picture(source: PictureSource, camera: u8, vmix_input: u32) -> CameraPicture {
    let tag = model(camera).tag;
    match source.carries(vmix_input) {
        Some(true) => CameraPicture {
            state: PictureState::Showing,
            word: String::from("LIVE"),
            tone: CameraTone::Ok,
            detail: String::from("test picture"),
            sentence: None,
            advice: None,
        },
        Some(false) => CameraPicture {
            state: PictureState::Missing,
            word: String::from(NO_PICTURE),
            tone: CameraTone::Attention,
            detail: String::from("nothing received"),
            sentence: Some(format!("vMix is not sending {tag} over NDI.")),
            advice: Some(format!(
                "vMix sends other inputs: check that vMix input {vmix_input} is still there and live."
            )),
        },
        None => CameraPicture {
            state: PictureState::NoPictures,
            word: String::from(NO_PICTURE),
            tone: CameraTone::Attention,
            detail: String::from(source.words()),
            sentence: Some(String::from(
                "No picture yet: the cameras' pictures come with a later version.",
            )),
            advice: None,
        },
    }
}

/// A picture that does not arrive, in its place on the page.
const NO_PICTURE: &str = "NO PICTURE";

impl Cameras {
    /// Camera `camera`'s picture.
    pub(crate) fn picture(&self, camera: u8) -> CameraPicture {
        camera_picture(
            PictureSource::of(self),
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
            .filter(|camera| self.picture(*camera).state != PictureState::Showing)
            .collect();
        let spoken = missing
            .iter()
            .copied()
            .find(|camera| *camera == self.selected)
            .or_else(|| missing.first().copied());
        let (state, word, sentence) = match (source.sends(), spoken) {
            (false, _) => (
                PictureState::NoPictures,
                Some(String::from("NO PICTURES")),
                Some(String::from(
                    "Studio Control shows no pictures yet: they come with a later version, over NDI from vMix on this PC.",
                )),
            ),
            (true, Some(camera)) => {
                let tag = model(camera).tag;
                let input = self.camera(camera).setup.vmix_input;
                (
                    PictureState::Missing,
                    Some(String::from("PICTURE MISSING")),
                    Some(format!(
                        "vMix sends no picture for {tag}. Check that vMix input {input} is still there and live."
                    )),
                )
            }
            (true, None) => (PictureState::Showing, None, None),
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
