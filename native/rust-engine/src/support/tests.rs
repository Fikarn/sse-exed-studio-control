use super::test_support::*;
use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    read_audio_snapshot, update_audio_channel, update_audio_mix_target, update_audio_settings,
    AudioChannelUpdateRequest, AudioMixTargetUpdateRequest, AudioSettingsUpdateRequest,
};
use crate::commissioning::read_commissioning_snapshot;
use crate::lighting::read_lighting_snapshot;
use crate::storage::set_settings_owned;
use serde_json::json;
use std::thread;

#[test]
fn export_support_backup_writes_archive_and_lists_it() {
    let test_dir = TestDir::new("export");
    let runtime = test_dir.runtime();
    seed_completed_setup(&runtime.db_path);

    let summary = export_support_backup(&runtime).expect("backup export should succeed");
    // New pages program, Slice 2: the reply no longer counts projects and
    // tasks (the archive carries no Planning since format 5).
    assert_eq!(summary.format_version, SUPPORT_BACKUP_FORMAT_VERSION);

    let snapshot = read_support_snapshot(&runtime).expect("support snapshot should load");
    assert_eq!(snapshot.backup_count, 1);
    assert_eq!(
        snapshot.latest_backup_path.as_deref(),
        Some(summary.path.as_str())
    );
    assert!(
        snapshot.summary.contains("1 backup archive"),
        "{}",
        snapshot.summary
    );
    assert_eq!(snapshot.backups[0].kind, SupportBackupKind::Archive);
    assert!(snapshot.restore_summary.contains("rollback backup"));
}

