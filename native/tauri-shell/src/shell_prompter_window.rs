//! The prompter's window: the glass, for the presenter to read.
//!
//! D12, and D15's rule 4: the script is shown for the presenter on the screen
//! Windows names `Prompter XL` and on no other, and only a studio build draws
//! there. Any other build draws the glass into an ordinary window, so that a
//! development run has a prompter to try.
//!
//! The watch over the screens (`shell_display_watch.rs`) calls `look` once a
//! second with what the Prompter XL is among the screens. This module opens
//! the window, checks where it stands, closes it, and says what the hardware
//! link is told (`prompter.screen.report`). The window is built hidden, put
//! on the Prompter XL's part of the desktop, checked to stand there, and only
//! then shown. When Windows moves it (a screen went), its own events hide it
//! at once, and the next look closes it.
//!
//! The hardware link is told that the glass draws only when it does: the
//! window's page says so, once a second (`prompter_window_alive`). A report
//! that the screen is there unlocks `PLAY`, and nothing may scroll where
//! nobody can read it.
//!
//! The rules are functions over plain data, tested without a window:
//! `glass_for`, `next_step`, `with_sign`, `screen_report`.

use crate::shell_displays::{DisplayPath, PrompterScreen};
use crate::shell_window_layout::{log_shell_line, main_window};
use crate::shell_windows::{build_prompter_window, PROMPTER_WINDOW_LABEL};
use crate::EngineState;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::development::studio_build;
use studio_control_protocol::RequestEnvelope;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

/// What the shell tells the hardware link of the Prompter XL. The pages'
/// request path refuses it (`shell_commands.rs`).
const SCREEN_REPORT_METHOD: &str = "prompter.screen.report";

/// The screen a build that is not the studio's reports, for its ordinary
/// window: the Prompter XL's own size and rate.
const ORDINARY_SCREEN: (u32, u32, f64) = (1920, 1080, 60.0);

/// A window's page says that it draws within this long of the window's
/// opening.
const DRAWS_WITHIN: Duration = Duration::from_secs(10);

/// A page that draws says so once a second. One that has not for this long
/// has stopped.
const ALIVE_WITHIN: Duration = Duration::from_secs(5);

/// A window that did not open, or whose page did not draw, is opened again
/// after this long.
const OPENED_AGAIN_AFTER: Duration = Duration::from_secs(5);

/// The longest problem a page's sign carries.
const MAX_PROBLEM_CHARS: usize = 240;

/// A part of the desktop, in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Rect {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl Rect {
    fn of(path: &DisplayPath) -> Self {
        Self {
            x: path.x,
            y: path.y,
            width: path.width,
            height: path.height,
        }
    }
}

/// Where the glass is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Place {
    /// On the Prompter XL, which shows this part of the desktop.
    PrompterXl(Rect),
    /// In an ordinary window, which no screen moves.
    Ordinary,
}

/// D15's rule 4, and D12. Only a studio build draws on the Prompter XL, and
/// only while that screen shows a part of the desktop of its own. Any other
/// build draws into an ordinary window, whatever the screens are, the
/// Prompter XL among them.
pub(crate) fn glass_for(studio: bool, screen: &PrompterScreen) -> Option<Place> {
    if !studio {
        return Some(Place::Ordinary);
    }
    match screen {
        PrompterScreen::Connected(path) => Some(Place::PrompterXl(Rect::of(path))),
        PrompterScreen::NotConnected | PrompterScreen::Duplicated { .. } => None,
    }
}

/// The window, as the shell has it.
#[derive(Debug, Clone, PartialEq)]
enum Glass {
    /// There is no window.
    Closed,
    /// The window stands in its place, and its page has not said yet that it
    /// draws.
    Opened { at: Instant, place: Place },
    /// Its page draws: it last said so at `alive`.
    Drawing { alive: Instant, place: Place },
    /// It did not open, or its page did not draw: there is no window, and
    /// one is opened again after a while.
    Failed { at: Instant, reason: String },
}

/// What the shell does about the window at a look.
#[derive(Debug, Clone, PartialEq)]
enum Step {
    Keep,
    /// Close it: nothing is to be drawn, or not where it stands.
    Close,
    /// Open it in this place.
    Open(Place),
    /// Close it, and say why: its page does not draw.
    GiveUp(String),
}

