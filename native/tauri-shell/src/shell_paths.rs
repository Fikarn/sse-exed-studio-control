//! What the shell does with the file system for the operator: it opens a
//! folder of its own in Explorer, and writes the diagnostics report. Both
//! stay inside the app data and the logs (finding F15). It also opens the
//! session's folder, or the sessions' folder, which the hardware link names
//! and the page does not (D52).

use crate::engine::{self, EngineBridge};
use crate::shell_commands::off_main_thread;
use crate::EngineState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs::{canonicalize, create_dir_all, metadata, write};
use std::io::ErrorKind;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use studio_control_protocol::RequestEnvelope;

/// Error code prefixes answered by `shell_open_path` (finding F15).
const PATH_OUTSIDE_APP_DATA_CODE: &str = "PATH_OUTSIDE_APP_DATA";
const PATH_NOT_FOUND_CODE: &str = "PATH_NOT_FOUND";

/// The folders the shell opens for the operator: the app-data directory
/// (which holds `backups` and `exports`) and the logs directory (which may
/// live elsewhere through `SSE_LOG_DIR`). Everything else is refused (2026-09 production
/// readiness, Slice 4 — finding F15): the command took any path the webview
/// named and handed it to Explorer.
fn allowed_open_roots() -> Result<Vec<PathBuf>, String> {
    let (app_data_dir, logs_dir) = engine::resolve_runtime_directories()?;
    Ok(vec![app_data_dir, logs_dir])
}

/// `target` must exist and, once every symlink, junction and `..` is
/// resolved, sit inside one of `roots` (a root that does not exist cannot
/// admit anything). Returns the canonical path.
fn resolve_open_path(target: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical = canonicalize(target).map_err(|error| {
        format!(
            "{PATH_NOT_FOUND_CODE}: {} could not be opened: {error}",
            target.display()
        )
    })?;
    let inside_a_root = roots.iter().any(|root| {
        canonicalize(root)
            .map(|root| canonical.starts_with(root))
            .unwrap_or(false)
    });
    if inside_a_root {
        Ok(canonical)
    } else {
        Err(format!(
            "{PATH_OUTSIDE_APP_DATA_CODE}: {} is outside the app data and logs folders, so it was not opened.",
            target.display()
        ))
    }
}

#[tauri::command]
pub(crate) async fn shell_open_path(path: String) -> Result<(), String> {
    off_main_thread(move || {
        let target = PathBuf::from(path);
        let roots = allowed_open_roots()?;
        resolve_open_path(&target, &roots)?;
        open_path_with_system(&target)
    })
    .await
}

/// Hands an allowed path to Explorer. The original spelling is used rather
/// than the canonical one: Explorer does not take the `\\?\` prefix
/// `canonicalize` produces on Windows. The path is always quoted: Explorer
/// ends an unquoted path at a comma (an unquoted `…\a,b` opened `…\a`, tried
/// on this PC on 2026-10-20), and a folder the operator chose may have one.
/// Windows never puts a `"` in a path, and Explorer reads `"C:\"` as `C:\`.
fn open_path_with_system(target: &Path) -> Result<(), String> {
    Command::new("explorer")
        .raw_arg(quoted(target))
        .spawn()
        .map_err(|error| format!("Failed to open path {}: {error}", target.display()))?;
    Ok(())
}

/// A path between quotes, for Explorer's command line.
fn quoted(target: &Path) -> OsString {
    let mut quoted = OsString::from("\"");
    quoted.push(target.as_os_str());
    quoted.push("\"");
    quoted
}

/// The code `shell_open_session_folder` refuses with (D52).
const NO_SESSION_FOLDER_CODE: &str = "NO_SESSION_FOLDER";

/// Which folder `Open the folder` opens: the running session's (its
/// window), or the sessions' folder (Setup / Support).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SessionFolderWhich {
    Session,
    Root,
}

