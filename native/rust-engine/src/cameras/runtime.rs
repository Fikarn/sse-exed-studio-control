//! The cameras while Studio Control runs: who holds each, what each last
//! reported and when, and the selection — loaded by the first request, with
//! every set-up camera held and read (D13) and CAM 1 selected (D19). Only
//! Setup's part is saved (`store.rs`); releasing and the selection are kept
//! in memory, so a start holds every set-up camera again.
//!
//! The cameras are read through one of two links: the simulated cameras
//! (`bodies`, every test and development run) or the real links
//! (`real_link::RealLinks`, the studio's build), which the runtime tells
//! what to hold and to let go (`tell_links`) whenever who holds a camera
//! changes, and which answer a read at once from what they last heard.
//!
//! One set of cameras per saved data (`db_path`), so the tests, each with a
//! database of its own, never share one. Every `cameras.*` request runs under
//! the cameras' own lock (`with_cameras`), which first reads every held
//! camera again (a read sends nothing; D12): a value a camera changed itself
//! comes back as `cameras.changed { reason: "reported" }`, a held camera that
//! stops answering as `unreachable` and one that answers again as
//! `reachable` — with `app.changed { reason: "health" }` after them when the
//! health check changed — whoever noticed first.

use crate::cameras::model::{model, CAMERA_NUMBERS, RECORDING_CAMERA};
use crate::cameras::real_link::{self, LinkFailure, RealLinks};
use crate::cameras::simulated::{CameraCommand, CameraReading, SimulatedCameras};
use crate::cameras::snapshot::{CameraDialBank, CameraSetupSummary, CameraState};
use crate::cameras::store::{read_setup, StoredSetup};
use crate::cameras::CameraError;
use crate::engine_events::{emit_app_changed, emit_cameras_changed};
use crate::health::APP_CHANGED_REASON_HEALTH;
use crate::pictures_helper::{self, Wanted};
use crate::storage::open_connection;
use crate::storage_backups::civil_from_days;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use studio_control_protocol::pictures::WantedCamera;

/// UTC as `2026-09-27T14:03:22.123Z`, the shape the other times in the
/// snapshots take.
pub(crate) fn utc_text(time: SystemTime) -> String {
    let since_epoch = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_seconds = since_epoch.as_secs();
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_from_days((total_seconds / 86_400) as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds_of_day / 3_600,
        (seconds_of_day % 3_600) / 60,
        seconds_of_day % 60,
        since_epoch.subsec_millis()
    )
}

/// One camera as the hardware link holds it.
#[derive(Debug, Clone)]
pub(crate) struct CameraRuntime {
    pub setup: StoredSetup,
    /// This build has a link to it (`real_link::has_link`).
    pub has_link: bool,
    /// Handed back to the iPad or LUMIX Tether (D13); kept in memory only.
    pub released: bool,
    /// What it last reported; `None` when it was never read since the start
    /// or it is released.
    pub reading: Option<CameraReading>,
    /// When it last answered.
    pub read_at: Option<String>,
    /// Why it did not answer the last time it was read; `None` while it
    /// answers.
    pub failure: Option<LinkFailure>,
    /// When the hardware link saw the take start; `None` when it started
    /// before the link looked, or nothing records. The page counts the take's
    /// length from it, and the deck's `REC` the same way (2026-10-03).
    pub started_at: Option<SystemTime>,
}

/// What reading a camera again found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Transition {
    /// A value it changed itself (`reported`).
    Reported,
    /// A held camera stopped answering (`unreachable`).
    Unreachable,
    /// It answers again (`reachable`).
    Reachable,
}

impl Transition {
    pub(crate) fn reason(self) -> &'static str {
        match self {
            Self::Reported => "reported",
            Self::Unreachable => "unreachable",
            Self::Reachable => "reachable",
        }
    }
}

impl CameraRuntime {
    fn new(setup: StoredSetup, simulated: bool) -> Self {
        Self {
            has_link: real_link::has_link(setup.camera, simulated),
            setup,
            released: false,
            reading: None,
            read_at: None,
            failure: None,
            started_at: None,
        }
    }

    pub(crate) fn camera(&self) -> u8 {
        self.setup.camera
    }

    pub(crate) fn state(&self) -> CameraState {
        if !self.setup.set_up() {
            CameraState::NotSetUp
        } else if self.released {
            CameraState::Released
        } else if self.failure.is_some() {
            CameraState::Unreachable
        } else {
            CameraState::Held
        }
    }

