//! The shell's windows, built in code from their `tauri.conf.json` entries,
//! and the one rule on which of them may read the clipboard (the new pages
//! program's Slice 6b; Slice 4's first step 3, answered 3a).
//!
//! The Teleprompter page reads the clipboard itself — `navigator.clipboard
//! .read()` for Paste as a new script and the editor's Paste key — which needs
//! WebView2's clipboard-read permission. Tauri grants it only to a webview
//! built with `enable_clipboard_access()` (wry then allows WebView2's
//! clipboard-read permission requests, and no other kind). A window
//! `tauri.conf.json` lists with `create` left on is built by Tauri just before
//! `.setup` runs, with no way to ask for that. So the main window is listed
//! with `"create": false` and built at the start of `.setup`, from its own
//! entry, by the builder Tauri would use (`WebviewWindowBuilder::from_config`),
//! with the permission added.
//!
//! Every window the shell builds goes through `webview_window_from_config`,
//! which asks `may_read_clipboard`, and only the main window may. The Prompter
//! XL's window (Slice 5b) shows the glass and never reads the clipboard: built
//! through `webview_window_from_config`, it gets no permission.

use std::error::Error;

use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

/// The operator's window: every page, and the window
/// `capabilities/default.json` names.
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

/// The windows whose page may read the clipboard: the main window, alone.
const CLIPBOARD_READ_WINDOWS: &[&str] = &[MAIN_WINDOW_LABEL];

/// Whether the window labelled `label` gets WebView2's clipboard-read
/// permission.
pub(crate) fn may_read_clipboard(label: &str) -> bool {
    CLIPBOARD_READ_WINDOWS.contains(&label)
}

/// Tauri's own builder for a window's `tauri.conf.json` entry, with the
/// clipboard permission where `may_read_clipboard` allows it and nowhere else.
/// The shell builds every window of its own through this.
pub(crate) fn webview_window_from_config<'a, R: Runtime, M: Manager<R>>(
    manager: &'a M,
    config: &WindowConfig,
) -> tauri::Result<WebviewWindowBuilder<'a, R, M>> {
    let builder = WebviewWindowBuilder::from_config(manager, config)?;
    Ok(if may_read_clipboard(&config.label) {
        builder.enable_clipboard_access()
    } else {
        builder
    })
}

/// The `tauri.conf.json` entry of the window labelled `label`.
fn window_config<'c>(windows: &'c [WindowConfig], label: &str) -> Option<&'c WindowConfig> {
    windows.iter().find(|window| window.label == label)
}

/// Builds the main window from its `tauri.conf.json` entry. Called first in
/// `.setup`, in the same `Ready` step of the event loop in which Tauri built
/// the window until Slice 6b (just before `.setup`). A failure fails the
/// setup, as Tauri's own build did.
pub(crate) fn build_main_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, Box<dyn Error>> {
    let config = window_config(&app.config().app.windows, MAIN_WINDOW_LABEL).ok_or_else(|| {
        format!("tauri.conf.json has no window labelled \"{MAIN_WINDOW_LABEL}\".")
    })?;
    Ok(webview_window_from_config(app, config)?.build()?)
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

    // Slice 6b: the clipboard-read permission is the main window's alone. The
    // Prompter XL's window (Slice 5b) shows the glass and must never get it,
    // whatever it is called; nor does a label that only looks like "main".
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
    }

    // Slice 6b: Tauri builds a window whose entry leaves `create` on before
    // `.setup` runs, without the permission; the main window is therefore
    // `"create": false` and built by `build_main_window`. Its entry is still
    // the one config the shell reads, and the capability names it.
    #[test]
    fn the_main_window_is_built_by_the_shell_from_its_own_entry() {
        let config = shell_config();
        let main = window_config(&config.app.windows, MAIN_WINDOW_LABEL)
            .expect("tauri.conf.json lists the main window");
        assert!(!main.create, "the main window must be \"create\": false");
        assert_eq!(
            config
                .app
                .windows
                .iter()
                .filter(|window| window.label == MAIN_WINDOW_LABEL)
                .count(),
            1,
            "one entry for the main window"
        );
        // What the entry held before Slice 6b is unchanged.
        assert_eq!(main.title, "SSE ExEd Studio Control");
        assert_eq!((main.width, main.height), (2560.0, 1440.0));
        assert!(main.resizable);
        assert!(!main.drag_drop_enabled);
        assert!(main.visible);

        let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("capabilities/default.json is JSON");
        assert_eq!(
            capability["windows"],
            serde_json::json!([MAIN_WINDOW_LABEL])
        );
    }

    // Slice 6b: the permission is granted in code, by `may_read_clipboard`'s
    // rule, and in no config. A window that may read the clipboard is one the
    // shell builds (`"create": false`), never one Tauri builds without asking.
    // No entry passes WebView2 browser arguments — the one route from a
    // window's entry into WebView2's own switches, and one browser for every
    // window — and neither the config nor a capability names the clipboard.
    #[test]
    fn no_window_config_opens_the_clipboard_another_way() {
        let config = shell_config();
        for window in &config.app.windows {
            if may_read_clipboard(&window.label) {
                assert!(!window.create, "{} is built by Tauri", window.label);
            }
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

        let capabilities = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut read = 0;
        for entry in fs::read_dir(&capabilities).expect("capabilities/ is readable") {
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
    }
}
