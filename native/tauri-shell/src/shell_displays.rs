//! The screens, as Windows' display configuration gives them, and what the
//! shell makes of them.
//!
//! Tauri names a monitor by the desktop's own name for it (`\\.\DISPLAY2`), a
//! number that can belong to another screen at the next start, and gives no
//! refresh rate and no word when a screen comes or goes. Windows' display
//! configuration gives each screen's own name, from its EDID (`HP E273q`,
//! `Prompter XL`), the part of the desktop it shows, and its refresh rate;
//! and it shows a duplicated screen as it is, two screens on one part of the
//! desktop. It is read once a second (`shell_display_watch.rs`).
//!
//! Reading it is two calls of Windows, made in one function,
//! `read_display_paths`, which answers plain data. Every rule is a function
//! over that data, so that it is tested without a screen, on any system.

/// A screen that is on, and the part of the desktop it shows: an active path
/// of Windows' display configuration, from a source (what the desktop draws)
/// to a target (a screen).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DisplayPath {
    /// The desktop's name for the source, `\\.\DISPLAY2`: the name Tauri
    /// gives its monitor.
    pub(crate) source: String,
    /// Where the source stands on the desktop, in pixels.
    pub(crate) x: i32,
    pub(crate) y: i32,
    /// The source's size in pixels.
    pub(crate) width: u32,
    pub(crate) height: u32,
    /// The screen's own name, as its EDID gives it: `Prompter XL`. Empty when
    /// the screen gives none.
    pub(crate) target: String,
    /// The refresh rate, when Windows gives one.
    pub(crate) refresh_hz: Option<f64>,
}

/// Every screen that is on, as Windows' display configuration has them now.
/// It reads, and changes nothing. On another system than Windows there is
/// nothing to read, and the list is empty.
#[cfg(windows)]
#[allow(unsafe_code)]
pub(crate) fn read_display_paths() -> Result<Vec<DisplayPath>, String> {
    use std::mem::size_of;
    use std::ptr::from_mut;
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE, DISPLAYCONFIG_PATH_INFO,
        DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
    };
    use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS};

    /// A name Windows wrote into a fixed array: up to its first zero.
    fn name(letters: &[u16]) -> String {
        let end = letters
            .iter()
            .position(|letter| *letter == 0)
            .unwrap_or(letters.len());
        String::from_utf16_lossy(&letters[..end]).trim().to_string()
    }

    fn display_path(
        path: &DISPLAYCONFIG_PATH_INFO,
        modes: &[DISPLAYCONFIG_MODE_INFO],
    ) -> Option<DisplayPath> {
        let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
        source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        source.header.size = size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
        source.header.adapterId = path.sourceInfo.adapterId;
        source.header.id = path.sourceInfo.id;
        // SAFETY: the packet is a live `DISPLAYCONFIG_SOURCE_DEVICE_NAME`,
        // which begins with its header; the header names the packet's kind
        // and its whole size, and the call writes within that size.
        let sourced = unsafe { DisplayConfigGetDeviceInfo(from_mut(&mut source).cast()) };
        if sourced != 0 {
            return None;
        }

        let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
        target.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
        target.header.size = size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
        target.header.adapterId = path.targetInfo.adapterId;
        target.header.id = path.targetInfo.id;
        // SAFETY: as above, for a live `DISPLAYCONFIG_TARGET_DEVICE_NAME`.
        let targeted = unsafe { DisplayConfigGetDeviceInfo(from_mut(&mut target).cast()) };
        // A screen whose name cannot be read is a screen without a name: it
        // still takes its part of the desktop, and can still be a copy.
        let target = if targeted == 0 {
            name(&target.monitorFriendlyDeviceName)
        } else {
            String::new()
        };

        // SAFETY: the union's other member splits the same 32 bits in two,
        // and is filled only when the query asks for virtual modes
        // (`QDC_VIRTUAL_MODE_AWARE`), which this one does not.
        let index = unsafe { path.sourceInfo.Anonymous.modeInfoIdx } as usize;
        let mode = modes
            .get(index)
            .filter(|mode| mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE)?;
        // SAFETY: the mode's type, checked above, says that the union holds
        // a source mode.
        let mode = unsafe { mode.Anonymous.sourceMode };

        let rate = path.targetInfo.refreshRate;
        Some(DisplayPath {
            source: name(&source.viewGdiDeviceName),
            x: mode.position.x,
            y: mode.position.y,
            width: mode.width,
            height: mode.height,
            target,
            refresh_hz: (rate.Numerator > 0 && rate.Denominator > 0)
                .then(|| f64::from(rate.Numerator) / f64::from(rate.Denominator)),
        })
    }

    // The screens can change between the call that sizes the lists and the
    // call that fills them. Windows then answers that the lists are too
    // small, and both calls are made again.
    for _ in 0..3 {
        let mut path_count = 0u32;
        let mut mode_count = 0u32;
        // SAFETY: both pointers are to live `u32`s, which the call writes.
        let sized = unsafe {
            GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
        };
        if sized != ERROR_SUCCESS {
            return Err(format!(
                "Windows did not size its display configuration (error {}).",
                sized.0
            ));
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        // SAFETY: the two lists hold `path_count` and `mode_count` elements,
        // the counts the call is given. It writes no more than that, and sets
        // the counts to what it wrote. With `QDC_ONLY_ACTIVE_PATHS` the
        // topology's pointer must be null, which `None` is.
        let queried = unsafe {
            QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                None,
            )
        };
        if queried == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if queried != ERROR_SUCCESS {
            return Err(format!(
                "Windows did not give its display configuration (error {}).",
                queried.0
            ));
        }
        paths.truncate(path_count as usize);
        modes.truncate(mode_count as usize);
        return Ok(paths
            .iter()
            .filter_map(|path| display_path(path, &modes))
            .collect());
    }
    Err(String::from(
        "The screens kept changing while Windows' display configuration was read.",
    ))
}

