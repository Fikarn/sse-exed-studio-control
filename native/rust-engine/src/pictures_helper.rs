//! The pictures helper's supervision (the camera pictures, D28): the engine
//! starts the helper, tells it each camera's vMix input, hears what it
//! receives, and stops it. Whatever receives the pictures runs in that
//! process, so its crash or hang costs the pictures and nothing else: the
//! engine keeps no picture and loads no library for it.
//!
//! - The helper's program is beside the engine's (`HELPER_PROGRAM`) and
//!   nowhere else. It starts below normal priority, so Windows serves vMix
//!   first, with no window of its own, and all three of its pipes are the
//!   engine's: it can never write into the engine's own stdout.
//! - It says what it receives at least once a second. One silent for
//!   `SILENCE` is ended; one that ends is started again after 1, 2, 4 … 30 s.
//!   A program that is not there is said once, and not looked for again.
//! - It ends by itself when its stdin closes, so an engine that goes takes it
//!   along; a graceful stop closes it first, and ends it if it lingers.
//! - It tells the helper its source on every want (`source_for`). A studio
//!   build with the real cameras starts it on vMix's Outputs 2 to 4 over NDI
//!   (D31, D34); a studio build with the simulated cameras (`npm run
//!   release`'s trial start and lanes) starts none. A development build
//!   starts it only with the simulated cameras: on the test card, or on
//!   vMix's outputs when `npm run app -- --vmix-pictures` set
//!   `SSE_VMIX_PICTURES=1` (D33), a hardware test the owner attends. The
//!   helper checks its source again by itself. The engine starts only a
//!   helper of its own build, as its mark says (`own_helper`), and a studio
//!   build's helper gets neither of the development run's two variables.
//!   The engine's unit tests start none; the lanes and the end-to-end tests
//!   run a development engine from `target`, which starts the helper built
//!   beside it, never with the switch.
//! - A stop never holds up the engine's own: it is asked for before the
//!   shutdown backup and waited for after it, until the grace and a margin
//!   have passed since it was asked for, so a helper that lingers is ended
//!   before the engine goes.
//!   Nothing written to the helper can block the supervisor: its stdin has a
//!   thread of its own.
//!
//! What it says reaches the page through `cameras/pictures.rs`, which reads
//! the status here: a change raises `cameras.changed { reason: "pictures" }`
//! and `app.changed { reason: "health" }`.
//!
//! The frames go from the helper to the shell and never through here. The
//! shell puts its frame listener's address and secret into this process's
//! environment; the engine takes them at its start, clears the secret from
//! its environment, and hands both to the helper on its stdin alone
//! (`link_from_environment`). It tells the helper which camera is selected,
//! which is sent big, and whether the Cameras page shows the pictures: the
//! page says so once a second (`cameras.pictures.showing`), and frames go
//! while it does and for `SHOWING_TAIL` after.

use crate::cameras::store::read_setup;
use crate::diagnostics::append_log;
use crate::engine_events::{emit_app_changed, emit_cameras_changed};
use crate::health::APP_CHANGED_REASON_HEALTH;
use crate::storage::open_connection;
use std::cell::Cell;
use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::development::{build_marked_in, development_build, MarkedBuild};
use studio_control_protocol::pictures::{
    from_line, is_link_secret, read_line_bounded, to_line, FromHelper, HelperProblem, HelperSource,
    LinkSecret, ReceivedCamera, ToHelper, WantedCamera, HELPER_PROGRAM, LINK_ADDRESS_ENV,
    LINK_SECRET_ENV, NDI_LIBRARY_ENV, VMIX_PICTURES_ENV,
};

/// A helper silent this long is ended and started again: five of its
/// seconds, so a helper below normal priority on a busy PC is not taken for
/// a hung one.
const SILENCE: Duration = Duration::from_secs(5);
const FIRST_RESTART_DELAY: Duration = Duration::from_secs(1);
const LONGEST_RESTART_DELAY: Duration = Duration::from_secs(30);
/// How long a stop waits for the helper to end by itself, before it ends
/// it.
const STOP_GRACE: Duration = Duration::from_secs(1);
/// The engine's stop waits this much past the grace for the end, so the
/// helper is ended before the engine goes; with the backup inside it, the
/// whole stop stays within the shell's two seconds.
const STOP_MARGIN: Duration = Duration::from_millis(300);
/// How often the supervisor looks, between lines.
const TICK: Duration = Duration::from_millis(250);
/// Frames go this long after the page last said it shows the pictures, so
/// a look at another page and back finds them at once.
const SHOWING_TAIL: Duration = Duration::from_secs(30);

