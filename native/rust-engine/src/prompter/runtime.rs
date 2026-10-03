//! The prompter while Studio Control runs: the look and the clock of the
//! script on the glass, loaded from the saved data by the clock's thread at
//! the start, or by the first request — paused, whatever it was doing before
//! (D12: a start, a restart, a crash or a restore never scrolls by itself).
//!
//! One prompter per saved data (`db_path`), so the tests, each with a
//! database of its own, never share one. The live app starts two threads
//! (`start`): the clock's, which stops the text at `END` when it gets there
//! and hands the place to the saver about once a second while it scrolls,
//! and the saver's (`saver.rs`), which writes it. Every request settles the
//! prompter first (`with_prompter`), so nothing depends on the clock's thread
//! but the moment `prompter.changed` reports the stop.
//!
//! Since 2026-10-02 nothing under the prompter's lock waits for the disk on
//! the take's path: the take's controls, the Stream Deck's keys and the clock
//! open no connection and write nothing themselves. The requests that read or
//! write scripts open their connection before they take the lock
//! (`with_prompter_db`). Whoever lets go of the lock publishes the deck's
//! frame first (`deck::DeckFrame`), and the deck's displays read that, never
//! the lock.

use crate::diagnostics::{log_event, LogLevel};
use crate::engine_events::emit_prompter_changed;
use crate::prompter::clock::{GlassClock, PrompterAnchor, PrompterPlace};
use crate::prompter::deck::DeckFrame;
use crate::prompter::look::PrompterLook;
use crate::prompter::minute;
use crate::prompter::saver::{GlassSave, LookSave, Saver, Urgency};
use crate::prompter::screen::PrompterScreen;
use crate::prompter::store;
use crate::prompter::PrompterError;
use crate::storage::open_connection;
use rusqlite::Connection;
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

/// While the text scrolls, the place is handed to the saver this often.
pub(crate) const SAVE_EVERY: Duration = Duration::from_secs(1);
/// The thread's longest sleep while nothing moves; any change wakes it.
const IDLE_WAIT: Duration = Duration::from_secs(60);
/// While a pause's ease runs the thread looks this often, so a text that
/// eases into `END` stops there and says so at once (2026-10-02: the deck's
/// displays used to catch it, and they no longer take the lock).
const EASE_WAIT: Duration = Duration::from_millis(20);
/// The prompter's minute line comes this often while the text plays.
const MINUTE_EVERY: Duration = Duration::from_secs(60);
/// Every start moves the look's revision on by this much, and saves that at
/// once. The saver writes a new size within a second, so a crash can lose
/// the last few revisions; past this step, a layout key of an earlier run is
/// never handed out again with another size (2026-10-02).
const LOOK_REVISIONS_A_START: i64 = 1000;

pub(crate) struct Prompter {
    pub look: PrompterLook,
    pub size_px: u32,
    pub glass_revision: i64,
    pub look_revision: i64,
    pub glass: Option<GlassClock>,
    /// The Prompter XL as the shell last reported it (Slice 5a). Kept in
    /// memory only: every start begins at `NOT CONNECTED` until the shell
    /// reports again.
    pub screen: PrompterScreen,
    /// When the Stream Deck last set the text size: its strip shows the
    /// size for a moment after (`deck.rs`). Kept in memory only.
    pub deck_size_shown_at: Option<Instant>,
    /// The name of the script on the glass, as a rename leaves it; empty when
    /// nothing is on. The strip, the glass's summary and the check read it
    /// here, not from the disk (2026-10-02).
    pub glass_name: String,
    /// The script on the glass was edited after it went on: `NOT UPDATED`.
    /// Set by every write of that script's text, cleared when the glass
    /// takes a text.
    pub glass_text_differs: bool,
    saver: Arc<Saver>,
    /// When the place was last handed to the saver while the text scrolled.
    kept_at: Instant,
    /// The anchors' numbers: the last one handed out, and what it said.
    numbers: RefCell<AnchorNumbers>,
}

/// The last anchor number handed out, and the anchor it numbered (its age
/// left out) with its motion's moment: the next anchor that says the same
/// takes the same number, and any other the next one.
#[derive(Default)]
struct AnchorNumbers {
    revision: u64,
    last: Option<(PrompterAnchor, Instant)>,
}

