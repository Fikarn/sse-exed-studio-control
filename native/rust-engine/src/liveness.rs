//! The hardware link's long-lived threads, watched (the audit of 2026-10-12,
//! finding H2). Until then a thread that panicked ended in silence: the
//! default hook wrote to stderr (the shell keeps it in `shell.log`), the
//! thread's health entry kept its last word, and a dark rig could sit under
//! a green `Lighting` lamp.
//!
//! Three things, each small:
//!
//! - [`install_panic_hook`] writes every panic to `engine.log` at ERROR, with
//!   the thread's name and the place, and then lets the default hook have it.
//! - [`spawn_watched`] starts a thread under `catch_unwind`. A panic, or the
//!   end of a thread meant to live as long as the hardware link, becomes a
//!   problem on its subsystem's health entry (`health::thread_problem`): the
//!   entry reads `error`, Setup / Support's summary names it, and the lamp
//!   that reads the entry follows (`Lighting` reads `no output` when the
//!   lighting output stopped). An end after [`mark_stopping`] is the stop's,
//!   and no fault.
//! - A thread with a loop beats once a pass ([`Beat::beat`]).
//!   [`spawn_stall_watch`] looks once a second: a beat older than the
//!   thread's allowance is a stall, reported the same way and cleared when
//!   the thread beats again. A thread that waits on a socket or sleeps a day
//!   has no allowance and is watched for its end only.
//!
//! The sentence the operator reads names the job and the way out, never the
//! panic's text, which carries the developer's words; the log has it. The
//! problem is keyed by the thread's name, so two threads of one subsystem
//! never clear each other's.

use crate::diagnostics::{log_event, log_event_without_waiting, LogLevel};
use crate::health;
use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe, PanicHookInfo};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Once, OnceLock, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// How often the stall watch looks.
const LOOK_EVERY: Duration = Duration::from_secs(1);

/// How long a thread may live.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lifetime {
    /// As long as the hardware link: an end before the stop is a fault.
    Process,
    /// Until its job is done: only a panic is a fault.
    Task,
}

/// What a watched thread is.
pub(crate) struct Spec {
    /// The job, as the operator reads it after "The hardware link's":
    /// "lighting output".
    pub(crate) job: &'static str,
    /// The thread's name, as the log reads it: "sacn-output".
    pub(crate) name: String,
    /// The health entry a fault goes to.
    pub(crate) subsystem: &'static str,
    /// How long a loop may go without a beat; `None` for a thread that
    /// cannot beat (it waits on a socket, or sleeps a day).
    pub(crate) allowance: Option<Duration>,
    pub(crate) lifetime: Lifetime,
}

/// What the watch knows of a thread beyond its beats, under one lock, so a
/// look and the thread's end never cross: a look at a thread that is gone
/// finds it gone, and never reports a stall nobody can clear.
#[derive(Default)]
struct Flags {
    gone: bool,
    stalled: bool,
    /// Milliseconds since the first look at the clock, when the stall began.
    stalled_since_ms: u64,
}

/// One thread as the watch sees it.
pub(crate) struct Watched {
    spec: Spec,
    /// Milliseconds since the first look at the clock, at the last beat.
    last_beat_ms: AtomicU64,
    flags: Mutex<Flags>,
}

