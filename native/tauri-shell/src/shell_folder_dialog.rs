//! Windows' own folder dialog, for the Session page (D52): where a new
//! session's folder is made (`Change…`), a session's folder that exists
//! (`Choose another folder…`), and the sessions' folder (Setup / Support).
//! The page names where the dialog starts and what it is for; the shell
//! answers the folder chosen, or nothing when the operator cancelled.
//!
//! A browser gives a page no path, so the dialog is the shell's: Windows'
//! `IFileOpenDialog` with `FOS_PICKFOLDERS`, owned by the studio window. It
//! runs on a thread of its own, in a COM apartment of its own (single
//! threaded, as the dialog asks), so neither the window's thread nor the
//! blocking pool's threads take on COM; the command waits for that thread
//! off the main thread. Windows disables the owner while its dialog is
//! open, and the dialog's keys are its own.

use crate::shell_commands::off_main_thread;
use crate::shell_window_layout::{log_shell_line, main_window};
use serde::Deserialize;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::thread;
use tauri::AppHandle;
use windows::core::{HRESULT, HSTRING};
use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_FORCEFILESYSTEM,
    FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};

/// The code a dialog that did not open answers with.
const FOLDER_DIALOG_FAILED_CODE: &str = "FOLDER_DIALOG_FAILED";

/// What the dialog chooses, which its title says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum FolderPurpose {
    /// The folder a new session's folder is made in (the window's `Change…`).
    Parent,
    /// A session's folder that exists, used as it is.
    Existing,
    /// The sessions' folder (Setup / Support).
    Root,
}

impl FolderPurpose {
    /// The dialog's title, in the operator's words.
    pub(crate) fn title(self) -> &'static str {
        match self {
            Self::Parent => "Make the session's folder in…",
            Self::Existing => "Choose the session's folder",
            Self::Root => "Choose the sessions' folder",
        }
    }
}

/// The folder the dialog starts in: the page's, trimmed, when it names one.
/// One that is not there is left out at the dialog, which then opens where
/// Windows last left it.
fn start_folder(start: Option<&str>) -> Option<PathBuf> {
    start
        .map(str::trim)
        .filter(|start| !start.is_empty())
        .map(PathBuf::from)
}

/// What the page gets of the folder chosen: its path as Windows writes it.
/// A name Windows holds that is not Unicode text cannot reach the page.
fn chosen_text(chosen: PathBuf) -> Result<String, String> {
    chosen.into_os_string().into_string().map_err(|chosen| {
        format!(
            "{FOLDER_DIALOG_FAILED_CODE}: the name of {} cannot be read.",
            PathBuf::from(chosen).display()
        )
    })
}

/// Windows' folder dialog, owned by the studio window, started in `start`
/// when it names one, for `purpose`. Answers the chosen folder's path, or
/// `None` when the operator cancelled.
#[tauri::command]
pub(crate) async fn shell_pick_folder(
    app: AppHandle,
    start: Option<String>,
    purpose: FolderPurpose,
) -> Result<Option<String>, String> {
    // The window's handle crosses to the dialog's thread as a number: the
    // handle itself is the window's, which outlives the dialog it owns.
    let owner = main_window(&app)?
        .hwnd()
        .map_err(|error| {
            format!("{FOLDER_DIALOG_FAILED_CODE}: the studio window has no handle ({error}).")
        })?
        .0 as isize;
    let start = start_folder(start.as_deref());
    let chosen = off_main_thread(move || {
        let dialog = thread::Builder::new()
            .name(String::from("folder-dialog"))
            .spawn(move || show_folder_dialog(owner, start.as_deref(), purpose.title()))
            .map_err(|error| format!("no thread for it ({error})"))?;
        dialog
            .join()
            .map_err(|_| String::from("its thread stopped"))?
            .map_err(|error| error.to_string())
    })
    .await;
    match chosen {
        Ok(Some(chosen)) => chosen_text(chosen).map(Some),
        Ok(None) => Ok(None),
        Err(detail) => {
            log_shell_line(
                &app,
                &format!("Windows' folder dialog did not open: {detail}"),
            );
            Err(format!(
                "{FOLDER_DIALOG_FAILED_CODE}: Windows' folder dialog did not open."
            ))
        }
    }
}

