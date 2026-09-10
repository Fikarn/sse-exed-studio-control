//! Database backups the engine writes itself (2026-09 production readiness,
//! Slice 3 — finding F02): a verified copy of the whole database as
//! `db-<UTC timestamp>-<reason>.sqlite3` in the backups directory, one
//! self-contained file each — before a schema upgrade, daily, at every
//! graceful shutdown, and before a database restore (Slice 7). Retention is
//! per reason; anything in the directory that is not an engine backup (the
//! JSON support archives, for one) is never touched.

use crate::storage::{open_connection, run_integrity_check, EngineResult, StorageError};
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The file name shape: `db-<timestamp>-<reason>.sqlite3`.
const DATABASE_BACKUP_PREFIX: &str = "db-";
const DATABASE_BACKUP_EXTENSION: &str = "sqlite3";

/// Why a database backup was written; the word ends the file name and picks
/// the retention.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotReason {
    PreMigration,
    Daily,
    Shutdown,
    PreRestore,
}

impl SnapshotReason {
    pub const ALL: [SnapshotReason; 4] = [
        SnapshotReason::PreMigration,
        SnapshotReason::Daily,
        SnapshotReason::Shutdown,
        SnapshotReason::PreRestore,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            SnapshotReason::PreMigration => "pre-migration",
            SnapshotReason::Daily => "daily",
            SnapshotReason::Shutdown => "shutdown",
            SnapshotReason::PreRestore => "pre-restore",
        }
    }

    /// How many backups of this reason `prune_snapshots` keeps: two weeks of
    /// dailies, the last five upgrades and restores, the last three shutdowns.
    pub fn retention(self) -> usize {
        match self {
            SnapshotReason::PreMigration => 5,
            SnapshotReason::Daily => 14,
            SnapshotReason::Shutdown => 3,
            SnapshotReason::PreRestore => 5,
        }
    }
}

/// Writes a verified copy of the database into `backups_dir` and prunes the
/// older copies of every reason down to their retention. The copy is made
/// with `VACUUM INTO` (a consistent, compacted snapshot of the live
/// database), converted to a self-contained rollback-journal file, checked
/// with `PRAGMA integrity_check`, flushed to disk — and deleted again if any
/// of that fails, so a file in the backups directory is always a good one.
pub fn snapshot_database(
    db_path: &Path,
    backups_dir: &Path,
    reason: SnapshotReason,
) -> EngineResult<PathBuf> {
    let connection = open_connection(db_path)?;
    snapshot_database_with(&connection, backups_dir, reason)
}

pub(crate) fn snapshot_database_with(
    connection: &Connection,
    backups_dir: &Path,
    reason: SnapshotReason,
) -> EngineResult<PathBuf> {
    fs::create_dir_all(backups_dir)?;
    let target = reserve_snapshot_path(backups_dir, reason)?;
    let target_text = target
        .to_str()
        .ok_or_else(|| format!("Backup path is not valid UTF-8: {}", target.display()))?;
    if let Err(error) = connection.execute("VACUUM INTO ?1", [target_text]) {
        let _ = fs::remove_file(&target);
        return Err(error.into());
    }
    if let Err(error) = verify_snapshot(&target) {
        let _ = fs::remove_file(&target);
        return Err(error);
    }
    prune_snapshots(backups_dir)?;
    Ok(target)
}

