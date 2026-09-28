//! The display the window is shown on. The shell always shows the screen
//! fullscreen (D22): on the display it was last on when that display is
//! there, else on the 2560×1440 display, else on the display the window is
//! on. The rule is written over snapshots of the monitors, so it is tested
//! without a window. The two window commands are here too, with the
//! sentences the operator reads when one does not finish.
//!
//! The window is held on its display while screens come and go (`Held`):
//! Windows moves windows about when a screen is plugged in or out, and the
//! Prompter XL is plugged in and out. The display is saved by the window
//! commands and by the watch over the screens (`shell_display_watch.rs`),
//! while the screens stand still; until the Prompter XL's window it was
//! saved at every move of the window, Windows' own among them.

use crate::shell_windows::MAIN_WINDOW_LABEL;
use crate::EngineState;
use std::fs::{create_dir_all, read_to_string, remove_file, write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogicalSizeSnapshot {
    width: f64,
    height: f64,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogicalPositionSnapshot {
    x: f64,
    y: f64,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorSnapshot {
    name: Option<String>,
    physical_position: LogicalPositionSnapshot,
    physical_size: LogicalSizeSnapshot,
    logical_size: LogicalSizeSnapshot,
    scale_factor: f64,
}

#[derive(Clone)]
struct AvailableMonitorSnapshot {
    name: Option<String>,
    physical_position: LogicalPositionSnapshot,
    physical_size: LogicalSizeSnapshot,
    scale_factor: f64,
}

/// `shell-window-layout.json`: the display the window was last on, where the
/// next launch shows the screen. New pages program, Slice SW (D22): the
/// windowed layout's fields (`launchMode`, `lastLogicalSize`,
/// `lastLogicalPosition`) are no longer written. A file an older build wrote
/// still loads — serde skips the fields this struct does not name — and
/// whichever layout it saved opens fullscreen on its display.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellWindowPreferences {
    fullscreen: bool,
    monitor: Option<MonitorSnapshot>,
    scale_factor: Option<f64>,
    updated_at_epoch_seconds: u64,
}

/// Where the shell shows the screen, always fullscreen (new pages program,
/// Slice SW, D22).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FullscreenDisplay {
    /// The display the window was last on: its index among the monitors.
    Saved(usize),
    /// The 2560×1440 display: its index among the monitors.
    Studio(usize),
    /// Neither is there: the display the window is on.
    Current,
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn window_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve Tauri config directory: {error}"))?;
    Ok(config_dir.join("shell-window-layout.json"))
}

fn read_window_preferences(app: &AppHandle) -> Option<ShellWindowPreferences> {
    let path = window_preferences_path(app).ok()?;
    let payload = read_to_string(path).ok()?;
    parse_window_preferences(&payload)
}

fn parse_window_preferences(payload: &str) -> Option<ShellWindowPreferences> {
    serde_json::from_str(payload).ok()
}

fn write_window_preferences(
    app: &AppHandle,
    preferences: &ShellWindowPreferences,
) -> Result<(), String> {
    let path = window_preferences_path(app)?;
    if let Some(parent) = path.parent() {
        create_dir_all(parent)
            .map_err(|error| format!("Failed to create shell config directory: {error}"))?;
    }
    let payload = serde_json::to_vec_pretty(preferences)
        .map_err(|error| format!("Failed to serialize shell window preferences: {error}"))?;
    write(&path, payload).map_err(|error| {
        format!(
            "Failed to write shell window preferences {}: {error}",
            path.display()
        )
    })
}

fn remove_window_preferences(app: &AppHandle) -> Result<(), String> {
    let path = window_preferences_path(app)?;
    if path.exists() {
        remove_file(&path).map_err(|error| {
            format!(
                "Failed to remove shell window preferences {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn logical_monitor_size(monitor: &Monitor) -> LogicalSizeSnapshot {
    let scale_factor = monitor.scale_factor();
    LogicalSizeSnapshot {
        width: monitor.size().width as f64 / scale_factor,
        height: monitor.size().height as f64 / scale_factor,
    }
}

fn monitor_snapshot(monitor: &Monitor) -> MonitorSnapshot {
    MonitorSnapshot {
        name: monitor.name().cloned(),
        physical_position: LogicalPositionSnapshot {
            x: monitor.position().x as f64,
            y: monitor.position().y as f64,
        },
        physical_size: LogicalSizeSnapshot {
            width: monitor.size().width as f64,
            height: monitor.size().height as f64,
        },
        logical_size: logical_monitor_size(monitor),
        scale_factor: monitor.scale_factor(),
    }
}

fn available_monitor_snapshot(monitor: &Monitor) -> AvailableMonitorSnapshot {
    AvailableMonitorSnapshot {
        name: monitor.name().cloned(),
        physical_position: LogicalPositionSnapshot {
            x: monitor.position().x as f64,
            y: monitor.position().y as f64,
        },
        physical_size: LogicalSizeSnapshot {
            width: monitor.size().width as f64,
            height: monitor.size().height as f64,
        },
        scale_factor: monitor.scale_factor(),
    }
}

fn same_size(monitor: &AvailableMonitorSnapshot, saved: &MonitorSnapshot) -> bool {
    (saved.physical_size.width - monitor.physical_size.width).abs() < 1.0
        && (saved.physical_size.height - monitor.physical_size.height).abs() < 1.0
}

/// Whether `monitor` stands where the saved display stood: the same place on
/// the desktop, the same size and the same scale.
fn same_place(monitor: &AvailableMonitorSnapshot, saved: &MonitorSnapshot) -> bool {
    let position_matches = (saved.physical_position.x - monitor.physical_position.x).abs() < 1.0
        && (saved.physical_position.y - monitor.physical_position.y).abs() < 1.0;
    let scale_matches = (saved.scale_factor - monitor.scale_factor).abs() < 0.01;

    same_size(monitor, saved) && position_matches && scale_matches
}

/// Whether `monitor` has the saved display's name and its size.
fn same_name_and_size(monitor: &AvailableMonitorSnapshot, saved: &MonitorSnapshot) -> bool {
    saved
        .name
        .as_ref()
        .zip(monitor.name.as_ref())
        .is_some_and(|(saved_name, monitor_name)| saved_name == monitor_name)
        && same_size(monitor, saved)
}

/// The saved display among the monitors: the one that stands in its place,
/// else the one with its name and its size. The place comes first because
/// Windows names a display by a number (`\\.\DISPLAY3`), and at the next
/// start that number can belong to another display; until 2026-09-28 the name
/// came first, and the screen could open on the wrong one. A name on a
/// display of another size is another display.
fn saved_monitor_index_from_snapshots(
    monitors: &[AvailableMonitorSnapshot],
    saved: Option<&MonitorSnapshot>,
) -> Option<usize> {
    let saved = saved?;
    monitors
        .iter()
        .position(|monitor| same_place(monitor, saved))
        .or_else(|| {
            monitors
                .iter()
                .position(|monitor| same_name_and_size(monitor, saved))
        })
}

/// The shell's one rule, over snapshots of the monitors so it can be tested
/// without a window: the saved display when it is there (by its place, else
/// by its name and size), else the 2560×1440 display, else the display the
/// window is on.
fn fullscreen_display(
    monitors: &[AvailableMonitorSnapshot],
    saved: Option<&MonitorSnapshot>,
) -> FullscreenDisplay {
    if let Some(index) = saved_monitor_index_from_snapshots(monitors, saved) {
        return FullscreenDisplay::Saved(index);
    }
    monitors
        .iter()
        .position(|monitor| monitor_matches_logical_size(monitor, 2560, 1440))
        .map_or(FullscreenDisplay::Current, FullscreenDisplay::Studio)
}

pub(crate) fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main Tauri window is unavailable.".to_string())
}

/// Brings the operator's window forward when a second copy of the shell was
/// launched (2026-09 production readiness, Slice 5 — finding F19): the
/// second copy hands over and exits, and the one that is running may be
/// minimised behind the show.
pub(crate) fn focus_main_window(app: &AppHandle) {
    if let Ok(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn window_scale_factor(window: &WebviewWindow) -> f64 {
    window
        .scale_factor()
        .ok()
        .filter(|scale| scale.is_finite() && *scale > 0.0)
        .or_else(|| {
            window
                .current_monitor()
                .ok()
                .flatten()
                .map(|monitor| monitor.scale_factor())
        })
        .unwrap_or(1.0)
}

fn capture_current_window_preferences(window: &WebviewWindow) -> ShellWindowPreferences {
    ShellWindowPreferences {
        fullscreen: window.is_fullscreen().unwrap_or(false),
        monitor: window
            .current_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor_snapshot(&monitor)),
        scale_factor: Some(window_scale_factor(window)),
        updated_at_epoch_seconds: now_epoch_seconds(),
    }
}

pub(crate) fn persist_current_window_preferences(app: &AppHandle, window: &WebviewWindow) {
    let preferences = capture_current_window_preferences(window);
    let _ = write_window_preferences(app, &preferences);
}

fn monitor_matches_logical_size(
    monitor: &AvailableMonitorSnapshot,
    target_width: u32,
    target_height: u32,
) -> bool {
    let scale_factor = monitor.scale_factor;
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return false;
    }

    let logical_width = (monitor.physical_size.width / scale_factor).round() as u32;
    let logical_height = (monitor.physical_size.height / scale_factor).round() as u32;
    logical_width == target_width && logical_height == target_height
}

/// The monitor `fullscreen_display` names — the saved display (`saved`), else
/// the studio monitor, else the display the window is on. When the system
/// lists no monitors, only the last is left.
fn fullscreen_monitor(window: &WebviewWindow, saved: Option<&MonitorSnapshot>) -> Option<Monitor> {
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor_snapshots = monitors
        .iter()
        .map(available_monitor_snapshot)
        .collect::<Vec<_>>();
    let listed = match fullscreen_display(&monitor_snapshots, saved) {
        FullscreenDisplay::Saved(index) | FullscreenDisplay::Studio(index) => {
            monitors.get(index).cloned()
        }
        FullscreenDisplay::Current => None,
    };
    listed.or_else(|| window.current_monitor().ok().flatten())
}

fn route_window_to_monitor(window: &WebviewWindow, monitor: &Monitor) -> Result<(), String> {
    let _ = window.set_fullscreen(false);
    window
        .set_position(PhysicalPosition::new(
            monitor.position().x,
            monitor.position().y,
        ))
        .map_err(|error| format!("Failed to position window on monitor: {error}"))?;
    window
        .set_size(PhysicalSize::new(
            monitor.size().width,
            monitor.size().height,
        ))
        .map_err(|error| format!("Failed to size window for monitor: {error}"))?;
    window
        .set_fullscreen(true)
        .map_err(|error| format!("Failed to enter fullscreen: {error}"))
}

/// Shows the screen fullscreen on the monitor `fullscreen_monitor` picks.
fn route_window_fullscreen(
    window: &WebviewWindow,
    saved: Option<&MonitorSnapshot>,
) -> Result<(), String> {
    let monitor = fullscreen_monitor(window, saved)
        .ok_or_else(|| NO_MONITOR_FOR_STUDIO_FULLSCREEN.to_string())?;
    route_window_to_monitor(window, &monitor)
}

/// What the window needs once the screens have changed and stand still.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AfterTheScreensChanged {
    /// It stands fullscreen on the display it belongs on.
    Nothing,
    /// Windows moved it, or its display is gone: it goes where the shell's
    /// one rule sends it.
    Route(FullscreenDisplay),
}

/// The rule of `Held::put_back`, over snapshots: `on` is the monitor the
/// window stands on, `belongs_on` the display it stood on while the screens
/// last stood still.
fn after_the_screens_changed(
    monitors: &[AvailableMonitorSnapshot],
    on: Option<&AvailableMonitorSnapshot>,
    fullscreen: bool,
    belongs_on: Option<&MonitorSnapshot>,
) -> AfterTheScreensChanged {
    let in_place = fullscreen
        && on
            .zip(belongs_on)
            .is_some_and(|(on, belongs_on)| same_place(on, belongs_on));
    if in_place {
        AfterTheScreensChanged::Nothing
    } else {
        AfterTheScreensChanged::Route(fullscreen_display(monitors, belongs_on))
    }
}

/// The display the window belongs on, as the watch over the screens keeps
/// it: the one it stood on while the screens last stood still.
pub(crate) struct Held {
    display: Option<MonitorSnapshot>,
}

impl Held {
    /// The display saved at the start, when the window was shown on it.
    pub(crate) fn from_saved(app: &AppHandle) -> Self {
        Self {
            display: read_window_preferences(app).and_then(|preferences| preferences.monitor),
        }
    }

    /// While the screens stand still, the display the window stands on is
    /// the one it belongs on. When it is another than before, a window
    /// command put it there, or the operator did with Windows' own keys: it
    /// is saved for the next start.
    pub(crate) fn follow(&mut self, app: &AppHandle) {
        let Ok(window) = main_window(app) else {
            return;
        };
        let Some(monitor) = window.current_monitor().ok().flatten() else {
            return;
        };
        let stands_on = available_monitor_snapshot(&monitor);
        let as_before = self
            .display
            .as_ref()
            .is_some_and(|display| same_place(&stands_on, display));
        if !as_before {
            self.display = Some(monitor_snapshot(&monitor));
            persist_current_window_preferences(app, &window);
        }
    }

    /// The screens changed and stand still again: the window is put back on
    /// the display it belongs on when Windows moved it, and fullscreen. A
    /// window that stands where it stood is left alone.
    pub(crate) fn put_back(&mut self, app: &AppHandle) {
        let Ok(window) = main_window(app) else {
            return;
        };
        let monitors = window.available_monitors().unwrap_or_default();
        let snapshots = monitors
            .iter()
            .map(available_monitor_snapshot)
            .collect::<Vec<_>>();
        let on = window
            .current_monitor()
            .ok()
            .flatten()
            .map(|monitor| available_monitor_snapshot(&monitor));
        let fullscreen = window.is_fullscreen().unwrap_or(false);
        let needed =
            after_the_screens_changed(&snapshots, on.as_ref(), fullscreen, self.display.as_ref());
        if needed == AfterTheScreensChanged::Nothing {
            return;
        }
        match route_window_fullscreen(&window, self.display.as_ref()) {
            Ok(()) => {
                log_shell_line(
                    app,
                    "The screens changed: the window was put back on its display.",
                );
                persist_current_window_preferences(app, &window);
                self.display = window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .map(|monitor| monitor_snapshot(&monitor));
            }
            Err(detail) => log_shell_line(
                app,
                &format!("The screens changed, and the window was not put back: {detail}"),
            ),
        }
    }
}

/// New pages program, Slice SW (D22): the shell always shows the screen
/// fullscreen — on the display it was last on when that display is there,
/// else on the 2560×1440 display, else on the display the window is on. Until
/// then a saved windowed layout was restored as it was, and a missing display
/// (or no saved file and neither a 2560×1440 nor a 1920×1080 monitor) opened
/// the windowed layout, 1600 × 960 and centred.
pub(crate) fn restore_or_route_initial_window(app: &AppHandle, window: &WebviewWindow) {
    let saved = read_window_preferences(app).and_then(|preferences| preferences.monitor);
    match route_window_fullscreen(window, saved.as_ref()) {
        Ok(()) => persist_current_window_preferences(app, window),
        Err(detail) => log_shell_line(
            app,
            &format!("The window did not go fullscreen at launch: {detail}"),
        ),
    }
}

/// The one window-command refusal that is already the operator's sentence.
const NO_MONITOR_FOR_STUDIO_FULLSCREEN: &str = "No monitor is available for studio fullscreen.";

/// The two window commands: keys in Setup / Support › Workstation, and the
/// reset on the recovery screens too (new pages program, Slice 3, decision 2).
/// The windowed layout's command went with the windowed layout in Slice SW
/// (D22).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowCommand {
    StudioFullscreen,
    ResetLayout,
}

impl WindowCommand {
    /// What shell.log calls the command.
    fn log_name(self) -> &'static str {
        match self {
            WindowCommand::StudioFullscreen => "Studio fullscreen",
            WindowCommand::ResetLayout => "Window layout reset",
        }
    }
}

/// The sentence the operator reads when a window command did not finish. The
/// screens show a refusal as it stands, so it says in the app's words what
/// did not happen; the detail — the webview's own error, a file path — goes
/// to shell.log. Only the fullscreen command's missing monitor is said as is.
fn window_command_refusal(command: WindowCommand, detail: &str) -> String {
    let sentence = match command {
        WindowCommand::StudioFullscreen if detail == NO_MONITOR_FOR_STUDIO_FULLSCREEN => detail,
        WindowCommand::StudioFullscreen => "Studio fullscreen did not start.",
        WindowCommand::ResetLayout => "The window layout was not reset.",
    };
    sentence.to_string()
}

/// Runs a window command; a failure is logged in full and answered with the
/// operator's sentence.
fn run_window_command(
    app: &AppHandle,
    command: WindowCommand,
    run: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    run().map_err(|detail| {
        log_shell_line(
            app,
            &format!("{} did not finish: {detail}", command.log_name()),
        );
        window_command_refusal(command, &detail)
    })
}

/// One line in shell.log, through the handle the engine's stderr shares.
pub(crate) fn log_shell_line(app: &AppHandle, message: &str) {
    app.state::<EngineState>()
        .bridge
        .log_shell_line("SHELL", message);
}

/// Fullscreen on the studio monitor, else on the display the window is on,
/// remembered for the next launch.
#[tauri::command]
pub(crate) fn shell_enter_studio_fullscreen(app: AppHandle) -> Result<(), String> {
    run_window_command(&app, WindowCommand::StudioFullscreen, || {
        let window = main_window(&app)?;
        route_window_fullscreen(&window, None)?;
        persist_current_window_preferences(&app, &window);
        Ok(())
    })
}

/// Forgets the saved display, then goes fullscreen as Studio fullscreen does.
/// Until Slice SW a workstation without a studio monitor got the windowed
/// layout here.
#[tauri::command]
pub(crate) fn shell_reset_window_layout(app: AppHandle) -> Result<(), String> {
    run_window_command(&app, WindowCommand::ResetLayout, || {
        let window = main_window(&app)?;
        remove_window_preferences(&app)?;
        route_window_fullscreen(&window, None)?;
        persist_current_window_preferences(&app, &window);
        Ok(())
    })
}

#[cfg(test)]
mod shell_window_command_tests {
    use super::*;

    // New pages program, Slice 3 (decision 2): the window commands are keys on
    // the operator's screens now, and a refusal is shown as it stands. Old: the
    // shell's own errors — "Main Tauri window is unavailable.", "Failed to
    // remove shell window preferences <path>: …", "Failed to leave
    // fullscreen: …", "Failed to set fallback window size: …", "Failed to
    // position window on monitor: …". New: one sentence per command in the
    // app's words; the detail goes to shell.log. The missing monitor is said as
    // it always was. Slice SW (D22): the windowed layout's command, and the
    // details only it gave, went with the windowed layout.
    #[test]
    fn window_command_refusals_are_the_operators_sentences() {
        assert_eq!(
            window_command_refusal(
                WindowCommand::StudioFullscreen,
                NO_MONITOR_FOR_STUDIO_FULLSCREEN
            ),
            "No monitor is available for studio fullscreen."
        );

        let details = [
            "Main Tauri window is unavailable.",
            r"Failed to remove shell window preferences C:\Users\operator\AppData\Roaming\com.sse.exedstudiocontrol\shell-window-layout.json: Access is denied. (os error 5)",
            "Failed to resolve Tauri config directory: unknown path",
            "Failed to position window on monitor: the underlying handle is not available",
            "Failed to size window for monitor: the underlying handle is not available",
            "Failed to enter fullscreen: the underlying handle is not available",
        ];
        for (command, sentence) in [
            (
                WindowCommand::StudioFullscreen,
                "Studio fullscreen did not start.",
            ),
            (
                WindowCommand::ResetLayout,
                "The window layout was not reset.",
            ),
        ] {
            for detail in details {
                let refusal = window_command_refusal(command, detail);
                assert_eq!(refusal, sentence, "{command:?} refusing {detail:?}");
                for word in ["Tauri", "fallback", "Failed", "error", "engine", "\\"] {
                    assert!(!refusal.contains(word), "{refusal:?} carries {word:?}");
                }
            }
        }

        // The missing-monitor sentence is the fullscreen command's alone.
        assert_eq!(
            window_command_refusal(WindowCommand::ResetLayout, NO_MONITOR_FOR_STUDIO_FULLSCREEN),
            "The window layout was not reset."
        );
    }
}

#[cfg(test)]
mod shell_window_preferences_tests {
    use super::*;

    fn logical_size(width: f64, height: f64) -> LogicalSizeSnapshot {
        LogicalSizeSnapshot { width, height }
    }

    fn logical_position(x: f64, y: f64) -> LogicalPositionSnapshot {
        LogicalPositionSnapshot { x, y }
    }

    fn saved_monitor(
        name: Option<&str>,
        position: (f64, f64),
        physical_size: (f64, f64),
        scale_factor: f64,
    ) -> MonitorSnapshot {
        MonitorSnapshot {
            name: name.map(ToString::to_string),
            physical_position: logical_position(position.0, position.1),
            physical_size: logical_size(physical_size.0, physical_size.1),
            logical_size: logical_size(
                physical_size.0 / scale_factor,
                physical_size.1 / scale_factor,
            ),
            scale_factor,
        }
    }

    fn available_monitor(
        name: Option<&str>,
        position: (f64, f64),
        physical_size: (f64, f64),
        scale_factor: f64,
    ) -> AvailableMonitorSnapshot {
        AvailableMonitorSnapshot {
            name: name.map(ToString::to_string),
            physical_position: logical_position(position.0, position.1),
            physical_size: logical_size(physical_size.0, physical_size.1),
            scale_factor,
        }
    }

    fn preferences_with_monitor(monitor: Option<MonitorSnapshot>) -> ShellWindowPreferences {
        ShellWindowPreferences {
            fullscreen: true,
            monitor,
            scale_factor: Some(1.0),
            updated_at_epoch_seconds: 1,
        }
    }

    fn studio_review_saved() -> ShellWindowPreferences {
        preferences_with_monitor(Some(saved_monitor(
            Some("Studio Review"),
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        )))
    }

    // New pages program, Slice SW (D22): the screen is always fullscreen — on
    // the display it was last on when that display is there, else on the
    // 2560×1440 display, else on the display the window is on. Until then a
    // missing display opened the windowed layout, and a 1920×1080 monitor
    // stood in for the studio one.
    #[test]
    fn shell_window_preferences_saved_monitor_matches_by_name_when_it_moved() {
        // The display keeps its name and its size and stands elsewhere on the
        // desktop: another display was put beside it.
        let preferences = studio_review_saved();
        let available = [
            available_monitor(Some("Studio"), (0.0, 0.0), (2560.0, 1440.0), 1.0),
            available_monitor(Some("Studio Review"), (5120.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            Some(1)
        );
        // The display it was last on comes before the studio display.
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Saved(1)
        );
    }

    // 2026-09-28: Windows numbers the displays, and the numbers can swap from
    // one start to the next. The studio has two 2560×1440 displays side by
    // side; the screen was saved on the right-hand one, `DISPLAY3`. After a
    // swap the left-hand one is `DISPLAY3`. The place decides, so the screen
    // opens where it was; until then the name decided, and it opened on the
    // other display.
    #[test]
    fn shell_window_preferences_saved_monitor_is_found_by_its_place_when_the_numbers_swapped() {
        let preferences = preferences_with_monitor(Some(saved_monitor(
            Some(r"\\.\DISPLAY3"),
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        )));
        let swapped = [
            available_monitor(Some(r"\\.\DISPLAY3"), (0.0, 0.0), (2560.0, 1440.0), 1.0),
            available_monitor(Some(r"\\.\DISPLAY1"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&swapped, preferences.monitor.as_ref()),
            Some(1)
        );
        assert_eq!(
            fullscreen_display(&swapped, preferences.monitor.as_ref()),
            FullscreenDisplay::Saved(1)
        );
    }

    // A name on a display of another size is another display: the screen goes
    // to the studio display.
    #[test]
    fn shell_window_preferences_a_name_on_a_display_of_another_size_does_not_count() {
        let preferences = studio_review_saved();
        let available = [
            available_monitor(Some("Studio"), (0.0, 0.0), (2560.0, 1440.0), 1.0),
            available_monitor(Some("Studio Review"), (100.0, 100.0), (1920.0, 1080.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            None
        );
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Studio(0)
        );
    }

    #[test]
    fn shell_window_preferences_saved_monitor_matches_by_geometry_without_name() {
        let preferences = preferences_with_monitor(Some(saved_monitor(
            None,
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        )));
        let available = [
            available_monitor(Some("Side"), (0.0, 0.0), (1920.0, 1080.0), 1.0),
            available_monitor(Some("Renamed Studio"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            Some(1)
        );
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Saved(1)
        );
    }

    #[test]
    fn shell_window_preferences_saved_monitor_missing_goes_to_the_studio_display() {
        let preferences = studio_review_saved();
        let available = [
            available_monitor(Some("Side"), (0.0, 0.0), (1920.0, 1080.0), 1.0),
            available_monitor(Some("Studio"), (1920.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        assert_eq!(
            saved_monitor_index_from_snapshots(&available, preferences.monitor.as_ref()),
            None
        );
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Studio(1)
        );
        // A file that saved no display, and no file at all, go there too.
        assert_eq!(
            fullscreen_display(&available, preferences_with_monitor(None).monitor.as_ref()),
            FullscreenDisplay::Studio(1)
        );
        assert_eq!(
            fullscreen_display(&available, None),
            FullscreenDisplay::Studio(1)
        );
    }

    #[test]
    fn shell_window_preferences_without_saved_or_studio_monitor_use_the_current_display() {
        // The studio display is 2560×1440 in logical pixels: a 2560×1440 panel
        // at 125 % is 2048×1152 and is not it, and a 1920×1080 one no longer
        // stands in for it.
        let preferences = studio_review_saved();
        let available = [
            available_monitor(Some("Side"), (0.0, 0.0), (1920.0, 1080.0), 1.0),
            available_monitor(
                Some("Studio at 125 %"),
                (1920.0, 0.0),
                (2560.0, 1440.0),
                1.25,
            ),
        ];

        for saved in [preferences.monitor.as_ref(), None] {
            assert_eq!(
                fullscreen_display(&available, saved),
                FullscreenDisplay::Current
            );
        }
        // No monitor listed at all.
        assert_eq!(
            fullscreen_display(&[], preferences.monitor.as_ref()),
            FullscreenDisplay::Current
        );
    }

    // §7: Studio Control's own window stays on the studio display while the
    // Prompter XL is plugged in and out. Windows moves windows about when the
    // screens change; once they stand still the window is put back, and a
    // window that stands where it stood is left alone.
    #[test]
    fn after_the_screens_changed_the_window_goes_back_to_its_display() {
        let belongs_on = saved_monitor(Some(r"\\.\DISPLAY2"), (2560.0, 0.0), (2560.0, 1440.0), 1.0);
        let primary = available_monitor(Some(r"\\.\DISPLAY3"), (0.0, 0.0), (2560.0, 1440.0), 1.25);
        let studio = available_monitor(Some(r"\\.\DISPLAY2"), (2560.0, 0.0), (2560.0, 1440.0), 1.0);
        let prompter =
            available_monitor(Some(r"\\.\DISPLAY4"), (5120.0, 0.0), (1920.0, 1080.0), 1.0);
        let with_prompter = [primary.clone(), studio.clone(), prompter.clone()];

        // It stands where it stood: nothing is done, and nothing flickers.
        assert_eq!(
            after_the_screens_changed(&with_prompter, Some(&studio), true, Some(&belongs_on)),
            AfterTheScreensChanged::Nothing
        );
        // Windows moved it to the primary, or onto the Prompter XL.
        for moved_to in [&primary, &prompter] {
            assert_eq!(
                after_the_screens_changed(&with_prompter, Some(moved_to), true, Some(&belongs_on)),
                AfterTheScreensChanged::Route(FullscreenDisplay::Saved(1))
            );
        }
        // It stands on its display and is no longer fullscreen.
        assert_eq!(
            after_the_screens_changed(&with_prompter, Some(&studio), false, Some(&belongs_on)),
            AfterTheScreensChanged::Route(FullscreenDisplay::Saved(1))
        );
        // Windows numbered the screens anew: the place decides.
        let renumbered = [
            available_monitor(Some(r"\\.\DISPLAY2"), (0.0, 0.0), (2560.0, 1440.0), 1.25),
            available_monitor(Some(r"\\.\DISPLAY5"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];
        assert_eq!(
            after_the_screens_changed(&renumbered, Some(&renumbered[0]), true, Some(&belongs_on)),
            AfterTheScreensChanged::Route(FullscreenDisplay::Saved(1))
        );
        // Its display is gone: the shell's one rule sends it on, to the
        // 2560×1440 display, else to where it stands.
        let without_it = [primary.clone(), prompter.clone()];
        assert_eq!(
            after_the_screens_changed(&without_it, Some(&primary), true, Some(&belongs_on)),
            AfterTheScreensChanged::Route(FullscreenDisplay::Current)
        );
        // No display was ever saved, or the window stands on none.
        assert_eq!(
            after_the_screens_changed(&with_prompter, Some(&studio), true, None),
            AfterTheScreensChanged::Route(FullscreenDisplay::Studio(1))
        );
        assert_eq!(
            after_the_screens_changed(&with_prompter, None, true, Some(&belongs_on)),
            AfterTheScreensChanged::Route(FullscreenDisplay::Saved(1))
        );
    }

    // Slice SW (D22): a file an older build wrote still loads — the windowed
    // layout's too — and opens fullscreen on its display. What is written now
    // carries the display and none of the windowed layout's fields.
    #[test]
    fn shell_window_preferences_from_an_older_build_still_load() {
        let windowed = r#"{
  "launchMode": "windowed",
  "lastLogicalSize": { "width": 1600.0, "height": 960.0 },
  "lastLogicalPosition": { "x": 3040.0, "y": 240.0 },
  "fullscreen": false,
  "monitor": {
    "name": "\\\\.\\DISPLAY3",
    "physicalPosition": { "x": 2560.0, "y": 0.0 },
    "physicalSize": { "width": 2560.0, "height": 1440.0 },
    "logicalSize": { "width": 2560.0, "height": 1440.0 },
    "scaleFactor": 1.0
  },
  "scaleFactor": 1.0,
  "updatedAtEpochSeconds": 1790000000
}"#;
        let studio_fullscreen = windowed
            .replace(r#""windowed""#, r#""studioFullscreen""#)
            .replace(r#""fullscreen": false"#, r#""fullscreen": true"#);
        let available = [
            available_monitor(Some(r"\\.\DISPLAY1"), (0.0, 0.0), (2560.0, 1440.0), 1.0),
            available_monitor(Some(r"\\.\DISPLAY3"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];

        for payload in [windowed, studio_fullscreen.as_str()] {
            let preferences =
                parse_window_preferences(payload).expect("an older build's file loads");
            assert_eq!(
                fullscreen_display(&available, preferences.monitor.as_ref()),
                FullscreenDisplay::Saved(1),
                "{payload}"
            );
        }

        let no_display = r#"{"launchMode":"windowed","lastLogicalSize":null,"lastLogicalPosition":null,"fullscreen":false,"monitor":null,"scaleFactor":null,"updatedAtEpochSeconds":1}"#;
        let preferences =
            parse_window_preferences(no_display).expect("a file without a display loads");
        assert_eq!(
            fullscreen_display(&available, preferences.monitor.as_ref()),
            FullscreenDisplay::Studio(0)
        );

        let written = serde_json::to_value(preferences_with_monitor(Some(saved_monitor(
            Some(r"\\.\DISPLAY3"),
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        ))))
        .expect("the preferences serialise");
        for gone in ["launchMode", "lastLogicalSize", "lastLogicalPosition"] {
            assert!(written.get(gone).is_none(), "{gone} is still written");
        }
        let read_back =
            parse_window_preferences(&written.to_string()).expect("what is written loads");
        assert_eq!(
            fullscreen_display(&available, read_back.monitor.as_ref()),
            FullscreenDisplay::Saved(1)
        );
    }
}
