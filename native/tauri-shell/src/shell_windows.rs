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
//! which asks `may_read_clipboard`, and only the main window may. That rule is
//! the builder's, not WebView2's: wry's handler allows the read without
//! `SetSavesInProfile(false)`, and WebView2 saves such an answer in the
//! profile, for the origin, across sessions, and the windows of one profile
//! share one origin. So once the main window has read the clipboard, another
//! window's page on that profile can too, with no permission of its own
//! (tried on 2026-09-28).
//!
//! So every window but the main one has a profile of its own: its
//! `tauri.conf.json` entry says `"incognito": true`, and a window built that
//! way does not see the saved answer (tried the same day). The other way
//! that was thought of, a handler of the shell's own that never saves the
//! answer, does not work: the read is then allowed and comes back empty. The
//! prompter's window shows the glass and never reads the clipboard.
//!
//! The prompter's window is the second window (`shell_prompter_window.rs`).
//! What the hardware link says goes to a window by its name (`windows_for`),
//! on a channel of that window's own (`event_channel`).

use std::error::Error;

use studio_control_protocol::{EVENT_ENGINE_EXITED, EVENT_ENGINE_READY, EVENT_PROMPTER_CHANGED};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, EventTarget, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

/// The operator's window: every page, and the window
/// `capabilities/default.json` names.
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

/// The prompter's window: the glass, and the window
/// `capabilities/prompter.json` names.
pub(crate) const PROMPTER_WINDOW_LABEL: &str = "prompter";

/// The windows an event of the hardware link goes to. The operator's window
/// gets every one. The prompter's gets what its glass follows: what the
/// prompter did, and the hardware link's start and its end. The meters, 30
/// times a second, are not its to hear.
pub(crate) fn windows_for(event: &str) -> &'static [&'static str] {
    match event {
        EVENT_PROMPTER_CHANGED | EVENT_ENGINE_READY | EVENT_ENGINE_EXITED => {
            &[MAIN_WINDOW_LABEL, PROMPTER_WINDOW_LABEL]
        }
        _ => &[MAIN_WINDOW_LABEL],
    }
}

/// The operator's window's channel: every event of the hardware link.
pub(crate) const MAIN_EVENT_CHANNEL: &str = "engine://event";

/// The prompter's window's channel: the events its glass follows.
pub(crate) const PROMPTER_EVENT_CHANNEL: &str = "prompter://event";

/// The channel an event of the hardware link reaches a window on. Each
/// window has one of its own. Tauri runs an event as script in every page
/// that listens to its channel, whether a listener there is for it or not:
/// on one channel the prompter's page would run the meters, 30 times a
/// second, while it scrolls the glass.
pub(crate) fn event_channel(window: &str) -> &'static str {
    if window == PROMPTER_WINDOW_LABEL {
        PROMPTER_EVENT_CHANNEL
    } else {
        MAIN_EVENT_CHANNEL
    }
}

/// Whether a listener of this target is in one of `windows`. A page that
/// listens without naming a target hears everything Tauri emits on its
/// channel, whatever this answers: the prompter's page names its own window.
pub(crate) fn listens_in(target: &EventTarget, windows: &[&str]) -> bool {
    match target {
        EventTarget::AnyLabel { label }
        | EventTarget::Window { label }
        | EventTarget::Webview { label }
        | EventTarget::WebviewWindow { label } => windows.contains(&label.as_str()),
        EventTarget::Any => true,
        _ => false,
    }
}

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

/// The prompter's window as a build that is not the studio's opens it: an
/// ordinary window with a frame, in the taskbar, under other windows when
/// they are brought forward, of a size that fits beside them. It keeps its
/// page, its profile of its own, and that it is shown by the shell once it
/// is built.
pub(crate) fn ordinary_window(entry: &WindowConfig) -> WindowConfig {
    let mut ordinary = entry.clone();
    ordinary.decorations = true;
    ordinary.shadow = true;
    ordinary.always_on_top = false;
    ordinary.skip_taskbar = false;
    ordinary.focusable = true;
    ordinary.resizable = true;
    ordinary.maximizable = true;
    ordinary.fullscreen = false;
    ordinary.width = 960.0;
    ordinary.height = 540.0;
    ordinary
}

