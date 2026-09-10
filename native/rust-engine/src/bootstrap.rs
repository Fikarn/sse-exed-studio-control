use crate::control_surface::{resolve_control_surface_port, ControlSurfaceBridgeInfo};
use crate::control_surface_http::{load_or_create_bridge_token, start_control_surface_bridge};
use crate::diagnostics::append_log;
use crate::legacy_import::LegacyImportRequest;
use crate::planning::planning_data_present;
use crate::storage::{import_legacy_db, initialize_database, EngineResult, StorageBootstrap};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

pub const SUPPORTED_PROTOCOL_VERSION: &str = "1";

/// The directory name the Tauri shell uses under the platform app-data base
/// (`native/tauri-shell/src/engine.rs`), so a bare engine launch and a
/// shell-started engine agree on where the operator's data lives.
const DEFAULT_APP_DATA_DIR_NAME: &str = "ExEd Studio Control Native";

/// The only legacy `db.json` the engine imports on its own, relative to the
/// app-data directory. The process working directory is never scanned
/// (2026-09 production readiness, Slice 1 — finding F23).
const LEGACY_IMPORT_DIR_NAME: &str = "import";
const LEGACY_IMPORT_FILE_NAME: &str = "db.json";

#[derive(Debug)]
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
    /// The bearer token the bridge demands and the exported Stream Deck
    /// profile carries (2026-09 production readiness, Slice 2 — F01). Never
    /// part of a snapshot.
    pub control_surface_token: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimePlatform {
    Macos,
    Unix,
    Windows,
}

fn current_runtime_platform() -> RuntimePlatform {
    if cfg!(target_os = "windows") {
        RuntimePlatform::Windows
    } else if cfg!(target_os = "macos") {
        RuntimePlatform::Macos
    } else {
        RuntimePlatform::Unix
    }
}