    /// The sentence of an unreachable camera: it does not answer, or there
    /// is no link to it yet.
    pub(crate) fn unreachable_sentence(&self) -> String {
        let failure = self.failure.clone().unwrap_or(LinkFailure::NoAnswer);
        failure.sentence(self.camera(), self.setup.address.as_deref())
    }

    /// The state's sentence.
    pub(crate) fn sentence(&self) -> String {
        model(self.camera()).state_sentence(
            self.state(),
            self.has_link,
            &self.unreachable_sentence(),
        )
    }

    /// What Setup holds for it, and why Setup can take no more in a build
    /// with no link to it.
    pub(crate) fn setup_summary(&self) -> CameraSetupSummary {
        CameraSetupSummary {
            no_link: (!self.has_link).then(|| model(self.camera()).no_link_refusal()),
            ..self.setup.summary()
        }
    }

    /// Stops reading it: what it reported is no longer shown.
    fn forget_reading(&mut self) {
        self.reading = None;
        self.read_at = None;
        self.failure = None;
        self.started_at = None;
    }

    /// Takes a reading. The take's start is the link's to see: a take that
    /// was running at the first read after a start, a connect or an
    /// unreachable spell started before it looked.
    fn take_reading(&mut self, reading: CameraReading, now: SystemTime) {
        let answered_before = self.reading.is_some() && self.failure.is_none();
        let was = self.reading.as_ref().and_then(|last| last.recording);
        self.started_at = match reading.recording {
            Some(true) if answered_before && was == Some(true) => self.started_at,
            Some(true) if answered_before && was == Some(false) => Some(now),
            _ => None,
        };
        self.reading = Some(reading);
        self.read_at = Some(utc_text(now));
        self.failure = None;
    }
}

/// The deck's armed stop (D14: `STOP?`). The window and the dwell are
/// `deck.rs`'s.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct StopArm {
    /// When the press armed it.
    pub at: Instant,
    /// What `take_changes` read then: the arm is about the take that ran,
    /// and about no other.
    pub take: u64,
}

/// The three cameras, the selection and the deck's dials.
#[derive(Debug, Clone)]
pub(crate) struct Cameras {
    /// The saved data they belong to: the pictures helper of the same saved
    /// data says what their pictures do (`pictures.rs`).
    pub db_path: PathBuf,
    /// The simulated link (`SSE_CAMERAS_SIMULATED=1`), or the real ones.
    pub simulated: bool,
    /// The real links (`real_link.rs`): told what to hold and to let go,
    /// read without waiting, sent the presses. Spoken to only without the
    /// simulated cameras, so no test or development run reaches one.
    pub links: RealLinks,
    /// The camera the big picture, the plate and the deck's dials set (D19).
    pub selected: u8,
    /// What the deck's dials set on it (D14); exposure after a start. Kept
    /// in memory only, as the selection is.
    pub bank: CameraDialBank,
    /// The deck's armed stop; `None` while it is not armed.
    pub stop_arm: Option<StopArm>,
    /// When the deck's `REC` last started or stopped a take: a press sooner
    /// than the dwell after it is the same press again (`deck.rs`).
    pub deck_rec_at: Option<Instant>,
    /// Counts the reads in which CAM 1 reported another state of its take
    /// than in the read before: a take that began or ended, whoever did it.
    /// A read that finds CAM 1 again after it did not answer counts too: a
    /// take may have ended and another begun meanwhile. An armed stop whose
    /// count is another's is about a take that is over, or may be.
    ///
    /// What it cannot see: a take that ends and another that begins on the
    /// camera itself between two reads. The cameras are read once a second
    /// while the page is open or the deck polls.
    pub take_changes: u64,
    /// The last read of the cameras' Recent actions failed: the log says so
    /// once for as long as it lasts.
    pub recent_unread: bool,
    cameras: [CameraRuntime; 3],
}

impl Cameras {
    /// A start: Setup's rows, every set-up camera held and read (a read
    /// sends nothing), CAM 1 selected. Nothing is announced.
    fn load(
        db_path: &Path,
        simulated: bool,
        bodies: &SimulatedCameras,
        now: SystemTime,
    ) -> Result<Self, CameraError> {
        let setup = read_setup(&open_connection(db_path)?)?;
        let mut cameras = Self {
            db_path: db_path.to_path_buf(),
            simulated,
            links: RealLinks::new(db_path),
            selected: RECORDING_CAMERA,
            bank: CameraDialBank::default(),
            stop_arm: None,
            deck_rec_at: None,
            take_changes: 0,
            recent_unread: false,
            cameras: setup.map(|setup| CameraRuntime::new(setup, simulated)),
        };
        for camera in CAMERA_NUMBERS {
            cameras.tell_links(camera);
            cameras.read(camera, bodies, now);
        }
        Ok(cameras)
    }

