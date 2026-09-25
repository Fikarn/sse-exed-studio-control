use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    read_audio_snapshot, update_audio_channel, update_audio_mix_target, update_audio_settings,
    AudioChannelUpdateRequest, AudioMixTargetUpdateRequest, AudioSettingsUpdateRequest,
};
use crate::commissioning::{read_commissioning_snapshot, PROBE_CHECKED_BEFORE_THIS_VERSION};
use crate::control_surface::ControlSurfaceBridgeInfo;
use crate::lighting::read_lighting_snapshot;
use crate::storage::{initialize_database, initialize_test_database, set_settings_owned};
use serde_json::json;
use std::process;
use std::thread;

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
            "studio-control-engine-support-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test dir should be created");
        Self { path }
    }

    fn runtime(&self) -> RuntimeContext {
        let app_data_dir = self.path.join("runtime");
        let logs_dir = app_data_dir.join("logs");
        let backups_dir = app_data_dir.join("backups");
        fs::create_dir_all(&logs_dir).expect("logs dir should be created");
        fs::create_dir_all(&backups_dir).expect("backups dir should be created");
        let db_path = app_data_dir.join("studio-control.sqlite3");
        let storage_bootstrap =
            initialize_test_database(&db_path).expect("database should initialize");

        RuntimeContext {
            protocol_version: String::from("1"),
            app_data_dir,
            backups_dir,
            logs_dir: logs_dir.clone(),
            log_file_path: logs_dir.join("engine.log"),
            db_path,
            update_repository_path: None,
            storage_ready: true,
            storage_bootstrap,
            control_surface_token: String::from("bridge-token-for-tests"),
            control_surface_bridge: ControlSurfaceBridgeInfo {
                base_url: String::from("http://127.0.0.1:38201"),
                port: 38201,
                available: true,
                status: String::from("ready"),
                summary: String::from("Test bridge"),
                error: None,
            },
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn seed_legacy_payload(path: &Path) {
    fs::write(
        path,
        serde_json::to_vec_pretty(&json!({
            "schemaVersion": 9,
            "projects": [
                {
                    "id": "proj-1",
                    "title": "Native Support",
                    "description": "Backup flow",
                    "status": "in-progress",
                    "priority": "p1",
                    "createdAt": "2026-04-01T10:00:00.000Z",
                    "lastUpdated": "2026-04-11T10:00:00.000Z",
                    "order": 0
                }
            ],
            "tasks": [
                {
                    "id": "task-1",
                    "projectId": "proj-1",
                    "title": "Ship support archive",
                    "description": "Implement backup/restore",
                    "priority": "p0",
                    "dueDate": "2026-04-20",
                    "labels": ["native", "support"],
                    "checklist": [
                        {"id": "check-1", "text": "Export", "done": true},
                        {"id": "check-2", "text": "Restore", "done": false}
                    ],
                    "isRunning": false,
                    "totalSeconds": 120,
                    "lastStarted": null,
                    "completed": false,
                    "order": 0,
                    "createdAt": "2026-04-11T10:00:00.000Z"
                }
            ],
            "activityLog": [
                {
                    "id": "act-1",
                    "timestamp": "2026-04-11T12:00:00.000Z",
                    "entityType": "task",
                    "entityId": "task-1",
                    "action": "created",
                    "detail": "Task created"
                }
            ],
            "settings": {
                "viewFilter": "all",
                "sortBy": "manual",
                "selectedProjectId": "proj-1",
                "selectedTaskId": "task-1",
                "dashboardView": "audio",
                "deckMode": "audio",
                "hasCompletedSetup": true
            }
        }))
        .expect("legacy payload should serialize"),
    )
    .expect("legacy payload should be written");
}

#[test]
fn export_support_backup_writes_archive_and_lists_it() {
    let test_dir = TestDir::new("export");
    let runtime = test_dir.runtime();
    let legacy_path = test_dir.path().join("legacy-db.json");
    seed_legacy_payload(&legacy_path);
    import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: legacy_path,
            force: true,
        },
    )
    .expect("legacy import should seed database");

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
    let legacy_path = test_dir.path().join("legacy-db.json");
    seed_legacy_payload(&legacy_path);
    import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: legacy_path,
            force: true,
        },
    )
    .expect("legacy import should seed database");

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

