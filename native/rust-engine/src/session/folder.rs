//! A session's folder (the Session page's step 2, D52): the name a new one
//! takes, the paths the operator chooses, and what a Begin makes. Studio
//! Control makes folders and never moves or deletes a file: a Begin that
//! fails after it made something leaves what it made, and says so.
//!
//! A Begin's checks for its folder, after the kind's and the name's, in this
//! order: the folder's shape; its drive there; in a simulated run, a new
//! folder inside the run's scratch folder; the length of the longest path it
//! would make; a folder that exists, or the parent a new one goes in. Then
//! its acts: the sessions' folder made (the first Begin on it), the new
//! folder made, the kind's subfolders made in it. A new folder that is there
//! already (a second session of that name the same day) is used as it is,
//! and nothing is made in it.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf, Prefix};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::diagnostics::{log_event, LogLevel};
use crate::session::places::Places;
use crate::session::snapshot::{SessionFolderChoice, SessionFolderMade, SessionKind};
use crate::session::SessionError;

/// The most characters the longest path a Begin makes has (the folder and
/// its longest subfolder), so that vMix's file names after it stay under
/// Windows' 260. Counted as Windows counts them, in UTF-16 units.
pub(crate) const FOLDER_PATH_MAX_CHARACTERS: usize = 200;

pub(crate) const SESSION_DRIVE_MISSING: &str = "SESSION_DRIVE_MISSING";
pub(crate) const SESSION_FOLDER_NOT_ON_A_DRIVE: &str = "SESSION_FOLDER_NOT_ON_A_DRIVE";
pub(crate) const SESSION_FOLDER_MISSING: &str = "SESSION_FOLDER_MISSING";
pub(crate) const SESSION_FOLDER_OUTSIDE_SCRATCH: &str = "SESSION_FOLDER_OUTSIDE_SCRATCH";
pub(crate) const SESSION_FOLDER_PATH_TOO_LONG: &str = "SESSION_FOLDER_PATH_TOO_LONG";
pub(crate) const SESSION_FOLDER_NOT_MADE: &str = "SESSION_FOLDER_NOT_MADE";

/// The characters Windows does not take in a file's or a folder's name,
/// beside the control characters.
const FORBIDDEN: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

/// The names Windows keeps for its devices, with or without an extension:
/// its naming rules' list (the superscript digits count as digits there),
/// and the console's two.
const RESERVED: [&str; 32] = [
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "COM¹", "COM²", "COM³", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
    "LPT7", "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³", "CONIN$", "CONOUT$",
];

fn forbidden(character: char) -> bool {
    FORBIDDEN.contains(&character) || character.is_control()
}

/// How many characters Windows counts in `text`.
pub(crate) fn windows_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The name of a new session's folder (D52): the name as kept, or the kind's
/// name when there is none; each character Windows does not take becomes a
/// dash; the dots and spaces at its end go (a name of nothing else takes the
/// kind's name); then the day it began, `Morning take (2026-10-18)`. The case
/// table `native/protocol/session-folder-names.json` holds the pages to the
/// same answers.
pub(crate) fn folder_leaf(name: &str, kind: SessionKind, local_day: &str) -> String {
    let replaced: String = name
        .chars()
        .map(|character| if forbidden(character) { '-' } else { character })
        .collect();
    let kept = replaced.trim_end_matches(['.', ' ']);
    let base = if kept.is_empty() { kind.name() } else { kept };
    format!("{base} ({local_day})")
}

/// The local day at `now`, `2026-10-18`, as SQLite reads Windows' time zone
/// for the action log's "today" (`action_log::local_midnight`).
pub(crate) fn local_day(now: SystemTime) -> Result<String, SessionError> {
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let seconds = i64::try_from(seconds).unwrap_or(i64::MAX);
    rusqlite::Connection::open_in_memory()
        .and_then(|connection| {
            connection.query_row(
                "SELECT date(?1, 'unixepoch', 'localtime')",
                [seconds],
                |row| row.get::<_, String>(0),
            )
        })
        .map_err(|error| SessionError::Storage(format!("The day could not be read: {error}")))
}

/// Why Windows would not take `name` as a folder's name as it is written;
/// `None` when it would.
pub(crate) fn name_problem(name: &str) -> Option<String> {
    if name == "." || name == ".." {
        return Some(format!("\"{name}\" is not a folder's name."));
    }
    if name.chars().any(forbidden) {
        return Some(format!(
            "\"{name}\" has a character Windows does not take in a folder's name: \\ / : * ? \" < > | or a control character."
        ));
    }
    if name.ends_with(['.', ' ']) {
        return Some(format!(
            "\"{name}\" ends with a dot or a space, which Windows leaves out of a folder's name."
        ));
    }
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    if RESERVED
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(stem))
    {
        return Some(format!("\"{name}\" is a name Windows keeps for itself."));
    }
    None
}

/// A folder's full path on a lettered drive, as Windows writes it: the
/// drive's letter in capitals, `\` between the parts, none at the end but a
/// drive's own top's (`D:\`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DrivePath {
    pub text: String,
}

