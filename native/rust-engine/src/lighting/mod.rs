const DEFAULT_UNIVERSE: i64 = 1;
const DEFAULT_FIXTURE_INTENSITY: i64 = 100;
const DEFAULT_FIXTURE_CCT: i64 = 4500;
const MIN_FIXTURE_CCT: i64 = 2000;
const MAX_FIXTURE_CCT: i64 = 10000;

const LIGHTING_LAST_RECALLED_SCENE_ID_KEY: &str = "app.lighting.last_recalled_scene_id";
const LIGHTING_LAST_SCENE_RECALL_AT_KEY: &str = "app.lighting.last_scene_recall_at";
const LIGHTING_LAST_ACTION_STATUS_KEY: &str = "app.lighting.last_action_status";
const LIGHTING_LAST_ACTION_CODE_KEY: &str = "app.lighting.last_action_code";
const LIGHTING_LAST_ACTION_MESSAGE_KEY: &str = "app.lighting.last_action_message";
const LIGHTING_EDITOR_STATE_KEY: &str = "app.lighting.editor.state";
const LEGACY_LIGHTING_EDITOR_STATE_KEY: &str = "app.control_surface.lighting.state";
pub const LIGHTING_SELECTED_FIXTURE_ID_KEY: &str = "app.control_surface.selected_light_id";
const LIGHTING_ENABLED_KEY: &str = "app.lighting.enabled";
const LIGHTING_GRAND_MASTER_KEY: &str = "app.lighting.grand_master";
const LIGHTING_SELECTED_SCENE_ID_KEY: &str = "app.lighting.selected_scene_id";
const LIGHTING_CAMERA_MARKER_KEY: &str = "app.lighting.camera_marker";
const LIGHTING_SUBJECT_MARKER_KEY: &str = "app.lighting.subject_marker";
const LIGHTING_FIXTURE_STATE_PREFIX: &str = "app.lighting.fixture.";
const LIGHTING_CUSTOM_FIXTURE_ID_PREFIX: &str = "fixture-custom-";
const LIGHTING_CUSTOM_GROUP_ID_PREFIX: &str = "group-custom-";
const LIGHTING_CUSTOM_SCENE_ID_PREFIX: &str = "scene-custom-";
const LIGHTING_CUSTOM_CUE_ID_PREFIX: &str = "cue-custom-";
const DEFAULT_LIGHTING_FIXTURE_TYPE: &str = "astra-bicolor";

const LIGHTING_CUES_KEY: &str = "app.lighting.cues";
const LIGHTING_ACTIVE_CUE_ID_KEY: &str = "app.lighting.active_cue_id";
const MAX_FADE_MS: i64 = 60_000;
const MAX_FOLLOW_SECONDS: f64 = 3_600.0;
const MAX_CUE_LABEL_LEN: usize = 120;
const MAX_CUE_NOTES_LEN: usize = 500;

mod cues;
mod editor_state;
mod fixtures;
mod groups;
mod helpers;
mod legacy_import;
mod parse;
mod scenes;
mod settings;
mod snapshot;
mod types;

pub use cues::*;
pub use editor_state::{load_lighting_editor_state, save_lighting_editor_state};
pub use fixtures::*;
pub use groups::*;
pub use legacy_import::*;
pub use parse::*;
pub use scenes::*;
pub use settings::*;
pub use snapshot::*;
pub use types::*;

#[cfg(test)]
mod tests;
