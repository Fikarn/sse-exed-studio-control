//! The legacy (pre-2.0) db.json import. New pages program, Slice 2: reduced
//! to what is not Planning — the setup flag and the page to open. The
//! projects, tasks, checklists, activity entries and Planning settings a
//! db.json holds are not read at all. Interim: Slice 2b retires the import
//! (D3), with `storage.importLegacyDb`, the start-up auto-import and
//! `SSE_LEGACY_DB_PATH`; until then seven lanes and scripts still seed a test
//! workstation through it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::error::Error;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum ImportLegacyError {
    SourceNotFound(PathBuf),
    SourceReadFailed(String),
    SourceParseFailed(String),
    ExistingDataRequiresForce,
    Storage(String),
}

impl fmt::Display for ImportLegacyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SourceNotFound(path) => {
                write!(
                    f,
                    "Legacy database source file was not found: {}",
                    path.display()
                )
            }
            Self::SourceReadFailed(message) => {
                write!(f, "Failed to read legacy database: {message}")
            }
            Self::SourceParseFailed(message) => {
                write!(f, "Failed to parse legacy database JSON: {message}")
            }
            Self::ExistingDataRequiresForce => write!(
                f,
                "The saved data already holds a completed setup or an earlier db.json import. Re-run with force=true to replace its setup flag and the page it opens on."
            ),
            Self::Storage(message) => write!(f, "Native storage operation failed: {message}"),
        }
    }
}

impl Error for ImportLegacyError {}

#[derive(Debug, Clone)]
pub struct LegacyImportRequest {
    pub source_path: PathBuf,
    pub force: bool,
}

#[derive(Debug, Clone)]
pub struct LegacyImportPayload {
    pub source_path: PathBuf,
    pub source_schema_version: i64,
    pub settings: ImportedSettings,
}

/// What the import writes: the setup flag (as the three commissioning keys)
/// and the page to open.
#[derive(Debug, Clone)]
pub struct ImportedSettings {
    pub commissioning_completed: bool,
    pub commissioning_runner_stage: String,
    pub commissioning_stage: String,
    pub shell_workspace: String,
}

/// The reply of `storage.importLegacyDb`. Slice 2: the Planning counts
/// (`importedProjects`, `importedTasks`, `importedChecklistItems`,
/// `importedActivityEntries`, `normalizedRunningTasks`) are gone with the
/// Planning part of the import.
#[derive(Debug, Serialize)]
pub struct LegacyImportSummary {
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "sourceSchemaVersion")]
    pub source_schema_version: i64,
    #[serde(rename = "replacedExistingData")]
    pub replaced_existing_data: bool,
    #[serde(rename = "updatedSettings")]
    pub updated_settings: usize,
}

/// Only the parts of a db.json the import still reads; everything else in
/// the file (its projects, tasks, activity log, Planning settings, lights)
/// is ignored.
#[derive(Debug, Deserialize, Default)]
struct LegacyDbWire {
    #[serde(default, rename = "schemaVersion")]
    schema_version: i64,
    #[serde(default)]
    settings: LegacySettingsWire,
}

#[derive(Debug, Deserialize, Default)]
struct LegacySettingsWire {
    #[serde(default, rename = "dashboardView")]
    dashboard_view: String,
    #[serde(default, rename = "hasCompletedSetup")]
    has_completed_setup: bool,
}

pub fn parse_import_request(params: &Value) -> Result<LegacyImportRequest, String> {
    let path = params
        .get("path")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("path is required and must be a non-empty string"))?;

    let force = match params.get("force") {
        Some(value) => value
            .as_bool()
            .ok_or_else(|| String::from("force must be a boolean"))?,
        None => false,
    };

    Ok(LegacyImportRequest {
        source_path: PathBuf::from(path),
        force,
    })
}