/// The rule of a look. `wanted` is where the glass is to be drawn
/// (`glass_for`; nowhere while the app closes), `still` whether the screens
/// stand still, `problem` what the window's page said keeps it from drawing.
fn next_step(
    glass: &Glass,
    wanted: Option<Place>,
    still: bool,
    problem: Option<&str>,
    now: Instant,
) -> Step {
    let Some(wanted) = wanted else {
        return match glass {
            Glass::Closed => Step::Keep,
            // A failure is forgotten with what it failed at.
            Glass::Opened { .. } | Glass::Drawing { .. } | Glass::Failed { .. } => Step::Close,
        };
    };
    // The Prompter XL's part of the desktop is taken once the screens stand
    // still: Windows moves them, and the windows on them, while they change.
    // An ordinary window waits for no screen.
    let may_open = still || wanted == Place::Ordinary;
    match glass {
        Glass::Closed if may_open => Step::Open(wanted),
        Glass::Closed => Step::Keep,
        Glass::Failed { at, .. } => {
            if may_open && now.saturating_duration_since(*at) >= OPENED_AGAIN_AFTER {
                Step::Open(wanted)
            } else {
                Step::Keep
            }
        }
        Glass::Opened { place, .. } | Glass::Drawing { place, .. } if *place != wanted => {
            Step::Close
        }
        Glass::Opened { at, .. } => match problem {
            Some(problem) => Step::GiveUp(page_failed(problem)),
            None if now.saturating_duration_since(*at) > DRAWS_WITHIN => Step::GiveUp(format!(
                "The window's page did not draw within {} seconds.",
                DRAWS_WITHIN.as_secs()
            )),
            None => Step::Keep,
        },
        Glass::Drawing { alive, .. } => match problem {
            Some(problem) => Step::GiveUp(page_failed(problem)),
            None if now.saturating_duration_since(*alive) > ALIVE_WITHIN => {
                Step::GiveUp(String::from("The window's page stopped drawing."))
            }
            None => Step::Keep,
        },
    }
}

fn page_failed(problem: &str) -> String {
    format!("The window's page could not draw: {problem}")
}

/// What the page's sign of life makes of the window: one that was opened
/// draws, and one that draws still does. A sign from before the window was
/// opened is an earlier window's.
fn with_sign(glass: Glass, alive: Option<Instant>) -> Glass {
    match (glass, alive) {
        (Glass::Opened { at, place }, Some(alive)) if alive >= at => {
            Glass::Drawing { alive, place }
        }
        (
            Glass::Drawing {
                alive: before,
                place,
            },
            Some(alive),
        ) if alive >= before => Glass::Drawing { alive, place },
        (glass, _) => glass,
    }
}

/// What the hardware link is told of the Prompter XL, or nothing at this
/// look. `screen` is none when the screens could not be read; `last_found`
/// is the Prompter XL's size and rate when a look last found it with a part
/// of the desktop of its own; `told_draws` whether the hardware link was
/// last told that the glass draws.
///
/// While the window opens, the hardware link is told nothing and keeps what
/// it had: a fault said for that second would be a false one. Not so when it
/// was told that the glass draws: then it is told at once that the glass
/// does not, and a text that scrolls pauses.
fn screen_report(
    studio: bool,
    screen: Option<&PrompterScreen>,
    last_found: Option<(u32, u32, Option<f64>)>,
    glass: &Glass,
    told_draws: bool,
) -> Option<Value> {
    fn found(size: (u32, u32, Option<f64>)) -> Value {
        let (width, height, refresh_hz) = size;
        let mut report = json!({ "found": true, "width": width, "height": height });
        // The hardware link refuses a rate of 0: Windows gave none.
        if let Some(rate) = refresh_hz.filter(|rate| rate.is_finite() && *rate >= 1.0) {
            report["refreshHz"] = json!(rate);
        }
        report
    }
    fn not_showing(size: (u32, u32, Option<f64>), reason: &str) -> Value {
        let mut report = found(size);
        report["windowError"] = json!(reason);
        report
    }

    let size = if studio {
        match screen {
            Some(PrompterScreen::NotConnected) => return Some(json!({ "found": false })),
            Some(PrompterScreen::Duplicated {
                width,
                height,
                refresh_hz,
            }) => {
                let mut report = found((*width, *height, *refresh_hz));
                report["duplicated"] = json!(true);
                return Some(report);
            }
            Some(PrompterScreen::Connected(path)) => (path.width, path.height, path.refresh_hz),
            // Nothing is known of the screens, and nothing is drawn.
            None => {
                return last_found.filter(|_| told_draws).map(|size| {
                    not_showing(
                        size,
                        "Windows' screens could not be read, so nothing is drawn on the Prompter XL.",
                    )
                });
            }
        }
    } else {
        (
            ORDINARY_SCREEN.0,
            ORDINARY_SCREEN.1,
            Some(ORDINARY_SCREEN.2),
        )
    };
    match glass {
        Glass::Drawing { .. } => Some(found(size)),
        Glass::Failed { reason, .. } => Some(not_showing(size, reason)),
        Glass::Closed | Glass::Opened { .. } if told_draws => {
            Some(not_showing(size, "The window is opening again."))
        }
        Glass::Closed | Glass::Opened { .. } => None,
    }
}

