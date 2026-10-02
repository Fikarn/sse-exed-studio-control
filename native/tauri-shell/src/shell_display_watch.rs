//! The shell's watch over the screens. Once a second it reads them
//! (`shell_displays.rs`) and keeps the window on its display
//! (`shell_window_layout::HeldDisplay`): Windows gives no word that Tauri
//! passes on when a screen comes or goes, so the shell looks.
//!
//! Windows moves windows about while the screens change, and the change can
//! take more than one look. So the watch waits until the screens have stood
//! still for a look's second before it puts anything back, and saves the
//! window's display only while the screens stand still.
//!
//! The watch keeps the prompter's window too (`shell_prompter_window.rs`):
//! at every look it says what the Prompter XL is among the screens. That
//! window closes at the look that does not find the Prompter XL, and opens
//! once the screens stand still.
//!
//! shell.log says which screens the shell sees, by the names Windows gives
//! them and with their refresh rates, at the start, whenever they have
//! changed and whenever a rate has changed and stood for a look; a screen
//! below 50 Hz is a warning beside it (fix E, 2026-10-02). It says when they
//! do not stand still, when they cannot be read, and when a look fails.

use crate::shell_displays::{
    low_refresh_line, prompter_screen, read_display_paths, same_rates, same_screens, screens_line,
    DisplayPath,
};
use crate::shell_prompter_window::PrompterWindow;
use crate::shell_window_layout::{
    hold_once_the_screens_changed, hold_while_the_screens_stand_still, log_shell_line,
};
use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// How often the shell looks at the screens.
const LOOK_EVERY: Duration = Duration::from_secs(1);

/// After this many looks in a row that each found the screens changed,
/// shell.log says that they do not stand still.
const UNSETTLED_SAID_AFTER: u32 = 10;

/// What a look at the screens found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Screens {
    /// As they were at the look before.
    Still,
    /// Not as they were: Windows may still be moving windows about.
    Changing,
    /// As they were at the look before, which found them changed; but that
    /// was less than a look's second ago (a woken look), which is too soon
    /// to say that they stand still.
    Settling,
    /// They changed, and have stood still for a second.
    Settled,
}

/// The screens as the last look found them, and whether a change waits to
/// settle.
#[derive(Default)]
pub(crate) struct DisplayWatch {
    last: Option<Vec<DisplayPath>>,
    unsettled: bool,
    /// When a look last found the screens changed.
    changed_at: Option<Instant>,
    /// The looks in a row that each found the screens changed.
    changing: u32,
    /// Whether this look found every rate as the look before did.
    rates_stood: bool,
    /// The screens as shell.log last said them.
    said: Option<Vec<DisplayPath>>,
}

impl DisplayWatch {
    /// Whether a look was taken yet.
    pub(crate) fn has_looked(&self) -> bool {
        self.last.is_some()
    }

    /// The screens as the last look found them.
    pub(crate) fn screens(&self) -> &[DisplayPath] {
        self.last.as_deref().unwrap_or_default()
    }

    /// Whether this look is the one at which shell.log says that the
    /// screens do not stand still: said once, until they have.
    pub(crate) fn unsettled_for_long(&self) -> bool {
        self.changing == UNSETTLED_SAID_AFTER
    }

    /// One look, at `now`. The first finds the screens as they are, and no
    /// change. A change has settled once the screens have stood still for a
    /// look's second: a look woken sooner (the hardware link started, the
    /// prompter's page said something new) does not say so.
    pub(crate) fn look(&mut self, screens: Vec<DisplayPath>, now: Instant) -> Screens {
        let same = self
            .last
            .as_ref()
            .is_none_or(|last| same_screens(last, &screens));
        self.rates_stood = self
            .last
            .as_ref()
            .is_some_and(|last| same_rates(last, &screens));
        self.last = Some(screens);
        if !same {
            self.unsettled = true;
            self.changed_at = Some(now);
            self.changing = self.changing.saturating_add(1);
            Screens::Changing
        } else if !self.unsettled {
            Screens::Still
        } else if self
            .changed_at
            .is_some_and(|at| now.saturating_duration_since(at) < LOOK_EVERY)
        {
            Screens::Settling
        } else {
            self.unsettled = false;
            self.changing = 0;
            Screens::Settled
        }
    }