pub fn load_legacy_import_payload(
    source_path: &Path,
) -> Result<LegacyImportPayload, ImportLegacyError> {
    if !source_path.exists() {
        return Err(ImportLegacyError::SourceNotFound(source_path.to_path_buf()));
    }

    let contents = fs::read_to_string(source_path)
        .map_err(|error| ImportLegacyError::SourceReadFailed(error.to_string()))?;
    let wire = serde_json::from_str::<LegacyDbWire>(&contents)
        .map_err(|error| ImportLegacyError::SourceParseFailed(error.to_string()))?;

    Ok(LegacyImportPayload {
        source_path: source_path.to_path_buf(),
        source_schema_version: wire.schema_version,
        settings: normalize_settings(wire.settings),
    })
}

fn normalize_settings(settings: LegacySettingsWire) -> ImportedSettings {
    let commissioning_completed = settings.has_completed_setup;

    ImportedSettings {
        commissioning_completed,
        commissioning_runner_stage: if commissioning_completed {
            String::from("publish")
        } else {
            String::from("import")
        },
        commissioning_stage: if commissioning_completed {
            String::from("ready")
        } else {
            String::from("setup-required")
        },
        shell_workspace: String::from(dashboard_view_to_workspace(&settings.dashboard_view)),
    }
}

/// The page a legacy db.json opens on, from its dashboard view. Its Planning
/// board (`kanban`), and anything else that is not Lighting, opens the
/// Console since Planning left the app (new pages program, D1).
fn dashboard_view_to_workspace(value: &str) -> &'static str {
    match value.trim() {
        "lighting" => "lighting",
        _ => "audio",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_import_request_requires_path() {
        let error = parse_import_request(&json!({})).expect_err("path should be required");
        assert_eq!(error, "path is required and must be a non-empty string");
    }

    // New pages program, Slice 2: the page a db.json opens on is Lighting or
    // the Console; its Planning board (and any other view) opens the Console
    // (D1). Before Slice 2 the Planning board opened Planning.
    #[test]
    fn a_planning_board_opens_the_console() {
        for (dashboard_view, workspace) in [
            ("kanban", "audio"),
            ("planning", "audio"),
            ("", "audio"),
            ("audio", "audio"),
            ("lighting", "lighting"),
            (" lighting ", "lighting"),
        ] {
            let normalized = normalize_settings(LegacySettingsWire {
                dashboard_view: String::from(dashboard_view),
                has_completed_setup: false,
            });
            assert_eq!(normalized.shell_workspace, workspace, "{dashboard_view:?}");
            assert_eq!(normalized.commissioning_runner_stage, "import");
            assert_eq!(normalized.commissioning_stage, "setup-required");
            assert!(!normalized.commissioning_completed);
        }

        let completed = normalize_settings(LegacySettingsWire {
            dashboard_view: String::from("kanban"),
            has_completed_setup: true,
        });
        assert!(completed.commissioning_completed);
        assert_eq!(completed.commissioning_runner_stage, "publish");
        assert_eq!(completed.commissioning_stage, "ready");
    }

    // New pages program, Slice 2: a db.json's Planning part is not read, so
    // Planning data the old import refused (a task whose project is missing,
    // a project without an id) no longer stops the setup flag and the page.
    #[test]
    fn the_planning_part_of_a_db_json_is_ignored() {
        let directory = std::env::temp_dir().join(format!(
            "studio-control-legacy-import-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&directory).expect("test dir should be created");
        let source = directory.join("db.json");
        fs::write(
            &source,
            serde_json::to_vec(&json!({
                "schemaVersion": 8,
                "projects": [{ "title": "No id" }],
                "tasks": [{ "id": "task-1", "projectId": "missing", "title": "Orphan" }],
                "activityLog": "not even a list",
                "settings": {
                    "viewFilter": "done",
                    "selectedProjectId": "missing",
                    "deckMode": "project",
                    "dashboardView": "lighting",
                    "hasCompletedSetup": true
                }
            }))
            .expect("the db.json should serialize"),
        )
        .expect("the db.json should be written");

        let payload = load_legacy_import_payload(&source).expect("the db.json should load");
        let _ = fs::remove_dir_all(&directory);

        assert_eq!(payload.source_schema_version, 8);
        assert_eq!(payload.settings.shell_workspace, "lighting");
        assert!(payload.settings.commissioning_completed);
        assert_eq!(payload.settings.commissioning_stage, "ready");
    }
}