/// The key of the layout the view must report for the glass as it is: the
/// text's revision and the look's.
pub(crate) fn layout_key(glass_revision: i64, look_revision: i64) -> String {
    format!("g{glass_revision}-l{look_revision}")
}

impl Prompter {
    fn load(
        connection: &Connection,
        saver: Arc<Saver>,
        now: Instant,
    ) -> Result<Self, PrompterError> {
        let stored = store::read_prompter(connection)?;
        let look_revision = stored.look_revision + LOOK_REVISIONS_A_START;
        let mut glass_name = String::new();
        let mut glass_text_differs = false;
        let glass = match (&stored.glass_script_id, stored.glass_paragraphs) {
            (Some(script_id), Some(paragraphs)) => {
                store::read_script(connection, script_id)?.map(|script| {
                    glass_name = script.name.clone();
                    glass_text_differs = script.paragraphs != paragraphs;
                    GlassClock::paused(
                        now,
                        script.id,
                        Arc::new(paragraphs),
                        layout_key(stored.glass_revision, look_revision),
                        script.place,
                        script.speed_wpm,
                    )
                })
            }
            _ => None,
        };
        let prompter = Self {
            look: stored.look,
            size_px: stored.size_px,
            glass_revision: stored.glass_revision,
            look_revision,
            glass,
            screen: PrompterScreen::default(),
            deck_size_shown_at: None,
            glass_name,
            glass_text_differs,
            saver,
            kept_at: now,
            numbers: RefCell::new(AnchorNumbers::default()),
        };
        prompter.keep_look(Urgency::Now);
        Ok(prompter)
    }

    pub(crate) fn layout_key(&self) -> String {
        layout_key(self.glass_revision, self.look_revision)
    }

    /// The glass's anchor as a view reads it at `now`, numbered and counted
    /// for the minute line; `None` when nothing is on the glass. Every anchor
    /// the hardware link hands out comes from here, under the prompter's
    /// lock, so the numbers follow the lock's order whichever thread sends
    /// them (fix C, 2026-10-02).
    pub(crate) fn anchor(&self, now: Instant) -> Option<PrompterAnchor> {
        self.glass.as_ref().map(|glass| {
            minute::note_anchor();
            let mut anchor = glass.anchor(now);
            anchor.revision = self.number(&anchor, glass.motion.at);
            anchor
        })
    }

    /// The number for `anchor`: the last one again when it says what the last
    /// said, its age apart, on the same motion; else the next.
    fn number(&self, anchor: &PrompterAnchor, motion_at: Instant) -> u64 {
        let mut numbers = self.numbers.borrow_mut();
        let mut said = anchor.clone();
        said.age_ms = 0.0;
        said.revision = 0;
        let same = numbers
            .last
            .as_ref()
            .is_some_and(|(last, at)| *last == said && *at == motion_at);
        if !same {
            numbers.revision += 1;
            numbers.last = Some((said, motion_at));
        }
        numbers.revision
    }

    /// Hands the glass script's place and pace at `now` to the saver: where
    /// the text is while it scrolls, where a pause's ease will stop it while
    /// it does not (review of 2026-09-27: saving at the moment of the press
    /// left the place up to a line early).
    pub(crate) fn keep_place(&mut self, now: Instant, urgency: Urgency) {
        if let Some(glass) = &self.glass {
            let place = if glass.playing {
                glass.place_at(now)
            } else {
                glass.resting_place(now)
            };
            self.keep_this_place(place, urgency);
        }
        self.kept_at = now;
    }

    /// Hands `place` and the pace to the saver, for the script on the glass
    /// at the glass's revision now.
    pub(crate) fn keep_this_place(&self, place: PrompterPlace, urgency: Urgency) {
        let Some(glass) = &self.glass else {
            return;
        };
        self.saver.keep_glass(
            GlassSave {
                script_id: glass.script_id.clone(),
                glass_revision: self.glass_revision,
                place,
                speed_wpm: glass.speed_wpm,
            },
            urgency,
        );
    }