/// Whether a report says that the glass draws.
fn says_it_draws(report: &Value) -> bool {
    report["found"] == json!(true)
        && report.get("duplicated").is_none()
        && report.get("windowError").is_none()
}

/// What the window's page last said.
#[derive(Debug, Clone, Default)]
struct PageSign {
    /// When it last said that it draws.
    alive: Option<Instant>,
    /// What it said keeps it from drawing.
    problem: Option<String>,
}

/// What the prompter's window shares with the rest of the shell: the
/// command its page calls, and its own events.
#[derive(Default)]
pub(crate) struct PrompterWindowState {
    page: Mutex<PageSign>,
    /// Where the shell put the window on the Prompter XL. None for an
    /// ordinary window, which may stand anywhere.
    placed: Mutex<Option<Rect>>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl PrompterWindowState {
    fn sign(&self) -> PageSign {
        locked(&self.page).clone()
    }

    /// A new window: what an earlier one's page said is forgotten.
    fn begin(&self, placed: Option<Rect>) {
        *locked(&self.page) = PageSign::default();
        *locked(&self.placed) = placed;
    }

    fn placed(&self) -> Option<Rect> {
        *locked(&self.placed)
    }
}

/// Wakes the watch over the screens before its second is over: the hardware
/// link started, or the prompter's page said something new.
pub(crate) struct WatchWake(pub(crate) SyncSender<()>);

impl WatchWake {
    pub(crate) fn wake(&self) {
        // A watch that is already to wake needs no second word.
        let _ = self.0.try_send(());
    }
}

/// The prompter's page says that it draws what it read, once a second, or
/// what keeps it from drawing. It is the one command that window has beside
/// its reads of the hardware link (`shell_commands::window_may_call`).
#[tauri::command]
pub(crate) fn prompter_window_alive(
    state: tauri::State<'_, PrompterWindowState>,
    wake: tauri::State<'_, WatchWake>,
    problem: Option<String>,
) {
    let problem = problem
        .map(|problem| {
            problem
                .trim()
                .chars()
                .take(MAX_PROBLEM_CHARS)
                .collect::<String>()
        })
        .filter(|problem| !problem.is_empty());
    let news = {
        let mut page = locked(&state.page);
        let news = match &problem {
            Some(_) => page.problem != problem,
            None => page.alive.is_none() || page.problem.is_some(),
        };
        if problem.is_none() {
            page.alive = Some(Instant::now());
        }
        page.problem = problem;
        news
    };
    if news {
        wake.wake();
    }
}

/// Whether the window covers this part of the desktop, all of it and no
/// more.
fn covers(position: (i32, i32), size: (u32, u32), rect: &Rect) -> bool {
    position == (rect.x, rect.y) && size == (rect.width, rect.height)
}

/// Where the window stands, when that is not `rect`.
fn stands_on(window: &WebviewWindow, rect: &Rect) -> Result<(), String> {
    let position = window
        .outer_position()
        .map_err(|error| format!("Its place could not be read: {error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("Its size could not be read: {error}"))?;
    if covers((position.x, position.y), (size.width, size.height), rect) {
        Ok(())
    } else {
        Err(format!(
            "It stands at {},{} and is {}×{}; the Prompter XL is {}×{} at {},{}.",
            position.x,
            position.y,
            size.width,
            size.height,
            rect.width,
            rect.height,
            rect.x,
            rect.y
        ))
    }
}

/// The window's own events, on the Prompter XL: when it stands elsewhere
/// than the shell put it, Windows moved it, and it is hidden at once. The
/// script is shown on no other screen (D12), not for the second the watch
/// takes to look.
fn guard_its_place(app: &AppHandle, window: &WebviewWindow) {
    let guarded = window.clone();
    let app = app.clone();
    window.on_window_event(move |event| {
        if !matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
        ) {
            return;
        }
        let Some(rect) = app.state::<PrompterWindowState>().placed() else {
            return;
        };
        if stands_on(&guarded, &rect).is_err() {
            let _ = guarded.hide();
        }
    });
}

/// Builds the window hidden, puts it in its place, and shows it there.
fn open(app: &AppHandle, place: Place) -> Result<(), String> {
    let shared = app.state::<PrompterWindowState>();
    let placed = match place {
        Place::PrompterXl(rect) => Some(rect),
        Place::Ordinary => None,
    };
    shared.begin(placed);
    let window = build_prompter_window(app, place == Place::Ordinary)
        .map_err(|error| format!("The window could not be built: {error}"))?;
    #[cfg(windows)]
    crate::shell_browser_keys::switch_off_browser_keys(app, &window);
    let shown = match placed {
        None => window
            .show()
            .map_err(|error| format!("The window could not be shown: {error}")),
        Some(rect) => put_on_the_prompter(app, &window, &rect),
    };
    if shown.is_err() {
        let _ = window.destroy();
    }
    shown
}

fn put_on_the_prompter(app: &AppHandle, window: &WebviewWindow, rect: &Rect) -> Result<(), String> {
    guard_its_place(app, window);
    window
        .set_position(PhysicalPosition::new(rect.x, rect.y))
        .map_err(|error| format!("The window could not be put on the Prompter XL: {error}"))?;
    window
        .set_size(PhysicalSize::new(rect.width, rect.height))
        .map_err(|error| format!("The window could not be sized for the Prompter XL: {error}"))?;
    window
        .set_fullscreen(true)
        .map_err(|error| format!("The window could not fill the Prompter XL: {error}"))?;
    stands_on(window, rect).map_err(|found| format!("The window was not shown. {found}"))?;
    // The page hides the pointer too; this holds while the page loads.
    let _ = window.set_cursor_visible(false);
    window
        .show()
        .map_err(|error| format!("The window could not be shown: {error}"))
}

fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PROMPTER_WINDOW_LABEL) {
        let _ = window.destroy();
    }
    app.state::<PrompterWindowState>().begin(None);
}