impl DrivePath {
    fn letter(&self) -> char {
        self.text.chars().next().unwrap_or('?')
    }

    fn path(&self) -> PathBuf {
        PathBuf::from(&self.text)
    }
}

/// Why a path is not a folder's on a lettered drive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PathProblem {
    /// A share's path, `\\server\share\…`.
    Share,
    /// Not a folder's full path; the sentence says why.
    Shape(String),
}

/// `text` read as a folder's path: `/` read as `\`, and a `\` at its end
/// dropped. A path relative to anything, one with `.` or `..` in it, one
/// written for Windows' own use (`\\?\`, `\\.\`) or with a part Windows
/// would not take is refused with a sentence; a share's path is told apart.
pub(crate) fn read_drive_path(text: &str) -> Result<DrivePath, PathProblem> {
    let written = text.replace('/', "\\");
    if written.starts_with(r"\\?\") || written.starts_with(r"\\.\") {
        return Err(PathProblem::Shape(format!(
            "\"{text}\" is written for Windows' own use: write the folder's path as Explorer shows it, such as D:\\Sessions."
        )));
    }
    if written.starts_with(r"\\") {
        return Err(PathProblem::Share);
    }
    let mut characters = written.chars();
    let letter = match (characters.next(), characters.next(), characters.next()) {
        (Some(letter), Some(':'), Some('\\')) if letter.is_ascii_alphabetic() => letter,
        _ => {
            return Err(PathProblem::Shape(format!(
                "\"{text}\" is not a folder's full path: it begins with a drive's letter, as D:\\Sessions does."
            )))
        }
    };
    let rest = characters.as_str().trim_end_matches('\\');
    let mut parts = Vec::new();
    if !rest.is_empty() {
        for part in rest.split('\\') {
            if part.is_empty() {
                return Err(PathProblem::Shape(format!(
                    "\"{text}\" has two \\ together."
                )));
            }
            if part == "." || part == ".." {
                return Err(PathProblem::Shape(format!(
                    "\"{text}\" has a . or a .. in it: write the folder's own path."
                )));
            }
            if let Some(problem) = name_problem(part) {
                return Err(PathProblem::Shape(problem));
            }
            parts.push(part);
        }
    }
    Ok(DrivePath {
        text: format!("{}:\\{}", letter.to_ascii_uppercase(), parts.join("\\")),
    })
}

/// The drive a path is on, by its letter; `None` for a path on no lettered
/// drive.
fn drive_letter(path: &Path) -> Option<char> {
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                Some(char::from(letter).to_ascii_uppercase())
            }
            _ => None,
        },
        _ => None,
    }
}

fn drive_there(letter: char) -> bool {
    Path::new(&format!("{letter}:\\")).is_dir()
}

/// A begin's folder, once its checks have passed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FolderPlan {
    /// A folder that exists, used as it is.
    Existing(PathBuf),
    /// A new folder, with the kind's subfolders in it. `root` is the
    /// sessions' folder, made first, when the new folder goes on it.
    New {
        root: Option<PathBuf>,
        folder: PathBuf,
        subfolders: Vec<String>,
    },
}

fn refused(code: &'static str, sentence: String) -> SessionError {
    SessionError::Refused(code, sentence)
}

