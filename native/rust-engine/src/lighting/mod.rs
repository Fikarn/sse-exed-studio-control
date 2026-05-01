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
pub const LIGHTING_SELECTED_FIXTURE_ID_KEY: &str = "app.control_surface.selected_light_id";
const LIGHTING_ENABLED_KEY: &str = "app.lighting.enabled";
const LIGHTING_GRAND_MASTER_KEY: &str = "app.lighting.grand_master";
const LIGHTING_IDENTIFY_BURSTS_KEY: &str = "app.lighting.identify_bursts";
const LIGHTING_HIGHLIGHT_IDS_KEY: &str = "app.lighting.highlight_ids";
const LIGHTING_SOLO_IDS_KEY: &str = "app.lighting.solo_ids";
const LIGHTING_SELECTED_SCENE_ID_KEY: &str = "app.lighting.selected_scene_id";
const LIGHTING_CAMERA_MARKER_KEY: &str = "app.lighting.camera_marker";
const LIGHTING_SUBJECT_MARKER_KEY: &str = "app.lighting.subject_marker";
const LIGHTING_CUSTOM_FIXTURE_ID_PREFIX: &str = "fixture-custom-";
const LIGHTING_CUSTOM_GROUP_ID_PREFIX: &str = "group-custom-";
const LIGHTING_CUSTOM_SCENE_ID_PREFIX: &str = "scene-custom-";
const DEFAULT_LIGHTING_FIXTURE_TYPE: &str = "astra-bicolor";

mod editor_state;
mod fade;
mod fixtures;
mod groups;
mod helpers;
mod identify;
mod legacy_import;
mod parse;
mod scenes;
mod settings;
mod snapshot;
mod types;

pub use editor_state::{load_lighting_editor_state, save_lighting_editor_state};
pub use fixtures::*;
pub use groups::*;
pub use identify::*;
pub use legacy_import::*;
pub use parse::*;
pub use scenes::*;
pub use settings::*;
pub use snapshot::*;
pub use types::*;

#[cfg(test)]
mod tests;