    /// Hands the look, the take's size and the look's revision to the saver.
    pub(crate) fn keep_look(&self, urgency: Urgency) {
        self.saver.keep_look(
            LookSave {
                look: self.look,
                size_px: self.size_px,
                look_revision: self.look_revision,
            },
            urgency,
        );
    }

    /// The glass took another text, or none, in a transaction that wrote the
    /// places itself: what waited for the old glass is let go.
    pub(crate) fn glass_changed(&mut self, now: Instant) {
        self.saver.let_go_of_glass();
        self.kept_at = now;
    }

    /// The glass script's place and pace as the saver has them, for the
    /// lists: what waits to be written, or what was written last, while the
    /// glass still shows that script at this revision.
    pub(crate) fn kept_values(&self) -> Option<(String, PrompterPlace, u32)> {
        self.saver
            .newest_glass()
            .filter(|save| {
                save.glass_revision == self.glass_revision
                    && self
                        .glass
                        .as_ref()
                        .is_some_and(|glass| glass.script_id == save.script_id)
            })
            .map(|save| (save.script_id, save.place, save.speed_wpm))
    }

    /// Stops the text at `END` if it got there — and says so with
    /// `prompter.changed { reason: "at-end" }`, whoever noticed first, the
    /// clock's thread or a request (review of 2026-09-27: a request that
    /// noticed first used to keep it to itself) — and hands the place to the
    /// saver when a second has passed.
    fn settle(&mut self, now: Instant) {
        let Some(glass) = self.glass.as_mut() else {
            return;
        };
        let stopped = glass.settle(now);
        let playing = glass.playing;
        if stopped {
            if let Some(anchor) = self.anchor(now) {
                announce_end(anchor);
            }
            self.keep_place(now, Urgency::Now);
        } else if playing && now.saturating_duration_since(self.kept_at) >= SAVE_EVERY {
            self.keep_place(now, Urgency::Coalesced);
        }
    }

    /// How long the thread may sleep: until `END`, or the next hand-off while
    /// the text scrolls.
    fn next_wake(&self, now: Instant) -> Duration {
        let Some(glass) = &self.glass else {
            return IDLE_WAIT;
        };
        if !glass.playing {
            return if glass.moving(now) {
                EASE_WAIT
            } else {
                IDLE_WAIT
            };
        }
        let until_end = glass.time_to_end_ms(now).map_or(IDLE_WAIT, |milliseconds| {
            Duration::from_secs_f64(milliseconds.max(0.0) / 1000.0) + Duration::from_millis(1)
        });
        until_end.min(SAVE_EVERY)
    }
}

struct Entry {
    prompter: Mutex<Option<Prompter>>,
    wake: Condvar,
    saver: Arc<Saver>,
    /// The deck's frame, as the prompter was when it last let go of its lock:
    /// a leaf, never held while another lock is taken.
    frame: Mutex<Option<Arc<DeckFrame>>>,
}

static PROMPTERS: OnceLock<Mutex<HashMap<PathBuf, Arc<Entry>>>> = OnceLock::new();

fn entry(db_path: &Path) -> Arc<Entry> {
    let registry = PROMPTERS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut registry = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(registry.entry(db_path.to_path_buf()).or_insert_with(|| {
        Arc::new(Entry {
            prompter: Mutex::new(None),
            wake: Condvar::new(),
            saver: Arc::new(Saver::new(db_path)),
            frame: Mutex::new(None),
        })
    }))
}

fn lock(entry: &Entry) -> MutexGuard<'_, Option<Prompter>> {
    entry
        .prompter
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The deck's frame from the prompter as it is, published before the lock is
/// let go.
fn publish(entry: &Entry, prompter: Option<&Prompter>) {
    let frame = prompter.map(|prompter| Arc::new(DeckFrame::of(prompter)));
    *entry
        .frame
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = frame;
}

/// The deck's frame as the prompter last published it; `None` before the
/// prompter is loaded.
pub(crate) fn published_frame(db_path: &Path) -> Option<Arc<DeckFrame>> {
    entry(db_path)
        .frame
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// The prompter's lock, taken for `what`: how long it was waited for and
/// held goes into the minute line. Every taking of the lock goes through
/// here.
struct Held<'a> {
    guard: Option<MutexGuard<'a, Option<Prompter>>>,
    taken_at: Instant,
    what: &'a str,
}