/// What the helper is told of the cameras: each one's vMix input, and the
/// selected one, which is sent big.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Wanted {
    pub cameras: Vec<WantedCamera>,
    pub selected: u8,
}

/// The shell's frame listener for this start: its address and its secret.
pub struct Link {
    address: String,
    secret: LinkSecret,
}

/// Takes the frame listener's address and secret from this process's
/// environment, where the shell put them, and clears the secret from it:
/// the helper is told it on its stdin, and nothing else ever reads it. Called
/// while `main` is the only thread. `None` when the shell opened none (a
/// lane, a test, an engine started by hand).
pub fn link_from_environment() -> Option<Link> {
    let address = std::env::var(LINK_ADDRESS_ENV).ok();
    let secret = std::env::var(LINK_SECRET_ENV).ok();
    std::env::remove_var(LINK_SECRET_ENV);
    match (address, secret) {
        (Some(address), Some(secret)) if is_link_secret(&secret) => Some(Link {
            address,
            secret: LinkSecret(secret),
        }),
        _ => None,
    }
}

/// What the hardware link knows of the helper, for the pictures' words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HelperStatus {
    /// Started, and not heard from yet.
    Starting,
    /// It says what it receives.
    Running {
        sending: bool,
        /// Why it takes nothing at all, when it says so.
        problem: Option<HelperProblem>,
        cameras: Vec<ReceivedCamera>,
    },
    /// It ended, or went silent: it is started again.
    Restarting,
    /// Its program is not beside the engine's.
    Missing,
}

// ---------------------------------------------------------------------------
// The status, by saved data
// ---------------------------------------------------------------------------

/// What each supervisor says, by saved data (`db_path`), so parallel tests
/// with a database each never share one; and how to reach it.
#[derive(Default)]
struct Entry {
    /// The source the helper is told; the simulated one until a supervisor
    /// says otherwise.
    source: HelperSource,
    status: Option<HelperStatus>,
    to_supervisor: Option<Sender<Message>>,
}

static HELPERS: OnceLock<Mutex<HashMap<PathBuf, Entry>>> = OnceLock::new();

fn helpers() -> MutexGuard<'static, HashMap<PathBuf, Entry>> {
    HELPERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What the helper of this saved data is doing, for the tests; `None` when
/// no helper is supervised for it.
#[cfg(test)]
pub(crate) fn helper_status(db_path: &Path) -> Option<HelperStatus> {
    helpers()
        .get(db_path)
        .and_then(|entry| entry.status.clone())
}

/// The helper of this saved data: the source it is told, and what it is
/// doing; `None` when no helper is supervised for it (the engine's unit
/// tests, a studio build's trial start and lanes, a development engine
/// without the simulated cameras).
pub(crate) fn helper(db_path: &Path) -> Option<(HelperSource, HelperStatus)> {
    helpers()
        .get(db_path)
        .and_then(|entry| Some((entry.source, entry.status.clone()?)))
}

/// Takes a new status; a change is announced, the heartbeat's same status is
/// not.
fn set_status(db_path: &Path, status: HelperStatus) {
    let changed = {
        let mut helpers = helpers();
        let entry = helpers.entry(db_path.to_path_buf()).or_default();
        let changed = entry.status.as_ref() != Some(&status);
        entry.status = Some(status);
        changed
    };
    if changed {
        // Every camera's picture can move, and the Cameras lamp with them.
        emit_cameras_changed("pictures", None);
        emit_app_changed(APP_CHANGED_REASON_HEALTH);
    }
}

/// A vMix input or the selection changed (a request, a restore): the helper
/// hears them again. Nothing when no helper is supervised for this saved
/// data.
pub(crate) fn want(db_path: &Path, wanted: Wanted) {
    send(db_path, Message::Want(wanted));
}

