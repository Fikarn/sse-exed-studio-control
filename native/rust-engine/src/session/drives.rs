//! The drives (the Session page's step 2, D52): each lettered drive's name,
//! free space and size, for the window's disk row, the footer and the
//! header's `Disk` chip. They are read through WinRT, not Win32: the
//! workspace forbids `unsafe` (`native/Cargo.toml`), and the properties of
//! `Windows.Storage.StorageFolder` are safe calls of the `windows` crate:
//! `System.FreeSpace`, `System.Capacity` and `System.Volume.IsMappedDrive`,
//! with the folder's `DisplayName`. Every letter from C: to Z: is read, the
//! mapped share Public (Z:) included: Windows asks the share, and the
//! hardware link opens no connection of its own.
//!
//! Each letter is read on a short thread of its own, and a pass waits 2 s
//! for them all: a letter that has not answered by then reads as not
//! answering, and no second read of it starts while one runs, so a share
//! that hangs holds up nothing and the threads cannot pile up (one a letter
//! at most). A letter Windows has no drive at answers at once (7 ms on the
//! studio PC, 2026-10-19) and is left out.
//!
//! Sizes are Explorer's: 1 GB is 1024³ bytes, the thresholds' GB too.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::RangeInclusive;
use std::sync::{mpsc, Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use windows::core::{Interface, HSTRING};
use windows::Foundation::IReference;
use windows::Storage::StorageFolder;
use windows_collections::IIterable;

use crate::session::snapshot::{SessionDiskLevel, SessionDrive};

/// The letters read. A: and B: were the floppy drives', and are left out.
pub(crate) const DRIVE_LETTERS: RangeInclusive<char> = 'C'..='Z';
/// How long a pass waits for the drives' reads.
pub(crate) const DRIVE_READ_BUDGET: Duration = Duration::from_secs(2);
/// Explorer's GB, and the thresholds': 1024³ bytes.
pub(crate) const GIB: u64 = 1 << 30;

const FREE_SPACE: &str = "System.FreeSpace";
const CAPACITY: &str = "System.Capacity";
const MAPPED: &str = "System.Volume.IsMappedDrive";

/// A drive's free space and size, in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Space {
    pub free_bytes: u64,
    pub total_bytes: u64,
}

/// What one letter's read found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DriveOutcome {
    /// Windows has no drive at the letter, or gives no space for it.
    NotThere,
    /// The drive answered: its name without the letter, whether it is a
    /// mapped share, and its space.
    Answered {
        name: String,
        mapped: bool,
        space: Space,
    },
}

/// A drive as a pass read it: one that answered, or one whose read had not
/// answered within the budget (`space` is `None`), with the name and the
/// mapping it last answered with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DriveRead {
    pub letter: char,
    pub name: String,
    pub mapped: bool,
    pub space: Option<Space>,
}

impl DriveRead {
    pub(crate) fn answering(&self) -> bool {
        self.space.is_some()
    }

    /// How its free space reads against the thresholds; `None` while it
    /// does not answer.
    pub(crate) fn level(
        &self,
        low_below_gb: u32,
        nearly_full_below_gb: u32,
    ) -> Option<SessionDiskLevel> {
        self.space
            .map(|space| level_of(space.free_bytes, low_below_gb, nearly_full_below_gb))
    }

    /// What `session.snapshot` says of it.
    pub(crate) fn snapshot(&self, low_below_gb: u32, nearly_full_below_gb: u32) -> SessionDrive {
        SessionDrive {
            letter: self.letter.to_string(),
            name: self.name.clone(),
            mapped: self.mapped,
            answering: self.answering(),
            free_bytes: self.space.map(|space| space.free_bytes),
            total_bytes: self.space.map(|space| space.total_bytes),
            level: self.level(low_below_gb, nearly_full_below_gb),
        }
    }

    /// The drive as the log names it: `D: (Storage 1)`, or `Z:` before it
    /// has answered with a name.
    pub(crate) fn said(&self) -> String {
        if self.name.is_empty() {
            format!("{}:", self.letter)
        } else {
            format!("{}: ({})", self.letter, self.name)
        }
    }
}

