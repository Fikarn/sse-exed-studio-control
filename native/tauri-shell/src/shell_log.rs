//! `<logs>/shell.log` (2026-09 production readiness, Slice 8 — finding F16).
//!
//! Everything the engine writes to stderr — the failures before its own log
//! exists, a panic, anything a release build would otherwise lose because a
//! GUI-subsystem shell has no console — is kept here, one line per engine
//! line, with the same rotation the engine log uses: 5 MiB, five files
//! (`shell.log.1` is the newest). Debug builds keep echoing to stderr too.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SHELL_LOG_FILE_NAME: &str = "shell.log";
/// `shell.log` rotates once a line would take it past this size.
pub const SHELL_LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;
/// How many rotated files are kept.
pub const SHELL_LOG_ROTATE_KEEP: usize = 5;

pub type SharedShellLog = Arc<Mutex<ShellLog>>;

/// One open log file with size-based rotation.
pub struct ShellLog {
    path: PathBuf,
    rotate_bytes: u64,
    keep: usize,
    file: Option<File>,
    size: u64,
}

impl ShellLog {
    /// `<logs_dir>/shell.log`; nothing is opened until the first line.
    pub fn open(logs_dir: &Path) -> Self {
        Self::with_rotation(
            &logs_dir.join(SHELL_LOG_FILE_NAME),
            SHELL_LOG_ROTATE_BYTES,
            SHELL_LOG_ROTATE_KEEP,
        )
    }

    pub fn with_rotation(path: &Path, rotate_bytes: u64, keep: usize) -> Self {
        Self {
            path: path.to_path_buf(),
            rotate_bytes,
            keep: keep.max(1),
            file: None,
            size: 0,
        }
    }

    pub fn shared(self) -> SharedShellLog {
        Arc::new(Mutex::new(self))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Appends `[<unix seconds>] LABEL message`, rotating first when the
    /// line would take the file past the limit.
    pub fn write_line(&mut self, label: &str, message: &str) -> io::Result<()> {
        let line = format!("[{}] {label} {message}\n", unix_now_secs());
        if self.size > 0 && self.size + line.len() as u64 > self.rotate_bytes {
            self.rotate();
        }
        let file = self.file_handle()?;
        file.write_all(line.as_bytes())?;
        file.flush()?;
        self.size += line.len() as u64;
        Ok(())
    }

    fn file_handle(&mut self) -> io::Result<&mut File> {
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

    /// `shell.log` becomes `.1`, `.1` becomes `.2`, and so on. Best effort:
    /// a rename that fails leaves the current file in place and the next
    /// line tries again.
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

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{rotated_path, ShellLog};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "sse-tauri-shell-log-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn shell_log_rotates_at_its_limit() {
        let dir = temp_dir("rotate");
        let path = dir.join("shell.log");
        let mut log = ShellLog::with_rotation(&path, 300, 2);
        for index in 0..30 {
            log.write_line(
                "STDERR",
                &format!("engine line {index:02} padded to a known length ......"),
            )
            .expect("write");
        }
        let current = fs::read_to_string(&path).expect("current log");
        assert!(current.len() <= 300 + 100, "{}", current.len());
        assert!(current.contains("engine line 29"));
        assert!(rotated_path(&path, 1).is_file());
        assert!(rotated_path(&path, 2).is_file());
        assert!(
            !rotated_path(&path, 3).exists(),
            "only two rotated files are kept"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn shell_log_opens_under_the_logs_dir_and_keeps_existing_content() {
        let dir = temp_dir("open");
        let logs_dir = dir.join("logs");
        fs::create_dir_all(&logs_dir).expect("logs dir");
        fs::write(logs_dir.join("shell.log"), "[1] STDERR already here\n").expect("seed");
        let mut log = ShellLog::open(&logs_dir);
        assert_eq!(log.path(), logs_dir.join("shell.log"));
        log.write_line("STDERR", "new line").expect("write");
        let content = fs::read_to_string(logs_dir.join("shell.log")).expect("log");
        assert!(content.starts_with("[1] STDERR already here\n"));
        assert!(content.ends_with("STDERR new line\n"));
        let _ = fs::remove_dir_all(&dir);
    }
}