#[test]
fn restore_support_backup_round_trips_native_archive() {
    // Registers sends on the process-wide console link, so it runs one at a
    // time with the tests that push, pull or read back through it.
    let _serial = crate::rme_console_link::SHARED_LINK_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let test_dir = TestDir::new("restore-native");
    let runtime = test_dir.runtime();
    seed_completed_setup(&runtime.db_path);

    let export = export_support_backup(&runtime).expect("backup export should succeed");
    set_settings_owned(
        &runtime.db_path,
        &[
            (
                String::from(LIGHTING_EDITOR_STATE_KEY),
                serde_json::to_string(&json!({
                    "groups": [
                        { "id": "group-custom-1", "name": "Parity Group" }
                    ],
                    "removed_fixture_ids": [],
                    "fixtures": [
                        {
                            "id": "fixture-custom-1",
                            "name": "Parity Key",
                            "type": "astra-bicolor",
                            "dmxStartAddress": 481,
                            "kind": "profile",
                            "groupId": "group-custom-1",
                            "spatialX": 0.22,
                            "spatialY": 0.31,
                            "spatialRotation": 15,
                            "intensity": 72,
                            "cct": 5600,
                            "on": true,
                            "effect": null
                        }
                    ],
                    "scenes": [
                        {
                            "id": "scene-custom-1",
                            "name": "Parity Scene",
                            "fixtureStates": [
                                {
                                    "fixtureId": "fixture-custom-1",
                                    "intensity": 72,
                                    "cct": 5600,
                                    "on": true
                                }
                            ]
                        }
                    ]
                }))
                .expect("lighting editor state should serialize"),
            ),
            (String::from("app.lighting.enabled"), String::from("true")),
            (
                String::from("app.lighting.grand_master"),
                String::from("72"),
            ),
            (
                String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
                String::from("fixture-custom-1"),
            ),
            // Console writes below are refused until the audio probe has
            // passed (2026-09 audit remediation, Slice 1); the restore
            // must roll this key back too.
            (
                String::from("app.commissioning.check.audio.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting mutations should persist before restore");
    update_audio_settings(
        &runtime.db_path,
        &AudioSettingsUpdateRequest {
            osc_enabled: None,
            send_host: None,
            send_port: None,
            receive_port: None,
            selected_channel_id: Some(Some(String::from("audio-input-12"))),
            selected_mix_target_id: Some(String::from("audio-mix-phones-a")),
            expected_peak_data: Some(false),
            expected_submix_lock: Some(false),
            expected_compatibility_mode: Some(true),
            faders_per_bank: None,
            view_mode: None,
        },
    )
    .expect("audio settings should persist before restore");
    update_audio_mix_target(
        &runtime.db_path,
        &AudioMixTargetUpdateRequest {
            mix_target_id: String::from("audio-mix-main"),
            volume: Some(0.81),
            mute: None,
            dim: Some(true),
            mono: Some(true),
            talkback: Some(true),
        },
    )
    .expect("audio mix target should persist before restore");
    update_audio_channel(
        &runtime.db_path,
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-12"),
            mix_target_id: None,
            name: None,
            gain: Some(40),
            fader: None,
            mute: None,
            solo: None,
            phantom: Some(true),
            phase: Some(true),
            pad: None,
            instrument: Some(true),
            auto_set: Some(true),
        },
    )
    .expect("front-preamp audio mutations should persist before restore");
    update_audio_channel(
        &runtime.db_path,
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-input-1"),
            mix_target_id: None,
            name: None,
            gain: None,
            fader: None,
            mute: Some(true),
            solo: None,
            phantom: None,
            phase: Some(true),
            pad: None,
            instrument: None,
            auto_set: None,
        },
    )
    .expect("rear-line audio mutations should persist before restore");
    update_audio_channel(
        &runtime.db_path,
        &AudioChannelUpdateRequest {
            channel_id: String::from("audio-playback-1-2"),
            mix_target_id: Some(String::from("audio-mix-phones-a")),
            name: None,
            gain: None,
            fader: Some(0.61),
            mute: Some(true),
            solo: Some(true),
            phantom: None,
            phase: None,
            pad: None,
            instrument: None,
            auto_set: None,
        },
    )
    .expect("playback audio mutations should persist before restore");
    set_settings_owned(
        &runtime.db_path,
        &[
            (
                String::from("app.audio.console_state_confidence"),
                String::from("assumed"),
            ),
            (
                String::from("app.audio.last_console_sync_at"),
                String::from("2026-04-16T20:15:00Z"),
            ),
            (
                String::from("app.audio.last_console_sync_reason"),
                String::from("snapshot"),
            ),
            (
                String::from("app.audio.last_recalled_snapshot_id"),
                String::from("snapshot-panel"),
            ),
            (
                String::from("app.audio.last_snapshot_recall_at"),
                String::from("2026-04-16T20:16:00Z"),
            ),
        ],
    )
    .expect("audio sync and recall markers should persist before restore");

    let summary = restore_support_backup(
        &runtime,
        &SupportRestoreRequest {
            source_path: PathBuf::from(&export.path),
            kind: SupportBackupKind::Archive,
        },
    )
    .expect("native restore should succeed");

    assert_eq!(summary.source_format, "native-support-backup");
    assert!(summary.rollback_backup_path.is_some());
    assert!(!summary.requires_restart);
    // New pages program, Slice 2: a format-5 archive holds no Planning, so
    // nothing was left out (the project and task counts were checked here
    // until Planning left).
    assert_eq!(summary.detail, None);
    assert!(list_settings_by_prefix(&runtime.db_path, "planning.")
        .expect("settings should load")
        .is_empty());

    let commissioning =
        read_commissioning_snapshot(&runtime.db_path).expect("commissioning snapshot should load");
    assert!(commissioning.has_completed_setup);

    let lighting_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
        .expect("lighting settings should load");
    let lighting = read_lighting_snapshot(&lighting_settings);
    assert_eq!(lighting.fixtures.len(), 0);
    assert_eq!(lighting.groups.len(), 0);
    assert_eq!(lighting.scenes.len(), 0);
    assert!(!lighting.enabled);
    assert!(lighting.selected_fixture_id.is_none());

    let audio_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)
        .expect("audio settings should load");
    let audio = read_audio_snapshot(&audio_settings);
    assert_eq!(audio.selected_channel_id.as_deref(), Some("audio-input-9"));
    assert_eq!(audio.selected_mix_target_id, "audio-mix-main");
    assert!(audio.expected_peak_data);
    assert!(audio.expected_submix_lock);
    assert!(!audio.expected_compatibility_mode);
    assert_eq!(audio.console_state_confidence, "unknown");
    assert!(audio.last_console_sync_at.is_none());
    assert!(audio.last_console_sync_reason.is_none());
    assert!(audio.last_recalled_snapshot_id.is_none());
    assert!(audio.last_snapshot_recall_at.is_none());

    let restored_front = audio
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-12")
        .expect("restored front channel should be present");
    assert_eq!(restored_front.gain, 32);
    assert!(restored_front.phantom);
    assert!(!restored_front.phase);
    assert!(!restored_front.pad);
    assert!(restored_front.instrument);
    assert!(!restored_front.auto_set);

    let restored_rear = audio
        .channels
        .iter()
        .find(|entry| entry.id == "audio-input-1")
        .expect("restored rear channel should be present");
    assert!(!restored_rear.mute);
    assert!(!restored_rear.phase);

    let restored_playback = audio
        .channels
        .iter()
        .find(|entry| entry.id == "audio-playback-1-2")
        .expect("restored playback channel should be present");
    assert!(!restored_playback.mute);
    assert!(!restored_playback.solo);
    let restored_phones_a_mix = restored_playback
        .mix_levels
        .get("audio-mix-phones-a")
        .copied()
        .expect("restored playback phones mix should be present");
    assert!((restored_phones_a_mix - 0.54).abs() < 0.000_001);

    let restored_main_mix = audio
        .mix_targets
        .iter()
        .find(|entry| entry.id == "audio-mix-main")
        .expect("restored main mix should be present");
    assert_eq!(restored_main_mix.volume, 0.82);
    assert!(!restored_main_mix.dim);
    assert!(!restored_main_mix.mono);
    assert!(!restored_main_mix.talkback);
}

/// Every file in the backups folder, by name.
fn backup_file_names(runtime: &RuntimeContext) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(&runtime.backups_dir)
        .expect("backups dir should list")
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect();
    names.sort();
    names
}

/// Every setting with its `updated_at`, to prove a refusal touched none.
fn settings_rows(runtime: &RuntimeContext) -> Vec<(String, String, String)> {
    let connection = open_connection(&runtime.db_path).expect("connection should open");
    let mut statement = connection
        .prepare("SELECT key, value, updated_at FROM app_settings ORDER BY key")
        .expect("settings should prepare");
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("settings should query")
        .collect::<Result<Vec<_>, _>>()
        .expect("settings should read");
    rows
}

