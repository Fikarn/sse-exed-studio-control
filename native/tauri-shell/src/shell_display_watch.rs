//! The shell's watch over the screens. Once a second it reads them
//! (`shell_displays.rs`) and keeps the window on its display
//! (`shell_window_layout::Held`): Windows gives no word that Tauri passes on
//! when a screen comes or goes, so the shell looks.
//!
//! Windows moves windows about while the screens change, and the change can
//! take more than one look. So the watch waits until two looks in a row find
//! the same screens before it puts anything back, and saves the window's
//! display only while the screens stand still.
//!
//! shell.log says which screens the shell sees, by the names Windows gives
//! them, at the start and whenever they have changed.

use crate::shell_displays::{read_display_paths, same_screens, screens_line, DisplayPath};
use crate::shell_window_layout::{log_shell_line, Held};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

/// How often the shell looks at the screens.
const LOOK_EVERY: Duration = Duration::from_secs(1);

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
}

impl DisplayWatch {
    /// Whether a look was taken yet.
    pub(crate) fn has_looked(&self) -> bool {
        self.last.is_some()
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
            Screens::Changing
        } else if self.unsettled {
            self.unsettled = false;
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
    let mut held = Held::from_saved(app);
    // A read that fails is said when it begins to fail, not once a second.
    let mut unread = false;
    loop {
        match read_display_paths() {
            Ok(screens) => {
                if unread {
                    log_shell_line(app, "The screens are read again.");
                }
                unread = false;
                let first = !displays.has_looked();
                let line = screens_line(&screens);
                match displays.look(screens) {
                    Screens::Still => {
                        if first {
                            log_shell_line(app, &line);
                        }
                        held.follow(app);
                    }
                    Screens::Changing => {}
                    Screens::Settled => {
                        log_shell_line(app, &line);
                        held.put_back(app);
                    }
                }
            }
            Err(error) => {
                if !unread {
                    log_shell_line(app, &format!("The screens were not read: {error}"));
                }
                unread = true;
            }
        }
        thread::sleep(LOOK_EVERY);
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
        for _ in 0..3 {
            assert_eq!(watch.look(Vec::new()), Screens::Still);
        }
    }
}
