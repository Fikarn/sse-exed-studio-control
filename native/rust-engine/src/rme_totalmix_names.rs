//! TotalMix FX's own names for its eight snapshots (the owner's decision,
//! 2026-10-01: the Console's snapshots and channel names follow TotalMix).
//!
//! The Global OSC remote loads a snapshot (`/snapshot/load/N`) and says which
//! one is active, but it never says a snapshot's name. TotalMix keeps the
//! names in its own settings file, which it writes when it closes:
//! `%LOCALAPPDATA%\TotalMixFX\last.<Device>.xml`, the device's name without
//! its spaces and punctuation (`Fireface UFX III (1)` is
//! `last.FirefaceUFXIII1.xml`). A name is `<val e="SnapshotName K" v="…"/>`,
//! K 0 to 7 for slots 1 to 8. A rename in TotalMix reaches the file, and so
//! the app, the next time TotalMix closes. The app only reads the file; it
//! never writes there.
//!
//! The file as read on the studio PC (2026-10-01): it names no encoding (no
//! XML declaration, no byte-order mark), it holds two top-level elements
//! (`<FirefaceUFXIII1>`, then `<Frame0>`), and it is about 1.2 MB of plain
//! ASCII. It is read as UTF-8, else as Windows-1252, what a Windows program
//! writes when it says nothing of its encoding.
//!
//! Where the names come from (`names_source`): a studio build on the live
//! console reads TotalMix's file; a simulated console, in any build, gets the
//! fixture (`rme_totalmix_names/fixture.xml`), so a studio build on the
//! release's trial lane shows names too; a development build on the live
//! console (a hardware test) reads nothing, as it keeps off the studio's own
//! files.
//!
//! The names live in a process-wide cache. `totalmix_snapshot_names` hands out
//! a copy and never touches the disk (the metering thread asks for it).
//! `refresh_totalmix_snapshot_names` looks at the file and reads it again only
//! when its path, modified time or length changed since the last read: a
//! refresh that finds nothing new costs one look at the file's metadata.

use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

use crate::prompter::import::txt::windows_1252;
use crate::storage_backups::civil_from_days;

/// TotalMix's snapshot slots, `/snapshot/load/1` to `/snapshot/load/8`.
pub const SNAPSHOT_SLOTS: usize = 8;
/// The longest slot name kept, in characters, as for a channel's name.
const NAME_LIMIT: usize = 50;

const MEGABYTE: u64 = 1024 * 1024;
/// The largest settings file read. TotalMix's is about 1.2 MB with one
/// device; a file past this is not TotalMix's, or it is damaged.
const SETTINGS_FILE_LIMIT: u64 = 16 * MEGABYTE;
const SETTINGS_DIR_NAME: &str = "TotalMixFX";
const SETTINGS_FILE_PREFIX: &str = "last.";
const SETTINGS_FILE_SUFFIX: &str = ".xml";
/// A snapshot name's `e`, before its 0-based slot.
const SNAPSHOT_NAME_KEY: &str = "SnapshotName ";
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// What a simulated console shows, shaped like the head of TotalMix's file.
const FIXTURE: &str = include_str!("rme_totalmix_names/fixture.xml");

// The notes are the operator's: they reach the Console as they are.
// The notes stand on one line under the Console's eight slots: short.
const NOTE_NOT_READ_YET: &str = "TotalMix's names have not been read yet.";
const NOTE_DEVELOPMENT_RUN: &str = "A development run does not read TotalMix's names.";
const NOTE_NOT_SAVED: &str = "No names yet: TotalMix saves them when it closes.";
const NOTE_NO_NAMES: &str = "TotalMix's saved settings hold no names.";
const NOTE_UNREADABLE: &str = "TotalMix's names could not be read; the log says why.";

/// TotalMix's names for its snapshots, as the Console shows them.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TotalMixSnapshotNames {
    /// `names[i]` names slot `i + 1`; `None` when TotalMix gave it no name.
    pub names: [Option<String>; SNAPSHOT_SLOTS],
    /// When TotalMix saved the file the names were read from: its modified
    /// time, RFC 3339 in UTC to the second. `None` for the fixture, and when
    /// no file was read.
    pub saved_at: Option<String>,
    /// A sentence for the operator when there are no names to show; `None`
    /// when there are.
    pub note: Option<String>,
}

impl TotalMixSnapshotNames {
    fn noted(note: impl Into<String>) -> Self {
        Self {
            note: Some(note.into()),
            ..Self::default()
        }
    }
}

