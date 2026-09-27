//! Helpers the support tests share: a scratch runtime, the saved data they start
//! from, the old Studio Control export and the restore request. Moved out of
//! `tests.rs` unchanged (new pages program, Slice 4) when the tests were split
//! under the 2,000-line file-health guard.

use super::*;
use crate::app_state::COMMISSIONING_RUNNER_STAGE_KEY;
use crate::control_surface::ControlSurfaceBridgeInfo;
use crate::storage::{initialize_test_database, set_settings_owned};
use serde_json::json;
use std::process;

pub(super) struct TestDir {
    path: PathBuf,
}

impl TestDir {
    pub(super) fn new(label: &str) -> Self {
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

    pub(super) fn runtime(&self) -> RuntimeContext {
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
            cameras_simulated: true,
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

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// The saved data most of these tests start from: setup complete and the
/// Console the page to open. New pages program, Slice 2b: written directly;
/// until then it came from `write_old_studio_control_export`'s file through
/// the db.json import (`hasCompletedSetup: true`, `dashboardView: audio`),
/// which wrote these four settings and nothing else of it.
pub(super) fn seed_completed_setup(db_path: &Path) {
    set_settings_owned(
        db_path,
        &[
            (
                String::from(COMMISSIONING_COMPLETED_KEY),
                String::from("true"),
            ),
            (
                String::from(COMMISSIONING_RUNNER_STAGE_KEY),
                String::from("publish"),
            ),
            (String::from(COMMISSIONING_STAGE_KEY), String::from("ready")),
            (String::from(WORKSPACE_KEY), String::from("audio")),
        ],
    )
    .expect("the completed setup should seed");
}

/// An export from the old Studio Control (a db.json): its schema number, a
/// project, a task, an activity entry and its settings.
pub(super) fn write_old_studio_control_export(path: &Path) {
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
        .expect("the old export should serialize"),
    )
    .expect("the old export should be written");
}

/// `text` as Windows Notepad's "Unicode" and a PowerShell 5 `>` save it:
/// UTF-16 LE after the bytes FF FE, which are never UTF-8.
pub(super) fn utf16_with_bom(text: &str) -> Vec<u8> {
    [0xFF, 0xFE]
        .into_iter()
        .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
        .collect()
}

pub(super) fn seeded_runtime(test_dir: &TestDir) -> RuntimeContext {
    let runtime = test_dir.runtime();
    seed_completed_setup(&runtime.db_path);
    runtime
}

pub(super) fn request_for(runtime: &RuntimeContext, path: &Path) -> SupportRestoreRequest {
    parse_support_restore_request(
        &json!({ "path": path.display().to_string() }),
        &runtime.backups_dir,
    )
    .unwrap_or_else(|error| panic!("{} should be a valid source: {error}", path.display()))
}

/// The words the operator never reads (the rule `action_log`'s
/// `sentences_avoid_the_words_the_operator_never_reads` holds for its rows),
/// held here for the Verify and restore sentences.
pub(super) fn assert_operator_words(sentence: &str) {
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
