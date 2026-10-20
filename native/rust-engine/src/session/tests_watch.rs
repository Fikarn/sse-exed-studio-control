//! The sessions' watch (`watch.rs`): what a read changes and says, how its
//! report appears in `session.snapshot`, a begin on a drive that does not
//! answer, an end that keeps its folder's measure, the walks, and a pass
//! over a test's own folders with stand-ins for the drives and for vMix.
//! Every folder here is the test's own, in its temp folder: no test reads
//! vMix, and the one real drive read is `drives.rs`' own test.

use super::commands::{handle_session_request, Saved, CURRENT_KEY, LAST_KEY};
use super::drives::{DriveOutcome, DriveRead, DriveReader, Drives, Space, GIB};
use super::folder::{drive_letter, read_drive_path, SESSION_DRIVE_MISSING};
use super::places::Places;
use super::settings::read_settings;
use super::snapshot::{Session, SessionDiskLevel, SessionKind};
use super::tests::{TestSession, MORNING, NOON};
use super::vmix::VmixRecording;
use super::watch::{
    apply_read, disks_due_next, folder_size, listed, read_root, snapshot_of, Board, Change,
    FolderRead, RootRead, VmixRead, VmixReader, Wake, Watch, WatchReport, RECENT_FOLDERS,
};
use super::SessionError;
use crate::cameras::runtime::utc_text;
use crate::diagnostics::LogLevel;
use crate::engine_events::EMITTED;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn stamp(seconds: u64) -> String {
    utc_text(UNIX_EPOCH + Duration::from_secs(1_790_000_000 + seconds))
}

fn space(free_gb: u64) -> Space {
    Space {
        free_bytes: free_gb * GIB,
        total_bytes: 3_815 * GIB,
    }
}

fn answering(letter: char, name: &str, free_gb: u64) -> DriveRead {
    DriveRead {
        letter,
        name: String::from(name),
        mapped: letter == 'Z',
        space: Some(space(free_gb)),
    }
}

fn silent(letter: char, name: &str) -> DriveRead {
    DriveRead {
        letter,
        name: String::from(name),
        mapped: letter == 'Z',
        space: None,
    }
}

fn read_of(seconds: u64, drives: Vec<DriveRead>) -> WatchReport {
    WatchReport {
        read_at: Some(stamp(seconds)),
        drives,
        ..WatchReport::default()
    }
}

fn line(level: LogLevel, text: &str) -> (LogLevel, String) {
    (level, String::from(text))
}

/// The letter of the drive a test's temp folder is on.
fn letter_of(path: &Path) -> char {
    drive_letter(path).expect("the temp folder is on a lettered drive")
}

fn emitted() -> Vec<(String, Value)> {
    EMITTED.with(|events| std::mem::take(&mut *events.borrow_mut()))
}

/// A board of a test's own: the hardware link's stays untouched.
fn own_board() -> &'static Board {
    Box::leak(Box::new(Board::new()))
}

#[test]
fn a_drive_that_stops_answering_is_said_once_and_its_return_too() {
    let first = read_of(
        0,
        vec![
            answering('D', "Storage 1", 2_048),
            answering('Z', "Public", 3_700),
        ],
    );
    let mut said = None;
    let change = apply_read(
        &WatchReport::default(),
        &first,
        &mut said,
        Some('D'),
        200,
        50,
    );
    assert_eq!(
        change,
        Change {
            moved: true,
            log_lines: Vec::new()
        },
        "the first read moved, and every drive answers"
    );
    // The same again later: only the time of reading moved.
    let again = read_of(30, first.drives.clone());
    assert_eq!(
        apply_read(&first, &again, &mut said, Some('D'), 200, 50),
        Change::default()
    );

    let lost = read_of(
        60,
        vec![answering('D', "Storage 1", 2_048), silent('Z', "Public")],
    );
    assert_eq!(
        apply_read(&again, &lost, &mut said, Some('D'), 200, 50),
        Change {
            moved: true,
            log_lines: vec![line(
                LogLevel::Warn,
                "Z: (Public) does not answer in 2 s: its space is not read, and a Begin there is refused until it answers."
            )]
        }
    );
    let still = read_of(90, lost.drives.clone());
    assert_eq!(
        apply_read(&lost, &still, &mut said, Some('D'), 200, 50),
        Change::default()
    );
    let back = read_of(120, first.drives.clone());
    assert_eq!(
        apply_read(&still, &back, &mut said, Some('D'), 200, 50).log_lines,
        vec![line(LogLevel::Info, "Z: (Public) answers again.")]
    );

    // A drive that does not answer the first read is said at once, by its
    // letter when it never answered with a name.
    let from_the_start = read_of(0, vec![silent('Z', "")]);
    assert_eq!(
        apply_read(
            &WatchReport::default(),
            &from_the_start,
            &mut None,
            None,
            200,
            50
        )
        .log_lines,
        vec![line(
            LogLevel::Warn,
            "Z: does not answer in 2 s: its space is not read, and a Begin there is refused until it answers."
        )]
    );
}

