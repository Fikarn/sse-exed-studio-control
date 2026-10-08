// Release builds are a GUI app: without this, the console-subsystem default
// opens a terminal on every launch and the engine child inherits it, spilling
// engine stderr onto the operator monitor. Dev builds keep the console.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The shell, by file:
//
// - `main.rs`: the state every command shares, and `main()`, which builds
//   the app and the operator's window.
// - `engine.rs`: the hardware link's process, its pipe and its watcher.
// - `shell_commands.rs`: the commands the pages call to start, ask and stop
//   the hardware link, and to close the window.
// - `shell_paths.rs`: the folders the shell opens for the operator, and the
//   diagnostics report it writes.
// - `shell_window_layout.rs`: the display the window is shown on, and the
//   two window commands.
// - `shell_displays.rs`: the screens, as Windows' display configuration
//   gives them.
// - `shell_display_watch.rs`: the watch over the screens, once a second.
// - `shell_prompter_window.rs`: the prompter's window, on the Prompter XL.
// - `shell_windows.rs`: building a window from its `tauri.conf.json` entry,
//   and which window hears which event.
// - `shell_browser_keys.rs`: WebView2's own keys, switched off.
// - `shell_smoke.rs`: the `--smoke-test` mode.
// - `shell_test_bridge.rs`: the commands of the `test-bridge` feature.
// - `shell_log.rs`: `shell.log`.
// - `shell_pictures.rs`: the pictures' link, on which the pictures helper
//   gets its surface and is told what to draw.
// - `shell_picture_layer.rs`: the native layer the pictures are drawn in,
//   topmost on the main window.

mod engine;
mod shell_browser_keys;
mod shell_commands;
mod shell_display_watch;
mod shell_displays;
mod shell_log;
mod shell_paths;
mod shell_picture_layer;
mod shell_pictures;
mod shell_prompter_window;
mod shell_smoke;
#[cfg(feature = "test-bridge")]
mod shell_test_bridge;
mod shell_window_layout;
mod shell_windows;

use engine::EngineBridge;
use shell_browser_keys::switch_off_browser_keys;
use shell_commands::gated;
use shell_display_watch::start_display_watch;
use shell_prompter_window::{close_with_the_app, PrompterWindowState, WatchWake};
use shell_smoke::run_smoke_test;
use shell_window_layout::{focus_main_window, restore_or_route_initial_window, HeldDisplay};
use shell_windows::{build_main_window, MAIN_WINDOW_LABEL};
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::Arc;
use tauri::{Emitter, Manager};

pub(crate) struct EngineState {
    /// Shared with the blocking tasks the async commands hand their waits to
    /// (2026-09 production readiness, Slice 4 — finding F07).
    pub(crate) bridge: Arc<EngineBridge>,
    /// Set by `shell_confirm_close` once the operator confirmed the close
    /// dialog; the `CloseRequested` hook lets the window close only then
    /// (2026-09 audit Slice 11).
    pub(crate) close_confirmed: AtomicBool,
}

/// Raised on the main window when the operator asks to close it and the
/// close still needs confirming; the frontend answers with the dialog and
/// `shell_confirm_close`.
const SHELL_CLOSE_REQUESTED_EVENT: &str = "shell://close-requested";