/// Closes the prompter's window with the app: the main window's close was
/// confirmed, or the main window is gone. Tauri ends the app when its last
/// window closes, and the prompter's is never the last one.
pub(crate) fn close_with_the_app(app: &AppHandle) {
    close(app);
}

/// Whether the app closes: no window is opened then.
fn closing(app: &AppHandle) -> bool {
    app.state::<EngineState>()
        .close_confirmed
        .load(Ordering::SeqCst)
        || main_window(app).is_err()
}

/// The prompter's window, kept by the watch over the screens.
pub(crate) struct PrompterWindow {
    studio: bool,
    glass: Glass,
    /// Whether the hardware link was last told that the glass draws.
    told_draws: bool,
    /// The Prompter XL's size and rate, when a look last found it with a
    /// part of the desktop of its own.
    last_found: Option<(u32, u32, Option<f64>)>,
    /// What shell.log was last told of a window that does not draw: each
    /// reason is said once.
    said: Option<String>,
    reports: SyncSender<Value>,
}

impl PrompterWindow {
    /// Starts the thread that tells the hardware link, and answers the
    /// window's keeper.
    pub(crate) fn start(app: &AppHandle) -> Self {
        let (reports, told) = sync_channel::<Value>(1);
        let teller = app.clone();
        let started = thread::Builder::new()
            .name(String::from("prompter-screen-report"))
            .spawn(move || tell_the_hardware_link(&teller, &told));
        if let Err(error) = started {
            log_shell_line(
                app,
                &format!("The Prompter XL is not reported to the hardware link: {error}"),
            );
        }
        Self {
            studio: studio_build(),
            glass: Glass::Closed,
            told_draws: false,
            last_found: None,
            said: None,
            reports,
        }
    }

    /// One look. `screen` is what the Prompter XL is among the screens, none
    /// when they could not be read; `still` whether the screens stand still.
    /// Called with no lock held: it asks the window where it stands.
    pub(crate) fn look(&mut self, app: &AppHandle, screen: Option<&PrompterScreen>, still: bool) {
        let now = Instant::now();
        let closing = closing(app);
        let sign = app.state::<PrompterWindowState>().sign();

        let before = std::mem::replace(&mut self.glass, Glass::Closed);
        let opened = matches!(before, Glass::Opened { .. });
        self.glass = with_sign(before, sign.alive);
        if opened && matches!(self.glass, Glass::Drawing { .. }) {
            self.said = None;
            log_shell_line(app, "The prompter's page draws.");
        }

        if let Some(PrompterScreen::Connected(path)) = screen {
            self.last_found = Some((path.width, path.height, path.refresh_hz));
        }
        let wanted = match (closing, screen) {
            (true, _) => None,
            (false, Some(screen)) => glass_for(self.studio, screen),
            // The screens were not read: nothing is known of the Prompter
            // XL, which could show a copy of another screen.
            (false, None) => glass_for(self.studio, &PrompterScreen::NotConnected),
        };

        self.check_its_place(app);
        let step = next_step(&self.glass, wanted, still, sign.problem.as_deref(), now);
        self.act(app, step, why_closed(closing, screen), now);

        if closing {
            return;
        }
        let report = screen_report(
            self.studio,
            screen,
            self.last_found,
            &self.glass,
            self.told_draws,
        );
        if let Some(report) = report {
            self.told_draws = says_it_draws(&report);
            // A teller that is busy takes the next look's report.
            let _ = self.reports.try_send(report);
        }
    }