    /// Tells the real links to hold `camera` as its setup now stands (set
    /// up and not released) or to let it go; nothing with the simulated
    /// cameras.
    fn tell_links(&mut self, camera: u8) {
        if self.simulated {
            return;
        }
        let runtime = self.camera(camera);
        if runtime.setup.set_up() && !runtime.released {
            let setup = runtime.setup.clone();
            self.links.hold(&setup);
        } else {
            self.links.let_go(camera);
        }
    }

    pub(crate) fn camera(&self, camera: u8) -> &CameraRuntime {
        &self.cameras[usize::from(camera.clamp(1, 3)) - 1]
    }

    fn camera_mut(&mut self, camera: u8) -> &mut CameraRuntime {
        &mut self.cameras[usize::from(camera.clamp(1, 3)) - 1]
    }

    pub(crate) fn all(&self) -> &[CameraRuntime; 3] {
        &self.cameras
    }

    /// Each camera's vMix input and the selection, as the pictures helper
    /// is told them.
    pub(crate) fn wanted_pictures(&self) -> Wanted {
        Wanted {
            cameras: self
                .cameras
                .iter()
                .map(|runtime| WantedCamera {
                    camera: runtime.camera(),
                    vmix_input: runtime.setup.vmix_input,
                })
                .collect(),
            selected: self.selected,
        }
    }

    fn link_read(
        &self,
        camera: u8,
        bodies: &SimulatedCameras,
    ) -> Result<CameraReading, LinkFailure> {
        if self.simulated {
            bodies.read(camera).ok_or(LinkFailure::NoAnswer)
        } else {
            self.links.read(&self.camera(camera).setup)
        }
    }

    /// Reads a set-up camera that is not released; says what changed.
    pub(crate) fn read(
        &mut self,
        camera: u8,
        bodies: &SimulatedCameras,
        now: SystemTime,
    ) -> Option<Transition> {
        let runtime = self.camera(camera);
        if !runtime.setup.set_up() || runtime.released {
            return None;
        }
        let was_unreachable = runtime.failure.is_some();
        let last = runtime.reading.clone();
        match self.link_read(camera, bodies) {
            Ok(reading) => {
                let changed = last
                    .as_ref()
                    .is_some_and(|last| !last.same_values(&reading));
                if camera == RECORDING_CAMERA
                    && (was_unreachable
                        || last.as_ref().and_then(|last| last.recording) != reading.recording)
                {
                    self.take_changes = self.take_changes.wrapping_add(1);
                }
                self.camera_mut(camera).take_reading(reading, now);
                if was_unreachable {
                    Some(Transition::Reachable)
                } else {
                    changed.then_some(Transition::Reported)
                }
            }
            Err(failure) => {
                // An unreachable camera keeps what it last reported, and
                // when (D19): the page shows it as doubt.
                self.camera_mut(camera).failure = Some(failure);
                (!was_unreachable).then_some(Transition::Unreachable)
            }
        }
    }

    /// Reads every held (and every unreachable) camera again.
    fn refresh(&mut self, bodies: &SimulatedCameras, now: SystemTime) -> Vec<(u8, Transition)> {
        CAMERA_NUMBERS
            .into_iter()
            .filter_map(|camera| {
                self.read(camera, bodies, now)
                    .map(|transition| (camera, transition))
            })
            .collect()
    }

    /// Reads every camera again and announces what changed.
    fn settle(&mut self, bodies: &SimulatedCameras, now: SystemTime) {
        let before = self.health_check();
        let transitions = self.refresh(bodies, now);
        if transitions.is_empty() {
            return;
        }
        for (camera, transition) in transitions {
            announce(transition.reason(), Some(camera));
        }
        if self.health_check() != before {
            announce_health();
        }
    }

