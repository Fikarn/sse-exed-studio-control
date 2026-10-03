//! Whether the rig holds a scene (2026-10-03): the one answer the screen and
//! the deck read. Until then only the Lighting page decided "unsaved", in
//! `lightingDrift.ts`, and the deck could not say whether a recall would
//! change the rig. The page's rules are kept: a fixture the scene does not
//! hold counts only while it is lit, intensity is compared within half a
//! percent, colour temperature within 25 K and only on a fixture that has it,
//! and every other control within half a step.
//!
//! The rig is compared as it will stand when a running fade ends, and without
//! the identify, highlight and solo overlays, which exist only at render
//! time: a scene being faded in is on the rig, and a highlighted fixture
//! changes nothing that is saved.

use super::helpers::{
    effective_fixture_control_values, fixture_profile_for_state, read_optional_setting,
};
use super::types::{LightingEditorFixtureState, LightingEditorSceneState, LightingEditorState};
use super::LIGHTING_LAST_RECALLED_SCENE_ID_KEY;
use std::borrow::Cow;
use std::collections::HashMap;

/// The chosen scene is on the rig, as it was saved.
pub const SCENE_STATE_LIVE: &str = "live";
/// The chosen scene was put on the rig, and the rig has changed since.
pub const SCENE_STATE_UNSAVED: &str = "unsaved";
/// A scene is chosen, and a recall would change the rig to it.
pub const SCENE_STATE_CHOSEN: &str = "chosen";
/// Preview is on: what a key or a recall changes is staged, not on the rig.
pub const SCENE_STATE_PREVIEW: &str = "preview";
/// No scene is chosen: there are none.
pub const SCENE_STATE_NONE: &str = "none";

/// Every word the scene's state can be, as the deck's colour rules match
/// them letter for letter.
#[cfg(test)]
pub const SCENE_STATES: [&str; 5] = [
    SCENE_STATE_LIVE,
    SCENE_STATE_UNSAVED,
    SCENE_STATE_CHOSEN,
    SCENE_STATE_PREVIEW,
    SCENE_STATE_NONE,
];

/// The state of `chosen` (a scene's id) against the rig: `preview` while
/// previewing, `none` when no scene of the rig's is chosen, `chosen` when it
/// is not the scene last put on the rig, and otherwise `live` or `unsaved`
/// as the rig still holds it or not.
pub(crate) fn scene_state(
    state: &LightingEditorState,
    chosen: Option<&str>,
    last_recalled: Option<&str>,
    previewing: bool,
) -> &'static str {
    if previewing {
        return SCENE_STATE_PREVIEW;
    }
    let Some(scene) = chosen.and_then(|id| state.scenes.iter().find(|scene| scene.id == id)) else {
        return SCENE_STATE_NONE;
    };
    if last_recalled != Some(scene.id.as_str()) {
        return SCENE_STATE_CHOSEN;
    }
    if rig_holds_scene(&rig_at_fade_end(state), scene) {
        SCENE_STATE_LIVE
    } else {
        SCENE_STATE_UNSAVED
    }
}

/// `scene_state` with the scene last put on the rig read from the saved
/// data: the deck's RECALL and SCENE cell (`control_surface`).
pub(crate) fn scene_state_in(
    settings: &HashMap<String, String>,
    state: &LightingEditorState,
    chosen: Option<&str>,
    previewing: bool,
) -> &'static str {
    let last_recalled = read_optional_setting(settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY);
    scene_state(state, chosen, last_recalled.as_deref(), previewing)
}

/// The rig as it stands once a running fade has ended: a recall with a fade
/// keeps the fixtures where they were and fades to the scene's states
/// (`fade.rs`).
fn rig_at_fade_end(state: &LightingEditorState) -> Cow<'_, [LightingEditorFixtureState]> {
    let Some(fade) = &state.active_fade else {
        return Cow::Borrowed(&state.fixtures);
    };
    let mut fixtures = state.fixtures.clone();
    for fixture in &mut fixtures {
        if let Some(target) = fade
            .target_fixture_states
            .iter()
            .find(|target| target.fixture_id == fixture.id)
        {
            fixture.on = target.on;
            fixture.intensity = target.intensity;
            fixture.cct = target.cct;
            fixture.control_values = target.control_values.clone();
        }
    }
    Cow::Owned(fixtures)
}

/// Whether the fixtures hold the scene's saved states.
pub(crate) fn rig_holds_scene(
    fixtures: &[LightingEditorFixtureState],
    scene: &LightingEditorSceneState,
) -> bool {
    fixtures.iter().all(|fixture| {
        let Some(saved) = scene
            .fixture_states
            .iter()
            .find(|state| state.fixture_id == fixture.id)
        else {
            // A fixture the scene does not hold drifts only while it is lit.
            return !(fixture.on && fixture.intensity > 0);
        };
        if saved.on != fixture.on {
            return false;
        }
        let has_cct = fixture_profile_for_state(fixture)
            .capabilities
            .iter()
            .any(|capability| capability == "cct");
        if saved.on {
            if (saved.intensity - fixture.intensity).abs() > 0 {
                return false;
            }
            if has_cct && (saved.cct - fixture.cct).abs() > 25 {
                return false;
            }
        }
        let current = effective_fixture_control_values(fixture);
        current
            .keys()
            .chain(saved.control_values.keys())
            .filter(|key| key.as_str() != "intensity" && key.as_str() != "cct")
            .all(|key| {
                let now = current.get(key).copied().unwrap_or(0);
                let then = saved.control_values.get(key).copied().unwrap_or(0);
                (now - then).abs() == 0
            })
    })
}