    /// Whether shell.log should say the screens again for their rates: a
    /// rate is not the one it said last, and stood for a look. A screen that
    /// changes its rate at every look is not said at every look.
    pub(crate) fn rates_to_say(&self) -> bool {
        self.rates_stood
            && self
                .said
                .as_ref()
                .is_some_and(|said| !same_rates(said, self.screens()))
    }

    /// shell.log has said the screens as the last look found them.
    pub(crate) fn said(&mut self) {
        self.said = self.last.clone();
    }

    /// A settled look whose hold could not look at the screens: the next
    /// look settles again, and the hold runs again.
    fn settle_again(&mut self) {
        self.unsettled = true;
    }
}

/// Starts the watch, on a thread of its own for as long as the shell runs.
/// Called once the window stands on its display. `woken` wakes it before its
/// second is over (`shell_prompter_window::WatchWake`).
pub(crate) fn start_display_watch(app: &AppHandle, woken: Receiver<()>) {
    let watched = app.clone();
    let started = thread::Builder::new()
        .name(String::from("display-watch"))
        .spawn(move || watch(&watched, &woken));
    if let Err(error) = started {
        log_shell_line(
            app,
            &format!("The watch over the screens did not start: {error}"),
        );
    }
}

fn watch(app: &AppHandle, woken: &Receiver<()>) {
    let mut displays = DisplayWatch::default();
    let mut prompter = PrompterWindow::start(app);
    // A read that fails is said when it begins to fail, not once a second;
    // and so is a look that fails.
    let mut unread = false;
    let mut failed = false;
    loop {
        // A studio build has no console: a look that panicked would end the
        // watch without a word. It is said in shell.log, and the watch goes
        // on.
        let looked = catch_unwind(AssertUnwindSafe(|| {
            look(app, &mut displays, &mut prompter, &mut unread)
        }));
        if let Err(reason) = &looked {
            if !failed {
                log_shell_line(
                    app,
                    &format!(
                        "A look at the screens failed, and the watch over them goes on: {}",
                        panic_words(reason.as_ref())
                    ),
                );
            }
        }
        failed = looked.is_err();
        // The next look comes in a second, or when the watch is woken. With
        // nobody left to wake it, it looks once a second as before.
        if woken.recv_timeout(LOOK_EVERY) == Err(RecvTimeoutError::Disconnected) {
            thread::sleep(LOOK_EVERY);
        }
    }
}

/// The screens' line in shell.log, and the warning beside it while a screen
/// runs below 50 Hz.
fn say_the_screens(app: &AppHandle, displays: &mut DisplayWatch, line: &str) {
    log_shell_line(app, line);
    if let Some(low) = low_refresh_line(displays.screens()) {
        log_shell_line(app, &low);
    }
    displays.said();
}

/// What a panic said.
fn panic_words(reason: &(dyn Any + Send)) -> String {
    reason
        .downcast_ref::<&str>()
        .map(ToString::to_string)
        .or_else(|| reason.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| String::from("no reason was given"))
}

