//! The engine log (2026-09 production readiness, Slice 8 — findings F11,
//! F16, F27).
//!
//! One process-wide writer keeps `<logs>/engine.log` open and rotates it at
//! [`LOG_ROTATE_BYTES`] into `engine.log.1` … `engine.log.5`; every thread
//! logs through it — `log_event`, or `append_log` with the engine's own log
//! path, which the older call sites still use. A line below the level
//! `SSE_ENGINE_LOG_LEVEL` names (default `INFO`) is dropped, which is what
//! keeps the per-request `DEBUG` line off in production. `read_log_tail`
//! reads the last bytes of the current file only, so a `health.snapshot`
//! costs the same whether the log is empty or 100 MB.
//!
//! Before `init_log` runs (the failures before the runtime paths resolve) and
//! in unit tests, `log_event` falls back to stderr, which the shell keeps in
//! `shell.log`. A path other than the writer's is opened and appended per
//! call as it always was, so the tests that read their own temp log keep
//! working without a writer.

use crate::storage::EngineResult;
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// `engine.log` rotates once a line would take it past this size.
pub const LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;
/// How many rotated files are kept; `engine.log.1` is the newest.
pub const LOG_ROTATE_KEEP: usize = 5;
/// How far back from the end of the file `read_log_tail` reads at most.
pub const LOG_TAIL_MAX_BYTES: u64 = 64 * 1024;
/// The environment variable that sets the level; `INFO` when unset.
pub const LOG_LEVEL_ENV: &str = "SSE_ENGINE_LOG_LEVEL";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }

    /// A level as the environment variable or a call site spells it.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_uppercase().as_str() {
            "DEBUG" => Some(Self::Debug),
            "INFO" => Some(Self::Info),
            "WARN" | "WARNING" => Some(Self::Warn),
            "ERROR" => Some(Self::Error),
            _ => None,
        }
    }

    /// The configured level from the environment value: `INFO` when unset or
    /// empty; an unknown name also gives `INFO`, with the sentence to log.
    pub fn from_env_value(value: Option<&str>) -> (Self, Option<String>) {
        match value.map(str::trim).filter(|value| !value.is_empty()) {
            None => (Self::Info, None),
            Some(value) => match Self::parse(value) {
                Some(level) => (level, None),
                None => (
                    Self::Info,
                    Some(format!(
                        "{LOG_LEVEL_ENV}={value:?} is not a log level (DEBUG, INFO, WARN or ERROR); logging at INFO"
                    )),
                ),
            },
        }
    }

    pub fn from_env() -> (Self, Option<String>) {
        Self::from_env_value(std::env::var(LOG_LEVEL_ENV).ok().as_deref())
    }
}

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// `[<unix seconds>] LEVEL message\n` — the shape the log has always had.
fn format_line(level: LogLevel, message: &str) -> String {
    format!("[{}] {} {}\n", unix_now_secs(), level.as_str(), message)
}

/// `engine.log.<index>` beside `engine.log`.
fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

/// One open log file with size-based rotation.
pub struct LogWriter {
    path: PathBuf,
    level: LogLevel,
    rotate_bytes: u64,
    keep: usize,
    file: Option<File>,
    size: u64,
}

impl LogWriter {
    pub fn new(path: &Path, level: LogLevel) -> Self {
        Self::with_rotation(path, level, LOG_ROTATE_BYTES, LOG_ROTATE_KEEP)
    }

    pub fn with_rotation(path: &Path, level: LogLevel, rotate_bytes: u64, keep: usize) -> Self {
        Self {
            path: path.to_path_buf(),
            level,
            rotate_bytes,
            keep: keep.max(1),
            file: None,
            size: 0,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn level(&self) -> LogLevel {
        self.level
    }

    /// Writes one line unless `level` is below the configured level. The
    /// file rotates first when the line would take it past the limit.
    pub fn write(&mut self, level: LogLevel, message: &str) -> io::Result<()> {
        if level < self.level {
            return Ok(());
        }
        let line = format_line(level, message);
        if self.size > 0 && self.size + line.len() as u64 > self.rotate_bytes {
            self.rotate();
        }
        let file = self.open()?;
        file.write_all(line.as_bytes())?;
        file.flush()?;
        self.size += line.len() as u64;
        Ok(())
    }

    fn open(&mut self) -> io::Result<&mut File> {
        if self.file.is_none() {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent)?;
            }
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)?;
            self.size = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            self.file = Some(file);
        }
        Ok(self.file.as_mut().expect("the file was opened above"))
    }

    /// `engine.log` becomes `.1`, `.1` becomes `.2`, and so on; the oldest
    /// kept copy is `.<keep>`. Best effort: a rename that fails (a viewer
    /// holding the file on Windows) leaves the current file in place and
    /// the next line tries again.
    fn rotate(&mut self) {
        self.file = None;
        for index in (1..self.keep).rev() {
            let _ = fs::rename(
                rotated_path(&self.path, index),
                rotated_path(&self.path, index + 1),
            );
        }
        if fs::rename(&self.path, rotated_path(&self.path, 1)).is_ok() {
            self.size = 0;
        }
    }
}