    /// Sends the operator's press to a held camera. A camera that does not
    /// take it reads `UNREACHABLE` at once (announced), and the request is
    /// refused with its sentence.
    pub(crate) fn send(
        &mut self,
        camera: u8,
        bodies: &mut SimulatedCameras,
        commands: &[CameraCommand],
    ) -> Result<(), CameraError> {
        let failure = if !self.simulated {
            let runtime = self.camera(camera);
            let setup = runtime.setup.clone();
            let current = runtime.reading.clone().unwrap_or_default();
            match self.links.send(&setup, commands, &current) {
                Ok(()) => None,
                // The protocol cannot carry the press: nothing was sent,
                // and the camera is as reachable as before.
                Err(LinkFailure::NotCarried(sentence)) => {
                    return Err(CameraError::Refused("CAMERA_VALUE_NOT_ALLOWED", sentence));
                }
                Err(failure) => Some(failure),
            }
        } else if bodies.send(camera, commands) {
            None
        } else {
            Some(LinkFailure::NoAnswer)
        };
        let Some(failure) = failure else {
            return Ok(());
        };
        let before = self.health_check();
        self.camera_mut(camera).failure = Some(failure);
        announce(Transition::Unreachable.reason(), Some(camera));
        if self.health_check() != before {
            announce_health();
        }
        Err(CameraError::Refused(
            "CAMERA_UNREACHABLE",
            self.camera(camera).unreachable_sentence(),
        ))
    }

    /// Reads a camera back after a press: what it reports now is the
    /// answer (the camera wins, D12). A value it reports is the request's
    /// own change (its reason says so); a camera that stops answering is
    /// announced as any other.
    pub(crate) fn read_back(&mut self, camera: u8, bodies: &SimulatedCameras, now: SystemTime) {
        let before = self.health_check();
        if self.read(camera, bodies, now) == Some(Transition::Unreachable) {
            announce(Transition::Unreachable.reason(), Some(camera));
            if self.health_check() != before {
                announce_health();
            }
        }
    }

    /// Hands a camera back (D13): the link stops reading it and sends it
    /// nothing; a take it is recording goes on.
    pub(crate) fn release(&mut self, camera: u8) {
        let runtime = self.camera_mut(camera);
        runtime.released = true;
        runtime.forget_reading();
        self.tell_links(camera);
    }

    /// Takes a camera back and reads it again.
    pub(crate) fn connect(&mut self, camera: u8, bodies: &SimulatedCameras, now: SystemTime) {
        let runtime = self.camera_mut(camera);
        runtime.released = false;
        if runtime.failure.is_some() {
            // Tried again below; what it last reported stays until it
            // answers.
        } else {
            runtime.forget_reading();
        }
        self.tell_links(camera);
        self.read(camera, bodies, now);
    }

