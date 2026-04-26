use std::path::Path;

use crate::audio_backend::{read_default_audio_inventory, sync_default_audio_console};

use super::helpers::*;
use super::types::*;
use super::*;

pub fn sync_audio_console(db_path: &Path) -> Result<AudioSyncResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    ensure_audio_action_allowed(db_path, &snapshot)?;
    let config = resolve_audio_config(&app_settings);
    let inventory = read_default_audio_inventory(&config);
    let synced_at = current_timestamp(db_path)?;

    let outcome = sync_default_audio_console(&config, &inventory).map_err(|message| {
        let _ = record_audio_action_failure(db_path, "AUDIO_SYNC_FAILED", &message);
        AudioCommandError::Rejected("AUDIO_SYNC_FAILED", message)
    })?;

    persist_audio_state(
        db_path,
        &[
            (
                String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
                String::from("aligned"),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                synced_at.clone(),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                String::from("manual-sync"),
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                outcome.summary.clone(),
            ),
        ],
    )?;

    Ok(AudioSyncResult {
        synced: true,
        synced_at,
        summary: outcome.summary,
        console_state_confidence: String::from("aligned"),
    })
}