// New pages program, Slice 2b (D3): the db.json import is retired, and an
// export from the old Studio Control in the backups folder is refused by
// name — known by its name or by what it holds. Verify answers `ok: false`
// with the sentence; a restore refuses it (INVALID_PARAMS) before anything is
// written, the rollback archive included. Until the slice Verify said it
// would restore whether setup is complete and the page, and a restore did
// (`sourceFormat: legacy-db-json`, 4 settings) after writing a rollback
// archive.
#[test]
fn an_old_studio_control_export_is_refused_by_name_and_writes_nothing() {
    let test_dir = TestDir::new("old-export-refused");
    let runtime = seeded_runtime(&test_dir);
    // An import would change the page and the setup flag of the seeded data.
    let reset = runtime.backups_dir.join("legacy-db.json");
    fs::write(
        &reset,
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": 9,
            "projects": [],
            "settings": { "dashboardView": "lighting", "hasCompletedSetup": false }
        }))
        .expect("the old export should serialize"),
    )
    .expect("the old export should be written");
    // The old app's own name, and its shape under another name.
    let bare = runtime.backups_dir.join("db.json");
    write_old_studio_control_export(&bare);
    let renamed = runtime.backups_dir.join("studio-2025-backup.json");
    write_old_studio_control_export(&renamed);
    // A name alone is enough, whatever the file holds.
    let named_only = runtime.backups_dir.join("stray-db.json");
    fs::write(&named_only, b"{}").expect("the named file should be written");
    let unreadable = runtime.backups_dir.join("broken-db.json");
    fs::write(&unreadable, b"{ not json").expect("the broken file should be written");
    // 2026-09-25: one re-saved as UTF-16 is not UTF-8, and its name is enough
    // all the same. Until then Verify said it "could not be read" and a
    // restore answered STORAGE_ERROR with the bare io text, the name unread.
    let not_utf8 = runtime.backups_dir.join("x-db.json");
    fs::write(
        &not_utf8,
        utf16_with_bom(r#"{"schemaVersion":9,"projects":[]}"#),
    )
    .expect("the UTF-16 file should be written");

    let files_before = backup_file_names(&runtime);
    let rows_before = settings_rows(&runtime);
    for (path, file_name) in [
        (&reset, "legacy-db.json"),
        (&bare, "db.json"),
        (&renamed, "studio-2025-backup.json"),
        (&named_only, "stray-db.json"),
        (&unreadable, "broken-db.json"),
        (&not_utf8, "x-db.json"),
    ] {
        let sentence = format!(
            "{file_name} is an export from the old Studio Control (db.json); this version no longer restores those. Restore a backup archive or a database backup instead."
        );
        let request = request_for(&runtime, path);
        assert_eq!(request.kind, SupportBackupKind::Archive);

        let checked = verify_support_backup(&request);
        assert!(!checked.ok, "{file_name}: {}", checked.detail);
        assert_eq!(checked.kind, SupportBackupKind::Archive);
        assert_eq!(checked.format_version, None, "{file_name}");
        assert_eq!(checked.schema_version, None, "{file_name}");
        assert_eq!(checked.detail, sentence);
        assert_operator_words(&checked.detail);

        match restore_support_backup(&runtime, &request) {
            Err(SupportCommandError::InvalidParams(message)) => assert_eq!(message, sentence),
            other => panic!("{file_name}: expected INVALID_PARAMS, got {other:?}"),
        }
    }
    assert_eq!(
        settings_rows(&runtime),
        rows_before,
        "no setting was written"
    );
    assert_eq!(
        backup_file_names(&runtime),
        files_before,
        "no rollback archive or any other file was written"
    );
    assert!(rollback_archive_names(&runtime).is_empty());
    assert_eq!(
        fs::read(&reset).expect("the old export reads"),
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": 9,
            "projects": [],
            "settings": { "dashboardView": "lighting", "hasCompletedSetup": false }
        }))
        .expect("the old export should serialize"),
        "the file itself is left as it was"
    );
}

// Slice 2b (D3): a restore applies nothing but a support archive. Any other
// JSON in the backups folder is refused as not a backup archive, with the
// sentence Verify gives, before anything is written. Until the slice it went
// to the db.json import with `force`: a stray `{}` wrote setup not completed
// and the Console, after a rollback archive.
#[test]
fn a_restore_of_json_that_is_not_a_backup_archive_changes_nothing() {
    let test_dir = TestDir::new("not-an-archive");
    let runtime = seeded_runtime(&test_dir);
    set_settings_owned(
        &runtime.db_path,
        &[(String::from(WORKSPACE_KEY), String::from("lighting"))],
    )
    .expect("the page should write");
    let mut strays = Vec::new();
    for (name, contents) in [
        ("stray.json", "{}"),
        ("list.json", "[]"),
        (
            "settings-only.json",
            r#"{"settings":{"dashboardView":"audio","hasCompletedSetup":false}}"#,
        ),
        (
            "native-backup-without-type.json",
            r#"{"formatVersion":5,"exportedAt":"2026-09-25T10:00:00.000Z"}"#,
        ),
    ] {
        let path = runtime.backups_dir.join(name);
        fs::write(&path, contents).expect("the stray file should be written");
        strays.push(path);
    }
    // 2026-09-25: a file that is not UTF-8 is not a JSON backup, and is
    // refused as one (INVALID_PARAMS); a restore answered STORAGE_ERROR until
    // then, with the bare io text.
    let not_utf8 = runtime.backups_dir.join("unicode.json");
    fs::write(&not_utf8, utf16_with_bom("{}")).expect("the UTF-16 file should be written");

    let files_before = backup_file_names(&runtime);
    let rows_before = settings_rows(&runtime);
    for path in &strays {
        let sentence = format!("{} is not a Studio Control backup archive.", path.display());
        let request = request_for(&runtime, path);
        match restore_support_backup(&runtime, &request) {
            Err(SupportCommandError::InvalidParams(message)) => assert_eq!(message, sentence),
            other => panic!("{}: expected INVALID_PARAMS, got {other:?}", path.display()),
        }
        let checked = verify_support_backup(&request);
        assert!(!checked.ok);
        assert_eq!(checked.detail, sentence);
    }
    let request = request_for(&runtime, &not_utf8);
    let refusal = match restore_support_backup(&runtime, &request) {
        Err(SupportCommandError::InvalidParams(message)) => message,
        other => panic!("unicode.json: expected INVALID_PARAMS, got {other:?}"),
    };
    let prefix = format!("{} is not a JSON backup: ", not_utf8.display());
    assert!(
        refusal.starts_with(&prefix) && refusal.contains("utf-8"),
        "{refusal}"
    );
    let checked = verify_support_backup(&request);
    assert!(!checked.ok);
    assert_eq!(checked.detail, refusal);
    assert_eq!(
        settings_rows(&runtime),
        rows_before,
        "no setting was written"
    );
    assert_eq!(backup_file_names(&runtime), files_before);
    assert!(rollback_archive_names(&runtime).is_empty());
    let commissioning =
        read_commissioning_snapshot(&runtime.db_path).expect("commissioning snapshot should load");
    assert!(commissioning.has_completed_setup);
}

