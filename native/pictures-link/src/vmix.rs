//! vMix's pictures over NDI (D31 to D33): the rules of the helper's
//! receiving that need no library, kept apart from the calls so they are
//! compiled and tested on any system. Whether this helper may take vMix's
//! pictures at all, which source it takes, which frame it drops, when a
//! camera counts as receiving, and the minute's line.
//!
//! What the library hands over is `ndi_sdk.rs`'s; its calls are
//! `ndi_library.rs`'s; the threads that make them are `receive.rs`'s.

use crate::sha256::{pinned_sha256, sha256_hex};
use std::ffi::{c_int, OsString};
use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use studio_control_protocol::pictures::{
    vmix_pictures_requested, HelperProblem, PictureFormat, NDI_LIBRARY_ENV, VMIX_OUTPUTS,
    VMIX_PICTURES_ENV,
};

// ---------------------------------------------------------------------------
// Whether this helper takes vMix's pictures (D33)
// ---------------------------------------------------------------------------

/// NDI's library as the SDK names its file for 64-bit Windows.
pub const LIBRARY_FILE: &str = "Processing.NDI.Lib.x64.dll";

/// Whether this helper may take vMix's pictures, and from which library.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Permission {
    /// The switch is in its environment, and the library is named by its
    /// full path as the SDK's file.
    Allowed(PathBuf),
    /// It takes none, and why: for the state line and the log.
    Refused(HelperProblem, String),
}

/// The helper's own reading of its environment: the engine's word on the
/// want line is one fence, this is the second. A studio build takes none of
/// vMix's pictures until the studio build's step; a development build takes
/// them only with `SSE_VMIX_PICTURES=1`, which `npm run app --
/// --vmix-pictures` alone sets, and only from the SDK's library by its full
/// path, never vMix's own copy.
pub fn permission(
    studio_build: bool,
    mut get_env: impl FnMut(&str) -> Option<OsString>,
) -> Permission {
    if studio_build {
        return Permission::Refused(
            HelperProblem::NotAllowed,
            String::from("a studio build takes no pictures from vMix yet"),
        );
    }
    let switch = get_env(VMIX_PICTURES_ENV).and_then(|value| value.into_string().ok());
    if !switch.as_deref().is_some_and(vmix_pictures_requested) {
        return Permission::Refused(
            HelperProblem::NotAllowed,
            format!(
                "{VMIX_PICTURES_ENV} is not 1 in its environment, which only npm run app -- --vmix-pictures sets"
            ),
        );
    }
    let Some(library) = get_env(NDI_LIBRARY_ENV).map(PathBuf::from) else {
        return Permission::Refused(
            HelperProblem::NoLibrary,
            format!("{NDI_LIBRARY_ENV} names no file"),
        );
    };
    match library_refusal(&library) {
        Some(why) => Permission::Refused(
            HelperProblem::NoLibrary,
            format!("{}: {why}", library.display()),
        ),
        None => Permission::Allowed(library),
    }
}

/// The pin the helper holds NDI's library to, compiled in: the file
/// `npm run app` checks against as well.
const PIN: &str = include_str!("../ndi-library.json");

/// Whether the file at `library` is the pinned one: its SHA-256 is the
/// pin's. Read in whole just before it is loaded.
pub fn library_matches_pin(library: &Path) -> Result<(), String> {
    let pinned = pinned_sha256(PIN).ok_or("the pin holds no SHA-256")?;
    let bytes = std::fs::read(library).map_err(|error| format!("could not be read: {error}"))?;
    let digest = sha256_hex(&bytes);
    if digest != pinned {
        return Err(format!(
            "is not the pinned file: its SHA-256 is {digest}, the pin's {pinned}"
        ));
    }
    Ok(())
}

/// Why `library` is not a library the helper loads; `None` when it is.
fn library_refusal(library: &Path) -> Option<&'static str> {
    if !library.is_absolute() {
        return Some("not a full path");
    }
    let named = library
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(LIBRARY_FILE));
    if !named {
        return Some("not NDI's library");
    }
    let vmix_s = library.components().any(|part| {
        part.as_os_str()
            .to_str()
            .is_some_and(|part| part.eq_ignore_ascii_case("vMix"))
    });
    if vmix_s {
        return Some("vMix's own copy, which is not licensed to Studio Control");
    }
    if !library.is_file() {
        return Some("no such file");
    }
    None
}