/// The Cameras page shows the pictures now (`cameras.pictures.showing`).
pub(crate) fn showing(db_path: &Path) {
    send(db_path, Message::Showing);
}

fn send(db_path: &Path, message: Message) {
    let sender = helpers()
        .get(db_path)
        .and_then(|entry| entry.to_supervisor.clone());
    if let Some(sender) = sender {
        let _ = sender.send(message);
    }
}

/// A test's helper says `status` for its saved data (`None`: no helper).
#[cfg(test)]
pub(crate) fn set_status_for_test(db_path: &Path, status: Option<HelperStatus>) {
    let mut helpers = helpers();
    match status {
        Some(status) => helpers.entry(db_path.to_path_buf()).or_default().status = Some(status),
        None => {
            helpers.remove(db_path);
        }
    }
}

/// A test's helper is told vMix's pictures, and says `status`.
#[cfg(test)]
pub(crate) fn set_vmix_status_for_test(db_path: &Path, status: HelperStatus) {
    let mut helpers = helpers();
    let entry = helpers.entry(db_path.to_path_buf()).or_default();
    entry.source = HelperSource::Vmix;
    entry.status = Some(status);
}

// ---------------------------------------------------------------------------
// When to start and end it
// ---------------------------------------------------------------------------

/// The supervisor's times; the tests' are shorter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Times {
    silence: Duration,
    first_delay: Duration,
    longest_delay: Duration,
    showing_tail: Duration,
}

const TIMES: Times = Times {
    silence: SILENCE,
    first_delay: FIRST_RESTART_DELAY,
    longest_delay: LONGEST_RESTART_DELAY,
    showing_tail: SHOWING_TAIL,
};

/// What happened to the helper.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Happened {
    Started(Instant),
    /// Its program is not there.
    NotFound,
    /// It could not be started, or it ended.
    Ended(Instant),
    /// A line came.
    Heard(Instant),
    /// Time passed.
    Tick(Instant),
}

/// What the supervisor does about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Todo {
    Start,
    End,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// It runs: since when, and when it was last heard (or started).
    Running { started: Instant, heard: Instant },
    /// It ended; it is started again at `until`.
    Waiting { until: Instant },
    /// Its program is not there.
    Missing,
}

/// When to start the helper again and when to end it: the time is passed
/// in, so the tests never wait.
#[derive(Debug)]
struct Supervision {
    times: Times,
    phase: Option<Phase>,
    /// Ends in a row of helpers that did not stay up `longest_delay`.
    restarts: u32,
}

impl Supervision {
    fn new(times: Times) -> Self {
        Self {
            times,
            phase: None,
            restarts: 0,
        }
    }

    /// The wait before the next start: doubling, up to the longest.
    fn delay(&self) -> Duration {
        let doublings = self.restarts.min(16);
        self.times
            .first_delay
            .saturating_mul(1_u32 << doublings)
            .min(self.times.longest_delay)
    }

