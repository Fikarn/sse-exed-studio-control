//! vMix's Outputs 2 to 4 received over NDI (D31 to D33): only in a
//! development run started with `npm run app -- --vmix-pictures`, a hardware
//! test the owner asks for and attends.
//!
//! - NDI's library is the SDK's own file, held to its pin and loaded once by
//!   its full path (`ndi_library.rs`).
//! - NDI's own search runs on a thread of its own for as long as the helper
//!   is on vMix's pictures (D32). It lists sources and connects to none. A
//!   source is taken only when it is named for this PC's Output 2, 3 or 4 and
//!   stands at one of this PC's addresses (`vmix::take_source`); any other it
//!   lists is named once in the log and passed over.
//! - While the Cameras page shows the pictures, and for the engine's 30 s
//!   after, each camera whose output is listed has a receiver on a thread of
//!   its own, which makes every library call for it. vMix encodes an output
//!   only while something is connected, so the pictures cost vMix nothing on
//!   the other pages. A receiver that could not connect is made again after a
//!   pause; one asked for and not connected within a few seconds does not
//!   count as receiving.
//! - A receiver takes each frame, drops the first after a silence (vMix hands
//!   over a stale one at each connect), refuses what the renderer cannot take,
//!   and copies the rest into its camera's newest frame, which the draw loop
//!   takes (`layer.rs`): the newest wins, and the buffers go round.
//! - Every thread beats (`watch.rs`): one stuck in the library makes the
//!   helper go silent, and the hardware link starts it again. When the helper
//!   ends, its receivers and its search end first (`finish`), so no thread is
//!   inside the library when the process goes.

use crate::ndi_library::{Finder, Ndi, Receiver};
use crate::ndi_sdk::Captured;
use crate::vmix::{
    self, Announced, CameraMinute, LibraryCounts, Received, Seen, Silence, SEARCH_SETTLES,
};
use crate::watch::Beats;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::pictures::{
    vmix_output, HelperProblem, PictureFormat, ReceivedCamera, WantedCamera, VMIX_OUTPUTS,
};

/// How long NDI's search waits for a change before it lists again.
const SEARCH_WAIT: Duration = Duration::from_millis(500);
/// How long a capture waits for a frame: short, so a receiver told to stop
/// ends well within the helper's time at its end (`FINISH_WITHIN`).
const CAPTURE_WAIT: Duration = Duration::from_millis(250);
/// How often a receiver reads the library's counts.
const COUNT_EVERY: Duration = Duration::from_secs(1);
/// After a lost connection a receiver waits this long before it captures
/// again; the library connects again by itself.
const LOST_WAIT: Duration = Duration::from_millis(200);
/// A receiver that could not connect is made again after this long.
const RETRY_WAIT: Duration = Duration::from_secs(2);
/// The most names of other sources said in the log, once each.
const MOST_PASSED_OVER: usize = 64;

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A camera's newest frame, handed from its receiver to the draw loop.
#[derive(Default)]
pub struct Newest {
    /// UYVY, `stride` bytes a row, the last row to its own end.
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    /// Counts the frames handed over: the draw loop takes one whose count
    /// it has not drawn.
    pub sequence: u64,
    pub arrived: Option<Instant>,
}

/// The three cameras' newest frames.
pub type Frames = [Mutex<Newest>; 3];

/// What the threads know of one camera.
#[derive(Default)]
struct Camera {
    /// What NDI's search lists for it, while it does.
    announced: Option<Announced>,
    /// The receiver connected to it now: which, and since when.
    receiver: Option<(u64, Instant)>,
    last_taken: Option<Instant>,
    format: Option<PictureFormat>,
    /// Since the last minute's line.
    received: Received,
    library: Option<LibraryCounts>,
    /// A receiver could not connect, and it was said: it is not said again
    /// until one connects.
    connect_failed: bool,
}

struct Shared {
    cameras: [Mutex<Camera>; 3],
    /// Why the search did not start, if it did not.
    search_failed: Mutex<Option<String>>,
    frames: Arc<Frames>,
    /// The search ends when this is set, and says so in `search_ended`.
    stop_search: AtomicBool,
    search_ended: AtomicBool,
}

