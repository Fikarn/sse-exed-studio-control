//! The cameras while Studio Control runs: who holds each, what each last
//! reported and when, and the selection — loaded by the first request, with
//! every set-up camera that is not released held and read (D13) and CAM 1
//! selected (D19). Setup's part is saved (`store.rs`), and so is a release
//! (D41, 2026-10-06; a setting of its own, `cameras.released.<camera>`): a
//! camera let go (to LUMIX Tether, or to nobody) stays released across a start
//! until `Connect`, `Forget`, a new pairing or a new address. The selection
//! and the dials' bank are kept in memory.
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

use crate::cameras::model::{model, Setting, CAMERA_NUMBERS, RECORDING_CAMERA};
use crate::cameras::pocket::pairing::{PairingStep, PIN_REFUSED, STOPPED};
use crate::cameras::real_link::{self, BluetoothAddress, LinkFailure, RealLinks};
use crate::cameras::simulated::{
    CameraCommand, CameraReading, LinkReading, SimulatedCameras, SIMULATED_PIN,
};
use crate::cameras::snapshot::{CameraDialBank, CameraSetupSummary, CameraState};
use crate::cameras::store::{read_setup, write_setup, StoredSetup};
use crate::cameras::CameraError;
use crate::diagnostics::{log_event, LogLevel};
use crate::engine_events::{emit_app_changed, emit_cameras_changed};
use crate::health::APP_CHANGED_REASON_HEALTH;
use crate::pictures_helper::{self, Wanted};
use crate::storage::{apply_settings, list_settings_by_prefix, open_connection, set_settings};
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

/// The setting that keeps a camera's release across a start (D41):
/// `cameras.released.<camera>`, `1` while released, absent otherwise. Under
/// a prefix of its own, outside `app.`, so no archive carries it and no
/// other reader of the settings meets it; a database backup restored whole
/// brings it back.
const RELEASED_PREFIX: &str = "cameras.released.";

fn released_key(camera: u8) -> String {
    format!("{RELEASED_PREFIX}{camera}")
}

/// The setting that keeps what a camera last reported, and when, across a
/// start (finding 19 of the walk of 2026-10-07, the owner's decision):
/// `cameras.lastReading.<camera>`, the reading as JSON, written when the
/// camera reports and taken away when it is forgotten or set up anew. Under
/// its own prefix, like the release, so no archive carries it; a database
/// backup restored whole brings it back.
const LAST_READING_PREFIX: &str = "cameras.lastReading.";

fn last_reading_key(camera: u8) -> String {
    format!("{LAST_READING_PREFIX}{camera}")
}

/// How often a reading that does not change is saved again, for its time.
const SAVE_READING_EVERY: std::time::Duration = std::time::Duration::from_secs(60);

/// What the setting holds.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SavedReading {
    read_at: String,
    reading: CameraReading,
}

/// A press that sets half a parameter: the other half goes with it as the
/// camera reported it (`pocket/protocol.rs`), never a guess (D12). While a
/// camera's values are the last read, that half is a kept value the camera
/// has not reported in this connection, so the press is refused (the
/// lesson of D43). `Some((what the camera has not reported, the press))`.
fn half_parameter(setting: &Setting) -> Option<(&'static str, &'static str)> {
    match setting {
        Setting::WhiteBalance => Some(("its tint", "a white balance")),
        Setting::Tint => Some(("its white balance", "a tint")),
        Setting::Resolution => Some(("its recording format", "a resolution")),
        Setting::FrameRate => Some(("its recording format", "a frame rate")),
        Setting::DisplayLut => Some(("whether its display LUT is on", "a display LUT")),
        Setting::DisplayLutOn => Some(("its display LUT", "the switch")),
        _ => None,
    }
}