fn env_path<F>(name: &str, get_env: &mut F) -> Option<PathBuf>
where
    F: FnMut(&str) -> Option<OsString>,
{
    get_env(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn env_string<F>(name: &str, get_env: &mut F) -> Option<String>
where
    F: FnMut(&str) -> Option<OsString>,
{
    get_env(name)
        .and_then(|value| value.into_string().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Mirror of the shell's `default_app_data_dir_for_platform`: the durable
/// per-user application-data directory of the platform, never a path
/// relative to the working directory (2026-09 production readiness, Slice 1
/// — finding F22).
fn default_app_data_dir_for_platform<F>(
    platform: RuntimePlatform,
    get_env: &mut F,
) -> Result<PathBuf, String>
where
    F: FnMut(&str) -> Option<OsString>,
{
    let base = match platform {
        RuntimePlatform::Windows => {
            env_path("APPDATA", get_env).or_else(|| env_path("LOCALAPPDATA", get_env))
        }
        RuntimePlatform::Macos => {
            env_path("HOME", get_env).map(|home| home.join("Library").join("Application Support"))
        }
        RuntimePlatform::Unix => env_path("XDG_DATA_HOME", get_env)
            .or_else(|| env_path("HOME", get_env).map(|home| home.join(".local").join("share"))),
    };

    base.map(|path| path.join(DEFAULT_APP_DATA_DIR_NAME))
        .ok_or_else(|| {
            String::from(
                "Unable to resolve a durable app-data directory. Set SSE_APP_DATA_DIR to an absolute path.",
            )
        })
}

pub fn resolve_runtime_paths() -> Result<RuntimePaths, String> {
    resolve_runtime_paths_from(current_runtime_platform(), |name| env::var_os(name))
}

fn resolve_runtime_paths_from<F>(
    platform: RuntimePlatform,
    mut get_env: F,
) -> Result<RuntimePaths, String>
where
    F: FnMut(&str) -> Option<OsString>,
{
    let requested_protocol_version = env_string("SSE_PROTOCOL_VERSION", &mut get_env)
        .unwrap_or_else(|| String::from(SUPPORTED_PROTOCOL_VERSION));
    let app_data_dir = match env_path("SSE_APP_DATA_DIR", &mut get_env) {
        Some(path) => path,
        None => default_app_data_dir_for_platform(platform, &mut get_env)?,
    };
    let logs_dir =
        env_path("SSE_LOG_DIR", &mut get_env).unwrap_or_else(|| app_data_dir.join("logs"));
    let backups_dir = app_data_dir.join("backups");
    let log_file_path = logs_dir.join("engine.log");
    let db_path = app_data_dir.join("studio-control.sqlite3");
    let update_repository_path =
        env_string("SSE_UPDATE_REPOSITORY_PATH", &mut get_env).map(PathBuf::from);

    Ok(RuntimePaths {
        protocol_version: String::from(SUPPORTED_PROTOCOL_VERSION),
        requested_protocol_version,
        app_data_dir,
        backups_dir,
        logs_dir,
        log_file_path,
        db_path,
        update_repository_path,
    })
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
    let runtime_paths = resolve_runtime_paths().map_err(std::io::Error::other)?;
    validate_protocol_version(&runtime_paths.requested_protocol_version)
        .map_err(std::io::Error::other)?;

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
            "Storage initialized: schema={}, format={}, journal_mode={}, integrity={}",
            storage_bootstrap.schema_version,
            storage_bootstrap.format_version,
            storage_bootstrap.journal_mode,
            storage_bootstrap.integrity_check
        ),
    )?;

    if !planning_data_present(&runtime_paths.db_path)? {
        if let Some(source_path) = resolve_legacy_import_source(&runtime_paths.app_data_dir) {
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

    let control_surface_token =
        load_or_create_bridge_token(&runtime_paths.app_data_dir).map_err(std::io::Error::other)?;
    let requested_control_surface_port = resolve_control_surface_port();
    let control_surface_bridge = start_control_surface_bridge(
        &runtime_paths.db_path,
        &runtime_paths.log_file_path,
        requested_control_surface_port,
        control_surface_token.clone(),
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
        control_surface_token,
    })
}

fn resolve_legacy_import_source(app_data_dir: &Path) -> Option<PathBuf> {
    resolve_legacy_import_source_from(app_data_dir, |name| env::var_os(name))
}

/// Source priority for the one-way legacy import: `SSE_LEGACY_DB_PATH`, then
/// `<app-data>/import/db.json`. Nothing else — in particular not a `db.json`
/// under the working directory the engine happened to be started from.
fn resolve_legacy_import_source_from<F>(app_data_dir: &Path, mut get_env: F) -> Option<PathBuf>
where
    F: FnMut(&str) -> Option<OsString>,
{
    if env_string("SSE_DISABLE_AUTO_IMPORT", &mut get_env)
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE"))
    {
        return None;
    }

    if let Some(explicit_path) = env_string("SSE_LEGACY_DB_PATH", &mut get_env) {
        return Some(PathBuf::from(explicit_path));
    }

    let staged_path = app_data_dir
        .join(LEGACY_IMPORT_DIR_NAME)
        .join(LEGACY_IMPORT_FILE_NAME);
    if staged_path.is_file() {
        return Some(staged_path);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{
        current_runtime_platform, default_app_data_dir_for_platform,
        resolve_legacy_import_source_from, resolve_runtime_paths_from, validate_protocol_version,
        RuntimePlatform, DEFAULT_APP_DATA_DIR_NAME, SUPPORTED_PROTOCOL_VERSION,
    };
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};
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
                "studio-control-engine-bootstrap-{label}-{}-{unique}",
                process::id()
            ));
            fs::create_dir_all(&path).expect("test dir should be created");
            Self { path }
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

    fn env_fixture(entries: &[(&str, &str)]) -> impl FnMut(&str) -> Option<OsString> {
        let entries: Vec<(String, String)> = entries
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect();
        move |name: &str| {
            entries
                .iter()
                .find(|(entry, _)| entry == name)
                .map(|(_, value)| OsString::from(value))
        }
    }

    /// The base an operator host actually provides for the platform this
    /// test runs on, so `is_absolute()` is judged by the host's own rules.
    fn host_platform_base() -> (&'static str, &'static str) {
        match current_runtime_platform() {
            RuntimePlatform::Windows => ("APPDATA", "C:\\Users\\operator\\AppData\\Roaming"),
            RuntimePlatform::Macos | RuntimePlatform::Unix => ("HOME", "/home/operator"),
        }
    }

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

    // 2026-09 production readiness, Slice 1 (finding F22): with no
    // SSE_APP_DATA_DIR the engine lands in the platform's durable app-data
    // directory — an absolute path — never in `./native-runtime`.
    #[test]
    fn default_app_data_dir_is_absolute_platform_dir() {
        let (base_name, base_value) = host_platform_base();
        let paths = resolve_runtime_paths_from(
            current_runtime_platform(),
            env_fixture(&[(base_name, base_value)]),
        )
        .expect("platform base should resolve");

        assert!(
            paths.app_data_dir.is_absolute(),
            "default app-data dir must be absolute, got {}",
            paths.app_data_dir.display()
        );
        assert!(
            paths.app_data_dir.starts_with(base_value),
            "default app-data dir must live under the platform base, got {}",
            paths.app_data_dir.display()
        );
        assert_eq!(
            paths
                .app_data_dir
                .file_name()
                .and_then(|name| name.to_str()),
            Some(DEFAULT_APP_DATA_DIR_NAME)
        );
        assert!(!paths
            .app_data_dir
            .to_string_lossy()
            .contains("native-runtime"));
        assert_eq!(
            paths.db_path,
            paths.app_data_dir.join("studio-control.sqlite3")
        );
        assert_eq!(paths.logs_dir, paths.app_data_dir.join("logs"));
        assert_eq!(paths.backups_dir, paths.app_data_dir.join("backups"));
        assert_eq!(paths.requested_protocol_version, SUPPORTED_PROTOCOL_VERSION);
        assert!(paths.update_repository_path.is_none());
    }

    #[test]
    fn every_platform_default_mirrors_the_shell_layout() {
        let mut windows = env_fixture(&[("APPDATA", "C:/Users/operator/AppData/Roaming")]);
        assert_eq!(
            default_app_data_dir_for_platform(RuntimePlatform::Windows, &mut windows)
                .expect("windows base"),
            PathBuf::from("C:/Users/operator/AppData/Roaming").join(DEFAULT_APP_DATA_DIR_NAME)
        );

        let mut windows_local = env_fixture(&[("LOCALAPPDATA", "C:/Users/operator/AppData/Local")]);
        assert_eq!(
            default_app_data_dir_for_platform(RuntimePlatform::Windows, &mut windows_local)
                .expect("windows local base"),
            PathBuf::from("C:/Users/operator/AppData/Local").join(DEFAULT_APP_DATA_DIR_NAME)
        );

        let mut macos = env_fixture(&[("HOME", "/Users/operator")]);
        assert_eq!(
            default_app_data_dir_for_platform(RuntimePlatform::Macos, &mut macos)
                .expect("macos base"),
            PathBuf::from("/Users/operator")
                .join("Library")
                .join("Application Support")
                .join(DEFAULT_APP_DATA_DIR_NAME)
        );

        let mut unix = env_fixture(&[("XDG_DATA_HOME", "/home/operator/.local/data")]);
        assert_eq!(
            default_app_data_dir_for_platform(RuntimePlatform::Unix, &mut unix).expect("xdg base"),
            PathBuf::from("/home/operator/.local/data").join(DEFAULT_APP_DATA_DIR_NAME)
        );

        let mut unix_home = env_fixture(&[("HOME", "/home/operator")]);
        assert_eq!(
            default_app_data_dir_for_platform(RuntimePlatform::Unix, &mut unix_home)
                .expect("home base"),
            PathBuf::from("/home/operator")
                .join(".local")
                .join("share")
                .join(DEFAULT_APP_DATA_DIR_NAME)
        );
    }

    #[test]
    fn runtime_paths_refuse_to_guess_without_a_platform_base() {
        let error = resolve_runtime_paths_from(current_runtime_platform(), env_fixture(&[]))
            .expect_err("no base and no override must not produce a relative default");
        assert!(error.contains("SSE_APP_DATA_DIR"), "{error}");
    }

    #[test]
    fn runtime_paths_honour_explicit_overrides() {
        let (base_name, base_value) = host_platform_base();
        let paths = resolve_runtime_paths_from(
            current_runtime_platform(),
            env_fixture(&[
                (base_name, base_value),
                ("SSE_APP_DATA_DIR", "/tmp/sse-app-data"),
                ("SSE_LOG_DIR", "/tmp/sse-logs"),
                ("SSE_PROTOCOL_VERSION", "1"),
                ("SSE_UPDATE_REPOSITORY_PATH", "  /tmp/sse-updates  "),
            ]),
        )
        .expect("explicit overrides should resolve");

        assert_eq!(paths.app_data_dir, PathBuf::from("/tmp/sse-app-data"));
        assert_eq!(paths.logs_dir, PathBuf::from("/tmp/sse-logs"));
        assert_eq!(
            paths.log_file_path,
            PathBuf::from("/tmp/sse-logs").join("engine.log")
        );
        assert_eq!(
            paths.db_path,
            PathBuf::from("/tmp/sse-app-data").join("studio-control.sqlite3")
        );
        assert_eq!(
            paths.update_repository_path,
            Some(PathBuf::from("/tmp/sse-updates"))
        );
    }

    // 2026-09 production readiness, Slice 1 (finding F23): the auto-import
    // source is the explicit env path or the staged file under app-data —
    // the process working directory is not consulted. The process-level
    // proof (a `data/db.json` under the engine's working directory stays
    // unimported) is `auto_import_ignores_cwd` in tests/end_to_end.rs,
    // because the working directory is process-wide and cannot be varied
    // inside a unit test.
    #[test]
    fn legacy_import_source_prefers_the_explicit_path() {
        let app_data = TestDir::new("legacy-explicit");
        let staged = app_data.path().join("import");
        fs::create_dir_all(&staged).expect("import dir");
        fs::write(staged.join("db.json"), "{}").expect("staged file");

        let source = resolve_legacy_import_source_from(
            app_data.path(),
            env_fixture(&[("SSE_LEGACY_DB_PATH", "/tmp/explicit/db.json")]),
        );

        assert_eq!(source, Some(PathBuf::from("/tmp/explicit/db.json")));
    }

    #[test]
    fn legacy_import_source_reads_only_the_staged_app_data_file() {
        let app_data = TestDir::new("legacy-staged");
        // A `data/db.json` next to the app-data dir (the old repo-local
        // convention) is not a source.
        let decoy = app_data.path().join("data");
        fs::create_dir_all(&decoy).expect("decoy dir");
        fs::write(decoy.join("db.json"), "{}").expect("decoy file");

        assert_eq!(
            resolve_legacy_import_source_from(app_data.path(), env_fixture(&[])),
            None,
            "without a staged import file there is no auto-import source"
        );

        let staged = app_data.path().join("import");
        fs::create_dir_all(&staged).expect("import dir");
        fs::write(staged.join("db.json"), "{}").expect("staged file");

        assert_eq!(
            resolve_legacy_import_source_from(app_data.path(), env_fixture(&[])),
            Some(staged.join("db.json"))
        );
    }

    #[test]
    fn legacy_import_source_is_disabled_by_env() {
        let app_data = TestDir::new("legacy-disabled");
        let staged = app_data.path().join("import");
        fs::create_dir_all(&staged).expect("import dir");
        fs::write(staged.join("db.json"), "{}").expect("staged file");

        assert_eq!(
            resolve_legacy_import_source_from(
                app_data.path(),
                env_fixture(&[
                    ("SSE_DISABLE_AUTO_IMPORT", "1"),
                    ("SSE_LEGACY_DB_PATH", "/tmp/explicit/db.json"),
                ]),
            ),
            None
        );
    }
}
