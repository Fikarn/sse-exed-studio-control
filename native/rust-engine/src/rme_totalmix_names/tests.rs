//! The tests of TotalMix's snapshot names: the parse, the bytes' encoding,
//! finding the file, and the cache's refresh. The refresh over a file runs in
//! a folder of the test's own, through `refresh_cache`: no test looks in
//! TotalMix's real folder.

use super::*;
use crate::operator_words::assert_operator_words;
use std::cell::Cell;
use std::process;
use std::time::Duration;

/// A modified time the tests give their files: 2020-09-13T12:26:40Z.
const SAVED_SECONDS: u64 = 1_600_000_000;
const SAVED_TEXT: &str = "2020-09-13T12:26:40Z";
const DEVICE: &str = "Fireface UFX III (1)";
const DEVICE_FILE: &str = "last.FirefaceUFXIII1.xml";

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
            "studio-control-engine-totalmix-names-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test dir should be created");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn write(&self, name: &str, bytes: impl AsRef<[u8]>) -> PathBuf {
        let path = self.path.join(name);
        fs::write(&path, bytes).expect("test file should be written");
        path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

fn set_modified(path: &Path, time: SystemTime) {
    File::options()
        .write(true)
        .open(path)
        .expect("test file should open")
        .set_modified(time)
        .expect("modified time should be set");
}

fn file_reads() -> usize {
    FILE_READS.with(Cell::get)
}

/// Names for the slots given, 0-based, the rest `None`.
fn names(slots: &[(usize, &str)]) -> [Option<String>; SNAPSHOT_SLOTS] {
    let mut names: [Option<String>; SNAPSHOT_SLOTS] = Default::default();
    for (slot, name) in slots {
        names[*slot] = Some((*name).to_string());
    }
    names
}

fn val(key: &str, value: &str) -> String {
    format!("\t\t\t<val e=\"{key}\" v=\"{value}\"/>\n")
}

/// A settings file shaped like TotalMix's, its `General` holding `vals`.
fn settings_file(vals: &str) -> String {
    format!(
        "\t<FirefaceUFXIII1>\n\t\t<General>\n{}{vals}\t\t</General>\n\t</FirefaceUFXIII1>\n\t<Frame0>\n\t</Frame0>\n",
        val("Version", "1200")
    )
}

fn refresh_file(cache: &Mutex<NamesCache>, dir: &Path, device: Option<&str>) -> NamesCache {
    refresh_cache(
        cache,
        NamesSource::TotalMixFile,
        Some(dir),
        device,
        SETTINGS_FILE_LIMIT,
    );
    lock(cache).clone()
}

#[test]
fn the_fixture_names_three_slots_and_skips_the_empty_one() {
    let expected = names(&[(0, "Mix 1"), (1, "Interview"), (2, "Panel & Q&A")]);
    assert_eq!(parse_snapshot_names(FIXTURE), expected);
    assert_eq!(
        parse_snapshot_names(&decode_settings_bytes(FIXTURE.as_bytes())),
        expected
    );
    assert_eq!(fixture_names().names, expected);
    assert_eq!(fixture_names().saved_at, None);
    assert_eq!(fixture_names().note, None);
}

#[test]
fn entities_named_and_numbered_are_read() {
    let file = settings_file(&val(
        "SnapshotName 4",
        "&amp; &lt; &gt; &quot; &apos; &#228; &#xE4;",
    ));
    assert_eq!(parse_snapshot_names(&file), names(&[(4, "& < > \" ' ä ä")]));
}

#[test]
fn the_last_name_for_a_slot_wins_and_an_empty_one_does_not_clear_it() {
    let file = settings_file(
        &[
            val("SnapshotName 1", "First"),
            val("SnapshotName 2", "Kept"),
            val("SnapshotName 1", "Second"),
            val("SnapshotName 2", ""),
        ]
        .concat(),
    );
    assert_eq!(
        parse_snapshot_names(&file),
        names(&[(1, "Second"), (2, "Kept")])
    );
}

#[test]
fn layout_names_and_other_values_are_passed_over() {
    let file = settings_file(
        &[
            val("LayoutName 0", "Layout 1"),
            val("LayoutName 7", "Layout 8"),
            val("SnapshotName 8", "Ninth"),
            val("SnapshotName 07", "Padded"),
            val("SnapshotName +1", "Signed"),
            val("SnapshotName -1", "Negative"),
            val(" SnapshotName 2", "Spaced"),
            val("SnapshotName 3 ", "Trailing"),
            val("snapshotname 4", "Lower case"),
            val("SnapshotName", "No slot"),
            val("Name 00", "A channel"),
            String::from("\t\t\t<other e=\"SnapshotName 5\" v=\"Not a val\"/>\n"),
            String::from("\t\t\t<val e=\"SnapshotName 6\"/>\n"),
            String::from("\t\t\t<val v=\"No key\"/>\n"),
        ]
        .concat(),
    );
    assert_eq!(parse_snapshot_names(&file), names(&[]));
}

#[test]
fn a_name_of_white_space_only_names_nothing_and_a_name_is_trimmed() {
    let file = settings_file(
        &[
            val("SnapshotName 0", "   "),
            val("SnapshotName 1", " \t "),
            val("SnapshotName 2", "&#32;&#9;&#10;"),
            val("SnapshotName 3", "&#1;"),
            val("SnapshotName 4", "  Mix 5  "),
            val("SnapshotName 5", "Two\twords"),
        ]
        .concat(),
    );
    assert_eq!(
        parse_snapshot_names(&file),
        names(&[(4, "Mix 5"), (5, "Two words")])
    );
}

// A slot's name is capped as a channel's is, 50 characters, and a cut never
// leaves a space at its end.
#[test]
fn a_long_name_is_cut_to_fifty_characters() {
    let long = "ä".repeat(49) + " and more";
    let file = settings_file(&val("SnapshotName 2", &long));
    let parsed = parse_snapshot_names(&file);
    let name = parsed[2].as_deref().expect("a name");
    assert_eq!(
        name,
        "ä".repeat(49),
        "cut at 50 characters, the space dropped"
    );
    assert_eq!(name.chars().count(), 49);
}

#[test]
fn windows_1252_bytes_are_read_as_windows_1252() {
    let mut bytes = b"\t<FirefaceUFXIII1>\n\t\t<General>\n".to_vec();
    bytes.extend_from_slice(b"\t\t\t<val e=\"SnapshotName 0\" v=\"K\xE4llare\"/>\n");
    bytes.extend_from_slice(b"\t\t\t<val e=\"SnapshotName 1\" v=\"\x80 Live\"/>\n");
    bytes.extend_from_slice(b"\t\t</General>\n\t</FirefaceUFXIII1>\n");

    let text = decode_settings_bytes(&bytes);
    assert_eq!(
        parse_snapshot_names(&text),
        names(&[(0, "Källare"), (1, "€ Live")])
    );
    // Valid UTF-8 stays UTF-8.
    let utf8 = settings_file(&val("SnapshotName 0", "Källare"));
    assert_eq!(decode_settings_bytes(utf8.as_bytes()), utf8);
}

#[test]
fn a_byte_order_mark_is_dropped() {
    let file = settings_file(&val("SnapshotName 0", "Möte"));
    let mut bytes = UTF8_BOM.to_vec();
    bytes.extend_from_slice(file.as_bytes());

    let text = decode_settings_bytes(&bytes);
    assert_eq!(text, file);
    assert_eq!(parse_snapshot_names(&text), names(&[(0, "Möte")]));
}

#[test]
fn a_damaged_file_keeps_the_names_found_before_the_damage() {
    // Cut off in the middle of a value, as by a write that never finished.
    let truncated = format!(
        "\t<FirefaceUFXIII1>\n\t\t<General>\n{}\t\t\t<val e=\"SnapshotName 1\" v=\"Mi",
        val("SnapshotName 0", "Mix 1")
    );
    assert_eq!(parse_snapshot_names(&truncated), names(&[(0, "Mix 1")]));

    // Markup that is no markup ends the walk: what comes after is not read.
    let broken = settings_file(
        &[
            val("SnapshotName 0", "Before"),
            String::from("\t\t\t<!WRONG>\n"),
            val("SnapshotName 2", "After"),
        ]
        .concat(),
    );
    assert_eq!(parse_snapshot_names(&broken), names(&[(0, "Before")]));

    // Closing tags that do not match are stepped over.
    let mismatched = format!(
        "<General>\n{}</Other>\n</Third>\n{}",
        val("SnapshotName 0", "Mix 1"),
        val("SnapshotName 1", "Mix 2")
    );
    assert_eq!(
        parse_snapshot_names(&mismatched),
        names(&[(0, "Mix 1"), (1, "Mix 2")])
    );

    // A damaged attribute costs that name only. An `&` that names no entity
    // is taken as it is written.
    let damaged = settings_file(
        &[
            String::from("\t\t\t<val e=\"SnapshotName 0\" v=Unquoted/>\n"),
            val("SnapshotName 1", "Q&A"),
            val("SnapshotName 2", "&nbsp;Unknown"),
            val("SnapshotName 3", "Mix 4"),
        ]
        .concat(),
    );
    assert_eq!(
        parse_snapshot_names(&damaged),
        names(&[(1, "Q&A"), (2, "&nbsp;Unknown"), (3, "Mix 4")])
    );
}

#[test]
fn a_file_that_is_no_xml_at_all_names_nothing() {
    assert_eq!(parse_snapshot_names(""), names(&[]));
    assert_eq!(parse_snapshot_names("<<<< not XML >>>>"), names(&[]));
    assert_eq!(
        parse_snapshot_names(&decode_settings_bytes(&[0xFF, 0xFE, 0x00, 0x01, 0x80])),
        names(&[])
    );
}

#[test]
fn a_device_name_becomes_the_file_name_totalmix_gives_it() {
    assert_eq!(settings_file_stem(DEVICE), "FirefaceUFXIII1");
    assert_eq!(settings_file_stem("UFX III"), "UFXIII");
    assert_eq!(settings_file_stem("..\\..\\x/y"), "xy");
    assert!(is_settings_file_name(DEVICE_FILE));
    assert!(is_settings_file_name("LAST.Other.XML"));
    assert!(!is_settings_file_name("last..xml"));
    assert!(!is_settings_file_name("rme.totalmix.preferences.xml"));
    assert!(!is_settings_file_name("last.FirefaceUFXIII1.xml.bak"));
}

#[test]
fn the_device_names_its_own_file_among_several() {
    let dir = TestDir::new("device-file");
    let own = dir.write(DEVICE_FILE, settings_file(""));
    dir.write("last.Fireface8022.xml", settings_file(""));
    dir.write("rme.totalmix.preferences.xml", "");

    assert_eq!(
        find_totalmix_settings_file(dir.path(), Some(DEVICE)),
        Some(own)
    );
    // Two files and no device, or a device without its own file: no way to
    // tell which.
    assert_eq!(find_totalmix_settings_file(dir.path(), None), None);
    assert_eq!(
        find_totalmix_settings_file(dir.path(), Some("UFX III")),
        None
    );
    assert_eq!(find_totalmix_settings_file(dir.path(), Some("()")), None);
}

#[test]
fn the_only_settings_file_is_taken_when_the_device_names_none() {
    let dir = TestDir::new("only-file");
    let only = dir.write(DEVICE_FILE, settings_file(""));
    dir.write("rme.totalmix.preferences.xml", "");
    dir.write("rme.totalmix.recent.xml", "");
    // A folder with a settings file's name is not a settings file.
    fs::create_dir_all(dir.path().join("last.Folder.xml")).expect("folder should be created");

    assert_eq!(
        find_totalmix_settings_file(dir.path(), None),
        Some(only.clone())
    );
    assert_eq!(
        find_totalmix_settings_file(dir.path(), Some("UFX III")),
        Some(only)
    );
}

#[test]
fn no_settings_file_is_found_where_there_is_none() {
    let dir = TestDir::new("no-file");
    assert_eq!(find_totalmix_settings_file(dir.path(), Some(DEVICE)), None);
    dir.write("rme.totalmix.preferences.xml", "");
    assert_eq!(find_totalmix_settings_file(dir.path(), None), None);
    assert_eq!(
        find_totalmix_settings_file(&dir.path().join("missing"), Some(DEVICE)),
        None
    );
}

#[test]
fn without_a_file_the_note_says_totalmix_saves_its_names_when_it_closes() {
    let dir = TestDir::new("refresh-no-file");
    let cache = Mutex::new(NamesCache::default());

    let refreshed = refresh_file(&cache, dir.path(), Some(DEVICE));
    assert_eq!(
        refreshed.names,
        TotalMixSnapshotNames::noted(NOTE_NOT_SAVED)
    );
    assert_eq!(refreshed.read, None);

    // No folder at all reads the same.
    refresh_cache(
        &cache,
        NamesSource::TotalMixFile,
        None,
        Some(DEVICE),
        SETTINGS_FILE_LIMIT,
    );
    assert_eq!(
        lock(&cache).names,
        TotalMixSnapshotNames::noted(NOTE_NOT_SAVED)
    );
}

#[test]
fn a_file_gives_its_names_and_when_totalmix_saved_it() {
    let dir = TestDir::new("refresh-file");
    let path = dir.write(
        DEVICE_FILE,
        settings_file(
            &[
                val("SnapshotName 0", "Mix 1"),
                val("SnapshotName 7", "Mix 8"),
            ]
            .concat(),
        ),
    );
    set_modified(&path, at(SAVED_SECONDS));
    let cache = Mutex::new(NamesCache::default());

    let refreshed = refresh_file(&cache, dir.path(), Some(DEVICE));
    assert_eq!(
        refreshed.names,
        TotalMixSnapshotNames {
            names: names(&[(0, "Mix 1"), (7, "Mix 8")]),
            saved_at: Some(String::from(SAVED_TEXT)),
            note: None,
        }
    );
    assert_eq!(
        refreshed.read.map(|stamp| stamp.path),
        Some(path),
        "the stamp names the file read"
    );
}

#[test]
fn a_file_without_names_says_so() {
    let dir = TestDir::new("refresh-no-names");
    let path = dir.write(DEVICE_FILE, settings_file(&val("LayoutName 0", "Layout 1")));
    set_modified(&path, at(SAVED_SECONDS));
    let cache = Mutex::new(NamesCache::default());

    let refreshed = refresh_file(&cache, dir.path(), None);
    assert_eq!(refreshed.names.names, names(&[]));
    assert_eq!(refreshed.names.saved_at.as_deref(), Some(SAVED_TEXT));
    assert_eq!(refreshed.names.note.as_deref(), Some(NOTE_NO_NAMES));
}

#[test]
fn an_unchanged_file_is_not_read_again_and_a_changed_one_is() {
    let dir = TestDir::new("refresh-unchanged");
    let path = dir.write(DEVICE_FILE, settings_file(&val("SnapshotName 0", "Mix 1")));
    set_modified(&path, at(SAVED_SECONDS));
    let cache = Mutex::new(NamesCache::default());
    let reads = file_reads();

    let first = refresh_file(&cache, dir.path(), Some(DEVICE));
    assert_eq!(first.names.names, names(&[(0, "Mix 1")]));
    assert_eq!(file_reads(), reads + 1);

    // Nothing changed: no read.
    assert_eq!(refresh_file(&cache, dir.path(), Some(DEVICE)), first);
    assert_eq!(file_reads(), reads + 1);

    // New bytes of the same length under the same modified time are not
    // seen: the proof that the file was not read again.
    fs::write(&path, settings_file(&val("SnapshotName 0", "Mix 9"))).expect("rewrite");
    set_modified(&path, at(SAVED_SECONDS));
    assert_eq!(refresh_file(&cache, dir.path(), Some(DEVICE)), first);
    assert_eq!(file_reads(), reads + 1);

    // A new modified time: read again.
    set_modified(&path, at(SAVED_SECONDS + 60));
    let second = refresh_file(&cache, dir.path(), Some(DEVICE));
    assert_eq!(second.names.names, names(&[(0, "Mix 9")]));
    assert_eq!(
        second.names.saved_at.as_deref(),
        Some("2020-09-13T12:27:40Z")
    );
    assert_eq!(file_reads(), reads + 2);

    // A new length under the same modified time: read again.
    fs::write(&path, settings_file(&val("SnapshotName 0", "Interview"))).expect("rewrite");
    set_modified(&path, at(SAVED_SECONDS + 60));
    let third = refresh_file(&cache, dir.path(), Some(DEVICE));
    assert_eq!(third.names.names, names(&[(0, "Interview")]));
    assert_eq!(file_reads(), reads + 3);
}

#[test]
fn another_file_or_another_source_in_between_means_a_new_read() {
    let dir = TestDir::new("refresh-switch");
    let path = dir.write(DEVICE_FILE, settings_file(&val("SnapshotName 0", "Mix 1")));
    set_modified(&path, at(SAVED_SECONDS));
    let cache = Mutex::new(NamesCache::default());
    let reads = file_reads();

    refresh_file(&cache, dir.path(), Some(DEVICE));
    assert_eq!(file_reads(), reads + 1);

    // The fixture in between forgets the file: the same file is read again.
    refresh_cache(
        &cache,
        NamesSource::Fixture,
        None,
        None,
        SETTINGS_FILE_LIMIT,
    );
    assert_eq!(lock(&cache).names, fixture_names());
    let again = refresh_file(&cache, dir.path(), Some(DEVICE));
    assert_eq!(again.names.names, names(&[(0, "Mix 1")]));
    assert_eq!(file_reads(), reads + 2);

    // The device's own file appearing beside it is another path: read.
    let own = dir.write(
        "last.Fireface8022.xml",
        settings_file(&val("SnapshotName 0", "Other desk")),
    );
    let other = refresh_file(&cache, dir.path(), Some("Fireface 802 (2)"));
    assert_eq!(other.names.names, names(&[(0, "Other desk")]));
    assert_eq!(other.read.map(|stamp| stamp.path), Some(own));
    assert_eq!(file_reads(), reads + 3);
}

#[test]
fn a_file_past_the_limit_is_refused_unopened() {
    let dir = TestDir::new("refresh-too-large");
    let file = settings_file(&val("SnapshotName 0", "Mix 1"));
    let path = dir.write(DEVICE_FILE, &file);
    set_modified(&path, at(SAVED_SECONDS));
    let cache = Mutex::new(NamesCache::default());
    let reads = file_reads();
    let limit = file.len() as u64 - 1;

    refresh_cache(
        &cache,
        NamesSource::TotalMixFile,
        Some(dir.path()),
        Some(DEVICE),
        limit,
    );
    let refused = lock(&cache).clone();
    assert_eq!(refused.names.names, names(&[]));
    assert_eq!(refused.names.saved_at, None);
    assert_eq!(refused.names.note.as_deref(), Some(NOTE_UNREADABLE));
    assert_eq!(refused.read, None);
    assert_eq!(file_reads(), reads, "a file past the limit is not opened");

    // The reading itself stops at the limit too, for a file that grew after
    // its length was taken.
    assert_eq!(
        read_settings_file(&path, 0, limit),
        Err(String::from("the file is larger than 1 MB"))
    );
    assert_eq!(file_reads(), reads + 1);

    // The 16 MB limit itself, in its words.
    assert_eq!(
        read_settings_file(&path, SETTINGS_FILE_LIMIT + 1, SETTINGS_FILE_LIMIT),
        Err(String::from("the file is larger than 16 MB"))
    );
}

#[test]
fn a_file_that_cannot_be_read_gives_the_reason_and_is_tried_again() {
    let dir = TestDir::new("refresh-unreadable");
    let stamp = FileStamp {
        path: dir.path().join(DEVICE_FILE),
        modified: Some(at(SAVED_SECONDS)),
        len: 10,
    };

    let failed = read_names(stamp, SETTINGS_FILE_LIMIT);
    let note = failed.names.note.clone().expect("a note");
    assert!(note == NOTE_UNREADABLE, "{note}");
    assert!(!note.ends_with(".."), "{note}");
    assert_eq!(failed.names.names, names(&[]));
    assert_eq!(failed.names.saved_at, None);
    assert_eq!(
        failed.read, None,
        "no stamp, so the next refresh tries again"
    );
}

#[test]
fn a_development_run_and_the_simulated_console_through_the_shared_cache() {
    let _guard = NAMES_CACHE_TEST_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);

    refresh_totalmix_snapshot_names(NamesSource::Fixture, Some(DEVICE));
    let fixture = totalmix_snapshot_names();
    assert_eq!(
        fixture.names,
        names(&[(0, "Mix 1"), (1, "Interview"), (2, "Panel & Q&A")])
    );
    assert_eq!(fixture.saved_at, None);
    assert_eq!(fixture.note, None);

    refresh_totalmix_snapshot_names(NamesSource::Nothing, Some(DEVICE));
    let nothing = totalmix_snapshot_names();
    assert_eq!(nothing.names, names(&[]));
    assert_eq!(nothing.saved_at, None);
    assert_eq!(nothing.note.as_deref(), Some(NOTE_DEVELOPMENT_RUN));
}

