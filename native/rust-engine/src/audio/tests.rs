use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::commissioning::AUDIO_SEND_HOST_KEY;
use crate::storage::{initialize_database, list_settings_by_prefix, set_settings_owned};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "studio-control-engine-audio-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test dir should be created");
        Self { path }
    }

    fn db_path(&self) -> PathBuf {
        self.path.join("native.sqlite3")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn audio_snapshot_defaults_to_not_verified() {
    let snapshot = read_audio_snapshot(&HashMap::new());
    assert_eq!(snapshot.status, "not-verified");
    assert!(!snapshot.connected);
    assert!(!snapshot.verified);
    assert_eq!(snapshot.channels.len(), 18);
    assert_eq!(snapshot.mix_targets.len(), 3);
    assert_eq!(snapshot.snapshots.len(), 3);
    assert_eq!(snapshot.console_state_confidence, "unknown");
    assert_eq!(snapshot.snapshots[0].osc_index, 0);
    assert_eq!(snapshot.snapshots[0].order, 0);
}

#[test]
fn audio_snapshot_reports_ready_when_probe_passed() {
    let settings = HashMap::from([
        (
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        ),
        (String::from(AUDIO_SEND_HOST_KEY), String::from("127.0.0.1")),
    ]);

    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.status, "ready");
    assert!(snapshot.connected);
    assert!(snapshot.verified);
    assert_eq!(snapshot.channels.len(), 18);
    assert_eq!(snapshot.mix_targets.len(), 3);
    assert_eq!(snapshot.snapshots.len(), 3);
}

#[test]
fn audio_sync_rejects_until_probe_passes_and_records_failure_state() {
    let test_dir = TestDir::new("sync-rejects");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

    let error = sync_audio_console(test_dir.db_path().as_path()).expect_err("sync should reject");
    match error {
        AudioCommandError::Rejected(code, _) => assert_eq!(code, "AUDIO_NOT_VERIFIED"),
        other => panic!("unexpected error: {other:?}"),
    }

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_NOT_VERIFIED")
    );
}

#[test]
fn audio_sync_updates_console_state_when_probe_passed() {
    let test_dir = TestDir::new("sync-ready");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let result = sync_audio_console(test_dir.db_path().as_path()).expect("sync should succeed");
    assert!(result.synced);
    assert_eq!(result.console_state_confidence, "aligned");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "aligned");
    assert_eq!(snapshot.last_action_status, "succeeded");
    assert_eq!(
        snapshot.last_console_sync_reason.as_deref(),
        Some("manual-sync")
    );
    assert!(snapshot.last_console_sync_at.is_some());
}

#[test]
fn audio_snapshot_recall_marks_last_recalled_snapshot() {
    let test_dir = TestDir::new("snapshot-recall");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let result = recall_audio_snapshot(
        test_dir.db_path().as_path(),
        &AudioSnapshotRecallRequest {
            snapshot_id: String::from("snapshot-panel"),
        },
    )
    .expect("snapshot recall should succeed");

    assert!(result.recalled);
    assert_eq!(result.snapshot_name, "Panel");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.console_state_confidence, "assumed");
    assert_eq!(
        snapshot.last_recalled_snapshot_id.as_deref(),
        Some("snapshot-panel")
    );
    assert!(snapshot
        .snapshots
        .iter()
        .any(|entry| entry.id == "snapshot-panel" && entry.last_recalled));
    assert!(snapshot
        .snapshots
        .iter()
        .any(|entry| entry.id == "snapshot-panel" && entry.osc_index == 1 && entry.order == 1));
}