#[test]
fn export_support_backup_records_storage_format_version() {
    let test_dir = TestDir::new("export-format-version");
    let runtime = test_dir.runtime();
    seed_completed_setup(&runtime.db_path);

    let export = export_support_backup(&runtime).expect("backup export should succeed");
    let archive_bytes = fs::read(&export.path).expect("archive should read back");
    let archive: SupportBackupArchive =
        serde_json::from_slice(&archive_bytes).expect("archive should parse");

    assert_eq!(archive.format_version, SUPPORT_BACKUP_FORMAT_VERSION);
    assert_eq!(archive.storage_format_version, Some(String::from("1")));
}

#[test]
fn restore_support_backup_accepts_format_v2_archive_without_storage_version() {
    let test_dir = TestDir::new("restore-format-v2");
    let runtime = test_dir.runtime();
    seed_completed_setup(&runtime.db_path);

    // Build a real archive then strip the v3-only field to forge a v2 shape.
    let mut archive_value =
        serde_json::to_value(build_support_backup_archive(&runtime).expect("archive should build"))
            .expect("archive should serialize to value");
    let archive_object = archive_value.as_object_mut().expect("archive is an object");
    archive_object.insert(String::from("formatVersion"), json!(2));
    archive_object.remove("storageFormatVersion");

    let v2_archive_path = runtime.backups_dir.join("legacy-format-v2-backup.json");
    fs::write(
        &v2_archive_path,
        serde_json::to_vec_pretty(&archive_value).expect("v2 archive should serialize"),
    )
    .expect("v2 archive should write");

    let summary = restore_support_backup(
        &runtime,
        &SupportRestoreRequest {
            source_path: v2_archive_path,
            kind: SupportBackupKind::Archive,
        },
    )
    .expect("v2 archive should restore on a v4-aware reader");

    assert_eq!(summary.source_format, "native-support-backup");
}

fn rollback_archive_names(runtime: &RuntimeContext) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(&runtime.backups_dir)
        .expect("backups dir should list")
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| name.starts_with("native-pre-restore-"))
        .collect();
    names.sort();
    names
}

// 2026-09 production readiness, Slice 7 (F20): an archive written by a
// newer Studio Control is refused before anything is written — no
// rollback archive, the data untouched — and verify says the same.
#[test]
fn restore_refuses_newer_format() {
    let test_dir = TestDir::new("newer-format");
    let runtime = seeded_runtime(&test_dir);
    let mut archive_value =
        serde_json::to_value(build_support_backup_archive(&runtime).expect("archive should build"))
            .expect("archive should serialize to value");
    archive_value["formatVersion"] = json!(SUPPORT_BACKUP_FORMAT_VERSION + 1);
    let newer_path = runtime
        .backups_dir
        .join("native-backup-from-the-future.json");
    fs::write(
        &newer_path,
        serde_json::to_vec_pretty(&archive_value).expect("archive should serialize"),
    )
    .expect("archive should write");
    let request = request_for(&runtime, &newer_path);
    // A setting the archive does not hold: any restore would clear it with
    // the rest of its prefix, so it is still there only if nothing was
    // written (the Planning project count stood in for this until Slice 2 of
    // the new pages program).
    set_settings_owned(
        &runtime.db_path,
        &[(String::from("shell.lighting.addedLater"), String::from("x"))],
    )
    .expect("marker should write");

    let error =
        restore_support_backup(&runtime, &request).expect_err("a newer format must be refused");
    match error {
        SupportCommandError::UnsupportedVersion(message) => {
            assert!(message.contains("newer Studio Control"), "{message}");
            assert!(
                message.contains(&format!("format {}", SUPPORT_BACKUP_FORMAT_VERSION + 1)),
                "{message}"
            );
        }
        other => panic!("expected UnsupportedVersion, got {other:?}"),
    }
    assert!(rollback_archive_names(&runtime).is_empty());
    assert_eq!(
        list_settings_by_prefix(&runtime.db_path, "shell.lighting.addedLater")
            .expect("settings should load")
            .get("shell.lighting.addedLater")
            .map(String::as_str),
        Some("x"),
        "the refused restore wrote nothing"
    );

    let verification = verify_support_backup(&request);
    assert!(!verification.ok);
    assert_eq!(verification.kind, SupportBackupKind::Archive);
    assert_eq!(
        verification.format_version,
        Some(SUPPORT_BACKUP_FORMAT_VERSION + 1)
    );
    assert!(verification.detail.contains("newer Studio Control"));
}