/// What went wrong with a thread.
enum Problem<'a> {
    Panicked(&'a str),
    Ended,
    NotStarted(&'a str),
    Stalled { secs: u64 },
}

impl Watched {
    fn new(spec: Spec, now_ms: u64) -> Self {
        Self {
            spec,
            last_beat_ms: AtomicU64::new(now_ms),
            flags: Mutex::new(Flags::default()),
        }
    }

    fn beat_at(&self, now_ms: u64) {
        self.last_beat_ms.store(now_ms, Ordering::Relaxed);
    }

    fn flags(&self) -> MutexGuard<'_, Flags> {
        self.flags.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The sentence the operator reads in Setup / Support's summary: the job
    /// and the way out. The panic's text stays in the log.
    fn detail(&self, problem: &Problem<'_>) -> String {
        let job = self.spec.job;
        match problem {
            Problem::Panicked(_) | Problem::Ended => format!(
                "The hardware link's {job} stopped. Restart the hardware link in Setup / Support."
            ),
            Problem::NotStarted(_) => format!(
                "The hardware link's {job} did not start. Restart the hardware link in Setup / Support."
            ),
            Problem::Stalled { secs } => format!(
                "The hardware link's {job} has not run for {secs} s. Restart the hardware link in Setup / Support if it does not come back."
            ),
        }
    }

    /// The log's line.
    fn log_line(&self, problem: &Problem<'_>) -> String {
        let name = &self.spec.name;
        match problem {
            Problem::Panicked(message) => {
                format!("The {name} thread stopped on a panic: {message}.")
            }
            Problem::Ended => format!(
                "The {name} thread ended, though it was to run as long as the hardware link."
            ),
            Problem::NotStarted(error) => {
                format!("The {name} thread could not be started: {error}.")
            }
            Problem::Stalled { secs } => format!("The {name} thread has not run for {secs} s."),
        }
    }

    fn report(&self, problem: &Problem<'_>) {
        log_event(LogLevel::Error, &self.log_line(problem));
        health::thread_problem(&self.spec.name, self.spec.subsystem, self.detail(problem));
    }

    /// The thread ended, well (`panic` is `None`) or on a panic, said under
    /// the flags so a look at the same moment finds it gone. An end at the
    /// stop (`stopping`) is nobody's fault; a stall it had is cleared.
    fn ended(&self, panic: Option<&str>, stopping: bool) {
        let mut flags = self.flags();
        flags.gone = true;
        let was_stalled = std::mem::take(&mut flags.stalled);
        match panic {
            Some(message) => self.report(&Problem::Panicked(message)),
            None if self.spec.lifetime == Lifetime::Process && !stopping => {
                self.report(&Problem::Ended);
            }
            None => {
                if self.spec.lifetime == Lifetime::Process {
                    log_event(
                        LogLevel::Info,
                        &format!("The {} thread ended at the stop.", self.spec.name),
                    );
                }
                if was_stalled {
                    health::thread_problem_cleared(&self.spec.name);
                }
            }
        }
    }
}

/// A handle a watched loop beats with, once a pass.
#[derive(Clone)]
pub(crate) struct Beat(Arc<Watched>);

impl Beat {
    pub(crate) fn beat(&self) {
        self.0.beat_at(now_ms());
    }
}

static WATCHED: OnceLock<Mutex<Vec<Arc<Watched>>>> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();
/// Set once the requests have ended: the stop is under way, and a thread
/// that ends now ends with the hardware link.
static STOPPING: AtomicBool = AtomicBool::new(false);

fn watched() -> &'static Mutex<Vec<Arc<Watched>>> {
    WATCHED.get_or_init(|| Mutex::new(Vec::new()))
}

