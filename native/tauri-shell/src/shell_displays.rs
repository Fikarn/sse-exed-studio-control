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
//! Reading it takes three functions of Windows (the lists' sizes, the
//! lists, and a name for each end of a path), all called in one function of
//! the shell, `read_display_paths`, which answers plain data. Every rule is a
//! function over that data, so that it is tested without a screen, on any
//! system.

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

/// A name Windows wrote into a fixed array: up to its first zero, without
/// the spaces around it. What is no text in it becomes U+FFFD, and matches no
/// name.
#[cfg(any(windows, test))]
fn name_from(letters: &[u16]) -> String {
    let end = letters
        .iter()
        .position(|letter| *letter == 0)
        .unwrap_or(letters.len());
    String::from_utf16_lossy(&letters[..end]).trim().to_string()
}

/// A refresh rate as Windows gives it, a fraction. Either part is 0 when
/// Windows knows none.
#[cfg(any(windows, test))]
fn refresh_rate(numerator: u32, denominator: u32) -> Option<f64> {
    (numerator > 0 && denominator > 0).then(|| f64::from(numerator) / f64::from(denominator))
}

/// Every screen that is on, as Windows' display configuration has them now.
/// It reads, and changes nothing. A screen whose part of the desktop cannot
/// be read fails the whole read, and says so: it could be a copy of any
/// other. On another system than Windows there is nothing to read, and the
/// list is empty.
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

    fn display_path(
        path: &DISPLAYCONFIG_PATH_INFO,
        modes: &[DISPLAYCONFIG_MODE_INFO],
    ) -> Result<DisplayPath, String> {
        let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
        source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        source.header.size = size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
        source.header.adapterId = path.sourceInfo.adapterId;
        source.header.id = path.sourceInfo.id;
        // SAFETY: the pointer is made from the whole packet, a live
        // `DISPLAYCONFIG_SOURCE_DEVICE_NAME`, which begins with its header;
        // the header names the packet's kind and its whole size, and the
        // call writes within that size.
        let sourced = unsafe { DisplayConfigGetDeviceInfo(from_mut(&mut source).cast()) };
        if sourced != 0 {
            return Err(format!(
                "Windows did not name a screen's part of the desktop (error {sourced})."
            ));
        }

        let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
        target.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
        target.header.size = size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
        target.header.adapterId = path.targetInfo.adapterId;
        target.header.id = path.targetInfo.id;
        // SAFETY: as above, for the whole of a live
        // `DISPLAYCONFIG_TARGET_DEVICE_NAME`.
        let targeted = unsafe { DisplayConfigGetDeviceInfo(from_mut(&mut target).cast()) };
        // A screen whose name cannot be read is a screen without a name: it
        // still takes its part of the desktop, and can still be a copy.
        let target = if targeted == 0 {
            name_from(&target.monitorFriendlyDeviceName)
        } else {
            String::new()
        };

        // SAFETY: both members of the union are 32 plain bits, and any 32
        // bits are a number. The other member splits them in two, and is
        // filled only when the query asks for virtual modes
        // (`QDC_VIRTUAL_MODE_AWARE`), which this one does not.
        let index = unsafe { path.sourceInfo.Anonymous.modeInfoIdx } as usize;
        let mode = modes
            .get(index)
            .filter(|mode| mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE)
            .ok_or_else(|| {
                format!(
                    "Windows gave no part of the desktop for the screen {}.",
                    if target.is_empty() {
                        "without a name"
                    } else {
                        target.as_str()
                    }
                )
            })?;
        // SAFETY: the mode's type, checked above, says that the union holds
        // a source mode, which is plain numbers.
        let mode = unsafe { mode.Anonymous.sourceMode };

        let rate = path.targetInfo.refreshRate;
        Ok(DisplayPath {
            source: name_from(&source.viewGdiDeviceName),
            x: mode.position.x,
            y: mode.position.y,
            width: mode.width,
            height: mode.height,
            target,
            refresh_hz: refresh_rate(rate.Numerator, rate.Denominator),
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
        return paths
            .iter()
            .map(|path| display_path(path, &modes))
            .collect();
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

/// Whether two screens show one part of the desktop, or parts that lie over
/// each other: they share a source, or their sources stand at one place (a
/// copy across two graphics adapters has a source on each).
fn share_the_desktop(one: &DisplayPath, other: &DisplayPath) -> bool {
    fn overlap(from: i32, length: u32, other_from: i32, other_length: u32) -> bool {
        i64::from(from) < i64::from(other_from) + i64::from(other_length)
            && i64::from(other_from) < i64::from(from) + i64::from(length)
    }
    one.source == other.source
        || (overlap(one.x, one.width, other.x, other.width)
            && overlap(one.y, one.height, other.y, other.height))
}

/// The Prompter XL among `paths`: the screen of that name and of no other.
/// A name that only holds it (`Prompter XL 2`, `Not a Prompter XL`) or spells
/// it otherwise is another screen. Of two screens of the name the first is
/// taken.
pub(crate) fn prompter_screen(paths: &[DisplayPath]) -> PrompterScreen {
    let Some((place, prompter)) = paths
        .iter()
        .enumerate()
        .find(|(_, path)| path.target == PROMPTER_XL_NAME)
    else {
        return PrompterScreen::NotConnected;
    };
    let shared = paths
        .iter()
        .enumerate()
        .any(|(other, path)| other != place && share_the_desktop(prompter, path));
    if shared {
        PrompterScreen::Duplicated {
            width: prompter.width,
            height: prompter.height,
            refresh_hz: prompter.refresh_hz,
        }
    } else {
        PrompterScreen::Connected(prompter.clone())
    }
}

/// Below this a screen's refresh rate is a warning in shell.log (fix E,
/// 2026-10-02). Studio Control's windows draw at the main screen's rate: the
/// studio's Samsung, a copy of the main screen, stood at 30 Hz, and the
/// prompter's text scrolled at 30 frames a second, unevenly, with nothing in
/// any log to say so.
pub(crate) const LOW_REFRESH_HZ: f64 = 50.0;

/// Rates closer than this are the same rate.
const SAME_RATE_HZ: f64 = 0.01;

/// A rate as shell.log says it: `60 Hz`, `59.95 Hz`, `29.97 Hz`.
fn hz(rate: f64) -> String {
    let text = format!("{rate:.2}");
    format!("{} Hz", text.trim_end_matches('0').trim_end_matches('.'))
}

/// A screen's name in shell.log.
fn name_of(path: &DisplayPath) -> &str {
    if path.target.is_empty() {
        "a screen without a name"
    } else {
        path.target.as_str()
    }
}

/// One line for shell.log: the screens that are on, each with its refresh
/// rate, each part of the desktop with the screens that show it, and what the
/// Prompter XL is among them. The names are Windows' own, so the line also
/// says what a screen is called that was expected under another name.
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
                .map(|path| match path.refresh_hz {
                    Some(rate) => format!("{} ({})", name_of(path), hz(rate)),
                    None => name_of(path).to_string(),
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
                .map(|rate| format!(" at {}", hz(rate)))
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

/// The warning shell.log gets beside the screens' line while a screen runs
/// below `LOW_REFRESH_HZ`, or none.
pub(crate) fn low_refresh_line(paths: &[DisplayPath]) -> Option<String> {
    let low = paths
        .iter()
        .filter_map(|path| {
            let rate = path.refresh_hz?;
            (rate < LOW_REFRESH_HZ).then(|| format!("{} at {}", name_of(path), hz(rate)))
        })
        .collect::<Vec<_>>();
    (!low.is_empty()).then(|| {
        format!(
            "A screen runs below {}: {}. Studio Control's windows draw at the main screen's rate, and below it the prompter's text does not scroll smoothly. Set every screen to 60 Hz in Windows' display settings (59.94 or 59.95 Hz where 60 is not offered).",
            hz(LOW_REFRESH_HZ),
            low.join(", ")
        )
    })
}

/// Whether every screen runs at the rate it ran at. Only screens that are
/// the same ones (`same_screens`) are compared; a screen that is not in both
/// lists is a change of the screens, said as one.
pub(crate) fn same_rates(before: &[DisplayPath], now: &[DisplayPath]) -> bool {
    fn same(one: Option<f64>, other: Option<f64>) -> bool {
        match (one, other) {
            (Some(one), Some(other)) => (one - other).abs() < SAME_RATE_HZ,
            (None, None) => true,
            _ => false,
        }
    }
    now.iter().all(|path| {
        before
            .iter()
            .filter(|other| other.source == path.source && other.target == path.target)
            .all(|other| same(other.refresh_hz, path.refresh_hz))
    })
}

/// Whether the screens are the same ones, standing where they stood: the
/// order in which Windows lists them does not count, and neither does a
/// refresh rate, which moves no window (and which a screen may change by
/// itself). Each screen is counted once: two screens of one kind that copy
/// each other are alike in all the list holds.
pub(crate) fn same_screens(before: &[DisplayPath], now: &[DisplayPath]) -> bool {
    fn stands_as(one: &DisplayPath, other: &DisplayPath) -> bool {
        one.source == other.source
            && one.target == other.target
            && (one.x, one.y, one.width, one.height)
                == (other.x, other.y, other.width, other.height)
    }
    if before.len() != now.len() {
        return false;
    }
    let mut left: Vec<&DisplayPath> = now.iter().collect();
    before.iter().all(|path| {
        let found = left.iter().position(|other| stands_as(other, path));
        if let Some(found) = found {
            left.swap_remove(found);
        }
        found.is_some()
    })
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
        // Beside the studio's screens. The studio's own copy of its primary
        // does not make the Prompter XL a copy.
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

        // The only screen that is on.
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
        // It copies the studio display: both show `DISPLAY2`, and the size
        // is that part of the desktop's.
        let copy = DisplayPath {
            refresh_hz: Some(60.0),
            ..path(r"\\.\DISPLAY2", (2560, 0), PROMPTER_XL_NAME)
        };
        let duplicated = PrompterScreen::Duplicated {
            width: 2560,
            height: 1440,
            refresh_hz: Some(60.0),
        };
        let mut screens = the_studio();
        screens.push(copy);
        assert_eq!(prompter_screen(&screens), duplicated);
        // Listed first, it is no less a copy.
        screens.rotate_right(1);
        assert_eq!(prompter_screen(&screens), duplicated);
    }

    // A copy across two graphics adapters has a source on each, at one place
    // on the desktop. Parts of the desktop that lie over each other are
    // shared, whatever they are called; parts that only touch are not.
    #[test]
    fn a_prompter_xl_that_lies_over_another_screen_is_duplicated() {
        for place in [(2560, 0), (5119 - 1920, 0), (2560, 1439), (4000, -1079)] {
            let mut screens = the_studio();
            screens.push(prompter(r"\\.\DISPLAY4", place));
            assert_eq!(
                prompter_screen(&screens),
                PrompterScreen::Duplicated {
                    width: 1920,
                    height: 1080,
                    refresh_hz: Some(60.0),
                },
                "{place:?}"
            );
        }
        for place in [
            (5120, 0),
            (-1920, 0),
            (0, 1440),
            (2560, -1080),
            (640, -1080),
        ] {
            let beside = prompter(r"\\.\DISPLAY4", place);
            let mut screens = the_studio();
            screens.push(beside.clone());
            assert_eq!(
                prompter_screen(&screens),
                PrompterScreen::Connected(beside),
                "{place:?}"
            );
        }
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
        let mut renamed = the_studio();
        renamed[2].target = String::from("HP E273");
        assert!(!same_screens(&studio, &renamed));
        // Another refresh rate moves no window.
        let mut at_another_rate = the_studio();
        at_another_rate[2].refresh_hz = Some(50.0);
        at_another_rate[1].refresh_hz = None;
        assert!(same_screens(&studio, &at_another_rate));

        // Two screens of one kind that copy each other are alike in all the
        // list holds. One of them gone and another screen come is a change,
        // whichever way it is looked at.
        let twin = path(r"\\.\DISPLAY1", (0, 0), "CS2731");
        let other = path(r"\\.\DISPLAY2", (2560, 0), "HP E273q");
        let come = prompter(r"\\.\DISPLAY4", (5120, 0));
        let twins = [twin.clone(), twin.clone(), other.clone()];
        let one_gone = [twin.clone(), other.clone(), come];
        assert!(same_screens(&twins, &twins));
        assert!(!same_screens(&twins, &one_gone));
        assert!(!same_screens(&one_gone, &twins));
    }

    #[test]
    fn a_name_is_read_up_to_its_end() {
        let letters = |text: &str| text.encode_utf16().collect::<Vec<u16>>();
        let mut array = letters("Prompter XL");
        array.extend([0, 0x48, 0x50, 0]);
        assert_eq!(name_from(&array), "Prompter XL");
        // No zero at all: the array is full.
        assert_eq!(name_from(&letters("HP E273q")), "HP E273q");
        // Spaces around it are not the name's.
        let mut padded = letters("  CS2731  ");
        padded.push(0);
        assert_eq!(name_from(&padded), "CS2731");
        // Nothing but zeros, and nothing at all.
        assert_eq!(name_from(&[0, 0, 0, 0]), "");
        assert_eq!(name_from(&[]), "");
        // Half a letter is no text, and no name that is looked for.
        let mut broken = letters("Prompter XL");
        broken[3] = 0xD800;
        assert_eq!(name_from(&broken), "Pro\u{FFFD}pter XL");
        assert_ne!(name_from(&broken), PROMPTER_XL_NAME);
    }

    #[test]
    fn a_refresh_rate_is_a_fraction_or_none() {
        assert_eq!(refresh_rate(60, 1), Some(60.0));
        let ntsc = refresh_rate(60_000, 1_001).expect("a rate");
        assert!((ntsc - 59.94).abs() < 0.001, "{ntsc}");
        assert_eq!(refresh_rate(0, 1), None);
        assert_eq!(refresh_rate(60, 0), None);
        assert_eq!(refresh_rate(0, 0), None);
    }

    #[test]
    fn the_logs_line_names_the_screens_and_says_what_the_prompter_xl_is() {
        assert_eq!(
            screens_line(&the_studio()),
            "The screens: SAMSUNG (59.95 Hz) and CS2731 (59.95 Hz) 2560×1440 at 0,0 (duplicated); HP E273q (59.95 Hz) 2560×1440 at 2560,0. The Prompter XL is not connected."
        );
        let mut screens = the_studio();
        screens.push(prompter(r"\\.\DISPLAY4", (5120, 0)));
        assert_eq!(
            screens_line(&screens),
            "The screens: SAMSUNG (59.95 Hz) and CS2731 (59.95 Hz) 2560×1440 at 0,0 (duplicated); HP E273q (59.95 Hz) 2560×1440 at 2560,0; Prompter XL (60 Hz) 1920×1080 at 5120,0. The Prompter XL is connected, 1920×1080 at 60 Hz."
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
            "The screens: HP E273q (59.95 Hz) and Prompter XL 2560×1440 at 0,0 (duplicated); a screen without a name (59.95 Hz) 2560×1440 at 2560,0. The Prompter XL is duplicated."
        );
        assert_eq!(
            screens_line(&[]),
            "The screens: none was read. The Prompter XL is not connected."
        );
    }

    // Fix E (2026-10-02): the Samsung at 30 Hz made the prompter's text
    // scroll at 30 frames a second, and no log said so.
    #[test]
    fn a_screen_below_fifty_hz_is_a_warning_naming_it() {
        assert_eq!(low_refresh_line(&the_studio()), None);
        let mut at_thirty = the_studio();
        at_thirty[0].refresh_hz = Some(30.0);
        assert_eq!(
            screens_line(&at_thirty),
            "The screens: SAMSUNG (30 Hz) and CS2731 (59.95 Hz) 2560×1440 at 0,0 (duplicated); HP E273q (59.95 Hz) 2560×1440 at 2560,0. The Prompter XL is not connected."
        );
        assert_eq!(
            low_refresh_line(&at_thirty).as_deref(),
            Some("A screen runs below 50 Hz: SAMSUNG at 30 Hz. Studio Control's windows draw at the main screen's rate, and below it the prompter's text does not scroll smoothly. Set every screen to 60 Hz in Windows' display settings (59.94 or 59.95 Hz where 60 is not offered).")
        );
        let mut two_low = at_thirty.clone();
        two_low[2].refresh_hz = Some(29.97);
        two_low[2].target = String::new();
        assert!(low_refresh_line(&two_low)
            .expect("a warning")
            .contains("SAMSUNG at 30 Hz, a screen without a name at 29.97 Hz."));
        let mut unknown = the_studio();
        unknown[0].refresh_hz = None;
        assert_eq!(
            low_refresh_line(&unknown),
            None,
            "a rate Windows does not give is no warning"
        );
    }

    #[test]
    fn a_rate_is_the_same_to_a_hundredth_of_a_hertz() {
        let studio = the_studio();
        assert!(same_rates(&studio, &studio));
        let mut nudged = the_studio();
        nudged[1].refresh_hz = Some(59.955);
        assert!(same_rates(&studio, &nudged));
        let mut at_thirty = the_studio();
        at_thirty[0].refresh_hz = Some(30.0);
        assert!(!same_rates(&studio, &at_thirty));
        let mut unknown = the_studio();
        unknown[2].refresh_hz = None;
        assert!(!same_rates(&studio, &unknown));
        assert_eq!(hz(59.951), "59.95 Hz");
        assert_eq!(hz(60.0), "60 Hz");
        assert_eq!(hz(59.94), "59.94 Hz");
        assert_eq!(hz(29.97), "29.97 Hz");
        assert_eq!(hz(50.0), "50 Hz");
    }

    // On the workstation a screen is on whenever the tests run, so the list
    // is never empty: an empty one would mean that every screen was lost in
    // the reading. What it holds is the workstation's own. Elsewhere there is
    // nothing to read.
    #[test]
    fn the_screens_can_be_read() {
        let screens = read_display_paths().expect("the display configuration is read");
        if cfg!(windows) {
            assert!(!screens.is_empty(), "no screen was read");
        }
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
