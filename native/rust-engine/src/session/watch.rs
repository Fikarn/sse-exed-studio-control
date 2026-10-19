//! The sessions' watch (the Session page's step 2, D52): one watched thread,
//! `session-watch`, on the lighting bridge watch's model
//! (`lighting_bridge_watch.rs`), that reads what the Session page shows of
//! the disks and of vMix, so that `session.snapshot` reads no disk and never
//! waits.
//!
//! Every 5 s it reads vMix's state, in the studio's places alone
//! (`vmix.rs`). Every 30 s, and at once when woken (after a begin, an end
//! and a settings' update), it reads the drives (`drives.rs`), the sessions'
//! folder's six newest folders, the sizes of the folders the window can
//! list (those six and each kind's last session's) and of the running
//! session's, and the running session's vMix subfolder. Its report is kept
//! on a board (`BOARD`), which the snapshot reads: the board's lock is held
//! to put a report there or to copy it, never across a read.
//! `session.changed { reason: "read" }` follows a report that moved, at most
//! once a pass, and the log says a change once.
//!
//! The watch only reads: it makes no folder, writes no setting and opens no
//! file to write. Every wait has a bound: the drives' 2 s, a walk's 1 s (or
//! its 100,000 entries), vMix's 500 ms to connect and 1 s to answer. A
//! folder is read only on a drive that answered the pass's read. The
//! snapshot never waits on a disk, and a begin is refused at once on a drive
//! the last read found not answering (`folder.rs`). What a hang can still
//! reach: a begin before the watch's first report, or on a drive the last
//! read found answering or did not find, asks that drive itself, as before
//! the watch, on the request loop; and a share that dies between the
//! drives' read and a walk can hold this thread for Windows' own timeout,
//! which the liveness watch says after 60 s, the board keeping its last
//! report meanwhile.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use crate::cameras::runtime::utc_text;
use crate::diagnostics::{log_event, LogLevel};
use crate::engine_events::emit_session_changed;
use crate::health::SUBSYSTEM_SESSION_WATCH;
use crate::liveness::{spawn_watched, Lifetime, Spec};
use crate::session::commands::{read_saved, Saved};
use crate::session::drives::{DriveRead, Drives, GIB};
use crate::session::folder::drive_letter;
use crate::session::places::Places;
use crate::session::snapshot::{
    Session, SessionDiskLevel, SessionFolderEntry, SessionSnapshot, SessionVmix, SessionVmixState,
};
use crate::session::vmix::{
    in_folder, read_vmix, recording_folder_in, VmixRecording, WriteRate, VMIX_API,
};
use crate::storage::enable_thread_read_connection;

/// How often the watch looks at vMix.
const WATCH_TICK: Duration = Duration::from_secs(5);
/// The disks are read at every sixth look: every 30 s.
const DISK_EVERY_TICKS: u32 = 6;
/// A pass waits 2 s for the drives, at most 1 s for each of ten walks or
/// so, and 1.5 s for vMix: a pass this late is a stall.
const STALL_ALLOWANCE: Duration = Duration::from_secs(60);
/// How many of the sessions' folder's newest folders are read.
pub(crate) const RECENT_FOLDERS: usize = 6;
/// A walk's bounds: one that would take longer, or count more, is cut and
/// measures nothing.
pub(crate) const WALK_BUDGET: Duration = Duration::from_secs(1);
pub(crate) const WALK_MAX_ENTRIES: u64 = 100_000;

/// `session.changed`'s reason after a read that moved.
pub(crate) const REASON_READ: &str = "read";

/// A folder on the sessions' folder, as a read listed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FolderRead {
    pub name: String,
    pub path: String,
    pub created_at: String,
}

/// The sessions' folder, as a read found it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RootRead {
    /// The folder read, as the places write it.
    pub path: String,
    pub exists: bool,
    /// Its newest folders, newest first.
    pub recent: Vec<FolderRead>,
}

/// What vMix's API said at the last look.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) enum VmixRead {
    #[default]
    NotRead,
    NotAnswering,
    Answering {
        recording: bool,
        file: Option<String>,
        bytes_per_second: Option<u64>,
    },
}

impl VmixRead {
    /// Whether vMix answered; `None` before the first look.
    fn answers(&self) -> Option<bool> {
        match self {
            Self::NotRead => None,
            Self::NotAnswering => Some(false),
            Self::Answering { .. } => Some(true),
        }
    }
}