#[test]
fn the_sessions_drive_turning_low_or_nearly_full_is_said_once() {
    let at = |seconds, free_gb| {
        read_of(
            seconds,
            vec![
                answering('D', "Storage 1", free_gb),
                answering('Z', "Public", 10),
            ],
        )
    };
    let mut said = None;
    let plenty = at(0, 2_048);
    assert!(apply_read(
        &WatchReport::default(),
        &plenty,
        &mut said,
        Some('D'),
        200,
        50
    )
    .log_lines
    .is_empty());
    assert_eq!(said, Some(('D', SessionDiskLevel::Ok)));
    let low = at(30, 140);
    assert_eq!(
        apply_read(&plenty, &low, &mut said, Some('D'), 200, 50).log_lines,
        vec![line(
            LogLevel::Warn,
            "The session's drive D: (Storage 1) is low: 140 GB free, under 200 GB."
        )]
    );
    let lower = at(60, 120);
    assert_eq!(
        apply_read(&low, &lower, &mut said, Some('D'), 200, 50),
        Change {
            moved: true,
            log_lines: Vec::new()
        },
        "still low: nothing to say"
    );
    let full = at(90, 28);
    assert_eq!(
        apply_read(&lower, &full, &mut said, Some('D'), 200, 50).log_lines,
        vec![line(
            LogLevel::Warn,
            "The session's drive D: (Storage 1) is nearly full: 28 GB free, under 50 GB."
        )]
    );
    let freed = at(120, 210);
    assert_eq!(
        apply_read(&full, &freed, &mut said, Some('D'), 200, 50).log_lines,
        vec![line(
            LogLevel::Info,
            "The session's drive D: (Storage 1) has 210 GB free again, above Low (200 GB)."
        )]
    );
    // Z: has 10 GB, and is not the session's drive: nothing is said of it.
    // A first read that finds the session's drive low says so.
    assert_eq!(
        apply_read(&WatchReport::default(), &low, &mut None, Some('D'), 200, 50)
            .log_lines
            .len(),
        1
    );
    assert!(
        apply_read(&WatchReport::default(), &low, &mut None, Some('Z'), 5, 1)
            .log_lines
            .is_empty()
    );
}

// The review of #355: the level is held to what the log said last, not to
// the report before.
#[test]
fn a_level_is_said_after_a_missed_read_and_for_a_drive_the_session_moves_to() {
    // D: was said low, misses a read, and answers above Low.
    let mut said = Some(('D', SessionDiskLevel::Low));
    let low = read_of(0, vec![answering('D', "Storage 1", 140)]);
    let missed = read_of(30, vec![silent('D', "Storage 1")]);
    apply_read(&low, &missed, &mut said, Some('D'), 200, 50);
    assert_eq!(
        said,
        Some(('D', SessionDiskLevel::Low)),
        "a drive that does not answer leaves the level said"
    );
    let freed = read_of(60, vec![answering('D', "Storage 1", 250)]);
    assert_eq!(
        apply_read(&missed, &freed, &mut said, Some('D'), 200, 50).log_lines,
        vec![
            line(LogLevel::Info, "D: (Storage 1) answers again."),
            line(
                LogLevel::Info,
                "The session's drive D: (Storage 1) has 250 GB free again, above Low (200 GB)."
            )
        ]
    );

    // A begin moves the session to E:, which was already low.
    let both = read_of(
        90,
        vec![
            answering('D', "Storage 1", 2_048),
            answering('E', "A015", 140),
        ],
    );
    let mut said = Some(('D', SessionDiskLevel::Ok));
    assert_eq!(
        apply_read(&both, &both, &mut said, Some('E'), 200, 50).log_lines,
        vec![line(
            LogLevel::Warn,
            "The session's drive E: (A015) is low: 140 GB free, under 200 GB."
        )]
    );
    assert_eq!(said, Some(('E', SessionDiskLevel::Low)));
    // Moved back to D:, which is fine: nothing to say, and D:'s level is held.
    assert!(apply_read(&both, &both, &mut said, Some('D'), 200, 50)
        .log_lines
        .is_empty());
    assert_eq!(said, Some(('D', SessionDiskLevel::Ok)));
}

// A pass that was to read the disks and could not read the saved data
// leaves them due; otherwise they are read when woken and at every sixth
// look.
#[test]
fn the_disks_are_read_when_woken_every_sixth_look_and_again_after_a_missed_pass() {
    assert!(disks_due_next(false, true, 1), "woken");
    assert!(disks_due_next(false, false, 6), "the sixth look");
    assert!(disks_due_next(false, false, 12));
    assert!(!disks_due_next(false, false, 7));
    assert!(disks_due_next(true, false, 7), "missed");
    assert!(!disks_due_next(false, false, 1));
}