impl Shared {
    fn camera(&self, index: usize) -> MutexGuard<'_, Camera> {
        lock(&self.cameras[index])
    }
}

/// A camera's receiver: its thread ends by itself within a capture's wait
/// once told to, and says so.
struct Receiving {
    source: Announced,
    stop: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
}

/// Whether a receiver made for `had` still serves `now`: the same name at the
/// same port. The address alone may change, for NDI can list this PC's
/// source at either of its networks' addresses, and the library follows it.
fn same_source(had: &Announced, now: &Announced) -> bool {
    let port = |source: &Announced| {
        source
            .url
            .rsplit_once(':')
            .map(|(_, port)| port.to_string())
    };
    had.name == now.name && port(had) == port(now)
}

/// vMix's pictures: the library, its search, and a receiver for each camera
/// while the pictures show.
pub struct Vmix {
    ndi: Arc<Ndi>,
    shared: Arc<Shared>,
    beats: Arc<Beats>,
    receivers: [Option<Receiving>; 3],
    /// Receivers told to stop whose threads may not have ended yet.
    ending: Vec<Arc<AtomicBool>>,
    /// Since when each camera has been wanted connected: shown and listed.
    asked: [Option<Instant>; 3],
    /// When a receiver that could not connect may be made again.
    retry_at: [Option<Instant>; 3],
    started: Instant,
    /// Counts the receivers made, so each is told apart.
    made: u64,
}

impl Vmix {
    /// Holds NDI's library to its pin, loads it and starts its search; says
    /// on stderr which file and version it loaded.
    pub fn start(library: &Path, beats: Arc<Beats>) -> Result<Self, String> {
        // The search's first seconds are counted from here, so that they
        // overlap the check and the load: the engine hears the helper within
        // its five seconds either way.
        let started = Instant::now();
        let refused = |why: String| format!("NDI's library {} {why}", library.display());
        // The helper's own check of the pin, just before the load: the file
        // is the one `npm run app` checked, whoever started this helper.
        vmix::library_matches_pin(library).map_err(refused)?;
        let checked = started.elapsed();
        let ndi = Arc::new(Ndi::load(library).map_err(refused)?);
        eprintln!(
            "The pictures helper loaded NDI's library {}, version {}, its hash the pinned one (checked in {} ms, loaded in {} ms).",
            library.display(),
            ndi.version(),
            checked.as_millis(),
            started.elapsed().saturating_sub(checked).as_millis()
        );
        let shared = Arc::new(Shared {
            cameras: Default::default(),
            search_failed: Mutex::new(None),
            frames: Arc::new(Default::default()),
            stop_search: AtomicBool::new(false),
            search_ended: AtomicBool::new(false),
        });
        let machine = std::env::var("COMPUTERNAME").unwrap_or_default();
        {
            let (ndi, shared, beats) = (Arc::clone(&ndi), Arc::clone(&shared), Arc::clone(&beats));
            thread::Builder::new()
                .name(String::from("ndi-search"))
                .spawn(move || {
                    search(&ndi, &shared, &beats, &machine);
                    shared.search_ended.store(true, Ordering::Release);
                })
                .map_err(|error| format!("NDI's search did not start: {error}"))?;
        }
        Ok(Self {
            ndi,
            shared,
            beats,
            receivers: [None, None, None],
            ending: Vec::new(),
            asked: [None; 3],
            retry_at: [None; 3],
            started,
            made: 0,
        })
    }

    /// The cameras' newest frames, for the draw loop.
    pub fn frames(&self) -> Arc<Frames> {
        Arc::clone(&self.shared.frames)
    }