    fn take(&mut self, happened: Happened) -> Option<Todo> {
        match happened {
            Happened::Started(now) => {
                self.phase = Some(Phase::Running {
                    started: now,
                    heard: now,
                });
            }
            Happened::NotFound => self.phase = Some(Phase::Missing),
            Happened::Ended(now) => {
                self.phase = Some(Phase::Waiting {
                    until: now + self.delay(),
                });
                self.restarts = self.restarts.saturating_add(1);
            }
            Happened::Heard(now) => {
                if let Some(Phase::Running { started, heard }) = &mut self.phase {
                    *heard = now;
                    // Only a helper that stayed up clears the doubling: one
                    // that fails soon after its first line waits longer each
                    // time, as one that never speaks does.
                    if now.saturating_duration_since(*started) >= self.times.longest_delay {
                        self.restarts = 0;
                    }
                }
            }
            Happened::Tick(now) => {
                return match self.phase {
                    Some(Phase::Running { heard, .. })
                        if now.saturating_duration_since(heard) > self.times.silence =>
                    {
                        Some(Todo::End)
                    }
                    Some(Phase::Waiting { until }) if now >= until => Some(Todo::Start),
                    _ => None,
                };
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// The supervisor
// ---------------------------------------------------------------------------

/// What reaches the supervisor's thread.
enum Message {
    /// A line of the helper started as `generation`.
    Line(u64, String),
    /// That helper's stdout closed.
    Closed(u64),
    Want(Wanted),
    Showing,
    Stop,
}

/// How the helper is started: its program, and in the tests what stands in
/// for it.
#[derive(Debug, Clone, Default)]
struct Launch {
    program: PathBuf,
    args: Vec<String>,
    /// The build the program must be, as its mark says; `None` takes any
    /// program (the tests' stand-ins).
    own: Option<MarkedBuild<'static>>,
    /// Variables of the engine's environment the helper does not get.
    withheld: Vec<&'static str>,
}

/// Why `program` is not the helper of `own`'s build: another build kind, the
/// studio build of another commit, or no mark at all; `None` when it is.
fn own_helper(program: &Path, own: MarkedBuild<'_>) -> Option<String> {
    let file = match std::fs::read(program) {
        Ok(file) => file,
        Err(error) => return Some(format!("it could not be read ({error})")),
    };
    let helper = build_marked_in(&file);
    if helper == own {
        return None;
    }
    Some(match helper {
        MarkedBuild::Development => String::from("it is a development build's"),
        MarkedBuild::Studio(commit) => format!(
            "it is the studio build of {}",
            commit.get(..7).unwrap_or(commit)
        ),
        MarkedBuild::Unmarked => String::from("it carries no build's mark"),
        MarkedBuild::Conflicting => String::from("its marks say different builds"),
    })
}

/// The variables a helper does not get from the engine: in a studio build,
/// the development run's switch and library, which a studio helper never
/// reads either.
fn withheld(development_build: bool) -> Vec<&'static str> {
    if development_build {
        Vec::new()
    } else {
        vec![VMIX_PICTURES_ENV, NDI_LIBRARY_ENV]
    }
}

/// The running supervisor. `begin_stop` asks it to end the helper, and
/// `finish` waits for that, for a while at most; dropped, it is asked to
/// stop and not waited for.
pub struct PicturesHelper {
    db_path: PathBuf,
    to_supervisor: Sender<Message>,
    /// Hears when the supervisor has ended.
    ended: Receiver<()>,
    /// When the stop was asked for.
    stop_asked: Cell<Option<Instant>>,
}

impl PicturesHelper {
    /// Asks the supervisor to end the helper (its stdin closed, then ended
    /// if it lingers past `STOP_GRACE`) and to end itself. Nothing waits.
    pub fn begin_stop(&self) {
        if self.stop_asked.get().is_none() {
            self.stop_asked.set(Some(Instant::now()));
        }
        let _ = self.to_supervisor.send(Message::Stop);
    }

    /// Waits for the stop until `STOP_GRACE` and `STOP_MARGIN` after it was
    /// asked for: past the grace the supervisor ends a helper that lingers,
    /// so the helper is gone before the engine is. Whatever ran meanwhile
    /// (the shutdown backup) counts towards the wait.
    pub fn finish(self) {
        self.finish_within(STOP_MARGIN);
    }

    fn finish_within(self, margin: Duration) {
        self.begin_stop();
        let asked = self.stop_asked.get().unwrap_or_else(Instant::now);
        let deadline = asked + STOP_GRACE + margin;
        let _ = self
            .ended
            .recv_timeout(deadline.saturating_duration_since(Instant::now()));
        helpers().remove(&self.db_path);
    }

    /// `begin_stop` and `finish`, with time to spare on a slow test run.
    #[cfg(test)]
    pub(crate) fn stop(self) {
        self.finish_within(Duration::from_secs(10));
    }
}

impl Drop for PicturesHelper {
    fn drop(&mut self) {
        self.begin_stop();
    }
}

/// Which source a helper is started on, if one is started. A studio build
/// with the real cameras takes vMix's pictures (D34); one with the simulated
/// cameras (the release's trial start and lanes) starts none. A development
/// build starts one only with the simulated cameras: on vMix's pictures
/// when the build read `SSE_VMIX_PICTURES=1` (D33), on the test card
/// otherwise.
pub(crate) fn source_for(
    development_build: bool,
    cameras_simulated: bool,
    vmix_pictures: bool,
) -> Option<HelperSource> {
    match (development_build, cameras_simulated, vmix_pictures) {
        (false, false, _) => Some(HelperSource::Vmix),
        (false, true, _) => None,
        (true, true, true) => Some(HelperSource::Vmix),
        (true, true, false) => Some(HelperSource::Simulated),
        (true, false, _) => None,
    }
}

/// Starts the helper's supervisor where the build has a helper to start
/// (`source_for`). Elsewhere nothing starts.
pub fn spawn_pictures_helper(
    db_path: PathBuf,
    log_file_path: PathBuf,
    cameras_simulated: bool,
    vmix_pictures: bool,
    link: Option<Link>,
) -> Option<PicturesHelper> {
    let development = development_build();
    let source = source_for(development, cameras_simulated, vmix_pictures)?;
    let program = std::env::current_exe().ok()?.with_file_name(HELPER_PROGRAM);
    Some(start_supervisor(
        db_path,
        log_file_path,
        Launch {
            program,
            args: Vec::new(),
            own: Some(MarkedBuild::this_build()),
            withheld: withheld(development),
        },
        TIMES,
        source,
        link,
    ))
}

fn start_supervisor(
    db_path: PathBuf,
    log_file_path: PathBuf,
    launch: Launch,
    times: Times,
    source: HelperSource,
    link: Option<Link>,
) -> PicturesHelper {
    let (to_supervisor, messages) = mpsc::channel();
    let (say_ended, ended) = mpsc::channel();
    {
        let mut helpers = helpers();
        let entry = helpers.entry(db_path.clone()).or_default();
        entry.source = source;
        entry.to_supervisor = Some(to_supervisor.clone());
    }
    if source == HelperSource::Vmix {
        let _ = append_log(
            &log_file_path,
            "INFO",
            if development_build() {
                "The pictures helper is told to take vMix's Outputs 2, 3 and 4 over NDI (npm run app -- --vmix-pictures): a hardware test the owner attends."
            } else {
                "The pictures helper is told to take vMix's Outputs 2, 3 and 4 over NDI, with the library beside it."
            },
        );
    }
    {
        let db_path = db_path.clone();
        let to_supervisor = to_supervisor.clone();
        let _ = thread::Builder::new()
            .name(String::from("pictures-helper"))
            .spawn(move || {
                Supervisor {
                    db_path,
                    log_file_path,
                    launch,
                    source,
                    supervision: Supervision::new(times),
                    to_supervisor,
                    wanted: Wanted {
                        cameras: Vec::new(),
                        selected: 1,
                    },
                    showing_until: None,
                    link,
                    running: None,
                    generation: 0,
                }
                .run(&messages);
                let _ = say_ended.send(());
            });
    }
    PicturesHelper {
        db_path,
        to_supervisor,
        ended,
        stop_asked: Cell::new(None),
    }
}

/// The helper while it runs.
struct Running {
    child: Child,
    /// Lines for its stdin, which a thread of its own writes: a helper that
    /// stops reading blocks that thread, never the supervisor. `None` once a
    /// stop closed it.
    to_stdin: Option<Sender<String>>,
    generation: u64,
}

/// Writes the lines it is handed to the helper's stdin, until the sender is
/// dropped (the stdin then closes) or a write fails (the helper is ending).
fn spawn_stdin_writer(mut stdin: ChildStdin) -> Option<Sender<String>> {
    let (sender, lines) = mpsc::channel::<String>();
    thread::Builder::new()
        .name(String::from("pictures-helper-stdin"))
        .spawn(move || {
            for line in lines {
                if writeln!(stdin, "{line}")
                    .and_then(|()| stdin.flush())
                    .is_err()
                {
                    return;
                }
            }
        })
        .ok()?;
    Some(sender)
}

struct Supervisor {
    db_path: PathBuf,
    log_file_path: PathBuf,
    launch: Launch,
    /// Where the helper's pictures come from, for the helper's whole life.
    source: HelperSource,
    supervision: Supervision,
    to_supervisor: Sender<Message>,
    /// What the helper is told at every start and every change.
    wanted: Wanted,
    /// Until when frames are wanted: the page's last word and the tail.
    showing_until: Option<Instant>,
    link: Option<Link>,
    running: Option<Running>,
    generation: u64,
}

impl Supervisor {
    fn run(mut self, messages: &Receiver<Message>) {
        self.wanted = self.saved_inputs();
        self.start();
        loop {
            match messages.recv_timeout(TICK) {
                Ok(Message::Line(generation, line)) if self.is_current(generation) => {
                    self.hear(&line);
                }
                Ok(Message::Closed(generation)) if self.is_current(generation) => {
                    self.end("its output closed");
                }
                Ok(Message::Line(..) | Message::Closed(_)) => {}
                Ok(Message::Want(wanted)) => {
                    self.wanted = wanted;
                    self.tell();
                }
                Ok(Message::Showing) => {
                    let was = self.showing();
                    self.showing_until = Some(Instant::now() + self.supervision.times.showing_tail);
                    if !was {
                        self.tell();
                    }
                }
                Ok(Message::Stop) | Err(RecvTimeoutError::Disconnected) => {
                    // (Disconnected cannot come while this thread holds a
                    // sender of its own; `Stop` is how it ends.)
                    self.stop();
                    return;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
            let exited = self
                .running
                .as_mut()
                .is_some_and(|running| matches!(running.child.try_wait(), Ok(Some(_)) | Err(_)));
            if exited {
                self.end("it ended");
            }
            if self
                .showing_until
                .is_some_and(|until| Instant::now() >= until)
            {
                self.showing_until = None;
                self.tell();
            }
            match self.supervision.take(Happened::Tick(Instant::now())) {
                Some(Todo::End) => self.end("it was silent too long"),
                Some(Todo::Start) => self.start(),
                None => {}
            }
        }
    }

    fn is_current(&self, generation: u64) -> bool {
        self.running
            .as_ref()
            .is_some_and(|running| running.generation == generation)
    }

    /// Each camera's vMix input as the saved data holds it, CAM 1 selected,
    /// as after a start (D19). A read that fails is logged, and the helper
    /// is told of no camera until an input changes: none of the three is
    /// said to have a picture meanwhile.
    fn saved_inputs(&self) -> Wanted {
        let rows = open_connection(&self.db_path)
            .map_err(|error| error.to_string())
            .and_then(|connection| read_setup(&connection).map_err(|error| error.to_string()));
        let cameras = match rows {
            Ok(rows) => rows
                .iter()
                .map(|row| WantedCamera {
                    camera: row.camera,
                    vmix_input: row.vmix_input,
                })
                .collect(),
            Err(error) => {
                self.log(
                    "WARN",
                    &format!("The cameras' vMix inputs could not be read for the pictures helper: {error}"),
                );
                Vec::new()
            }
        };
        Wanted {
            cameras,
            selected: 1,
        }
    }

    fn showing(&self) -> bool {
        self.showing_until
            .is_some_and(|until| Instant::now() < until)
    }

    fn log(&self, level: &str, message: &str) {
        let _ = append_log(&self.log_file_path, level, message);
    }

    fn start(&mut self) {
        let refused = if self.launch.program.is_file() {
            self.launch
                .own
                .and_then(|own| own_helper(&self.launch.program, own))
                .map(|why| {
                    format!(
                        "The pictures helper beside the hardware link is not this build's own ({}): {why}. No pictures.",
                        self.launch.program.display()
                    )
                })
        } else {
            Some(format!(
                "The pictures helper is not beside the hardware link ({}): no pictures.",
                self.launch.program.display()
            ))
        };
        if let Some(why) = refused {
            self.supervision.take(Happened::NotFound);
            self.log("WARN", &why);
            set_status(&self.db_path, HelperStatus::Missing);
            return;
        }
        let mut command = Command::new(&self.launch.program);
        for name in &self.launch.withheld {
            command.env_remove(name);
        }
        command
            .args(&self.launch.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        {
            use std::os::windows::process::CommandExt;
            // No console window of its own, and below normal priority: the
            // PC serves vMix first.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
            command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.log(
                    "WARN",
                    &format!("The pictures helper did not start: {error}"),
                );
                self.supervision.take(Happened::Ended(Instant::now()));
                set_status(&self.db_path, HelperStatus::Restarting);
                return;
            }
        };
        self.generation += 1;
        let generation = self.generation;
        if let Some(stdout) = child.stdout.take() {
            spawn_line_reader(stdout, {
                let to_supervisor = self.to_supervisor.clone();
                move |line| match line {
                    Some(line) => to_supervisor.send(Message::Line(generation, line)).is_ok(),
                    None => {
                        let _ = to_supervisor.send(Message::Closed(generation));
                        false
                    }
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let log_file_path = self.log_file_path.clone();
            spawn_line_reader(stderr, move |line| {
                if let Some(line) = line {
                    let _ = append_log(&log_file_path, "INFO", &format!("Pictures helper: {line}"));
                    true
                } else {
                    false
                }
            });
        }
        self.log(
            "INFO",
            &format!("The pictures helper started (process {}).", child.id()),
        );
        let to_stdin = child.stdin.take().and_then(spawn_stdin_writer);
        self.running = Some(Running {
            child,
            to_stdin,
            generation,
        });
        self.supervision.take(Happened::Started(Instant::now()));
        set_status(&self.db_path, HelperStatus::Starting);
        if let Some(link) = &self.link {
            let line = to_line(&ToHelper::Link {
                address: link.address.clone(),
                secret: link.secret.clone(),
            });
            self.write(line);
        }
        self.tell();
    }

    /// Tells the running helper the cameras wanted, whether the pictures
    /// show, and where they come from.
    fn tell(&mut self) {
        let line = to_line(&ToHelper::Want {
            cameras: self.wanted.cameras.clone(),
            selected: self.wanted.selected,
            showing: self.showing(),
            source: self.source,
        });
        self.write(line);
    }

    /// One line to the running helper. Never logged: a link's line holds
    /// the secret.
    fn write(&mut self, line: String) {
        if let Some(to_stdin) = self
            .running
            .as_ref()
            .and_then(|running| running.to_stdin.as_ref())
        {
            // A helper that cannot be written to is ending: its end is seen.
            let _ = to_stdin.send(line);
        }
    }

    fn hear(&mut self, line: &str) {
        match from_line::<FromHelper>(line) {
            Ok(FromHelper::State {
                sending,
                problem,
                cameras,
                ..
            }) => {
                self.supervision.take(Happened::Heard(Instant::now()));
                set_status(
                    &self.db_path,
                    HelperStatus::Running {
                        sending,
                        problem,
                        cameras,
                    },
                );
            }
            Err(why) => self.log(
                "WARN",
                &format!("The pictures helper said something unreadable: {why}"),
            ),
        }
    }

    /// Ends the running helper and waits before the next start.
    fn end(&mut self, why: &str) {
        let Some(mut running) = self.running.take() else {
            return;
        };
        let _ = running.child.kill();
        let status = running.child.wait();
        let delay = self.supervision.delay();
        self.supervision.take(Happened::Ended(Instant::now()));
        self.log(
            "WARN",
            &format!(
                "The pictures helper stopped ({why}; {}): it is started again in {} s.",
                status
                    .map(|status| status.to_string())
                    .unwrap_or_else(|error| error.to_string()),
                delay.as_secs_f32()
            ),
        );
        set_status(&self.db_path, HelperStatus::Restarting);
    }

    /// Closes the helper's stdin, waits for it to end, and ends it if it
    /// lingers.
    fn stop(&mut self) {
        let Some(mut running) = self.running.take() else {
            return;
        };
        drop(running.to_stdin.take());
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if matches!(running.child.try_wait(), Ok(Some(_)) | Err(_)) {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

/// Reads bounded lines off `input` on a thread of its own and hands each to
/// `take` (`None` at the end), until `take` says to stop.
fn spawn_line_reader(
    input: impl Read + Send + 'static,
    mut take: impl FnMut(Option<String>) -> bool + Send + 'static,
) {
    let _ = thread::Builder::new()
        .name(String::from("pictures-helper-lines"))
        .spawn(move || {
            let mut reader = BufReader::new(input);
            loop {
                let line = match read_line_bounded(&mut reader) {
                    Ok(Some(Ok(line))) => Some(line),
                    Ok(Some(Err(length))) => Some(format!("(a line of {length} bytes, too long)")),
                    Ok(None) | Err(_) => None,
                };
                let more = line.is_some();
                if !take(line) || !more {
                    return;
                }
            }
        });
}

#[cfg(test)]
mod tests;