/// Where the names come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NamesSource {
    /// TotalMix's own settings file on this PC.
    TotalMixFile,
    /// The fixture compiled in.
    Fixture,
    /// No names at all.
    Nothing,
}

/// A simulated console gets the fixture, in any build; a studio build on the
/// live console reads TotalMix's file; a development build on the live
/// console reads nothing.
///
/// `studio_build` is `studio_control_protocol::development::studio_build()`.
/// `simulated_console` is whether the console's metering source is
/// `rme_totalmix_osc::SIMULATED_AUDIO_SOURCE` (`audio::audio_metering_is_simulated`
/// over the settings, or an `AudioSnapshot`'s `metering_source`).
pub fn names_source(studio_build: bool, simulated_console: bool) -> NamesSource {
    if simulated_console {
        NamesSource::Fixture
    } else if studio_build {
        NamesSource::TotalMixFile
    } else {
        NamesSource::Nothing
    }
}

/// The snapshots' names in a settings file's text: every `val` element whose
/// `e` is exactly `SnapshotName K`, K 0 to 7, and whose `v`, its entities
/// read, its control characters left out and its ends trimmed, still holds
/// something. Of several for one K the last wins; an empty one names nothing
/// and leaves the name before it. Everything else is passed over.
///
/// TotalMix's file is not one XML document (two top-level elements), and a
/// closing tag that does not match its opening one is no reason to stop. The
/// walk ends at the first error it cannot step over and keeps the names found
/// before it; a file that fails at once names nothing.
pub fn parse_snapshot_names(xml: &str) -> [Option<String>; SNAPSHOT_SLOTS] {
    let mut names: [Option<String>; SNAPSHOT_SLOTS] = Default::default();
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.check_end_names = false;
    config.allow_unmatched_ends = true;
    config.allow_dangling_amp = true;
    loop {
        match reader.read_event() {
            Ok(Event::Start(element) | Event::Empty(element)) => {
                if let Some((slot, name)) = snapshot_name(&element) {
                    names[slot] = Some(name);
                }
            }
            Ok(Event::Eof) | Err(_) => return names,
            Ok(_) => {}
        }
    }
}

/// A `val` element's slot and name, when it is a snapshot's name and names
/// something. A damaged attribute (no quotes) ends the search. A value whose
/// `&` names no entity (`Q&A`, should TotalMix ever write it so) is taken as
/// it is written rather than lost.
fn snapshot_name(element: &BytesStart<'_>) -> Option<(usize, String)> {
    if element.name().into_inner() != "val" {
        return None;
    }
    let mut key = None;
    let mut value = None;
    let mut attributes = element.attributes();
    attributes.with_checks(false);
    for attribute in attributes.map_while(Result::ok) {
        let text = || {
            attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .unwrap_or_else(|_| attribute.value.clone())
        };
        match attribute.key.into_inner() {
            "e" => key = Some(text()),
            "v" => value = Some(text()),
            _ => {}
        }
    }
    let slot = snapshot_slot(&key?)?;
    let name: String = value?
        .chars()
        .filter(|character| !character.is_control())
        .collect();
    // Capped as a channel's name is (50 characters): a long or damaged name
    // would run through every Console read, the key and Recent actions.
    let name: String = name.trim().chars().take(NAME_LIMIT).collect();
    let name = name.trim_end();
    (!name.is_empty()).then(|| (slot, name.to_string()))
}

/// The 0-based slot an `e` names: `SnapshotName 0` to `SnapshotName 7`, as
/// TotalMix writes them and nothing near them (`SnapshotName 07`, `+7`).
fn snapshot_slot(key: &str) -> Option<usize> {
    let digits = key.strip_prefix(SNAPSHOT_NAME_KEY)?;
    let slot: usize = digits.parse().ok()?;
    (slot < SNAPSHOT_SLOTS && digits == slot.to_string()).then_some(slot)
}

/// A settings file's bytes as text. TotalMix names no encoding, so the bytes
/// decide, by the prompter's `.txt` rule (`prompter::import::txt`): after a
/// UTF-8 byte-order mark the file is UTF-8, a damaged byte showing as U+FFFD;
/// else valid UTF-8 is UTF-8 (plain ASCII is both); else it is Windows-1252.
pub fn decode_settings_bytes(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(UTF8_BOM) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => windows_1252(bytes),
    }
}