#[test]
fn restore_support_backup_accepts_legacy_json() {
    let test_dir = TestDir::new("restore-legacy");
    let runtime = test_dir.runtime();
    // Slice 7 (F29): a restore source lives inside the backups folder.
    let legacy_path = runtime.backups_dir.join("legacy-db.json");
    seed_legacy_payload(&legacy_path);
    let request = parse_support_restore_request(
        &json!({ "path": legacy_path.display().to_string() }),
        &runtime.backups_dir,
    )
    .expect("a legacy export inside the backups folder is a valid source");
    assert_eq!(request.kind, SupportBackupKind::Archive);

    let summary =
        restore_support_backup(&runtime, &request).expect("legacy restore should succeed");

    assert_eq!(summary.source_format, "legacy-db-json");
    // New pages program, Slice 2 (interim until Slice 2b retires the
    // db.json import): only whether setup is complete and the page to open
    // are restored — the three setup keys and the page — and the file's
    // project, task and activity entry are not, which the reply says. Until
    // Slice 2 it restored 1 project, 1 task and 2 checklist items.
    assert_eq!(summary.settings_restored, 4);
    assert_eq!(summary.detail.as_deref(), Some(PLANNING_WAS_NOT_RESTORED));
    assert!(
        read_commissioning_snapshot(&runtime.db_path)
            .expect("commissioning snapshot should load")
            .has_completed_setup
    );
    assert!(list_settings_by_prefix(&runtime.db_path, "planning.")
        .expect("settings should load")
        .is_empty());
}

#[test]
fn export_support_backup_records_storage_format_version() {
    let test_dir = TestDir::new("export-format-version");
    let runtime = test_dir.runtime();
    let legacy_path = test_dir.path().join("legacy-db.json");
    seed_legacy_payload(&legacy_path);
    import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: legacy_path,
            force: true,
        },
    )
    .expect("legacy import should seed database");

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
    let legacy_path = test_dir.path().join("legacy-db.json");
    seed_legacy_payload(&legacy_path);
    import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: legacy_path,
            force: true,
        },
    )
    .expect("legacy import should seed database");

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

fn seeded_runtime(test_dir: &TestDir) -> RuntimeContext {
    let runtime = test_dir.runtime();
    let legacy_path = test_dir.path().join("legacy-db.json");
    seed_legacy_payload(&legacy_path);
    import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: legacy_path,
            force: true,
        },
    )
    .expect("legacy import should seed database");
    runtime
}