/// The watch's report: what its last passes read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WatchReport {
    /// When the disks were last read, UTC; `None` before the first read.
    pub read_at: Option<String>,
    pub drives: Vec<DriveRead>,
    /// `None` when the sessions' folder's drive did not answer.
    pub root: Option<RootRead>,
    /// The folders' sizes by their paths as written; `None` for a walk that
    /// was cut. A folder whose drive did not answer keeps its last measure.
    pub sizes: BTreeMap<String, Option<u64>>,
    /// The running session's folder, and the folder vMix should record to
    /// in it.
    pub recording_folder: Option<(String, String)>,
    pub vmix: VmixRead,
}

impl WatchReport {
    pub(crate) fn drive(&self, letter: char) -> Option<&DriveRead> {
        self.drives.iter().find(|drive| drive.letter == letter)
    }

    /// The letters whose drive did not answer the last read: a Begin there
    /// is refused at once, so the request loop never waits on a share that
    /// hangs.
    pub(crate) fn not_answering(&self) -> BTreeSet<char> {
        self.drives
            .iter()
            .filter(|drive| !drive.answering())
            .map(|drive| drive.letter)
            .collect()
    }

    /// A folder's last measure; `None` when it has none, or its walk was cut.
    pub(crate) fn size_of(&self, folder: &str) -> Option<u64> {
        self.sizes.get(folder).copied().flatten()
    }
}

/// Where the watch puts its report, and the snapshot reads it.
pub(crate) struct Board {
    report: Mutex<Option<WatchReport>>,
}

impl Board {
    pub(crate) const fn new() -> Self {
        Self {
            report: Mutex::new(None),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<WatchReport>> {
        self.report.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The last report; `None` before the watch's first pass.
    pub(crate) fn report(&self) -> Option<WatchReport> {
        self.lock().clone()
    }

    pub(crate) fn publish(&self, report: WatchReport) {
        *self.lock() = Some(report);
    }

    /// Takes the report off, as before the watch's first pass.
    #[cfg(test)]
    pub(crate) fn clear(&self) {
        *self.lock() = None;
    }
}

/// The hardware link's board, for the one test that puts a report on it.
#[cfg(test)]
pub(crate) fn hardware_links_board() -> &'static Board {
    &BOARD
}

/// The hardware link's board: the one watch's.
static BOARD: Board = Board::new();

/// The watch's last report, for `session.snapshot` and a begin's drive.
pub(crate) fn session_watch_report() -> Option<WatchReport> {
    BOARD.report()
}

/// A wake for the watch: a flag and its signal.
pub(crate) struct Wake {
    woken: Mutex<bool>,
    signal: Condvar,
}

impl Wake {
    pub(crate) const fn new() -> Self {
        Self {
            woken: Mutex::new(false),
            signal: Condvar::new(),
        }
    }

    pub(crate) fn wake(&self) {
        *self.woken.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.signal.notify_all();
    }

    /// Waits `timeout`, or less when woken; says whether it was woken.
    pub(crate) fn wait(&self, timeout: Duration) -> bool {
        let woken = self.woken.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut woken, _) = self
            .signal
            .wait_timeout_while(woken, timeout, |woken| !*woken)
            .unwrap_or_else(PoisonError::into_inner);
        std::mem::take(&mut *woken)
    }
}

static WAKE: Wake = Wake::new();

/// Asks the watch to read the disks now: a begin, an end or a settings'
/// update has changed what it reads.
pub(crate) fn wake_session_watch() {
    WAKE.wake();
}

/// Reads vMix's state, or a test's stand-in for it.
pub(crate) type VmixReader = Box<dyn FnMut() -> Option<VmixRecording> + Send>;

/// What a read changed: whether the snapshot moved, and the log's lines.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Change {
    pub moved: bool,
    pub log_lines: Vec<(LogLevel, String)>,
}

/// The session's drive's level the log said last, with the drive's letter.
pub(crate) type SaidLevel = Option<(char, SessionDiskLevel)>;

/// The watch: its places, its readers, the write rate, its last report, the
/// level the log said last, and the board it puts its reports on.
pub(crate) struct Watch {
    places: Places,
    drives: Drives,
    vmix: VmixReader,
    rate: WriteRate,
    report: WatchReport,
    said_level: SaidLevel,
    board: &'static Board,
}