    /// A window on the Prompter XL that stands elsewhere than it was put, or
    /// that its own events hid, is closed. The next look opens it again if
    /// the Prompter XL is there.
    fn check_its_place(&mut self, app: &AppHandle) {
        let (Glass::Opened {
            place: Place::PrompterXl(rect),
            ..
        }
        | Glass::Drawing {
            place: Place::PrompterXl(rect),
            ..
        }) = &self.glass
        else {
            return;
        };
        let found = match app.get_webview_window(PROMPTER_WINDOW_LABEL) {
            None => Err(String::from("It is gone.")),
            Some(window) => stands_on(&window, rect).and_then(|()| {
                if window.is_visible().unwrap_or(false) {
                    Ok(())
                } else {
                    Err(String::from("It was hidden when Windows moved it."))
                }
            }),
        };
        if let Err(found) = found {
            log_shell_line(
                app,
                &format!(
                    "The prompter's window was closed: it did not stand on the Prompter XL. {found}"
                ),
            );
            close(app);
            self.glass = Glass::Closed;
        }
    }

    fn act(&mut self, app: &AppHandle, step: Step, why_closed: &str, now: Instant) {
        match step {
            Step::Keep => {}
            Step::Close => {
                if !matches!(self.glass, Glass::Closed | Glass::Failed { .. }) {
                    log_shell_line(
                        app,
                        &format!("The prompter's window was closed: {why_closed}."),
                    );
                }
                close(app);
                self.glass = Glass::Closed;
                self.said = None;
            }
            Step::Open(place) => match open(app, place) {
                Ok(()) => {
                    log_shell_line(app, &opened_line(place));
                    self.glass = Glass::Opened { at: now, place };
                }
                Err(reason) => self.failed(app, reason, now),
            },
            Step::GiveUp(reason) => {
                close(app);
                self.failed(app, reason, now);
            }
        }
    }

    fn failed(&mut self, app: &AppHandle, reason: String, now: Instant) {
        if self.said.as_ref() != Some(&reason) {
            log_shell_line(
                app,
                &format!(
                    "The prompter's window does not show. {reason} It is opened again in {} seconds.",
                    OPENED_AGAIN_AFTER.as_secs()
                ),
            );
            self.said = Some(reason.clone());
        }
        self.glass = Glass::Failed { at: now, reason };
    }
}

fn opened_line(place: Place) -> String {
    match place {
        Place::PrompterXl(rect) => format!(
            "The prompter's window opened on the Prompter XL: {}×{} at {},{}.",
            rect.width, rect.height, rect.x, rect.y
        ),
        Place::Ordinary => String::from(
            "The prompter's window opened as an ordinary window: this is not a studio build, and only a studio build draws on the Prompter XL.",
        ),
    }
}

/// Why a window is closed when nothing is to be drawn, for shell.log.
fn why_closed(closing: bool, screen: Option<&PrompterScreen>) -> &'static str {
    match (closing, screen) {
        (true, _) => "Studio Control closes",
        (false, None) => "the screens could not be read",
        (false, Some(PrompterScreen::NotConnected)) => "the Prompter XL is not connected",
        (false, Some(PrompterScreen::Duplicated { .. })) => {
            "the Prompter XL shows a copy of another screen"
        }
        (false, Some(PrompterScreen::Connected(_))) => {
            "the Prompter XL stands elsewhere on the desktop"
        }
    }
}

/// The thread that tells the hardware link. A request waits up to ten
/// seconds for its answer, which the watch over the screens must not.
fn tell_the_hardware_link(app: &AppHandle, reports: &Receiver<Value>) {
    let mut told = 0_u64;
    // What shell.log was last told of the hardware link's answer: each is
    // said when it is another than the last.
    let mut said: Option<String> = None;
    for params in reports {
        let bridge = &app.state::<EngineState>().bridge;
        // No hardware link runs: there is nobody to tell, and the next
        // look tells again. It starts knowing nothing, so what it answers
        // then is said again.
        if !matches!(bridge.summary(), Ok(Some(_))) {
            said = None;
            continue;
        }
        told += 1;
        let request = RequestEnvelope {
            kind: String::from("request"),
            id: json!(format!("shell:{SCREEN_REPORT_METHOD}:{told}")),
            method: String::from(SCREEN_REPORT_METHOD),
            params,
        };
        let line = match bridge.request(request) {
            Ok(response) => answer_line(
                response.ok,
                response.result.as_ref(),
                response.error.as_ref(),
            ),
            // The hardware link stops or starts: the next look tells again.
            Err(_) => continue,
        };
        if said.as_ref() != Some(&line) {
            log_shell_line(app, &line);
            said = Some(line);
        }
    }
}