fn request_for(runtime: &RuntimeContext, path: &Path) -> SupportRestoreRequest {
    parse_support_restore_request(
        &json!({ "path": path.display().to_string() }),
        &runtime.backups_dir,
    )
    .unwrap_or_else(|error| panic!("{} should be a valid source: {error}", path.display()))
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

// ---------------------------------------------------------------------------
// New pages program, Slice 2 (D2, D3): Planning left, and the backups with it.
// ---------------------------------------------------------------------------

/// The words the operator never reads (the rule `action_log`'s
/// `sentences_avoid_the_words_the_operator_never_reads` holds for its rows),
/// held here for the Verify and restore sentences.
fn assert_operator_words(sentence: &str) {
    for word in sentence
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
    {
        assert!(
            ![
                "engine",
                "backend",
                "transport",
                "ipc",
                "snapshot",
                "snapshots"
            ]
            .contains(&word),
            "\"{sentence}\" says {word}"
        );
    }
}

/// Every object key in a JSON value, at any depth.
fn every_key(value: &Value) -> Vec<String> {
    let mut keys = Vec::new();
    match value {
        Value::Object(object) => {
            for (key, entry) in object {
                keys.push(key.clone());
                keys.extend(every_key(entry));
            }
        }
        Value::Array(entries) => {
            for entry in entries {
                keys.extend(every_key(entry));
            }
        }
        _ => {}
    }
    keys
}

/// This build's archive of the saved data, rewritten as a build before
/// Slice 2 wrote it: format 4, the Planning page saved (the default page
/// then), and a `planning` part — a project, a task with two checklist items
/// and an activity entry when `with_rows`, and the Planning settings every
/// such archive carries.
fn format_4_archive(runtime: &RuntimeContext, with_rows: bool) -> Value {
    let mut archive =
        serde_json::to_value(build_support_backup_archive(runtime).expect("archive should build"))
            .expect("archive should serialize to value");
    archive["formatVersion"] = json!(4);
    // The Control Surface Probe's line as that build wrote it with nothing
    // loaded; the operator's archive of 2026-09-24 carries one like it.
    let checks = archive["commissioning"]["checks"]
        .as_array_mut()
        .expect("the archive lists its probes");
    let control_surface = checks
        .iter_mut()
        .find(|check| check["id"] == json!("control-surface"))
        .expect("the archive holds the Control Surface Probe");
    control_surface["status"] = json!("passed");
    control_surface["message"] = json!(
        "Planning context is reachable. No projects are loaded yet, so the deck surface would start empty."
    );
    archive["shell"]["workspace"] = json!("planning");
    archive["settings"][WORKSPACE_KEY] = json!("planning");
    let rows = |entries: Value| if with_rows { entries } else { json!([]) };
    archive["planning"] = json!({
        "projects": rows(json!([{
            "id": "proj-1",
            "title": "Spring season",
            "description": "",
            "status": "in-progress",
            "priority": "p1",
            "createdAt": "2026-04-01T10:00:00.000Z",
            "lastUpdated": "2026-04-02T10:00:00.000Z",
            "order": 0
        }])),
        "tasks": rows(json!([{
            "id": "task-1",
            "projectId": "proj-1",
            "title": "Book guests",
            "description": "",
            "priority": "p1",
            "dueDate": null,
            "labels": ["guests"],
            "checklist": [
                { "id": "check-1", "text": "Send invites", "done": true, "order": 0 },
                { "id": "check-2", "text": "Confirm times", "done": false, "order": 1 }
            ],
            "isRunning": false,
            "totalSeconds": 120,
            "lastStarted": null,
            "completed": false,
            "order": 0,
            "createdAt": "2026-04-01T11:00:00.000Z"
        }])),
        "activityLog": rows(json!([{
            "id": "act-1",
            "timestamp": "2026-04-01T10:00:00.000Z",
            "entityType": "project",
            "entityId": "proj-1",
            "action": "created",
            "detail": "Project created"
        }])),
        "settings": {
            "viewFilter": "all",
            "sortBy": "manual",
            "dashboardView": "kanban",
            "deckMode": "project",
            "modeSection": "timeline",
            "timelineStartHour": 9,
            "timelineEndHour": 22,
            "selectedProjectId": if with_rows { json!("proj-1") } else { Value::Null },
            "selectedTaskId": if with_rows { json!("task-1") } else { Value::Null }
        }
    });
    archive
}

fn write_archive(runtime: &RuntimeContext, name: &str, archive: &Value) -> PathBuf {
    let path = runtime.backups_dir.join(name);
    fs::write(
        &path,
        serde_json::to_vec_pretty(archive).expect("archive should serialize"),
    )
    .expect("archive should write");
    path
}

fn planning_tables_in(db_path: &Path) -> Vec<String> {
    let connection = Connection::open(db_path).expect("database should open");
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table'
             AND name IN ('projects', 'tasks', 'task_checklist_items', 'activity_log')
             ORDER BY name",
        )
        .expect("tables should prepare");
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("tables should query")
        .collect::<Result<Vec<_>, _>>()
        .expect("tables should read");
    names
}