fn hold<'a>(entry: &'a Entry, what: &'a str) -> Held<'a> {
    let asked = Instant::now();
    let guard = lock(entry);
    let taken_at = Instant::now();
    minute::note_wait(what, taken_at.saturating_duration_since(asked));
    Held {
        guard: Some(guard),
        taken_at,
        what,
    }
}

impl<'a> Held<'a> {
    fn slot(&mut self) -> &mut Option<Prompter> {
        self.guard.as_mut().expect("held until dropped")
    }

    /// The lock for a wait on the condvar: the hold ends here.
    fn into_guard(mut self) -> MutexGuard<'a, Option<Prompter>> {
        minute::note_hold(self.what, self.taken_at.elapsed());
        self.guard.take().expect("held until dropped")
    }
}

impl Drop for Held<'_> {
    fn drop(&mut self) {
        if self.guard.is_some() {
            minute::note_hold(self.what, self.taken_at.elapsed());
        }
    }
}

/// The prompter in `slot`, loaded paused the first time, on `connection` or,
/// without one, on a connection opened for the load alone.
fn loaded<'p>(
    entry: &Entry,
    slot: &'p mut Option<Prompter>,
    db_path: &Path,
    connection: Option<&Connection>,
    now: Instant,
) -> Result<&'p mut Prompter, PrompterError> {
    if slot.is_none() {
        let prompter = match connection {
            Some(connection) => Prompter::load(connection, Arc::clone(&entry.saver), now)?,
            None => Prompter::load(&open_connection(db_path)?, Arc::clone(&entry.saver), now)?,
        };
        *slot = Some(prompter);
    }
    Ok(slot.as_mut().expect("loaded above"))
}

/// Runs `action` on the prompter of this saved data, after stopping the text
/// at `END` if it got there. The prompter's lock is held for the whole
/// action, so two requests never interleave. Nothing here opens a connection
/// but the first load: the take's controls, the deck and the reads of the
/// glass run on memory alone.
pub(crate) fn with_prompter<T>(
    db_path: &Path,
    what: &str,
    action: impl FnOnce(&mut Prompter, Instant) -> Result<T, PrompterError>,
) -> Result<T, PrompterError> {
    let entry = entry(db_path);
    let mut held = hold(&entry, what);
    let now = Instant::now();
    let prompter = loaded(&entry, held.slot(), db_path, None, now)?;
    prompter.settle(now);
    let result = action(prompter, now);
    publish(&entry, Some(prompter));
    drop(held);
    entry.wake.notify_all();
    result
}

/// `with_prompter` for the requests that read or write scripts: their
/// connection is opened before the lock is taken.
pub(crate) fn with_prompter_db<T>(
    db_path: &Path,
    what: &str,
    action: impl FnOnce(&mut Prompter, &mut Connection, Instant) -> Result<T, PrompterError>,
) -> Result<T, PrompterError> {
    let mut connection = open_connection(db_path)?;
    let entry = entry(db_path);
    let mut held = hold(&entry, what);
    let now = Instant::now();
    let prompter = loaded(&entry, held.slot(), db_path, Some(&connection), now)?;
    prompter.settle(now);
    let result = action(prompter, &mut connection, now);
    publish(&entry, Some(prompter));
    drop(held);
    entry.wake.notify_all();
    result
}

/// Writes what the saver holds for this saved data, up to `within`: before
/// a backup archive, an export or a database restore reads it. True when
/// nothing is left unwritten.
pub(crate) fn flush_saves(db_path: &Path, within: Duration) -> bool {
    entry(db_path).saver.flush(within)
}

/// At a graceful stop, before the shutdown's backup: the place of this
/// moment and the pace go to the saver, which writes them and everything
/// else it holds, then closes its connection, up to `within`. The lock is
/// tried for a moment only; a request that holds it has handed its own
/// place over. True when it was done in time.
pub(crate) fn finish_saving(db_path: &Path, within: Duration) -> bool {
    let entry = entry(db_path);
    let deadline = Instant::now() + within;
    let tried_until = Instant::now() + within / 4;
    loop {
        match entry.prompter.try_lock() {
            Ok(mut guard) => {
                if let Some(prompter) = guard.as_mut() {
                    prompter.keep_place(Instant::now(), Urgency::Now);
                }
                break;
            }
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                if let Some(prompter) = poisoned.into_inner().as_mut() {
                    prompter.keep_place(Instant::now(), Urgency::Now);
                }
                break;
            }
            Err(std::sync::TryLockError::WouldBlock) if Instant::now() < tried_until => {
                thread::sleep(Duration::from_millis(5));
            }
            Err(std::sync::TryLockError::WouldBlock) => break,
        }
    }
    entry
        .saver
        .finish(deadline.saturating_duration_since(Instant::now()))
}