/// TotalMix's settings file in `dir`: `last.<stem>.xml` for the device's
/// name when that file is there; else the one `last.*.xml` in the folder;
/// else `None` (no such file, or several and no way to tell which). The
/// refresh takes the metadata with it (`locate_settings_file`); tests ask this.
#[cfg(test)]
pub fn find_totalmix_settings_file(dir: &Path, device: Option<&str>) -> Option<PathBuf> {
    locate_settings_file(dir, device).map(|(path, _)| path)
}

/// `find_totalmix_settings_file`, with the file's metadata from the same
/// look: when the device's own file is there, that is one metadata call.
fn locate_settings_file(dir: &Path, device: Option<&str>) -> Option<(PathBuf, Metadata)> {
    if let Some(stem) = device
        .map(settings_file_stem)
        .filter(|stem| !stem.is_empty())
    {
        let named = dir.join(format!(
            "{SETTINGS_FILE_PREFIX}{stem}{SETTINGS_FILE_SUFFIX}"
        ));
        if let Some(metadata) = file_metadata(&named) {
            return Some((named, metadata));
        }
    }
    let mut found = fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(is_settings_file_name)
        })
        .filter_map(|entry| {
            let path = entry.path();
            file_metadata(&path).map(|metadata| (path, metadata))
        });
    let only = found.next()?;
    found.next().is_none().then_some(only)
}

/// A file's metadata; `None` for a folder or nothing there.
fn file_metadata(path: &Path) -> Option<Metadata> {
    fs::metadata(path).ok().filter(Metadata::is_file)
}

/// The middle of a device's file name: its name with only the letters and
/// digits left, `Fireface UFX III (1)` → `FirefaceUFXIII1`. Nothing else
/// stays, so the name can never reach outside the folder.
fn settings_file_stem(device: &str) -> String {
    device.chars().filter(char::is_ascii_alphanumeric).collect()
}

/// `last.<something>.xml`, in any case: Windows' file names ignore it.
fn is_settings_file_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.len() > SETTINGS_FILE_PREFIX.len() + SETTINGS_FILE_SUFFIX.len()
        && name.starts_with(SETTINGS_FILE_PREFIX)
        && name.ends_with(SETTINGS_FILE_SUFFIX)
}

/// `%LOCALAPPDATA%\TotalMixFX`, where TotalMix keeps its settings; `None`
/// when the variable is unset. Only `NamesSource::TotalMixFile` looks there.
pub fn totalmix_settings_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .filter(|base| !base.is_empty())
        .map(|base| PathBuf::from(base).join(SETTINGS_DIR_NAME))
}

/// The file the names were last read from, as it was then.
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileStamp {
    path: PathBuf,
    modified: Option<SystemTime>,
    len: u64,
}

impl FileStamp {
    fn of(path: PathBuf, metadata: &Metadata) -> Self {
        Self {
            path,
            modified: metadata.modified().ok(),
            len: metadata.len(),
        }
    }
}

/// What the cache holds: the names handed out, and the file they were read
/// from (`None` when they did not come from a file read in full).
#[derive(Debug, Clone, PartialEq)]
struct NamesCache {
    names: TotalMixSnapshotNames,
    read: Option<FileStamp>,
}

impl Default for NamesCache {
    fn default() -> Self {
        Self::without_file(TotalMixSnapshotNames::noted(NOTE_NOT_READ_YET))
    }
}

impl NamesCache {
    fn without_file(names: TotalMixSnapshotNames) -> Self {
        Self { names, read: None }
    }
}

fn names_cache() -> &'static Mutex<NamesCache> {
    static CACHE: OnceLock<Mutex<NamesCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(NamesCache::default()))
}

/// The cache is only ever given whole values, so one a panicking thread left
/// behind is still sound.
fn lock(cache: &Mutex<NamesCache>) -> MutexGuard<'_, NamesCache> {
    cache.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Tests that drive the process-wide cache hold this, so they do not see each
