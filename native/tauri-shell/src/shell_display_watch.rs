//! The shell's watch over the screens. Once a second it reads them
//! (`shell_displays.rs`) and keeps the window on its display
//! (`shell_window_layout::HeldDisplay`): Windows gives no word that Tauri
//! passes on when a screen comes or goes, so the shell looks.
//!
//! Windows moves windows about while the screens change, and the change can
//! take more than one look. So the watch waits until two looks in a row find
//! the same screens before it puts anything back, and saves the window's
//! display only while the screens stand still.
//!
//! shell.log says which screens the shell sees, by the names Windows gives
//! them, at the start and whenever they have changed; and it says when they
//! do not stand still, when they cannot be read, and when a look fails.

use crate::shell_displays::{read_display_paths, same_screens, screens_line, DisplayPath};
use crate::shell_window_layout::{
    hold_once_the_screens_changed, hold_while_the_screens_stand_still, log_shell_line,
};
use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::thread;
use std::time::Duration;
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
    /// They changed, and have stood still for one look.
    Settled,
}

/// The screens as the last look found them, and whether a change waits to
/// settle.
#[derive(Default)]
pub(crate) struct DisplayWatch {
    last: Option<Vec<DisplayPath>>,
    unsettled: bool,
    /// The looks in a row that each found the screens changed.
    changing: u32,
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

    /// One look. The first finds the screens as they are, and no change.
    pub(crate) fn look(&mut self, screens: Vec<DisplayPath>) -> Screens {
        let same = self
            .last
            .as_ref()
            .is_none_or(|last| same_screens(last, &screens));
        self.last = Some(screens);
        if !same {
            self.unsettled = true;
            self.changing = self.changing.saturating_add(1);
            Screens::Changing
        } else if self.unsettled {
            self.unsettled = false;
            self.changing = 0;
            Screens::Settled
        } else {
            Screens::Still
        }
    }
}

/// Starts the watch, on a thread of its own for as long as the shell runs.
/// Called once the window stands on its display.
pub(crate) fn start_display_watch(app: &AppHandle) {
    let watched = app.clone();
    let started = thread::Builder::new()
        .name(String::from("display-watch"))
        .spawn(move || watch(&watched));
    if let Err(error) = started {
        log_shell_line(
            app,
            &format!("The watch over the screens did not start: {error}"),
        );
    }
}

fn watch(app: &AppHandle) {
    let mut displays = DisplayWatch::default();
    // A read that fails is said when it begins to fail, not once a second;
    // and so is a look that fails.
    let mut unread = false;
    let mut failed = false;
    loop {
        // A studio build has no console: a look that panicked would end the
        // watch without a word. It is said in shell.log, and the watch goes
        // on.
        let looked = catch_unwind(AssertUnwindSafe(|| look(app, &mut displays, &mut unread)));
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
        thread::sleep(LOOK_EVERY);
    }
}

/// What a panic said.
fn panic_words(reason: &(dyn Any + Send)) -> String {
    reason
        .downcast_ref::<&str>()
        .map(ToString::to_string)
        .or_else(|| reason.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| String::from("no reason was given"))
}

fn look(app: &AppHandle, displays: &mut DisplayWatch, unread: &mut bool) {
    match read_display_paths() {
        Ok(screens) => {
            if *unread {
                log_shell_line(app, "The screens are read again.");
            }
            *unread = false;
            let first = !displays.has_looked();
            let line = screens_line(&screens);
            match displays.look(screens) {
                Screens::Still => {
                    if first {
                        log_shell_line(app, &line);
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
                Screens::Settled => {
                    log_shell_line(app, &line);
                    hold_once_the_screens_changed(app, displays.screens());
                }
            }
        }
        Err(error) => {
            if !*unread {
                log_shell_line(app, &format!("The screens were not read: {error}"));
            }
            *unread = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell_displays::tests::{prompter, the_studio};

    // §7: the Prompter XL is plugged in, and out. Windows takes its time to
    // rearrange the screens, and moves windows while it does: nothing is put
    // back, and no display is saved, until the screens stand still.
    #[test]
    fn a_change_of_the_screens_is_acted_on_once_they_stand_still() {
        let mut watch = DisplayWatch::default();
        assert!(!watch.has_looked());
        assert_eq!(watch.look(the_studio()), Screens::Still, "the first look");
        assert!(watch.has_looked());
        assert_eq!(watch.look(the_studio()), Screens::Still);

        // Plugged in: first on the desktop's far side, then where Windows
        // settles it.
        let mut arriving = the_studio();
        arriving.push(prompter(r"\\.\DISPLAY4", (5120, 0)));
        let mut arrived = the_studio();
        arrived.push(prompter(r"\\.\DISPLAY4", (-1920, 0)));
        assert_eq!(watch.look(arriving), Screens::Changing);
        assert_eq!(watch.look(arrived.clone()), Screens::Changing);
        assert_eq!(watch.look(arrived.clone()), Screens::Settled);
        assert_eq!(watch.look(arrived.clone()), Screens::Still);

        // Windows lists the same screens in another order: no change.
        let mut listed_otherwise = arrived.clone();
        listed_otherwise.reverse();
        assert_eq!(watch.look(listed_otherwise), Screens::Still);

        // Unplugged.
        assert_eq!(watch.look(the_studio()), Screens::Changing);
        assert_eq!(watch.look(the_studio()), Screens::Settled);
        assert_eq!(watch.look(the_studio()), Screens::Still);
    }

    // Where there is nothing to read (any system but Windows) every look
    // finds no screen, and no change.
    #[test]
    fn no_screens_at_all_are_no_change() {
        let mut watch = DisplayWatch::default();
        assert!(watch.screens().is_empty());
        for _ in 0..3 {
            assert_eq!(watch.look(Vec::new()), Screens::Still);
            assert!(watch.screens().is_empty());
        }
    }

    // Screens that never stand still move no window, and leave no line: so
    // shell.log is told once that they do not, and again only after they
    // have stood still in between.
    #[test]
    fn screens_that_do_not_stand_still_are_said_once() {
        let mut watch = DisplayWatch::default();
        assert_eq!(watch.look(the_studio()), Screens::Still);
        let mut said = 0;
        for look in 0..40 {
            let mut screens = the_studio();
            screens.push(prompter(r"\\.\DISPLAY4", (5120 + look, 0)));
            assert_eq!(watch.look(screens), Screens::Changing);
            said += u32::from(watch.unsettled_for_long());
        }
        assert_eq!(said, 1);
        assert_eq!(watch.screens().len(), 4, "the last look's screens");

        let mut settled = the_studio();
        settled.push(prompter(r"\\.\DISPLAY4", (5120 + 39, 0)));
        assert_eq!(watch.look(settled), Screens::Settled);
        assert!(!watch.unsettled_for_long());
        for look in 0..UNSETTLED_SAID_AFTER {
            let mut screens = the_studio();
            screens.push(prompter(r"\\.\DISPLAY4", (0, 1440 + look as i32)));
            assert_eq!(watch.look(screens), Screens::Changing);
            said += u32::from(watch.unsettled_for_long());
        }
        assert_eq!(said, 2);
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