impl Watch {
    pub(crate) fn new(
        places: Places,
        drives: Drives,
        vmix: VmixReader,
        board: &'static Board,
    ) -> Self {
        Self {
            places,
            drives,
            vmix,
            rate: WriteRate::default(),
            report: WatchReport::default(),
            said_level: None,
            board,
        }
    }

    /// One pass: vMix in the studio's places, the disks when `disks_due`,
    /// then the report on the board, the log's lines and the event. vMix
    /// comes first, so its file's size is read at `at`, not after the
    /// disks' seconds (the review of #355). A read of the saved data that
    /// fails leaves the report as it was, and is tried again at the next
    /// pass (`None`).
    pub(crate) fn pass(
        &mut self,
        db_path: &Path,
        disks_due: bool,
        now: SystemTime,
        at: Instant,
    ) -> Option<Change> {
        let saved = read_saved(db_path).ok()?;
        let mut read = self.report.clone();
        if !self.places.simulated {
            read.vmix = self.look_at_vmix(&read.drives, at);
        }
        if disks_due {
            self.read_disks(&mut read, &saved, now);
        }
        let change = apply_read(
            &self.report,
            &read,
            &mut self.said_level,
            session_letter(&saved, &self.places),
            saved.settings.low_below_gb,
            saved.settings.nearly_full_below_gb,
        );
        self.board.publish(read.clone());
        for (level, line) in &change.log_lines {
            log_event(*level, line);
        }
        if change.moved {
            emit_session_changed(REASON_READ);
        }
        self.report = read;
        Some(change)
    }

    /// The drives, then what is read on the drives that answered: the
    /// sessions' folder's newest folders, the folders' sizes, the running
    /// session's vMix subfolder.
    fn read_disks(&mut self, read: &mut WatchReport, saved: &Saved, now: SystemTime) {
        let drives = self.drives.read_all();
        let answers = |path: &Path| {
            drive_letter(path).is_some_and(|letter| {
                drives
                    .iter()
                    .any(|drive| drive.letter == letter && drive.answering())
            })
        };
        let root = self.places.effective_root(&saved.settings.root);
        let root_read = answers(&root).then(|| read_root(&root));

        let mut folders: Vec<String> = Vec::new();
        let recent = root_read.iter().flat_map(|root| &root.recent);
        let sessions = saved.last.iter().chain(&saved.current);
        for folder in recent
            .map(|folder| folder.path.clone())
            .chain(sessions.filter_map(|session| session.folder.clone()))
        {
            if !folders.contains(&folder) {
                folders.push(folder);
            }
        }
        let mut sizes = BTreeMap::new();
        for folder in folders {
            let path = Path::new(&folder);
            if answers(path) {
                if path.is_dir() {
                    let size = folder_size(path, WALK_BUDGET, WALK_MAX_ENTRIES);
                    sizes.insert(folder, size);
                }
            } else if let Some(kept) = read.sizes.get(&folder) {
                sizes.insert(folder, *kept);
            }
        }

        let running = saved
            .current
            .as_ref()
            .and_then(|session| session.folder.clone());
        let recording_folder = running.and_then(|folder| {
            if answers(Path::new(&folder)) {
                recording_folder_in(Path::new(&folder), WALK_BUDGET, WALK_MAX_ENTRIES)
                    .map(|inside| (folder, inside))
            } else {
                read.recording_folder
                    .clone()
                    .filter(|(of, _)| *of == folder)
            }
        });

        read.read_at = Some(utc_text(now));
        read.drives = drives;
        read.root = root_read;
        read.sizes = sizes;
        read.recording_folder = recording_folder;
    }

    /// One look at vMix: its word, and the write rate while it records onto
    /// a drive that answered.
    fn look_at_vmix(&mut self, drives: &[DriveRead], at: Instant) -> VmixRead {
        let Some(VmixRecording { recording, file }) = (self.vmix)() else {
            self.rate.take(false, None, None, at);
            return VmixRead::NotAnswering;
        };
        let size = file
            .as_deref()
            .filter(|_| recording)
            .filter(|file| {
                drive_letter(Path::new(file)).is_some_and(|letter| {
                    drives
                        .iter()
                        .any(|drive| drive.letter == letter && drive.answering())
                })
            })
            .and_then(|file| fs::metadata(file).ok())
            .map(|metadata| metadata.len());
        let bytes_per_second = self.rate.take(recording, file.as_deref(), size, at);
        VmixRead::Answering {
            recording,
            file,
            bytes_per_second,
        }
    }
}