    /// A receiver for each listed output while the pictures show, and none
    /// otherwise. One whose output is listed at another port is made again,
    /// and one that could not connect is made again after a pause.
    pub fn keep(&mut self, showing: bool) {
        let now = Instant::now();
        self.ending.retain(|ended| !ended.load(Ordering::Acquire));
        for index in 0..3 {
            let listed = self.shared.camera(index).announced.clone();
            if self.receivers[index]
                .as_ref()
                .is_some_and(|receiving| receiving.ended.load(Ordering::Acquire))
            {
                // Its thread ended by itself: it could not connect.
                self.receivers[index] = None;
                self.retry_at[index] = Some(now + RETRY_WAIT);
            }
            let keep = match (&self.receivers[index], &listed) {
                (Some(receiving), Some(source)) => {
                    showing && same_source(&receiving.source, source)
                }
                // The output went: the library connects again if it returns
                // at the same port.
                (Some(_), None) => showing,
                (None, _) => true,
            };
            if !keep {
                if let Some(receiving) = self.receivers[index].take() {
                    receiving.stop.store(true, Ordering::Release);
                    self.ending.push(receiving.ended);
                }
            }
            self.asked[index] = if showing && listed.is_some() {
                self.asked[index].or(Some(now))
            } else {
                None
            };
            let waited = self.retry_at[index].is_none_or(|at| now >= at);
            if let (true, None, Some(source), true) =
                (showing, &self.receivers[index], listed, waited)
            {
                self.retry_at[index] = None;
                self.receivers[index] = self.connect(index, source);
            }
        }
    }

    fn connect(&mut self, index: usize, source: Announced) -> Option<Receiving> {
        self.made += 1;
        let stop = Arc::new(AtomicBool::new(false));
        let ended = Arc::new(AtomicBool::new(false));
        let thread = {
            let (ndi, shared, beats) = (
                Arc::clone(&self.ndi),
                Arc::clone(&self.shared),
                Arc::clone(&self.beats),
            );
            let (source, stop, ended, made) = (
                source.clone(),
                Arc::clone(&stop),
                Arc::clone(&ended),
                self.made,
            );
            thread::Builder::new()
                .name(format!("ndi-cam{}", index + 1))
                .spawn(move || {
                    receive(&ndi, &shared, &beats, index, &source, &stop, made);
                    ended.store(true, Ordering::Release);
                })
        };
        match thread {
            Ok(_) => Some(Receiving {
                source,
                stop,
                ended,
            }),
            Err(error) => {
                eprintln!(
                    "The pictures helper could not start CAM {}'s receiver: {error}.",
                    index + 1
                );
                self.retry_at[index] = Some(Instant::now() + RETRY_WAIT);
                None
            }
        }
    }

    /// Whether what it receives can be said yet: NDI's search lists vMix's
    /// outputs within a second or two of its start.
    pub fn settled(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.started) >= SEARCH_SETTLES
            || (0..3).all(|index| self.shared.camera(index).announced.is_some())
    }

    /// Why it takes nothing at all, if it does not.
    pub fn problem(&self) -> Option<HelperProblem> {
        lock(&self.shared.search_failed)
            .is_some()
            .then_some(HelperProblem::NoLibrary)
    }

    /// Whether vMix sends any of the three outputs, and what arrives of each
    /// camera wanted, with each camera's vMix input said back as the engine
    /// gave it.
    pub fn report(&self, want: &[WantedCamera], now: Instant) -> (bool, Vec<ReceivedCamera>) {
        let seen: Vec<(Seen, Option<PictureFormat>)> = (0..3)
            .map(|index| {
                let camera = self.shared.camera(index);
                (
                    Seen {
                        announced: camera.announced.is_some(),
                        asked_since: self.asked[index],
                        connected_since: camera.receiver.map(|(_, since)| since),
                        last_taken: camera.last_taken,
                    },
                    camera.format,
                )
            })
            .collect();
        let sending = seen.iter().any(|(seen, _)| seen.announced);
        let cameras = want
            .iter()
            .map(|wanted| {
                let index = usize::from(wanted.camera).wrapping_sub(1);
                let (receiving, format) =
                    seen.get(index).map_or((false, None), |(seen, format)| {
                        let receiving = vmix::receiving(seen, now);
                        // What it arrives as is known only while it is received.
                        let known = receiving && seen.connected_since.is_some();
                        (receiving, if known { *format } else { None })
                    });
                ReceivedCamera {
                    camera: wanted.camera,
                    vmix_input: wanted.vmix_input,
                    receiving,
                    format,
                }
            })
            .collect();
        (sending, cameras)
    }

    /// The minute's line, when anything was received or connected; the
    /// counts start again.
    pub fn minute(&self) -> Option<String> {
        let taken: Vec<(Received, Option<LibraryCounts>, Option<PictureFormat>, bool)> = (0..3)
            .map(|index| {
                let mut camera = self.shared.camera(index);
                (
                    std::mem::take(&mut camera.received),
                    camera.library,
                    camera.format,
                    camera.announced.is_some(),
                )
            })
            .collect();
        if !taken
            .iter()
            .any(|(received, library, ..)| received.any() || library.is_some())
        {
            return None;
        }
        let cameras: Vec<CameraMinute<'_>> = taken
            .iter()
            .zip(1_u8..)
            .map(
                |((received, library, format, announced), camera)| CameraMinute {
                    camera,
                    output: vmix_output(camera).unwrap_or_default(),
                    received,
                    library: *library,
                    format: *format,
                    announced: *announced,
                },
            )
            .collect();
        Some(vmix::minute_line(&cameras))
    }

    /// Ends the receivers and the search, and waits up to `within` for their
    /// threads, so that none is inside the library when the helper ends.
    pub fn finish(&mut self, within: Duration) {
        self.keep(false);
        self.shared.stop_search.store(true, Ordering::Release);
        let deadline = Instant::now() + within;
        let ended = || {
            self.shared.search_ended.load(Ordering::Acquire)
                && self
                    .ending
                    .iter()
                    .all(|ended| ended.load(Ordering::Acquire))
        };
        while !ended() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if !ended() {
            eprintln!(
                "The pictures helper ends with NDI's threads still ending after {} ms.",
                within.as_millis()
            );
        }
    }
}

