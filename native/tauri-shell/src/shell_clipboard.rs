//! Which windows may read the clipboard, and how (the new pages program's
//! Slice 6b; Slice 4's first step 3, answered 3a: the main window only).
//!
//! The Teleprompter page reads the clipboard itself — `navigator.clipboard
//! .read()` for Paste as a new script and the editor's Paste — which WebView2
//! asks leave for through its `PermissionRequested` event. The shell answers
//! for the main window alone: it allows a clipboard read, and nothing else,
//! and tells WebView2 not to save that answer.
//!
//! Not saving it is the point. Every window of the app shares one WebView2
//! profile and one origin (Tauri gives every webview the same user data
//! folder), and a state set in `PermissionRequested` is saved in the profile
//! by default, for the origin, across sessions — so once the main window had
//! read the clipboard, any other window would too, with no event at all. That
//! is why the shell does not use Tauri's `enable_clipboard_access()`: wry's
//! handler behind it allows the read and leaves it saved. The Prompter XL's
//! window (Slice 5b) shows the glass and never reads the clipboard: it is not
//! the main window, so the shell adds no handler to it, and with nothing saved
//! in the profile it gets no read either.

use tauri::{AppHandle, WebviewWindow};

/// The operator's window: every page, and the window
/// `capabilities/default.json` names.
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

/// The windows whose page may read the clipboard: the main window, alone.
const CLIPBOARD_READ_WINDOWS: &[&str] = &[MAIN_WINDOW_LABEL];

/// Whether the window labelled `label` may read the clipboard.
pub(crate) fn may_read_clipboard(label: &str) -> bool {
    CLIPBOARD_READ_WINDOWS.contains(&label)
}