fn look(
    app: &AppHandle,
    displays: &mut DisplayWatch,
    prompter: &mut PrompterWindow,
    unread: &mut bool,
) {
    match read_display_paths() {
        Ok(screens) => {
            if *unread {
                log_shell_line(app, "The screens are read again.");
            }
            *unread = false;
            let first = !displays.has_looked();
            let line = screens_line(&screens);
            let looked = displays.look(screens, Instant::now());
            // The prompter's window first: it closes at this look when the
            // Prompter XL is not there, before anything else is done.
            prompter.look(
                app,
                Some(&prompter_screen(displays.screens())),
                matches!(looked, Screens::Still | Screens::Settled),
            );
            match looked {
                Screens::Still => {
                    if first || displays.rates_to_say() {
                        say_the_screens(app, displays, &line);
                    }
                    hold_while_the_screens_stand_still(app, displays.screens());
                }
                Screens::Changing => {
                    if displays.unsettled_for_long() {
                        log_shell_line(
                            app,
                            &format!(
                                "The screens have not stood still for {UNSETTLED_SAID_AFTER} looks, and no window is moved until they do. Now: {line}"
                            ),
                        );
                    }
                }
                Screens::Settling => {}
                Screens::Settled => {
                    say_the_screens(app, displays, &line);
                    if !hold_once_the_screens_changed(app, displays.screens()) {
                        log_shell_line(
                            app,
                            "The look at the screens did not come back in time: it is taken again at the next look.",
                        );
                        displays.settle_again();
                    }
                }
            }
        }
        Err(error) => {
            if !*unread {
                log_shell_line(app, &format!("The screens were not read: {error}"));
            }
            *unread = true;
            // Nothing is known of the Prompter XL: nothing is drawn on it.
            prompter.look(app, None, false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell_displays::tests::{prompter, the_studio};

    /// The watch's clock: a look a second, as the watch takes them.
    struct Clock(Instant);

    impl Clock {
        fn new() -> Self {
            Self(Instant::now())
        }

        fn tick(&mut self) -> Instant {
            self.0 += LOOK_EVERY;
            self.0
        }
    }

    // §7: the Prompter XL is plugged in, and out. Windows takes its time to
    // rearrange the screens, and moves windows while it does: nothing is put
    // back, and no display is saved, until the screens stand still.
    #[test]
    fn a_change_of_the_screens_is_acted_on_once_they_stand_still() {
        let mut watch = DisplayWatch::default();
        let mut clock = Clock::new();
        assert!(!watch.has_looked());
        assert_eq!(
            watch.look(the_studio(), clock.tick()),
            Screens::Still,
            "the first look"
        );
        assert!(watch.has_looked());
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Still);

        // Plugged in: first on the desktop's far side, then where Windows
        // settles it.
        let mut arriving = the_studio();
        arriving.push(prompter(r"\\.\DISPLAY4", (5120, 0)));
        let mut arrived = the_studio();
        arrived.push(prompter(r"\\.\DISPLAY4", (-1920, 0)));
        assert_eq!(watch.look(arriving, clock.tick()), Screens::Changing);
        assert_eq!(watch.look(arrived.clone(), clock.tick()), Screens::Changing);
        assert_eq!(watch.look(arrived.clone(), clock.tick()), Screens::Settled);
        assert_eq!(watch.look(arrived.clone(), clock.tick()), Screens::Still);

        // Windows lists the same screens in another order: no change.
        let mut listed_otherwise = arrived.clone();
        listed_otherwise.reverse();
        assert_eq!(watch.look(listed_otherwise, clock.tick()), Screens::Still);

        // Unplugged.
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Changing);
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Settled);
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Still);
    }

    // 2026-09-29 (#270): the hold after a change looks at the screens on the
    // main thread, and that look can fail to come back in time. The change is
    // not lost: the next look settles again, and the hold runs again, where a
    // look at rest would take the display Windows moved the window to.
    #[test]
    fn a_settled_look_whose_hold_did_not_look_settles_again() {
        let mut watch = DisplayWatch::default();
        let mut clock = Clock::new();
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Still);
        let mut arrived = the_studio();
        arrived.push(prompter(r"\\.\DISPLAY4", (-1920, 0)));
        assert_eq!(watch.look(arrived.clone(), clock.tick()), Screens::Changing);
        assert_eq!(watch.look(arrived.clone(), clock.tick()), Screens::Settled);
        watch.settle_again();
        assert_eq!(
            watch.look(arrived.clone(), clock.tick()),
            Screens::Settled,
            "the hold runs again"
        );
        assert_eq!(watch.look(arrived, clock.tick()), Screens::Still);
    }

    // Fix E (2026-10-02): a refresh rate moves no window, but shell.log says
    // it once it has stood for a look.
    #[test]
    fn a_change_of_rate_is_said_once_it_stood_for_a_look() {
        let mut watch = DisplayWatch::default();
        let mut clock = Clock::new();
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Still);
        watch.said();
        assert!(!watch.rates_to_say());

        let mut at_thirty = the_studio();
        at_thirty[0].refresh_hz = Some(30.0);
        assert_eq!(
            watch.look(at_thirty.clone(), clock.tick()),
            Screens::Still,
            "no window moves"
        );
        assert!(!watch.rates_to_say(), "not at the look that found it");
        assert_eq!(watch.look(at_thirty.clone(), clock.tick()), Screens::Still);
        assert!(watch.rates_to_say(), "once it stood");
        watch.said();
        assert_eq!(watch.look(at_thirty, clock.tick()), Screens::Still);
        assert!(!watch.rates_to_say(), "said once");

        // A screen that changes its rate at every look is not said each time.
        for rate in [50.0, 60.0, 50.0, 60.0] {
            let mut flapping = the_studio();
            flapping[0].refresh_hz = Some(rate);
            watch.look(flapping, clock.tick());
            assert!(!watch.rates_to_say(), "{rate}");
        }
    }

    // Where there is nothing to read (any system but Windows) every look
    // finds no screen, and no change.
    #[test]
    fn no_screens_at_all_are_no_change() {
        let mut watch = DisplayWatch::default();
        let mut clock = Clock::new();
        assert!(watch.screens().is_empty());
        for _ in 0..3 {
            assert_eq!(watch.look(Vec::new(), clock.tick()), Screens::Still);
            assert!(watch.screens().is_empty());
        }
    }

    // Screens that never stand still move no window, and leave no line: so
    // shell.log is told once that they do not, and again only after they
    // have stood still in between.
    #[test]
    fn screens_that_do_not_stand_still_are_said_once() {
        let mut watch = DisplayWatch::default();
        let mut clock = Clock::new();
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Still);
        let mut said = 0;
        for look in 0..40 {
            let mut screens = the_studio();
            screens.push(prompter(r"\\.\DISPLAY4", (5120 + look, 0)));
            assert_eq!(watch.look(screens, clock.tick()), Screens::Changing);
            said += u32::from(watch.unsettled_for_long());
        }
        assert_eq!(said, 1);
        assert_eq!(watch.screens().len(), 4, "the last look's screens");

        let mut settled = the_studio();
        settled.push(prompter(r"\\.\DISPLAY4", (5120 + 39, 0)));
        assert_eq!(watch.look(settled, clock.tick()), Screens::Settled);
        assert!(!watch.unsettled_for_long());
        for look in 0..UNSETTLED_SAID_AFTER {
            let mut screens = the_studio();
            screens.push(prompter(r"\\.\DISPLAY4", (0, 1440 + look as i32)));
            assert_eq!(watch.look(screens, clock.tick()), Screens::Changing);
            said += u32::from(watch.unsettled_for_long());
        }
        assert_eq!(said, 2);
    }

    // A look woken before its second is over (the hardware link started,
    // the prompter's page said something new) finds the screens as the look
    // before did; but they have not stood still for a second yet, and
    // nothing is put back or opened (the review of #251).
    #[test]
    fn a_woken_look_does_not_say_that_the_screens_stand_still() {
        let mut watch = DisplayWatch::default();
        let mut clock = Clock::new();
        assert_eq!(watch.look(the_studio(), clock.tick()), Screens::Still);
        let mut arrived = the_studio();
        arrived.push(prompter(r"\\.\DISPLAY4", (5120, 0)));
        let changed = clock.tick();
        assert_eq!(watch.look(arrived.clone(), changed), Screens::Changing);
        let woken = changed + Duration::from_millis(30);
        assert_eq!(watch.look(arrived.clone(), woken), Screens::Settling);
        assert_eq!(
            watch.look(
                arrived.clone(),
                changed + LOOK_EVERY - Duration::from_millis(1)
            ),
            Screens::Settling
        );
        assert!(!watch.unsettled_for_long());
        assert_eq!(
            watch.look(arrived.clone(), changed + LOOK_EVERY),
            Screens::Settled
        );
        assert_eq!(
            watch.look(arrived, changed + LOOK_EVERY + Duration::from_millis(5)),
            Screens::Still
        );
    }

    #[test]
    fn a_panic_s_words_reach_the_log() {
        let said = catch_unwind(|| {
            panic!("the window is gone");
        })
        .expect_err("a panic");
        assert_eq!(panic_words(said.as_ref()), "the window is gone");
        let count = 3;
        let said = catch_unwind(|| {
            panic!("{count} screens");
        })
        .expect_err("a panic");
        assert_eq!(panic_words(said.as_ref()), "3 screens");
        let said = catch_unwind(|| {
            std::panic::panic_any(7_u8);
        })
        .expect_err("a panic");
        assert_eq!(panic_words(said.as_ref()), "no reason was given");
    }
}