#[test]
fn the_names_come_from_where_the_build_and_the_console_say() {
    assert_eq!(names_source(true, true), NamesSource::Fixture);
    assert_eq!(names_source(false, true), NamesSource::Fixture);
    assert_eq!(names_source(true, false), NamesSource::TotalMixFile);
    assert_eq!(names_source(false, false), NamesSource::Nothing);
}

#[test]
fn before_any_refresh_the_note_says_the_names_are_not_read_yet() {
    let cache = NamesCache::default();
    assert_eq!(cache.names.names, names(&[]));
    assert_eq!(cache.names.note.as_deref(), Some(NOTE_NOT_READ_YET));
    assert_eq!(cache.read, None);
}

#[test]
fn the_notes_say_no_developer_word() {
    for note in [
        NOTE_NOT_READ_YET,
        NOTE_DEVELOPMENT_RUN,
        NOTE_NOT_SAVED,
        NOTE_NO_NAMES,
        NOTE_UNREADABLE,
    ] {
        assert_operator_words(note);
    }
    let dir = TestDir::new("notes");
    let failed = read_names(
        FileStamp {
            path: dir.path().join(DEVICE_FILE),
            modified: None,
            len: 0,
        },
        SETTINGS_FILE_LIMIT,
    );
    assert_operator_words(&failed.names.note.expect("a note"));
    assert_operator_words("the file is larger than 16 MB");
}

#[test]
fn times_are_utc_to_the_second() {
    assert_eq!(utc_seconds_text(at(SAVED_SECONDS)), SAVED_TEXT);
    assert_eq!(utc_seconds_text(UNIX_EPOCH), "1970-01-01T00:00:00Z");
    assert_eq!(
        utc_seconds_text(at(SAVED_SECONDS) + Duration::from_millis(999)),
        SAVED_TEXT
    );
}

#[test]
fn the_settings_folder_is_totalmix_s_own_under_local_app_data() {
    // Only the path is worked out; nothing is looked at there.
    if let Some(dir) = totalmix_settings_dir() {
        assert!(dir.ends_with(SETTINGS_DIR_NAME), "{}", dir.display());
    }
}
