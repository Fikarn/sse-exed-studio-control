//! vMix's pictures over NDI (D31 to D33): the rules of the helper's
//! receiving that need no library, kept apart from the calls so they are
//! compiled and tested on any system. Whether this helper may take vMix's
//! pictures at all, which source it takes, which frame it drops, when a
//! camera counts as receiving, and the minute's line.
//!
//! What the library hands over is `ndi_sdk.rs`'s; its calls are
//! `ndi_library.rs`'s; the threads that make them are `receive.rs`'s.

use crate::ndi_sdk::{Sent, TIME_UNDEFINED};
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
    /// It may, from the library at this full path: in a studio build the
    /// copy in its own folder, in a development run the SDK's file named by
    /// the run.
    Allowed(PathBuf),
    /// It takes none, and why: for the state line and the log.
    Refused(HelperProblem, String),
}

/// The helper's own reading of what it may take: the engine's word on the
/// want line is one fence, this is the second. A studio build takes vMix's
/// pictures (D34) from the library beside it in `own_folder`, the build's
/// copy, and reads nothing of its environment for it. A development build
/// takes them only with `SSE_VMIX_PICTURES=1`, which `npm run app --
/// --vmix-pictures` alone sets, and only from the SDK's library by its full
/// path, never vMix's own copy. Either way the file is held to the pin
/// before it is loaded (`library_matches_pin`).
pub fn permission(
    studio_build: bool,
    own_folder: Option<&Path>,
    mut get_env: impl FnMut(&str) -> Option<OsString>,
) -> Permission {
    if studio_build {
        let Some(folder) = own_folder else {
            return Permission::Refused(
                HelperProblem::NoLibrary,
                String::from("this helper does not know its own folder"),
            );
        };
        let library = folder.join(LIBRARY_FILE);
        return match library_refusal(&library) {
            Some(why) => Permission::Refused(
                HelperProblem::NoLibrary,
                format!("{}: {why}", library.display()),
            ),
            None => Permission::Allowed(library),
        };
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
    /// How far apart its frames landed here, and how far apart vMix sent
    /// them by its own timestamps (`Spacing`).
    pub landed: Spread,
    pub sent: Spread,
    /// Steps of vMix's timecode that were not one frame.
    pub timecode_steps: u64,
}

impl Received {
    pub fn any(&self) -> bool {
        self.taken + self.stale + self.refused + self.errors + self.connects > 0
    }
}

/// Durations counted in five bins, with the longest: how far apart a
/// camera's frames came, or how long one waited to be drawn.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Spread {
    pub counts: [u64; 5],
    pub longest: Duration,
}

/// The bins of the space between two frames, around vMix's 33.4 ms: two
/// together, one early, on time (within about 8 ms), one late, and a frame
/// or more missing.
pub const GAP_EDGES: [Duration; 4] = [
    Duration::from_millis(8),
    Duration::from_millis(25),
    Duration::from_millis(42),
    Duration::from_millis(58),
];

impl Spread {
    /// `value` in its bin: below the first edge, between two, or past the
    /// last.
    pub fn note(&mut self, value: Duration, edges: &[Duration; 4]) {
        let bin = edges.iter().position(|edge| value < *edge).unwrap_or(4);
        self.counts[bin] += 1;
        self.longest = self.longest.max(value);
    }

    pub fn any(&self) -> bool {
        self.counts.iter().any(|count| *count > 0)
    }

    /// "(under 8, 8–25, 25–42, 42–58, 58 ms or more) 0 / 2 / 1794 / 1 / 0,
    /// the longest 44.0 ms".
    pub fn words(&self, edges: &[Duration; 4]) -> String {
        let ms = |edge: &Duration| edge.as_millis();
        let counts: Vec<String> = self.counts.iter().map(u64::to_string).collect();
        format!(
            "(under {}, {}–{}, {}–{}, {}–{}, {} ms or more) {}, the longest {:.1} ms",
            ms(&edges[0]),
            ms(&edges[0]),
            ms(&edges[1]),
            ms(&edges[1]),
            ms(&edges[2]),
            ms(&edges[2]),
            ms(&edges[3]),
            ms(&edges[3]),
            counts.join(" / "),
            self.longest.as_secs_f64() * 1000.0
        )
    }
}

/// How far a step of vMix's timecode may be from one frame and still count
/// as one: 1 ms, in the timecode's 100 ns.
const TIMECODE_LEEWAY: u64 = 10_000;

/// What a receiver keeps of the last frame it took, to measure the space to
/// the next: when it landed, and vMix's own times of it.
#[derive(Debug, Default)]
pub struct Spacing {
    last: Option<(Instant, Sent)>,
}