// Slice 7 (F20): every setting under the restore prefixes — the shell's
// scene thumbnails, talent marks, Setup section, window mode and the
// deck's bank, dial mode and selections — comes back exactly as exported,
// and a key added after the export is gone.
#[test]
fn restore_round_trips_all_prefixes() {
    let test_dir = TestDir::new("all-prefixes");
    let runtime = seeded_runtime(&test_dir);
    let exported: Vec<(String, String)> = vec![
        (
            String::from(LIGHTING_SCENE_THUMBS_KEY),
            String::from(r#"{"scene-1":"data:image/png;base64,AAAA"}"#),
        ),
        (
            String::from(LIGHTING_TALENT_MARKS_KEY),
            String::from(r#"[{"id":"mark-1","label":"Host","xMeters":1.5,"yMeters":2.25}]"#),
        ),
        (
            String::from(SETUP_ACTIVE_SECTION_KEY),
            String::from("support"),
        ),
        (
            String::from(LIGHTING_CURRENT_SECTION_ID_KEY),
            String::from("section-key"),
        ),
        (String::from(WINDOW_MODE_KEY), String::from("windowed")),
        (String::from(WORKSPACE_KEY), String::from("lighting")),
        (
            String::from("app.control_surface.audio.bank"),
            String::from("2"),
        ),
        (
            String::from("app.control_surface.audio.dial_mode"),
            String::from("gain"),
        ),
        (
            String::from("app.control_surface.selected_scene_id"),
            String::from("scene-1"),
        ),
        (
            String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
            String::from("fixture-1"),
        ),
    ];
    // New pages program, Slice 2: every prefix the archive carries verbatim
    // is covered by a key above, and none of them is Planning's.
    for prefix in RESTORE_KEY_PREFIXES {
        assert!(!prefix.starts_with("planning"), "{prefix}");
        assert!(
            exported.iter().any(|(key, _)| key.starts_with(prefix)),
            "{prefix} is covered"
        );
    }
    set_settings_owned(&runtime.db_path, &exported).expect("settings should seed");
    let export = export_support_backup(&runtime).expect("export should succeed");
    let archive: SupportBackupArchive =
        serde_json::from_slice(&fs::read(&export.path).expect("archive should read"))
            .expect("archive should parse");
    assert_eq!(archive.format_version, SUPPORT_BACKUP_FORMAT_VERSION);
    for (key, value) in &exported {
        assert_eq!(archive.settings.get(key), Some(value), "{key} is exported");
    }

    // Everything changes after the export, and two keys appear.
    let mut changed = Vec::new();
    for (key, _) in &exported {
        changed.push((key.clone(), String::from("changed")));
    }
    changed.push((String::from("shell.lighting.addedLater"), String::from("x")));
    changed.push((
        String::from("app.control_surface.added_later"),
        String::from("y"),
    ));
    set_settings_owned(&runtime.db_path, &changed).expect("changes should persist");

    let summary = restore_support_backup(&runtime, &request_for(&runtime, Path::new(&export.path)))
        .expect("restore should succeed");
    assert!(!summary.requires_restart);
    let mut restored = HashMap::new();
    for prefix in RESTORE_KEY_PREFIXES {
        restored.extend(
            list_settings_by_prefix(&runtime.db_path, prefix).expect("settings should load"),
        );
    }
    for (key, value) in &exported {
        assert_eq!(restored.get(key), Some(value), "{key} is restored verbatim");
    }
    assert!(!restored.contains_key("shell.lighting.addedLater"));
    assert!(!restored.contains_key("app.control_surface.added_later"));
    assert_eq!(restored, archive.settings);
}

#[test]
fn backup_times_are_milliseconds_since_the_epoch() {
    // The screen reads `modifiedAt` with `new Date(value)`, which takes
    // milliseconds; seconds put every backup time in January 1970.
    let test_dir = TestDir::new("list-times");
    let runtime = seeded_runtime(&test_dir);
    snapshot_database(
        &runtime.db_path,
        &runtime.backups_dir,
        SnapshotReason::Daily,
    )
    .expect("database backup should write");
    let now_ms = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after the epoch")
            .as_millis(),
    )
    .expect("milliseconds fit in i64");

    let snapshot = read_support_snapshot(&runtime).expect("snapshot should load");
    let modified_at = snapshot.backups[0].modified_at;
    assert!(
        (now_ms - 60_000..=now_ms + 1_000).contains(&modified_at),
        "modifiedAt {modified_at} is not within a minute of now ({now_ms} ms)"
    );
}

// Slice 7 (F20): the engine's own database backups are listed next to
// the JSON archives, each with its kind; sidecars and strays are not.
#[test]
fn list_includes_sqlite3() {
    let test_dir = TestDir::new("list-kinds");
    let runtime = seeded_runtime(&test_dir);
    let database_backup = snapshot_database(
        &runtime.db_path,
        &runtime.backups_dir,
        SnapshotReason::Daily,
    )
    .expect("database backup should write");
    thread::sleep(Duration::from_millis(1_100));
    let export = export_support_backup(&runtime).expect("export should succeed");
    fs::write(runtime.backups_dir.join("notes.txt"), b"x").expect("stray should write");
    fs::write(runtime.backups_dir.join("db-stray.sqlite3-wal"), b"x")
        .expect("sidecar should write");

    let snapshot = read_support_snapshot(&runtime).expect("snapshot should load");
    assert_eq!(snapshot.backup_count, 2);
    assert_eq!(snapshot.backups[0].path, export.path, "newest first");
    assert_eq!(snapshot.backups[0].kind, SupportBackupKind::Archive);
    assert_eq!(
        snapshot.backups[1].path,
        database_backup.display().to_string()
    );
    assert_eq!(snapshot.backups[1].kind, SupportBackupKind::Database);
    assert!(
        snapshot
            .summary
            .contains("(1 backup archive and 1 database backup)"),
        "{}",
        snapshot.summary
    );
    assert_eq!(
        serde_json::to_value(&snapshot.backups[1]).expect("entry serializes")["kind"],
        json!("database")
    );
}

// Slice 7 (F20): verify never errors — a junk file of either kind is
// `ok: false` with the reason, a real one is `ok: true` with its version.
#[test]
fn verify_flags_junk_file() {
    let test_dir = TestDir::new("verify-junk");
    let runtime = seeded_runtime(&test_dir);
    let junk_db = runtime.backups_dir.join("db-junk-daily.sqlite3");
    fs::write(
        &junk_db,
        b"this is not a database
"
        .repeat(64),
    )
    .expect("junk db should write");
    let junk_json = runtime.backups_dir.join("native-backup-junk.json");
    fs::write(&junk_json, b"{ not json").expect("junk json should write");
    let stranger = runtime.backups_dir.join("stranger.json");
    fs::write(&stranger, br#"{"hello":"world"}"#).expect("stranger should write");

    let junk_db_check = verify_support_backup(&request_for(&runtime, &junk_db));
    assert!(!junk_db_check.ok);
    assert_eq!(junk_db_check.kind, SupportBackupKind::Database);
    assert_eq!(junk_db_check.schema_version, None);
    assert!(
        junk_db_check.detail.contains("not a usable database")
            || junk_db_check.detail.contains("could not be opened"),
        "{}",
        junk_db_check.detail
    );
    let junk_json_check = verify_support_backup(&request_for(&runtime, &junk_json));
    assert!(!junk_json_check.ok);
    assert_eq!(junk_json_check.kind, SupportBackupKind::Archive);
    assert!(
        junk_json_check.detail.contains("not a JSON backup"),
        "{}",
        junk_json_check.detail
    );
    let stranger_check = verify_support_backup(&request_for(&runtime, &stranger));
    assert!(!stranger_check.ok);
    assert!(
        stranger_check
            .detail
            .contains("not a Studio Control backup archive"),
        "{}",
        stranger_check.detail
    );

    let database_backup = snapshot_database(
        &runtime.db_path,
        &runtime.backups_dir,
        SnapshotReason::Daily,
    )
    .expect("database backup should write");
    let good_db = verify_support_backup(&request_for(&runtime, &database_backup));
    assert!(good_db.ok, "{}", good_db.detail);
    assert_eq!(good_db.schema_version, Some(STORAGE_SCHEMA_VERSION));
    // New pages program, Slice 2: the sentence counts settings only (it
    // said "1 project" here until Planning left).
    assert!(good_db.detail.contains(" settings."), "{}", good_db.detail);
    assert!(!good_db.detail.contains("project"), "{}", good_db.detail);
    let export = export_support_backup(&runtime).expect("export should succeed");
    let good_archive = verify_support_backup(&request_for(&runtime, Path::new(&export.path)));
    assert!(good_archive.ok, "{}", good_archive.detail);
    assert_eq!(
        good_archive.format_version,
        Some(SUPPORT_BACKUP_FORMAT_VERSION)
    );
    assert_eq!(
        serde_json::to_value(&good_archive).expect("verification serializes")["kind"],
        json!("archive")
    );
    let text = runtime.backups_dir.join("notes.txt");
    fs::write(&text, b"x").expect("text should write");
    let refused = parse_support_restore_request(
        &json!({ "path": text.display().to_string() }),
        &runtime.backups_dir,
    )
    .expect_err("a .txt is neither kind");
    assert!(refused.contains("neither a backup archive"), "{refused}");
}

// Slice 7 (F29): only a file that resolves inside the backups folder can
// be named — an archive copied elsewhere, a missing file and the folder
// itself are all refused with a sentence, before anything is read.
#[test]
fn restore_rejects_path_outside_backups() {
    let test_dir = TestDir::new("outside");
    let runtime = seeded_runtime(&test_dir);
    let export = export_support_backup(&runtime).expect("export should succeed");
    let outside = test_dir.path().join("outside-backup.json");
    fs::copy(&export.path, &outside).expect("copy should succeed");

    let refused = parse_support_restore_request(
        &json!({ "path": outside.display().to_string() }),
        &runtime.backups_dir,
    )
    .expect_err("a path outside the backups folder is refused");
    assert!(
        refused.contains("Only files inside the backups folder"),
        "{refused}"
    );
    assert!(
        refused.contains(&runtime.backups_dir.display().to_string()),
        "{refused}"
    );

    let missing = parse_support_restore_request(
        &json!({ "path": runtime.backups_dir.join("gone.json").display().to_string() }),
        &runtime.backups_dir,
    )
    .expect_err("a missing file is refused");
    assert!(missing.contains("Backup file was not found"), "{missing}");

    let folder = parse_support_restore_request(
        &json!({ "path": runtime.backups_dir.display().to_string() }),
        &runtime.backups_dir,
    )
    .expect_err("the folder itself is refused");
    assert!(folder.contains("is not a file"), "{folder}");

    assert!(parse_support_restore_request(&json!({ "path": "  " }), &runtime.backups_dir).is_err());
    assert!(rollback_archive_names(&runtime).is_empty());
}

// Slice 7 (F20): a database backup is staged, not applied — checked
// first, a `pre-restore` copy of the live database written, the backup
// copied to `restore-pending.sqlite3` for the next start. From the
// recovery surface (no usable database) there is no copy to take, and
// an archive cannot be applied at all.
#[test]
fn database_restore_stages_pending_file_and_keeps_rollback() {
    let test_dir = TestDir::new("stage-db");
    let runtime = seeded_runtime(&test_dir);
    let database_backup = snapshot_database(
        &runtime.db_path,
        &runtime.backups_dir,
        SnapshotReason::Daily,
    )
    .expect("database backup should write");
    set_settings_owned(
        &runtime.db_path,
        &[(String::from("app.test.after_backup"), String::from("yes"))],
    )
    .expect("marker should write");

    let summary = restore_support_backup(&runtime, &request_for(&runtime, &database_backup))
        .expect("database restore should stage");
    assert!(summary.requires_restart);
    assert_eq!(summary.source_format, "database-backup");
    // New pages program, Slice 2: the reply counts the backup's settings and
    // no Planning rows (1 project, 1 task and 2 checklist items until then);
    // a schema-8 backup holds no Planning, so nothing is left out.
    assert_eq!(
        summary.settings_restored,
        inspect_database_backup(&database_backup)
            .expect("the backup is a good database")
            .settings_count
    );
    assert!(summary.settings_restored > 0);
    assert_eq!(summary.detail, None);
    let rollback = PathBuf::from(
        summary
            .rollback_backup_path
            .as_deref()
            .expect("a pre-restore copy is written"),
    );
    assert!(rollback.is_file());
    assert!(
        rollback
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with("-pre-restore.sqlite3")),
        "{}",
        rollback.display()
    );
    let rollback_facts =
        inspect_database_backup(&rollback).expect("the pre-restore copy is a good database");
    assert_eq!(rollback_facts.schema_version, STORAGE_SCHEMA_VERSION);
    // The copy is the live database as the restore found it — with the
    // setting written after the backup — not the backup being restored.
    assert_eq!(
        list_settings_by_prefix(&rollback, "app.test.")
            .expect("the pre-restore copy's settings should read")
            .get("app.test.after_backup")
            .map(String::as_str),
        Some("yes"),
        "the pre-restore copy holds what the restore replaces"
    );
    let pending = runtime.app_data_dir.join(RESTORE_PENDING_FILE_NAME);
    assert!(pending.is_file());
    assert_eq!(
        fs::read(&pending).expect("pending should read"),
        fs::read(&database_backup).expect("backup should read"),
        "the pending file is the backup, byte for byte"
    );
    let live = list_settings_by_prefix(&runtime.db_path, "app.test.").expect("live settings");
    assert_eq!(
        live.get("app.test.after_backup").map(String::as_str),
        Some("yes"),
        "the live database is untouched until the next start"
    );
    let log = fs::read_to_string(&runtime.log_file_path).expect("log should exist");
    assert!(log.contains("Database restore staged"), "{log}");

    // The recovery surface's engine: no database to copy, so no rollback,
    // and an archive is refused with the way out.
    let mut recovery = test_dir.runtime();
    recovery.storage_ready = false;
    fs::remove_file(&pending).expect("pending should clear");
    let staged = restore_support_backup(&recovery, &request_for(&recovery, &database_backup))
        .expect("a database restore is possible without a usable database");
    assert!(staged.requires_restart);
    assert_eq!(staged.rollback_backup_path, None);
    assert!(pending.is_file());
    let export = export_support_backup(&runtime).expect("export should succeed");
    let refused =
        restore_support_backup(&recovery, &request_for(&recovery, Path::new(&export.path)))
            .expect_err("an archive needs an open database");
    match refused {
        SupportCommandError::InvalidParams(message) => {
            assert!(
                message.contains("Restore a database backup first"),
                "{message}"
            );
        }
        other => panic!("expected InvalidParams, got {other:?}"),
    }
}

// Slice 7: the rollback archives a restore writes are capped at five;
// exports and database backups are not touched by that cap.
#[test]
fn pre_restore_archives_are_capped_at_five() {
    let test_dir = TestDir::new("rollback-cap");
    let runtime = seeded_runtime(&test_dir);
    let export = export_support_backup(&runtime).expect("export should succeed");
    let request = request_for(&runtime, Path::new(&export.path));
    for _ in 0..7 {
        restore_support_backup(&runtime, &request).expect("restore should succeed");
        thread::sleep(Duration::from_millis(3));
    }
    let names = rollback_archive_names(&runtime);
    assert_eq!(names.len(), PRE_RESTORE_ARCHIVE_RETENTION, "{names:?}");
    assert!(Path::new(&export.path).is_file(), "the export stays");
    let snapshot = read_support_snapshot(&runtime).expect("snapshot should load");
    assert_eq!(snapshot.backup_count, PRE_RESTORE_ARCHIVE_RETENTION + 1);
}

// Slice 7: diagnostics exports older than thirty days are removed at
// start; newer files and sub-directories stay.
#[test]
fn exports_older_than_thirty_days_are_pruned() {
    let test_dir = TestDir::new("exports-prune");
    let exports_dir = test_dir.path().join("exports");
    fs::create_dir_all(exports_dir.join("keep-me")).expect("sub-directory should create");
    let now = SystemTime::now();
    let old = exports_dir.join("diagnostics-old.json");
    let fresh = exports_dir.join("diagnostics-fresh.json");
    let edge = exports_dir.join("diagnostics-edge.json");
    for (path, age) in [
        (&old, EXPORTS_MAX_AGE + Duration::from_secs(60)),
        (&fresh, Duration::from_secs(86_400)),
        (&edge, EXPORTS_MAX_AGE - Duration::from_secs(60)),
    ] {
        fs::write(path, b"{}").expect("export should write");
        let file = fs::OpenOptions::new()
            .write(true)
            .open(path)
            .expect("export should open");
        file.set_modified(now - age)
            .expect("modified time should set");
    }

    let removed = prune_exports(&exports_dir, now).expect("prune should run");
    assert_eq!(removed, vec![old.clone()]);
    assert!(!old.exists());
    assert!(fresh.exists());
    assert!(edge.exists());
    assert!(exports_dir.join("keep-me").is_dir());
    assert!(prune_exports(&test_dir.path().join("missing"), now)
        .expect("a missing folder is nothing to prune")
        .is_empty());
}

// 2026-09 production readiness, Slice 11 (F31): whether the light outputs
// are armed is the state of this workstation now, not part of a backup. The
// key sits under `app.lighting.`, which an archive restore deletes and writes
// back as a whole — so without its exception, restoring a backup made while
// armed would arm a rig the operator is holding. The archive leaves the key
// out, the restore neither clears nor writes it, and an archive from
// elsewhere that names it is not believed.
#[test]
fn restore_never_changes_whether_the_light_outputs_are_armed() {
    use crate::lighting::{
        lighting_output_armed, lighting_output_armed_setting, LIGHTING_OUTPUT_ARMED_KEY,
    };
    let test_dir = TestDir::new("restore-armed-flag");
    let runtime = seeded_runtime(&test_dir);
    let armed_now = |runtime: &RuntimeContext| {
        lighting_output_armed(
            &list_settings_by_prefix(&runtime.db_path, LIGHTING_OUTPUT_ARMED_KEY)
                .expect("settings should load"),
        )
    };

    // Exported while armed, with a lighting setting that must round-trip.
    set_settings_owned(
        &runtime.db_path,
        &[
            lighting_output_armed_setting(true),
            (
                String::from("app.lighting.grand_master"),
                String::from("80"),
            ),
        ],
    )
    .expect("settings should seed");
    let export = export_support_backup(&runtime).expect("export should succeed");
    let archive: SupportBackupArchive =
        serde_json::from_slice(&fs::read(&export.path).expect("archive should read"))
            .expect("archive should parse");
    assert!(
        !archive
            .commissioning
            .lighting
            .settings
            .contains_key(LIGHTING_OUTPUT_ARMED_KEY),
        "the archive does not carry the flag"
    );
    assert_eq!(
        archive
            .commissioning
            .lighting
            .settings
            .get("app.lighting.grand_master")
            .map(String::as_str),
        Some("80")
    );

    // The operator holds the rig, then restores that backup.
    set_settings_owned(
        &runtime.db_path,
        &[
            lighting_output_armed_setting(false),
            (
                String::from("app.lighting.grand_master"),
                String::from("20"),
            ),
        ],
    )
    .expect("the hold should persist");
    restore_support_backup(&runtime, &request_for(&runtime, Path::new(&export.path)))
        .expect("restore should succeed");
    assert!(!armed_now(&runtime), "a restore must not arm a held rig");
    let lighting =
        list_settings_by_prefix(&runtime.db_path, "app.lighting.").expect("settings should load");
    assert_eq!(
        lighting
            .get("app.lighting.grand_master")
            .map(String::as_str),
        Some("80"),
        "everything else under the prefix is restored"
    );

    // An archive from elsewhere that names the flag is not believed.
    let mut forged: Value =
        serde_json::from_slice(&fs::read(&export.path).expect("archive should read"))
            .expect("archive should parse");
    forged["commissioning"]["lighting"]["settings"][LIGHTING_OUTPUT_ARMED_KEY] = json!("true");
    let forged_path = runtime.backups_dir.join("native-support-forged.json");
    fs::write(
        &forged_path,
        serde_json::to_vec(&forged).expect("archive should serialize"),
    )
    .expect("forged archive should write");
    restore_support_backup(&runtime, &request_for(&runtime, &forged_path))
        .expect("restore should succeed");
    assert!(!armed_now(&runtime));

    // And the other way round: an armed rig stays armed.
    set_settings_owned(&runtime.db_path, &[lighting_output_armed_setting(true)])
        .expect("arming should persist");
    forged["commissioning"]["lighting"]["settings"][LIGHTING_OUTPUT_ARMED_KEY] = json!("false");
    fs::write(
        &forged_path,
        serde_json::to_vec(&forged).expect("archive should serialize"),
    )
    .expect("forged archive should write");
    restore_support_backup(&runtime, &request_for(&runtime, &forged_path))
        .expect("restore should succeed");
    assert!(armed_now(&runtime));
}

// Slice 11 (F30): `support.snapshot` carries the newest fifty rows of the
// action log, newest first.
#[test]
fn support_snapshot_carries_the_newest_fifty_actions() {
    use crate::action_log::{
        record_actions, ActionRecord, ActionSource, DOMAIN_LIGHTING, RECENT_ACTIONS_LIMIT,
    };
    let test_dir = TestDir::new("recent-events");
    let runtime = test_dir.runtime();
    assert!(read_support_snapshot(&runtime)
        .expect("snapshot should read")
        .recent_events
        .is_empty());

    let rows = (0..RECENT_ACTIONS_LIMIT + 5)
        .map(|number| {
            ActionRecord::new(
                ActionSource::Ui,
                DOMAIN_LIGHTING,
                "all-off",
                "All lights",
                format!("row {number}"),
            )
        })
        .collect::<Vec<_>>();
    record_actions(&runtime.db_path, &rows).expect("rows should write");

    let snapshot = read_support_snapshot(&runtime).expect("snapshot should read");
    assert_eq!(snapshot.recent_events.len(), RECENT_ACTIONS_LIMIT);
    assert_eq!(snapshot.recent_events[0].detail, "row 54");
    assert_eq!(snapshot.recent_events[49].detail, "row 5");
    let serialized = serde_json::to_value(&snapshot).expect("snapshot should serialize");
    assert_eq!(serialized["recentEvents"][0]["source"], "ui");
    let mut keys = serialized["recentEvents"][0]
        .as_object()
        .map(|entry| entry.keys().cloned().collect::<Vec<_>>())
        .expect("a row is an object");
    keys.sort();
    assert_eq!(
        keys,
        ["action", "at", "detail", "domain", "id", "source", "target"]
    );
}