/// Builds the prompter's window from its `tauri.conf.json` entry, hidden.
/// `ordinary` is for every build but the studio's. Called from a thread of
/// the shell's own, never from a command or an event of a window: on
/// Windows a window built there stops the app.
pub(crate) fn build_prompter_window<R: Runtime>(
    app: &AppHandle<R>,
    ordinary: bool,
) -> Result<WebviewWindow<R>, Box<dyn Error>> {
    let config =
        window_config(&app.config().app.windows, PROMPTER_WINDOW_LABEL).ok_or_else(|| {
            format!("tauri.conf.json has no window labelled \"{PROMPTER_WINDOW_LABEL}\".")
        })?;
    let built = if ordinary {
        webview_window_from_config(app, &ordinary_window(config))?.build()?
    } else {
        webview_window_from_config(app, config)?.build()?
    };
    Ok(built)
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
        assert!(!may_read_clipboard(PROMPTER_WINDOW_LABEL));
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
        assert!(!main.incognito, "the operator's settings are kept");

        let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("capabilities/default.json is JSON");
        assert_eq!(
            capability["windows"],
            serde_json::json!([MAIN_WINDOW_LABEL])
        );
    }

    // The shell has two windows, and no third: the operator's and the
    // prompter's. Tauri builds neither by itself.
    #[test]
    fn the_shell_has_the_operator_s_window_and_the_prompter_s() {
        let config = shell_config();
        let labels: Vec<&str> = config
            .app
            .windows
            .iter()
            .map(|window| window.label.as_str())
            .collect();
        assert_eq!(labels, [MAIN_WINDOW_LABEL, PROMPTER_WINDOW_LABEL]);
        for window in &config.app.windows {
            assert!(!window.create, "{} is built by Tauri", window.label);
        }
    }

    // The question of 2026-09-28, answered by trying both ways: WebView2
    // saves the main window's clipboard answer in its profile, and a window
    // on that profile reads the clipboard with no permission of its own. A
    // window built `incognito` has a profile of its own, and does not. So
    // every window but the main one is built so.
    #[test]
    fn every_window_but_the_main_one_has_a_profile_of_its_own() {
        let config = shell_config();
        let mut others = 0;
        for window in &config.app.windows {
            if window.label == MAIN_WINDOW_LABEL {
                continue;
            }
            others += 1;
            assert!(window.incognito, "{} shares the profile", window.label);
            assert!(
                ordinary_window(window).incognito,
                "{} shares the profile in a build that is not the studio's",
                window.label
            );
            assert!(!may_read_clipboard(&window.label), "{}", window.label);
        }
        assert_eq!(others, 1, "the prompter's window");
    }

    // The design's §7: the window on the Prompter XL has no frame and no
    // taskbar entry, never takes the keyboard, stays above other windows on
    // its screen, and is shown by the shell once it stands in its place.
    #[test]
    fn the_prompter_s_window_is_the_presenter_s() {
        let config = shell_config();
        let prompter = window_config(&config.app.windows, PROMPTER_WINDOW_LABEL)
            .expect("tauri.conf.json lists the prompter's window");
        assert_eq!(
            prompter.url,
            tauri::WebviewUrl::App("prompter.html".into()),
            "its page is its own"
        );
        assert!(!prompter.visible, "hidden until it stands in its place");
        assert!(!prompter.focus, "it does not take the keyboard when built");
        assert!(!prompter.focusable, "it never takes the keyboard");
        assert!(!prompter.decorations);
        assert!(!prompter.shadow, "a shadow draws a white edge");
        // The shell shows the window once it stands in its place, which can
        // be before its page has drawn: the browser's own white would show
        // until then.
        assert_eq!(
            prompter.background_color,
            Some(tauri::utils::config::Color(0, 0, 0, 255)),
            "black before its page draws"
        );
        assert!(prompter.always_on_top);
        assert!(prompter.skip_taskbar);
        assert!(!prompter.resizable);
        assert!(!prompter.maximizable);
        assert!(!prompter.minimizable);
        assert!(!prompter.closable);
        assert!(!prompter.drag_drop_enabled);
        assert!(
            !prompter.fullscreen,
            "the shell fills the Prompter XL itself"
        );
        assert_eq!(
            prompter.parent, None,
            "a window of its own, not the main one's"
        );
        assert_eq!((prompter.width, prompter.height), (1920.0, 1080.0));
        assert_eq!(prompter.title, "SSE ExEd Studio Control: the prompter");
    }

    // D15's rule 4: a build that is not the studio's draws into an ordinary
    // window. It has a frame and a taskbar entry and lies under the windows
    // brought forward, so that it is taken for nothing else.
    #[test]
    fn another_build_s_prompter_window_is_an_ordinary_one() {
        let config = shell_config();
        let prompter = window_config(&config.app.windows, PROMPTER_WINDOW_LABEL)
            .expect("tauri.conf.json lists the prompter's window");
        let ordinary = ordinary_window(prompter);
        assert!(ordinary.decorations);
        assert!(ordinary.shadow);
        assert!(!ordinary.always_on_top);
        assert!(!ordinary.skip_taskbar);
        assert!(ordinary.focusable);
        assert!(ordinary.resizable);
        assert!(!ordinary.fullscreen);
        assert_eq!((ordinary.width, ordinary.height), (960.0, 540.0));
        // What it keeps: its name, its page, its profile, its black, and
        // that it is shown by the shell and takes no keyboard by itself.
        assert_eq!(ordinary.label, PROMPTER_WINDOW_LABEL);
        assert_eq!(ordinary.url, prompter.url);
        assert_eq!(ordinary.title, prompter.title);
        assert!(ordinary.incognito);
        assert_eq!(ordinary.background_color, prompter.background_color);
        assert!(!ordinary.visible);
        assert!(!ordinary.focus);
        assert!(!ordinary.create);
        assert!(!ordinary.closable, "the app closes it");
    }

    // The prompter's window may listen to the hardware link's events and do
    // nothing else of Tauri's: its capability says so, and the config names
    // both capabilities (one that is not named there is ignored). The
    // shell's own commands are not a capability's to give: `shell_commands`
    // refuses the window by its name.
    #[test]
    fn the_prompter_s_window_may_listen_and_nothing_else() {
        let capability: Value = serde_json::from_str(include_str!("../capabilities/prompter.json"))
            .expect("capabilities/prompter.json is JSON");
        assert_eq!(capability["identifier"], "prompter");
        assert_eq!(
            capability["windows"],
            serde_json::json!([PROMPTER_WINDOW_LABEL])
        );
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["core:event:allow-listen", "core:event:allow-unlisten"])
        );
        assert!(capability.get("webviews").is_none());
        assert!(capability.get("remote").is_none());

        let config: Value = serde_json::from_str(SHELL_CONFIG).expect("tauri.conf.json is JSON");
        assert_eq!(
            config["app"]["security"]["capabilities"],
            serde_json::json!(["default", "prompter"])
        );
        let capabilities = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut files: Vec<String> = fs::read_dir(&capabilities)
            .expect("capabilities/ is readable")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        files.sort();
        assert_eq!(files, ["default.json", "prompter.json"]);
    }

    // What the hardware link says goes to a window by its name. The
    // prompter's hears what its glass follows, and not the meters.
    #[test]
    fn an_event_goes_to_a_window_by_its_name() {
        for event in ["prompter.changed", "engine.ready", "engine.exited"] {
            assert_eq!(
                windows_for(event),
                [MAIN_WINDOW_LABEL, PROMPTER_WINDOW_LABEL],
                "{event}"
            );
        }
        for event in studio_control_protocol::EVENT_NAMES {
            let windows = windows_for(event);
            assert!(windows.contains(&MAIN_WINDOW_LABEL), "{event}");
            let prompter_s = ["prompter.changed", "engine.ready", "engine.exited"];
            assert_eq!(
                windows.contains(&PROMPTER_WINDOW_LABEL),
                prompter_s.contains(event),
                "{event}"
            );
        }
        for event in ["audio.meters", "lighting.changed", "", "prompter.changed2"] {
            assert_eq!(windows_for(event), [MAIN_WINDOW_LABEL], "{event:?}");
        }

        let label = |label: &str| label.to_string();
        let mains = windows_for("audio.meters");
        for target in [
            EventTarget::WebviewWindow {
                label: label("main"),
            },
            EventTarget::Window {
                label: label("main"),
            },
            EventTarget::Webview {
                label: label("main"),
            },
            EventTarget::AnyLabel {
                label: label("main"),
            },
        ] {
            assert!(listens_in(&target, mains), "{target:?}");
        }
        for target in [
            EventTarget::WebviewWindow {
                label: label("prompter"),
            },
            EventTarget::AnyLabel {
                label: label("prompter"),
            },
            EventTarget::WebviewWindow {
                label: label("Main"),
            },
            EventTarget::App,
        ] {
            assert!(!listens_in(&target, mains), "{target:?}");
        }
        assert!(listens_in(
            &EventTarget::WebviewWindow {
                label: label("prompter")
            },
            windows_for("prompter.changed")
        ));
    }

    // Each window hears the hardware link on a channel of its own: Tauri runs
    // an event as script in every page that listens to its channel, whether
    // a listener there is for it or not (the review of #251). The pages
    // listen on theirs, the prompter's for its own window.
    #[test]
    fn each_window_hears_the_hardware_link_on_a_channel_of_its_own() {
        assert_eq!(event_channel(MAIN_WINDOW_LABEL), MAIN_EVENT_CHANNEL);
        assert_eq!(event_channel(PROMPTER_WINDOW_LABEL), PROMPTER_EVENT_CHANNEL);
        assert_ne!(MAIN_EVENT_CHANNEL, PROMPTER_EVENT_CHANNEL);

        const OPERATOR_S_PAGE: &str = include_str!(
            "../../../frontend/packages/engine-client/src/transports/tauriTransport.ts"
        );
        const PROMPTER_S_PAGE: &str =
            include_str!("../../../frontend/packages/engine-client/src/transports/glassLink.ts");
        let listens_on = |page: &str, channel: &str| page.contains(&format!("\"{channel}\""));
        assert!(listens_on(OPERATOR_S_PAGE, MAIN_EVENT_CHANNEL));
        assert!(!listens_on(OPERATOR_S_PAGE, PROMPTER_EVENT_CHANNEL));
        assert!(listens_on(PROMPTER_S_PAGE, PROMPTER_EVENT_CHANNEL));
        assert!(!listens_on(PROMPTER_S_PAGE, MAIN_EVENT_CHANNEL));
        assert!(PROMPTER_S_PAGE
            .contains("target: { kind: \"WebviewWindow\", label: PROMPTER_WINDOW_LABEL }"));
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
        assert_eq!(read, 2, "capabilities/ holds the two capabilities");
    }
}