/// NDI's search, until the helper ends: lists what it hears of twice a second
/// and takes this PC's Outputs 2 to 4.
fn search(ndi: &Arc<Ndi>, shared: &Shared, beats: &Beats, machine: &str) {
    const WHO: &str = "NDI's search";
    beats.beat(WHO);
    let mut finder = match Finder::open(ndi) {
        Ok(finder) => finder,
        Err(why) => {
            eprintln!("The pictures helper cannot look for vMix's outputs: NDI's library {why}.");
            *lock(&shared.search_failed) = Some(why);
            beats.rest(WHO);
            return;
        }
    };
    if machine.is_empty() {
        eprintln!(
            "The pictures helper does not know this PC's name (COMPUTERNAME), so it takes none of vMix's outputs."
        );
    }
    let mut passed_over: Vec<String> = Vec::new();
    while !shared.stop_search.load(Ordering::Acquire) {
        let listed = finder.look(SEARCH_WAIT);
        beats.beat(WHO);
        let mut found: [Option<Announced>; 3] = [None, None, None];
        for source in listed {
            match vmix::take_source(&source, machine, vmix::is_this_pcs) {
                Ok(camera) => found[usize::from(camera) - 1] = Some(source),
                Err(why) => {
                    if passed_over.len() < MOST_PASSED_OVER && !passed_over.contains(&source.name) {
                        eprintln!(
                            "The pictures helper passes over NDI's source {} [{}]: {why}.",
                            source.name, source.url
                        );
                        passed_over.push(source.name);
                    }
                }
            }
        }
        for (index, found) in found.into_iter().enumerate() {
            let mut camera = shared.camera(index);
            if camera.announced == found {
                continue;
            }
            let output = VMIX_OUTPUTS[index];
            match &found {
                Some(source) => eprintln!(
                    "NDI lists vMix's Output {output}, CAM {}'s, at {}.",
                    index + 1,
                    source.url
                ),
                None => eprintln!(
                    "NDI no longer lists vMix's Output {output}, CAM {}'s.",
                    index + 1
                ),
            }
            camera.announced = found;
        }
    }
    beats.rest(WHO);
}

