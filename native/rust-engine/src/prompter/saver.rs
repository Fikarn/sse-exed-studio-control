//! The prompter's saver (2026-10-02, after the afternoon recording): the one
//! writer, while Studio Control runs, of the glass script's place and pace and
//! of the prompter's look, size and look revision. The take's controls, the
//! Stream Deck's keys and the clock hand it the newest values under the
//! prompter's lock and go on at once; a thread of its own writes them on a
//! connection of its own, about once a second while the text scrolls and at
//! once at a pause, `END` or a key's jump. A slow disk (vMix writing a
//! recording to the same drive) then never holds the prompter, the deck or
//! the clock: a flush that took half a second used to stall every one of them
//! and send the glass a late, jumping anchor.
//!
//! The order of the writes is SQLite's. A place and pace land only while the
//! glass still shows the script at the revision they were taken at
//! (`store::write_glass_save`); putting a script on, replacing, updating and
//! clearing move that revision on in the transaction in which they write the
//! places themselves, so a save taken before them is refused, whichever
//! reaches the disk first. Nothing else writes the glass script's place or
//! pace, and only the prompter's memory changes the look while it runs.
//!
//! The newest hand-off always replaces what waits. A value is not written
//! again when it equals the one last written, judged when a write begins,
//! never at the hand-off: a dial turned forward and back while a write is on
//! its way must still end with the place it came back to.
//!
//! Without its thread (the tests, unless they start one, and a start that
//! could not make one) a save is written at once on the caller's thread, as
//! every save was before.

use crate::diagnostics::{log_event, LogLevel};
use crate::prompter::clock::PrompterPlace;
use crate::prompter::look::PrompterLook;
use crate::prompter::store;
use crate::storage::{open_connection, EngineResult};
use rusqlite::Connection;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// A save that is not urgent is written this long after the last write at
/// the latest: the place while the text scrolls, the pace, the size.
pub(crate) const COALESCE_FOR: Duration = Duration::from_secs(1);
/// A detent of the position or paragraph dial is written this long after it,
/// so a spin of the dial is a few writes, not one a detent.
pub(crate) const DIAL_SETTLES_IN: Duration = Duration::from_millis(250);
/// After a write that failed the next waits this long, doubling up to
/// `RETRY_AT_MOST`.
const RETRY_AFTER: Duration = Duration::from_secs(1);
const RETRY_AT_MOST: Duration = Duration::from_secs(5);
/// A disk that keeps failing writes one `WARN` line a minute, not one a try.
const WARN_EVERY: Duration = Duration::from_secs(60);
/// The thread's longest sleep with nothing to write.
const IDLE_WAIT: Duration = Duration::from_secs(60);

/// How soon a save must reach the disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Urgency {
    /// Within `COALESCE_FOR` of the last write.
    Coalesced,
    /// `DIAL_SETTLES_IN` after the hand-off: the position and paragraph dials.
    Shortly,
    /// At once: a pause, `END`, a key's jump, a restore, a stop.
    Now,
}

/// The glass script's place and pace, with the glass's revision they were
/// taken at; the place counts in the glass's text.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GlassSave {
    pub script_id: String,
    pub glass_revision: i64,
    pub place: PrompterPlace,
    pub speed_wpm: u32,
}

/// The look, the take's size and the look's revision, written whole.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LookSave {
    pub look: PrompterLook,
    pub size_px: u32,
    pub look_revision: i64,
}

/// What the saver did since it was last asked, for the prompter's minute
/// line.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct SaverCounts {
    /// Writes that reached the disk.
    pub saved: u64,
    /// Places the glass had moved past: a put-on, an Update or a clear came
    /// first.
    pub refused: u64,
    pub failed: u64,
    /// The longest write.
    pub longest: Duration,
}

struct Slot<T> {
    /// The newest value not yet written, and when it is due.
    pending: Option<(T, Instant)>,
    /// The pending value is the one a write on its way took. A newer value
    /// that takes its place does not inherit its due (the review of #287:
    /// while the disk was slow every hand-off was due at once, and the saver
    /// wrote back to back instead of once a second).
    taken: bool,
    /// The value last written, so an equal one is not written again.
    written: Option<T>,
}

impl<T> Slot<T> {
    /// `value` waits, due at `due` or at the waiting value's due when that
    /// is sooner and not yet taken.
    fn hand_over(&mut self, value: T, due: Instant) {
        let due = match &self.pending {
            Some((_, earlier)) if !self.taken => due.min(*earlier),
            _ => due,
        };
        self.pending = Some((value, due));
        self.taken = false;
    }
}

impl<T> Default for Slot<T> {
    fn default() -> Self {
        Self {
            pending: None,
            taken: false,
            written: None,
        }
    }
}