/// One camera as the hardware link holds it.
#[derive(Debug, Clone)]
pub(crate) struct CameraRuntime {
    pub setup: StoredSetup,
    /// This build has a link to it (`real_link::has_link`).
    pub has_link: bool,
    /// Let go (to LUMIX Tether, or to nobody; D13); saved, so a start
    /// keeps it (D41).
    pub released: bool,
    /// What it last reported; `None` when it was never read since the start
    /// and nothing was saved. Kept while released, for a Connect soon after,
    /// and loaded at a start from the saved reading (finding 19).
    pub reading: Option<CameraReading>,
    /// When it last answered.
    pub read_at: Option<String>,
    /// Its values are what it last reported, at `read_at`, not what it
    /// reports now: its link has brought no setting since it connected (a
    /// start with the saved reading, a quick reconnect, a Connect soon
    /// after a Release). The page shows them as doubt, `last read`, until
    /// the camera reports (finding 19).
    pub values_last_read: bool,
    /// When its reading was last saved for a start; a reading that does not
    /// change is saved again once a minute, so the time shown after a start
    /// is near the last read, not the last change. In memory only.
    pub last_saved_at: Option<SystemTime>,
    /// The last save failed, said in the log once; said again when a save
    /// goes through. In memory only.
    pub save_failing: bool,
    /// Why it did not answer the last time it was read; `None` while it
    /// answers.
    pub failure: Option<LinkFailure>,
    /// When the hardware link saw the take start; `None` when it started
    /// before the link looked, or nothing records. The page counts the take's
    /// length from it, and the deck's `REC` the same way (2026-10-03).
    pub started_at: Option<SystemTime>,
    /// CAM 1's pairing as Setup shows it: running, or why the last one
    /// failed; `None` when none runs, and always for CAM 2 and CAM 3. Kept
    /// in memory: a start shows none.
    pub pairing: Option<PairingStep>,
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
            values_last_read: false,
            last_saved_at: None,
            save_failing: false,
            failure: None,
            started_at: None,
            pairing: None,
        }
    }

    pub(crate) fn camera(&self) -> u8 {
        self.setup.camera
    }

    /// Its row says paired and the link found the pairing gone (Windows no
    /// longer holds it, or the row holds no Bluetooth address): it reads
    /// `NOT SET UP` and Setup pairs it again; the row is kept.
    fn pairing_lost(&self) -> bool {
        matches!(self.failure, Some(LinkFailure::NotPaired(_)))
    }

    pub(crate) fn state(&self) -> CameraState {
        if !self.setup.set_up() || self.pairing_lost() {
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

    /// The state's sentence; a lost pairing's own; a held camera's whose
    /// values are the last read.
    pub(crate) fn sentence(&self) -> String {
        if self.pairing_lost() {
            return self.unreachable_sentence();
        }
        if self.state() == CameraState::Held && self.values_last_read && self.reading.is_some() {
            return model(self.camera()).last_read_sentence();
        }
        model(self.camera()).state_sentence(
            self.state(),
            self.has_link,
            &self.unreachable_sentence(),
        )
    }

    /// What Setup holds for it, why Setup can take no more in a build with
    /// no link to it, and CAM 1's pairing. A lost pairing reads as none, so
    /// Setup offers `Pair CAM 1` again.
    pub(crate) fn setup_summary(&self) -> CameraSetupSummary {
        let saved = self.setup.summary();
        let lost = self.pairing_lost();
        CameraSetupSummary {
            set_up: saved.set_up && !lost,
            paired: saved.paired && !lost,
            no_link: (!self.has_link).then(|| model(self.camera()).no_link_refusal()),
            pairing: self.pairing.as_ref().and_then(PairingStep::shown),
            ..saved
        }
    }

    /// Stops reading it: what it reported is no longer shown.
    fn forget_reading(&mut self) {
        self.reading = None;
        self.read_at = None;
        self.values_last_read = false;
        self.failure = None;
        self.started_at = None;
    }

    /// Takes a reading. A link that has brought no setting since it
    /// connected leaves what the camera last reported, and when, as the
    /// last read, the timecode alone following, until the camera reports
    /// (finding 19); with nothing read before there is nothing to keep. The
    /// take's start is the link's to see: a take that was running at the
    /// first read after a start, a connect or an unreachable spell started
    /// before it looked.
    fn take_reading(&mut self, link: LinkReading, now: SystemTime) {
        let LinkReading { reading, last_read } = link;
        let reading = match (&self.reading, last_read) {
            (Some(last), true) => CameraReading {
                timecode: reading.timecode.or_else(|| last.timecode.clone()),
                battery: reading.battery.or(last.battery),
                record_time_left_minutes: reading
                    .record_time_left_minutes
                    .or(last.record_time_left_minutes),
                ..last.clone()
            },
            _ => reading,
        };
        let answered_before = self.reading.is_some() && self.failure.is_none();
        let was = self.reading.as_ref().and_then(|last| last.recording);
        self.started_at = match reading.recording {
            Some(true) if answered_before && was == Some(true) => self.started_at,
            Some(true) if answered_before && was == Some(false) => Some(now),
            _ => None,
        };
        self.values_last_read = last_read && self.reading.is_some();
        if !self.values_last_read {
            self.read_at = Some(utc_text(now));
        }
        self.reading = Some(reading);
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
    /// A start: Setup's rows, every set-up camera that was not released
    /// held and read (a read sends nothing), a released one left released
    /// (D41), CAM 1 selected. Nothing is announced.
    fn load(
        db_path: &Path,
        simulated: bool,
        bodies: &SimulatedCameras,
        now: SystemTime,
    ) -> Result<Self, CameraError> {
        let setup = read_setup(&open_connection(db_path)?)?;
        let released = list_settings_by_prefix(db_path, RELEASED_PREFIX)
            .map_err(|error| CameraError::Storage(error.to_string()))?;
        let last_readings = list_settings_by_prefix(db_path, LAST_READING_PREFIX)
            .map_err(|error| CameraError::Storage(error.to_string()))?;
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
            cameras: setup.map(|setup| {
                let mut runtime = CameraRuntime::new(setup, simulated);
                runtime.released = runtime.setup.set_up()
                    && released
                        .get(&released_key(runtime.camera()))
                        .is_some_and(|value| value.trim() == "1");
                // What it last reported, as the last read until it reports
                // (finding 19); a saved reading that cannot be read is
                // nothing read.
                if runtime.setup.set_up() {
                    if let Some(saved) = last_readings
                        .get(&last_reading_key(runtime.camera()))
                        .and_then(|value| serde_json::from_str::<SavedReading>(value).ok())
                    {
                        runtime.reading = Some(saved.reading);
                        runtime.read_at = Some(saved.read_at);
                        runtime.values_last_read = true;
                    }
                }
                runtime
            }),
        };
        for camera in CAMERA_NUMBERS {
            cameras.tell_links(camera);
            cameras.read(camera, bodies, now);
        }
        Ok(cameras)
    }

    /// Saves whether `camera` is released (D41): the setting written while
    /// it is, taken away when it is held again. A write that fails is a
    /// line in the log, and the release stands for this run.
    fn save_release(&self, camera: u8, released: bool) {
        let key = released_key(camera);
        let written = if released {
            set_settings(&self.db_path, &[(&key, String::from("1"))])
        } else {
            apply_settings(&self.db_path, &[], &[&key])
        };
        if let Err(error) = written {
            log_event(
                LogLevel::Warn,
                &format!(
                    "{}'s release could not be saved; the next start holds it again: {error}",
                    model(camera).tag
                ),
            );
        }
    }

    /// Saves what `camera` reported and when, for a start (finding 19). A
    /// write that fails is one line in the log for as long as it fails, and
    /// is tried again at the next change or a minute later, never at every
    /// read; a start meanwhile shows what was saved before, or nothing read.
    fn save_reading(&mut self, camera: u8, now: SystemTime) {
        let runtime = self.camera(camera);
        let (Some(reading), Some(read_at)) = (&runtime.reading, &runtime.read_at) else {
            return;
        };
        let saved = SavedReading {
            read_at: read_at.clone(),
            reading: reading.clone(),
        };
        let written = serde_json::to_string(&saved)
            .map_err(|error| error.to_string())
            .and_then(|value| {
                set_settings(&self.db_path, &[(&last_reading_key(camera), value)])
                    .map_err(|error| error.to_string())
            });
        let runtime = self.camera_mut(camera);
        runtime.last_saved_at = Some(now);
        match written {
            Ok(()) => {
                if runtime.save_failing {
                    runtime.save_failing = false;
                    log_event(
                        LogLevel::Info,
                        &format!("{}'s reading is saved again.", model(camera).tag),
                    );
                }
            }
            Err(error) => {
                if !runtime.save_failing {
                    runtime.save_failing = true;
                    log_event(
                        LogLevel::Warn,
                        &format!(
                            "{}'s reading could not be saved, and is tried again at its next change or in a minute; a start meanwhile shows what was saved before, or nothing read: {error}",
                            model(camera).tag
                        ),
                    );
                }
            }
        }
    }

    /// Takes the saved reading away: the camera is forgotten or set up
    /// anew, so what it reported is another camera's.
    fn drop_saved_reading(&self, camera: u8) {
        if let Err(error) = apply_settings(&self.db_path, &[], &[&last_reading_key(camera)]) {
            log_event(
                LogLevel::Warn,
                &format!(
                    "{}'s saved reading could not be taken away: {error}",
                    model(camera).tag
                ),
            );
        }
    }

    /// Tells the real links to hold `camera` as its setup now stands (set
    /// up and not released) or to let it go, with what it last reported for
    /// the link to start from (finding 19); nothing with the simulated
    /// cameras.
    fn tell_links(&mut self, camera: u8) {
        if self.simulated {
            return;
        }
        let runtime = self.camera(camera);
        if runtime.setup.set_up() && !runtime.released {
            let setup = runtime.setup.clone();
            let last = runtime.reading.clone();
            self.links.hold(&setup, last);
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

    fn link_read(&self, camera: u8, bodies: &SimulatedCameras) -> Result<LinkReading, LinkFailure> {
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
            Ok(link) => {
                let last_read = link.last_read;
                self.camera_mut(camera).take_reading(link, now);
                let reading = self.camera(camera).reading.clone();
                let changed = match (&last, &reading) {
                    (Some(last), Some(reading)) => !last.same_values(reading),
                    _ => false,
                };
                if camera == RECORDING_CAMERA
                    && (was_unreachable
                        || last.as_ref().and_then(|last| last.recording)
                            != reading.as_ref().and_then(|reading| reading.recording))
                {
                    self.take_changes = self.take_changes.wrapping_add(1);
                }
                let saved_a_minute_ago = self
                    .camera(camera)
                    .last_saved_at
                    .and_then(|saved| now.duration_since(saved).ok())
                    .is_none_or(|since| since >= SAVE_READING_EVERY);
                if !last_read && (changed || last.is_none() || saved_a_minute_ago) {
                    self.save_reading(camera, now);
                }
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

    /// Follows CAM 1's pairing, reads every camera again and announces what
    /// changed.
    fn settle(&mut self, bodies: &SimulatedCameras, now: SystemTime) {
        let before = self.health_check();
        let paired = self.follow_pairing(bodies, now);
        let transitions = self.refresh(bodies, now);
        if paired.is_none() && transitions.is_empty() {
            return;
        }
        if let Some(reason) = paired {
            announce(reason, Some(RECORDING_CAMERA));
        }
        for (camera, transition) in transitions {
            announce(transition.reason(), Some(camera));
        }
        if self.health_check() != before {
            announce_health();
        }
    }

    // -----------------------------------------------------------------------
    // CAM 1's pairing (D15 rule 2; the Pocket's link, part 5, 2026-10-06)
    // -----------------------------------------------------------------------

    /// Setup's `Pair CAM 1`: a pairing begins, and one that runs starts
    /// over. The real link looks for the camera and Windows pairs it; the
    /// simulated camera shows its PIN at once.
    pub(crate) fn begin_pairing(&mut self) {
        let step = if self.simulated {
            PairingStep::Pin
        } else {
            self.links.begin_pairing()
        };
        if !step.running() {
            // Ended as it began (the guard): nothing to follow.
            self.links.end_pairing();
        }
        self.camera_mut(RECORDING_CAMERA).pairing = Some(step);
    }

    /// Hands over the PIN the camera shows. `None` when no pairing waits
    /// for one (`CAMERA_PAIRING_NOT_WANTED`); otherwise the reason to
    /// announce: `setup` once CAM 1 is paired (the simulated camera, at its
    /// own PIN), `pairing` while Windows pairs or when the PIN failed.
    pub(crate) fn give_pin(
        &mut self,
        pin: String,
        bodies: &SimulatedCameras,
        now: SystemTime,
    ) -> Result<Option<&'static str>, CameraError> {
        if self.camera(RECORDING_CAMERA).pairing != Some(PairingStep::Pin) {
            return Ok(None);
        }
        if self.simulated {
            if pin == SIMULATED_PIN {
                self.finish_pairing(None, bodies, now)?;
                return Ok(Some("setup"));
            }
            self.camera_mut(RECORDING_CAMERA).pairing =
                Some(PairingStep::Failed(String::from(PIN_REFUSED)));
            return Ok(Some("pairing"));
        }
        // A pairing that moved on meanwhile (its time for the PIN ran out)
        // says so at its next notice.
        if !self.links.give_pin(pin) {
            return Ok(None);
        }
        // `Pairing`, or why the PIN could not be handed over (its thread
        // gone). A pairing that is already `Paired` is left to its own
        // notice, which `follow_pairing` saves from `Pairing`.
        let step = match self.links.pairing_step() {
            Some(failed @ PairingStep::Failed(_)) => {
                self.links.end_pairing();
                failed
            }
            None => PairingStep::Failed(String::from(STOPPED)),
            Some(_) => PairingStep::Pairing,
        };
        self.camera_mut(RECORDING_CAMERA).pairing = Some(step);
        Ok(Some("pairing"))
    }

    /// Stops CAM 1's pairing, and what Setup shows of it (Forget).
    pub(crate) fn cancel_pairing(&mut self) {
        if !self.simulated {
            self.links.cancel_pairing();
        }
        self.camera_mut(RECORDING_CAMERA).pairing = None;
    }

    /// CAM 1 is paired: the pairing and the camera's Bluetooth address (the
    /// real link's; the simulated camera has none) are saved, and the camera
    /// is held and read at once, its release gone.
    fn finish_pairing(
        &mut self,
        address: Option<BluetoothAddress>,
        bodies: &SimulatedCameras,
        now: SystemTime,
    ) -> Result<(), CameraError> {
        let mut setup = self.camera(RECORDING_CAMERA).setup.clone();
        setup.paired = true;
        if let Some(address) = address {
            setup.address = Some(address.text());
        }
        write_setup(&open_connection(&self.db_path)?, &setup)?;
        self.camera_mut(RECORDING_CAMERA).pairing = None;
        self.take_setup(setup, bodies, now, true);
        Ok(())
    }

    /// The real pairing's thread moved on (its `notice`): Setup shows its
    /// step, and a camera Windows paired is saved and held. The reason to
    /// announce: `pairing` for a step, `setup` once saved.
    fn follow_pairing(
        &mut self,
        bodies: &SimulatedCameras,
        now: SystemTime,
    ) -> Option<&'static str> {
        if self.simulated {
            return None;
        }
        let followed = self
            .camera(RECORDING_CAMERA)
            .pairing
            .clone()
            .filter(PairingStep::running)?;
        let step = self
            .links
            .pairing_step()
            .unwrap_or_else(|| PairingStep::Failed(String::from(STOPPED)));
        if step == followed {
            return None;
        }
        if !step.running() {
            self.links.end_pairing();
        }
        let PairingStep::Paired(address) = step else {
            self.camera_mut(RECORDING_CAMERA).pairing = Some(step);
            return Some("pairing");
        };
        match self.finish_pairing(Some(address), bodies, now) {
            Ok(()) => Some("setup"),
            Err(
                CameraError::Storage(error)
                | CameraError::Invalid(error)
                | CameraError::Refused(_, error),
            ) => {
                log_event(
                    LogLevel::Warn,
                    &format!("CAM 1's pairing could not be saved: {error}"),
                );
                self.camera_mut(RECORDING_CAMERA).pairing = Some(PairingStep::Failed(format!(
                    "CAM 1 paired, but Studio Control could not save the pairing: {error}. Press Pair CAM 1 to try again."
                )));
                Some("pairing")
            }
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
        // While its values are the last read, a press that sets half a
        // parameter would carry the other half from the kept reading, which
        // the camera has not reported in this connection: never a guess
        // (D12, the lesson of D43). It is refused until the camera reports;
        // a whole parameter, an auto and REC go. The halves are Blackmagic's
        // protocol: CAM 1's; a BGH1's white balance is a whole value.
        if camera == RECORDING_CAMERA && self.camera(camera).values_last_read {
            for command in commands {
                if let CameraCommand::Set(setting, _) = command {
                    if let Some((what, press)) = half_parameter(setting) {
                        return Err(CameraError::Refused(
                            "CAMERA_VALUE_NOT_ALLOWED",
                            format!(
                                "{} has not reported {what} since it connected, so {press} cannot be sent with it.",
                                model(camera).tag
                            ),
                        ));
                    }
                }
            }
        }
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
    /// nothing; a take it is recording goes on. The release is saved, so a
    /// start keeps it (D41).
    pub(crate) fn release(&mut self, camera: u8) {
        let runtime = self.camera_mut(camera);
        runtime.released = true;
        // What it reported stays, unshown while released, for a Connect
        // soon after: the camera then reports nothing until a setting
        // changes, and the values show as the last read (finding 19). A
        // take it records may end and another begin meanwhile: the deck's
        // arm does not outlive the release.
        runtime.values_last_read = runtime.reading.is_some();
        runtime.failure = None;
        runtime.started_at = None;
        if camera == RECORDING_CAMERA {
            self.take_changes = self.take_changes.wrapping_add(1);
        }
        self.save_release(camera, true);
        self.tell_links(camera);
    }

    /// Takes a camera back and reads it again; the saved release goes. What
    /// it last reported stays until it answers or reports (finding 19).
    pub(crate) fn connect(&mut self, camera: u8, bodies: &SimulatedCameras, now: SystemTime) {
        let runtime = self.camera_mut(camera);
        let was_released = runtime.released;
        runtime.released = false;
        runtime.values_last_read = runtime.reading.is_some();
        if was_released {
            self.save_release(camera, false);
        }
        self.tell_links(camera);
        self.read(camera, bodies, now);
    }

    /// Setup holds something else for a camera. With `hold` (an address
    /// saved, CAM 1 paired, a camera forgotten) the camera starts again from
    /// its new setup: held and read at once when it is set up, nothing to
    /// show when it is not, and a saved release goes (D41). Without it (a
    /// restore) only a camera whose address or pairing changed starts again;
    /// a new vMix input changes nothing else.
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
            let was_released = runtime.released;
            runtime.released = false;
            runtime.forget_reading();
            if was_released {
                self.save_release(camera, false);
            }
            self.drop_saved_reading(camera);
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