/// How `free_bytes` reads (D52): Nearly full under `nearly_full_below_gb`,
/// Low under `low_below_gb`, else Ok; the levels are whole GB of 1024³
/// bytes, as Explorer counts them.
pub(crate) fn level_of(
    free_bytes: u64,
    low_below_gb: u32,
    nearly_full_below_gb: u32,
) -> SessionDiskLevel {
    if free_bytes < u64::from(nearly_full_below_gb) * GIB {
        SessionDiskLevel::NearlyFull
    } else if free_bytes < u64::from(low_below_gb) * GIB {
        SessionDiskLevel::Low
    } else {
        SessionDiskLevel::Ok
    }
}

/// A drive's name as the page writes it, from Windows' display name: without
/// its letter (`Storage 1 (D:)` is `Storage 1`), and for a mapped share
/// without its server too (`Public (\\172.16.18.28) (Z:)` is `Public`), as
/// the operator knows it ("Public (Z:)").
pub(crate) fn drive_name(display_name: &str, letter: char, mapped: bool) -> String {
    let name = display_name.trim();
    let name = name
        .strip_suffix(&format!("({letter}:)"))
        .map_or(name, str::trim_end);
    let name = match name.rfind(" (\\\\") {
        Some(at) if mapped && name.ends_with(')') => &name[..at],
        _ => name,
    };
    name.trim().to_string()
}

/// One letter's read through WinRT (the module's doc), waited for as the
/// Pocket's link waits for its calls (`.get()`). A letter Windows refuses is
/// not there; so is a drive that gives no space (an optical drive's, say).
fn read_through_windows(letter: char) -> DriveOutcome {
    let opened = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(format!("{letter}:\\")))
        .and_then(|pending| pending.get());
    let Ok(folder) = opened else {
        return DriveOutcome::NotThere;
    };
    let display_name = folder
        .DisplayName()
        .map(|name| name.to_string())
        .unwrap_or_default();
    let wanted: IIterable<HSTRING> = vec![
        HSTRING::from(FREE_SPACE),
        HSTRING::from(CAPACITY),
        HSTRING::from(MAPPED),
    ]
    .into();
    let Ok(properties) = folder
        .Properties()
        .and_then(|properties| properties.RetrievePropertiesAsync(&wanted))
        .and_then(|pending| pending.get())
    else {
        return DriveOutcome::NotThere;
    };
    let number = |key: &str| {
        properties
            .Lookup(&HSTRING::from(key))
            .and_then(|value| value.cast::<IReference<u64>>())
            .and_then(|value| value.Value())
            .ok()
    };
    let mapped = properties
        .Lookup(&HSTRING::from(MAPPED))
        .and_then(|value| value.cast::<IReference<bool>>())
        .and_then(|value| value.Value())
        .unwrap_or(false);
    match (number(FREE_SPACE), number(CAPACITY)) {
        (Some(free_bytes), Some(total_bytes)) => DriveOutcome::Answered {
            name: drive_name(&display_name, letter, mapped),
            mapped,
            space: Space {
                free_bytes,
                total_bytes,
            },
        },
        _ => DriveOutcome::NotThere,
    }
}

/// A letter's read: the WinRT read, or a test's stand-in for it.
pub(crate) type DriveReader = Arc<dyn Fn(char) -> DriveOutcome + Send + Sync>;

/// The letters whose read runs.
type Running = Arc<Mutex<BTreeSet<char>>>;

fn running(set: &Running) -> std::sync::MutexGuard<'_, BTreeSet<char>> {
    set.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Takes the letter off the running reads when its thread ends, a panic's
/// end included (the hook has logged it), so its next pass reads it again.
struct Release {
    running: Running,
    letter: char,
}

impl Drop for Release {
    fn drop(&mut self) {
        running(&self.running).remove(&self.letter);
    }
}

/// The drives' reads: the reader, the budget, the reads that run, and the
/// name and mapping each letter last answered with.
pub(crate) struct Drives {
    read: DriveReader,
    budget: Duration,
    running: Running,
    known: BTreeMap<char, (String, bool)>,
}

impl Drives {
    /// The studio PC's drives, read through WinRT with the 2 s budget.
    pub(crate) fn through_windows() -> Self {
        Self::with_reader(Arc::new(read_through_windows), DRIVE_READ_BUDGET)
    }