/// The checks for a begin's folder, in their order (the module's doc). The
/// new folder's name is `folder_leaf`'s for `name` on `day`; `subfolders`
/// are the kind's, as the settings hold them; `root_setting` is the
/// sessions' folder the settings name, which only the studio's build uses.
pub(crate) fn plan_folder(
    choice: &SessionFolderChoice,
    kind: SessionKind,
    name: &str,
    day: &str,
    root_setting: &str,
    subfolders: &[String],
    places: &Places,
) -> Result<FolderPlan, SessionError> {
    // The folder's shape.
    let chosen = match choice {
        SessionFolderChoice::New { parent: None } => None,
        SessionFolderChoice::New { parent: Some(path) }
        | SessionFolderChoice::Existing { path } => {
            Some(read_drive_path(path).map_err(|problem| match problem {
                PathProblem::Share => refused(
                    SESSION_FOLDER_NOT_ON_A_DRIVE,
                    String::from("Choose a folder on a drive with a letter, such as Public (Z:)."),
                ),
                PathProblem::Shape(sentence) => SessionError::Invalid(sentence),
            })?)
        }
    };

    // Its drive there.
    if let (SessionFolderChoice::Existing { .. }, Some(existing)) = (choice, &chosen) {
        let letter = existing.letter();
        if !drive_there(letter) {
            return Err(refused(
                SESSION_DRIVE_MISSING,
                format!(
                    "{letter}: is not there, so {} cannot be used. Choose another folder.",
                    existing.text
                ),
            ));
        }
        // The rest is a new folder's: a folder that exists is used as it
        // is, and nothing is made in it.
        return match existing.path() {
            path if path.is_dir() => Ok(FolderPlan::Existing(path)),
            path if path.exists() => Err(refused(
                SESSION_FOLDER_MISSING,
                format!(
                    "{} is a file, not a folder. Choose another folder.",
                    existing.text
                ),
            )),
            _ => Err(refused(
                SESSION_FOLDER_MISSING,
                format!(
                    "{} is not there any more. Choose another folder.",
                    existing.text
                ),
            )),
        };
    }
    let (parent, root) = match &chosen {
        Some(parent) => (parent.path(), None),
        None => {
            let root = places.effective_root(root_setting);
            (root.clone(), Some(root))
        }
    };
    if let Some(letter) = drive_letter(&parent) {
        if !drive_there(letter) {
            return Err(refused(
                SESSION_DRIVE_MISSING,
                format!(
                    "{letter}: is not there, so the session's folder cannot be made there. Choose a folder that exists, or set another sessions' folder in Setup / Support."
                ),
            ));
        }
    }

    // In a simulated run, a new folder inside its scratch folder.
    let folder = parent.join(folder_leaf(name, kind, day));
    if !places.may_make(&folder) {
        return Err(refused(
            SESSION_FOLDER_OUTSIDE_SCRATCH,
            places.outside_sentence(),
        ));
    }

    // The length of the longest path it would make.
    let longest = windows_length(&folder.display().to_string())
        + subfolders
            .iter()
            .map(|subfolder| 1 + windows_length(subfolder))
            .max()
            .unwrap_or(0);
    if longest > FOLDER_PATH_MAX_CHARACTERS {
        return Err(refused(
            SESSION_FOLDER_PATH_TOO_LONG,
            format!(
                "That folder's path would be {longest} characters, over {FOLDER_PATH_MAX_CHARACTERS}: choose a shorter name, or a folder nearer the drive's top."
            ),
        ));
    }

    // The parent a new folder goes in; the sessions' folder is made when it
    // is not there yet.
    if root.is_none() {
        let written = parent.display().to_string();
        if !parent.is_dir() {
            return Err(refused(
                SESSION_FOLDER_MISSING,
                if parent.exists() {
                    format!("{written} is a file, not a folder. Choose another folder.")
                } else {
                    format!("{written} is not there any more. Choose another folder.")
                },
            ));
        }
    }
    Ok(FolderPlan::New {
        root,
        folder,
        subfolders: subfolders.to_vec(),
    })
}

/// Windows' reason, as a sentence ends: `Access is denied`, without the
/// error's number, which the log keeps.
fn reason(error: &io::Error) -> String {
    let text = error.to_string();
    let text = match text.rfind(" (os error ") {
        Some(at) if text.ends_with(')') => text[..at].to_string(),
        _ => text,
    };
    text.trim_end_matches('.').to_string()
}

fn not_made(path: &Path, error: &io::Error, after: &str) -> SessionError {
    let written = path.display();
    log_event(
        LogLevel::Warn,
        &format!("Begin could not make {written}: {error}.{after}"),
    );
    refused(
        SESSION_FOLDER_NOT_MADE,
        format!("{written} could not be made: {}.{after}", reason(error)),
    )
}

/// A begin's acts for its folder (the module's doc). A failure refuses the
/// begin and leaves what was made; the sentence and the log say which.
pub(crate) fn make_folder(plan: FolderPlan) -> Result<SessionFolderMade, SessionError> {
    let (root, folder, subfolders) = match plan {
        FolderPlan::Existing(path) => {
            return Ok(SessionFolderMade {
                path: path.display().to_string(),
                made: false,
            })
        }
        FolderPlan::New {
            root,
            folder,
            subfolders,
        } => (root, folder, subfolders),
    };
    if let Some(root) = root {
        let first = !root.is_dir();
        fs::create_dir_all(&root).map_err(|error| not_made(&root, &error, ""))?;
        if first {
            log_event(
                LogLevel::Info,
                &format!(
                    "The sessions' folder {} was made by a Begin.",
                    root.display()
                ),
            );
        }
    }
    let written = folder.display().to_string();
    match fs::create_dir(&folder) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists && folder.is_dir() => {
            return Ok(SessionFolderMade {
                path: written,
                made: false,
            });
        }
        Err(error) => return Err(not_made(&folder, &error, "")),
    }
    for (index, subfolder) in subfolders.iter().enumerate() {
        let path = folder.join(subfolder);
        if let Err(error) = fs::create_dir(&path) {
            let made = &subfolders[..index];
            let after = if made.is_empty() {
                format!(" {written} was made, and is left as it is.")
            } else {
                format!(
                    " {written} was made, with {}, and is left as it is.",
                    made.join(", ")
                )
            };
            return Err(not_made(&path, &error, &after));
        }
    }
    log_event(
        LogLevel::Info,
        &if subfolders.is_empty() {
            format!("A Begin made the session's folder {written}.")
        } else {
            format!(
                "A Begin made the session's folder {written}, with {}.",
                subfolders.join(", ")
            )
        },
    );
    Ok(SessionFolderMade {
        path: written,
        made: true,
    })
}
