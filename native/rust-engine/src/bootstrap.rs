use crate::control_surface::{
    resolve_control_surface_port, start_control_surface_bridge, ControlSurfaceBridgeInfo,
};
use crate::diagnostics::append_log;
use crate::legacy_import::LegacyImportRequest;
use crate::planning::planning_data_present;
use crate::storage::{import_legacy_db, initialize_database, EngineResult, StorageBootstrap};
use std::env;
use std::fs;
use std::path::PathBuf;

pub const SUPPORTED_PROTOCOL_VERSION: &str = "1";

pub struct RuntimePaths {
    pub protocol_version: String,
    pub requested_protocol_version: String,
    pub app_data_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub log_file_path: PathBuf,
    pub db_path: PathBuf,
    pub update_repository_path: Option<PathBuf>,
}

pub struct RuntimeContext {
    pub protocol_version: String,
    pub app_data_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub log_file_path: PathBuf,
    pub db_path: PathBuf,
    pub update_repository_path: Option<PathBuf>,
    pub storage_ready: bool,
    pub storage_bootstrap: StorageBootstrap,
    pub control_surface_bridge: ControlSurfaceBridgeInfo,
}

pub fn resolve_runtime_paths() -> RuntimePaths {
    let requested_protocol_version = env::var("SSE_PROTOCOL_VERSION")
        .unwrap_or_else(|_| String::from(SUPPORTED_PROTOCOL_VERSION));
    let app_data_dir = env::var("SSE_APP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./native-runtime"));
    let logs_dir = env::var("SSE_LOG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| app_data_dir.join("logs"));
    let backups_dir = app_data_dir.join("backups");
    let log_file_path = logs_dir.join("engine.log");
    let db_path = app_data_dir.join("studio-control.sqlite3");
    let update_repository_path = env::var("SSE_UPDATE_REPOSITORY_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    RuntimePaths {
        protocol_version: String::from(SUPPORTED_PROTOCOL_VERSION),
        requested_protocol_version,
        app_data_dir,
        backups_dir,
        logs_dir,
        log_file_path,
        db_path,
        update_repository_path,
    }
}

pub fn validate_protocol_version(requested_protocol_version: &str) -> Result<(), String> {
    if requested_protocol_version == SUPPORTED_PROTOCOL_VERSION {
        return Ok(());
    }

    Err(format!(
        "Shell requested protocol '{}' but this engine supports '{}'.",
        requested_protocol_version, SUPPORTED_PROTOCOL_VERSION
    ))
}

pub fn bootstrap_runtime() -> EngineResult<RuntimeContext> {
    let runtime_paths = resolve_runtime_paths();
    validate_protocol_version(&runtime_paths.requested_protocol_version)
        .map_err(|message| std::io::Error::other(message))?;

    fs::create_dir_all(&runtime_paths.app_data_dir)?;
    fs::create_dir_all(&runtime_paths.logs_dir)?;
    fs::create_dir_all(&runtime_paths.backups_dir)?;

    append_log(
        &runtime_paths.log_file_path,
        "INFO",
        "Bootstrapping runtime directories",
    )?;
    let storage_bootstrap = initialize_database(&runtime_paths.db_path)?;
    append_log(
        &runtime_paths.log_file_path,
        "INFO",
        &format!(
            "Storage initialized: schema={}, journal_mode={}, integrity={}",
            storage_bootstrap.schema_version,
            storage_bootstrap.journal_mode,
            storage_bootstrap.integrity_check
        ),
    )?;

    if !planning_data_present(&runtime_paths.db_path)? {
        if let Some(source_path) = resolve_legacy_import_source() {
            match import_legacy_db(
                &runtime_paths.db_path,
                &LegacyImportRequest {
                    source_path: source_path.clone(),
                    force: false,
                },
            ) {
                Ok(summary) => {
                    append_log(
                        &runtime_paths.log_file_path,
                        "INFO",
                        &format!(
                            "Auto-imported legacy db from {}: {} projects, {} tasks",
                            summary.source_path, summary.imported_projects, summary.imported_tasks
                        ),
                    )?;
                }
                Err(error) => {
                    append_log(
                        &runtime_paths.log_file_path,
                        "WARN",
                        &format!(
                            "Legacy auto-import skipped or failed for {}: {}",
                            source_path.display(),
                            error
                        ),
                    )?;
                }
            }
        } else {
            append_log(
                &runtime_paths.log_file_path,
                "INFO",
                "No legacy db.json source discovered for auto-import.",
            )?;
        }
    }

    let requested_control_surface_port = resolve_control_surface_port();
    let control_surface_bridge = start_control_surface_bridge(
        &runtime_paths.db_path,
        &runtime_paths.log_file_path,
        requested_control_surface_port,
    );
    append_log(
        &runtime_paths.log_file_path,
        if control_surface_bridge.available {
            "INFO"
        } else {
            "WARN"
        },
        &control_surface_bridge.summary,
    )?;

    Ok(RuntimeContext {
        protocol_version: runtime_paths.protocol_version,
        app_data_dir: runtime_paths.app_data_dir,
        backups_dir: runtime_paths.backups_dir,
        logs_dir: runtime_paths.logs_dir,
        log_file_path: runtime_paths.log_file_path,
        db_path: runtime_paths.db_path,
        update_repository_path: runtime_paths.update_repository_path,
        storage_ready: true,
        storage_bootstrap,
        control_surface_bridge,
    })
}

fn resolve_legacy_import_source() -> Option<PathBuf> {
    if env::var("SSE_DISABLE_AUTO_IMPORT")
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE"))
        .unwrap_or(false)
    {
        return None;
    }

    if let Ok(explicit_path) = env::var("SSE_LEGACY_DB_PATH") {
        let explicit_path = explicit_path.trim();
        if !explicit_path.is_empty() {
            return Some(PathBuf::from(explicit_path));
        }
    }

    let current_dir = env::current_dir().ok()?;
    let repo_candidate = current_dir.join("data").join("db.json");
    if repo_candidate.exists() {
        return Some(repo_candidate);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{validate_protocol_version, SUPPORTED_PROTOCOL_VERSION};

    #[test]
    fn protocol_validation_accepts_supported_version() {
        validate_protocol_version(SUPPORTED_PROTOCOL_VERSION)
            .expect("supported protocol should validate");
    }

    #[test]
    fn protocol_validation_rejects_mismatched_version() {
        let error = validate_protocol_version("99").expect_err("mismatched protocol should fail");
        assert!(error.contains("supports"));
        assert!(error.contains(SUPPORTED_PROTOCOL_VERSION));
    }
}
