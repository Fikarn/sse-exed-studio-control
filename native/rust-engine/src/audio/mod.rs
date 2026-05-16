const DEFAULT_SEND_HOST: &str = "127.0.0.1";
const DEFAULT_SEND_PORT: i64 = 7001;
const DEFAULT_RECEIVE_PORT: i64 = 9001;

const AUDIO_CONSOLE_STATE_CONFIDENCE_KEY: &str = "app.audio.console_state_confidence";
const AUDIO_LAST_CONSOLE_SYNC_AT_KEY: &str = "app.audio.last_console_sync_at";
const AUDIO_LAST_CONSOLE_SYNC_REASON_KEY: &str = "app.audio.last_console_sync_reason";
const AUDIO_LAST_RECALLED_SNAPSHOT_ID_KEY: &str = "app.audio.last_recalled_snapshot_id";
const AUDIO_LAST_SNAPSHOT_RECALL_AT_KEY: &str = "app.audio.last_snapshot_recall_at";
const AUDIO_LAST_ACTION_STATUS_KEY: &str = "app.audio.last_action_status";
const AUDIO_LAST_ACTION_CODE_KEY: &str = "app.audio.last_action_code";
const AUDIO_LAST_ACTION_MESSAGE_KEY: &str = "app.audio.last_action_message";
const AUDIO_CHANNEL_STATE_KEY: &str = "app.audio.channels_state";
const AUDIO_MIX_TARGET_STATE_KEY: &str = "app.audio.mix_targets_state";
const AUDIO_SNAPSHOTS_STATE_KEY: &str = "app.audio.snapshots_state";
const AUDIO_OSC_ENABLED_KEY: &str = "app.audio.osc_enabled";
const AUDIO_SELECTED_CHANNEL_ID_KEY: &str = "app.audio.selected_channel_id";
const AUDIO_SELECTED_MIX_TARGET_ID_KEY: &str = "app.audio.selected_mix_target_id";
const AUDIO_EXPECTED_PEAK_DATA_KEY: &str = "app.audio.expected_peak_data";
const AUDIO_EXPECTED_SUBMIX_LOCK_KEY: &str = "app.audio.expected_submix_lock";
const AUDIO_EXPECTED_COMPATIBILITY_MODE_KEY: &str = "app.audio.expected_compatibility_mode";
const AUDIO_FADERS_PER_BANK_KEY: &str = "app.audio.faders_per_bank";
const AUDIO_VIEW_MODE_KEY: &str = "app.audio.view_mode";
const AUDIO_CUSTOM_SNAPSHOT_ID_PREFIX: &str = "audio-snapshot-custom-";

const DEFAULT_AUDIO_OSC_ENABLED: bool = true;
const DEFAULT_AUDIO_EXPECTED_PEAK_DATA: bool = true;
const DEFAULT_AUDIO_EXPECTED_SUBMIX_LOCK: bool = true;
const DEFAULT_AUDIO_EXPECTED_COMPATIBILITY_MODE: bool = false;
const DEFAULT_AUDIO_FADERS_PER_BANK: i64 = 12;

mod channels;
mod clips;
mod helpers;
mod mix_targets;
mod parse;
mod settings;
mod snapshot;
mod snapshots;
mod sync;
mod types;

pub use channels::*;
pub use clips::*;
pub use mix_targets::*;
pub use parse::*;
pub use settings::*;
pub use snapshot::*;
pub use snapshots::*;
pub use sync::*;
pub use types::*;

#[cfg(test)]
mod tests;
