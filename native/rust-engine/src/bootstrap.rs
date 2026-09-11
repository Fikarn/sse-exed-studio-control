use crate::control_surface::{resolve_control_surface_port, ControlSurfaceBridgeInfo};
use crate::control_surface_http::{load_or_create_bridge_token, start_control_surface_bridge};
use crate::diagnostics::append_log;
use crate::legacy_import::LegacyImportRequest;
use crate::planning::planning_data_present;
use crate::storage::{
    import_legacy_db, initialize_database, EngineResult, StorageBootstrap, StorageError,
    STORAGE_SCHEMA_VERSION,
};
use crate::storage_backups::{newest_snapshot, reserve_snapshot_path, SnapshotReason};
use crate::support::{inspect_database_backup, prune_exports, RESTORE_PENDING_FILE_NAME};
use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

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

pub const STARTUP_CODE_BOOTSTRAP_FAILED: &str = "BOOTSTRAP_FAILED";
/// The database failed its integrity check, or is not a database at all
/// (2026-09 production readiness, Slice 3 — F02).
pub const STARTUP_CODE_STORAGE_CORRUPT: &str = "STORAGE_CORRUPT";
/// A schema migration refused a stored value it could not read; nothing was
/// changed and the pre-migration backup is on disk (Slice 3 — F13).
pub const STARTUP_CODE_STORAGE_MIGRATION_FAILED: &str = "STORAGE_MIGRATION_FAILED";
/// Sub-directory of the app-data directory where the shell writes diagnostics
/// exports; reported as `runtime.paths.exportsDir` so the Support surfaces
/// can open it (2026-09 production readiness, Slice 4 — finding F15).
pub const EXPORTS_DIR_NAME: &str = "exports";
/// Another engine already holds this app-data directory's instance lock
/// (2026-09 production readiness, Slice 5 — F19): a second copy of the app
/// would otherwise open the same database and drive the same light outputs.
pub const STARTUP_CODE_ENGINE_ALREADY_RUNNING: &str = "ENGINE_ALREADY_RUNNING";
/// The file under the app-data directory whose exclusive OS lock marks the
/// one engine allowed to use that directory. The OS releases the lock when
/// the holder ends, however it ends; the file itself stays and is empty.
pub const INSTANCE_LOCK_FILE_NAME: &str = "engine.lock";

/// The instance lock, held for the life of the process. A test that
/// bootstraps one directory twice in one process replaces the earlier hold
/// (`release_instance_lock_for`); a real engine bootstraps once.
static INSTANCE_LOCK: Mutex<Option<(PathBuf, File)>> = Mutex::new(None);

/// A bootstrap failure with a stable code for `engine.startupFailed`, so the
/// recovery display can name what happened instead of "startup failed". The
/// message is the operator's sentence; the log gets the same line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartupFailure {
    pub code: &'static str,
    pub message: String,
}

impl fmt::Display for StartupFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for StartupFailure {}

