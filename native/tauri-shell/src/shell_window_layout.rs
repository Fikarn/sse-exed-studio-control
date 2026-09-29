//! The display the window is shown on. The shell always shows the screen
//! fullscreen (D22): on the display it was last on when that display is
//! there, else on the 2560×1440 display, else on the display the window is
//! on. The rule is written over snapshots of the monitors, so it is tested
//! without a window. The two window commands are here too, with the
//! sentences the operator reads when one does not finish.
//!
//! The window is held on its display while screens come and go
//! (`HeldDisplay`): Windows moves windows about when a screen is plugged in
//! or out, and the Prompter XL is plugged in and out. A display is known by
//! its screen's own name (`HP E273q`, which the display route reads:
//! `shell_displays.rs`), then by its place on the desktop, then by the name
//! Windows numbers it with. While the window's display is away (switched
//! off, asleep, unplugged) the window stays where Windows put it and the
//! display is remembered; when it returns, the window goes back.
//!
//! The display is saved by the window commands and by the watch over the
//! screens (`shell_display_watch.rs`), while the screens stand still; until
//! the Prompter XL's window it was saved at every move of the window,
//! Windows' own among them.

use crate::shell_displays::{read_display_paths, DisplayPath};
use crate::shell_windows::MAIN_WINDOW_LABEL;
use crate::EngineState;
use std::fs::{create_dir_all, read_to_string, remove_file, rename, write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
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
    /// Windows' name for the display, a number: `\\.\DISPLAY2`.
    name: Option<String>,
    /// The screen's own name, from its EDID: `HP E273q`. A file written
    /// before the Prompter XL's window has none; nor has a display that two
    /// screens show, or one whose screen gives no name.
    screen: Option<String>,
    physical_position: LogicalPositionSnapshot,
    physical_size: LogicalSizeSnapshot,
    logical_size: LogicalSizeSnapshot,
    scale_factor: f64,
}

#[derive(Clone)]
struct AvailableMonitorSnapshot {
    name: Option<String>,
    screen: Option<String>,
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
    write_window_preferences_to(&window_preferences_path(app)?, preferences)
}

