//! When the deck last asked the bridge (Found, to check, 2026-09-28: the
//! deck's probe always passed; the owner's decision, 2026-09-29).
//!
//! Companion asks the bridge for the deck's displays once a second, whatever
//! page the deck is on, and whether a Stream Deck is plugged in or not (the
//! review of #261): being heard says that Companion runs with the profile;
//! Setup's `Verify live echo` proves the deck itself. Every request that
//! carries the workstation's token is noted here, by the saved data the
//! bridge serves. Setup's deck probe passes only when one came within
//! `DECK_QUIET_AFTER`, and the Surface lamp reads `no deck` while none has. A
//! request without the token is not the deck's: a profile exported before
//! the token, or another program.
//!
//! It locks nothing: the bridge serves whoever asks with the token, heard or
//! not. The quiet watch announces a change (`app.changed { reason: "health" }`)
//! so the header's lamp follows within a second.

use crate::engine_events::emit_app_changed;
use crate::health::APP_CHANGED_REASON_HEALTH;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

/// Five of Companion's polls missed: the deck is not asking.
pub(crate) const DECK_QUIET_AFTER: Duration = Duration::from_secs(5);
const QUIET_WATCH_INTERVAL: Duration = Duration::from_secs(1);

static HEARD: Mutex<BTreeMap<PathBuf, Instant>> = Mutex::new(BTreeMap::new());

fn with_heard<T>(action: impl FnOnce(&mut BTreeMap<PathBuf, Instant>) -> T) -> T {
    let mut guard = HEARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

/// The bridge heard the deck: a request with the token arrived at `at`.
pub(crate) fn note_deck_heard(db_path: &Path, at: Instant) {
    with_heard(|heard| {
        let last = heard.entry(db_path.to_path_buf()).or_insert(at);
        if at > *last {
            *last = at;
        }
    });
}

/// How long ago the deck last asked, at `now`; `None` when it has not asked
/// since the hardware link started.
pub(crate) fn deck_heard_age(db_path: &Path, now: Instant) -> Option<Duration> {
    with_heard(|heard| {
        heard
            .get(db_path)
            .map(|at| now.saturating_duration_since(*at))
    })
}

/// Whether the deck asked within `DECK_QUIET_AFTER` of `now`.
pub(crate) fn deck_heard_lately(db_path: &Path, now: Instant) -> bool {
    deck_heard_age(db_path, now).is_some_and(|age| age < DECK_QUIET_AFTER)
}

/// The sentence for a deck that has not asked lately, for the probe and the
/// lamp. It names no count of seconds: the health summary that carries it is
/// read again only when the deck goes quiet or is heard (the review of #261).
/// Companion's poll runs whether a Stream Deck is plugged in or not, so it
/// speaks of Companion; `Verify live echo` proves the deck itself.
pub(crate) fn deck_quiet_sentence(db_path: &Path, now: Instant) -> String {
    let when = match deck_heard_age(db_path, now) {
        Some(_) => "in the last 5 s",
        None => "since the hardware link started",
    };
    format!(
        "Companion has not asked the deck's bridge for anything {when}. Check that it is running, with the profile from Setup imported by Full Reset & Import."
    )
}

/// Watches whether the deck went quiet or was heard again, once a second,
/// and announces each change so the header's lamp follows.
pub(crate) fn spawn_deck_quiet_watch(db_path: PathBuf) {
    let _ = thread::Builder::new()
        .name(String::from("deck-quiet-watch"))
        .spawn(move || {
            let mut heard = deck_heard_lately(&db_path, Instant::now());
            loop {
                thread::sleep(QUIET_WATCH_INTERVAL);
                let now_heard = deck_heard_lately(&db_path, Instant::now());
                if now_heard != heard {
                    heard = now_heard;
                    emit_app_changed(APP_CHANGED_REASON_HEALTH);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    // Each test notes the deck under a path of its own, so tests running side
    // by side never read one another's.
    fn path(label: &str) -> PathBuf {
        PathBuf::from(format!("deck-heard-test-{label}.sqlite3"))
    }

    #[test]
    fn a_deck_never_heard_is_quiet_and_says_since_the_start() {
        let db = path("never");
        let now = Instant::now();
        assert_eq!(deck_heard_age(&db, now), None);
        assert!(!deck_heard_lately(&db, now));
        assert!(deck_quiet_sentence(&db, now).contains("since the hardware link started"));
    }

    #[test]
    fn a_deck_heard_lately_until_five_seconds_pass() {
        let db = path("lately");
        let heard_at = Instant::now();
        note_deck_heard(&db, heard_at);
        assert!(deck_heard_lately(&db, heard_at));
        assert!(deck_heard_lately(
            &db,
            heard_at + DECK_QUIET_AFTER - Duration::from_millis(1)
        ));
        assert!(!deck_heard_lately(&db, heard_at + DECK_QUIET_AFTER));
        assert_eq!(
            deck_quiet_sentence(&db, heard_at + Duration::from_secs(12)),
            "Companion has not asked the deck's bridge for anything in the last 5 s. Check that it is running, with the profile from Setup imported by Full Reset & Import."
        );
    }

    #[test]
    fn an_older_request_handled_late_does_not_move_the_time_back() {
        let db = path("order");
        let first = Instant::now();
        let later = first + Duration::from_secs(3);
        note_deck_heard(&db, later);
        note_deck_heard(&db, first);
        assert_eq!(
            deck_heard_age(&db, later + Duration::from_secs(1)),
            Some(Duration::from_secs(1))
        );
        assert_eq!(deck_heard_age(&path("another"), later), None);
    }
}