/// Turns a database backup this build wrote into one a build before Slice 2
/// wrote: schema 7, Planning's four tables, the seven Planning settings that
/// build seeded and the Planning page saved, plus a project, a task, a
/// checklist item and an activity entry when `with_rows`. The operator's own
/// database, read on 2026-09-24, was of the kind without rows.
fn make_schema_7_backup(path: &Path, with_rows: bool) {
    let connection = Connection::open(path).expect("backup should open");
    connection
        .execute_batch(
            r#"
            DELETE FROM schema_migrations WHERE version = 8;
            CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL);
            CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
            CREATE TABLE task_checklist_items (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
            CREATE TABLE activity_log (id TEXT PRIMARY KEY, detail TEXT NOT NULL);
            INSERT INTO app_settings(key, value) VALUES
              ('planning.view_filter', 'all'),
              ('planning.sort_by', 'manual'),
              ('planning.dashboard_view', 'kanban'),
              ('planning.deck_mode', 'project'),
              ('planning.mode_section', 'timeline'),
              ('planning.timeline_start_hour', '9'),
              ('planning.timeline_end_hour', '22');
            UPDATE app_settings SET value = 'planning' WHERE key = 'shell.workspace';
            "#,
        )
        .expect("the schema-7 layout should seed");
    if with_rows {
        connection
            .execute_batch(
                r#"
                INSERT INTO projects(id, title) VALUES ('proj-1', 'Spring season');
                INSERT INTO tasks(id, project_id) VALUES ('task-1', 'proj-1');
                INSERT INTO task_checklist_items(id, task_id) VALUES ('check-1', 'task-1');
                INSERT INTO activity_log(id, detail) VALUES ('act-1', 'Project created');
                "#,
            )
            .expect("the Planning rows should seed");
    }
}

// D3: a new archive is format 5 and carries nothing of Planning — no
// `planning` part, no Planning setting, no project, task or activity entry —
// and the export's reply no longer counts them. Verify reads it back as
// format 5 with nothing left out.
#[test]
fn a_new_archive_is_format_5_and_carries_no_planning() {
    let test_dir = TestDir::new("format-5");
    let runtime = seeded_runtime(&test_dir);

    let export = export_support_backup(&runtime).expect("export should succeed");
    assert_eq!(SUPPORT_BACKUP_FORMAT_VERSION, 5);
    assert_eq!(export.format_version, 5);
    let reply = serde_json::to_value(&export).expect("reply should serialize");
    let mut reply_keys = reply
        .as_object()
        .expect("the reply is an object")
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    reply_keys.sort();
    assert_eq!(reply_keys, ["fileName", "formatVersion", "path"]);

    let raw: Value = serde_json::from_slice(&fs::read(&export.path).expect("archive should read"))
        .expect("archive should parse");
    assert_eq!(raw["formatVersion"], json!(5));
    let keys = every_key(&raw);
    for key in &keys {
        assert!(
            key != "planning" && !key.starts_with("planning."),
            "the archive carries {key}"
        );
        assert!(
            !["projects", "tasks", "activityLog", "checklist"].contains(&key.as_str()),
            "the archive carries {key}"
        );
    }
    assert_eq!(raw["shell"]["workspace"], json!("audio"));

    let verification = verify_support_backup(&request_for(&runtime, Path::new(&export.path)));
    assert!(verification.ok, "{}", verification.detail);
    assert_eq!(verification.format_version, Some(5));
    assert_eq!(
        verification.detail,
        format!(
            "Backup archive, format 5, exported {}.",
            raw["exportedAt"]
                .as_str()
                .expect("the archive has its time")
        )
    );
    assert_operator_words(&verification.detail);
}