#[test]
fn vmix_starting_and_stopping_to_answer_is_said_once() {
    let with = |vmix: VmixRead| WatchReport {
        vmix,
        ..WatchReport::default()
    };
    let idle = with(VmixRead::Answering {
        recording: false,
        file: None,
        bytes_per_second: None,
    });
    let silent = with(VmixRead::NotAnswering);
    let read = |previous: &WatchReport, read: &WatchReport| {
        apply_read(previous, read, &mut None, None, 200, 50)
    };
    let first = read(&WatchReport::default(), &idle);
    assert!(first.moved);
    assert_eq!(
        first.log_lines,
        vec![line(
            LogLevel::Info,
            "vMix answers on 127.0.0.1:8088: the Session page reads where it records."
        )]
    );
    assert_eq!(read(&idle, &idle), Change::default());
    assert_eq!(
        read(&idle, &silent).log_lines,
        vec![line(
            LogLevel::Info,
            "vMix does not answer on 127.0.0.1:8088: the Session page cannot say where it records."
        )]
    );
    assert_eq!(read(&silent, &silent), Change::default());
    assert_eq!(
        read(&silent, &idle).log_lines,
        vec![line(
            LogLevel::Info,
            "vMix answers again on 127.0.0.1:8088: the Session page reads where it records."
        )]
    );
    // A recording that grows moves the report at each look, and says nothing.
    let recording = |rate| {
        with(VmixRead::Answering {
            recording: true,
            file: Some(String::from(r"D:\a.avi")),
            bytes_per_second: Some(rate),
        })
    };
    assert_eq!(
        read(&recording(13), &recording(14)),
        Change {
            moved: true,
            log_lines: Vec::new()
        }
    );
}

fn saved(current: Option<Session>, last: Vec<Session>) -> Saved {
    Saved {
        current,
        last,
        settings: read_settings(&HashMap::new()),
    }
}

fn session(kind: SessionKind, folder: &str, ended: bool, folder_bytes: Option<u64>) -> Session {
    Session {
        kind,
        name: String::from("Take"),
        begun_at: String::from(MORNING),
        ended_at: ended.then(|| String::from(NOON)),
        folder: Some(String::from(folder)),
        folder_bytes,
    }
}

const RUNNING: &str = r"D:\Sessions\Morning take (2026-10-18)";
const LAST: &str = r"D:\Sessions\Spring launch (2026-10-17)";

/// The studio's places, whose root is the settings' (`D:\Sessions`): a
/// snapshot is worked out from a report, and nothing reads that folder.
fn studio() -> Places {
    Places::new(
        false,
        &std::env::temp_dir().join("studio-control-watch-places"),
    )
}

fn studio_report() -> WatchReport {
    WatchReport {
        read_at: Some(stamp(0)),
        drives: vec![
            answering('C', "Local Disk", 1_600),
            answering('D', "Storage 1", 140),
        ],
        root: Some(RootRead {
            path: String::from(r"D:\Sessions"),
            exists: true,
            recent: vec![
                FolderRead {
                    name: String::from("Morning take (2026-10-18)"),
                    path: String::from(RUNNING),
                    created_at: stamp(10),
                },
                FolderRead {
                    name: String::from("Spring launch (2026-10-17)"),
                    path: String::from(LAST),
                    created_at: stamp(0),
                },
            ],
        }),
        sizes: BTreeMap::from([
            (String::from(RUNNING), Some(12 * GIB)),
            (String::from(LAST), None),
        ]),
        recording_folder: Some((String::from(RUNNING), format!(r"{RUNNING}\vMix Recording"))),
        vmix: VmixRead::Answering {
            recording: true,
            file: Some(format!(r"{RUNNING}\vMix Recording\capture.avi")),
            bytes_per_second: Some(13 * 1024 * 1024),
        },
    }
}

#[test]
fn the_snapshot_carries_the_watchs_report() {
    let report = studio_report();
    let snapshot = snapshot_of(
        saved(
            Some(session(SessionKind::Podcast, RUNNING, false, None)),
            vec![session(SessionKind::Webinar, LAST, true, Some(61 * GIB))],
        ),
        &studio(),
        Some(&report),
    );
    let snapshot = serde_json::to_value(snapshot).expect("the snapshot is JSON");
    assert_eq!(
        snapshot["current"]["folderBytes"],
        json!(12 * GIB),
        "its latest measure"
    );
    assert_eq!(
        snapshot["last"][0]["folderBytes"],
        json!(61 * GIB),
        "the measure kept at its end"
    );
    assert_eq!(
        snapshot["places"],
        json!({ "root": r"D:\Sessions", "simulated": false, "rootExists": true })
    );
    assert_eq!(
        snapshot["recent"],
        json!([
            { "name": "Morning take (2026-10-18)", "path": RUNNING, "createdAt": stamp(10), "bytes": 12 * GIB },
            { "name": "Spring launch (2026-10-17)", "path": LAST, "createdAt": stamp(0), "bytes": null }
        ])
    );
    assert_eq!(
        snapshot["drives"],
        json!([
            { "letter": "C", "name": "Local Disk", "mapped": false, "answering": true,
              "freeBytes": 1_600 * GIB, "totalBytes": 3_815 * GIB, "level": "ok" },
            { "letter": "D", "name": "Storage 1", "mapped": false, "answering": true,
              "freeBytes": 140 * GIB, "totalBytes": 3_815 * GIB, "level": "low" }
        ])
    );
    assert_eq!(snapshot["sessionDrive"], "D");
    assert_eq!(
        snapshot["vmix"],
        json!({
            "state": "answering",
            "recording": true,
            "file": format!(r"{RUNNING}\vMix Recording\capture.avi"),
            "inFolder": true,
            "bytesPerSecond": 13 * 1024 * 1024,
            "recordingFolder": format!(r"{RUNNING}\vMix Recording")
        })
    );
    assert_eq!(snapshot["readAt"], stamp(0));
}