/// The file is written beside itself and moved into its place, so that it is
/// whole whenever it is read: the watch over the screens writes it, and the
/// app can close while it does.
fn write_window_preferences_to(
    path: &Path,
    preferences: &ShellWindowPreferences,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent)
            .map_err(|error| format!("Failed to create shell config directory: {error}"))?;
    }
    let payload = serde_json::to_vec_pretty(preferences)
        .map_err(|error| format!("Failed to serialize shell window preferences: {error}"))?;
    let beside = path.with_extension("json.new");
    write(&beside, payload)
        .and_then(|()| rename(&beside, path))
        .map_err(|error| {
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

/// The screen's own name for the display Windows calls `name`. None when two
/// screens show the display, each a copy of the other; when its screen gives
/// no name; and when the screens were not read.
fn screen_of(paths: &[DisplayPath], name: Option<&String>) -> Option<String> {
    let name = name?;
    let mut shown_by = paths.iter().filter(|path| &path.source == name);
    let screen = shown_by.next()?;
    if shown_by.next().is_some() || screen.target.is_empty() {
        return None;
    }
    Some(screen.target.clone())
}

fn available_monitor_snapshot(
    monitor: &Monitor,
    paths: &[DisplayPath],
) -> AvailableMonitorSnapshot {
    AvailableMonitorSnapshot {
        name: monitor.name().cloned(),
        screen: screen_of(paths, monitor.name()),
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

/// A monitor as it is held and saved.
fn saved_from(monitor: &AvailableMonitorSnapshot) -> MonitorSnapshot {
    let scale = if monitor.scale_factor.is_finite() && monitor.scale_factor > 0.0 {
        monitor.scale_factor
    } else {
        1.0
    };
    MonitorSnapshot {
        name: monitor.name.clone(),
        screen: monitor.screen.clone(),
        physical_position: monitor.physical_position.clone(),
        physical_size: monitor.physical_size.clone(),
        logical_size: LogicalSizeSnapshot {
            width: monitor.physical_size.width / scale,
            height: monitor.physical_size.height / scale,
        },
        scale_factor: monitor.scale_factor,
    }
}

/// What shell.log calls a display: its screen's name, else Windows' name for
/// it, else its place.
fn display_words(display: &MonitorSnapshot) -> String {
    display
        .screen
        .clone()
        .or_else(|| display.name.clone())
        .unwrap_or_else(|| {
            format!(
                "the display at {},{}",
                display.physical_position.x, display.physical_position.y
            )
        })
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

/// Whether `monitor` shows the saved display's screen: both are named, and
/// alike.
fn same_screen(monitor: &AvailableMonitorSnapshot, saved: &MonitorSnapshot) -> bool {
    saved
        .screen
        .as_ref()
        .zip(monitor.screen.as_ref())
        .is_some_and(|(saved_screen, screen)| saved_screen == screen)
}

/// Whether `monitor` can be the saved display by what is known of their
/// screens. Two screens of two names are two displays, wherever they stand;
/// where either has no name, nothing is known.
fn may_be(monitor: &AvailableMonitorSnapshot, saved: &MonitorSnapshot) -> bool {
    saved
        .screen
        .as_ref()
        .zip(monitor.screen.as_ref())
        .is_none_or(|(saved_screen, screen)| saved_screen == screen)
}

/// The saved display among the monitors.
///
/// - The one that shows its screen, by the screen's own name, when one
///   monitor does: the screen is what the window belongs on, wherever it
///   stands on the desktop and whatever Windows numbers it.
/// - Else the one that stands in its place, else the one with its name and
///   its size, unless its screen is known to be another. The place comes
///   before the name because Windows names a display by a number
///   (`\\.\DISPLAY3`), and at the next start that number can belong to
///   another display; until 2026-09-28 the name came first, and the screen
///   could open on the wrong one. A name on a display of another size is
///   another display.
fn saved_monitor_index_from_snapshots(
    monitors: &[AvailableMonitorSnapshot],
    saved: Option<&MonitorSnapshot>,
) -> Option<usize> {
    let saved = saved?;
    let mut of_its_screen = monitors
        .iter()
        .enumerate()
        .filter(|(_, monitor)| same_screen(monitor, saved));
    if let (Some((index, _)), None) = (of_its_screen.next(), of_its_screen.next()) {
        return Some(index);
    }
    monitors
        .iter()
        .position(|monitor| same_place(monitor, saved) && may_be(monitor, saved))
        .or_else(|| {
            monitors
                .iter()
                .position(|monitor| same_name_and_size(monitor, saved) && may_be(monitor, saved))
        })
}

/// The shell's one rule, over snapshots of the monitors so it can be tested
/// without a window: the saved display when it is there, else the 2560×1440
/// display, else the display the window is on.
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

/// The monitors, and where the window stands among them, as one look finds
/// them. The watch over the screens reads them before it locks the held
/// display: on its thread each of these calls waits for the main thread,
/// which must never wait for the watch in turn.
struct Seen {
    monitors: Vec<Monitor>,
    snapshots: Vec<AvailableMonitorSnapshot>,
    /// The monitor the window stands on: its index among the monitors.
    on: Option<usize>,
    fullscreen: bool,
}

fn see(window: &WebviewWindow, paths: &[DisplayPath]) -> Seen {
    let monitors = window.available_monitors().unwrap_or_default();
    let snapshots = monitors
        .iter()
        .map(|monitor| available_monitor_snapshot(monitor, paths))
        .collect::<Vec<_>>();
    let on = window.current_monitor().ok().flatten().and_then(|monitor| {
        let stands_on = available_monitor_snapshot(&monitor, paths);
        snapshots
            .iter()
            .position(|listed| same_monitor(listed, &stands_on))
    });
    Seen {
        monitors,
        snapshots,
        on,
        fullscreen: window.is_fullscreen().unwrap_or(false),
    }
}

/// PROBE (the throwaway branch probe/shell-xvfb-crash, never merged): with
/// `SSE_PROBE_SEE=main`, the watch's looks are gathered on the main thread,
/// where GTK must be called; otherwise on the watch's thread, as on main.
fn see_from_the_watch(window: &WebviewWindow, paths: &[DisplayPath]) -> Option<Seen> {
    if std::env::var("SSE_PROBE_SEE").as_deref() != Ok("main") {
        return Some(see(window, paths));
    }
    let (answer, answered) = std::sync::mpsc::sync_channel(1);
    let (asked, paths) = (window.clone(), paths.to_vec());
    window
        .run_on_main_thread(move || {
            let _ = answer.send(see(&asked, &paths));
        })
        .ok()?;
    answered
        .recv_timeout(std::time::Duration::from_secs(5))
        .ok()
}

/// Whether two snapshots of one look are of one monitor.
fn same_monitor(one: &AvailableMonitorSnapshot, other: &AvailableMonitorSnapshot) -> bool {
    one.name == other.name && same_place(one, &saved_from(other))
}

/// The monitor the rule names, as an index: the display the window stands
/// on when the rule names that.
fn index_of(display: FullscreenDisplay, on: Option<usize>) -> Option<usize> {
    match display {
        FullscreenDisplay::Saved(index) | FullscreenDisplay::Studio(index) => Some(index),
        FullscreenDisplay::Current => on,
    }
}

/// What the shell does about the window and its display at one look.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Hold {
    /// The window stands on its display.
    InPlace,
    /// Nothing can be said: the window stands on no monitor that is listed.
    Wait,
    /// The window was sent to its display, which is there, and does not
    /// stand on it.
    NotArrived,
    /// The window's display is not among the screens: the window stays
    /// where it is, and its display is remembered.
    Away,
    /// The monitor of this index is the window's display from now on: the
    /// window stands on it.
    Take(usize),
    /// The window is sent to the monitor of this index, its display,
    /// fullscreen.
    Send(usize),
}

/// The rule while the screens stand still. The window's display is the one
/// it stands on: when that is another than before, the operator moved it
/// with Windows' own keys. Not while its display is away, and not before a
/// window that was sent to its display has been seen on it.
fn hold_at_rest(
    monitors: &[AvailableMonitorSnapshot],
    on: Option<usize>,
    held: Option<&MonitorSnapshot>,
    sent: bool,
) -> Hold {
    let Some(on) = on else {
        return Hold::Wait;
    };
    let Some(held) = held else {
        return Hold::Take(on);
    };
    match saved_monitor_index_from_snapshots(monitors, Some(held)) {
        None => Hold::Away,
        Some(own) if own == on => in_place_or_moved(monitors, own, held),
        Some(_) if sent => Hold::NotArrived,
        Some(_) => Hold::Take(on),
    }
}

/// The rule once the screens have changed and stand still again: the window
/// goes back to its display when Windows moved it, and fullscreen. A window
/// that stands where it stood is left alone, and so is one whose display is
/// away.
fn hold_after_change(
    monitors: &[AvailableMonitorSnapshot],
    on: Option<usize>,
    fullscreen: bool,
    held: Option<&MonitorSnapshot>,
) -> Hold {
    let Some(held) = held else {
        // No display was ever the window's: the shell's one rule names it.
        return match index_of(fullscreen_display(monitors, None), on) {
            Some(index) if on == Some(index) && fullscreen => Hold::Take(index),
            Some(index) => Hold::Send(index),
            None => Hold::Wait,
        };
    };
    match saved_monitor_index_from_snapshots(monitors, Some(held)) {
        None => Hold::Away,
        Some(own) if on == Some(own) && fullscreen => in_place_or_moved(monitors, own, held),
        Some(own) => Hold::Send(own),
    }
}

/// The window stands on its display. When the display itself stands
/// elsewhere on the desktop than it did, or at another size or scale, it is
/// taken again as it is now.
fn in_place_or_moved(
    monitors: &[AvailableMonitorSnapshot],
    own: usize,
    held: &MonitorSnapshot,
) -> Hold {
    let as_it_was = monitors
        .get(own)
        .is_some_and(|monitor| same_place(monitor, held) && monitor.name == held.name);
    if as_it_was {
        Hold::InPlace
    } else {
        Hold::Take(own)
    }
}

/// The display the window belongs on: the one it stood on while the screens
/// last stood still, or the one a window command sent it to. There is one
/// for the app, kept by the watch over the screens and by the window
/// commands.
#[derive(Default)]
pub(crate) struct HeldDisplay(Mutex<Held>);

impl HeldDisplay {
    fn lock(&self) -> MutexGuard<'_, Held> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Default)]
struct Held {
    display: Option<MonitorSnapshot>,
    /// The window was sent to its display and has not been seen on it since.
    sent: bool,
    /// What shell.log was last told of a window that is not on its display:
    /// each is said once.
    said: Option<Hold>,
}

impl Held {
    /// `display` is the window's own from now on. It is saved for the next
    /// start.
    fn take(&mut self, app: &AppHandle, display: MonitorSnapshot, sent: bool) {
        self.display = Some(display);
        self.sent = sent;
        self.said = None;
        self.save(app);
    }

    fn save(&self, app: &AppHandle) {
        let Some(display) = &self.display else {
            return;
        };
        let preferences = ShellWindowPreferences {
            fullscreen: true,
            monitor: Some(display.clone()),
            scale_factor: Some(display.scale_factor),
            updated_at_epoch_seconds: now_epoch_seconds(),
        };
        if let Err(detail) = write_window_preferences(app, &preferences) {
            log_shell_line(
                app,
                &format!("The window's display was not saved: {detail}"),
            );
        }
    }

    fn say_once(&mut self, app: &AppHandle, hold: Hold, line: &str) {
        if self.said != Some(hold) {
            self.said = Some(hold);
            log_shell_line(app, line);
        }
    }

    /// Does what the rule answered. Called with the held display locked: it
    /// asks the window nothing, and what it tells the window is posted.
    fn act(&mut self, app: &AppHandle, window: &WebviewWindow, seen: &Seen, hold: Hold) {
        match hold {
            Hold::InPlace => {
                self.sent = false;
                self.said = None;
            }
            Hold::Wait => {}
            Hold::NotArrived => self.say_once(
                app,
                hold,
                "The window was sent to its display and does not stand on it. Studio fullscreen, in Setup / Support, sends it again.",
            ),
            Hold::Away => {
                let display = self
                    .display
                    .as_ref()
                    .map(display_words)
                    .unwrap_or_default();
                self.say_once(
                    app,
                    hold,
                    &format!(
                        "The window's display, {display}, is not among the screens. The window stays where it is, and goes back when the display returns."
                    ),
                );
            }
            Hold::Take(index) => {
                let Some(display) = seen.snapshots.get(index).map(saved_from) else {
                    return;
                };
                log_shell_line(
                    app,
                    &format!("The window's display is {}.", display_words(&display)),
                );
                self.take(app, display, false);
            }
            Hold::Send(index) => {
                let Some((monitor, display)) = seen
                    .monitors
                    .get(index)
                    .zip(seen.snapshots.get(index).map(saved_from))
                else {
                    return;
                };
                match route_window_to_monitor(window, monitor) {
                    Ok(()) => {
                        log_shell_line(
                            app,
                            &format!(
                                "The screens changed: the window was put back on its display, {}.",
                                display_words(&display)
                            ),
                        );
                        self.take(app, display, true);
                    }
                    Err(detail) => log_shell_line(
                        app,
                        &format!("The screens changed, and the window was not put back: {detail}"),
                    ),
                }
            }
        }
    }
}

/// While the screens stand still (`hold_at_rest`).
pub(crate) fn hold_while_the_screens_stand_still(app: &AppHandle, paths: &[DisplayPath]) {
    let Ok(window) = main_window(app) else {
        return;
    };
    let Some(seen) = see_from_the_watch(&window, paths) else {
        return;
    };
    let held = app.state::<HeldDisplay>();
    let mut held = held.lock();
    let hold = hold_at_rest(&seen.snapshots, seen.on, held.display.as_ref(), held.sent);
    held.act(app, &window, &seen, hold);
}

/// Once the screens have changed and stand still again
/// (`hold_after_change`).
pub(crate) fn hold_once_the_screens_changed(app: &AppHandle, paths: &[DisplayPath]) {
    let Ok(window) = main_window(app) else {
        return;
    };
    let Some(seen) = see_from_the_watch(&window, paths) else {
        return;
    };
    let held = app.state::<HeldDisplay>();
    let mut held = held.lock();
    let hold = hold_after_change(
        &seen.snapshots,
        seen.on,
        seen.fullscreen,
        held.display.as_ref(),
    );
    held.act(app, &window, &seen, hold);
}

/// Sends the window to the monitor of `index`, else to the display it says
/// it is on, fullscreen. It answers the display the window was sent to.
fn send_window(
    window: &WebviewWindow,
    seen: &Seen,
    index: Option<usize>,
    paths: &[DisplayPath],
) -> Result<MonitorSnapshot, String> {
    let listed = index.and_then(|index| seen.monitors.get(index).zip(seen.snapshots.get(index)));
    if let Some((monitor, snapshot)) = listed {
        route_window_to_monitor(window, monitor)?;
        return Ok(saved_from(snapshot));
    }
    // No monitor is listed, or the window stands on none that is.
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .ok_or_else(|| NO_MONITOR_FOR_STUDIO_FULLSCREEN.to_string())?;
    route_window_to_monitor(window, &monitor)?;
    Ok(saved_from(&available_monitor_snapshot(&monitor, paths)))
}

/// New pages program, Slice SW (D22): the shell always shows the screen
/// fullscreen — on the display it was last on when that display is there,
/// else on the 2560×1440 display, else on the display the window is on. Until
/// then a saved windowed layout was restored as it was, and a missing display
/// (or no saved file and neither a 2560×1440 nor a 1920×1080 monitor) opened
/// the windowed layout, 1600 × 960 and centred.
///
/// A saved display that is away (switched off, asleep) stays the window's
/// display, and its file stays as it is: the window opens where the rule
/// sends it, and goes to its display when that returns.
pub(crate) fn restore_or_route_initial_window(app: &AppHandle, window: &WebviewWindow) {
    // The screens' own names. Without them a display is known by its place.
    let paths = read_display_paths().unwrap_or_default();
    let saved = read_window_preferences(app).and_then(|preferences| preferences.monitor);
    let seen = see(window, &paths);
    let held = app.state::<HeldDisplay>();
    let mut held = held.lock();
    let away = saved.is_some()
        && saved_monitor_index_from_snapshots(&seen.snapshots, saved.as_ref()).is_none();
    let index = index_of(fullscreen_display(&seen.snapshots, saved.as_ref()), seen.on);
    match send_window(window, &seen, index, &paths) {
        Ok(_) if away => held.display = saved,
        Ok(display) => held.take(app, display, true),
        Err(detail) => {
            held.display = saved;
            log_shell_line(
                app,
                &format!("The window did not go fullscreen at launch: {detail}"),
            );
        }
    }
}

/// What both window commands do: the window goes to the 2560×1440 display,
/// else stays on the display it is on, fullscreen, and that display is the
/// window's own from now on.
fn send_to_the_studio_display(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let paths = read_display_paths().unwrap_or_default();
    let seen = see(window, &paths);
    let held = app.state::<HeldDisplay>();
    let mut held = held.lock();
    let index = index_of(fullscreen_display(&seen.snapshots, None), seen.on);
    let display = send_window(window, &seen, index, &paths)?;
    held.take(app, display, true);
    Ok(())
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
        send_to_the_studio_display(&app, &window)
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
        send_to_the_studio_display(&app, &window)
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
            screen: None,
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
            screen: None,
            physical_position: logical_position(position.0, position.1),
            physical_size: logical_size(physical_size.0, physical_size.1),
            scale_factor,
        }
    }

    /// A monitor whose screen's own name the display route gave.
    fn monitor_of(
        screen: &str,
        name: &str,
        position: (f64, f64),
        physical_size: (f64, f64),
        scale_factor: f64,
    ) -> AvailableMonitorSnapshot {
        AvailableMonitorSnapshot {
            screen: Some(screen.to_string()),
            ..available_monitor(Some(name), position, physical_size, scale_factor)
        }
    }

    /// The studio with the Prompter XL plugged in: the primary, which two
    /// screens show, so that it has no screen's name; the studio display;
    /// the Prompter XL.
    fn the_studio_with_the_prompter() -> [AvailableMonitorSnapshot; 3] {
        [
            available_monitor(Some(r"\\.\DISPLAY3"), (0.0, 0.0), (2560.0, 1440.0), 1.25),
            monitor_of(
                "HP E273q",
                r"\\.\DISPLAY2",
                (2560.0, 0.0),
                (2560.0, 1440.0),
                1.0,
            ),
            monitor_of(
                "Prompter XL",
                r"\\.\DISPLAY4",
                (5120.0, 0.0),
                (1920.0, 1080.0),
                1.0,
            ),
        ]
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
    fn once_the_screens_changed_the_window_goes_back_to_its_display() {
        let screens = the_studio_with_the_prompter();
        let (primary, studio, prompter) = (0, 1, 2);
        let its_display = saved_from(&screens[studio]);

        // It stands where it stood: nothing is done, and nothing flickers.
        assert_eq!(
            hold_after_change(&screens, Some(studio), true, Some(&its_display)),
            Hold::InPlace
        );
        // Windows moved it to the primary, or onto the Prompter XL; or it
        // stands on no monitor that is listed.
        for moved_to in [Some(primary), Some(prompter), None] {
            assert_eq!(
                hold_after_change(&screens, moved_to, true, Some(&its_display)),
                Hold::Send(studio),
                "{moved_to:?}"
            );
        }
        // It stands on its display and is no longer fullscreen.
        assert_eq!(
            hold_after_change(&screens, Some(studio), false, Some(&its_display)),
            Hold::Send(studio)
        );
        // No display was ever the window's: the shell's one rule names the
        // 2560×1440 display, which the primary at 125 % is not.
        assert_eq!(
            hold_after_change(&screens, Some(primary), true, None),
            Hold::Send(studio)
        );
        assert_eq!(
            hold_after_change(&screens, Some(studio), true, None),
            Hold::Take(studio)
        );
        // Without a 2560×1440 display it is the one the window stands on.
        let without_studio = [screens[primary].clone(), screens[prompter].clone()];
        assert_eq!(
            hold_after_change(&without_studio, Some(0), true, None),
            Hold::Take(0)
        );
        assert_eq!(
            hold_after_change(&without_studio, Some(0), false, None),
            Hold::Send(0)
        );
        assert_eq!(
            hold_after_change(&without_studio, None, true, None),
            Hold::Wait
        );
    }

    // The review of 2026-09-28: the studio display is switched off, or
    // asleep, and Windows takes it from the desktop and moves the window.
    // The window's display is remembered, not forgotten for the one Windows
    // chose: when it returns, the window goes back. Until then the window is
    // left where it is, and nothing is saved.
    #[test]
    fn while_its_display_is_away_it_is_remembered() {
        let screens = the_studio_with_the_prompter();
        let (primary, studio, prompter) = (0, 1, 2);
        let its_display = saved_from(&screens[studio]);
        let without_it = [screens[primary].clone(), screens[prompter].clone()];

        // Windows moved the window to the primary, or onto the Prompter XL.
        for on in [Some(0), Some(1), None] {
            for fullscreen in [true, false] {
                assert_eq!(
                    hold_after_change(&without_it, on, fullscreen, Some(&its_display)),
                    Hold::Away,
                    "{on:?} {fullscreen}"
                );
            }
            for sent in [true, false] {
                assert_eq!(
                    hold_at_rest(&without_it, on.or(Some(0)), Some(&its_display), sent),
                    Hold::Away,
                    "{on:?} {sent}"
                );
            }
        }
        // It returns, and the window stands on the primary.
        assert_eq!(
            hold_after_change(&screens, Some(primary), true, Some(&its_display)),
            Hold::Send(studio)
        );
        // Until the window is seen on its display, the display it stands on
        // is not taken for its own.
        assert_eq!(
            hold_at_rest(&screens, Some(primary), Some(&its_display), true),
            Hold::NotArrived
        );
        assert_eq!(
            hold_at_rest(&screens, Some(studio), Some(&its_display), true),
            Hold::InPlace
        );
    }

    // While the screens stand still, the display the window stands on is its
    // own: the operator moved it there with Windows' own keys.
    #[test]
    fn while_the_screens_stand_still_the_window_s_display_is_the_one_it_stands_on() {
        let screens = the_studio_with_the_prompter();
        let (primary, studio) = (0, 1);
        let its_display = saved_from(&screens[studio]);

        assert_eq!(
            hold_at_rest(&screens, Some(studio), Some(&its_display), false),
            Hold::InPlace
        );
        assert_eq!(
            hold_at_rest(&screens, Some(primary), Some(&its_display), false),
            Hold::Take(primary)
        );
        // No display was the window's yet.
        assert_eq!(
            hold_at_rest(&screens, Some(studio), None, false),
            Hold::Take(studio)
        );
        // The window stands on no monitor that is listed.
        assert_eq!(
            hold_at_rest(&screens, None, Some(&its_display), false),
            Hold::Wait
        );
        // Its display stands elsewhere on the desktop than it did, and
        // Windows numbers it otherwise: it is taken again as it is.
        let mut moved = screens.clone();
        moved[studio].physical_position.x = 3840.0;
        assert_eq!(
            hold_at_rest(&moved, Some(studio), Some(&its_display), false),
            Hold::Take(studio)
        );
        let mut renumbered = screens.clone();
        renumbered[studio].name = Some(String::from(r"\\.\DISPLAY7"));
        assert_eq!(
            hold_at_rest(&renumbered, Some(studio), Some(&its_display), false),
            Hold::Take(studio)
        );
    }

    // The design's §11: the window is held on its display by the screen's
    // identity. The screen's own name decides, wherever the screen stands on
    // the desktop and whatever Windows numbers it; and a screen of another
    // name is another display, though it stands in the saved one's place
    // under the saved one's number.
    #[test]
    fn a_display_is_known_by_its_screen_s_name() {
        let its_display = saved_from(&monitor_of(
            "HP E273q",
            r"\\.\DISPLAY2",
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        ));
        let rearranged = [
            monitor_of(
                "CS2731",
                r"\\.\DISPLAY2",
                (2560.0, 0.0),
                (2560.0, 1440.0),
                1.0,
            ),
            monitor_of(
                "HP E273q",
                r"\\.\DISPLAY3",
                (0.0, 0.0),
                (2560.0, 1440.0),
                1.0,
            ),
        ];
        assert_eq!(
            saved_monitor_index_from_snapshots(&rearranged, Some(&its_display)),
            Some(1)
        );
        // At another size and scale it is the same screen.
        let mut resized = rearranged.clone();
        resized[1].physical_size = logical_size(1920.0, 1080.0);
        resized[1].scale_factor = 1.25;
        assert_eq!(
            saved_monitor_index_from_snapshots(&resized, Some(&its_display)),
            Some(1)
        );
        // Without it, the screen in its place is not it.
        assert_eq!(
            saved_monitor_index_from_snapshots(&rearranged[..1], Some(&its_display)),
            None
        );
        assert_eq!(
            fullscreen_display(&rearranged[..1], Some(&its_display)),
            FullscreenDisplay::Studio(0)
        );

        // Where the screens' names were not read, the place decides, as it
        // does for a file an older build wrote.
        let unnamed = [
            available_monitor(Some(r"\\.\DISPLAY3"), (0.0, 0.0), (2560.0, 1440.0), 1.0),
            available_monitor(Some(r"\\.\DISPLAY1"), (2560.0, 0.0), (2560.0, 1440.0), 1.0),
        ];
        assert_eq!(
            saved_monitor_index_from_snapshots(&unnamed, Some(&its_display)),
            Some(1)
        );
        let from_an_older_build =
            saved_monitor(Some(r"\\.\DISPLAY3"), (2560.0, 0.0), (2560.0, 1440.0), 1.0);
        assert_eq!(
            saved_monitor_index_from_snapshots(&rearranged, Some(&from_an_older_build)),
            Some(0)
        );

        // Two screens of one name: the name cannot tell them apart, and the
        // place does.
        let twins = [
            monitor_of(
                "HP E273q",
                r"\\.\DISPLAY1",
                (0.0, 0.0),
                (2560.0, 1440.0),
                1.0,
            ),
            monitor_of(
                "HP E273q",
                r"\\.\DISPLAY2",
                (2560.0, 0.0),
                (2560.0, 1440.0),
                1.0,
            ),
        ];
        assert_eq!(
            saved_monitor_index_from_snapshots(&twins, Some(&its_display)),
            Some(1)
        );
    }

    // A display's screen has a name of its own when one screen shows it.
    #[test]
    fn a_display_that_two_screens_show_has_no_screen_s_name() {
        let path = |source: &str, target: &str| DisplayPath {
            source: source.to_string(),
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
            target: target.to_string(),
            refresh_hz: None,
        };
        let paths = [
            path(r"\\.\DISPLAY3", "SAMSUNG"),
            path(r"\\.\DISPLAY3", "CS2731"),
            path(r"\\.\DISPLAY2", "HP E273q"),
            path(r"\\.\DISPLAY5", ""),
        ];
        let name = |name: &str| name.to_string();
        assert_eq!(
            screen_of(&paths, Some(&name(r"\\.\DISPLAY2"))),
            Some(name("HP E273q"))
        );
        assert_eq!(screen_of(&paths, Some(&name(r"\\.\DISPLAY3"))), None);
        assert_eq!(screen_of(&paths, Some(&name(r"\\.\DISPLAY5"))), None);
        assert_eq!(screen_of(&paths, Some(&name(r"\\.\DISPLAY9"))), None);
        assert_eq!(screen_of(&paths, None), None);
        assert_eq!(screen_of(&[], Some(&name(r"\\.\DISPLAY2"))), None);
    }

    // The file is whole whenever it is read: it is written beside itself and
    // moved into its place, over the one that was there.
    #[test]
    fn the_saved_display_is_written_whole() {
        let folder = std::env::temp_dir().join(format!(
            "sse-shell-window-layout-{}-{}",
            std::process::id(),
            now_epoch_seconds()
        ));
        let path = folder.join("config").join("shell-window-layout.json");
        let first = studio_review_saved();
        write_window_preferences_to(&path, &first).expect("the file is written");
        let second = preferences_with_monitor(Some(saved_from(&monitor_of(
            "HP E273q",
            r"\\.\DISPLAY2",
            (2560.0, 0.0),
            (2560.0, 1440.0),
            1.0,
        ))));
        write_window_preferences_to(&path, &second).expect("the file is written over");

        let read = parse_window_preferences(&read_to_string(&path).expect("the file is there"))
            .expect("the file is whole");
        assert_eq!(
            read.monitor.and_then(|monitor| monitor.screen).as_deref(),
            Some("HP E273q")
        );
        let left: Vec<_> = std::fs::read_dir(path.parent().expect("a folder"))
            .expect("the folder is read")
            .filter_map(|entry| entry.ok().map(|entry| entry.file_name()))
            .collect();
        assert_eq!(
            left,
            ["shell-window-layout.json"],
            "nothing is left beside it"
        );
        let _ = std::fs::remove_dir_all(&folder);
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