/// The dialog, on the calling thread, which is the dialog's own: it enters
/// a single-threaded COM apartment, shows the dialog modal to `owner`, and
/// leaves the apartment once every COM object it made is released.
#[allow(unsafe_code)]
fn show_folder_dialog(
    owner: isize,
    start: Option<&Path>,
    title: &str,
) -> windows::core::Result<Option<PathBuf>> {
    let title = HSTRING::from(title);
    let start = start.map(|start| HSTRING::from(start.as_os_str()));
    // SAFETY: the calls are COM's and the shell's, made on this thread
    // alone, which enters its apartment first and leaves it last, after the
    // closure has dropped every interface it made (each is reference counted
    // and released at its drop). The strings passed are `HSTRING`s that live
    // across the calls. `owner` is a window handle, which Windows checks, not
    // a pointer: the studio window's own, alive while the shell runs, and a
    // handle gone stale would only make `Show` fail. The path the dialog
    // hands back is read within its length and freed once, with
    // `CoTaskMemFree`, as its documentation asks.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok()?;
        let chosen = (|| -> windows::core::Result<Option<PathBuf>> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(
                dialog.GetOptions()?
                    | FOS_PICKFOLDERS
                    | FOS_FORCEFILESYSTEM
                    | FOS_PATHMUSTEXIST
                    | FOS_NOCHANGEDIR,
            )?;
            dialog.SetTitle(&title)?;
            // A start folder that is not there, or not a folder, is left
            // out: the dialog opens where Windows last left it.
            if let Some(start) = &start {
                if let Ok(folder) = SHCreateItemFromParsingName::<_, _, IShellItem>(start, None) {
                    let _ = dialog.SetFolder(&folder);
                }
            }
            match dialog.Show(Some(HWND(owner as _))) {
                Ok(()) => {}
                Err(error) if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) => {
                    return Ok(None)
                }
                Err(error) => return Err(error),
            }
            let path = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            let chosen = PathBuf::from(OsString::from_wide(path.as_wide()));
            CoTaskMemFree(Some(path.0 as *const _));
            Ok(Some(chosen))
        })();
        CoUninitialize();
        chosen
    }
}

#[cfg(test)]
mod folder_dialog_tests {
    use super::*;

    // The page says what the dialog is for, in the contract's words; the
    // title says it to the operator. A purpose the shell does not know is
    // refused before anything opens.
    #[test]
    fn each_purpose_has_its_title() {
        for (word, purpose, title) in [
            (
                "parent",
                FolderPurpose::Parent,
                "Make the session's folder in…",
            ),
            (
                "existing",
                FolderPurpose::Existing,
                "Choose the session's folder",
            ),
            ("root", FolderPurpose::Root, "Choose the sessions' folder"),
        ] {
            let read: FolderPurpose =
                serde_json::from_value(serde_json::json!(word)).expect("a purpose of the page's");
            assert_eq!(read, purpose);
            assert_eq!(read.title(), title);
        }
        for word in ["Parent", "folder", "", "sessions"] {
            assert!(
                serde_json::from_value::<FolderPurpose>(serde_json::json!(word)).is_err(),
                "{word:?}"
            );
        }
    }

    // The start folder is the page's, trimmed; none, or nothing but space,
    // starts the dialog where Windows last left it.
    #[test]
    fn the_start_folder_is_the_page_s_when_it_names_one() {
        assert_eq!(
            start_folder(Some(r"D:\Sessions")),
            Some(PathBuf::from(r"D:\Sessions"))
        );
        assert_eq!(start_folder(Some("  D:\\  ")), Some(PathBuf::from(r"D:\")));
        assert_eq!(start_folder(Some("   ")), None);
        assert_eq!(start_folder(Some("")), None);
        assert_eq!(start_folder(None), None);
    }

    // The folder chosen reaches the page as Windows writes it, its name's
    // letters kept; a name that is not Unicode text is refused with a code.
    #[test]
    fn the_chosen_folder_reaches_the_page_as_windows_writes_it() {
        assert_eq!(
            chosen_text(PathBuf::from(r"D:\All\Café — Ep. 3 (2026-10-01)")),
            Ok(String::from(r"D:\All\Café — Ep. 3 (2026-10-01)"))
        );
        let unpaired = OsString::from_wide(&[u16::from(b'D'), u16::from(b':'), 0xD800]);
        let refused = chosen_text(PathBuf::from(unpaired)).expect_err("not Unicode text");
        assert!(refused.starts_with(FOLDER_DIALOG_FAILED_CODE), "{refused}");
    }
}