    pub(crate) fn with_reader(read: DriveReader, budget: Duration) -> Self {
        Self {
            read,
            budget,
            running: Arc::new(Mutex::new(BTreeSet::new())),
            known: BTreeMap::new(),
        }
    }

    /// One read of every letter: the drives that answered within the
    /// budget, and those that did not, this pass's read or one still running
    /// from an earlier pass, which are not read again until it ends.
    pub(crate) fn read_all(&mut self) -> Vec<DriveRead> {
        let started = Instant::now();
        let (sender, answers) = mpsc::channel::<(char, DriveOutcome)>();
        let mut waiting = BTreeSet::new();
        for letter in DRIVE_LETTERS {
            if !running(&self.running).insert(letter) {
                continue;
            }
            let release = Release {
                running: Arc::clone(&self.running),
                letter,
            };
            let read = Arc::clone(&self.read);
            let sender = sender.clone();
            let spawned = thread::Builder::new()
                .name(format!("session-drive-{letter}"))
                .spawn(move || {
                    let outcome = read(letter);
                    // Released before the answer, so a pass that hears it
                    // may read the letter again.
                    drop(release);
                    let _ = sender.send((letter, outcome));
                });
            // A thread that could not start is released with its closure,
            // and its letter reads as not answering this pass.
            if spawned.is_ok() {
                waiting.insert(letter);
            }
        }
        drop(sender);

        let mut outcomes = BTreeMap::new();
        while !waiting.is_empty() {
            let left = self.budget.saturating_sub(started.elapsed());
            match answers.recv_timeout(left) {
                Ok((letter, outcome)) => {
                    waiting.remove(&letter);
                    outcomes.insert(letter, outcome);
                }
                Err(_) => break,
            }
        }

        let mut drives = Vec::new();
        for letter in DRIVE_LETTERS {
            match outcomes.remove(&letter) {
                Some(DriveOutcome::NotThere) => {}
                Some(DriveOutcome::Answered {
                    name,
                    mapped,
                    space,
                }) => {
                    self.known.insert(letter, (name.clone(), mapped));
                    drives.push(DriveRead {
                        letter,
                        name,
                        mapped,
                        space: Some(space),
                    });
                }
                None => {
                    let (name, mapped) = self.known.get(&letter).cloned().unwrap_or_default();
                    drives.push(DriveRead {
                        letter,
                        name,
                        mapped,
                        space: None,
                    });
                }
            }
        }
        drives
    }