#[test]
fn the_snapshot_without_a_report_or_with_another_folders_reads_nothing_of_it() {
    // Before the first pass.
    let before = snapshot_of(
        saved(None, vec![session(SessionKind::Webinar, LAST, true, None)]),
        &studio(),
        None,
    );
    let before = serde_json::to_value(before).expect("the snapshot is JSON");
    assert_eq!(before["recent"], json!([]));
    assert_eq!(before["drives"], json!([]));
    assert_eq!(before["places"]["rootExists"], false);
    assert_eq!(before["sessionDrive"], "D", "the sessions' folder's drive");
    assert_eq!(before["readAt"], Value::Null);
    assert_eq!(before["last"][0]["folderBytes"], Value::Null);
    assert_eq!(
        before["vmix"],
        json!({ "state": "not-read", "recording": false, "file": null, "inFolder": null,
                "bytesPerSecond": null, "recordingFolder": null })
    );

    // A report of another sessions' folder (the setting moved since) lists
    // none of its folders; a last session without a kept measure takes the
    // watch's.
    let mut report = studio_report();
    if let Some(root) = report.root.as_mut() {
        root.path = String::from(r"E:\Elsewhere");
    }
    report.sizes.insert(String::from(LAST), Some(9 * GIB));
    let moved = snapshot_of(
        saved(None, vec![session(SessionKind::Webinar, LAST, true, None)]),
        &studio(),
        Some(&report),
    );
    let moved = serde_json::to_value(moved).expect("the snapshot is JSON");
    assert_eq!(moved["recent"], json!([]));
    assert_eq!(moved["places"]["rootExists"], false);
    assert_eq!(moved["last"][0]["folderBytes"], json!(9 * GIB));
    // No session runs: vMix's file is in no session's folder, and there is
    // no folder to record to.
    assert_eq!(moved["vmix"]["inFolder"], Value::Null);
    assert_eq!(moved["vmix"]["recordingFolder"], Value::Null);

    // vMix recording elsewhere.
    let mut elsewhere = studio_report();
    elsewhere.vmix = VmixRead::Answering {
        recording: false,
        file: Some(String::from(r"D:\All\Old take (2026-10-01)\capture.avi")),
        bytes_per_second: None,
    };
    let running = snapshot_of(
        saved(
            Some(session(SessionKind::Podcast, RUNNING, false, None)),
            Vec::new(),
        ),
        &studio(),
        Some(&elsewhere),
    );
    assert_eq!(running.vmix.in_folder, Some(false));
    assert!(!running.vmix.recording);
    // vMix does not answer.
    elsewhere.vmix = VmixRead::NotAnswering;
    let silent = snapshot_of(
        saved(
            Some(session(SessionKind::Podcast, RUNNING, false, None)),
            Vec::new(),
        ),
        &studio(),
        Some(&elsewhere),
    );
    assert_eq!(
        serde_json::to_value(&silent.vmix).expect("JSON")["state"],
        "not-answering"
    );
    assert_eq!(silent.vmix.file, None);
    assert_eq!(
        silent.vmix.recording_folder.as_deref(),
        Some(format!(r"{RUNNING}\vMix Recording").as_str()),
        "where vMix should record is the folder's, whatever vMix says"
    );
}

#[test]
fn a_simulated_runs_snapshot_never_says_what_vmix_said() {
    let places = Places::new(
        true,
        &std::env::temp_dir().join("studio-control-watch-simulated"),
    );
    let snapshot = snapshot_of(
        saved(
            Some(session(SessionKind::Podcast, RUNNING, false, None)),
            Vec::new(),
        ),
        &places,
        Some(&studio_report()),
    );
    let vmix = serde_json::to_value(&snapshot.vmix).expect("JSON");
    assert_eq!(vmix["state"], "simulated");
    assert_eq!(
        (
            &vmix["recording"],
            &vmix["file"],
            &vmix["inFolder"],
            &vmix["bytesPerSecond"]
        ),
        (&json!(false), &Value::Null, &Value::Null, &Value::Null)
    );
}