#[cfg(not(windows))]
pub(crate) fn read_display_paths() -> Result<Vec<DisplayPath>, String> {
    Ok(Vec::new())
}

/// The name Windows gives the Prompter XL: its EDID's.
pub(crate) const PROMPTER_XL_NAME: &str = "Prompter XL";

/// What the Prompter XL is among the screens.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PrompterScreen {
    /// No screen that is on has its name.
    NotConnected,
    /// It shows a part of the desktop that another screen shows too: it
    /// copies a screen, or a screen copies it.
    Duplicated {
        width: u32,
        height: u32,
        refresh_hz: Option<f64>,
    },
    /// It shows a part of the desktop of its own.
    Connected(DisplayPath),
}

/// The Prompter XL among `paths`: the screen of that name and of no other.
/// A name that only holds it (`Prompter XL 2`, `Not a Prompter XL`) or spells
/// it otherwise is another screen. Of two screens of the name the first is
/// taken.
pub(crate) fn prompter_screen(paths: &[DisplayPath]) -> PrompterScreen {
    let Some(prompter) = paths.iter().find(|path| path.target == PROMPTER_XL_NAME) else {
        return PrompterScreen::NotConnected;
    };
    let shown_by = paths
        .iter()
        .filter(|path| path.source == prompter.source)
        .count();
    if shown_by > 1 {
        PrompterScreen::Duplicated {
            width: prompter.width,
            height: prompter.height,
            refresh_hz: prompter.refresh_hz,
        }
    } else {
        PrompterScreen::Connected(prompter.clone())
    }
}