/// `db-<UTC time to the millisecond>-<reason>.sqlite3`, never a name that
/// already exists: `VACUUM INTO` refuses an existing file, and the names must
/// sort in the order they were written.
fn reserve_snapshot_path(backups_dir: &Path, reason: SnapshotReason) -> EngineResult<PathBuf> {
    for _ in 0..50 {
        let candidate = backups_dir.join(format!(
            "{DATABASE_BACKUP_PREFIX}{}-{}.{DATABASE_BACKUP_EXTENSION}",
            file_timestamp(SystemTime::now()),
            reason.as_str()
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
        thread::sleep(Duration::from_millis(1));
    }
    Err(format!(
        "Could not reserve a backup file name in {}",
        backups_dir.display()
    )
    .into())
}

/// UTC wall-clock time as `YYYY-MM-DDTHH-MM-SS-mmmZ` — the shape the support
/// archives already use, so a directory listing sorts both kinds together.
fn file_timestamp(time: SystemTime) -> String {
    let since_epoch = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_seconds = since_epoch.as_secs();
    let millis = since_epoch.subsec_millis();
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_from_days((total_seconds / 86_400) as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}-{:02}-{:02}-{millis:03}Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 to (y, m, d).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    } as u32;
    let year = year_of_era as i64 + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// The copy is opened on its own, without the live connection's WAL and
/// synchronous settings: a backup is one file in rollback-journal mode, so it
/// can be copied, verified and restored without a `-wal` or `-shm` beside it.
/// `VACUUM INTO` does not flush its output to disk; the `sync_all` does.
fn verify_snapshot(path: &Path) -> EngineResult<()> {
    {
        let copy = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        copy.pragma_update(None, "journal_mode", "DELETE")?;
        let integrity = run_integrity_check(&copy)?;
        if integrity != "ok" {
            return Err(StorageError::Corrupt {
                db_path: path.to_path_buf(),
                detail: integrity,
            }
            .into());
        }
    }
    fs::OpenOptions::new().write(true).open(path)?.sync_all()?;
    Ok(())
}

/// Removes the oldest backups of every reason beyond its retention. The
/// names carry the timestamp at fixed width, so name order is age order.
/// Files that are not engine backups (support archives, anything else) are
/// left alone. Returns the removed paths.
pub fn prune_snapshots(backups_dir: &Path) -> EngineResult<Vec<PathBuf>> {
    let mut removed = Vec::new();
    if !backups_dir.is_dir() {
        return Ok(removed);
    }

    let mut names_by_reason: HashMap<&'static str, Vec<String>> = HashMap::new();
    for entry in fs::read_dir(backups_dir)? {
        let entry = entry?;
        if !entry.path().is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(reason) = snapshot_reason_of(&name) {
            names_by_reason
                .entry(reason.as_str())
                .or_default()
                .push(name);
        }
    }

    for reason in SnapshotReason::ALL {
        let Some(names) = names_by_reason.get_mut(reason.as_str()) else {
            continue;
        };
        names.sort();
        let excess = names.len().saturating_sub(reason.retention());
        for name in names.iter().take(excess) {
            let path = backups_dir.join(name);
            fs::remove_file(&path)?;
            removed.push(path);
        }
    }

    Ok(removed)
}

/// The newest engine-written backup of any reason, by name.
pub fn newest_snapshot(backups_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(backups_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| snapshot_reason_of(name).is_some())
        .max()
        .map(|name| backups_dir.join(name))
}

pub(crate) fn snapshot_reason_of(file_name: &str) -> Option<SnapshotReason> {
    let stem = file_name
        .strip_prefix(DATABASE_BACKUP_PREFIX)?
        .strip_suffix(DATABASE_BACKUP_EXTENSION)?
        .strip_suffix('.')?;
    SnapshotReason::ALL
        .into_iter()
        .find(|reason| stem.ends_with(&format!("-{}", reason.as_str())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{initialize_database, set_settings_owned, STORAGE_SCHEMA_VERSION};
    use std::process;

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
                "studio-control-engine-backups-{label}-{}-{unique}",
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

    // 2026-09 production readiness, Slice 3 (F02): a backup is a consistent
    // copy of the live database — verified, one file in rollback-journal
    // mode, flushed — and the live database is not disturbed by it.
    #[test]
    fn snapshot_writes_verified_copy() {
        let test_dir = TestDir::new("storage-snapshot");
        let db_path = test_dir.path().join("native.sqlite3");
        let backups_dir = test_dir.path().join("backups");
        initialize_database(&db_path, &backups_dir).expect("database should initialize");
        set_settings_owned(
            &db_path,
            &[(String::from("app.test.marker"), String::from("kept"))],
        )
        .expect("marker should write");

        let path = snapshot_database(&db_path, &backups_dir, SnapshotReason::Daily)
            .expect("backup should write");
        assert_eq!(path.parent(), Some(backups_dir.as_path()));
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .expect("backup name");
        assert!(
            name.starts_with("db-") && name.ends_with("-daily.sqlite3"),
            "{name}"
        );
        assert_eq!(snapshot_reason_of(name), Some(SnapshotReason::Daily));
        assert!(!backups_dir.join(format!("{name}-wal")).exists());
        assert!(!backups_dir.join(format!("{name}-shm")).exists());

        let copy = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("backup should open read-only");
        let journal_mode: String = copy
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal mode should read");
        assert_eq!(journal_mode, "delete", "a backup is a self-contained file");
        assert_eq!(run_integrity_check(&copy).expect("integrity"), "ok");
        let marker: String = copy
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'app.test.marker'",
                [],
                |row| row.get(0),
            )
            .expect("marker should be in the backup");
        assert_eq!(marker, "kept");
        let version: i64 = copy
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("version should read");
        assert_eq!(version, STORAGE_SCHEMA_VERSION);
        drop(copy);

        let live = open_connection(&db_path).expect("live database should open");
        let live_mode: String = live
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("live journal mode should read");
        assert_eq!(live_mode, "wal", "the live database keeps its WAL");
        assert_eq!(newest_snapshot(&backups_dir), Some(path));
    }

    // 2026-09 production readiness, Slice 3 (F02): retention per reason,
    // oldest first, engine backups only.
    #[test]
    fn prune_keeps_retention() {
        let test_dir = TestDir::new("storage-prune");
        let backups_dir = test_dir.path().join("backups");
        fs::create_dir_all(&backups_dir).expect("backups dir should be created");

        let mut expected_kept = Vec::new();
        let mut expected_removed = Vec::new();
        for reason in SnapshotReason::ALL {
            for index in 0..reason.retention() + 3 {
                let name = format!(
                    "db-2026-09-{:02}T00-00-00-000Z-{}.sqlite3",
                    index + 1,
                    reason.as_str()
                );
                fs::write(backups_dir.join(&name), b"x").expect("fake backup should write");
                if index < 3 {
                    expected_removed.push(name);
                } else {
                    expected_kept.push(name);
                }
            }
        }
        let bystanders = [
            "support-backup-2026-09-10T00-00-00-000Z.json",
            "notes.txt",
            "db-manual.sqlite3",
            "other.sqlite3",
        ];
        for name in bystanders {
            fs::write(backups_dir.join(name), b"x").expect("bystander should write");
        }

        let removed = prune_snapshots(&backups_dir).expect("prune should run");
        let mut removed_names: Vec<String> = removed
            .iter()
            .filter_map(|path| path.file_name().and_then(|name| name.to_str()))
            .map(String::from)
            .collect();
        removed_names.sort();
        expected_removed.sort();
        assert_eq!(removed_names, expected_removed);
        for name in &expected_kept {
            assert!(backups_dir.join(name).exists(), "{name} should be kept");
        }
        for name in bystanders {
            assert!(
                backups_dir.join(name).exists(),
                "{name} is not an engine backup and must be left alone"
            );
        }
        assert_eq!(snapshot_reason_of("db-manual.sqlite3"), None);
        assert_eq!(
            snapshot_reason_of("db-2026-09-01T00-00-00-000Z-pre-restore.sqlite3"),
            Some(SnapshotReason::PreRestore)
        );
    }

    #[test]
    fn file_timestamp_is_utc_to_the_millisecond() {
        assert_eq!(
            file_timestamp(UNIX_EPOCH + Duration::from_millis(1_600_000_000_123)),
            "2020-09-13T12-26-40-123Z"
        );
        assert_eq!(file_timestamp(UNIX_EPOCH), "1970-01-01T00-00-00-000Z");
        assert_eq!(
            file_timestamp(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "2000-02-29T00-00-00-000Z"
        );
    }
}