#[derive(Default)]
struct State {
    glass: Slot<GlassSave>,
    look: Slot<LookSave>,
    /// The thread runs and writes; otherwise a save is written at the
    /// hand-off.
    threaded: bool,
    /// A write is on its way.
    writing: bool,
    /// The stop was asked for: everything pending is written, then the
    /// thread closes its connection and ends. Hand-offs from here on are
    /// ignored.
    stopping: bool,
    stopped: bool,
    /// When the last write began: a coalesced save waits a second from it.
    last_write_at: Option<Instant>,
    retry_at: Option<Instant>,
    failures: u32,
    warned_at: Option<Instant>,
    counts: SaverCounts,
}

/// What one write takes.
#[derive(Debug, Clone)]
struct Batch {
    glass: Option<GlassSave>,
    look: Option<LookSave>,
}

pub(crate) struct Saver {
    db_path: PathBuf,
    state: Mutex<State>,
    changed: Condvar,
}

impl Saver {
    pub(crate) fn new(db_path: &Path) -> Self {
        Self {
            db_path: db_path.to_path_buf(),
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
        }
    }

    /// The saver's own lock: a leaf, never held while another lock is taken,
    /// and never across a write while the thread runs.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Starts the thread that writes. True when it runs.
    pub(crate) fn start(self: &Arc<Self>) -> bool {
        let mut state = self.lock();
        if state.threaded || state.stopped {
            return state.threaded;
        }
        let saver = Arc::clone(self);
        match thread::Builder::new()
            .name(String::from("prompter-saver"))
            .spawn(move || saver.run())
        {
            Ok(_) => {
                state.threaded = true;
                true
            }
            Err(error) => {
                drop(state);
                log_event(
                    LogLevel::Warn,
                    &format!(
                        "Prompter: its saver could not start ({error}); the place is saved as it moves."
                    ),
                );
                false
            }
        }
    }

    /// The glass script's newest place and pace, for the saver to write.
    pub(crate) fn keep_glass(&self, save: GlassSave, urgency: Urgency) {
        let now = Instant::now();
        let mut state = self.lock();
        if state.stopping || state.stopped {
            return;
        }
        let due = due_at(&state, urgency, now);
        state.glass.hand_over(save, due);
        self.handed_over(state);
    }

    /// The newest look, size and look revision, for the saver to write.
    pub(crate) fn keep_look(&self, save: LookSave, urgency: Urgency) {
        let now = Instant::now();
        let mut state = self.lock();
        if state.stopping || state.stopped {
            return;
        }
        let due = due_at(&state, urgency, now);
        state.look.hand_over(save, due);
        self.handed_over(state);
    }

    fn handed_over(&self, state: MutexGuard<'_, State>) {
        if state.threaded {
            drop(state);
            self.changed.notify_all();
        } else {
            self.write_here(state);
        }
    }

    /// The glass shows another script, or the same at a new revision: what
    /// waited for the old one is let go (a write of it would be refused).
    pub(crate) fn let_go_of_glass(&self) {
        let mut state = self.lock();
        state.glass.pending = None;
        state.glass.written = None;
        drop(state);
        // A flush that waits for the slot to empty hears of it.
        self.changed.notify_all();
    }

    /// The glass script's newest values: what waits, else what was last
    /// written. The lists show them, so a new pace reads at once.
    pub(crate) fn newest_glass(&self) -> Option<GlassSave> {
        let state = self.lock();
        state
            .glass
            .pending
            .as_ref()
            .map(|(value, _)| value.clone())
            .or_else(|| state.glass.written.clone())
    }

    /// What the saver did since the last call, and counting starts again.
    pub(crate) fn take_counts(&self) -> SaverCounts {
        std::mem::take(&mut self.lock().counts)
    }