#[test]
fn audio_snapshot_crud_uses_persisted_native_state() {
    let test_dir = TestDir::new("snapshot-crud");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let created = create_audio_snapshot(
        test_dir.db_path().as_path(),
        &AudioSnapshotCreateRequest {
            name: String::from("Podcast"),
            osc_index: 6,
        },
    )
    .expect("audio snapshot create should succeed");
    assert_eq!(created.snapshot.name, "Podcast");
    assert_eq!(created.snapshot.osc_index, 6);
    assert_eq!(created.snapshot.order, 3);

    let updated = update_audio_snapshot(
        test_dir.db_path().as_path(),
        &AudioSnapshotUpdateRequest {
            snapshot_id: created.snapshot.id.clone(),
            name: Some(String::from("Podcast A")),
            osc_index: Some(4),
        },
    )
    .expect("audio snapshot update should succeed");
    assert_eq!(updated.snapshot.name, "Podcast A");
    assert_eq!(updated.snapshot.osc_index, 4);

    let recalled = recall_audio_snapshot(
        test_dir.db_path().as_path(),
        &AudioSnapshotRecallRequest {
            snapshot_id: created.snapshot.id.clone(),
        },
    )
    .expect("audio snapshot recall should succeed");
    assert_eq!(recalled.snapshot_name, "Podcast A");

    let deleted = delete_audio_snapshot(
        test_dir.db_path().as_path(),
        &AudioSnapshotDeleteRequest {
            snapshot_id: created.snapshot.id.clone(),
        },
    )
    .expect("audio snapshot delete should succeed");
    assert!(deleted.deleted);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.snapshots.len(), 3);
    assert!(snapshot
        .snapshots
        .iter()
        .all(|entry| entry.id != created.snapshot.id));
    assert_eq!(snapshot.last_recalled_snapshot_id, None);
    assert_eq!(snapshot.last_action_status, "succeeded");
}

#[test]
fn audio_channel_update_persists_front_preamp_controls() {
    let test_dir = TestDir::new("channel-front-preamp");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let updated = update_audio_channel(
        test_dir.db_path().as_path(),
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-9"),
            mix_target_id: None,
            gain: Some(41),
            fader: None,
            mute: None,
            solo: Some(true),
            phantom: Some(true),
            phase: Some(true),
            pad: Some(true),
            instrument: Some(true),
            auto_set: Some(true),
        },
    )
    .expect("front preamp update should succeed");

    assert_eq!(updated.id, "audio-input-9");
    assert_eq!(updated.gain, 41);
    assert!(updated.solo);
    assert!(updated.phantom);
    assert!(updated.phase);
    assert!(updated.pad);
    assert!(updated.instrument);
    assert!(updated.auto_set);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let refreshed = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("updated channel should be present");
    assert_eq!(refreshed.gain, 41);
    assert!(refreshed.phantom);
    assert!(refreshed.phase);
    assert!(refreshed.pad);
    assert!(refreshed.instrument);
    assert!(refreshed.auto_set);
    assert_eq!(snapshot.last_action_status, "succeeded");
    assert_eq!(snapshot.console_state_confidence, "aligned");
}

#[test]
fn audio_channel_update_succeeds_before_probe_passes() {
    let test_dir = TestDir::new("channel-not-verified");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

    let updated = update_audio_channel(
        test_dir.db_path().as_path(),
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-9"),
            mix_target_id: None,
            gain: Some(38),
            fader: None,
            mute: Some(true),
            solo: None,
            phantom: Some(true),
            phase: Some(true),
            pad: Some(true),
            instrument: Some(true),
            auto_set: Some(true),
        },
    )
    .expect("channel update should still persist local operator state before probe passes");

    assert_eq!(updated.id, "audio-input-9");
    assert_eq!(updated.gain, 38);
    assert!(updated.mute);
    assert!(updated.phantom);
    assert!(updated.phase);
    assert!(updated.pad);
    assert!(updated.instrument);
    assert!(updated.auto_set);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let refreshed = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-9")
        .expect("updated channel should be present");
    assert_eq!(refreshed.gain, 38);
    assert!(refreshed.mute);
    assert!(refreshed.phantom);
    assert_eq!(snapshot.status, "not-verified");
    assert_eq!(snapshot.last_action_status, "succeeded");
    assert_eq!(snapshot.console_state_confidence, "aligned");
}

#[test]
fn audio_channel_update_rejects_unsupported_gain_controls() {
    let test_dir = TestDir::new("channel-unsupported-field");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let error = update_audio_channel(
        test_dir.db_path().as_path(),
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-playback-1-2"),
            mix_target_id: None,
            gain: Some(12),
            fader: None,
            mute: None,
            solo: None,
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        },
    )
    .expect_err("playback gain should be rejected");

    match error {
        AudioCommandError::Rejected(code, message) => {
            assert_eq!(code, "AUDIO_CHANNEL_FIELD_UNSUPPORTED");
            assert!(message.contains("does not expose gain"));
        }
        other => panic!("unexpected error: {other:?}"),
    }

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    assert_eq!(snapshot.last_action_status, "failed");
    assert_eq!(
        snapshot.last_action_code.as_deref(),
        Some("AUDIO_CHANNEL_FIELD_UNSUPPORTED")
    );
}

