//! Engine health (2026-09 production readiness, Slice 8 — finding F14).
//!
//! Each subsystem that can degrade on its own reports its state here: the
//! Stream Deck bridge when it binds its port, the TotalMix meter ports, the
//! light-output socket, the database backup scheduler, the storage check and
//! a database restore the bootstrap applied. `health.snapshot` derives its
//! `status` from the registry — `error` when the saved data is not usable,
//! `attention` when something could not bind, `warning` when the last
//! database backup failed or is older than two days, `ok` otherwise — and
//! lists the entries under `checks.engine`. A change of state raises
//! `app.changed { reason: "health" }` so the shell refreshes; a first report
//! that is `ok` is silent, and a repeated state never raises anything.

use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::build_audio_health_check;
use crate::bootstrap::{RuntimeContext, EXPORTS_DIR_NAME};
use crate::control_surface::build_control_surface_health_check;
use crate::diagnostics::{read_log_tail, LOG_TAIL_MAX_BYTES};
use crate::engine_events::emit_app_changed;
use crate::lighting::build_lighting_health_check;
use crate::storage::{list_settings_by_prefix, read_sqlite_version, EngineResult};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const SUBSYSTEM_BRIDGE: &str = "bridge";
pub(crate) const SUBSYSTEM_OSC: &str = "osc";
pub(crate) const SUBSYSTEM_SACN: &str = "sacn";
pub(crate) const SUBSYSTEM_BACKUPS: &str = "backups";
pub(crate) const SUBSYSTEM_STORAGE: &str = "storage";
pub(crate) const SUBSYSTEM_RESTORE: &str = "restore";
/// A last database backup older than this reads `warning`.
pub(crate) const BACKUP_WARNING_AGE_SECS: u64 = 48 * 60 * 60;
/// The `app.changed` reason a health transition carries.
pub(crate) const APP_CHANGED_REASON_HEALTH: &str = "health";
/// How many log lines `health.snapshot` carries.
const LOG_EXCERPT_LINES: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SubsystemState {
    Ok,
    Attention,
    Warning,
    Error,
}