/// The session's drive: the running session's folder's, else the sessions'
/// folder's.
fn session_letter(saved: &Saved, places: &Places) -> Option<char> {
    match saved
        .current
        .as_ref()
        .and_then(|session| session.folder.as_deref())
    {
        Some(folder) => drive_letter(Path::new(folder)),
        None => drive_letter(&places.effective_root(&saved.settings.root)),
    }
}

/// Windows' hidden and system attributes: a drive's own `System Volume
/// Information` and `$RECYCLE.BIN` carry them.
const HIDDEN_OR_SYSTEM: u32 = 0x2 | 0x4;

/// Whether a folder with Windows' `attributes` is one the sessions' folder
/// lists: not hidden, not the system's.
pub(crate) fn listed(attributes: u32) -> bool {
    attributes & HIDDEN_OR_SYSTEM == 0
}

/// The sessions' folder: whether it is there, and its newest folders by the
/// time each was made, newest first (a folder Windows cannot name in
/// Unicode, a link, a junction, and a hidden or a system folder left out, so
/// a sessions' folder at a drive's top lists none of the drive's own; the
/// review of #355). The listing stops at the walk's bounds.
pub(crate) fn read_root(root: &Path) -> RootRead {
    let path = root.display().to_string();
    let Ok(listing) = fs::read_dir(root) else {
        return RootRead {
            path,
            exists: root.is_dir(),
            recent: Vec::new(),
        };
    };
    let deadline = Instant::now() + WALK_BUDGET;
    let mut folders: Vec<(SystemTime, FolderRead)> = Vec::new();
    for (count, entry) in listing.enumerate() {
        if count as u64 >= WALK_MAX_ENTRIES || Instant::now() >= deadline {
            break;
        }
        let Ok(entry) = entry else { continue };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_dir() || kind.is_symlink() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !listed(metadata.file_attributes()) {
            continue;
        }
        let (Some(name), Ok(created)) = (
            entry.file_name().to_str().map(String::from),
            metadata.created(),
        ) else {
            continue;
        };
        folders.push((
            created,
            FolderRead {
                name,
                path: entry.path().display().to_string(),
                created_at: utc_text(created),
            },
        ));
    }
    folders.sort_by(|(made, folder), (other_made, other)| {
        other_made
            .cmp(made)
            .then_with(|| folder.name.cmp(&other.name))
    });
    RootRead {
        path,
        exists: true,
        recent: folders
            .into_iter()
            .take(RECENT_FOLDERS)
            .map(|(_, folder)| folder)
            .collect(),
    }
}

/// A folder's size, its files' sizes added up, its subfolders walked into
/// (a link and a junction are not); `None` when the walk takes over
/// `budget`, counts over `max_entries`, or cannot list the folder itself. A
/// subfolder that cannot be listed adds nothing. Each file's size is read
/// from the file, not from the folder's listing: Windows updates a listing
/// lazily, and a recording that is still being written reads short there.
/// The time is looked at before each folder is listed as well as at each
/// entry, so a tree of empty folders is cut too (the review of #355).
pub(crate) fn folder_size(folder: &Path, budget: Duration, max_entries: u64) -> Option<u64> {
    let deadline = Instant::now() + budget;
    let mut bytes: u64 = 0;
    let mut entries: u64 = 0;
    let mut waiting: Vec<PathBuf> = vec![folder.to_path_buf()];
    while let Some(next) = waiting.pop() {
        if Instant::now() >= deadline {
            return None;
        }
        let listing = match fs::read_dir(&next) {
            Ok(listing) => listing,
            Err(_) if next == folder => return None,
            Err(_) => continue,
        };
        for entry in listing {
            entries += 1;
            if entries > max_entries || Instant::now() >= deadline {
                return None;
            }
            let Ok(entry) = entry else { continue };
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                waiting.push(entry.path());
            } else {
                let size = fs::metadata(entry.path())
                    .or_else(|_| entry.metadata())
                    .map_or(0, |metadata| metadata.len());
                bytes = bytes.saturating_add(size);
            }
        }
    }
    Some(bytes)
}

