//! Database backups the engine writes itself (2026-09 production readiness,
//! Slice 3 — finding F02): a verified copy of the whole database as
//! `db-<UTC timestamp>-<reason>.sqlite3` in the backups directory, one
//! self-contained file each — before a schema upgrade, daily, at every
//! graceful shutdown, and before a database restore (Slice 7). Retention is
//! per reason; anything in the directory that is not an engine backup (the
//! JSON support archives, for one) is never touched. The `replaced` reason
//! (Slice 7 — F20) is not a copy the engine verified: it is the database file
//! a restore moved aside, kept next to the pre-restore copy so nothing a
//! restore replaced is lost, and pruned like the others.

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
/// How far apart the daily backups are.
pub(crate) const DAILY_BACKUP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Why a database backup was written; the word ends the file name and picks
/// the retention.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotReason {
    PreMigration,
    Daily,
    Shutdown,
    PreRestore,
    /// The live database file a restore moved aside when the pending
    /// database backup took its place (Slice 7). Not verified by the engine
    /// — it is whatever was there, damaged file included.
    Replaced,
}

impl SnapshotReason {
    pub const ALL: [SnapshotReason; 5] = [
        SnapshotReason::PreMigration,
        SnapshotReason::Daily,
        SnapshotReason::Shutdown,
        SnapshotReason::PreRestore,
        SnapshotReason::Replaced,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            SnapshotReason::PreMigration => "pre-migration",
            SnapshotReason::Daily => "daily",
            SnapshotReason::Shutdown => "shutdown",
            SnapshotReason::PreRestore => "pre-restore",
            SnapshotReason::Replaced => "replaced",
        }
    }

    /// How many backups of this reason `prune_snapshots` keeps: two weeks of
    /// dailies, the last five upgrades, restores and replaced files, the last
    /// three shutdowns.
    pub fn retention(self) -> usize {
        match self {
            SnapshotReason::PreMigration => 5,
            SnapshotReason::Daily => 14,
            SnapshotReason::Shutdown => 3,
            SnapshotReason::PreRestore => 5,
            SnapshotReason::Replaced => 5,
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
/// sort in the order they were written. The bootstrap uses it for the
/// `replaced` name a database restore moves the live file to (Slice 7).
pub(crate) fn reserve_snapshot_path(
    backups_dir: &Path,
    reason: SnapshotReason,
) -> EngineResult<PathBuf> {
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
/// The cameras' times (`cameras::runtime::utc_text`) use it too.
pub(crate) fn civil_from_days(days: i64) -> (i64, u32, u32) {
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

/// Howard Hinnant's `days_from_civil`, the inverse of `civil_from_days`:
/// (y, m, d) to days since 1970-01-01. Signed throughout, so a damaged
/// date gives a wrong number rather than a panic; the caller reads it back.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
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

/// The newest verified engine-written backup, by name. A `replaced` file is
/// not a verified copy, so the recovery sentence never points at one.
pub fn newest_snapshot(backups_dir: &Path) -> Option<PathBuf> {
    fs::read_dir(backups_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| {
            snapshot_reason_of(name).is_some_and(|reason| reason != SnapshotReason::Replaced)
        })
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

/// How long the daily backup waits: until the newest daily backup is 24 h
/// old, and not at all when there is none (2026-10-01: each start wrote a
/// daily of its own, three in one day, and with fourteen kept, restarts ate
/// into the two weeks of history). A newest daily dated ahead of `now` (the
/// clock went back) cannot say when the next is due, so it holds nothing
/// off: waiting for it would hold the dailies off until the clock passed it.
pub(crate) fn daily_backup_wait(newest_daily_at: Option<SystemTime>, now: SystemTime) -> Duration {
    newest_daily_at
        .and_then(|written| now.duration_since(written).ok())
        .map_or(Duration::ZERO, |age| {
            DAILY_BACKUP_INTERVAL.saturating_sub(age)
        })
}

/// When the newest daily backup in `backups_dir` was written, by its name;
/// `None` when there is none, or the directory cannot be read.
pub(crate) fn newest_daily_backup_at(backups_dir: &Path) -> Option<SystemTime> {
    fs::read_dir(backups_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| daily_backup_written_at(entry.file_name().to_str()?))
        .max()
}

/// When a daily backup was written, read from the UTC time in its name.
/// The name is the engine's own record of that moment, and this module
/// already takes name order for age order; a file's modified time changes
/// with whatever touches the file. Any other file, and a name this module
/// would not have written (a month 13, a damaged time), is `None`.
fn daily_backup_written_at(file_name: &str) -> Option<SystemTime> {
    let suffix = format!(
        "-{}.{DATABASE_BACKUP_EXTENSION}",
        SnapshotReason::Daily.as_str()
    );
    let stamp = file_name
        .strip_prefix(DATABASE_BACKUP_PREFIX)?
        .strip_suffix(suffix.as_str())?;
    // `YYYY-MM-DDTHH-MM-SS-mmmZ`, as `file_timestamp` writes it.
    let field = |at: usize, width: usize| stamp.get(at..at + width)?.parse::<i64>().ok();
    let days = days_from_civil(field(0, 4)?, field(5, 2)?, field(8, 2)?);
    let seconds = days * 86_400 + field(11, 2)? * 3_600 + field(14, 2)? * 60 + field(17, 2)?;
    let millis = u64::try_from(seconds * 1_000 + field(20, 3)?).ok()?;
    let written = UNIX_EPOCH + Duration::from_millis(millis);
    // Read back: anything but the very text `file_timestamp` writes is not a
    // time this module wrote.
    (file_timestamp(written) == stamp).then_some(written)
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
        // The daily backup reads the time back from the name it wrote.
        let written = newest_daily_backup_at(&backups_dir).expect("the daily is dated");
        assert!(SystemTime::now()
            .duration_since(written)
            .is_ok_and(|age| age < Duration::from_secs(60)));
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
        assert_eq!(
            snapshot_reason_of("db-2026-09-01T00-00-00-000Z-replaced.sqlite3"),
            Some(SnapshotReason::Replaced)
        );
    }

    // 2026-09 production readiness, Slice 7 (F20): the file a restore moved
    // aside is kept and pruned like a backup, but it was never verified, so
    // the recovery sentence names the newest verified copy instead.
    #[test]
    fn newest_snapshot_skips_replaced_files() {
        let test_dir = TestDir::new("storage-newest");
        let backups_dir = test_dir.path().join("backups");
        fs::create_dir_all(&backups_dir).expect("backups dir should be created");
        let daily = "db-2026-09-10T00-00-00-000Z-daily.sqlite3";
        let replaced = "db-2026-09-11T00-00-00-000Z-replaced.sqlite3";
        fs::write(backups_dir.join(daily), b"x").expect("daily should write");
        fs::write(backups_dir.join(replaced), b"junk").expect("replaced should write");

        assert_eq!(newest_snapshot(&backups_dir), Some(backups_dir.join(daily)));
        let reserved = reserve_snapshot_path(&backups_dir, SnapshotReason::Replaced)
            .expect("a replaced name should be reserved");
        assert_eq!(
            snapshot_reason_of(reserved.file_name().and_then(|n| n.to_str()).unwrap()),
            Some(SnapshotReason::Replaced)
        );
    }

    // 2026-10-01: each start wrote a daily of its own, three in one day. The
    // daily backup now waits until the newest daily is 24 h old.
    #[test]
    fn the_daily_backup_waits_until_the_newest_daily_is_a_day_old() {
        let now = UNIX_EPOCH + Duration::from_secs(1_790_850_420);
        let hours = |count: u64| Duration::from_secs(count * 3_600);
        assert_eq!(daily_backup_wait(None, now), Duration::ZERO);
        assert_eq!(
            daily_backup_wait(Some(now - hours(30)), now),
            Duration::ZERO
        );
        assert_eq!(
            daily_backup_wait(Some(now - hours(24)), now),
            Duration::ZERO
        );
        assert_eq!(daily_backup_wait(Some(now - hours(23)), now), hours(1));
        assert_eq!(
            daily_backup_wait(Some(now - Duration::from_secs(1)), now),
            hours(24) - Duration::from_secs(1)
        );
        assert_eq!(daily_backup_wait(Some(now), now), hours(24));
        // Dated ahead of the clock: it holds nothing off, never a day or more.
        assert_eq!(daily_backup_wait(Some(now + hours(2)), now), Duration::ZERO);
        assert_eq!(
            daily_backup_wait(Some(now + hours(24 * 365)), now),
            Duration::ZERO
        );
    }

    #[test]
    fn a_daily_backup_is_dated_by_the_time_in_its_name() {
        assert_eq!(
            daily_backup_written_at("db-2020-09-13T12-26-40-123Z-daily.sqlite3"),
            Some(UNIX_EPOCH + Duration::from_millis(1_600_000_000_123))
        );
        assert_eq!(
            daily_backup_written_at("db-2000-02-29T00-00-00-000Z-daily.sqlite3"),
            Some(UNIX_EPOCH + Duration::from_secs(951_782_400))
        );
        assert_eq!(
            daily_backup_written_at("db-1970-01-01T00-00-00-000Z-daily.sqlite3"),
            Some(UNIX_EPOCH)
        );
        for name in [
            // Other reasons.
            "db-2026-10-01T10-27-00-000Z-shutdown.sqlite3",
            "db-2026-10-01T10-27-00-000Z-pre-migration.sqlite3",
            "db-2026-10-01T10-27-00-000Z-pre-restore.sqlite3",
            "db-2026-10-01T10-27-00-000Z-replaced.sqlite3",
            // Names this module does not write.
            "db-2026-13-01T10-27-00-000Z-daily.sqlite3",
            "db-2026-02-29T10-27-00-000Z-daily.sqlite3",
            "db-2026-10-01T24-00-00-000Z-daily.sqlite3",
            "db-2026-10-01 10-27-00-000Z-daily.sqlite3",
            "db-2026-10-01T10-27-00-000-daily.sqlite3",
            "db-2026-10-01T10-27-00-0000Z-daily.sqlite3",
            "db-+026-10-01T10-27-00-000Z-daily.sqlite3",
            "db-2026-1Ö-01T10-27-00-000Z-daily.sqlite3",
            "db-1969-12-31T23-59-59-999Z-daily.sqlite3",
            "db-manual-daily.sqlite3",
            "db-2026-10-01T10-27-00-000Z-daily.sqlite3-wal",
            "support-backup-2026-10-01T10-27-00-000Z.json",
        ] {
            assert_eq!(daily_backup_written_at(name), None, "{name}");
        }
    }

    #[test]
    fn the_newest_daily_backup_is_found_among_the_other_files() {
        let test_dir = TestDir::new("storage-newest-daily");
        let backups_dir = test_dir.path().join("backups");
        assert_eq!(newest_daily_backup_at(&backups_dir), None);
        fs::create_dir_all(&backups_dir).expect("backups dir should be created");
        assert_eq!(newest_daily_backup_at(&backups_dir), None);

        for name in [
            "db-2026-09-30T10-27-00-000Z-daily.sqlite3",
            "db-2026-10-01T10-27-00-000Z-daily.sqlite3",
            // Newer, but not a daily, or not a name this module writes.
            "db-2026-10-01T15-04-00-000Z-shutdown.sqlite3",
            "db-2026-10-01T16-31-00-000Z-pre-restore.sqlite3",
            "db-2026-10-02T00-00-00-000Z-replaced.sqlite3",
            "db-2026-19-01T10-27-00-000Z-daily.sqlite3",
            "db-manual-daily.sqlite3",
            "support-backup-2026-10-02T00-00-00-000Z.json",
        ] {
            fs::write(backups_dir.join(name), b"x").expect("fake backup should write");
        }
        // A folder is not a backup, whatever its name.
        fs::create_dir_all(backups_dir.join("db-2026-10-03T00-00-00-000Z-daily.sqlite3"))
            .expect("folder should be created");

        let newest = newest_daily_backup_at(&backups_dir).expect("a daily is found");
        assert_eq!(file_timestamp(newest), "2026-10-01T10-27-00-000Z");
        assert_eq!(newest, UNIX_EPOCH + Duration::from_secs(1_790_850_420));
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