/// Lets `window`'s page read the clipboard, if `may_read_clipboard` allows it
/// that window, with the leave never saved in WebView2's profile. A failure
/// is a line in shell.log: the page's clipboard reads then meet WebView2's own
/// prompt, and the rest of the shell carries on.
///
/// Called from `.setup`, where `with_webview` runs its closure at once, before
/// the page can ask. Studio Control runs on Windows alone (D22); elsewhere the
/// page's clipboard reads are the webview's own business.
pub(crate) fn allow_clipboard_reads(app: &AppHandle, window: &WebviewWindow) {
    if !may_read_clipboard(window.label()) {
        return;
    }
    #[cfg(windows)]
    {
        let app_for_webview = app.clone();
        let queued = window.with_webview(move |webview| {
            if let Err(error) = add_clipboard_read_handler(&webview.controller()) {
                log_clipboard_reads_not_allowed(&app_for_webview, &error.to_string());
            }
        });
        if let Err(error) = queued {
            log_clipboard_reads_not_allowed(app, &error.to_string());
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// `ICoreWebView2Controller` → `CoreWebView2` → `add_PermissionRequested`,
/// with a handler that answers a clipboard read, and only that: first
/// `ICoreWebView2PermissionRequestedEventArgs3::SetSavesInProfile(false)`,
/// then `SetState(ALLOW)`. In that order, a WebView2 too old to have
/// `SavesInProfile` fails the cast and allows nothing, rather than saving the
/// leave for every window.
#[cfg(windows)]
#[allow(unsafe_code)]
fn add_clipboard_read_handler(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs3, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;
    use windows::core::Interface;

    // SAFETY: `controller` is the live controller Tauri passes to
    // `with_webview`, on the thread that owns the webview; WebView2 raises
    // `PermissionRequested` on that thread too. Each call is a COM getter or
    // setter checked through the `Result` the bindings return, on
    // reference-counted interfaces released when they drop. The handler lives
    // as long as the webview (the registration token is not kept: the handler
    // is never removed).
    unsafe {
        let webview = controller.CoreWebView2()?;
        let mut token = 0_i64;
        webview.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ {
                    args.cast::<ICoreWebView2PermissionRequestedEventArgs3>()?
                        .SetSavesInProfile(false)?;
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut token,
        )
    }
}

#[cfg(windows)]
fn log_clipboard_reads_not_allowed(app: &AppHandle, error: &str) {
    crate::log_shell_line(
        app,
        &format!(
            "The page's clipboard reads were not allowed (Paste asks WebView2 each time): {error}"
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;
    use std::path::Path;

    const SHELL_CONFIG: &str = include_str!("../tauri.conf.json");

    fn shell_config() -> tauri::Config {
        serde_json::from_str(SHELL_CONFIG).expect("tauri.conf.json is a Tauri config")
    }

    // Slice 6b: the clipboard read is the main window's alone. The Prompter
    // XL's window (Slice 5b) shows the glass and must never get it, whatever
    // it is called; nor does a label that only looks like "main".
    #[test]
    fn only_the_main_window_may_read_the_clipboard() {
        assert_eq!(CLIPBOARD_READ_WINDOWS, [MAIN_WINDOW_LABEL]);
        assert_eq!(MAIN_WINDOW_LABEL, "main");
        assert!(may_read_clipboard("main"));
        for label in [
            "prompter",
            "prompter-xl",
            "prompterXl",
            "glass",
            "teleprompter",
            "Main",
            "MAIN",
            " main",
            "main ",
            "main2",
            "main-prompter",
            "",
        ] {
            assert!(!may_read_clipboard(label), "{label:?}");
        }
        let config = shell_config();
        assert!(
            config
                .app
                .windows
                .iter()
                .any(|window| window.label == MAIN_WINDOW_LABEL),
            "tauri.conf.json lists the main window"
        );
        let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("capabilities/default.json is JSON");
        assert_eq!(
            capability["windows"],
            serde_json::json!([MAIN_WINDOW_LABEL])
        );
    }

    // Slice 6b's review: the leave to read the clipboard is given in code, by
    // `allow_clipboard_reads`, never saved, and in no other way. Tauri's
    // `enable_clipboard_access()` would add wry's handler, which leaves the
    // leave saved in the profile every window shares; no config or capability
    // names the clipboard; and no entry passes WebView2 browser arguments, the
    // one route from a window's entry into WebView2's own switches.
    #[test]
    fn the_clipboard_is_opened_in_one_place_and_never_saved() {
        let config = shell_config();
        for window in &config.app.windows {
            assert_eq!(
                window.additional_browser_args, None,
                "{} passes WebView2 browser arguments",
                window.label
            );
        }
        assert!(
            !SHELL_CONFIG.to_lowercase().contains("clipboard"),
            "tauri.conf.json names the clipboard"
        );

        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut read = 0;
        for entry in fs::read_dir(manifest.join("capabilities")).expect("capabilities/ is readable")
        {
            let path = entry.expect("a capabilities/ entry").path();
            let text = fs::read_to_string(&path).expect("a capability is readable");
            assert!(
                !text.to_lowercase().contains("clipboard"),
                "{} names the clipboard",
                path.display()
            );
            read += 1;
        }
        assert!(read > 0, "capabilities/ holds the default capability");

        let wrys_way = [".enable_clipboard", "_access("].concat();
        let mut sources = 0;
        for entry in fs::read_dir(manifest.join("src")).expect("src/ is readable") {
            let path = entry.expect("a src/ entry").path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("rs") {
                continue;
            }
            let text = fs::read_to_string(&path).expect("a source is readable");
            assert!(
                !text.contains(&wrys_way),
                "{} opens the clipboard through wry, which saves the leave",
                path.display()
            );
            sources += 1;
        }
        assert!(sources > 1, "src/ holds the shell's sources");

        let this = include_str!("shell_clipboard.rs");
        let saves = this
            .find(".SetSavesInProfile(false)")
            .expect("the leave is not saved");
        let allows = this
            .find(".SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)")
            .expect("the read is allowed");
        assert!(
            saves < allows,
            "the leave is marked unsaved before it is given"
        );
    }
}