impl Spacing {
    /// A frame taken at `now`, as vMix sent it at `format`'s rate: the
    /// spaces from the one before are counted in `received`.
    pub fn note(
        &mut self,
        now: Instant,
        sent: Sent,
        format: &PictureFormat,
        received: &mut Received,
    ) {
        if let Some((landed, before)) = self.last {
            received
                .landed
                .note(now.saturating_duration_since(landed), &GAP_EDGES);
            let given = |time: i64| time != TIME_UNDEFINED;
            if given(before.timestamp) && given(sent.timestamp) {
                // A step back is not a space: it is left out.
                if let Ok(step) = u64::try_from(sent.timestamp.saturating_sub(before.timestamp)) {
                    received
                        .sent
                        .note(Duration::from_nanos(step.saturating_mul(100)), &GAP_EDGES);
                }
            }
            if let Some(period) = frame_in_100ns(format) {
                if given(before.timecode) && given(sent.timecode) {
                    let step = sent.timecode.saturating_sub(before.timecode);
                    if step.abs_diff(period) > TIMECODE_LEEWAY {
                        received.timecode_steps += 1;
                    }
                }
            }
        }
        self.last = Some((now, sent));
    }

    /// After a silence the next frame measures nothing.
    pub fn forget(&mut self) {
        self.last = None;
    }
}