    /// Setup holds something else for a camera. With `hold` (an address
    /// saved, CAM 1 paired, a camera forgotten) the camera starts again from
    /// its new setup: held and read at once when it is set up, nothing to
    /// show when it is not. Without it (a restore) only a camera whose
    /// address or pairing changed starts again; a new vMix input changes
    /// nothing else.
    pub(crate) fn take_setup(
        &mut self,
        setup: StoredSetup,
        bodies: &SimulatedCameras,
        now: SystemTime,
        hold: bool,
    ) {
        let camera = setup.camera;
        let runtime = self.camera_mut(camera);
        let same_camera =
            runtime.setup.address == setup.address && runtime.setup.paired == setup.paired;
        runtime.setup = setup;
        if hold || !same_camera {
            runtime.released = false;
            runtime.forget_reading();
            self.tell_links(camera);
            self.read(camera, bodies, now);
        }
    }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

struct EntryState {
    /// The hardware link's view of the cameras; `None` until the first
    /// request after a start.
    cameras: Option<Cameras>,
    /// The simulated cameras themselves, which a restart of the link does
    /// not touch.
    bodies: SimulatedCameras,
}

type Entry = Mutex<EntryState>;

static CAMERAS: OnceLock<Mutex<HashMap<PathBuf, Arc<Entry>>>> = OnceLock::new();

fn entry(db_path: &Path) -> Arc<Entry> {
    let registry = CAMERAS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut registry = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(registry.entry(db_path.to_path_buf()).or_insert_with(|| {
        Arc::new(Mutex::new(EntryState {
            cameras: None,
            bodies: SimulatedCameras::default(),
        }))
    }))
}

fn lock(entry: &Entry) -> MutexGuard<'_, EntryState> {
    entry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Runs `action` on the cameras of this saved data, loaded the first time
/// (every set-up camera held and read), after reading every camera again.
/// The cameras' lock is held for the whole action, so two requests never
/// interleave. A vMix input or the selection the action changed (Setup, a
/// restore, a camera selected) reaches the pictures helper.
pub(crate) fn with_cameras<T>(
    db_path: &Path,
    simulated: bool,
    action: impl FnOnce(&mut Cameras, &mut SimulatedCameras, SystemTime) -> Result<T, CameraError>,
) -> Result<T, CameraError> {
    let entry = entry(db_path);
    let mut guard = lock(&entry);
    let EntryState { cameras, bodies } = &mut *guard;
    let now = SystemTime::now();
    let cameras = match cameras {
        Some(cameras) => {
            cameras.settle(bodies, now);
            cameras
        }
        None => cameras.insert(Cameras::load(db_path, simulated, bodies, now)?),
    };
    let wanted = cameras.wanted_pictures();
    let result = action(cameras, bodies, now);
    let now_wanted = cameras.wanted_pictures();
    if now_wanted != wanted {
        pictures_helper::want(db_path, now_wanted);
    }
    result
}

/// A real link heard something the page shows (a value the camera changed,
/// a connection that came or went): the cameras are read again and what
/// changed is announced, as before any request. Called from the link's
/// thread, never under the cameras' lock.
pub(crate) fn notice(db_path: &Path) {
    let _ = with_cameras(db_path, false, |_, _, _| Ok(()));
}

/// `cameras.changed { reason, camera }` from outside a request's own reply.
fn announce(reason: &'static str, camera: Option<u8>) {
    #[cfg(test)]
    ANNOUNCED.with(|events| {
        events.borrow_mut().push((
            String::from(crate::protocol::EVENT_CAMERAS_CHANGED),
            crate::engine_events::cameras_changed_payload(reason, camera),
        ));
    });
    emit_cameras_changed(reason, camera);
}

/// `app.changed { reason: "health" }` after a link change that changed the
/// health check.
fn announce_health() {
    #[cfg(test)]
    ANNOUNCED.with(|events| {
        events.borrow_mut().push((
            String::from(crate::protocol::EVENT_APP_CHANGED),
            serde_json::json!({ "reason": APP_CHANGED_REASON_HEALTH }),
        ));
    });
    emit_app_changed(APP_CHANGED_REASON_HEALTH);
}

#[cfg(test)]
thread_local! {
    /// The events announced on this thread, for the tests (the event sender
    /// is not registered there).
    pub(crate) static ANNOUNCED: std::cell::RefCell<Vec<(String, serde_json::Value)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Forgets the hardware link's view of the cameras of this saved data, so
/// the next request loads it again — a start, for the tests. The simulated
/// cameras stay as they are, as the cameras on the desk would.
#[cfg(test)]
pub(crate) fn forget(db_path: &Path) {
    lock(&entry(db_path)).cameras = None;
}

/// What the runtime told the real links of this saved data since the start
/// (`hold 2`, `let go 2`), for the tests of the seam.
#[cfg(test)]
pub(crate) fn links_told(db_path: &Path) -> Vec<String> {
    lock(&entry(db_path))
        .cameras
        .as_ref()
        .map(|cameras| cameras.links.told())
        .unwrap_or_default()
}

/// Does something to the simulated cameras themselves (a test hook: the
/// body, the iPad, a camera that stops answering), then lets the link notice
/// it as it would: every camera is read again and what changed is announced.
#[cfg(test)]
pub(crate) fn with_bodies<T>(db_path: &Path, action: impl FnOnce(&mut SimulatedCameras) -> T) -> T {
    let entry = entry(db_path);
    let mut guard = lock(&entry);
    let EntryState { cameras, bodies } = &mut *guard;
    let result = action(bodies);
    if let Some(cameras) = cameras {
        cameras.settle(bodies, SystemTime::now());
    }
    result
}

/// Does something to the simulated cameras and lets nobody notice: what the
/// hardware link finds out only when it next reads them.
#[cfg(test)]
pub(crate) fn with_bodies_unnoticed<T>(
    db_path: &Path,
    action: impl FnOnce(&mut SimulatedCameras) -> T,
) -> T {
    action(&mut lock(&entry(db_path)).bodies)
}

/// Everything the simulated camera `camera` of this saved data was sent,
/// oldest first (the D12 tests).
#[cfg(test)]
pub(crate) fn sent(db_path: &Path, camera: u8) -> Vec<CameraCommand> {
    lock(&entry(db_path)).bodies.sent(camera).to_vec()
}

/// Forgets this saved data's cameras altogether, the simulated ones too (a
/// test's end).
#[cfg(test)]
pub(crate) fn remove(db_path: &Path) {
    if let Some(registry) = CAMERAS.get() {
        registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(db_path);
    }
}