// ---------------------------------------------------------------------------
// Which source is taken (D32)
// ---------------------------------------------------------------------------

/// A source as NDI's search lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Announced {
    pub name: String,
    pub url: String,
}

/// Which camera an announced source is, by its name: exactly `<this PC>
/// (vMix - Output N)` for N of `VMIX_OUTPUTS`, the PC's name compared
/// without regard to case, as Windows compares it.
pub fn camera_of(name: &str, machine: &str) -> Option<u8> {
    let (host, rest) = name.split_once(" (")?;
    if machine.is_empty() || !host.eq_ignore_ascii_case(machine) {
        return None;
    }
    VMIX_OUTPUTS
        .iter()
        .zip(1_u8..)
        .find(|(output, _)| rest == format!("vMix - Output {output})"))
        .map(|(_, camera)| camera)
}

/// The address an announced source is at: NDI gives its URL as
/// `address:port`.
pub fn address_of(url: &str) -> Option<IpAddr> {
    url.trim()
        .parse::<SocketAddr>()
        .ok()
        .map(|address| address.ip())
}

/// Whether `address` is one of this PC's own: a socket can be bound to it.
/// Nothing is sent, and the socket is closed at once.
pub fn is_this_pcs(address: IpAddr) -> bool {
    let broadcast = matches!(address, IpAddr::V4(v4) if v4.is_broadcast());
    !address.is_unspecified()
        && !address.is_multicast()
        && !broadcast
        && UdpSocket::bind(SocketAddr::new(address, 0)).is_ok()
}

/// The camera an announced source is taken for, or why it is passed over:
/// named for this PC's vMix Outputs 2 to 4, and at one of this PC's
/// addresses. A machine that announced this PC's name from elsewhere is
/// refused by its address (D32).
pub fn take_source(
    source: &Announced,
    machine: &str,
    is_local: impl Fn(IpAddr) -> bool,
) -> Result<u8, &'static str> {
    let camera =
        camera_of(&source.name, machine).ok_or("not named for this PC's vMix Output 2, 3 or 4")?;
    let address = address_of(&source.url).ok_or("no address in its URL")?;
    if !is_local(address) {
        return Err("its address is not this PC's");
    }
    Ok(camera)
}

// ---------------------------------------------------------------------------
// Which frame is dropped, and when a camera counts as receiving
// ---------------------------------------------------------------------------

/// A frame after this long without one is dropped: at each connect vMix
/// hands over the last frame it sent, which can be minutes old (read
/// 2026-09-30), and a connect always follows a silence.
pub const STALE_AFTER: Duration = Duration::from_secs(1);

/// Drops the first frame after each silence.
#[derive(Debug, Default)]
pub struct Silence {
    last: Option<Instant>,
}

impl Silence {
    /// A frame arrived at `now`: whether it is the first after a silence,
    /// which is dropped.
    pub fn broken(&mut self, now: Instant) -> bool {
        let stale = self
            .last
            .is_none_or(|last| now.saturating_duration_since(last) >= STALE_AFTER);
        self.last = Some(now);
        stale
    }
}

/// A connection is given this long for its first frame.
pub const CONNECT_GRACE: Duration = Duration::from_secs(3);
/// A camera receives while its last frame is this recent.
pub const FRESH_FOR: Duration = Duration::from_secs(1);

/// What the helper knows of one camera's source.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Seen {
    /// NDI's search lists its output now.
    pub announced: bool,
    /// Since when a receiver has been wanted for it: while Cameras shows the
    /// pictures (and for 30 s after) and its output is listed.
    pub asked_since: Option<Instant>,
    /// Since when a receiver is connected to it.
    pub connected_since: Option<Instant>,
    /// When its last frame was taken.
    pub last_taken: Option<Instant>,
}

/// Whether a camera's picture arrives. While no receiver is wanted (the
/// Cameras page shows no pictures, and vMix is asked for none) an output
/// that NDI's search lists counts as arriving, so the Cameras lamp stays
/// true on the other pages. A connected one arrives while its frames come,
/// and for the connection's first seconds while its output is listed. One
/// wanted and not connected arrives only for those first seconds: a
/// receiver that cannot connect does not read as a picture.
pub fn receiving(seen: &Seen, now: Instant) -> bool {
    let within_grace = |since: Instant| now.saturating_duration_since(since) < CONNECT_GRACE;
    match (seen.connected_since, seen.asked_since) {
        (Some(since), _) => {
            let fresh = seen
                .last_taken
                .is_some_and(|last| now.saturating_duration_since(last) < FRESH_FOR);
            fresh || (within_grace(since) && seen.announced)
        }
        (None, Some(asked)) => seen.announced && within_grace(asked),
        (None, None) => seen.announced,
    }
}