fn main() {
    let args = env::args().collect::<Vec<_>>();
    if args.iter().any(|value| value == "--smoke-test") {
        std::process::exit(run_smoke_test(&args));
    }

    // What wakes the watch over the screens before its second is over.
    let (wake, woken) = sync_channel::<()>(1);

    let builder = tauri::Builder::default()
        // One shell per workstation (2026-09 production readiness, Slice 5 —
        // finding F19): registered first so it runs before anything else
        // initialises and before the window exists. A second launch hands
        // its arguments to the running shell, which brings its window
        // forward, and exits. The engine's own lock on
        // `<app-data>/engine.lock` guards the database and the light
        // outputs as well.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .manage(EngineState {
            bridge: Arc::new(EngineBridge::default()),
            close_confirmed: AtomicBool::new(false),
        })
        .manage(HeldDisplay::default())
        .manage(PrompterWindowState::default())
        .manage(WatchWake(wake))
        .setup(|app| {
            // Slice 6b: the main window is `"create": false` in tauri.conf.json,
            // so Tauri no longer builds it just before this closure: it is
            // built here, first, from that entry, with WebView2's
            // clipboard-read permission (`shell_windows.rs`). A failure fails
            // the setup, as Tauri's own build did.
            let window = build_main_window(app.handle())?;
            // Decision 12: WebView2's own reload, find, print and zoom
            // keys go off first — before WebView2 delivers the page's
            // first NavigationStarting, and before the window shows.
            switch_off_browser_keys(app.handle(), &window);
            let _ = window.show();
            let app_handle = app.handle().clone();
            restore_or_route_initial_window(&app_handle, &window);
            // The native layer the pictures helper draws the cameras'
            // pictures in, topmost on this window, once the window stands
            // where it stays: in every build, the studio's included (D34).
            shell_picture_layer::start(&app_handle, &window);
            // The window's display is saved by the watch over the screens,
            // which starts now that the window stands on it, and by the
            // window commands: no longer at every move of the window, which
            // saved the display Windows moved it to when a screen came or
            // went. The watch keeps the prompter's window too, which it
            // opens at its first look.
            start_display_watch(&app_handle, woken);
            let window_for_events = window.clone();
            window.on_window_event(move |event| match event {
                // 2026-09 audit Slice 11: closing asks first. Until the
                // operator confirms, keep the window and let the frontend
                // raise the dialog.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let confirmed = app_handle
                        .state::<EngineState>()
                        .close_confirmed
                        .load(Ordering::SeqCst);
                    if !confirmed {
                        api.prevent_close();
                        let _ = window_for_events.emit_to(
                            MAIN_WINDOW_LABEL,
                            SHELL_CLOSE_REQUESTED_EVENT,
                            (),
                        );
                    } else {
                        // The layer lets go of the window before the window goes.
                        shell_picture_layer::stop();
                    }
                }
                // The app ends with the operator's window. Tauri ends it
                // when the last window closes, so the prompter's goes with
                // this one, however this one went.
                tauri::WindowEvent::Destroyed => close_with_the_app(&app_handle),
                _ => {}
            });
            Ok(())
        });

    // Every command stands behind `gated`: a window calls what its name
    // allows (`shell_commands::window_may_call`).
    #[cfg(feature = "test-bridge")]
    let builder = builder.invoke_handler(gated(tauri::generate_handler![
        shell_commands::engine_start,
        shell_commands::engine_request,
        shell_commands::engine_stop,
        shell_commands::engine_summary,
        shell_paths::shell_open_path,
        shell_paths::shell_export_diagnostics,
        shell_window_layout::shell_enter_studio_fullscreen,
        shell_window_layout::shell_reset_window_layout,
        shell_commands::shell_confirm_close,
        shell_prompter_window::prompter_window_alive,
        shell_pictures::pictures_place,
        shell_test_bridge::shell_test_bridge_config,
        shell_test_bridge::shell_test_bridge_write_status,
        shell_test_bridge::shell_test_bridge_read_command,
        shell_test_bridge::shell_test_bridge_export_diagnostics_to
    ]));

    #[cfg(not(feature = "test-bridge"))]
    let builder = builder.invoke_handler(gated(tauri::generate_handler![
        shell_commands::engine_start,
        shell_commands::engine_request,
        shell_commands::engine_stop,
        shell_commands::engine_summary,
        shell_paths::shell_open_path,
        shell_paths::shell_export_diagnostics,
        shell_window_layout::shell_enter_studio_fullscreen,
        shell_window_layout::shell_reset_window_layout,
        shell_commands::shell_confirm_close,
        shell_prompter_window::prompter_window_alive,
        shell_pictures::pictures_place
    ]));

    let mut context = tauri::generate_context!();
    if studio_control_protocol::development::development_build() {
        mark_as_development(context.config_mut());
    }

    builder.run(context).expect("failed to run tauri shell");
}

/// A development build (`studio_control_protocol::development`) is an app
/// of its own beside the studio's. Tauri keys three things on the
/// identifier: the one-shell lock, the folder of `shell-window-layout.json`,
/// and WebView2's profile, where the pages keep the operator's column widths
/// and stage view. Under the studio's identifier a development shell handed
/// its launch to the running studio app and exited, and one started alone
/// wrote the studio's saved display and profile. The saved data has its own
/// refusal (`engine::resolve_runtime_directories`).
fn mark_as_development(config: &mut tauri::Config) {
    config.identifier = format!("{}.dev", config.identifier);
    for window in &mut config.app.windows {
        window.title = format!("{} (development)", window.title);
    }
}

#[cfg(test)]
mod development_identity_tests {
    use super::mark_as_development;

    #[test]
    fn a_development_build_is_an_app_of_its_own() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let studio_identifier = config.identifier.clone();
        let studio_title = config.app.windows[0].title.clone();

        mark_as_development(&mut config);

        assert_eq!(config.identifier, format!("{studio_identifier}.dev"));
        assert_eq!(
            config.app.windows[0].title,
            format!("{studio_title} (development)")
        );
        assert_eq!(config.app.windows[0].label, "main");
        // The prompter's window too: a development build's is told from the
        // studio's by its title.
        assert_eq!(config.app.windows[1].label, "prompter");
        assert_eq!(
            config.app.windows[1].title,
            "SSE ExEd Studio Control: the prompter (development)"
        );
    }
}