/// Opens the running session's folder, or the sessions' folder, in Explorer
/// (D52). The page names no path: the shell asks the hardware link for the
/// session's snapshot itself, as it tells it of the Prompter XL, and opens
/// the folder named there once it finds it there. So `shell_open_path`'s
/// rule (the app data and the logs alone, F15) stands for every path a page
/// names. Explorer's window opens where Windows puts it, as `Open the log`'s
/// does.
#[tauri::command]
pub(crate) async fn shell_open_session_folder(
    state: tauri::State<'_, EngineState>,
    which: SessionFolderWhich,
) -> Result<(), String> {
    let bridge = Arc::clone(&state.bridge);
    off_main_thread(move || {
        let snapshot = session_snapshot(&bridge)?;
        let folder = session_folder_of(&snapshot, which)?;
        folder_is_there(&folder, which)?;
        open_path_with_system(&folder)
    })
    .await
}

/// The hardware link's `session.snapshot`, asked by the shell under an id
/// of its own. Why it did not come is said in `shell.log`; the page gets the
/// operator's sentence.
fn session_snapshot(bridge: &EngineBridge) -> Result<Value, String> {
    static ASKED: AtomicU64 = AtomicU64::new(0);
    let asked = ASKED.fetch_add(1, Ordering::Relaxed) + 1;
    let request = RequestEnvelope {
        kind: String::from("request"),
        id: json!(format!("shell:session.snapshot:{asked}")),
        method: String::from("session.snapshot"),
        params: json!({}),
    };
    let answer = match bridge.request(request) {
        Ok(response) if response.ok => response
            .result
            .ok_or_else(|| String::from("it answered nothing")),
        Ok(response) => Err(response
            .error
            .map(|error| error.to_string())
            .unwrap_or_else(|| String::from("it refused, with no reason"))),
        Err(error) => Err(error),
    };
    answer.map_err(|detail| {
        bridge.log_shell_line(
            "SHELL",
            &format!("Open the folder: the hardware link's session was not read: {detail}"),
        );
        format!(
            "{NO_SESSION_FOLDER_CODE}: The hardware link did not answer, so no folder was opened."
        )
    })
}

/// The folder a session's snapshot names for `which`: the running session's
/// folder, or the sessions' folder. Refused, in the operator's words, when
/// there is none.
fn session_folder_of(snapshot: &Value, which: SessionFolderWhich) -> Result<PathBuf, String> {
    let named = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
    };
    match which {
        SessionFolderWhich::Session => {
            let current = snapshot
                .get("current")
                .filter(|current| current.is_object())
                .ok_or_else(|| {
                    format!(
                        "{NO_SESSION_FOLDER_CODE}: No session runs, so it has no folder to open."
                    )
                })?;
            named(current.get("folder")).ok_or_else(|| {
                format!("{NO_SESSION_FOLDER_CODE}: This session began before sessions had folders.")
            })
        }
        SessionFolderWhich::Root => {
            named(snapshot.get("places").and_then(|places| places.get("root"))).ok_or_else(|| {
                format!("{NO_SESSION_FOLDER_CODE}: The hardware link named no sessions' folder.")
            })
        }
    }
}