/// Forgets the prompter of this saved data, so the next request loads it
/// again from the disk, paused — a start, for the tests. What the saver
/// holds is written first, as a stop writes it. A database restore needs
/// nothing of the kind: the process ends before the next start applies it.
#[cfg(test)]
pub(crate) fn forget(db_path: &Path) {
    let entry = entry(db_path);
    entry.saver.flush(Duration::from_secs(5));
    *lock(&entry) = None;
    publish(&entry, None);
    entry.wake.notify_all();
}

/// The saver of this saved data, for the tests.
#[cfg(test)]
pub(crate) fn saver_of(db_path: &Path) -> Arc<Saver> {
    Arc::clone(&entry(db_path).saver)
}

/// The live app's prompter: the saver's thread, and the clock's, which loads
/// the prompter at the start, stops the text at `END` when it gets there (and
/// says so with `prompter.changed`), hands the place to the saver about once
/// a second while the text scrolls, and writes the minute line while it
/// plays.
pub(crate) fn start(db_path: PathBuf) {
    let entry = entry(&db_path);
    entry.saver.start();
    let _ = thread::Builder::new()
        .name(String::from("prompter-clock"))
        .spawn(move || run_clock(&db_path, &entry));
}

fn run_clock(db_path: &Path, entry: &Entry) {
    let mut minute_from = Instant::now();
    let mut played = false;
    let mut loaded_once = false;
    loop {
        let mut held = hold(entry, "clock");
        let now = Instant::now();
        if !loaded_once {
            loaded_once = true;
            // The start's load; one that fails waits for the first request.
            if let Err(error) = loaded(entry, held.slot(), db_path, None, now) {
                log_event(
                    LogLevel::Warn,
                    &format!("Prompter: it could not be loaded at the start: {error:?}"),
                );
            }
        }
        let mut wait = match held.slot().as_mut() {
            Some(prompter) => {
                prompter.settle(now);
                let playing = prompter.glass.as_ref().is_some_and(|glass| glass.playing);
                played |= playing;
                minute::note_playing(playing, now);
                publish(entry, Some(prompter));
                prompter.next_wake(Instant::now())
            }
            None => {
                minute::note_playing(false, now);
                IDLE_WAIT
            }
        };
        let line = (now.saturating_duration_since(minute_from) >= MINUTE_EVERY).then(|| {
            minute_from = now;
            let figures = minute::take();
            let counts = entry.saver.take_counts();
            let line = played.then(|| minute::line(&figures, counts));
            played = false;
            line
        });
        let mut guard = held.into_guard();
        if let Some(line) = line.flatten() {
            // Written with the lock let go; the wait is worked out again
            // after, from the prompter as it is then.
            drop(guard);
            log_event(LogLevel::Info, &line);
            guard = lock(entry);
            wait = guard
                .as_ref()
                .map_or(IDLE_WAIT, |prompter| prompter.next_wake(Instant::now()));
        }
        let _ = entry
            .wake
            .wait_timeout(guard, wait)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
}

/// `prompter.changed { reason: "at-end" }`: the text stopped at `END`.
fn announce_end(anchor: PrompterAnchor) {
    #[cfg(test)]
    ANNOUNCED_ENDS.with(|ends| ends.borrow_mut().push(anchor.clone()));
    emit_prompter_changed("at-end", Some(anchor));
}

#[cfg(test)]
thread_local! {
    /// The ends announced on this thread, for the tests (the event sender is
    /// not registered there).
    pub(crate) static ANNOUNCED_ENDS: std::cell::RefCell<Vec<PrompterAnchor>> =
        const { std::cell::RefCell::new(Vec::new()) };
}
