//! The prompter while Studio Control runs: the look and the clock of the
//! script on the glass, loaded from the saved data by the first request —
//! paused, whatever it was doing before (D12: a start, a restart, a crash or
//! a restore never scrolls by itself).
//!
//! One prompter per saved data (`db_path`), so the tests, each with a
//! database of its own, never share one. The live app starts one thread
//! (`spawn_prompter_clock`) that stops the text at `END` when it gets there
//! and saves the place about once a second while it scrolls; every request
//! does the same first (`with_prompter`), so nothing depends on the thread
//! but the moment `prompter.changed` reports the stop.

use crate::engine_events::emit_prompter_changed;
use crate::prompter::clock::{GlassClock, PrompterPlace};
use crate::prompter::look::PrompterLook;
use crate::prompter::store;
use crate::prompter::PrompterError;
use crate::storage::open_connection;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

/// While the text scrolls, the place is saved at most this often.
pub(crate) const SAVE_EVERY: Duration = Duration::from_secs(1);
/// The thread's longest sleep while nothing moves; any change wakes it.
const IDLE_WAIT: Duration = Duration::from_secs(60);

pub(crate) struct Prompter {
    pub look: PrompterLook,
    pub size_px: u32,
    pub glass_revision: i64,
    pub look_revision: i64,
    pub glass: Option<GlassClock>,
    /// The glass script's place as last saved, and when.
    saved_place: Option<PrompterPlace>,
    saved_at: Instant,
}

/// The key of the layout the view must report for the glass as it is: the
/// text's revision and the look's.
pub(crate) fn layout_key(glass_revision: i64, look_revision: i64) -> String {
    format!("g{glass_revision}-l{look_revision}")
}

impl Prompter {
    fn load(connection: &Connection, now: Instant) -> Result<Self, PrompterError> {
        let stored = store::read_prompter(connection)?;
        let glass = match (&stored.glass_script_id, stored.glass_paragraphs) {
            (Some(script_id), Some(paragraphs)) => {
                store::read_script(connection, script_id)?.map(|script| {
                    GlassClock::paused(
                        now,
                        script.id,
                        Arc::new(paragraphs),
                        layout_key(stored.glass_revision, stored.look_revision),
                        script.place,
                        script.speed_wpm,
                    )
                })
            }
            _ => None,
        };
        let saved_place = glass.as_ref().map(|glass| glass.motion.place);
        Ok(Self {
            look: stored.look,
            size_px: stored.size_px,
            glass_revision: stored.glass_revision,
            look_revision: stored.look_revision,
            glass,
            saved_place,
            saved_at: now,
        })
    }

    pub(crate) fn layout_key(&self) -> String {
        layout_key(self.glass_revision, self.look_revision)
    }

    /// Saves the glass script's place when it moved since the last save.
    pub(crate) fn save_place(
        &mut self,
        connection: &Connection,
        now: Instant,
    ) -> Result<(), PrompterError> {
        if let Some(glass) = &self.glass {
            let (place, _) = glass.place_at(now);
            if self.saved_place != Some(place) {
                store::write_script_place(connection, &glass.script_id, place)?;
                self.saved_place = Some(place);
            }
        }
        self.saved_at = now;
        Ok(())
    }

    /// The glass has another script, or none: its place counts as saved.
    pub(crate) fn place_saved_as(&mut self, place: Option<PrompterPlace>, now: Instant) {
        self.saved_place = place;
        self.saved_at = now;
    }

    /// Stops the text at `END` if it got there, and saves the place when a
    /// second has passed. True when the text stopped now.
    fn settle(&mut self, connection: &Connection, now: Instant) -> Result<bool, PrompterError> {
        let Some(glass) = self.glass.as_mut() else {
            return Ok(false);
        };
        let stopped = glass.settle(now);
        let playing = glass.playing;
        if stopped || (playing && now.saturating_duration_since(self.saved_at) >= SAVE_EVERY) {
            self.save_place(connection, now)?;
        }
        Ok(stopped)
    }

    /// How long the thread may sleep: until `END`, or the next save while the
    /// text scrolls.
    fn next_wake(&self, now: Instant) -> Duration {
        let Some(glass) = &self.glass else {
            return IDLE_WAIT;
        };
        if !glass.playing {
            return IDLE_WAIT;
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
        })
    }))
}

fn lock(entry: &Entry) -> MutexGuard<'_, Option<Prompter>> {
    entry
        .prompter
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Runs `action` on the prompter of this saved data, loaded paused the first
/// time, after stopping the text at `END` if it got there. The prompter's
/// lock is held for the whole action, so two requests never interleave.
pub(crate) fn with_prompter<T>(
    db_path: &Path,
    action: impl FnOnce(&mut Prompter, &mut Connection, Instant) -> Result<T, PrompterError>,
) -> Result<T, PrompterError> {
    let entry = entry(db_path);
    let mut guard = lock(&entry);
    let mut connection = open_connection(db_path)?;
    let now = Instant::now();
    if guard.is_none() {
        *guard = Some(Prompter::load(&connection, now)?);
    }
    let prompter = guard.as_mut().expect("loaded above");
    prompter.settle(&connection, now)?;
    let result = action(prompter, &mut connection, now);
    entry.wake.notify_all();
    result
}

/// Forgets the prompter of this saved data, so the next request loads it
/// again from the disk, paused — a start, for the tests. A database restore
/// needs nothing of the kind: the process ends before the next start applies
/// it.
#[cfg(test)]
pub(crate) fn forget(db_path: &Path) {
    let entry = entry(db_path);
    *lock(&entry) = None;
    entry.wake.notify_all();
}

/// The live app's clock thread: it stops the text at `END` when it gets
/// there (and says so with `prompter.changed`), and saves the place about
/// once a second while the text scrolls.
pub(crate) fn spawn_prompter_clock(db_path: PathBuf) {
    let _ = thread::Builder::new()
        .name(String::from("prompter-clock"))
        .spawn(move || {
            let entry = entry(&db_path);
            loop {
                let mut guard = lock(&entry);
                let wait = match guard.as_mut() {
                    Some(prompter) => {
                        let now = Instant::now();
                        if let Ok(connection) = open_connection(&db_path) {
                            if let Ok(true) = prompter.settle(&connection, now) {
                                let anchor = prompter.glass.as_ref().map(|glass| glass.anchor(now));
                                emit_prompter_changed("at-end", anchor);
                            }
                        }
                        prompter.next_wake(Instant::now())
                    }
                    None => IDLE_WAIT,
                };
                let _ = entry
                    .wake
                    .wait_timeout(guard, wait)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        });
}