impl SubsystemState {
    /// `error` outranks `attention`, which outranks `warning`.
    fn severity(self) -> u8 {
        match self {
            Self::Ok => 0,
            Self::Warning => 1,
            Self::Attention => 2,
            Self::Error => 3,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct SubsystemStatus {
    pub(crate) state: SubsystemState,
    pub(crate) detail: String,
    /// Unix seconds: when the state was reported — for the backups entry,
    /// when the last copy succeeded.
    pub(crate) at: u64,
}

pub(crate) type HealthEntries = BTreeMap<&'static str, SubsystemStatus>;

#[derive(Default)]
pub(crate) struct HealthRegistry {
    entries: HealthEntries,
}

impl HealthRegistry {
    /// Records the state and says whether the shell should hear about it: a
    /// change of state, or a first report that is not `ok`.
    pub(crate) fn report(
        &mut self,
        subsystem: &'static str,
        state: SubsystemState,
        detail: String,
        at: u64,
    ) -> bool {
        let previous = self
            .entries
            .insert(subsystem, SubsystemStatus { state, detail, at })
            .map(|status| status.state);
        match previous {
            Some(previous) => previous != state,
            None => state != SubsystemState::Ok,
        }
    }

    pub(crate) fn entries(&self) -> &HealthEntries {
        &self.entries
    }
}

static REGISTRY: OnceLock<Mutex<HealthRegistry>> = OnceLock::new();

fn registry() -> &'static Mutex<HealthRegistry> {
    REGISTRY.get_or_init(|| Mutex::new(HealthRegistry::default()))
}

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Reports a subsystem's state now.
pub(crate) fn report(subsystem: &'static str, state: SubsystemState, detail: impl Into<String>) {
    report_at(subsystem, state, detail, unix_now_secs());
}

/// Reports a subsystem's state as of `at` (the backups entry carries the
/// time of the last copy). A transition raises `app.changed`; before the
/// event sender exists (the bootstrap) that is a no-op, and the first
/// `health.snapshot` carries the state anyway.
pub(crate) fn report_at(
    subsystem: &'static str,
    state: SubsystemState,
    detail: impl Into<String>,
    at: u64,
) {
    let changed = registry()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .report(subsystem, state, detail.into(), at);
    if changed {
        emit_app_changed(APP_CHANGED_REASON_HEALTH);
    }
}

pub(crate) fn registry_entries() -> HealthEntries {
    registry()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .entries()
        .clone()
}

/// The entries as `checks.engine` shows them: a backups entry whose last
/// success is older than [`BACKUP_WARNING_AGE_SECS`] reads `warning`.
pub(crate) fn effective_entries(entries: &HealthEntries, now: u64) -> HealthEntries {
    entries
        .iter()
        .map(|(id, status)| {
            let mut status = status.clone();
            let age = now.saturating_sub(status.at);
            if *id == SUBSYSTEM_BACKUPS
                && status.state == SubsystemState::Ok
                && age > BACKUP_WARNING_AGE_SECS
            {
                status.state = SubsystemState::Warning;
                status.detail = format!(
                    "The last database backup is {} h old; {}",
                    age / 3600,
                    status.detail
                );
            }
            (*id, status)
        })
        .collect()
}

/// `error` when the saved data is not usable or an entry says so,
/// `attention` when something could not bind, `warning` when a backup is
/// late or failed, `ok` otherwise.
pub(crate) fn derive_status(entries: &HealthEntries, storage_ready: bool) -> &'static str {
    if !storage_ready {
        return "error";
    }
    let worst = entries
        .values()
        .map(|status| status.state)
        .max_by_key(|state| state.severity());
    match worst {
        Some(SubsystemState::Error) => "error",
        Some(SubsystemState::Attention) => "attention",
        Some(SubsystemState::Warning) => "warning",
        Some(SubsystemState::Ok) | None => "ok",
    }
}

fn format_health_summary(
    status: &str,
    storage_summary: &str,
    lighting_summary: &str,
    audio_summary: &str,
    control_surface_summary: &str,
) -> String {
    format!(
        "Health '{}'. Storage {}. Lighting {}. Audio {}. Control surface {}.",
        status, storage_summary, lighting_summary, audio_summary, control_surface_summary
    )
}

/// The `health.snapshot` payload. The log excerpt is the tail of the current
/// log file inside a fixed window (finding F11); the status comes from the
/// registry (finding F14).
pub(crate) fn read_health_snapshot(runtime: &RuntimeContext) -> EngineResult<Value> {
    let app_settings = list_settings_by_prefix(&runtime.db_path, APP_SETTINGS_PREFIX)?;
    let lighting = build_lighting_health_check(&app_settings);
    let audio = build_audio_health_check(&app_settings);
    let control_surface = build_control_surface_health_check(runtime);
    let sqlite_version = read_sqlite_version(&runtime.db_path)?;
    let engine = effective_entries(&registry_entries(), unix_now_secs());
    let status = derive_status(&engine, runtime.storage_ready);
    let lighting_summary = lighting.summary.clone();
    let audio_summary = audio.summary.clone();
    let control_surface_summary = control_surface
        .get("summary")
        .and_then(|value| value.as_str())
        .unwrap_or("Control-surface diagnostics unavailable.")
        .to_string();
    let storage_summary = format!(
        "Schema v{}, journal mode {}, integrity {}, SQLite {}",
        runtime.storage_bootstrap.schema_version,
        runtime.storage_bootstrap.journal_mode,
        runtime.storage_bootstrap.integrity_check,
        sqlite_version,
    );
    let health_summary = format_health_summary(
        status,
        &storage_summary,
        &lighting_summary,
        &audio_summary,
        &control_surface_summary,
    );
    Ok(json!({
        "status": status,
        "startupPhase": "storage-bootstrap",
        "summary": health_summary,
        "paths": {
            "appDataDir": runtime.app_data_dir.display().to_string(),
            "logsDir": runtime.logs_dir.display().to_string(),
            "logFilePath": runtime.log_file_path.display().to_string(),
            "dbPath": runtime.db_path.display().to_string(),
            "backupDir": runtime.backups_dir.display().to_string(),
            "exportsDir": runtime.app_data_dir.join(EXPORTS_DIR_NAME).display().to_string(),
            "updateRepositoryPath": runtime
                .update_repository_path
                .as_ref()
                .map(|path| path.display().to_string())
        },
        "details": {
            "storage": storage_summary,
            "lighting": lighting_summary,
            "audio": audio_summary,
            "controlSurface": control_surface_summary,
        },
        "recentLogExcerpt": read_log_tail(&runtime.log_file_path, LOG_TAIL_MAX_BYTES, LOG_EXCERPT_LINES),
        "checks": {
            "storage": {
                "ok": runtime.storage_ready,
                "dbPathExists": runtime.db_path.exists(),
                "schemaVersion": runtime.storage_bootstrap.schema_version,
                "journalMode": runtime.storage_bootstrap.journal_mode,
                "integrityCheck": runtime.storage_bootstrap.integrity_check,
                "sqliteVersion": sqlite_version
            },
            "lighting": lighting,
            "audio": audio,
            "controlSurface": control_surface,
            "engine": serde_json::to_value(&engine)?,
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        derive_status, effective_entries, format_health_summary, read_health_snapshot,
        HealthEntries, HealthRegistry, SubsystemState, SubsystemStatus, BACKUP_WARNING_AGE_SECS,
        SUBSYSTEM_BACKUPS, SUBSYSTEM_BRIDGE, SUBSYSTEM_OSC, SUBSYSTEM_SACN, SUBSYSTEM_STORAGE,
    };
    use crate::bootstrap::RuntimeContext;
    use crate::control_surface::ControlSurfaceBridgeInfo;
    use crate::storage::{initialize_test_database, StorageBootstrap};
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn entry(state: SubsystemState, detail: &str, at: u64) -> SubsystemStatus {
        SubsystemStatus {
            state,
            detail: String::from(detail),
            at,
        }
    }

    fn all_ok(now: u64) -> HealthEntries {
        HealthEntries::from([
            (
                SUBSYSTEM_BRIDGE,
                entry(SubsystemState::Ok, "bridge ready", now),
            ),
            (
                SUBSYSTEM_OSC,
                entry(SubsystemState::Ok, "meter ports bound", now),
            ),
            (
                SUBSYSTEM_SACN,
                entry(SubsystemState::Ok, "socket ready", now),
            ),
            (
                SUBSYSTEM_BACKUPS,
                entry(SubsystemState::Ok, "backup written", now),
            ),
            (
                SUBSYSTEM_STORAGE,
                entry(SubsystemState::Ok, "integrity ok", now),
            ),
        ])
    }

    // Finding F14: the saved data failing its check is an error, whether
    // the storage entry says so or the runtime never got a database.
    #[test]
    fn status_error_on_integrity_failure() {
        let now = 1_757_000_000;
        assert_eq!(derive_status(&all_ok(now), true), "ok");

        let mut entries = all_ok(now);
        entries.insert(
            SUBSYSTEM_STORAGE,
            entry(
                SubsystemState::Error,
                "The database failed its integrity check",
                now,
            ),
        );
        assert_eq!(derive_status(&entries, true), "error");

        // An error outranks anything else that is wrong at the same time.
        entries.insert(
            SUBSYSTEM_BRIDGE,
            entry(SubsystemState::Attention, "port taken", now),
        );
        assert_eq!(derive_status(&entries, true), "error");

        // A recovery-mode runtime has no usable database at all.
        assert_eq!(derive_status(&all_ok(now), false), "error");
    }

    // Finding F14: a port the bridge could not bind is attention, and it
    // outranks a late backup.
    #[test]
    fn status_attention_on_bridge_port_fallback() {
        let now = 1_757_000_000;
        let mut entries = all_ok(now);
        entries.insert(
            SUBSYSTEM_BRIDGE,
            entry(
                SubsystemState::Attention,
                "Native control-surface bridge is unavailable because the listener could not bind",
                now,
            ),
        );
        assert_eq!(derive_status(&entries, true), "attention");

        entries.insert(
            SUBSYSTEM_BACKUPS,
            entry(SubsystemState::Warning, "backup failed", now),
        );
        assert_eq!(derive_status(&entries, true), "attention");

        let mut osc_only = all_ok(now);
        osc_only.insert(
            SUBSYSTEM_OSC,
            entry(SubsystemState::Attention, "receive port 9001 taken", now),
        );
        assert_eq!(derive_status(&osc_only, true), "attention");
    }

    #[test]
    fn status_warning_when_the_last_backup_failed_or_is_older_than_two_days() {
        let now = 1_757_000_000;
        let mut failed = all_ok(now);
        failed.insert(
            SUBSYSTEM_BACKUPS,
            entry(
                SubsystemState::Warning,
                "Database backup (daily) failed",
                now,
            ),
        );
        assert_eq!(derive_status(&failed, true), "warning");

        let mut late = all_ok(now);
        late.insert(
            SUBSYSTEM_BACKUPS,
            entry(
                SubsystemState::Ok,
                "Database backup (daily) written",
                now - BACKUP_WARNING_AGE_SECS - 3_600,
            ),
        );
        let effective = effective_entries(&late, now);
        let backups = &effective[SUBSYSTEM_BACKUPS];
        assert_eq!(backups.state, SubsystemState::Warning);
        assert!(backups
            .detail
            .starts_with("The last database backup is 49 h old;"));
        assert_eq!(derive_status(&effective, true), "warning");

        // Two days minus a minute is still fine.
        let mut recent = all_ok(now);
        recent.insert(
            SUBSYSTEM_BACKUPS,
            entry(
                SubsystemState::Ok,
                "Database backup (daily) written",
                now - BACKUP_WARNING_AGE_SECS + 60,
            ),
        );
        assert_eq!(derive_status(&effective_entries(&recent, now), true), "ok");
        assert_eq!(derive_status(&HealthEntries::new(), true), "ok");
    }

    // A transition is a change of state — a first `ok` is not one, a first
    // `attention` is, and repeating a state is never one.
    #[test]
    fn report_signals_a_transition_only_on_a_state_change() {
        let mut registry = HealthRegistry::default();
        assert!(!registry.report(
            SUBSYSTEM_BRIDGE,
            SubsystemState::Ok,
            String::from("ready"),
            1
        ));
        assert!(!registry.report(
            SUBSYSTEM_BRIDGE,
            SubsystemState::Ok,
            String::from("ready"),
            2
        ));
        assert!(registry.report(
            SUBSYSTEM_BRIDGE,
            SubsystemState::Attention,
            String::from("taken"),
            3
        ));
        assert!(!registry.report(
            SUBSYSTEM_BRIDGE,
            SubsystemState::Attention,
            String::from("still taken"),
            4
        ));
        assert!(registry.report(
            SUBSYSTEM_BRIDGE,
            SubsystemState::Ok,
            String::from("ready"),
            5
        ));
        assert!(registry.report(
            SUBSYSTEM_SACN,
            SubsystemState::Attention,
            String::from("no socket"),
            6
        ));
        let bridge = &registry.entries()[SUBSYSTEM_BRIDGE];
        assert_eq!(bridge.detail, "ready");
        assert_eq!(bridge.at, 5);
    }

    #[test]
    fn health_summary_includes_all_native_domains() {
        let summary = format_health_summary(
            "ok",
            "Schema v1, journal mode wal, integrity ok",
            "Lighting ready.",
            "Audio ready.",
            "Bridge ready at http://127.0.0.1:38201",
        );

        assert!(summary.contains("Health 'ok'."));
        assert!(summary.contains("Storage Schema v1"));
        assert!(summary.contains("Lighting ready."));
        assert!(summary.contains("Audio ready."));
        assert!(summary.contains("Control surface Bridge ready"));
    }

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
                "studio-control-engine-health-{label}-{}-{unique}",
                process::id()
            ));
            fs::create_dir_all(path.join("logs")).expect("test dir should be created");
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

    fn runtime_for(test_dir: &TestDir, storage_ready: bool) -> RuntimeContext {
        let runtime = RuntimeContext {
            protocol_version: String::from("1"),
            app_data_dir: test_dir.path().to_path_buf(),
            backups_dir: test_dir.path().join("backups"),
            logs_dir: test_dir.path().join("logs"),
            log_file_path: test_dir.path().join("logs").join("engine.log"),
            db_path: test_dir.path().join("native.sqlite3"),
            update_repository_path: None,
            storage_ready,
            storage_bootstrap: StorageBootstrap {
                schema_version: 6,
                format_version: String::from("1"),
                journal_mode: String::from("wal"),
                integrity_check: String::from("ok"),
            },
            control_surface_token: String::from("bridge-token-for-tests"),
            control_surface_bridge: ControlSurfaceBridgeInfo {
                base_url: String::from("http://127.0.0.1:38201"),
                port: 38201,
                available: true,
                status: String::from("ready"),
                summary: String::from("Test bridge"),
                error: None,
            },
        };
        initialize_test_database(&runtime.db_path).expect("database should initialize");
        runtime
    }

    // The snapshot lists the registry under `checks.engine`, keeps the log
    // excerpt a bounded string, and says `error` for a runtime whose saved
    // data is not usable. The registry is process-wide, so the exact status
    // of a ready runtime depends on what other tests reported; only its
    // vocabulary is asserted.
    #[test]
    fn health_snapshot_lists_engine_checks_and_a_bounded_log_excerpt() {
        let test_dir = TestDir::new("snapshot");
        let runtime = runtime_for(&test_dir, true);
        let big_line = format!("[1757000000] INFO {}\n", "x".repeat(200));
        fs::write(&runtime.log_file_path, big_line.repeat(2_000)).expect("write log");

        let snapshot = read_health_snapshot(&runtime).expect("snapshot");
        let status = snapshot["status"].as_str().expect("status word");
        assert!(
            ["ok", "attention", "warning", "error"].contains(&status),
            "{status}"
        );
        assert!(snapshot["checks"]["engine"].is_object());
        let excerpt = snapshot["recentLogExcerpt"]
            .as_str()
            .expect("the excerpt is a string");
        assert_eq!(excerpt.lines().count(), 12);
        assert!(excerpt.len() < 64 * 1024);
        assert_eq!(
            snapshot["paths"]["logFilePath"],
            Value::String(runtime.log_file_path.display().to_string())
        );

        let recovery_dir = TestDir::new("recovery");
        let recovery = runtime_for(&recovery_dir, false);
        let snapshot = read_health_snapshot(&recovery).expect("snapshot");
        assert_eq!(snapshot["status"], Value::String(String::from("error")));
        assert!(snapshot["summary"]
            .as_str()
            .expect("summary")
            .starts_with("Health 'error'."));
    }

    // 2026-09 production readiness, Slice 11 (F31): held light outputs are a
    // state the operator chose, not a fault. The entry stays `ok` and says so
    // in its detail — `attention` would turn the shell's recovery state to
    // `degraded` and put the Setup word and the Deck lamp into their fault
    // posture for something that is working as asked.
    #[test]
    fn held_light_outputs_are_not_a_fault() {
        use crate::lighting_sacn_output::{HELD_DETAIL, SOCKET_READY_DETAIL};

        let now = 1_757_000_000;
        let mut entries = all_ok(now);
        entries.insert(SUBSYSTEM_SACN, entry(SubsystemState::Ok, HELD_DETAIL, now));
        assert_eq!(derive_status(&entries, true), "ok");

        let mut registry = HealthRegistry::default();
        assert!(!registry.report(
            SUBSYSTEM_SACN,
            SubsystemState::Ok,
            String::from(SOCKET_READY_DETAIL),
            now
        ));
        assert!(
            !registry.report(
                SUBSYSTEM_SACN,
                SubsystemState::Ok,
                String::from(HELD_DETAIL),
                now
            ),
            "ok to ok is no transition; the output thread announces its own detail"
        );
        assert_eq!(registry.entries()[SUBSYSTEM_SACN].detail, HELD_DETAIL);
        assert!(HELD_DETAIL.contains("held") && HELD_DETAIL.contains("armed"));
    }
}
