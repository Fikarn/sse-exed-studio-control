const DEFAULT_SEND_HOST: &str = "127.0.0.1";
const DEFAULT_SEND_PORT: i64 = 7001;
const DEFAULT_RECEIVE_PORT: i64 = 9001;

const AUDIO_CONSOLE_STATE_CONFIDENCE_KEY: &str = "app.audio.console_state_confidence";
const AUDIO_LAST_CONSOLE_SYNC_AT_KEY: &str = "app.audio.last_console_sync_at";
const AUDIO_LAST_CONSOLE_SYNC_REASON_KEY: &str = "app.audio.last_console_sync_reason";
const AUDIO_LAST_ACTION_STATUS_KEY: &str = "app.audio.last_action_status";
const AUDIO_LAST_ACTION_CODE_KEY: &str = "app.audio.last_action_code";
/// The code of a refusal only the builds before 2026-09-28 wrote (D26).
const RETIRED_TALKBACK_REFUSED_CODE: &str = "AUDIO_TALKBACK_REFUSED";
/// How every message of the app's own snapshot recall began; the builds
/// before 2026-10-01 wrote it, and nothing writes it now.
const RETIRED_RECALL_MESSAGE_PREFIX: &str = "Recalled ";
/// How the app's own snapshots' create, update and delete messages began.
const RETIRED_SNAPSHOT_MESSAGE_PREFIX: &str = "Audio snapshot '";
/// The codes only those builds' recall and rename wrote.
const RETIRED_SNAPSHOT_CODES: [&str; 3] = [
    "AUDIO_SNAPSHOT_NOT_FOUND",
    "AUDIO_SNAPSHOT_RECALL_FAILED",
    "AUDIO_CHANNEL_NAME_INVALID",
];
/// The refusal codes and the success messages only the builds before
/// 2026-10-04 wrote for the per-send modes and the dynamics, which were kept in
/// the app and never reached TotalMix (the owner's decisions).
const RETIRED_APP_ONLY_CODES: [&str; 2] =
    ["AUDIO_SEND_UNAVAILABLE", "AUDIO_PROCESSING_UNAVAILABLE"];
const RETIRED_APP_ONLY_MESSAGES: [&str; 2] =
    ["Audio send mode updated.", "Audio dynamics updated."];
/// The codes only the equaliser's edit wrote; it went on 2026-10-04 (the
/// owner's decision). Its messages are matched whole in `snapshot.rs`.
const RETIRED_EQ_CODES: [&str; 4] = [
    "AUDIO_EQ_BAND_REQUIRED",
    "AUDIO_EQ_BAND_NOT_FOUND",
    "AUDIO_EQ_BAND_TYPE_UNSUPPORTED",
    "AUDIO_EQ_UPDATE_FAILED",
];
const AUDIO_LAST_ACTION_MESSAGE_KEY: &str = "app.audio.last_action_message";
const AUDIO_CHANNEL_STATE_KEY: &str = "app.audio.channels_state";
const AUDIO_MIX_TARGET_STATE_KEY: &str = "app.audio.mix_targets_state";
// The app's own snapshots (`app.audio.snapshots_state`) and the recall's
// markers (`app.audio.last_recalled_snapshot_id`,
// `app.audio.last_snapshot_recall_at`) are no longer read or written since
// 2026-10-01: the Console's snapshots are TotalMix's. Older saved data keeps
// the rows, unread.
const AUDIO_OSC_ENABLED_KEY: &str = "app.audio.osc_enabled";
const AUDIO_SELECTED_CHANNEL_ID_KEY: &str = "app.audio.selected_channel_id";
const AUDIO_SELECTED_MIX_TARGET_ID_KEY: &str = "app.audio.selected_mix_target_id";
const AUDIO_EXPECTED_PEAK_DATA_KEY: &str = "app.audio.expected_peak_data";
const AUDIO_EXPECTED_SUBMIX_LOCK_KEY: &str = "app.audio.expected_submix_lock";
const AUDIO_EXPECTED_COMPATIBILITY_MODE_KEY: &str = "app.audio.expected_compatibility_mode";
const AUDIO_FADERS_PER_BANK_KEY: &str = "app.audio.faders_per_bank";
const AUDIO_VIEW_MODE_KEY: &str = "app.audio.view_mode";
const AUDIO_METERING_SOURCE_KEY: &str = "app.audio.metering_source";
const AUDIO_LAST_CONSOLE_PULL_AT_KEY: &str = "app.audio.last_console_pull_at";
const AUDIO_LAST_CONSOLE_PULL_VALUES_KEY: &str = "app.audio.last_console_pull_values";

const DEFAULT_AUDIO_OSC_ENABLED: bool = true;
const DEFAULT_AUDIO_EXPECTED_PEAK_DATA: bool = true;
const DEFAULT_AUDIO_EXPECTED_SUBMIX_LOCK: bool = true;
const DEFAULT_AUDIO_EXPECTED_COMPATIBILITY_MODE: bool = false;
const DEFAULT_AUDIO_FADERS_PER_BANK: i64 = 12;
const DEFAULT_AUDIO_METERING_SOURCE: &str = crate::rme_totalmix_osc::RME_TOTALMIX_OSC_SOURCE;

mod channels;
mod clips;
mod console_link;
pub mod fader_curve;
mod helpers;
mod load;
mod mix_targets;
mod parse;
mod settings;
mod snapshot;
mod sync;
mod types;

pub use channels::*;
pub use clips::*;
pub use console_link::*;
pub(crate) use helpers::{audio_metering_is_simulated, ensure_audio_action_allowed};
pub use load::*;
pub use mix_targets::*;
pub use parse::*;
pub use settings::*;
pub use snapshot::*;
pub use sync::*;
pub use types::*;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_console_link;
#[cfg(test)]
mod tests_console_load;
#[cfg(test)]
mod tests_console_ordering;