/// The folder is there, and is a folder, before Explorer is given it:
/// Explorer opens another folder for a path that is not there.
fn folder_is_there(folder: &Path, which: SessionFolderWhich) -> Result<(), String> {
    match metadata(folder) {
        Ok(found) if found.is_dir() => Ok(()),
        Ok(_) => Err(format!(
            "{NO_SESSION_FOLDER_CODE}: {} is not a folder.",
            folder.display()
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Err(match which {
            SessionFolderWhich::Session => format!(
                "{NO_SESSION_FOLDER_CODE}: {} is not there any more.",
                folder.display()
            ),
            SessionFolderWhich::Root => format!(
                "{NO_SESSION_FOLDER_CODE}: {} is not there: the next Begin makes it.",
                folder.display()
            ),
        }),
        Err(error) => Err(format!(
            "{NO_SESSION_FOLDER_CODE}: {} cannot be reached: {error}",
            folder.display()
        )),
    }
}

/// UTC wall-clock time as `YYYY-MM-DDTHH-MM-SS-mmmZ` — the shape the engine's
/// database backups and support archives use, so a directory listing sorts
/// every export together (mirrors `storage_backups::file_timestamp`).
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

/// The name a diagnostics export gets: `diagnostics-<UTC ms timestamp>.json`.
fn diagnostics_file_name(time: SystemTime) -> String {
    format!("diagnostics-{}.json", file_timestamp(time))
}

/// Writes `report` under `directory` (created if needed) and returns the
/// file's path. Two exports in the same millisecond get two files.
pub(crate) fn write_diagnostics_report(
    directory: &Path,
    report: &Value,
) -> Result<PathBuf, String> {
    if !directory.is_absolute() {
        return Err("Diagnostics directory must be an absolute path.".to_string());
    }
    create_dir_all(directory).map_err(|error| {
        format!(
            "Failed to create diagnostics directory {}: {error}",
            directory.display()
        )
    })?;

    let payload = serde_json::to_vec_pretty(report)
        .map_err(|error| format!("Failed to serialize diagnostics report: {error}"))?;
    let mut attempts = 0;
    let output_path = loop {
        let candidate = directory.join(diagnostics_file_name(SystemTime::now()));
        if !candidate.exists() {
            break candidate;
        }
        attempts += 1;
        if attempts > 1_000 {
            return Err(format!(
                "Could not reserve a diagnostics file name in {}",
                directory.display()
            ));
        }
        thread::sleep(Duration::from_millis(1));
    };
    write(&output_path, payload).map_err(|error| {
        format!(
            "Failed to write diagnostics report {}: {error}",
            output_path.display()
        )
    })?;
    Ok(output_path)
}

/// Writes the report to `<app-data>/exports/diagnostics-<ts>.json` and
/// nowhere else (2026-09 production readiness, Slice 4 — finding F15): the
/// command used to take any directory, which made it a write-anywhere
/// primitive for whatever ran in the webview. Automation that needs another
/// directory has `shell_test_bridge_export_diagnostics_to` under the
/// `test-bridge` feature.
#[tauri::command]
pub(crate) async fn shell_export_diagnostics(report: Value) -> Result<String, String> {
    off_main_thread(move || {
        let (app_data_dir, _) = engine::resolve_runtime_directories()?;
        write_diagnostics_report(&engine::exports_dir_for(&app_data_dir), &report)
            .map(|path| path.display().to_string())
    })
    .await
}

#[cfg(test)]
mod shell_path_policy_tests {
    use super::*;
    use serde_json::json;
    use std::fs::{self, File};

    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "sse-tauri-shell-paths-{label}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("test temp root should be creatable");
            Self { root }
        }

        fn path(&self, path: &str) -> PathBuf {
            self.root.join(path)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().expect("test path should have a parent"))
            .expect("test parent directory should be creatable");
        File::create(path).expect("test file should be creatable");
    }

    // 2026-09 production readiness, Slice 4 (finding F15): the shell opens
    // only what sits inside its own folders. Anything else — a system
    // directory, a sibling of the app-data directory, a `..` that climbs out,
    // a path that does not exist — is refused with a code the surface can show.
    #[test]
    fn open_path_rejects_outside_app_data() {
        let tree = TempTree::new("open-path");
        let app_data = tree.path("app-data");
        let logs = tree.path("elsewhere/logs");
        let backup = app_data
            .join("backups")
            .join("db-2026-09-10T00-00-00-000Z-daily.sqlite3");
        let export = app_data
            .join("exports")
            .join("diagnostics-2026-09-10T00-00-00-000Z.json");
        let engine_log = logs.join("engine.log");
        let sibling = tree.path("app-data-sibling/secret.txt");
        let missing_root = tree.path("never-created");
        touch(&backup);
        touch(&export);
        touch(&engine_log);
        touch(&sibling);
        let roots = vec![app_data.clone(), logs.clone(), missing_root];

        // Inside a root: the roots themselves, and files beneath them.
        for allowed in [
            app_data.clone(),
            app_data.join("backups"),
            backup.clone(),
            export.clone(),
            logs.clone(),
            engine_log.clone(),
        ] {
            let resolved = resolve_open_path(&allowed, &roots)
                .unwrap_or_else(|error| panic!("{} should open: {error}", allowed.display()));
            assert_eq!(
                resolved,
                canonicalize(&allowed).expect("allowed path should canonicalize")
            );
        }

        // Outside every root, by any spelling.
        let climbs_out = app_data
            .join("..")
            .join("app-data-sibling")
            .join("secret.txt");
        for refused in [
            sibling.clone(),
            climbs_out,
            tree.root.clone(),
            std::env::temp_dir(),
        ] {
            let error = resolve_open_path(&refused, &roots)
                .expect_err(&format!("{} must be refused", refused.display()));
            assert!(
                error.starts_with(PATH_OUTSIDE_APP_DATA_CODE),
                "{}: {error}",
                refused.display()
            );
        }

        {
            let windows = PathBuf::from(r"C:\Windows");
            if windows.exists() {
                let error = resolve_open_path(&windows, &roots)
                    .expect_err("the Windows directory must be refused");
                assert!(error.starts_with(PATH_OUTSIDE_APP_DATA_CODE), "{error}");
            }
        }

        // A path that does not exist is refused before Explorer sees it.
        let missing = app_data.join("backups").join("missing.sqlite3");
        let error =
            resolve_open_path(&missing, &roots).expect_err("a missing path must be refused");
        assert!(error.starts_with(PATH_NOT_FOUND_CODE), "{error}");

        // No roots at all admit nothing.
        let error = resolve_open_path(&backup, &[]).expect_err("no roots admit nothing");
        assert!(error.starts_with(PATH_OUTSIDE_APP_DATA_CODE), "{error}");
    }

    // Diagnostics exports get a UTC millisecond stamp, land where they are
    // told, and never overwrite each other.
    #[test]
    fn diagnostics_report_lands_with_a_utc_stamp_and_never_overwrites() {
        let tree = TempTree::new("diagnostics");
        let exports = tree.path("app-data/exports");
        let report = json!({ "lifecycle": "ready", "activeWorkspace": "lighting" });

        let first = write_diagnostics_report(&exports, &report)
            .expect("the exports directory is created on demand");
        let second = write_diagnostics_report(&exports, &report)
            .expect("a second export in the same instant still gets its own file");

        assert_ne!(first, second);
        for path in [&first, &second] {
            assert_eq!(path.parent(), Some(exports.as_path()));
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .expect("export names are UTF-8");
            assert!(
                name.starts_with("diagnostics-") && name.ends_with("Z.json"),
                "{name}"
            );
            assert_eq!(
                name.len(),
                "diagnostics-2026-09-10T00-00-00-000Z.json".len(),
                "{name}"
            );
            let written: Value =
                serde_json::from_slice(&fs::read(path).expect("export is readable"))
                    .expect("export is JSON");
            assert_eq!(written, report);
        }

        let relative = PathBuf::from("relative/exports");
        let error = write_diagnostics_report(&relative, &report)
            .expect_err("a relative directory is refused");
        assert!(error.contains("absolute"), "{error}");
    }

    /// A refusal of `Open the folder`: its code, then the operator's words.
    fn assert_refused<T: std::fmt::Debug>(result: Result<T, String>, words: &str) {
        let refusal = result.expect_err(words);
        assert!(
            refusal.starts_with(&format!("{NO_SESSION_FOLDER_CODE}: ")),
            "{refusal}"
        );
        assert!(refusal.contains(words), "{refusal}");
    }

    // D52: `Open the folder` opens the folder the hardware link names, the
    // running session's or the sessions' folder, never a path of the page's;
    // when there is none it says why. The page's two words are the only
    // ones it takes.
    #[test]
    fn the_folder_to_open_is_the_one_the_hardware_link_names() {
        use SessionFolderWhich::{Root, Session};
        let snapshot = json!({
            "current": {
                "kind": "podcast",
                "name": "Morning take",
                "begunAt": "2026-04-23T06:46:00.000Z",
                "endedAt": null,
                "folder": r"D:\Sessions\Morning take (2026-04-23)",
                "folderBytes": 0
            },
            "places": { "root": r"D:\Sessions", "simulated": false, "rootExists": true }
        });
        assert_eq!(
            session_folder_of(&snapshot, Session),
            Ok(PathBuf::from(r"D:\Sessions\Morning take (2026-04-23)"))
        );
        assert_eq!(
            session_folder_of(&snapshot, Root),
            Ok(PathBuf::from(r"D:\Sessions"))
        );

        let idle = json!({ "current": null, "places": { "root": r"D:\Sessions" } });
        assert_refused(session_folder_of(&idle, Session), "No session runs");
        assert_eq!(
            session_folder_of(&idle, Root),
            Ok(PathBuf::from(r"D:\Sessions"))
        );
        // A session begun before sessions had folders has none to open.
        for folder in [json!(null), json!(""), json!("  ")] {
            let older = json!({ "current": { "kind": "webinar", "folder": folder } });
            assert_refused(
                session_folder_of(&older, Session),
                "began before sessions had folders",
            );
        }
        assert_refused(session_folder_of(&json!({}), Session), "No session runs");
        assert_refused(
            session_folder_of(&json!({}), Root),
            "named no sessions' folder",
        );

        for (word, which) in [("session", Session), ("root", Root)] {
            assert_eq!(
                serde_json::from_value::<SessionFolderWhich>(json!(word)).expect(word),
                which
            );
        }
        for word in ["Session", "current", "folder", ""] {
            assert!(
                serde_json::from_value::<SessionFolderWhich>(json!(word)).is_err(),
                "{word:?}"
            );
        }
    }

    // Explorer is given a folder that is there: one gone, one not made yet
    // and a file are refused, each with its own words.
    #[test]
    fn a_session_s_folder_opens_only_once_it_is_there() {
        use SessionFolderWhich::{Root, Session};
        let tree = TempTree::new("session-folder");
        let folder = tree.path("Sessions/Morning take (2026-04-23)");
        fs::create_dir_all(&folder).expect("the test folder should be creatable");
        let file = tree.path("Sessions/notes.txt");
        touch(&file);

        assert_eq!(folder_is_there(&folder, Session), Ok(()));
        assert_eq!(folder_is_there(&tree.path("Sessions"), Root), Ok(()));
        assert_refused(
            folder_is_there(&tree.path("Sessions/Old take (2026-04-22)"), Session),
            "is not there any more",
        );
        assert_refused(
            folder_is_there(&tree.path("Not made yet"), Root),
            "is not there: the next Begin makes it",
        );
        assert_refused(folder_is_there(&file, Session), "is not a folder");
    }

    // Explorer ends an unquoted path at a comma, so every path goes to it
    // quoted, a drive's top among them.
    #[test]
    fn explorer_is_given_the_path_quoted() {
        assert_eq!(
            quoted(Path::new(r"D:\All\Markets,Outlook")),
            OsString::from(r#""D:\All\Markets,Outlook""#)
        );
        assert_eq!(quoted(Path::new(r"D:\")), OsString::from(r#""D:\""#));
        assert_eq!(
            quoted(Path::new(r"C:\Users\Stora Studion\AppData")),
            OsString::from(r#""C:\Users\Stora Studion\AppData""#)
        );
    }

    #[test]
    fn file_timestamp_is_utc_to_the_millisecond() {
        assert_eq!(file_timestamp(UNIX_EPOCH), "1970-01-01T00-00-00-000Z");
        assert_eq!(
            file_timestamp(UNIX_EPOCH + Duration::from_millis(1_000_000_000_500)),
            "2001-09-09T01-46-40-500Z"
        );
        assert_eq!(
            file_timestamp(UNIX_EPOCH + Duration::from_secs(1_709_164_800)),
            "2024-02-29T00-00-00-000Z"
        );
        assert_eq!(
            diagnostics_file_name(UNIX_EPOCH + Duration::from_secs(1_709_164_800)),
            "diagnostics-2024-02-29T00-00-00-000Z.json"
        );
    }
}