fn now_ms() -> u64 {
    u64::try_from(START.get_or_init(Instant::now).elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// The stop is under way: from here on a thread's end is the stop's, not a
/// fault. `main.rs` says so once the requests have ended.
pub(crate) fn mark_stopping() {
    STOPPING.store(true, Ordering::Relaxed);
}

fn stopping() -> bool {
    STOPPING.load(Ordering::Relaxed)
}

/// Starts `body` on a named thread and watches it: a panic, and for a
/// [`Lifetime::Process`] thread an end before the stop, is reported on
/// `spec.subsystem`'s health entry and in the log. The thread is handed its
/// [`Beat`]; a loop beats once a pass, a thread without an allowance may
/// ignore it. `None` when the thread could not be started, which is reported
/// the same way.
pub(crate) fn spawn_watched(
    spec: Spec,
    body: impl FnOnce(Beat) + Send + 'static,
) -> Option<JoinHandle<()>> {
    let watched_thread = Arc::new(Watched::new(spec, now_ms()));
    watched()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(Arc::clone(&watched_thread));
    let inside = Arc::clone(&watched_thread);
    let spawned = thread::Builder::new()
        .name(watched_thread.spec.name.clone())
        .spawn(move || {
            let outcome = catch_unwind(AssertUnwindSafe(|| body(Beat(Arc::clone(&inside)))));
            let panic = outcome.err().map(|payload| panic_message(payload.as_ref()));
            inside.ended(panic.as_deref(), stopping());
        });
    match spawned {
        Ok(handle) => Some(handle),
        Err(error) => {
            watched_thread.flags().gone = true;
            watched_thread.report(&Problem::NotStarted(&error.to_string()));
            None
        }
    }
}

/// The message a panic carried: a `&str` or a `String`, else a word for it.
fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return String::from(*message);
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    String::from("no message")
}

/// A change the stall watch found on one look.
enum Change {
    Stalled { thread: Arc<Watched>, secs: u64 },
    RunsAgain { thread: Arc<Watched>, secs: u64 },
}

impl Change {
    fn apply(&self) {
        match self {
            Change::Stalled { thread, secs } => thread.report(&Problem::Stalled { secs: *secs }),
            Change::RunsAgain { thread, secs } => {
                log_event(
                    LogLevel::Info,
                    &format!(
                        "The {} thread runs again, after {secs} s.",
                        thread.spec.name
                    ),
                );
                health::thread_problem_cleared(&thread.spec.name);
            }
        }
    }
}

/// One look at the threads with an allowance that still run: a beat older
/// than the allowance begins a stall, a beat after one ends it. Each thread's
/// flags move, and `found` is called, under that thread's lock, so its end
/// cannot slip in between and leave a stall nobody clears.
fn look(threads: &[Arc<Watched>], now_ms: u64, found: &mut dyn FnMut(Change)) {
    for thread in threads {
        let Some(allowance) = thread.spec.allowance else {
            continue;
        };
        let mut flags = thread.flags();
        if flags.gone {
            continue;
        }
        let last_beat = thread.last_beat_ms.load(Ordering::Relaxed);
        let age_ms = now_ms.saturating_sub(last_beat);
        let allowance_ms = u64::try_from(allowance.as_millis()).unwrap_or(u64::MAX);
        let stalled_now = age_ms > allowance_ms;
        match (flags.stalled, stalled_now) {
            (false, true) => {
                flags.stalled = true;
                flags.stalled_since_ms = last_beat;
                found(Change::Stalled {
                    thread: Arc::clone(thread),
                    secs: age_ms / 1_000,
                });
            }
            (true, false) => {
                flags.stalled = false;
                found(Change::RunsAgain {
                    thread: Arc::clone(thread),
                    secs: now_ms.saturating_sub(flags.stalled_since_ms) / 1_000,
                });
            }
            _ => {}
        }
    }
}

/// Starts the watch over the watched threads' beats, once a second.
pub(crate) fn spawn_stall_watch() {
    let _ = thread::Builder::new()
        .name(String::from("liveness-watch"))
        .spawn(|| loop {
            thread::sleep(LOOK_EVERY);
            let threads: Vec<Arc<Watched>> = watched()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            look(&threads, now_ms(), &mut |change| change.apply());
        });
}

static HOOK: Once = Once::new();

/// The log's line for a panic: the thread, the place and the message.
fn panic_line(thread: Option<&str>, location: Option<(&str, u32)>, message: &str) -> String {
    let thread = thread.unwrap_or("an unnamed thread");
    match location {
        Some((file, line)) => format!("The {thread} thread panicked at {file}:{line}: {message}"),
        None => format!("The {thread} thread panicked: {message}"),
    }
}

fn hook_message(info: &PanicHookInfo<'_>) -> String {
    info.payload_as_str()
        .map(String::from)
        .unwrap_or_else(|| String::from("no message"))
}

/// Writes every panic to the log, then lets the hook that was there (the
/// default, which writes to stderr) have it. The line is written without
/// waiting for the log's lock: a panic inside the writer itself would
/// otherwise wait on this thread's own lock.
pub(crate) fn install_panic_hook() {
    HOOK.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let thread = thread::current();
            let line = panic_line(
                thread.name(),
                info.location()
                    .map(|location| (location.file(), location.line())),
                &hook_message(info),
            );
            log_event_without_waiting(LogLevel::Error, &line);
            previous(info);
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::operator_words::assert_operator_words;

    fn spec(name: &str, lifetime: Lifetime, allowance: Option<Duration>) -> Spec {
        Spec {
            job: "test's job",
            name: String::from(name),
            subsystem: "liveness-test",
            allowance,
            lifetime,
        }
    }

    fn changes_at(threads: &[Arc<Watched>], now_ms: u64) -> Vec<Change> {
        let mut changes = Vec::new();
        look(threads, now_ms, &mut |change| changes.push(change));
        changes
    }

    // A panic on a watched thread is a problem on its subsystem's entry, with
    // the job and the way out and not the panic's text; a task that ends is
    // none; a process thread that ends is one. The registry is process-wide,
    // so each problem is cleared at the end: the other tests read the
    // summary's tail.
    #[test]
    fn a_panic_or_an_untimely_end_is_a_problem_on_the_entry() {
        install_panic_hook();
        let panicked = spawn_watched(spec("liveness-test-panic", Lifetime::Task, None), |_beat| {
            panic!("the test's panic")
        })
        .expect("the thread starts");
        let _ = panicked.join();
        let problems = health::registry_problems();
        let problem = &problems["liveness-test-panic"];
        assert_eq!(problem.subsystem, "liveness-test");
        assert_eq!(
            problem.detail,
            "The hardware link's test's job stopped. Restart the hardware link in Setup / Support."
        );
        health::thread_problem_cleared("liveness-test-panic");

        let task = spawn_watched(spec("liveness-test-task", Lifetime::Task, None), |_beat| {})
            .expect("the thread starts");
        let _ = task.join();
        assert!(!health::registry_problems().contains_key("liveness-test-task"));

        let process = spawn_watched(
            spec("liveness-test-process", Lifetime::Process, None),
            |_beat| {},
        )
        .expect("the thread starts");
        let _ = process.join();
        assert_eq!(
            health::registry_problems()["liveness-test-process"].detail,
            "The hardware link's test's job stopped. Restart the hardware link in Setup / Support."
        );
        health::thread_problem_cleared("liveness-test-process");
        assert!(!health::registry_problems().contains_key("liveness-test-process"));
    }

    // At the stop a process thread's end is the stop's: no problem, and a
    // stall it had is cleared with it.
    #[test]
    fn an_end_at_the_stop_is_no_fault() {
        let thread = Arc::new(Watched::new(
            spec(
                "liveness-test-stop",
                Lifetime::Process,
                Some(Duration::from_secs(1)),
            ),
            0,
        ));
        for change in changes_at(std::slice::from_ref(&thread), 5_000) {
            change.apply();
        }
        assert!(health::registry_problems().contains_key("liveness-test-stop"));
        thread.ended(None, true);
        assert!(!health::registry_problems().contains_key("liveness-test-stop"));
        assert!(thread.flags().gone && !thread.flags().stalled);
        assert!(
            changes_at(std::slice::from_ref(&thread), 20_000).is_empty(),
            "a thread that is gone is never a stall"
        );
    }

    // A beat older than the allowance is a stall, said once; a beat after it
    // ends the stall, said once; a thread without an allowance is never one.
    #[test]
    fn a_stall_begins_at_the_allowance_and_ends_at_the_next_beat() {
        let slow = Arc::new(Watched::new(
            spec(
                "liveness-test-slow",
                Lifetime::Process,
                Some(Duration::from_secs(1)),
            ),
            0,
        ));
        let silent = Arc::new(Watched::new(
            spec("liveness-test-silent", Lifetime::Process, None),
            0,
        ));
        let threads = vec![Arc::clone(&slow), Arc::clone(&silent)];

        assert!(
            changes_at(&threads, 1_000).is_empty(),
            "the allowance itself is not a stall"
        );
        let changes = changes_at(&threads, 2_500);
        assert_eq!(changes.len(), 1);
        assert!(matches!(
            &changes[0],
            Change::Stalled { thread, secs: 2 } if thread.spec.name == "liveness-test-slow"
        ));
        assert!(
            changes_at(&threads, 3_000).is_empty(),
            "a stall is said once"
        );

        slow.beat_at(3_100);
        let changes = changes_at(&threads, 3_200);
        assert_eq!(changes.len(), 1);
        assert!(matches!(
            &changes[0],
            Change::RunsAgain { thread, secs: 3 } if thread.spec.name == "liveness-test-slow"
        ));
        assert!(changes_at(&threads, 3_300).is_empty());
    }

    // The two changes reach the health registry: a stall as a problem, the
    // return as its clearing.
    #[test]
    fn a_stall_is_a_problem_until_the_thread_runs_again() {
        let thread = Arc::new(Watched::new(
            spec(
                "liveness-test-stall",
                Lifetime::Process,
                Some(Duration::from_secs(1)),
            ),
            0,
        ));
        Change::Stalled {
            thread: Arc::clone(&thread),
            secs: 12,
        }
        .apply();
        assert_eq!(
            health::registry_problems()["liveness-test-stall"].detail,
            "The hardware link's test's job has not run for 12 s. Restart the hardware link in Setup / Support if it does not come back."
        );
        Change::RunsAgain { thread, secs: 13 }.apply();
        assert!(!health::registry_problems().contains_key("liveness-test-stall"));
    }

    #[test]
    fn the_panic_line_names_the_thread_and_the_place() {
        assert_eq!(
            panic_line(
                Some("sacn-output"),
                Some(("src/lighting_sacn_output.rs", 212)),
                "index out of bounds"
            ),
            "The sacn-output thread panicked at src/lighting_sacn_output.rs:212: index out of bounds"
        );
        assert_eq!(
            panic_line(None, None, "no message"),
            "The an unnamed thread thread panicked: no message"
        );
        assert_eq!(panic_message(&"a str"), "a str");
        assert_eq!(panic_message(&String::from("a string")), "a string");
        assert_eq!(panic_message(&42_u8), "no message");
    }

    // The sentences the operator reads hold the words rule, whatever the
    // panic said: its text is the log's alone.
    #[test]
    fn the_operator_sentences_hold_the_words_rule() {
        let thread = Watched::new(
            Spec {
                job: "lighting output",
                name: String::from("sacn-output"),
                subsystem: health::SUBSYSTEM_SACN,
                allowance: None,
                lifetime: Lifetime::Process,
            },
            0,
        );
        for problem in [
            Problem::Panicked("called `Option::unwrap()` on a `None` value, serde_json, a mutex"),
            Problem::Ended,
            Problem::NotStarted("too many threads"),
            Problem::Stalled { secs: 10 },
        ] {
            assert_operator_words(&thread.detail(&problem));
        }
        assert!(thread
            .log_line(&Problem::Panicked("index out of bounds"))
            .contains("index out of bounds"));
    }
}