/// After vMix's pictures start, what arrives is not said for this long,
/// unless NDI's search has listed all three outputs by then: vMix's are not
/// listed at once, and the page reads the pictures as starting meanwhile
/// rather than missing.
pub const SEARCH_SETTLES: Duration = Duration::from_secs(2);

// ---------------------------------------------------------------------------
// The minute's line
// ---------------------------------------------------------------------------

/// What one camera's receiver did since the last line.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Received {
    /// Frames handed on to be drawn.
    pub taken: u64,
    /// Frames dropped as the first after a silence.
    pub stale: u64,
    /// Frames refused, and the last reason.
    pub refused: u64,
    pub last_refusal: Option<String>,
    /// The library said the connection was lost.
    pub errors: u64,
    /// Receivers made for it.
    pub connects: u64,
}

impl Received {
    pub fn any(&self) -> bool {
        self.taken + self.stale + self.refused + self.errors + self.connects > 0
    }
}

/// The library's own counts of a receiver, since it was made.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LibraryCounts {
    pub frames: i64,
    pub dropped: i64,
    pub queued: c_int,
    pub connections: c_int,
}

/// One camera in the minute's line.
pub struct CameraMinute<'a> {
    pub camera: u8,
    pub output: u8,
    pub received: &'a Received,
    pub library: Option<LibraryCounts>,
    pub format: Option<PictureFormat>,
    pub announced: bool,
}