/// One camera's receiver, until it is told to stop: every library call for
/// it is made here.
fn receive(
    ndi: &Arc<Ndi>,
    shared: &Shared,
    beats: &Beats,
    index: usize,
    source: &Announced,
    stop: &AtomicBool,
    made: u64,
) {
    let who = format!("CAM {}'s receiver ({made})", index + 1);
    beats.beat(&who);
    match Receiver::open(ndi, source, &format!("Studio Control CAM {}", index + 1)) {
        Ok(receiver) => {
            // Told to stop while it connected, or overtaken by a newer
            // receiver: it ends at once and says nothing of the camera.
            let newest = {
                let mut camera = shared.camera(index);
                let newest = !stop.load(Ordering::Acquire)
                    && camera.receiver.is_none_or(|(which, _)| which < made);
                if newest {
                    camera.receiver = Some((made, Instant::now()));
                    camera.last_taken = None;
                    camera.format = None;
                    camera.received.connects += 1;
                    camera.connect_failed = false;
                }
                newest
            };
            if newest {
                take_frames(receiver, shared, beats, index, stop, &who);
            }
        }
        Err(why) => {
            // Said once, until a receiver connects.
            let mut camera = shared.camera(index);
            if !camera.connect_failed {
                eprintln!(
                    "The pictures helper could not connect to {}: {why}; it tries again every {} s.",
                    source.name,
                    RETRY_WAIT.as_secs()
                );
                camera.connect_failed = true;
            }
        }
    }
    {
        // Only its own: a newer receiver may have connected meanwhile.
        let mut camera = shared.camera(index);
        if camera.receiver.is_some_and(|(which, _)| which == made) {
            camera.receiver = None;
            camera.library = None;
        }
    }
    beats.rest(&who);
}

/// Takes a camera's frames until told to stop. The receiver, and with it
/// the connection, ends when this returns.
fn take_frames(
    mut receiver: Receiver,
    shared: &Shared,
    beats: &Beats,
    index: usize,
    stop: &AtomicBool,
    who: &str,
) {
    let mut silence = Silence::default();
    let mut spare: Vec<u8> = Vec::new();
    let mut counted = Instant::now();
    while !stop.load(Ordering::Acquire) {
        let captured = receiver.capture(CAPTURE_WAIT, &mut |frame| {
            // A receiver told to stop hands on nothing more: a newer one may
            // be connected to the camera by now.
            if stop.load(Ordering::Acquire) {
                return;
            }
            let now = Instant::now();
            let stale = silence.broken(now);
            let (checked, picture) = {
                let mut camera = shared.camera(index);
                match frame {
                    Err(why) => {
                        camera.received.refused += 1;
                        camera.received.last_refusal = Some(why);
                        return;
                    }
                    Ok(_) if stale => {
                        camera.received.stale += 1;
                        return;
                    }
                    Ok((checked, picture)) => {
                        camera.received.taken += 1;
                        camera.last_taken = Some(now);
                        camera.format = Some(checked.format);
                        (checked, picture)
                    }
                }
            };
            spare.clear();
            spare.extend_from_slice(picture);
            let mut newest = lock(&shared.frames[index]);
            std::mem::swap(&mut newest.bytes, &mut spare);
            newest.width = checked.width;
            newest.height = checked.height;
            newest.stride = checked.stride;
            newest.sequence = newest.sequence.wrapping_add(1);
            newest.arrived = Some(now);
        });
        if captured == Captured::Lost {
            shared.camera(index).received.errors += 1;
            thread::sleep(LOST_WAIT);
        }
        beats.beat(who);
        if counted.elapsed() >= COUNT_EVERY && !stop.load(Ordering::Acquire) {
            let counts = receiver.counters();
            shared.camera(index).library = Some(counts);
            counted = Instant::now();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_receiver_serves_its_source_while_its_name_and_port_stay() {
        let source = |name: &str, url: &str| Announced {
            name: String::from(name),
            url: String::from(url),
        };
        let had = source("PC (vMix - Output 2)", "172.16.16.118:5971");
        assert!(same_source(&had, &had.clone()));
        assert!(
            same_source(&had, &source("PC (vMix - Output 2)", "10.0.0.5:5971")),
            "the other network's address, the same port"
        );
        assert!(
            !same_source(&had, &source("PC (vMix - Output 2)", "172.16.16.118:5974")),
            "vMix started again on another port"
        );
        assert!(!same_source(
            &had,
            &source("PC (vMix - Output 3)", "172.16.16.118:5971")
        ));
    }
}