/// other's names.
#[cfg(test)]
pub(crate) static NAMES_CACHE_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
thread_local! {
    /// Settings files opened on this thread: how the tests see a read.
    static FILE_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// The names as last worked out, copied from the cache. It never touches the
/// disk, so the metering thread may ask as often as it likes.
pub fn totalmix_snapshot_names() -> TotalMixSnapshotNames {
    lock(names_cache()).names.clone()
}

/// Works the names out again from `source`. For `NamesSource::TotalMixFile`
/// it finds TotalMix's file for `device` (the name TotalMix gives on
/// `/status/device`, once it has) and reads it only when its path, modified
/// time or length changed since the last read. When nothing changed, that is
/// one look at the file's metadata; a read, about 1.2 MB, takes a few
/// milliseconds.
pub fn refresh_totalmix_snapshot_names(source: NamesSource, device: Option<&str>) {
    let dir = match source {
        NamesSource::TotalMixFile => totalmix_settings_dir(),
        NamesSource::Fixture | NamesSource::Nothing => None,
    };
    refresh_cache(
        names_cache(),
        source,
        dir.as_deref(),
        device,
        SETTINGS_FILE_LIMIT,
    );
}

/// The refresh, over any cache and folder: the tests use their own. The file
/// is looked at and read outside the lock, so `totalmix_snapshot_names` never
/// waits on the disk.
fn refresh_cache(
    cache: &Mutex<NamesCache>,
    source: NamesSource,
    dir: Option<&Path>,
    device: Option<&str>,
    limit: u64,
) {
    let last_read = lock(cache).read.clone();
    if let Some(fresh) = refreshed(source, dir, device, last_read.as_ref(), limit) {
        *lock(cache) = fresh;
    }
}

/// What a refresh puts in the cache; `None` when TotalMix's file is the one
/// last read, unchanged.
fn refreshed(
    source: NamesSource,
    dir: Option<&Path>,
    device: Option<&str>,
    last_read: Option<&FileStamp>,
    limit: u64,
) -> Option<NamesCache> {
    match source {
        NamesSource::Fixture => Some(NamesCache::without_file(fixture_names())),
        NamesSource::Nothing => Some(NamesCache::without_file(TotalMixSnapshotNames::noted(
            NOTE_DEVELOPMENT_RUN,
        ))),
        NamesSource::TotalMixFile => {
            let Some((path, metadata)) = dir.and_then(|dir| locate_settings_file(dir, device))
            else {
                return Some(NamesCache::without_file(TotalMixSnapshotNames::noted(
                    NOTE_NOT_SAVED,
                )));
            };
            let stamp = FileStamp::of(path, &metadata);
            if last_read == Some(&stamp) {
                return None;
            }
            Some(read_names(stamp, limit))
        }
    }
}

fn fixture_names() -> TotalMixSnapshotNames {
    TotalMixSnapshotNames {
        names: parse_snapshot_names(FIXTURE),
        saved_at: None,
        note: None,
    }
}

/// The names in the file `stamp` describes. A file that cannot be read gives
/// its reason and keeps no stamp, so the next refresh tries again.
fn read_names(stamp: FileStamp, limit: u64) -> NamesCache {
    match read_settings_file(&stamp.path, stamp.len, limit) {
        Ok(bytes) => {
            let names = parse_snapshot_names(&decode_settings_bytes(&bytes));
            let note = names
                .iter()
                .all(Option::is_none)
                .then(|| NOTE_NO_NAMES.to_string());
            NamesCache {
                names: TotalMixSnapshotNames {
                    names,
                    saved_at: stamp.modified.map(utc_seconds_text),
                    note,
                },
                read: Some(stamp),
            }
        }
        Err(reason) => {
            crate::diagnostics::log_event(
                crate::diagnostics::LogLevel::Warn,
                &format!("TotalMix's saved names could not be read: {reason}."),
            );
            NamesCache::without_file(TotalMixSnapshotNames::noted(NOTE_UNREADABLE))
        }
    }
}

/// The file's bytes, refused past `limit`: by the length its metadata gave
/// before it is opened, and again as it is read, in case it grew in between.
fn read_settings_file(path: &Path, len: u64, limit: u64) -> Result<Vec<u8>, String> {
    let too_large = || format!("the file is larger than {} MB", limit.div_ceil(MEGABYTE));
    if len > limit {
        return Err(too_large());
    }
    #[cfg(test)]
    FILE_READS.with(|reads| reads.set(reads.get() + 1));
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(limit.saturating_add(1)).read_to_end(&mut bytes))
        .map_err(|error| io_reason(&error))?;
    if bytes.len() as u64 > limit {
        return Err(too_large());
    }
    Ok(bytes)
}

/// The error's own words without a closing full stop: the note adds one.
fn io_reason(error: &io::Error) -> String {
    error
        .to_string()
        .trim_end()
        .trim_end_matches('.')
        .to_string()
}

/// UTC to the second, `2026-09-21T08:17:36Z`: the shape the Console's other
/// times take (`audio::helpers::current_timestamp`).
fn utc_seconds_text(time: SystemTime) -> String {
    let total_seconds = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_from_days((total_seconds / 86_400) as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60
    )
}

#[cfg(test)]
mod tests;