/// The code `engine.startupFailed` carries for a bootstrap error: the
/// failure's own when it has one, `BOOTSTRAP_FAILED` otherwise.
pub fn startup_failure_code(error: &(dyn Error + Send + Sync + 'static)) -> &'static str {
    error
        .downcast_ref::<StartupFailure>()
        .map(|failure| failure.code)
        .unwrap_or(STARTUP_CODE_BOOTSTRAP_FAILED)
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
    bootstrap_runtime_from_paths(runtime_paths)
}

pub(crate) fn bootstrap_runtime_from_paths(
    runtime_paths: RuntimePaths,
) -> EngineResult<RuntimeContext> {
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
    // One engine per app-data directory, before the database is touched
    // (Slice 5 — F19).
    release_instance_lock_for(&runtime_paths.app_data_dir);
    let instance_lock = match acquire_instance_lock(&runtime_paths.app_data_dir) {
        Ok(lock) => lock,
        Err(failure) => {
            let _ = append_log(
                &runtime_paths.log_file_path,
                "ERROR",
                &format!(
                    "Instance lock refused ({}): {failure}",
                    startup_failure_code(failure.as_ref())
                ),
            );
            return Err(failure);
        }
    };
    hold_instance_lock(&runtime_paths.app_data_dir, instance_lock);
    // A database restore the Support surface staged is applied here (Slice 7
    // — F20): after the lock, before the database is opened.
    if let Err(error) = apply_pending_restore(&runtime_paths) {
        let _ = append_log(
            &runtime_paths.log_file_path,
            "ERROR",
            &format!("Pending database restore could not be applied: {error}"),
        );
        return Err(error);
    }
    let storage_bootstrap =
        match initialize_database(&runtime_paths.db_path, &runtime_paths.backups_dir) {
            Ok(storage_bootstrap) => storage_bootstrap,
            Err(error) => {
                let failure = storage_startup_failure(&runtime_paths, error);
                let _ = append_log(
                    &runtime_paths.log_file_path,
                    "ERROR",
                    &format!(
                        "Storage bootstrap failed ({}): {failure}",
                        startup_failure_code(failure.as_ref())
                    ),
                );
                return Err(failure);
            }
        };
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
    // Diagnostics exports are not kept forever (Slice 7): thirty days.
    match prune_exports(
        &runtime_paths.app_data_dir.join(EXPORTS_DIR_NAME),
        SystemTime::now(),
    ) {
        Ok(removed) if !removed.is_empty() => append_log(
            &runtime_paths.log_file_path,
            "INFO",
            &format!(
                "Removed {} diagnostics export(s) older than thirty days",
                removed.len()
            ),
        )?,
        Ok(_) => {}
        Err(error) => append_log(
            &runtime_paths.log_file_path,
            "WARN",
            &format!("Diagnostics export pruning failed: {error}"),
        )?,
    }

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

/// The context a recovery-mode engine runs with after a storage failure at
/// start (Slice 7 — F20): the paths are real, nothing else is — no database
/// (`storage_ready` false), no bridge, no token. `EngineApp` answers only the
/// backup requests with it.
pub(crate) fn recovery_runtime_context(runtime_paths: &RuntimePaths) -> RuntimeContext {
    RuntimeContext {
        protocol_version: runtime_paths.protocol_version.clone(),
        app_data_dir: runtime_paths.app_data_dir.clone(),
        backups_dir: runtime_paths.backups_dir.clone(),
        logs_dir: runtime_paths.logs_dir.clone(),
        log_file_path: runtime_paths.log_file_path.clone(),
        db_path: runtime_paths.db_path.clone(),
        update_repository_path: runtime_paths.update_repository_path.clone(),
        storage_ready: false,
        storage_bootstrap: StorageBootstrap {
            schema_version: 0,
            format_version: String::from("unknown"),
            journal_mode: String::from("unknown"),
            integrity_check: String::from("failed"),
        },
        control_surface_bridge: ControlSurfaceBridgeInfo {
            base_url: String::new(),
            port: 0,
            available: false,
            status: String::from("not-started"),
            summary: String::from(
                "Control-surface bridge not started: the saved data needs attention.",
            ),
            error: None,
        },
        control_surface_token: String::new(),
    }
}

/// Applies a database restore the Support surface staged as
/// `<app-data>/restore-pending.sqlite3` (Slice 7 — F20). The pending file is
/// checked again first; one that fails is removed and the live database is
/// kept, so a restore never trades a good database for a bad one. Then the
/// live database file is moved aside as a `replaced` backup, its `-wal` /
/// `-shm` files are removed (they belong to the old file; the `pre-restore`
/// copy taken when the restore was requested holds what they held), and the
/// pending file takes its name. Returns the replaced file's new path when a
/// restore was applied.
pub(crate) fn apply_pending_restore(runtime_paths: &RuntimePaths) -> EngineResult<Option<PathBuf>> {
    let pending = runtime_paths.app_data_dir.join(RESTORE_PENDING_FILE_NAME);
    if !pending.is_file() {
        return Ok(None);
    }
    let refusal = match inspect_database_backup(&pending) {
        Ok(facts) if facts.schema_version <= STORAGE_SCHEMA_VERSION => None,
        Ok(facts) => Some(format!(
            "schema {} is newer than this app's {}",
            facts.schema_version, STORAGE_SCHEMA_VERSION
        )),
        Err(detail) => Some(detail),
    };
    if let Some(detail) = refusal {
        fs::remove_file(&pending)?;
        append_log(
            &runtime_paths.log_file_path,
            "WARN",
            &format!(
                "Pending database restore {} refused and removed ({detail}); the current database is kept",
                pending.display()
            ),
        )?;
        return Ok(None);
    }

    let db_path = &runtime_paths.db_path;
    let mut replaced = None;
    if db_path.exists() {
        let target = reserve_snapshot_path(&runtime_paths.backups_dir, SnapshotReason::Replaced)?;
        fs::rename(db_path, &target)?;
        replaced = Some(target);
    }
    for suffix in ["-wal", "-shm"] {
        let sidecar = sidecar_path(db_path, suffix);
        if sidecar.exists() {
            fs::remove_file(&sidecar)?;
        }
    }
    fs::rename(&pending, db_path)?;
    append_log(
        &runtime_paths.log_file_path,
        "INFO",
        &format!(
            "Database restore applied: {} is now {}; the replaced database is kept as {}",
            pending.display(),
            db_path.display(),
            replaced
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| String::from("nothing (there was no database)"))
        ),
    )?;
    Ok(replaced)
}

/// `studio-control.sqlite3-wal` beside `studio-control.sqlite3`.
fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Takes the exclusive OS lock on `<app-data>/engine.lock` (Slice 5 — F19).
/// A directory another engine holds answers `ENGINE_ALREADY_RUNNING` with
/// the operator's sentence; the lock is released when the returned handle
/// is dropped or the process ends. A file system that cannot lock at all is
/// a plain bootstrap failure, never a silent pass.
pub(crate) fn acquire_instance_lock(
    app_data_dir: &Path,
) -> Result<File, Box<dyn Error + Send + Sync>> {
    let lock_path = app_data_dir.join(INSTANCE_LOCK_FILE_NAME);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!("Could not open {}: {error}", lock_path.display()),
            )
        })?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => Err(Box::new(StartupFailure {
            code: STARTUP_CODE_ENGINE_ALREADY_RUNNING,
            message: format!(
                "Studio Control is already open on this workstation: another copy holds {}. \
                 Close the other copy, then start again.",
                lock_path.display()
            ),
        })),
        Err(TryLockError::Error(error)) => Err(Box::new(std::io::Error::new(
            error.kind(),
            format!("Could not lock {}: {error}", lock_path.display()),
        ))),
    }
}