/// One frame at `format`'s rate, in 100 ns; none for an unknown rate.
fn frame_in_100ns(format: &PictureFormat) -> Option<i64> {
    let numerator = u64::from(format.rate_numerator);
    if numerator == 0 || format.rate_denominator == 0 {
        return None;
    }
    let period = (10_000_000 * u64::from(format.rate_denominator) + numerator / 2) / numerator;
    i64::try_from(period).ok()
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
            let received = camera.received;
            let spacing = if received.landed.any() {
                let sent = if received.sent.any() {
                    received.sent.words(&GAP_EDGES)
                } else {
                    String::from("not said")
                };
                format!(
                    "; frames apart as they landed {}; as vMix sent them {sent}; {} timecode steps not one frame",
                    received.landed.words(&GAP_EDGES),
                    received.timecode_steps
                )
            } else {
                String::new()
            };
            format!(
                "CAM {} (Output {}, {listed}){format}: {} taken, {} stale, {} refused{refusal}, {} lost, {} connects{spacing}; {library}",
                camera.camera,
                camera.output,
                received.taken,
                received.stale,
                received.refused,
                received.errors,
                received.connects,
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
                None,
                env(&[("SSE_VMIX_PICTURES", "1"), ("SSE_NDI_LIBRARY", path)])
            ),
            Permission::Allowed(library.clone())
        );
        let refused =
            |studio: bool, pairs: &[(&str, &str)]| match permission(studio, None, env(pairs)) {
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
        // A studio build takes the library beside it, and nothing its
        // environment names; without a folder of its own, none.
        let own = scratch_library("build");
        let folder = own.parent().expect("its folder");
        assert_eq!(
            permission(
                true,
                Some(folder),
                env(&[("SSE_VMIX_PICTURES", "0"), ("SSE_NDI_LIBRARY", path)])
            ),
            Permission::Allowed(own.clone())
        );
        assert_eq!(
            refused(
                true,
                &[("SSE_VMIX_PICTURES", "1"), ("SSE_NDI_LIBRARY", path)]
            ),
            Some(HelperProblem::NoLibrary),
            "no folder of its own"
        );
        let empty = folder.with_file_name("empty");
        std::fs::create_dir_all(&empty).expect("an empty folder");
        assert!(
            matches!(
                permission(true, Some(&empty), env(&[("SSE_NDI_LIBRARY", path)])),
                Permission::Refused(HelperProblem::NoLibrary, _)
            ),
            "no library beside it, whatever the environment names"
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

    const UHD: PictureFormat = PictureFormat {
        width: 3840,
        height: 2160,
        rate_numerator: 30000,
        rate_denominator: 1001,
    };

    /// vMix's times of a frame, in 100 ns.
    fn sent(timecode: i64, timestamp: i64) -> Sent {
        Sent {
            timecode,
            timestamp,
        }
    }

    #[test]
    fn a_spread_counts_each_value_in_its_bin() {
        let mut spread = Spread::default();
        assert!(!spread.any());
        for ms in [0, 7, 8, 24, 33, 34, 41, 42, 57, 58, 70] {
            spread.note(Duration::from_millis(ms), &GAP_EDGES);
        }
        assert_eq!(spread.counts, [2, 2, 3, 2, 2], "an edge is the bin above's");
        assert_eq!(spread.longest, Duration::from_millis(70));
        assert_eq!(
            spread.words(&GAP_EDGES),
            "(under 8, 8–25, 25–42, 42–58, 58 ms or more) 2 / 2 / 3 / 2 / 2, the longest 70.0 ms"
        );
    }

    // The spaces between a camera's frames as they land here and as vMix
    // stamped them, and its timecode's steps: what tells a sender that sends
    // in bursts from a receiver that takes them so.
    #[test]
    fn the_spaces_between_frames_are_measured_as_they_landed_and_as_vmix_sent_them() {
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let period = 333_667;
        let mut spacing = Spacing::default();
        let mut received = Received::default();
        // The first frame measures nothing.
        spacing.note(at(0), sent(0, 1_000_000), &UHD, &mut received);
        assert_eq!(received, Received::default());
        // Even: on time both ways.
        spacing.note(at(33), sent(period, 1_333_667), &UHD, &mut received);
        // Two together here, sent a frame apart.
        spacing.note(at(70), sent(2 * period, 1_667_334), &UHD, &mut received);
        spacing.note(at(72), sent(3 * period, 2_001_001), &UHD, &mut received);
        // A frame vMix never sent: its timecode skips one.
        spacing.note(at(139), sent(5 * period, 2_668_335), &UHD, &mut received);
        assert_eq!(received.landed.counts, [1, 0, 2, 0, 1]);
        assert_eq!(received.sent.counts, [0, 0, 3, 0, 1]);
        assert_eq!(received.timecode_steps, 1);
        assert_eq!(received.landed.longest, Duration::from_millis(67));

        // A step back of the timestamp is left out, and an undefined time
        // measures nothing; the timecode's step back is not one frame.
        let mut received = Received::default();
        spacing.note(at(172), sent(4 * period, 2_000_000), &UHD, &mut received);
        spacing.note(
            at(205),
            sent(TIME_UNDEFINED, TIME_UNDEFINED),
            &UHD,
            &mut received,
        );
        spacing.note(at(238), sent(6 * period, 2_667_334), &UHD, &mut received);
        assert_eq!(received.landed.counts, [0, 0, 3, 0, 0]);
        assert!(!received.sent.any());
        assert_eq!(received.timecode_steps, 1, "the step back");

        // After a silence the next frame starts afresh.
        let mut received = Received::default();
        spacing.forget();
        spacing.note(at(5_000), sent(9 * period, 9_000_000), &UHD, &mut received);
        assert_eq!(received, Received::default());

        // Without a rate the timecode is not judged.
        let mut received = Received::default();
        let unknown = PictureFormat {
            rate_numerator: 0,
            rate_denominator: 0,
            ..UHD
        };
        spacing.note(at(5_033), sent(1, 9_333_667), &unknown, &mut received);
        assert_eq!(received.timecode_steps, 0);
        assert_eq!(received.landed.counts, [0, 0, 1, 0, 0]);
    }

    #[test]
    fn a_frame_is_one_period_of_its_rate() {
        assert_eq!(frame_in_100ns(&UHD), Some(333_667));
        let twenty_five = PictureFormat {
            rate_numerator: 25,
            rate_denominator: 1,
            ..UHD
        };
        assert_eq!(frame_in_100ns(&twenty_five), Some(400_000));
        for (numerator, denominator) in [(0, 1001), (30000, 0), (0, 0)] {
            let unknown = PictureFormat {
                rate_numerator: numerator,
                rate_denominator: denominator,
                ..UHD
            };
            assert_eq!(frame_in_100ns(&unknown), None, "{numerator}/{denominator}");
        }
    }

    #[test]
    fn the_minute_line_says_each_camera() {
        let mut received = Received {
            taken: 1_798,
            stale: 1,
            refused: 2,
            last_refusal: Some(String::from("a frame in UYVA")),
            errors: 0,
            connects: 1,
            ..Received::default()
        };
        received.landed.note(Duration::from_millis(33), &GAP_EDGES);
        received.landed.note(Duration::from_millis(2), &GAP_EDGES);
        received.timecode_steps = 1;
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
            "The pictures helper received from vMix in the last minute: CAM 1 (Output 2, listed) 3840 × 2160 · 29.97: 1798 taken, 1 stale, 2 refused (the last: a frame in UYVA), 0 lost, 1 connects; frames apart as they landed (under 8, 8–25, 25–42, 42–58, 58 ms or more) 1 / 0 / 1 / 0 / 0, the longest 33.0 ms; as vMix sent them not said; 1 timecode steps not one frame; the library since connecting 1801 frames, 0 dropped, 0 queued, 1 connected; CAM 2 (Output 3, not listed): 0 taken, 0 stale, 0 refused, 0 lost, 0 connects; no receiver."
        );
        assert!(received.any());
        assert!(!Received::default().any());
    }
}