static LOG_WRITER: OnceLock<Mutex<LogWriter>> = OnceLock::new();

/// Installs the process-wide writer. The first call wins; the engine makes
/// it once in `main.rs`, right after its runtime paths resolve, so every
/// later line — the bootstrap's, the recovery mode's, every thread's — goes
/// through one file handle. Returns whether this call installed it.
pub fn init_log(path: &Path, level: LogLevel) -> bool {
    LOG_WRITER
        .set(Mutex::new(LogWriter::new(path, level)))
        .is_ok()
}

#[cfg(test)]
pub(crate) fn init_log_with_rotation(
    path: &Path,
    level: LogLevel,
    rotate_bytes: u64,
    keep: usize,
) -> bool {
    LOG_WRITER
        .set(Mutex::new(LogWriter::with_rotation(
            path,
            level,
            rotate_bytes,
            keep,
        )))
        .is_ok()
}

/// The writer's level; `INFO` before `init_log`.
pub fn configured_log_level() -> LogLevel {
    LOG_WRITER
        .get()
        .map(|writer| {
            writer
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .level()
        })
        .unwrap_or(LogLevel::Info)
}

/// Logs one line through the process-wide writer. With no writer yet (the
/// failures before the runtime paths resolve; unit tests) or when the file
/// cannot be written, the line goes to stderr instead — the shell keeps
/// engine stderr in `shell.log`, so nothing is dropped on the floor. This is
/// one of the two stderr sites the readiness ledger documents (Slice 8,
/// finding F16).
pub fn log_event(level: LogLevel, message: &str) {
    if let Some(writer) = LOG_WRITER.get() {
        let mut writer = writer.lock().unwrap_or_else(PoisonError::into_inner);
        if level < writer.level() {
            return;
        }
        if writer.write(level, message).is_ok() {
            return;
        }
    }
    eprintln!("{}", format_line(level, message).trim_end());
}