/// One line for shell.log: the screens that are on, each part of the desktop
/// with the screens that show it, and what the Prompter XL is among them.
/// The names are Windows' own, so the line also says what a screen is
/// called that was expected under another name.
pub(crate) fn screens_line(paths: &[DisplayPath]) -> String {
    let mut parts: Vec<&DisplayPath> = Vec::new();
    for path in paths {
        if !parts.iter().any(|part| part.source == path.source) {
            parts.push(path);
        }
    }
    let screens = parts
        .iter()
        .map(|part| {
            let names = paths
                .iter()
                .filter(|path| path.source == part.source)
                .map(|path| {
                    if path.target.is_empty() {
                        "a screen without a name"
                    } else {
                        path.target.as_str()
                    }
                })
                .collect::<Vec<_>>();
            format!(
                "{} {}×{} at {},{}{}",
                names.join(" and "),
                part.width,
                part.height,
                part.x,
                part.y,
                if names.len() > 1 { " (duplicated)" } else { "" }
            )
        })
        .collect::<Vec<_>>();
    let prompter = match prompter_screen(paths) {
        PrompterScreen::NotConnected => String::from("is not connected"),
        PrompterScreen::Duplicated { .. } => String::from("is duplicated"),
        PrompterScreen::Connected(path) => format!(
            "is connected, {}×{}{}",
            path.width,
            path.height,
            path.refresh_hz
                .map(|rate| format!(" at {} Hz", rate.round()))
                .unwrap_or_default()
        ),
    };
    if screens.is_empty() {
        format!("The screens: none was read. The {PROMPTER_XL_NAME} {prompter}.")
    } else {
        format!(
            "The screens: {}. The {PROMPTER_XL_NAME} {prompter}.",
            screens.join("; ")
        )
    }
}