/// The minute's line on stderr, which the engine logs.
pub fn minute_line(cameras: &[CameraMinute<'_>]) -> String {
    let parts: Vec<String> = cameras
        .iter()
        .map(|camera| {
            let format = camera
                .format
                .map_or_else(String::new, |format| format!(" {}", format.words()));
            let listed = if camera.announced {
                "listed"
            } else {
                "not listed"
            };
            let refusal = camera
                .received
                .last_refusal
                .as_ref()
                .map_or_else(String::new, |why| format!(" (the last: {why})"));
            let library = camera.library.map_or_else(
                || String::from("no receiver"),
                |library| {
                    format!(
                        "the library since connecting {} frames, {} dropped, {} queued, {} connected",
                        library.frames, library.dropped, library.queued, library.connections
                    )
                },
            );
            format!(
                "CAM {} (Output {}, {listed}){format}: {} taken, {} stale, {} refused{refusal}, {} lost, {} connects; {library}",
                camera.camera,
                camera.output,
                camera.received.taken,
                camera.received.stale,
                camera.received.refused,
                camera.received.errors,
                camera.received.connects,
            )
        })
        .collect();
    format!(
        "The pictures helper received from vMix in the last minute: {}.",
        parts.join("; ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> impl FnMut(&str) -> Option<OsString> {
        let pairs: Vec<(String, OsString)> = pairs
            .iter()
            .map(|(name, value)| (String::from(*name), OsString::from(value)))
            .collect();
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        }
    }

    /// A file named as NDI's library, in a scratch folder of this test's.
    fn scratch_library(folder: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("sse-pictures-permission-{}", std::process::id()))
            .join(folder);
        std::fs::create_dir_all(&dir).expect("a scratch folder");
        let file = dir.join(LIBRARY_FILE);
        std::fs::write(&file, b"not a library").expect("a scratch file");
        file
    }

    #[test]
    fn vmix_s_pictures_are_taken_only_with_the_switch_and_the_sdk_s_library() {
        let library = scratch_library("Bin");
        let path = library.to_str().expect("a path");
        assert_eq!(
            permission(
                false,
                env(&[("SSE_VMIX_PICTURES", "1"), ("SSE_NDI_LIBRARY", path)])
            ),
            Permission::Allowed(library.clone())
        );
        let refused = |studio: bool, pairs: &[(&str, &str)]| match permission(studio, env(pairs)) {
            Permission::Refused(problem, _) => Some(problem),
            Permission::Allowed(_) => None,
        };
        // The switch.
        for switch in [None, Some("0"), Some(""), Some("yes"), Some("true")] {
            let mut pairs = vec![("SSE_NDI_LIBRARY", path)];
            if let Some(switch) = switch {
                pairs.push(("SSE_VMIX_PICTURES", switch));
            }
            assert_eq!(
                refused(false, &pairs),
                Some(HelperProblem::NotAllowed),
                "{switch:?}"
            );
        }
        // A studio build, whatever its environment holds.
        assert_eq!(
            refused(
                true,
                &[("SSE_VMIX_PICTURES", "1"), ("SSE_NDI_LIBRARY", path)]
            ),
            Some(HelperProblem::NotAllowed)
        );
        // The library.
        let other = library.with_file_name("other.dll");
        std::fs::write(&other, b"x").expect("another file");
        let vmix_s = scratch_library("vMix");
        let missing = library.with_file_name("gone").join(LIBRARY_FILE);
        for (label, library) in [
            ("none", None),
            ("relative", Some(String::from(LIBRARY_FILE))),
            ("another file", Some(other.display().to_string())),
            ("vMix's copy", Some(vmix_s.display().to_string())),
            ("missing", Some(missing.display().to_string())),
        ] {
            let mut pairs = vec![("SSE_VMIX_PICTURES", "1")];
            if let Some(library) = &library {
                pairs.push(("SSE_NDI_LIBRARY", library));
            }
            assert_eq!(
                refused(false, &pairs),
                Some(HelperProblem::NoLibrary),
                "{label}"
            );
        }
        // A file of the library's name is still held to the pin before it
        // is loaded.
        let refusal = library_matches_pin(&library).expect_err("not the pinned file");
        assert!(refusal.contains("is not the pinned file"), "{refusal}");
        assert!(library_matches_pin(&missing).is_err());
        let _ = std::fs::remove_dir_all(
            std::env::temp_dir().join(format!("sse-pictures-permission-{}", std::process::id())),
        );
    }

    #[test]
    fn a_source_is_taken_by_its_name_for_this_pc_s_outputs_two_to_four() {
        let pc = "DESKTOP-FS0TR6D";
        assert_eq!(camera_of("DESKTOP-FS0TR6D (vMix - Output 2)", pc), Some(1));
        assert_eq!(camera_of("DESKTOP-FS0TR6D (vMix - Output 3)", pc), Some(2));
        assert_eq!(camera_of("desktop-fs0tr6d (vMix - Output 4)", pc), Some(3));
        for other in [
            "DESKTOP-FS0TR6D (vMix - Output 1)",
            "DESKTOP-FS0TR6D (vMix - Output 5)",
            "DESKTOP-FS0TR6D (vMix - Output 02)",
            "DESKTOP-FS0TR6D (vMix - Output 2) ",
            "DESKTOP-FS0TR6D (vmix - output 2)",
            "DESKTOP-FS0TR6D (DeckLink 8K Pro (1) 1)",
            "DESKTOP-FS0TR6D (Audio Analog 9 (1))",
            "OTHER-PC (vMix - Output 2)",
            "DESKTOP-FS0TR6D2 (vMix - Output 2)",
            "vMix - Output 2",
            "",
        ] {
            assert_eq!(camera_of(other, pc), None, "{other}");
        }
        assert_eq!(
            camera_of(" (vMix - Output 2)", ""),
            None,
            "no name of this PC's: nothing"
        );
    }

    #[test]
    fn a_source_is_taken_only_at_an_address_of_this_pc_s() {
        assert_eq!(
            address_of("172.16.16.118:5971"),
            Some(IpAddr::from([172, 16, 16, 118]))
        );
        assert_eq!(
            address_of("[::1]:5961"),
            Some(IpAddr::from([0, 0, 0, 0, 0, 0, 0, 1]))
        );
        for no in ["", "172.16.16.118", "ndi://x", "host:5961"] {
            assert_eq!(address_of(no), None, "{no}");
        }
        assert!(is_this_pcs(IpAddr::from([127, 0, 0, 1])));
        for elsewhere in [
            IpAddr::from([0, 0, 0, 0]),
            IpAddr::from([255, 255, 255, 255]),
            IpAddr::from([224, 0, 0, 251]),
            // TEST-NET-1, which no network uses.
            IpAddr::from([192, 0, 2, 1]),
        ] {
            assert!(!is_this_pcs(elsewhere), "{elsewhere}");
        }

        let source = |name: &str, url: &str| Announced {
            name: String::from(name),
            url: String::from(url),
        };
        let local = |address: IpAddr| address == IpAddr::from([172, 16, 16, 118]);
        let pc = "DESKTOP-FS0TR6D";
        assert_eq!(
            take_source(
                &source("DESKTOP-FS0TR6D (vMix - Output 3)", "172.16.16.118:5972"),
                pc,
                local
            ),
            Ok(2)
        );
        assert!(
            take_source(
                &source("DESKTOP-FS0TR6D (vMix - Output 3)", "172.16.16.50:5972"),
                pc,
                local
            )
            .is_err(),
            "this PC's name from another machine"
        );
        assert!(take_source(&source("DESKTOP-FS0TR6D (vMix - Output 3)", ""), pc, local).is_err());
        assert!(
            take_source(
                &source("DESKTOP-FS0TR6D (vMix - Output 1)", "172.16.16.118:5970"),
                pc,
                local
            )
            .is_err(),
            "Output 1 is vMix's own"
        );
    }

    #[test]
    fn the_first_frame_after_a_silence_is_dropped() {
        let start = Instant::now();
        let at = |millis: u64| start + Duration::from_millis(millis);
        let mut silence = Silence::default();
        assert!(silence.broken(at(0)), "the first after the connect");
        assert!(!silence.broken(at(33)));
        assert!(!silence.broken(at(67)));
        assert!(!silence.broken(at(900)), "late, not silent");
        assert!(silence.broken(at(1900)), "after a second without one");
        assert!(!silence.broken(at(1933)));
    }

    #[test]
    fn a_camera_receives_while_its_output_is_listed_or_its_frames_come() {
        let start = Instant::now();
        let at = |millis: u64| start + Duration::from_millis(millis);
        let seen = |announced, connected: Option<u64>, taken: Option<u64>| Seen {
            announced,
            asked_since: connected.map(at),
            connected_since: connected.map(at),
            last_taken: taken.map(at),
        };
        // Not wanted: listed is receiving, and vMix is asked for nothing.
        assert!(receiving(&seen(true, None, None), at(10_000)));
        assert!(!receiving(&seen(false, None, Some(9_900)), at(10_000)));
        // Wanted and not connected: the first seconds only.
        let waiting = |asked: u64| Seen {
            announced: true,
            asked_since: Some(at(asked)),
            connected_since: None,
            last_taken: None,
        };
        assert!(receiving(&waiting(0), at(2_900)));
        assert!(
            !receiving(&waiting(0), at(3_000)),
            "a receiver that cannot connect is no picture"
        );
        // Connected: the first seconds while listed, then its frames.
        assert!(receiving(&seen(true, Some(0), None), at(2_900)));
        assert!(!receiving(&seen(true, Some(0), None), at(3_000)));
        assert!(
            !receiving(&seen(false, Some(0), None), at(100)),
            "not listed"
        );
        assert!(receiving(&seen(true, Some(0), Some(9_100)), at(10_000)));
        assert!(
            receiving(&seen(false, Some(0), Some(9_100)), at(10_000)),
            "frames still come"
        );
        assert!(
            !receiving(&seen(true, Some(0), Some(9_000)), at(10_000)),
            "a second without one"
        );
    }

    #[test]
    fn the_minute_line_says_each_camera() {
        let received = Received {
            taken: 1_798,
            stale: 1,
            refused: 2,
            last_refusal: Some(String::from("a frame in UYVA")),
            errors: 0,
            connects: 1,
        };
        let line = minute_line(&[
            CameraMinute {
                camera: 1,
                output: 2,
                received: &received,
                library: Some(LibraryCounts {
                    frames: 1_801,
                    dropped: 0,
                    queued: 0,
                    connections: 1,
                }),
                format: Some(PictureFormat {
                    width: 3840,
                    height: 2160,
                    rate_numerator: 30000,
                    rate_denominator: 1001,
                }),
                announced: true,
            },
            CameraMinute {
                camera: 2,
                output: 3,
                received: &Received::default(),
                library: None,
                format: None,
                announced: false,
            },
        ]);
        assert_eq!(
            line,
            "The pictures helper received from vMix in the last minute: CAM 1 (Output 2, listed) 3840 × 2160 · 29.97: 1798 taken, 1 stale, 2 refused (the last: a frame in UYVA), 0 lost, 1 connects; the library since connecting 1801 frames, 0 dropped, 0 queued, 1 connected; CAM 2 (Output 3, not listed): 0 taken, 0 stale, 0 refused, 0 lost, 0 connects; no receiver."
        );
        assert!(received.any());
        assert!(!Received::default().any());
    }
}