// D3: an archive of format 4 still restores — everything but its Planning
// part, which is skipped (no Planning table comes back, no `planning.*`
// setting is written, and it adds nothing to the settings count), and the
// Planning page it saved opens the Console (D1, D2). The reply says the
// Planning data was not restored, and only when there was some.
#[test]
fn a_format_4_archive_restores_everything_but_its_planning_part() {
    let test_dir = TestDir::new("format-4-restore");
    let runtime = seeded_runtime(&test_dir);
    let kept: Vec<(String, String)> = vec![
        (
            String::from("app.lighting.grand_master"),
            String::from("64"),
        ),
        (
            String::from("app.audio.faders_per_bank"),
            String::from("12"),
        ),
        (String::from(WINDOW_MODE_KEY), String::from("windowed")),
        (
            String::from("app.control_surface.audio.bank"),
            String::from("2"),
        ),
    ];
    set_settings_owned(&runtime.db_path, &kept).expect("settings should seed");
    let with_rows = write_archive(
        &runtime,
        "native-backup-format-4-planning.json",
        &format_4_archive(&runtime, true),
    );
    let without_rows = write_archive(
        &runtime,
        "native-backup-format-4-settings-only.json",
        &format_4_archive(&runtime, false),
    );
    let current = export_support_backup(&runtime).expect("export should succeed");

    // Everything changes after the export.
    let changed = kept
        .iter()
        .map(|(key, _)| (key.clone(), String::from("changed")))
        .chain([(String::from(WORKSPACE_KEY), String::from("lighting"))])
        .collect::<Vec<_>>();
    set_settings_owned(&runtime.db_path, &changed).expect("changes should persist");

    let summary = restore_support_backup(&runtime, &request_for(&runtime, &with_rows))
        .expect("a format-4 archive restores");
    assert_eq!(summary.source_format, "native-support-backup");
    assert!(!summary.requires_restart);
    assert_eq!(summary.detail.as_deref(), Some(PLANNING_WAS_NOT_RESTORED));
    assert_operator_words(PLANNING_WAS_NOT_RESTORED);

    let settings = list_settings_by_prefix(&runtime.db_path, "").expect("settings should load");
    for (key, value) in &kept {
        assert_eq!(settings.get(key), Some(value), "{key} is restored");
    }
    assert_eq!(
        settings.get(WORKSPACE_KEY).map(String::as_str),
        Some("audio"),
        "the saved Planning page opens the Console"
    );
    let commissioning =
        read_commissioning_snapshot(&runtime.db_path).expect("commissioning snapshot should load");
    assert!(commissioning.has_completed_setup);
    let control_surface = commissioning
        .checks
        .iter()
        .find(|check| check.id == "control-surface")
        .expect("the Control Surface Probe is listed");
    assert_eq!(
        control_surface.status, "passed",
        "the probe's status stands"
    );
    assert_eq!(
        control_surface.message, PROBE_CHECKED_BEFORE_THIS_VERSION,
        "the probe's line no longer talks about Planning"
    );
    assert_operator_words(PROBE_CHECKED_BEFORE_THIS_VERSION);
    let planning_keys = settings
        .keys()
        .filter(|key| key.starts_with("planning."))
        .collect::<Vec<_>>();
    assert!(planning_keys.is_empty(), "{planning_keys:?}");
    assert!(planning_tables_in(&runtime.db_path).is_empty());

    // The Planning part adds nothing: the same saved data from this build's
    // own archive restores exactly as many settings.
    let current_summary =
        restore_support_backup(&runtime, &request_for(&runtime, Path::new(&current.path)))
            .expect("the current archive restores");
    assert_eq!(current_summary.detail, None);
    assert_eq!(summary.settings_restored, current_summary.settings_restored);

    // Planning settings alone are not Planning data: skipped without a word.
    set_settings_owned(
        &runtime.db_path,
        &[(String::from(WORKSPACE_KEY), String::from("lighting"))],
    )
    .expect("the page should persist");
    let settings_only = restore_support_backup(&runtime, &request_for(&runtime, &without_rows))
        .expect("a format-4 archive without Planning rows restores");
    assert_eq!(settings_only.detail, None);
    assert_eq!(
        settings_only.settings_restored,
        current_summary.settings_restored
    );
    assert!(list_settings_by_prefix(&runtime.db_path, "planning.")
        .expect("settings should load")
        .is_empty());
    assert_eq!(
        list_settings_by_prefix(&runtime.db_path, WORKSPACE_KEY)
            .expect("settings should load")
            .get(WORKSPACE_KEY)
            .map(String::as_str),
        Some("audio")
    );
}