/// What a read changed (the module's doc): whether the snapshot moved, its
/// time of reading aside, and the lines the log says once for a change:
/// vMix starting or stopping to answer (`INFO`), a drive that stops
/// answering (`WARN`) or answers again (`INFO`), the session's drive
/// turning Low or Nearly full (`WARN`) or reading above Low again (`INFO`).
/// The session's drive's level is held to `said`, the level the log said
/// last and its drive, not to the report before, so a drive that misses a
/// read in between, or a session moved to a drive already low, is said too
/// (the review of #355); `said` is moved on.
pub(crate) fn apply_read(
    previous: &WatchReport,
    read: &WatchReport,
    said: &mut SaidLevel,
    session_drive: Option<char>,
    low_below_gb: u32,
    nearly_full_below_gb: u32,
) -> Change {
    let unstamped = |report: &WatchReport| WatchReport {
        read_at: report.read_at.as_ref().map(|_| String::new()),
        ..report.clone()
    };
    let moved = unstamped(previous) != unstamped(read);
    let mut log_lines = Vec::new();

    match (previous.vmix.answers(), read.vmix.answers()) {
        (before, Some(true)) if before != Some(true) => {
            let again = if before == Some(false) { " again" } else { "" };
            log_lines.push((
                LogLevel::Info,
                format!(
                    "vMix answers{again} on {VMIX_API}: the Session page reads where it records."
                ),
            ));
        }
        (before, Some(false)) if before != Some(false) => log_lines.push((
            LogLevel::Info,
            format!(
                "vMix does not answer on {VMIX_API}: the Session page cannot say where it records."
            ),
        )),
        _ => {}
    }

    for drive in &read.drives {
        let before = previous.drive(drive.letter).map(DriveRead::answering);
        match (before, drive.answering()) {
            (Some(false), false) | (Some(true) | None, true) => {}
            (_, false) => log_lines.push((
                LogLevel::Warn,
                format!(
                    "{} does not answer in 2 s: its space is not read, and a Begin there is refused until it answers.",
                    drive.said()
                ),
            )),
            (Some(false), true) => {
                log_lines.push((LogLevel::Info, format!("{} answers again.", drive.said())));
            }
        }
    }

    // A drive that does not answer has no level: the level said stands.
    let session = session_drive.and_then(|letter| {
        let drive = read.drive(letter)?;
        Some((
            letter,
            drive,
            drive.level(low_below_gb, nearly_full_below_gb)?,
        ))
    });
    if let Some((letter, drive, now)) = session {
        let before = match *said {
            Some((said_letter, level)) if said_letter == letter => Some(level),
            _ => None,
        };
        if before != Some(now) {
            let free = drive.space.map_or(0, |space| space.free_bytes) / GIB;
            let name = drive.said();
            match now {
                SessionDiskLevel::Low => log_lines.push((
                    LogLevel::Warn,
                    format!(
                        "The session's drive {name} is low: {free} GB free, under {low_below_gb} GB."
                    ),
                )),
                SessionDiskLevel::NearlyFull => log_lines.push((
                    LogLevel::Warn,
                    format!(
                        "The session's drive {name} is nearly full: {free} GB free, under {nearly_full_below_gb} GB."
                    ),
                )),
                SessionDiskLevel::Ok if before.is_some() => log_lines.push((
                    LogLevel::Info,
                    format!(
                        "The session's drive {name} has {free} GB free again, above Low ({low_below_gb} GB)."
                    ),
                )),
                SessionDiskLevel::Ok => {}
            }
            *said = Some((letter, now));
        }
    }
    Change { moved, log_lines }
}