/// What shell.log says of the hardware link's answer to a report: what it
/// has the Prompter XL as, or why it refused.
fn answer_line(ok: bool, result: Option<&Value>, error: Option<&Value>) -> String {
    if !ok {
        let reason = error
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("it gave no reason");
        return format!("The hardware link refused the Prompter XL's report: {reason}");
    }
    let word = result
        .and_then(|result| result.get("screen"))
        .and_then(|screen| screen.get("word"))
        .and_then(Value::as_str)
        .unwrap_or("it did not say what");
    let paused = result
        .and_then(|result| result.get("paused"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    format!(
        "The hardware link has the Prompter XL as {word}.{}",
        if paused {
            " The text scrolled, and was paused."
        } else {
            ""
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell_displays::prompter_screen;
    use crate::shell_displays::tests::{prompter, the_studio};

    const XL: Rect = Rect {
        x: 5120,
        y: 0,
        width: 1920,
        height: 1080,
    };

    fn connected() -> PrompterScreen {
        let mut screens = the_studio();
        screens.push(prompter(r"\\.\DISPLAY4", (5120, 0)));
        prompter_screen(&screens)
    }

    fn duplicated() -> PrompterScreen {
        let mut screens = the_studio();
        screens.push(prompter(r"\\.\DISPLAY2", (2560, 0)));
        prompter_screen(&screens)
    }

    // D12, D15's rule 4, and the roadmap's guard: over plain screens, the
    // window opens on the screen named `Prompter XL` and on no other, and
    // only in a studio build.
    #[test]
    fn only_a_studio_build_draws_on_the_prompter_xl_and_on_no_other_screen() {
        assert_eq!(
            connected(),
            PrompterScreen::Connected(prompter(r"\\.\DISPLAY4", (5120, 0)))
        );
        assert_eq!(glass_for(true, &connected()), Some(Place::PrompterXl(XL)));
        // Wherever Windows puts it, that is where the window goes.
        let mut screens = the_studio();
        screens.push(prompter(r"\\.\DISPLAY9", (-1920, 360)));
        assert_eq!(
            glass_for(true, &prompter_screen(&screens)),
            Some(Place::PrompterXl(Rect {
                x: -1920,
                y: 360,
                width: 1920,
                height: 1080
            }))
        );
        // Without it, or while it shows a copy, there is no window: not on
        // the studio display, not on display 2, not anywhere.
        assert_eq!(glass_for(true, &prompter_screen(&the_studio())), None);
        assert_eq!(glass_for(true, &prompter_screen(&[])), None);
        assert_eq!(glass_for(true, &duplicated()), None);
        assert!(matches!(duplicated(), PrompterScreen::Duplicated { .. }));
        // A screen of another name is not it, whatever its size.
        for name in ["Prompter XL 2", "prompter xl", "Elgato Prompter XL", ""] {
            let mut screens = the_studio();
            screens.push(DisplayPath {
                target: name.to_string(),
                ..prompter(r"\\.\DISPLAY4", (5120, 0))
            });
            assert_eq!(
                glass_for(true, &prompter_screen(&screens)),
                None,
                "{name:?}"
            );
        }
    }

    // Any other build draws into an ordinary window, whatever the screens
    // are: a development run, a lane and a test never draw on the Prompter
    // XL, plugged in or not.
    #[test]
    fn any_other_build_draws_into_an_ordinary_window() {
        for screen in [
            connected(),
            duplicated(),
            PrompterScreen::NotConnected,
            prompter_screen(&the_studio()),
        ] {
            assert_eq!(
                glass_for(false, &screen),
                Some(Place::Ordinary),
                "{screen:?}"
            );
        }
    }

    #[test]
    fn the_window_opens_once_the_screens_stand_still_and_closes_at_once() {
        let now = Instant::now();
        let on_the_xl = Some(Place::PrompterXl(XL));
        // Plugged in: Windows still moves the screens about.
        assert_eq!(
            next_step(&Glass::Closed, on_the_xl, false, None, now),
            Step::Keep
        );
        assert_eq!(
            next_step(&Glass::Closed, on_the_xl, true, None, now),
            Step::Open(Place::PrompterXl(XL))
        );
        // An ordinary window waits for no screen.
        assert_eq!(
            next_step(&Glass::Closed, Some(Place::Ordinary), false, None, now),
            Step::Open(Place::Ordinary)
        );
        // Unplugged, or a copy: it closes at the look that finds it so,
        // whether the screens stand still or not.
        let opened = Glass::Opened {
            at: now,
            place: Place::PrompterXl(XL),
        };
        let drawing = Glass::Drawing {
            alive: now,
            place: Place::PrompterXl(XL),
        };
        for glass in [&opened, &drawing] {
            for still in [true, false] {
                assert_eq!(next_step(glass, None, still, None, now), Step::Close);
            }
            assert_eq!(next_step(glass, on_the_xl, true, None, now), Step::Keep);
        }
        assert_eq!(next_step(&Glass::Closed, None, true, None, now), Step::Keep);
        // The Prompter XL stands elsewhere on the desktop than the window:
        // the window closes, and the next look opens it there.
        let moved = Some(Place::PrompterXl(Rect { x: -1920, ..XL }));
        assert_eq!(next_step(&drawing, moved, true, None, now), Step::Close);
        assert_eq!(
            next_step(&Glass::Closed, moved, true, None, now),
            Step::Open(Place::PrompterXl(Rect { x: -1920, ..XL }))
        );
    }

    #[test]
    fn a_page_that_does_not_draw_is_given_up_and_opened_again() {
        let at = Instant::now();
        let place = Place::PrompterXl(XL);
        let wanted = Some(place);
        let opened = Glass::Opened { at, place };
        assert_eq!(
            next_step(&opened, wanted, true, None, at + DRAWS_WITHIN),
            Step::Keep
        );
        assert_eq!(
            next_step(
                &opened,
                wanted,
                true,
                None,
                at + DRAWS_WITHIN + Duration::from_millis(1)
            ),
            Step::GiveUp(String::from(
                "The window's page did not draw within 10 seconds."
            ))
        );
        let drawing = Glass::Drawing { alive: at, place };
        assert_eq!(
            next_step(&drawing, wanted, true, None, at + ALIVE_WITHIN),
            Step::Keep
        );
        assert_eq!(
            next_step(
                &drawing,
                wanted,
                true,
                None,
                at + ALIVE_WITHIN + Duration::from_millis(1)
            ),
            Step::GiveUp(String::from("The window's page stopped drawing."))
        );
        // The page says what keeps it from drawing.
        for glass in [&opened, &drawing] {
            assert_eq!(
                next_step(glass, wanted, true, Some("the text could not be read"), at),
                Step::GiveUp(String::from(
                    "The window's page could not draw: the text could not be read"
                ))
            );
        }
        // Opened again after a while, once the screens stand still; and
        // forgotten when nothing is to be drawn.
        let failed = Glass::Failed {
            at,
            reason: String::from("The window's page stopped drawing."),
        };
        let later = at + OPENED_AGAIN_AFTER;
        assert_eq!(
            next_step(
                &failed,
                wanted,
                true,
                None,
                later - Duration::from_millis(1)
            ),
            Step::Keep
        );
        assert_eq!(next_step(&failed, wanted, false, None, later), Step::Keep);
        assert_eq!(
            next_step(&failed, wanted, true, None, later),
            Step::Open(place)
        );
        assert_eq!(next_step(&failed, None, true, None, at), Step::Close);
    }

    #[test]
    fn a_sign_of_life_is_the_window_s_own() {
        let at = Instant::now() + Duration::from_secs(60);
        let place = Place::Ordinary;
        let opened = Glass::Opened { at, place };
        assert_eq!(with_sign(opened.clone(), None), opened);
        // An earlier window's page said so, before this one was opened.
        assert_eq!(
            with_sign(opened.clone(), Some(at - Duration::from_secs(1))),
            opened
        );
        let alive = at + Duration::from_millis(400);
        assert_eq!(
            with_sign(opened, Some(alive)),
            Glass::Drawing { alive, place }
        );
        let later = alive + Duration::from_secs(1);
        assert_eq!(
            with_sign(Glass::Drawing { alive, place }, Some(later)),
            Glass::Drawing {
                alive: later,
                place
            }
        );
        for glass in [
            Glass::Closed,
            Glass::Failed {
                at,
                reason: String::from("no"),
            },
        ] {
            assert_eq!(with_sign(glass.clone(), Some(later)), glass);
        }
    }

    // The hardware link is told that the glass draws only when it does: a
    // report that the screen is there unlocks PLAY.
    #[test]
    fn the_hardware_link_is_told_what_the_glass_does() {
        let at = Instant::now();
        let place = Place::PrompterXl(XL);
        let drawing = Glass::Drawing { alive: at, place };
        let opened = Glass::Opened { at, place };
        let failed = Glass::Failed {
            at,
            reason: String::from("The window's page stopped drawing."),
        };
        let screen = connected();
        let size = Some((1920, 1080, Some(60.0)));

        assert_eq!(
            screen_report(true, Some(&screen), size, &drawing, false),
            Some(json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60.0 }))
        );
        assert_eq!(
            screen_report(true, Some(&screen), size, &failed, true),
            Some(json!({
                "found": true, "width": 1920, "height": 1080, "refreshHz": 60.0,
                "windowError": "The window's page stopped drawing."
            }))
        );
        // While the window opens, nothing; but a hardware link that was told
        // that the glass draws is told at once that it does not.
        for glass in [&Glass::Closed, &opened] {
            assert_eq!(screen_report(true, Some(&screen), size, glass, false), None);
            assert_eq!(
                screen_report(true, Some(&screen), size, glass, true),
                Some(json!({
                    "found": true, "width": 1920, "height": 1080, "refreshHz": 60.0,
                    "windowError": "The window is opening again."
                }))
            );
        }
        // Not connected, and a copy, whatever the window was.
        for glass in [&Glass::Closed, &drawing, &failed] {
            assert_eq!(
                screen_report(true, Some(&PrompterScreen::NotConnected), size, glass, true),
                Some(json!({ "found": false }))
            );
            assert_eq!(
                screen_report(true, Some(&duplicated()), size, glass, true),
                Some(json!({
                    "found": true, "duplicated": true,
                    "width": 1920, "height": 1080, "refreshHz": 60.0
                }))
            );
        }
        // Windows gave no refresh rate: none is reported, never 0.
        for rate in [None, Some(0.0), Some(f64::NAN)] {
            let without_rate = PrompterScreen::Connected(DisplayPath {
                refresh_hz: rate,
                ..prompter(r"\\.\DISPLAY4", (5120, 0))
            });
            assert_eq!(
                screen_report(true, Some(&without_rate), size, &drawing, false),
                Some(json!({ "found": true, "width": 1920, "height": 1080 })),
                "{rate:?}"
            );
        }
        // The screens could not be read: a glass that was said to draw is
        // said not to; else nothing is known, and nothing is said.
        assert_eq!(
            screen_report(true, None, size, &Glass::Closed, true),
            Some(json!({
                "found": true, "width": 1920, "height": 1080, "refreshHz": 60.0,
                "windowError": "Windows' screens could not be read, so nothing is drawn on the Prompter XL."
            }))
        );
        assert_eq!(screen_report(true, None, size, &Glass::Closed, false), None);
        assert_eq!(screen_report(true, None, None, &Glass::Closed, true), None);
    }

    // A build that is not the studio's reports the Prompter XL's own size
    // for its ordinary window, whatever the screens are, so that a
    // development run has a prompter to try.
    #[test]
    fn another_build_reports_its_ordinary_window() {
        let at = Instant::now();
        let drawing = Glass::Drawing {
            alive: at,
            place: Place::Ordinary,
        };
        let full = json!({ "found": true, "width": 1920, "height": 1080, "refreshHz": 60.0 });
        for screen in [
            Some(PrompterScreen::NotConnected),
            Some(duplicated()),
            Some(connected()),
            None,
        ] {
            assert_eq!(
                screen_report(false, screen.as_ref(), None, &drawing, false),
                Some(full.clone()),
                "{screen:?}"
            );
            assert_eq!(
                screen_report(false, screen.as_ref(), None, &Glass::Closed, false),
                None
            );
        }
        let failed = Glass::Failed {
            at,
            reason: String::from("The window could not be built: no."),
        };
        let report = screen_report(false, None, None, &failed, false).expect("a report");
        assert_eq!(report["windowError"], "The window could not be built: no.");
        assert!(!says_it_draws(&report));
        assert!(says_it_draws(&full));
        assert!(!says_it_draws(&json!({ "found": false })));
        assert!(!says_it_draws(
            &json!({ "found": true, "duplicated": true, "width": 1920, "height": 1080 })
        ));
    }

    // shell.log says what the hardware link made of a report: on the
    // owner's first plug-in it is where the whole way is read.
    #[test]
    fn the_log_says_what_the_hardware_link_answered() {
        let answered =
            json!({ "screen": { "word": "CONNECTED", "state": "connected" }, "paused": false });
        assert_eq!(
            answer_line(true, Some(&answered), None),
            "The hardware link has the Prompter XL as CONNECTED."
        );
        let paused = json!({ "screen": { "word": "NOT CONNECTED" }, "paused": true });
        assert_eq!(
            answer_line(true, Some(&paused), None),
            "The hardware link has the Prompter XL as NOT CONNECTED. The text scrolled, and was paused."
        );
        let refused = json!({ "code": "INVALID_PARAMS", "message": "width must be a number above 0 when the screen was found." });
        assert_eq!(
            answer_line(false, None, Some(&refused)),
            "The hardware link refused the Prompter XL's report: width must be a number above 0 when the screen was found."
        );
        assert_eq!(
            answer_line(false, None, None),
            "The hardware link refused the Prompter XL's report: it gave no reason"
        );
        assert_eq!(
            answer_line(true, None, None),
            "The hardware link has the Prompter XL as it did not say what."
        );
    }

    #[test]
    fn the_window_covers_the_prompter_xl_and_no_more() {
        assert!(covers((5120, 0), (1920, 1080), &XL));
        for (position, size) in [
            ((5119, 0), (1920, 1080)),
            ((5120, 1), (1920, 1080)),
            ((5120, 0), (1919, 1080)),
            ((5120, 0), (1920, 1079)),
            ((2560, 0), (2560, 1440)),
            ((0, 0), (1920, 1080)),
        ] {
            assert!(!covers(position, size, &XL), "{position:?} {size:?}");
        }
    }
}