    /// How many letters' reads run now.
    #[cfg(test)]
    pub(crate) fn reads_running(&self) -> usize {
        running(&self.running).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn space(free_gb: u64, total_gb: u64) -> Space {
        Space {
            free_bytes: free_gb * GIB,
            total_bytes: total_gb * GIB,
        }
    }

    #[test]
    fn the_levels_change_under_their_thresholds_in_explorers_units() {
        use SessionDiskLevel::{Low, NearlyFull, Ok};
        let gib = |gb: u64| gb * GIB;
        // Low under 200 GB, Nearly full under 50 GB (the owner's, D52).
        for (free, level) in [
            (gib(2_000), Ok),
            (gib(200), Ok),
            (gib(200) - 1, Low),
            (gib(50), Low),
            (gib(50) - 1, NearlyFull),
            (0, NearlyFull),
            (u64::MAX, Ok),
        ] {
            assert_eq!(level_of(free, 200, 50), level, "{free} bytes free");
        }
        // 200 GB as a disk maker counts it (10⁹ bytes) is under Explorer's 200.
        assert_eq!(level_of(200_000_000_000, 200, 50), Low);
        // The levels as Setup may set them: whole GB, 1 to 100,000.
        assert_eq!(level_of(gib(1) - 1, 2, 1), NearlyFull);
        assert_eq!(level_of(gib(99_999), 100_000, 1), Low);
    }

    #[test]
    fn a_drives_name_leaves_its_letter_out_and_a_shares_its_server() {
        assert_eq!(drive_name("Storage 1 (D:)", 'D', false), "Storage 1");
        assert_eq!(drive_name("Local Disk (C:)", 'C', false), "Local Disk");
        assert_eq!(drive_name("A015 (E:)", 'E', false), "A015");
        assert_eq!(
            drive_name(r"Public (\\172.16.18.28) (Z:)", 'Z', true),
            "Public"
        );
        // A local drive whose own name has brackets keeps them.
        assert_eq!(
            drive_name(r"Backups (\\old) (F:)", 'F', false),
            r"Backups (\\old)"
        );
        // Another letter's brackets are the name's own.
        assert_eq!(drive_name("Camera (E:)", 'F', false), "Camera (E:)");
        assert_eq!(drive_name("  ", 'G', false), "");
    }

    /// A stand-in for the WinRT read: D: and Z: answer, every other letter is
    /// not there, and a letter in `held` waits until the test lets it go.
    struct Stand {
        held: Mutex<BTreeSet<char>>,
        reads: AtomicUsize,
        let_go: (Mutex<bool>, std::sync::Condvar),
    }

    impl Stand {
        fn new(held: &[char]) -> Arc<Self> {
            Arc::new(Self {
                held: Mutex::new(held.iter().copied().collect()),
                reads: AtomicUsize::new(0),
                let_go: (Mutex::new(false), std::sync::Condvar::new()),
            })
        }

        fn reader(self: &Arc<Self>) -> DriveReader {
            let stand = Arc::clone(self);
            Arc::new(move |letter| stand.read(letter))
        }

        fn read(&self, letter: char) -> DriveOutcome {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self
                .held
                .lock()
                .expect("the held letters")
                .contains(&letter)
            {
                let (gone, signal) = &self.let_go;
                let mut gone = gone.lock().expect("the release");
                while !*gone {
                    gone = signal.wait(gone).expect("the release");
                }
            }
            match letter {
                'D' => DriveOutcome::Answered {
                    name: String::from("Storage 1"),
                    mapped: false,
                    space: space(2_048, 3_815),
                },
                'Z' => DriveOutcome::Answered {
                    name: String::from("Public"),
                    mapped: true,
                    space: space(3_700, 17_400),
                },
                _ => DriveOutcome::NotThere,
            }
        }

        fn release(&self) {
            self.held.lock().expect("the held letters").clear();
            let (gone, signal) = &self.let_go;
            *gone.lock().expect("the release") = true;
            signal.notify_all();
        }
    }

    #[test]
    fn a_pass_lists_the_drives_that_answer_in_their_letters_order() {
        let stand = Stand::new(&[]);
        let mut drives = Drives::with_reader(stand.reader(), Duration::from_secs(5));
        let read = drives.read_all();
        assert_eq!(
            read,
            vec![
                DriveRead {
                    letter: 'D',
                    name: String::from("Storage 1"),
                    mapped: false,
                    space: Some(space(2_048, 3_815)),
                },
                DriveRead {
                    letter: 'Z',
                    name: String::from("Public"),
                    mapped: true,
                    space: Some(space(3_700, 17_400)),
                },
            ]
        );
        assert_eq!(
            stand.reads.load(Ordering::SeqCst),
            24,
            "C: to Z:, once each"
        );
        assert_eq!(read[0].said(), "D: (Storage 1)");
        assert_eq!(
            read[0].snapshot(200, 50),
            SessionDrive {
                letter: String::from("D"),
                name: String::from("Storage 1"),
                mapped: false,
                answering: true,
                free_bytes: Some(2_048 * GIB),
                total_bytes: Some(3_815 * GIB),
                level: Some(SessionDiskLevel::Ok),
            }
        );
    }

    // A share that hangs: its read is held past the budget. The pass ends at
    // the budget with Z: not answering, under the name it last answered
    // with; the next pass starts no second read of it while the first runs,
    // and once that one ends Z: is read again. The budget leaves the other
    // letters' reads time to answer on a loaded machine: a pass ends as soon
    // as they all have, so it costs only where a read is held.
    #[test]
    fn a_drive_that_hangs_reads_as_not_answering_and_is_not_read_twice_at_once() {
        let stand = Stand::new(&[]);
        let budget = Duration::from_millis(1_500);
        let mut drives = Drives::with_reader(stand.reader(), budget);
        assert!(drives.read_all().iter().all(DriveRead::answering));

        stand.held.lock().expect("the held letters").insert('Z');
        let started = Instant::now();
        let read = drives.read_all();
        assert!(started.elapsed() >= budget, "the pass waits its budget");
        assert!(
            started.elapsed() < budget + Duration::from_secs(2),
            "and no longer"
        );
        let z = read
            .iter()
            .find(|drive| drive.letter == 'Z')
            .expect("Z: is listed");
        assert_eq!(
            z,
            &DriveRead {
                letter: 'Z',
                name: String::from("Public"),
                mapped: true,
                space: None,
            }
        );
        assert_eq!(
            z.snapshot(200, 50),
            SessionDrive {
                letter: String::from("Z"),
                name: String::from("Public"),
                mapped: true,
                answering: false,
                free_bytes: None,
                total_bytes: None,
                level: None,
            }
        );
        assert_eq!(z.said(), "Z: (Public)");
        assert!(read
            .iter()
            .any(|drive| drive.letter == 'D' && drive.answering()));
        assert_eq!(drives.reads_running(), 1, "Z:'s read still runs");

        let before = stand.reads.load(Ordering::SeqCst);
        let again = drives.read_all();
        assert_eq!(
            stand.reads.load(Ordering::SeqCst) - before,
            23,
            "every letter but Z: is read again"
        );
        assert!(!again
            .iter()
            .find(|drive| drive.letter == 'Z')
            .expect("Z:")
            .answering());

        stand.release();
        let deadline = Instant::now() + Duration::from_secs(5);
        while drives.reads_running() > 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(drives.reads_running(), 0, "the held read ended");
        let back = drives.read_all();
        assert!(back
            .iter()
            .find(|drive| drive.letter == 'Z')
            .expect("Z:")
            .answering());
    }

    // A drive whose read hangs from the hardware link's start has no name to
    // keep: it is listed by its letter alone.
    #[test]
    fn a_drive_that_never_answered_is_listed_by_its_letter() {
        let stand = Stand::new(&['Z']);
        let mut drives = Drives::with_reader(stand.reader(), Duration::from_millis(1_000));
        let read = drives.read_all();
        let z = read
            .iter()
            .find(|drive| drive.letter == 'Z')
            .expect("Z: is listed");
        assert_eq!(
            (z.name.as_str(), z.mapped, z.answering()),
            ("", false, false)
        );
        assert_eq!(z.said(), "Z:");
        stand.release();
    }

    // A panic in a read releases its letter: the next pass reads it again.
    #[test]
    fn a_read_that_panics_lets_its_letter_be_read_again() {
        let reads = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&reads);
        let reader: DriveReader = Arc::new(move |letter| {
            if letter == 'Q' && counted.fetch_add(1, Ordering::SeqCst) == 0 {
                panic!("a stand-in's first read of Q: panics");
            }
            DriveOutcome::NotThere
        });
        let mut drives = Drives::with_reader(reader, Duration::from_millis(1_500));
        let first = drives.read_all();
        assert!(
            first
                .iter()
                .any(|drive| drive.letter == 'Q' && !drive.answering()),
            "the panicked read did not answer"
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        while drives.reads_running() > 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            drives.read_all().is_empty(),
            "Q: is read again, and is not there"
        );
        assert_eq!(reads.load(Ordering::SeqCst), 2);
    }

    // The one read of a real drive in the tests: the drive this test's own
    // temp folder is on, through WinRT, as the watch reads every drive. It
    // is local (the system's), and only read.
    #[test]
    fn the_drive_of_the_tests_temp_folder_reads_through_windows() {
        let temp = std::env::temp_dir();
        let Some(letter) = temp
            .to_str()
            .and_then(|path| path.chars().next())
            .filter(|letter| letter.is_ascii_alphabetic())
            .map(|letter| letter.to_ascii_uppercase())
        else {
            return;
        };
        match read_through_windows(letter) {
            DriveOutcome::Answered { name, space, .. } => {
                assert!(space.total_bytes > 0, "{letter}: has a size");
                assert!(space.free_bytes <= space.total_bytes, "{space:?}");
                assert!(!name.contains(&format!("({letter}:)")), "{name}");
            }
            DriveOutcome::NotThere => panic!("{letter}:, the temp folder's drive, did not read"),
        }
    }
}