// A begin trusts the watch's last read for the drive: one that did not
// answer is refused at once, without asking it.
#[test]
fn a_begin_on_a_drive_the_watch_found_not_answering_is_refused_at_once() {
    let test = TestSession::new("watch-silent-drive");
    let letter = letter_of(&test.places.scratch_root);
    *test.watch.borrow_mut() = Some(read_of(0, vec![silent(letter, "Local Disk")]));
    assert_eq!(
        test.refusal("session.begin", json!({ "kind": "podcast", "name": "Take" })),
        SessionError::Refused(
            SESSION_DRIVE_MISSING,
            format!(
                "{letter}: does not answer, so the session's folder cannot be made there. Choose a folder on another drive, or set another sessions' folder in Setup / Support."
            )
        )
    );
    let existing = read_drive_path(&test.root.display().to_string()).expect("a drive path");
    assert_eq!(
        test.refusal(
            "session.begin",
            json!({ "kind": "podcast", "folder": { "mode": "existing", "path": existing.text } })
        ),
        SessionError::Refused(
            SESSION_DRIVE_MISSING,
            format!(
                "{letter}: does not answer, so {} cannot be used. Choose another folder.",
                existing.text
            )
        )
    );
    assert!(!test.places.scratch_root.exists(), "nothing was made");
    assert_eq!(test.setting(CURRENT_KEY), None);

    // A drive that answers is asked as before; so is one the last read did
    // not find (it may have been plugged in since).
    *test.watch.borrow_mut() = Some(read_of(30, vec![answering(letter, "Local Disk", 900)]));
    assert_eq!(
        test.begin("podcast", "Take", MORNING)["folder"]["made"],
        true
    );
    *test.watch.borrow_mut() = Some(read_of(60, Vec::new()));
    assert_eq!(
        test.begin("webinar", "Launch", NOON)["folder"]["made"],
        true
    );
}

#[test]
fn an_end_keeps_its_folders_last_measure_and_a_later_one_does_not_move_it() {
    let test = TestSession::new("watch-freeze");
    let begun = test.begin("podcast", "Morning take", MORNING);
    let folder = begun["folder"]["path"]
        .as_str()
        .expect("a path")
        .to_string();
    assert_eq!(begun["session"]["folderBytes"], Value::Null);
    let measured = |bytes: Option<u64>| WatchReport {
        sizes: BTreeMap::from([(folder.clone(), bytes)]),
        ..read_of(0, Vec::new())
    };
    *test.watch.borrow_mut() = Some(measured(Some(61 * GIB)));
    assert_eq!(test.snapshot()["current"]["folderBytes"], json!(61 * GIB));
    assert_eq!(
        test.setting(CURRENT_KEY).expect("it runs")["folderBytes"],
        Value::Null,
        "a running session's measure is not saved"
    );

    let ended = test.end(NOON);
    assert_eq!(ended["ended"]["folderBytes"], json!(61 * GIB));
    assert_eq!(
        test.setting(LAST_KEY).expect("its kind's last")[0]["folderBytes"],
        json!(61 * GIB)
    );
    *test.watch.borrow_mut() = None;
    assert_eq!(test.snapshot()["last"][0]["folderBytes"], json!(61 * GIB));
    *test.watch.borrow_mut() = Some(measured(Some(70 * GIB)));
    assert_eq!(
        test.snapshot()["last"][0]["folderBytes"],
        json!(61 * GIB),
        "exports added later do not move the session's own measure"
    );

    // A begin over a running session keeps that one's measure too; a walk
    // that was cut keeps none.
    let second = test.begin("webinar", "Launch", NOON);
    let second_folder = second["folder"]["path"]
        .as_str()
        .expect("a path")
        .to_string();
    *test.watch.borrow_mut() = Some(WatchReport {
        sizes: BTreeMap::from([(second_folder, Some(3 * GIB))]),
        ..read_of(30, Vec::new())
    });
    let third = test.begin("podcast", "Evening take", NOON);
    assert_eq!(third["ended"]["folderBytes"], json!(3 * GIB));
    *test.watch.borrow_mut() = Some(WatchReport {
        sizes: BTreeMap::from([(
            third["folder"]["path"]
                .as_str()
                .expect("a path")
                .to_string(),
            None,
        )]),
        ..read_of(60, Vec::new())
    });
    assert_eq!(test.end(NOON)["ended"]["folderBytes"], Value::Null);
}

fn temp(label: &str) -> std::path::PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!(
        "studio-control-watch-{label}-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&path).expect("the test's folder is made");
    path
}