/// `session.snapshot` from the saved part and the watch's last report: the
/// running session's folder's latest measure, a last session's measure when
/// none was kept at its end, the sessions' folder's newest folders when the
/// report read that folder, the drives with their levels, the session's
/// drive, vMix, and when the report read the disks.
pub(crate) fn snapshot_of(
    saved: Saved,
    places: &Places,
    report: Option<&WatchReport>,
) -> SessionSnapshot {
    let Saved {
        current,
        last,
        settings,
    } = saved;
    let root = places.effective_root(&settings.root).display().to_string();
    let measured = |folder: &Option<String>| {
        folder
            .as_deref()
            .and_then(|folder| report.and_then(|report| report.size_of(folder)))
    };
    let current = current.map(|session| Session {
        folder_bytes: measured(&session.folder).or(session.folder_bytes),
        ..session
    });
    let last = last
        .into_iter()
        .map(|session| Session {
            folder_bytes: session.folder_bytes.or_else(|| measured(&session.folder)),
            ..session
        })
        .collect();
    let root_read = report
        .and_then(|report| report.root.as_ref())
        .filter(|read| read.path == root);
    let recent = root_read
        .map(|read| {
            read.recent
                .iter()
                .map(|folder| SessionFolderEntry {
                    name: folder.name.clone(),
                    path: folder.path.clone(),
                    created_at: folder.created_at.clone(),
                    bytes: report.and_then(|report| report.size_of(&folder.path)),
                })
                .collect()
        })
        .unwrap_or_default();
    let drives = report
        .map(|report| {
            report
                .drives
                .iter()
                .map(|drive| drive.snapshot(settings.low_below_gb, settings.nearly_full_below_gb))
                .collect()
        })
        .unwrap_or_default();
    let running_folder = current
        .as_ref()
        .and_then(|session| session.folder.as_deref());
    let session_drive =
        drive_letter(Path::new(running_folder.unwrap_or(root.as_str()))).map(String::from);
    let vmix = vmix_of(report, places, running_folder);
    SessionSnapshot {
        places: places.snapshot(&settings.root, root_read.is_some_and(|read| read.exists)),
        current,
        last,
        settings,
        recent,
        drives,
        session_drive,
        vmix,
        read_at: report.and_then(|report| report.read_at.clone()),
    }
}

/// What the snapshot says of vMix: never read in a simulated run, else its
/// last word, with whether its file is in the running session's folder; and
/// where in that folder vMix should record, as the watch read it.
fn vmix_of(report: Option<&WatchReport>, places: &Places, folder: Option<&str>) -> SessionVmix {
    let recording_folder = folder.and_then(|folder| {
        report?
            .recording_folder
            .as_ref()
            .filter(|(of, _)| of == folder)
            .map(|(_, inside)| inside.clone())
    });
    let (state, recording, file, bytes_per_second) = match report.map(|report| &report.vmix) {
        _ if places.simulated => (SessionVmixState::Simulated, false, None, None),
        None | Some(VmixRead::NotRead) => (SessionVmixState::NotRead, false, None, None),
        Some(VmixRead::NotAnswering) => (SessionVmixState::NotAnswering, false, None, None),
        Some(VmixRead::Answering {
            recording,
            file,
            bytes_per_second,
        }) => (
            SessionVmixState::Answering,
            *recording,
            file.clone(),
            *bytes_per_second,
        ),
    };
    SessionVmix {
        state,
        recording,
        in_folder: file
            .as_deref()
            .zip(folder)
            .map(|(file, folder)| in_folder(file, folder)),
        file,
        bytes_per_second,
        recording_folder,
    }
}

/// Whether the next pass reads the disks: when woken, at every sixth look,
/// and again after a pass that was to and could not read the saved data
/// (`missed`), so a failed first pass or a woken one is not put off for
/// 30 s (the review of #355).
pub(crate) fn disks_due_next(missed: bool, woken: bool, ticks: u32) -> bool {
    missed || woken || ticks.is_multiple_of(DISK_EVERY_TICKS)
}

/// Starts the watch, in every build: a simulated run reads the drives and
/// its scratch folder, and never vMix. Watched (`liveness`): a panic, an
/// end, or a pass that stops beating is laid on an entry of its own,
/// `session-watch`.
pub(crate) fn spawn_session_watch(db_path: PathBuf, places: Places) {
    let _ = spawn_watched(
        Spec {
            job: "sessions' watch",
            name: String::from("session-watch"),
            subsystem: SUBSYSTEM_SESSION_WATCH,
            allowance: Some(STALL_ALLOWANCE),
            lifetime: Lifetime::Process,
        },
        move |beat| {
            enable_thread_read_connection();
            let vmix: VmixReader = if places.simulated {
                Box::new(|| None)
            } else {
                Box::new(|| read_vmix(VMIX_API))
            };
            let mut watch = Watch::new(places, Drives::through_windows(), vmix, &BOARD);
            let mut ticks: u32 = 0;
            let mut disks_due = true;
            loop {
                beat.beat();
                let passed = watch
                    .pass(&db_path, disks_due, SystemTime::now(), Instant::now())
                    .is_some();
                let woken = WAKE.wait(WATCH_TICK);
                ticks = ticks.wrapping_add(1);
                disks_due = disks_due_next(disks_due && !passed, woken, ticks);
            }
        },
    );
}