#[test]
fn audio_mix_target_update_succeeds_before_probe_passes() {
    let test_dir = TestDir::new("mix-target-not-verified");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");

    let updated = update_audio_mix_target(
        test_dir.db_path().as_path(),
        &AudioMixTargetUpdateRequest {
            mix_target_id: String::from("audio-mix-main"),
            volume: Some(0.81),
            mute: Some(true),
            dim: Some(true),
            mono: Some(true),
            talkback: Some(true),
        },
    )
    .expect("mix target update should still persist control-room state before probe passes");

    assert_eq!(updated.id, "audio-mix-main");
    assert_eq!(updated.volume, 0.81);
    assert!(updated.mute);
    assert!(updated.dim);
    assert!(updated.mono);
    assert!(updated.talkback);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_audio_snapshot(&settings);
    let refreshed = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("updated mix target should be present");
    assert_eq!(refreshed.volume, 0.81);
    assert!(refreshed.mute);
    assert!(refreshed.dim);
    assert!(refreshed.mono);
    assert!(refreshed.talkback);
    assert_eq!(snapshot.status, "not-verified");
    assert_eq!(snapshot.last_action_status, "succeeded");
    assert_eq!(snapshot.console_state_confidence, "aligned");
}

#[test]
fn audio_settings_update_persists_selection_and_checklist_flags() {
    let test_dir = TestDir::new("settings-update");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from("app.commissioning.check.audio.status"),
            String::from("passed"),
        )],
    )
    .expect("probe state should persist");

    let snapshot = update_audio_settings(
        test_dir.db_path().as_path(),
        &AudioSettingsUpdateRequest {
            osc_enabled: None,
            send_host: None,
            send_port: None,
            receive_port: None,
            selected_channel_id: Some(Some(String::from("audio-playback-1-2"))),
            selected_mix_target_id: Some(String::from("audio-mix-phones-a")),
            expected_peak_data: Some(false),
            expected_submix_lock: Some(false),
            expected_compatibility_mode: Some(true),
            faders_per_bank: Some(8),
        },
    )
    .expect("settings update should succeed");

    assert_eq!(
        snapshot.selected_channel_id.as_deref(),
        Some("audio-playback-1-2")
    );
    assert_eq!(snapshot.selected_mix_target_id, "audio-mix-phones-a");
    assert!(!snapshot.expected_peak_data);
    assert!(!snapshot.expected_submix_lock);
    assert!(snapshot.expected_compatibility_mode);
    assert_eq!(snapshot.faders_per_bank, 8);
    assert_eq!(snapshot.last_action_status, "succeeded");
}

#[test]
fn audio_settings_update_resets_probe_when_transport_changes() {
    let test_dir = TestDir::new("settings-transport-reset");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from("app.commissioning.check.audio.status"),
                String::from("passed"),
            ),
            (
                String::from(AUDIO_CONSOLE_STATE_CONFIDENCE_KEY),
                String::from("aligned"),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                String::from("2026-01-01T00:00:00Z"),
            ),
        ],
    )
    .expect("audio state should persist");

    let snapshot = update_audio_settings(
        test_dir.db_path().as_path(),
        &AudioSettingsUpdateRequest {
            osc_enabled: Some(false),
            send_host: Some(String::from("127.0.0.2")),
            send_port: Some(7002),
            receive_port: Some(9002),
            selected_channel_id: None,
            selected_mix_target_id: None,
            expected_peak_data: None,
            expected_submix_lock: None,
            expected_compatibility_mode: None,
            faders_per_bank: None,
        },
    )
    .expect("transport settings update should succeed");

    assert!(!snapshot.osc_enabled);
    assert_eq!(snapshot.status, "not-verified");
    assert!(!snapshot.connected);
    assert!(!snapshot.verified);
    assert_eq!(snapshot.metering_state, "disabled");
    assert_eq!(snapshot.console_state_confidence, "unknown");
    assert!(snapshot.last_console_sync_at.is_none());

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    assert_eq!(
        settings
            .get("app.commissioning.check.audio.status")
            .map(String::as_str),
        Some("idle")
    );
}