    /// Writes everything pending now and waits for it, up to `within`: before
    /// a backup, an export or a restore reads the saved data. True when
    /// nothing is left unwritten. Without the thread the write is made here,
    /// and `within` does not bound it.
    pub(crate) fn flush(&self, within: Duration) -> bool {
        let mut state = self.lock();
        if !state.threaded {
            self.write_here(state);
            return self.nothing_pending();
        }
        make_due_now(&mut state);
        self.changed.notify_all();
        let deadline = Instant::now() + within;
        while state.glass.pending.is_some() || state.look.pending.is_some() || state.writing {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            state = self
                .changed
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
        true
    }

    /// At a stop: writes everything pending, then the thread closes its
    /// connection and ends, up to `within`; hand-offs after this are
    /// ignored. True when it was done in time. Without the thread the write
    /// is made here, and `within` does not bound it.
    pub(crate) fn finish(&self, within: Duration) -> bool {
        let mut state = self.lock();
        if !state.threaded {
            self.write_here(state);
            let done = self.nothing_pending();
            self.lock().stopped = true;
            return done;
        }
        state.stopping = true;
        make_due_now(&mut state);
        self.changed.notify_all();
        let deadline = Instant::now() + within;
        while !state.stopped {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            state = self
                .changed
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
        true
    }

    fn nothing_pending(&self) -> bool {
        let state = self.lock();
        state.glass.pending.is_none() && state.look.pending.is_none()
    }

    /// Without the thread: everything pending is written now, on this thread.
    fn write_here(&self, mut state: MutexGuard<'_, State>) {
        let Some(batch) = take_batch(&mut state, None) else {
            return;
        };
        let started = Instant::now();
        let outcome = open_connection(&self.db_path)
            .map_err(Into::into)
            .and_then(|mut connection| write_batch(&mut connection, &batch));
        let warning = finish_batch(&mut state, &batch, outcome, started);
        drop(state);
        if let Some(warning) = warning {
            log_event(LogLevel::Warn, &warning);
        }
    }

    /// The thread: it waits for a save to fall due, writes it on its own
    /// connection, and at the stop writes what is left and closes the
    /// connection, so the shutdown's backup and checkpoint find it closed.
    fn run(self: Arc<Self>) {
        let mut connection: Option<Connection> = None;
        loop {
            let mut state = self.lock();
            let batch = loop {
                let now = Instant::now();
                let ready = if state.stopping {
                    take_batch(&mut state, None)
                } else if state.retry_at.is_some_and(|at| at > now) {
                    None
                } else {
                    take_batch(&mut state, Some(now))
                };
                if ready.is_some() || state.stopping {
                    break ready;
                }
                let wait = next_wake(&state, now);
                // What the thread let go of without a write (a value equal
                // to the last one written) is told to a flush that waits for
                // it (the review of #287).
                self.changed.notify_all();
                state = self
                    .changed
                    .wait_timeout(state, wait)
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .0;
            };
            let Some(batch) = batch else {
                // The connection is closed with the saver's lock let go: a
                // close may fold the write-ahead log into the file.
                drop(state);
                drop(connection.take());
                let mut state = self.lock();
                state.stopped = true;
                state.threaded = false;
                drop(state);
                self.changed.notify_all();
                return;
            };
            state.writing = true;
            drop(state);

            let started = Instant::now();
            let outcome = catch_unwind(AssertUnwindSafe(|| {
                if connection.is_none() {
                    connection = Some(open_connection(&self.db_path)?);
                }
                let open = connection.as_mut().expect("opened above");
                write_batch(open, &batch)
            }))
            .unwrap_or_else(|_| Err("the write panicked".into()));
            if outcome.is_err() {
                // A connection that failed is opened afresh at the next try.
                connection = None;
            }
            let warning = {
                let mut state = self.lock();
                state.writing = false;
                finish_batch(&mut state, &batch, outcome, started)
            };
            if let Some(warning) = warning {
                log_event(LogLevel::Warn, &warning);
            }
            self.changed.notify_all();
        }
    }
}

fn due_at(state: &State, urgency: Urgency, now: Instant) -> Instant {
    match urgency {
        Urgency::Now => now,
        Urgency::Shortly => now + DIAL_SETTLES_IN,
        Urgency::Coalesced => state
            .last_write_at
            .map_or(now, |at| (at + COALESCE_FOR).max(now)),
    }
}

fn make_due_now(state: &mut State) {
    let now = Instant::now();
    if let Some((_, due)) = state.glass.pending.as_mut() {
        *due = now;
    }
    if let Some((_, due)) = state.look.pending.as_mut() {
        *due = now;
    }
    state.retry_at = None;
}

/// How long the thread may sleep: until the first save falls due, not before
/// a retry may begin.
fn next_wake(state: &State, now: Instant) -> Duration {
    let due = [
        state.glass.pending.as_ref().map(|(_, at)| *at),
        state.look.pending.as_ref().map(|(_, at)| *at),
    ]
    .into_iter()
    .flatten()
    .min();
    let due = match (due, state.retry_at) {
        (Some(due), Some(retry)) => Some(due.max(retry)),
        (due, _) => due,
    };
    due.map_or(IDLE_WAIT, |at| {
        at.saturating_duration_since(now)
            .max(Duration::from_millis(1))
    })
}

/// The values due by `now` (all of them without one), less any equal to the
/// value last written, which wait no more. `None` when nothing is to write.
/// What is taken stays pending until its write is done.
fn take_batch(state: &mut State, now: Option<Instant>) -> Option<Batch> {
    if state
        .glass
        .pending
        .as_ref()
        .is_some_and(|(value, _)| state.glass.written.as_ref() == Some(value))
    {
        state.glass.pending = None;
    }
    if state
        .look
        .pending
        .as_ref()
        .is_some_and(|(value, _)| state.look.written.as_ref() == Some(value))
    {
        state.look.pending = None;
    }
    let due = |at: &Instant| now.is_none_or(|now| *at <= now);
    let glass = state
        .glass
        .pending
        .as_ref()
        .filter(|(_, at)| due(at))
        .map(|(value, _)| value.clone());
    let look = state
        .look
        .pending
        .as_ref()
        .filter(|(_, at)| due(at))
        .map(|(value, _)| value.clone());
    if glass.is_none() && look.is_none() {
        return None;
    }
    state.glass.taken = glass.is_some();
    state.look.taken = look.is_some();
    state.last_write_at = Some(Instant::now());
    Some(Batch { glass, look })
}

/// One write: the place and pace, the look, or both, in one transaction.
/// True when the place landed (or there was none to write).
fn write_batch(connection: &mut Connection, batch: &Batch) -> EngineResult<bool> {
    let transaction = store::begin(connection)?;
    let landed = match &batch.glass {
        Some(save) => store::write_glass_save(&transaction, save)?,
        None => true,
    };
    if let Some(save) = &batch.look {
        store::write_look_save(&transaction, save)?;
    }
    transaction.commit()?;
    Ok(landed)
}

/// After a write: what it wrote waits no more, unless a newer value took its
/// place meanwhile. A write that failed leaves everything pending and the
/// next waits; at the stop nothing waits any more. The `WARN` line to write,
/// once the lock is let go.
fn finish_batch(
    state: &mut State,
    batch: &Batch,
    outcome: EngineResult<bool>,
    started: Instant,
) -> Option<String> {
    state.counts.longest = state.counts.longest.max(started.elapsed());
    state.glass.taken = false;
    state.look.taken = false;
    match outcome {
        Ok(landed) => {
            if landed || batch.look.is_some() {
                state.counts.saved += 1;
            }
            if let Some(glass) = &batch.glass {
                if !landed {
                    state.counts.refused += 1;
                }
                if state
                    .glass
                    .pending
                    .as_ref()
                    .is_some_and(|(value, _)| value == glass)
                {
                    state.glass.pending = None;
                }
                state.glass.written = landed.then(|| glass.clone());
            }
            if let Some(look) = &batch.look {
                if state
                    .look
                    .pending
                    .as_ref()
                    .is_some_and(|(value, _)| value == look)
                {
                    state.look.pending = None;
                }
                state.look.written = Some(look.clone());
            }
            state.failures = 0;
            state.retry_at = None;
            None
        }
        Err(error) => {
            state.counts.failed += 1;
            state.failures = state.failures.saturating_add(1);
            let wait = RETRY_AFTER
                .saturating_mul(1 << state.failures.saturating_sub(1).min(8))
                .min(RETRY_AT_MOST);
            state.retry_at = Some(Instant::now() + wait);
            if state.stopping {
                state.glass.pending = None;
                state.look.pending = None;
                return Some(format!(
                    "Prompter: the last place, pace or size could not be saved at the stop: {error}"
                ));
            }
            let warn = state.warned_at.is_none_or(|at| at.elapsed() >= WARN_EVERY);
            warn.then(|| {
                state.warned_at = Some(Instant::now());
                format!(
                    "Prompter: the place, pace or size could not be saved ({} tries so far); trying again: {error}",
                    state.failures
                )
            })
        }
    }
}

#[cfg(test)]
pub(crate) mod hooks {
    //! The saver's steps one at a time, for the tests of its races: take what
    //! is due, write it later, as the thread does.
    use super::*;

    /// The saver's batch, taken as the thread takes it.
    pub(crate) struct Taken(Batch);

    pub(crate) fn take(saver: &Saver) -> Option<Taken> {
        let mut state = saver.lock();
        let batch = take_batch(&mut state, None)?;
        state.writing = true;
        Some(Taken(batch))
    }

    /// What the thread would take now: only what is due.
    pub(crate) fn take_due(saver: &Saver) -> Option<Taken> {
        let mut state = saver.lock();
        let batch = take_batch(&mut state, Some(Instant::now()))?;
        state.writing = true;
        Some(Taken(batch))
    }

    pub(crate) fn write(saver: &Saver, taken: Taken) {
        let started = Instant::now();
        let outcome = open_connection(&saver.db_path)
            .map_err(Into::into)
            .and_then(|mut connection| write_batch(&mut connection, &taken.0));
        let mut state = saver.lock();
        state.writing = false;
        let _ = finish_batch(&mut state, &taken.0, outcome, started);
    }

    /// Holds the hand-offs without writing them, as the thread does between
    /// its writes.
    pub(crate) fn hold_writes(saver: &Saver) {
        saver.lock().threaded = true;
    }

    /// Writes at the hand-off again, and writes what waits now.
    pub(crate) fn release_writes(saver: &Saver) {
        let mut state = saver.lock();
        state.threaded = false;
        saver.write_here(state);
    }
}