/// Appends one line to `log_file_path`. When that is the process-wide
/// writer's file the line goes through the writer (rotation and the level
/// filter apply); any other path — the engine's tests, which each read their
/// own temp log — is opened and appended per call, as before this slice.
pub fn append_log(log_file_path: &Path, level: &str, message: &str) -> EngineResult<()> {
    let level = LogLevel::parse(level).unwrap_or(LogLevel::Info);
    if let Some(writer) = LOG_WRITER.get() {
        let mut writer = writer.lock().unwrap_or_else(PoisonError::into_inner);
        if writer.path() == log_file_path {
            writer.write(level, message)?;
            return Ok(());
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file_path)?;
    file.write_all(format_line(level, message).as_bytes())?;
    file.flush()?;
    Ok(())
}

/// The one line per request (finding F27), and only when the configured
/// level is `DEBUG`: `method=… id=… ms=… ok=…`.
pub fn request_log_line(
    configured: LogLevel,
    method: &str,
    id: &Value,
    elapsed: Duration,
    ok: bool,
) -> Option<String> {
    if configured > LogLevel::Debug {
        return None;
    }
    Some(format!(
        "method={method} id={id} ms={:.1} ok={ok}",
        elapsed.as_secs_f64() * 1000.0
    ))
}

/// The last `max_lines` lines of the log, read from at most the last
/// `max_bytes` of the current file — never the whole file, never a rotated
/// one (finding F11).
pub fn read_log_tail(log_file_path: &Path, max_bytes: u64, max_lines: usize) -> String {
    if !log_file_path.exists() {
        return format!("Engine log not found yet at {}", log_file_path.display());
    }

    let window = match read_tail_window(log_file_path, max_bytes) {
        Ok(window) => window,
        Err(error) => return format!("Failed to read engine log: {error}"),
    };

    let lines = window.lines().collect::<Vec<_>>();
    let start_index = lines.len().saturating_sub(max_lines);
    let excerpt = lines[start_index..].join("\n").trim().to_string();

    if excerpt.is_empty() {
        return String::from("Engine log exists but is currently empty.");
    }

    excerpt
}

fn read_tail_window(path: &Path, max_bytes: u64) -> io::Result<String> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    if start > 0 {
        file.seek(SeekFrom::Start(start))?;
    }
    let mut bytes = Vec::with_capacity(usize::try_from(len - start).unwrap_or(0));
    file.read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        // The window starts somewhere inside a line: drop that partial line
        // so the excerpt begins with a whole one.
        if let Some(newline) = text.find('\n') {
            text.drain(..=newline);
        }
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::{
        append_log, init_log_with_rotation, read_log_tail, request_log_line, rotated_path,
        LogLevel, LogWriter, LOG_TAIL_MAX_BYTES,
    };
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("duration")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("studio-control-diagnostics-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn read_log_tail_returns_missing_file_message() {
        let temp_dir = temp_test_dir("missing");
        let log_path = temp_dir.join("missing.log");

        let excerpt = read_log_tail(&log_path, LOG_TAIL_MAX_BYTES, 12);
        assert!(excerpt.contains("Engine log not found yet"));
    }

    #[test]
    fn read_log_tail_returns_last_lines() {
        let temp_dir = temp_test_dir("excerpt");
        let log_path = temp_dir.join("engine.log");
        fs::write(&log_path, "one\ntwo\nthree\nfour\n").expect("write log");

        let excerpt = read_log_tail(&log_path, LOG_TAIL_MAX_BYTES, 2);
        assert_eq!(excerpt, "three\nfour");
    }

    // Finding F11: the excerpt is read from the end of the file, inside a
    // fixed window, and begins with a whole line.
    #[test]
    fn read_log_tail_bounded() {
        let temp_dir = temp_test_dir("bounded");
        let log_path = temp_dir.join("engine.log");
        let mut content = String::from("EARLY-MARKER this line is far outside the window\n");
        for index in 0..6_000 {
            content.push_str(&format!(
                "[1757000000] INFO line-{index:05} padding padding padding padding padding\n"
            ));
        }
        content.push_str("[1757000001] INFO LAST-LINE\n");
        assert!(content.len() as u64 > 4 * LOG_TAIL_MAX_BYTES);
        fs::write(&log_path, &content).expect("write log");

        let excerpt = read_log_tail(&log_path, LOG_TAIL_MAX_BYTES, 12);
        let lines = excerpt.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 12);
        assert_eq!(lines[11], "[1757000001] INFO LAST-LINE");
        assert!(
            lines[0].starts_with("[1757000000] INFO line-"),
            "{}",
            lines[0]
        );
        assert!(!excerpt.contains("EARLY-MARKER"));

        // Every line the window holds begins whole, even the first one.
        let wide = read_log_tail(&log_path, LOG_TAIL_MAX_BYTES, usize::MAX);
        assert!(wide.lines().all(|line| line.starts_with('[')), "{wide}");
        assert!(wide.len() as u64 <= LOG_TAIL_MAX_BYTES);
        assert_eq!(
            read_log_tail(&log_path, LOG_TAIL_MAX_BYTES, 3)
                .lines()
                .count(),
            3
        );
    }

    // The 100 MB case from the slice's done criterion, on request only:
    // `SSE_ENGINE_TEST_LARGE_LOG=1` writes a 100 MB log into the temp
    // directory and times one tail read.
    #[test]
    fn read_log_tail_scans_only_the_tail_of_a_large_log() {
        if std::env::var("SSE_ENGINE_TEST_LARGE_LOG").as_deref() != Ok("1") {
            println!(
                "skipping: set SSE_ENGINE_TEST_LARGE_LOG=1 to time the tail read of a 100 MB log"
            );
            return;
        }
        let temp_dir = temp_test_dir("large");
        let log_path = temp_dir.join("engine.log");
        let line =
            "[1757000000] INFO a line of the kind the engine writes, about eighty bytes long ...\n";
        let mut content = String::with_capacity(100 * 1024 * 1024 + line.len());
        while content.len() < 100 * 1024 * 1024 {
            content.push_str(line);
        }
        content.push_str("[1757000001] INFO LAST-LINE\n");
        fs::write(&log_path, &content).expect("write log");

        let started = Instant::now();
        let excerpt = read_log_tail(&log_path, LOG_TAIL_MAX_BYTES, 12);
        let elapsed = started.elapsed();
        let _ = fs::remove_dir_all(&temp_dir);
        assert!(excerpt.ends_with("LAST-LINE"));
        println!(
            "tail of a 100 MB log read in {} ms",
            elapsed.as_secs_f64() * 1000.0
        );
        assert!(elapsed < Duration::from_millis(50), "{elapsed:?}");
    }

    // Finding F16: the engine's own log rotates at the limit, keeps the
    // configured number of files, and the level filter applies to lines the
    // older `append_log` call sites write. This is the one test that installs
    // the process-wide writer (a `OnceLock`); every other test appends to a
    // path of its own and takes the direct path.
    #[test]
    fn append_log_rotates_at_limit() {
        let temp_dir = temp_test_dir("rotate");
        let log_path = temp_dir.join("engine.log");
        assert!(init_log_with_rotation(&log_path, LogLevel::Info, 400, 3));

        for index in 0..40 {
            append_log(
                &log_path,
                "INFO",
                &format!("line {index:02} of a rotating log, padded to a known length ......"),
            )
            .expect("append through the writer");
        }
        append_log(&log_path, "DEBUG", "DROPPED-AT-INFO").expect("a filtered line is not an error");
        append_log(&log_path, "WARN", "KEPT-AT-INFO").expect("append through the writer");

        let current = fs::read_to_string(&log_path).expect("current log");
        assert!(current.len() <= 400 + 100, "{}", current.len());
        assert!(current.contains("KEPT-AT-INFO"));
        assert!(!current.contains("DROPPED-AT-INFO"));
        for index in 1..=3 {
            let rotated = rotated_path(&log_path, index);
            assert!(rotated.is_file(), "{} should exist", rotated.display());
            let size = fs::metadata(&rotated).expect("rotated metadata").len();
            assert!(size <= 400 + 100, "{} is {size} bytes", rotated.display());
        }
        assert!(
            !rotated_path(&log_path, 4).exists(),
            "only three rotated files are kept"
        );

        // A different path still gets the direct, unfiltered append.
        let other = temp_dir.join("other.log");
        append_log(&other, "INFO", "direct").expect("direct append");
        assert!(fs::read_to_string(&other)
            .expect("other log")
            .contains("INFO direct"));
    }

    #[test]
    fn log_writer_filters_below_its_level_and_keeps_the_size_across_reopen() {
        let temp_dir = temp_test_dir("writer");
        let log_path = temp_dir.join("engine.log");
        fs::write(&log_path, "[1] INFO already here\n").expect("seed log");

        let mut writer = LogWriter::with_rotation(&log_path, LogLevel::Warn, 10_000, 2);
        writer.write(LogLevel::Info, "quiet").expect("filtered");
        writer.write(LogLevel::Error, "loud").expect("written");
        let content = fs::read_to_string(&log_path).expect("log");
        assert!(content.starts_with("[1] INFO already here\n"));
        assert!(content.contains("ERROR loud"));
        assert!(!content.contains("quiet"));
        assert_eq!(writer.size, content.len() as u64);
    }

    #[test]
    fn log_level_parses_the_environment_value() {
        assert_eq!(LogLevel::parse("debug"), Some(LogLevel::Debug));
        assert_eq!(LogLevel::parse(" WARNING "), Some(LogLevel::Warn));
        assert_eq!(LogLevel::parse("loud"), None);
        assert_eq!(LogLevel::from_env_value(None), (LogLevel::Info, None));
        assert_eq!(LogLevel::from_env_value(Some("  ")), (LogLevel::Info, None));
        assert_eq!(
            LogLevel::from_env_value(Some("error")),
            (LogLevel::Error, None)
        );
        let (level, warning) = LogLevel::from_env_value(Some("loud"));
        assert_eq!(level, LogLevel::Info);
        assert!(warning
            .expect("an unknown name is reported")
            .contains("SSE_ENGINE_LOG_LEVEL=\"loud\""));
    }

    // Finding F27: the request line exists only at DEBUG.
    #[test]
    fn request_line_is_off_at_info_and_on_at_debug() {
        let id = json!("audio.snapshot:4:abc");
        assert_eq!(
            request_log_line(
                LogLevel::Info,
                "audio.snapshot",
                &id,
                Duration::from_millis(3),
                true
            ),
            None
        );
        assert_eq!(
            request_log_line(
                LogLevel::Warn,
                "audio.snapshot",
                &id,
                Duration::from_millis(3),
                true
            ),
            None
        );
        let line = request_log_line(
            LogLevel::Debug,
            "audio.snapshot",
            &id,
            Duration::from_micros(2_460),
            false,
        )
        .expect("written at DEBUG");
        assert_eq!(
            line,
            "method=audio.snapshot id=\"audio.snapshot:4:abc\" ms=2.5 ok=false"
        );
    }
}