#[test]
fn a_folders_size_is_its_files_and_a_walk_over_its_bounds_measures_nothing() {
    let root = temp("walk");
    let folder = root.join("Take (2026-10-18)");
    fs::create_dir_all(folder.join("Audio").join("Takes")).expect("folders");
    fs::create_dir_all(folder.join("Exports")).expect("folders");
    fs::write(folder.join("notes.txt"), vec![0_u8; 1_000]).expect("a file");
    fs::write(folder.join("Audio").join("a.wav"), vec![0_u8; 2_500]).expect("a file");
    fs::write(
        folder.join("Audio").join("Takes").join("b.wav"),
        vec![0_u8; 500],
    )
    .expect("a file");
    assert_eq!(
        folder_size(&folder, Duration::from_secs(5), 100),
        Some(4_000)
    );
    // Six entries in all, three files and three folders: five are too few
    // to count them.
    assert_eq!(folder_size(&folder, Duration::from_secs(5), 6), Some(4_000));
    assert_eq!(folder_size(&folder, Duration::from_secs(5), 5), None);
    assert_eq!(
        folder_size(&folder, Duration::ZERO, 100),
        None,
        "no time to walk"
    );
    assert_eq!(
        folder_size(&folder.join("Exports"), Duration::from_secs(5), 100),
        Some(0)
    );
    // The time is looked at before each folder is listed, so an empty folder
    // with no time left is cut too (the review of #355): a tree of empty
    // folders cannot run past the walk's second.
    assert_eq!(
        folder_size(&folder.join("Exports"), Duration::ZERO, 100),
        None
    );
    assert_eq!(
        folder_size(&root.join("Not there"), Duration::from_secs(5), 100),
        None
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn the_sessions_folders_newest_six_are_read_newest_first() {
    let root = temp("recent");
    for index in 0..8 {
        fs::create_dir(root.join(format!("Take {index} (2026-10-18)"))).expect("a folder");
        // Windows' creation times are kept to 100 ns, but its clock moves in
        // steps of a few ms: the folders are made apart.
        thread::sleep(Duration::from_millis(20));
    }
    fs::write(root.join("a file (2026-10-18).txt"), b"").expect("a file");
    let read = read_root(&root);
    assert!(read.exists);
    assert_eq!(read.path, root.display().to_string());
    assert_eq!(
        read.recent
            .iter()
            .map(|folder| folder.name.as_str())
            .collect::<Vec<_>>(),
        (2..8)
            .rev()
            .map(|index| format!("Take {index} (2026-10-18)"))
            .collect::<Vec<_>>()
    );
    assert_eq!(read.recent.len(), RECENT_FOLDERS);
    assert_eq!(
        read.recent[0].path,
        root.join("Take 7 (2026-10-18)").display().to_string()
    );
    let missing = read_root(&root.join("Sessions"));
    assert_eq!((missing.exists, missing.recent.len()), (false, 0));
    let _ = fs::remove_dir_all(&root);

    // A hidden or a system folder is not listed, as a drive's own `System
    // Volume Information` and `$RECYCLE.BIN` are not (the review of #355);
    // Windows' attributes: 0x10 a folder, 0x2 hidden, 0x4 system.
    assert!(listed(0x10));
    assert!(
        listed(0x10 | 0x20 | 0x1),
        "archived and read-only are listed"
    );
    assert!(!listed(0x10 | 0x2));
    assert!(!listed(0x10 | 0x4));
    assert!(!listed(0x10 | 0x2 | 0x4));
}

/// A stand-in for the drives' read: `answering` answers with its space,
/// every other letter is not there, and `held` waits until let go, telling
/// `started` when it begins.
struct Stand {
    answering: char,
    held: Option<char>,
    reads: AtomicUsize,
    started: Mutex<Option<mpsc::Sender<()>>>,
    let_go: (Mutex<bool>, Condvar),
}

impl Stand {
    fn new(answering: char, held: Option<char>) -> Arc<Self> {
        Arc::new(Self {
            answering,
            held,
            reads: AtomicUsize::new(0),
            started: Mutex::new(None),
            let_go: (Mutex::new(false), Condvar::new()),
        })
    }

    fn reader(self: &Arc<Self>) -> DriveReader {
        let stand = Arc::clone(self);
        Arc::new(move |letter| {
            stand.reads.fetch_add(1, Ordering::SeqCst);
            if Some(letter) == stand.held {
                if let Some(started) = stand.started.lock().expect("the signal").as_ref() {
                    let _ = started.send(());
                }
                let (gone, signal) = &stand.let_go;
                let mut gone = gone.lock().expect("the release");
                while !*gone {
                    gone = signal.wait(gone).expect("the release");
                }
                return DriveOutcome::NotThere;
            }
            if letter == stand.answering {
                DriveOutcome::Answered {
                    name: String::from("Local Disk"),
                    mapped: false,
                    space: space(900),
                }
            } else {
                DriveOutcome::NotThere
            }
        })
    }

    fn release(&self) {
        let (gone, signal) = &self.let_go;
        *gone.lock().expect("the release") = true;
        signal.notify_all();
    }
}

/// A stand-in for vMix that counts its reads and answers `answer`.
fn vmix_stand(answer: Arc<Mutex<Option<VmixRecording>>>, reads: Arc<AtomicUsize>) -> VmixReader {
    Box::new(move || {
        reads.fetch_add(1, Ordering::SeqCst);
        answer.lock().expect("the answer").clone()
    })
}

#[test]
fn a_pass_reads_the_disks_puts_its_report_on_the_board_and_raises_read_once() {
    let test = TestSession::new("watch-pass");
    let begun = test.begin("podcast", "Morning take", MORNING);
    let folder = begun["folder"]["path"]
        .as_str()
        .expect("a path")
        .to_string();
    fs::write(
        Path::new(&folder).join("Audio").join("a.wav"),
        vec![0_u8; 1_000],
    )
    .expect("a file");
    let letter = letter_of(&test.places.scratch_root);
    let stand = Stand::new(letter, None);
    let vmix_reads = Arc::new(AtomicUsize::new(0));
    let board = own_board();
    let mut watch = Watch::new(
        test.places.clone(),
        Drives::with_reader(stand.reader(), Duration::from_secs(5)),
        vmix_stand(Arc::new(Mutex::new(None)), Arc::clone(&vmix_reads)),
        board,
    );
    emitted();
    let change = watch
        .pass(&test.db_path, true, SystemTime::now(), Instant::now())
        .expect("the pass read the saved data");
    assert!(change.moved);
    assert_eq!(
        emitted(),
        vec![(String::from("session.changed"), json!({ "reason": "read" }))]
    );
    assert_eq!(stand.reads.load(Ordering::SeqCst), 24, "C: to Z:");
    assert_eq!(
        vmix_reads.load(Ordering::SeqCst),
        0,
        "a simulated run never reads vMix"
    );

    let report = board.report().expect("the report is on the board");
    let root = report.root.as_ref().expect("the sessions' folder was read");
    assert_eq!(root.path, test.places.scratch_root.display().to_string());
    assert!(root.exists);
    assert_eq!(
        root.recent
            .iter()
            .map(|folder| folder.path.as_str())
            .collect::<Vec<_>>(),
        vec![folder.as_str()]
    );
    assert_eq!(report.size_of(&folder), Some(1_000));
    assert_eq!(
        report.recording_folder,
        Some((folder.clone(), format!(r"{folder}\vMix Recording")))
    );
    assert_eq!(report.vmix, VmixRead::NotRead);

    // The request reads that report.
    *test.watch.borrow_mut() = board.report();
    let snapshot = test.snapshot();
    assert_eq!(snapshot["places"]["rootExists"], true);
    assert_eq!(snapshot["recent"][0]["bytes"], 1_000);
    assert_eq!(snapshot["current"]["folderBytes"], 1_000);
    assert_eq!(snapshot["sessionDrive"], letter.to_string());
    assert_eq!(snapshot["drives"][0]["letter"], letter.to_string());
    assert_eq!(
        snapshot["vmix"],
        json!({ "state": "simulated", "recording": false, "file": null, "inFolder": null,
                "bytesPerSecond": null, "recordingFolder": format!(r"{folder}\vMix Recording") })
    );

    // Nothing new: nothing moved, nothing raised. A pass without the disks
    // due reads no drive.
    let change = watch
        .pass(&test.db_path, true, SystemTime::now(), Instant::now())
        .expect("a pass");
    assert_eq!(change, Change::default());
    assert!(emitted().is_empty());
    let reads = stand.reads.load(Ordering::SeqCst);
    watch.pass(&test.db_path, false, SystemTime::now(), Instant::now());
    assert_eq!(stand.reads.load(Ordering::SeqCst), reads);

    // A file added: the next disks' read moves the report.
    fs::write(
        Path::new(&folder).join("Audio").join("b.wav"),
        vec![0_u8; 24],
    )
    .expect("a file");
    assert!(
        watch
            .pass(&test.db_path, true, SystemTime::now(), Instant::now())
            .expect("a pass")
            .moved
    );
    assert_eq!(
        board.report().expect("a report").size_of(&folder),
        Some(1_024)
    );
    assert_eq!(emitted().len(), 1);
}

// The studio's places: vMix is read at every pass, and its file's growth
// gives the write rate. The sessions' folder is set to the test's own, so
// nothing here reads D:.
#[test]
fn the_studios_watch_reads_vmix_at_each_pass_and_its_files_rate() {
    let test = TestSession::new("studio");
    let root = test.root.join("S");
    let root_text = read_drive_path(&root.display().to_string())
        .expect("a drive path")
        .text;
    test.request(
        "session.settings.update",
        json!({ "root": root_text }),
        MORNING,
    )
    .expect("the root is set");
    let studio = Places::new(false, &test.root);
    let letter = letter_of(&root);
    let folder = root.join("Take (2026-10-18)");
    fs::create_dir_all(folder.join("vMix Recording")).expect("folders");
    let file = folder.join("vMix Recording").join("capture.avi");
    fs::write(&file, vec![0_u8; 1_000]).expect("a file");
    test.request(
        "session.begin",
        json!({ "kind": "podcast", "folder": { "mode": "existing", "path": read_drive_path(&folder.display().to_string()).expect("a path").text } }),
        MORNING,
    )
    .expect("the begin uses the folder");

    let answer = Arc::new(Mutex::new(Some(VmixRecording {
        recording: true,
        file: Some(file.display().to_string()),
    })));
    let vmix_reads = Arc::new(AtomicUsize::new(0));
    let board = own_board();
    let stand = Stand::new(letter, None);
    let mut watch = Watch::new(
        studio.clone(),
        Drives::with_reader(stand.reader(), Duration::from_secs(5)),
        vmix_stand(Arc::clone(&answer), Arc::clone(&vmix_reads)),
        board,
    );
    let start = Instant::now();
    let change = watch
        .pass(&test.db_path, true, SystemTime::now(), start)
        .expect("a pass");
    assert!(change.log_lines.contains(&line(
        LogLevel::Info,
        "vMix answers on 127.0.0.1:8088: the Session page reads where it records."
    )));
    // vMix is looked at before the disks, so the first pass knows no drive
    // yet and reads no size: the file's looks begin at the second.
    let look = |watch: &mut Watch, seconds: u64| {
        watch.pass(
            &test.db_path,
            false,
            SystemTime::now(),
            start + Duration::from_secs(seconds),
        )
    };
    look(&mut watch, 5);
    look(&mut watch, 10);
    fs::write(&file, vec![0_u8; 1_000 + 10 * 2_000]).expect("the file grows");
    look(&mut watch, 15);
    assert_eq!(vmix_reads.load(Ordering::SeqCst), 4, "at every pass");
    let report = board.report().expect("a report");
    assert_eq!(
        report.vmix,
        VmixRead::Answering {
            recording: true,
            file: Some(file.display().to_string()),
            bytes_per_second: Some(2_000),
        }
    );
    let snapshot = snapshot_of(
        super::commands::read_saved(&test.db_path).expect("the saved part"),
        &studio,
        Some(&report),
    );
    assert_eq!(snapshot.vmix.in_folder, Some(true));
    assert_eq!(snapshot.places.root, root_text);
    assert!(snapshot.places.root_exists);

    // vMix stops answering: said once, and the rate starts again.
    *answer.lock().expect("the answer") = None;
    let change = look(&mut watch, 20).expect("a pass");
    assert_eq!(
        change.log_lines,
        vec![line(
            LogLevel::Info,
            "vMix does not answer on 127.0.0.1:8088: the Session page cannot say where it records."
        )]
    );
    assert_eq!(
        board.report().expect("a report").vmix,
        VmixRead::NotAnswering
    );
}

// The snapshot never waits on the watch: while a pass waits on a drive
// that hangs (3 s here), the board gives its last report at once, and the
// request answers with it, well inside the pass's wait.
#[test]
fn the_snapshot_answers_at_once_while_a_drives_read_is_held() {
    let test = TestSession::new("watch-held");
    let letter = letter_of(&test.places.scratch_root);
    let held = if letter == 'Q' { 'R' } else { 'Q' };
    let stand = Stand::new(letter, Some(held));
    let (started, began) = mpsc::channel();
    *stand.started.lock().expect("the signal") = Some(started);
    let board = own_board();
    board.publish(read_of(0, vec![answering(letter, "Local Disk", 900)]));
    let mut watch = Watch::new(
        test.places.clone(),
        Drives::with_reader(stand.reader(), Duration::from_secs(3)),
        vmix_stand(Arc::new(Mutex::new(None)), Arc::new(AtomicUsize::new(0))),
        board,
    );
    let db_path = test.db_path.clone();
    let pass = thread::spawn(move || {
        watch.pass(&db_path, true, SystemTime::now(), Instant::now());
        watch
    });
    began
        .recv_timeout(Duration::from_secs(5))
        .expect("the held read began");

    let asked = Instant::now();
    let report = board.report();
    let reply = handle_session_request(
        &test.db_path,
        &test.places,
        report.as_ref(),
        "session.snapshot",
        &json!({}),
        SystemTime::now(),
    )
    .expect("the read is answered");
    assert!(
        asked.elapsed() < Duration::from_secs(1),
        "{:?}",
        asked.elapsed()
    );
    assert_eq!(reply.result["drives"][0]["letter"], letter.to_string());
    assert_eq!(reply.result["readAt"], stamp(0), "the last report's");

    let _watch = pass.join().expect("the pass ends at its budget");
    let after = board.report().expect("a report");
    assert!(
        after.drive(held).is_some_and(|drive| !drive.answering()),
        "{held}: did not answer in time"
    );
    assert_eq!(after.not_answering(), BTreeSet::from([held]));
    stand.release();
}

#[test]
fn a_wake_ends_the_wait_and_is_taken_once() {
    let wake = Wake::new();
    let started = Instant::now();
    assert!(!wake.wait(Duration::from_millis(30)), "nobody woke it");
    assert!(started.elapsed() >= Duration::from_millis(30));
    wake.wake();
    let started = Instant::now();
    assert!(wake.wait(Duration::from_secs(5)), "woken");
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(
        !wake.wait(Duration::from_millis(10)),
        "a wake is taken once"
    );
}