/// Whether the screens are the same ones, standing where they stood: the
/// order in which Windows lists them does not count.
pub(crate) fn same_screens(before: &[DisplayPath], now: &[DisplayPath]) -> bool {
    before.len() == now.len() && before.iter().all(|path| now.contains(path))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn path(source: &str, place: (i32, i32), target: &str) -> DisplayPath {
        DisplayPath {
            source: source.to_string(),
            x: place.0,
            y: place.1,
            width: 2560,
            height: 1440,
            target: target.to_string(),
            refresh_hz: Some(59.951),
        }
    }

    pub(crate) fn prompter(source: &str, place: (i32, i32)) -> DisplayPath {
        DisplayPath {
            width: 1920,
            height: 1080,
            refresh_hz: Some(60.0),
            ..path(source, place, PROMPTER_XL_NAME)
        }
    }

    /// The studio's own screens, as `read_display_paths` gave them on
    /// 2026-09-28: the studio display, and the primary with its copy.
    pub(crate) fn the_studio() -> Vec<DisplayPath> {
        vec![
            path(r"\\.\DISPLAY3", (0, 0), "SAMSUNG"),
            path(r"\\.\DISPLAY3", (0, 0), "CS2731"),
            path(r"\\.\DISPLAY2", (2560, 0), "HP E273q"),
        ]
    }

    // D15's rule 4 and §7: the prompter's window opens on the screen Windows
    // names `Prompter XL`, and on no other. Without it there is no such
    // screen, whatever else is plugged in.
    #[test]
    fn without_a_screen_of_its_name_the_prompter_xl_is_not_connected() {
        assert_eq!(prompter_screen(&[]), PrompterScreen::NotConnected);
        assert_eq!(prompter_screen(&the_studio()), PrompterScreen::NotConnected);
        for name in [
            "Prompter XL 2",
            "Not a Prompter XL",
            "prompter xl",
            "PROMPTER XL",
            "Prompter  XL",
            "PrompterXL",
            "Prompter",
            "XL",
            "Elgato Prompter XL",
            "",
        ] {
            let mut screens = the_studio();
            screens.push(path(r"\\.\DISPLAY4", (5120, 0), name));
            assert_eq!(
                prompter_screen(&screens),
                PrompterScreen::NotConnected,
                "{name:?}"
            );
        }
    }

    #[test]
    fn the_prompter_xl_is_the_screen_of_its_name_wherever_it_stands() {
        let beside = prompter(r"\\.\DISPLAY4", (5120, 0));
        let mut screens = the_studio();
        screens.push(beside.clone());
        assert_eq!(prompter_screen(&screens), PrompterScreen::Connected(beside));

        // Windows numbers the screens as it likes, and lists them in any
        // order: the name decides.
        let first = prompter(r"\\.\DISPLAY1", (-1920, 360));
        let mut screens = vec![first.clone()];
        screens.extend(the_studio());
        assert_eq!(prompter_screen(&screens), PrompterScreen::Connected(first));

        // The studio's own copy of its primary does not make the Prompter XL
        // a copy.
        let alone = prompter(r"\\.\DISPLAY7", (0, 1440));
        assert_eq!(
            prompter_screen(std::slice::from_ref(&alone)),
            PrompterScreen::Connected(alone)
        );
    }

    // §7: a Prompter XL that shows a copy of another screen would show the
    // operator's desktop to the presenter, and the script to nobody.
    #[test]
    fn a_prompter_xl_that_shares_its_part_of_the_desktop_is_duplicated() {
        let duplicated = PrompterScreen::Duplicated {
            width: 1920,
            height: 1080,
            refresh_hz: Some(60.0),
        };
        // It copies the studio display: both show `DISPLAY2`.
        let mut screens = the_studio();
        screens.push(DisplayPath {
            x: 2560,
            y: 0,
            ..prompter(r"\\.\DISPLAY2", (2560, 0))
        });
        assert_eq!(prompter_screen(&screens), duplicated);
        // Listed first, it is no less a copy.
        screens.rotate_right(1);
        assert_eq!(prompter_screen(&screens), duplicated);
    }

    #[test]
    fn the_screens_are_the_same_whatever_order_windows_lists_them_in() {
        let studio = the_studio();
        let mut listed_otherwise = the_studio();
        listed_otherwise.reverse();
        assert!(same_screens(&studio, &listed_otherwise));
        assert!(same_screens(&[], &[]));

        let mut with_prompter = the_studio();
        with_prompter.push(prompter(r"\\.\DISPLAY4", (5120, 0)));
        assert!(!same_screens(&studio, &with_prompter));
        assert!(!same_screens(&with_prompter, &studio));

        // A screen that moved on the desktop, or changed its size, or that
        // Windows numbers otherwise, is a change.
        let mut moved = the_studio();
        moved[2].x = 0;
        assert!(!same_screens(&studio, &moved));
        let mut resized = the_studio();
        resized[2].width = 1920;
        assert!(!same_screens(&studio, &resized));
        let mut renumbered = the_studio();
        renumbered[2].source = String::from(r"\\.\DISPLAY1");
        assert!(!same_screens(&studio, &renumbered));
    }

    #[test]
    fn the_logs_line_names_the_screens_and_says_what_the_prompter_xl_is() {
        assert_eq!(
            screens_line(&the_studio()),
            "The screens: SAMSUNG and CS2731 2560×1440 at 0,0 (duplicated); HP E273q 2560×1440 at 2560,0. The Prompter XL is not connected."
        );
        let mut screens = the_studio();
        screens.push(prompter(r"\\.\DISPLAY4", (5120, 0)));
        assert_eq!(
            screens_line(&screens),
            "The screens: SAMSUNG and CS2731 2560×1440 at 0,0 (duplicated); HP E273q 2560×1440 at 2560,0; Prompter XL 1920×1080 at 5120,0. The Prompter XL is connected, 1920×1080 at 60 Hz."
        );
        let copy = vec![
            path(r"\\.\DISPLAY1", (0, 0), "HP E273q"),
            DisplayPath {
                refresh_hz: None,
                ..prompter(r"\\.\DISPLAY1", (0, 0))
            },
            path(r"\\.\DISPLAY2", (2560, 0), ""),
        ];
        assert_eq!(
            screens_line(&copy),
            "The screens: HP E273q and Prompter XL 2560×1440 at 0,0 (duplicated); a screen without a name 2560×1440 at 2560,0. The Prompter XL is duplicated."
        );
        assert_eq!(
            screens_line(&[]),
            "The screens: none was read. The Prompter XL is not connected."
        );
    }

    // On the workstation the list is never empty while a screen is on. It is
    // read here only to see that the calls answer: what it holds is the
    // workstation's own. Elsewhere there is nothing to read.
    #[test]
    fn the_screens_can_be_read() {
        let screens = read_display_paths().expect("the display configuration is read");
        for screen in &screens {
            assert!(screen.source.starts_with(r"\\.\DISPLAY"), "{screen:?}");
            assert!(screen.width > 0 && screen.height > 0, "{screen:?}");
            assert!(
                screen
                    .refresh_hz
                    .is_none_or(|rate| rate > 1.0 && rate < 1000.0),
                "{screen:?}"
            );
        }
        if cfg!(not(windows)) {
            assert!(screens.is_empty());
        }
    }
}