// D3: Verify of an archive written before Planning left no longer counts
// projects and tasks; it says the Planning part will not be restored when
// the archive holds Planning data, and says nothing of it otherwise. A
// legacy db.json (interim until Slice 2b) says what is still read from it.
#[test]
fn verify_says_a_format_4_archive_s_planning_part_is_skipped() {
    let test_dir = TestDir::new("format-4-verify");
    let runtime = seeded_runtime(&test_dir);
    let with_rows_archive = format_4_archive(&runtime, true);
    let exported_at = with_rows_archive["exportedAt"]
        .as_str()
        .expect("the archive has its time")
        .to_string();
    let with_rows = write_archive(
        &runtime,
        "native-backup-format-4-planning.json",
        &with_rows_archive,
    );
    let mut without_rows_archive = format_4_archive(&runtime, false);
    without_rows_archive["exportedAt"] = json!(exported_at);
    let without_rows = write_archive(
        &runtime,
        "native-backup-format-4-settings-only.json",
        &without_rows_archive,
    );

    let checked = verify_support_backup(&request_for(&runtime, &with_rows));
    assert!(checked.ok, "{}", checked.detail);
    assert_eq!(checked.format_version, Some(4));
    assert_eq!(
        checked.detail,
        format!(
            "Backup archive, format 4, exported {exported_at}. {PLANNING_WILL_NOT_BE_RESTORED}"
        )
    );
    assert!(!checked.detail.contains("1 project"), "{}", checked.detail);
    assert_operator_words(&checked.detail);

    let checked = verify_support_backup(&request_for(&runtime, &without_rows));
    assert!(checked.ok, "{}", checked.detail);
    assert_eq!(
        checked.detail,
        format!("Backup archive, format 4, exported {exported_at}.")
    );

    let legacy = runtime.backups_dir.join("legacy-db.json");
    seed_legacy_payload(&legacy);
    let checked = verify_support_backup(&request_for(&runtime, &legacy));
    assert!(checked.ok, "{}", checked.detail);
    assert_eq!(checked.schema_version, Some(9));
    assert_eq!(
        checked.detail,
        format!(
            "Legacy db.json export (schema 9); only whether setup is complete and the page to open are restored from it. {PLANNING_WILL_NOT_BE_RESTORED}"
        )
    );
    assert_operator_words(&checked.detail);
}