/// Keeps `lock` for the life of the process.
fn hold_instance_lock(app_data_dir: &Path, lock: File) {
    if let Ok(mut held) = INSTANCE_LOCK.lock() {
        *held = Some((app_data_dir.to_path_buf(), lock));
    }
}

/// Drops an earlier hold on the same directory, so a process that
/// bootstraps one directory again (the engine's own tests) is not refused by
/// itself. A hold on any other directory stays.
fn release_instance_lock_for(app_data_dir: &Path) {
    if let Ok(mut held) = INSTANCE_LOCK.lock() {
        if held.as_ref().is_some_and(|(path, _)| path == app_data_dir) {
            *held = None;
        }
    }
}

/// A corrupt or un-upgradable database becomes a `StartupFailure` with its
/// own code and a sentence that names the file, the newest database backup
/// and the way out; every other storage error passes through unchanged.
fn storage_startup_failure(
    runtime_paths: &RuntimePaths,
    error: Box<dyn Error + Send + Sync>,
) -> Box<dyn Error + Send + Sync> {
    let Some(storage_error) = error.downcast_ref::<StorageError>() else {
        return error;
    };
    let backup_sentence = match newest_snapshot(&runtime_paths.backups_dir) {
        Some(path) => format!("The newest database backup is {}.", path.display()),
        None => format!(
            "No database backup exists yet in {}.",
            runtime_paths.backups_dir.display()
        ),
    };
    let failure = match storage_error {
        StorageError::Corrupt { db_path, detail } => StartupFailure {
            code: STARTUP_CODE_STORAGE_CORRUPT,
            message: format!(
                "The saved data file {} failed its integrity check ({}). {backup_sentence} \
                 Restore a backup from Setup / Support; the file itself was left untouched.",
                db_path.display(),
                detail.split("; ").next().unwrap_or(detail)
            ),
        },
        StorageError::MigrationFailed { key, detail } => StartupFailure {
            code: STARTUP_CODE_STORAGE_MIGRATION_FAILED,
            message: format!(
                "The saved data file {} could not be upgraded: the stored value {key} is not \
                 readable ({detail}). Nothing was changed. {backup_sentence} Restore a backup \
                 from Setup / Support.",
                runtime_paths.db_path.display()
            ),
        },
    };
    Box::new(failure)
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
        acquire_instance_lock, apply_pending_restore, bootstrap_runtime_from_paths,
        current_runtime_platform, default_app_data_dir_for_platform,
        resolve_legacy_import_source_from, resolve_runtime_paths_from, startup_failure_code,
        storage_startup_failure, validate_protocol_version, RuntimePaths, RuntimePlatform,
        StartupFailure, DEFAULT_APP_DATA_DIR_NAME, INSTANCE_LOCK_FILE_NAME,
        STARTUP_CODE_BOOTSTRAP_FAILED, STARTUP_CODE_ENGINE_ALREADY_RUNNING,
        STARTUP_CODE_STORAGE_CORRUPT, STARTUP_CODE_STORAGE_MIGRATION_FAILED,
        SUPPORTED_PROTOCOL_VERSION,
    };
    use crate::storage::{
        initialize_database, list_settings_by_prefix, set_settings_owned, StorageError,
    };
    use crate::storage_backups::{snapshot_database, SnapshotReason};
    use crate::support::{inspect_database_backup, RESTORE_PENDING_FILE_NAME};
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

    fn runtime_paths_for(test_dir: &TestDir) -> RuntimePaths {
        let app_data_dir = test_dir.path().to_path_buf();
        RuntimePaths {
            protocol_version: String::from(SUPPORTED_PROTOCOL_VERSION),
            requested_protocol_version: String::from(SUPPORTED_PROTOCOL_VERSION),
            backups_dir: app_data_dir.join("backups"),
            logs_dir: app_data_dir.join("logs"),
            log_file_path: app_data_dir.join("logs").join("engine.log"),
            db_path: app_data_dir.join("studio-control.sqlite3"),
            update_repository_path: None,
            app_data_dir,
        }
    }

    // 2026-09 production readiness, Slice 3 (F02): a database SQLite refuses
    // stops the bootstrap with the STORAGE_CORRUPT code, a sentence that
    // names the file and the newest backup, and an ERROR line in the engine
    // log — before the bridge is started or anything else is touched.
    #[test]
    fn corrupt_db_yields_storage_corrupt() {
        let test_dir = TestDir::new("corrupt-db");
        let paths = runtime_paths_for(&test_dir);
        fs::create_dir_all(&paths.backups_dir).expect("backups dir");
        let backup_name = "db-2026-09-09T22-00-00-000Z-daily.sqlite3";
        fs::write(paths.backups_dir.join(backup_name), b"x").expect("fake backup");
        fs::write(
            &paths.db_path,
            b"junk where the database should be\n".repeat(64),
        )
        .expect("junk db");
        let log_file_path = paths.log_file_path.clone();
        let db_display = paths.db_path.display().to_string();

        let error = match bootstrap_runtime_from_paths(paths) {
            Err(error) => error,
            Ok(_) => panic!("a corrupt database must stop the bootstrap"),
        };
        let failure = error
            .downcast_ref::<StartupFailure>()
            .unwrap_or_else(|| panic!("expected a StartupFailure, got {error}"));
        assert_eq!(failure.code, STARTUP_CODE_STORAGE_CORRUPT);
        assert!(failure.message.contains(&db_display), "{}", failure.message);
        assert!(failure.message.contains(backup_name), "{}", failure.message);
        assert!(
            failure
                .message
                .contains("Restore a backup from Setup / Support"),
            "{}",
            failure.message
        );
        assert_eq!(
            startup_failure_code(error.as_ref()),
            STARTUP_CODE_STORAGE_CORRUPT
        );
        let log = fs::read_to_string(&log_file_path).expect("engine log should exist");
        assert!(
            log.contains("ERROR") && log.contains(STARTUP_CODE_STORAGE_CORRUPT),
            "{log}"
        );
    }

    // 2026-09 production readiness, Slice 5 (F19): the app-data directory's
    // lock file admits one holder; a second holder is refused with
    // ENGINE_ALREADY_RUNNING and the operator's sentence, and the lock goes
    // away with its holder.
    #[test]
    fn second_lock_holder_is_refused() {
        let app_data = TestDir::new("instance-lock");
        let first =
            acquire_instance_lock(app_data.path()).expect("the first holder takes the lock");
        assert!(app_data.path().join(INSTANCE_LOCK_FILE_NAME).is_file());

        let refused = acquire_instance_lock(app_data.path())
            .expect_err("a second holder is refused while the first lives");
        let failure = refused
            .downcast_ref::<StartupFailure>()
            .unwrap_or_else(|| panic!("expected a StartupFailure, got {refused}"));
        assert_eq!(failure.code, STARTUP_CODE_ENGINE_ALREADY_RUNNING);
        assert!(
            failure.message.contains("already open"),
            "{}",
            failure.message
        );
        assert!(
            failure.message.contains(INSTANCE_LOCK_FILE_NAME),
            "{}",
            failure.message
        );
        assert_eq!(
            startup_failure_code(refused.as_ref()),
            STARTUP_CODE_ENGINE_ALREADY_RUNNING
        );

        drop(first);
        let third =
            acquire_instance_lock(app_data.path()).expect("the lock is released with its holder");
        drop(third);
    }

    // The bootstrap refuses a directory another engine holds before it
    // touches the database, with the code in the log.
    #[test]
    fn bootstrap_refuses_a_held_app_data_dir() {
        let test_dir = TestDir::new("held-app-data");
        let paths = runtime_paths_for(&test_dir);
        let log_file_path = paths.log_file_path.clone();
        let db_path = paths.db_path.clone();
        let holder = acquire_instance_lock(test_dir.path()).expect("the holder takes the lock");

        let error = match bootstrap_runtime_from_paths(paths) {
            Err(error) => error,
            Ok(_) => panic!("a held directory must stop the bootstrap"),
        };
        assert_eq!(
            startup_failure_code(error.as_ref()),
            STARTUP_CODE_ENGINE_ALREADY_RUNNING
        );
        assert!(
            !db_path.exists(),
            "the database is not created for a refused engine"
        );
        let log = fs::read_to_string(&log_file_path).expect("engine log should exist");
        assert!(
            log.contains("ERROR") && log.contains(STARTUP_CODE_ENGINE_ALREADY_RUNNING),
            "{log}"
        );
        drop(holder);
    }

    // 2026-09 production readiness, Slice 3 (F13): a refused migration has
    // its own code and names the key; anything else stays BOOTSTRAP_FAILED.
    #[test]
    fn migration_failure_maps_to_its_own_code() {
        let test_dir = TestDir::new("migration-failed");
        let paths = runtime_paths_for(&test_dir);

        let error = storage_startup_failure(
            &paths,
            Box::new(StorageError::MigrationFailed {
                key: String::from("app.lighting.editor.state"),
                detail: String::from("expected value at line 1 column 1"),
            }),
        );
        let failure = error
            .downcast_ref::<StartupFailure>()
            .expect("a StartupFailure");
        assert_eq!(failure.code, STARTUP_CODE_STORAGE_MIGRATION_FAILED);
        assert!(failure.message.contains("app.lighting.editor.state"));
        assert!(
            failure.message.contains("No database backup exists yet"),
            "{}",
            failure.message
        );

        let other = storage_startup_failure(&paths, Box::new(std::io::Error::other("disk full")));
        assert!(other.downcast_ref::<StartupFailure>().is_none());
        assert_eq!(
            startup_failure_code(other.as_ref()),
            STARTUP_CODE_BOOTSTRAP_FAILED
        );
    }

    // 2026-09 production readiness, Slice 7 (F20): a staged database restore
    // is applied at start — after the pre-restore copy exists and before the
    // database is opened. The live file is kept as a `replaced` backup, its
    // sidecars go, the pending file takes its name, and the next bootstrap
    // opens the restored data.
    #[test]
    fn pending_restore_applied_after_snapshot() {
        let test_dir = TestDir::new("pending-restore");
        let paths = runtime_paths_for(&test_dir);
        fs::create_dir_all(&paths.logs_dir).expect("logs dir");
        initialize_database(&paths.db_path, &paths.backups_dir)
            .expect("database should initialize");
        set_settings_owned(
            &paths.db_path,
            &[(String::from("app.test.marker"), String::from("before"))],
        )
        .expect("marker should write");
        let backup = snapshot_database(&paths.db_path, &paths.backups_dir, SnapshotReason::Daily)
            .expect("backup should write");
        set_settings_owned(
            &paths.db_path,
            &[(String::from("app.test.marker"), String::from("after"))],
        )
        .expect("marker should change");
        let pre_restore = snapshot_database(
            &paths.db_path,
            &paths.backups_dir,
            SnapshotReason::PreRestore,
        )
        .expect("pre-restore copy should write");
        let pending = paths.app_data_dir.join(RESTORE_PENDING_FILE_NAME);
        fs::copy(&backup, &pending).expect("pending should stage");
        fs::write(format!("{}-wal", paths.db_path.display()), b"").expect("fake wal");
        fs::write(format!("{}-shm", paths.db_path.display()), b"").expect("fake shm");

        let replaced = apply_pending_restore(&paths)
            .expect("the pending restore applies")
            .expect("the live database was replaced");
        assert_eq!(replaced.parent(), Some(paths.backups_dir.as_path()));
        assert!(
            replaced
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("db-") && name.ends_with("-replaced.sqlite3")),
            "{}",
            replaced.display()
        );
        assert!(replaced.is_file());
        assert!(
            pre_restore.is_file(),
            "the pre-restore copy is kept beside it"
        );
        assert!(!pending.exists());
        assert!(!Path::new(&format!("{}-wal", paths.db_path.display())).exists());
        assert!(!Path::new(&format!("{}-shm", paths.db_path.display())).exists());
        let marker = list_settings_by_prefix(&paths.db_path, "app.test.").expect("settings");
        assert_eq!(
            marker.get("app.test.marker").map(String::as_str),
            Some("before")
        );
        assert!(
            inspect_database_backup(&replaced).is_ok(),
            "the replaced file is intact"
        );
        let log = fs::read_to_string(&paths.log_file_path).expect("engine log should exist");
        assert!(log.contains("Database restore applied"), "{log}");

        // Nothing pending: the bootstrap opens the restored database as is.
        assert!(apply_pending_restore(&paths)
            .expect("nothing to apply")
            .is_none());
        let db_display = paths.db_path.display().to_string();
        let runtime = bootstrap_runtime_from_paths(paths).expect("the restored database boots");
        assert!(runtime.storage_ready);
        assert_eq!(runtime.db_path.display().to_string(), db_display);
        let marker = list_settings_by_prefix(&runtime.db_path, "app.test.").expect("settings");
        assert_eq!(
            marker.get("app.test.marker").map(String::as_str),
            Some("before")
        );
    }

    // A pending file that fails its check is refused and removed; the live
    // database is kept exactly as it was, and the log says why.
    #[test]
    fn pending_restore_that_fails_its_check_is_refused() {
        let test_dir = TestDir::new("pending-junk");
        let paths = runtime_paths_for(&test_dir);
        fs::create_dir_all(&paths.logs_dir).expect("logs dir");
        initialize_database(&paths.db_path, &paths.backups_dir)
            .expect("database should initialize");
        set_settings_owned(
            &paths.db_path,
            &[(String::from("app.test.marker"), String::from("kept"))],
        )
        .expect("marker should write");
        let pending = paths.app_data_dir.join(RESTORE_PENDING_FILE_NAME);
        fs::write(&pending, b"this is not a database\n".repeat(64)).expect("junk pending");
        let before = fs::read(&paths.db_path).expect("live database should read");

        assert!(apply_pending_restore(&paths)
            .expect("a refused pending file is not an error")
            .is_none());
        assert!(!pending.exists(), "the junk pending file is removed");
        assert_eq!(fs::read(&paths.db_path).expect("live database"), before);
        let marker = list_settings_by_prefix(&paths.db_path, "app.test.").expect("settings");
        assert_eq!(
            marker.get("app.test.marker").map(String::as_str),
            Some("kept")
        );
        assert!(fs::read_dir(&paths.backups_dir)
            .map(|entries| entries.count() == 0)
            .unwrap_or(true));
        let log = fs::read_to_string(&paths.log_file_path).expect("engine log should exist");
        assert!(
            log.contains("WARN") && log.contains("refused and removed"),
            "{log}"
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