// D2, D3: a database backup of schema 8 and one of schema 7 (from before
// Planning left) both verify and restore; a newer one is refused before
// anything is staged. The schema-7 backup's Planning settings are not
// counted, its Planning rows are named as not restored, and it is upgraded
// again at the next start, which removes them. Before the backups left
// Planning, every schema-8 backup was refused ("no such table: projects").
#[test]
fn database_backups_of_schema_7_and_8_restore_and_a_newer_one_is_refused() {
    let test_dir = TestDir::new("schema-7-and-8");
    let runtime = seeded_runtime(&test_dir);
    let schema_8 = snapshot_database(
        &runtime.db_path,
        &runtime.backups_dir,
        SnapshotReason::Daily,
    )
    .expect("database backup should write");
    let schema_7_rows = runtime.backups_dir.join("db-schema-7-planning.sqlite3");
    let schema_7_settings_only = runtime
        .backups_dir
        .join("db-schema-7-settings-only.sqlite3");
    let schema_9 = runtime.backups_dir.join("db-schema-9.sqlite3");
    for copy in [&schema_7_rows, &schema_7_settings_only, &schema_9] {
        fs::copy(&schema_8, copy).expect("backup should copy");
    }
    make_schema_7_backup(&schema_7_rows, true);
    make_schema_7_backup(&schema_7_settings_only, false);
    Connection::open(&schema_9)
        .expect("backup should open")
        .execute("INSERT INTO schema_migrations(version) VALUES (9)", [])
        .expect("the newer schema should seed");

    let checked_8 = verify_support_backup(&request_for(&runtime, &schema_8));
    assert!(checked_8.ok, "{}", checked_8.detail);
    assert_eq!(checked_8.schema_version, Some(8));
    let settings_8 = inspect_database_backup(&schema_8)
        .expect("a schema-8 backup is a good database")
        .settings_count;
    assert_eq!(
        checked_8.detail,
        format!("Database backup, schema 8, integrity ok: {settings_8} settings.")
    );
    assert_operator_words(&checked_8.detail);

    let checked_7 = verify_support_backup(&request_for(&runtime, &schema_7_rows));
    assert!(checked_7.ok, "{}", checked_7.detail);
    assert_eq!(checked_7.schema_version, Some(7));
    assert_eq!(
        checked_7.detail,
        format!(
            "Database backup, schema 7, integrity ok: {settings_8} settings. {PLANNING_WILL_NOT_BE_RESTORED}"
        ),
        "the seven Planning settings are not counted"
    );
    assert_operator_words(&checked_7.detail);
    let checked_7 = verify_support_backup(&request_for(&runtime, &schema_7_settings_only));
    assert!(checked_7.ok, "{}", checked_7.detail);
    assert_eq!(
        checked_7.detail,
        format!("Database backup, schema 7, integrity ok: {settings_8} settings.")
    );

    let checked_9 = verify_support_backup(&request_for(&runtime, &schema_9));
    assert!(!checked_9.ok);
    assert_eq!(checked_9.schema_version, Some(9));
    assert!(
        checked_9.detail.contains("newer Studio Control"),
        "{}",
        checked_9.detail
    );
    let pending = runtime.app_data_dir.join(RESTORE_PENDING_FILE_NAME);
    match restore_support_backup(&runtime, &request_for(&runtime, &schema_9)) {
        Err(SupportCommandError::UnsupportedVersion(message)) => {
            assert!(message.contains("schema 9"), "{message}");
        }
        other => panic!("expected UnsupportedVersion, got {other:?}"),
    }
    assert!(!pending.exists(), "nothing is staged");

    let staged_8 = restore_support_backup(&runtime, &request_for(&runtime, &schema_8))
        .expect("a schema-8 backup restores");
    assert!(staged_8.requires_restart);
    assert_eq!(staged_8.detail, None);

    let staged_7 = restore_support_backup(&runtime, &request_for(&runtime, &schema_7_rows))
        .expect("a schema-7 backup restores");
    assert!(staged_7.requires_restart);
    assert_eq!(staged_7.settings_restored, settings_8);
    assert_eq!(staged_7.detail.as_deref(), Some(PLANNING_WAS_NOT_RESTORED));

    // The next start: the bootstrap moves the pending file into place and
    // opens it, and the schema-8 upgrade runs on it like any older data.
    let next_start = test_dir.path().join("next-start");
    fs::create_dir_all(&next_start).expect("next start dir should create");
    let restored = next_start.join("studio-control.sqlite3");
    fs::copy(&pending, &restored).expect("pending should copy");
    let bootstrap = initialize_database(&restored, &next_start.join("backups"))
        .expect("the restored backup opens");
    assert_eq!(bootstrap.schema_version, 8);
    assert!(planning_tables_in(&restored).is_empty());
    let settings = list_settings_by_prefix(&restored, "").expect("settings should load");
    assert!(!settings.keys().any(|key| key.starts_with("planning.")));
    assert_eq!(
        settings.get(WORKSPACE_KEY).map(String::as_str),
        Some("audio")
    );
}
