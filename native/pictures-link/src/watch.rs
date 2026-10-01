//! The helper's watch over its own threads (the camera pictures, D30). Each
//! thread that must keep moving beats: the draw loop while it draws, NDI's
//! search, and each camera's receiver. One that has not beaten for `STALL`
//! makes the helper go silent, and the hardware link's rule then ends it and
//! starts it again (`pictures_helper.rs`: five silent seconds). A hung draw,
//! or a receiver stuck in NDI's library, costs the pictures for a few seconds
//! and nothing else.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// A thread this long without a beat has stopped.
pub const STALL: Duration = Duration::from_secs(4);

/// The last beat of each thread that must keep moving.
#[derive(Default)]
pub struct Beats {
    last: Mutex<HashMap<String, Instant>>,
}

impl Beats {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Instant>> {
        self.last
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// `who` moves: now.
    pub fn beat(&self, who: &str) {
        self.beat_at(who, Instant::now());
    }

    /// `who` moved at `at`.
    pub fn beat_at(&self, who: &str, at: Instant) {
        let mut last = self.lock();
        match last.get_mut(who) {
            Some(beat) => *beat = at,
            None => {
                last.insert(String::from(who), at);
            }
        }
    }

    /// `who` waits for nothing that can hang, or has ended: it is not
    /// watched until it beats again.
    pub fn rest(&self, who: &str) {
        self.lock().remove(who);
    }

    /// The thread that has stopped, if one has.
    pub fn stalled(&self, now: Instant) -> Option<String> {
        let last = self.lock();
        stalled(last.iter().map(|(who, at)| (who.as_str(), *at)), now).map(String::from)
    }
}

/// Of the threads' last beats, the one longest past `STALL`, if any is.
pub fn stalled<'a>(
    beats: impl IntoIterator<Item = (&'a str, Instant)>,
    now: Instant,
) -> Option<&'a str> {
    beats
        .into_iter()
        .filter(|(_, at)| now.saturating_duration_since(*at) >= STALL)
        .min_by_key(|(_, at)| *at)
        .map(|(who, _)| who)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thread_four_seconds_without_a_beat_has_stopped() {
        let start = Instant::now();
        let at = |millis: u64| start + Duration::from_millis(millis);
        let beats = [("the draw loop", at(0)), ("CAM 2's receiver", at(1_000))];
        assert_eq!(stalled(beats, at(3_999)), None);
        assert_eq!(stalled(beats, at(4_000)), Some("the draw loop"));
        assert_eq!(
            stalled(beats, at(9_000)),
            Some("the draw loop"),
            "the longest first"
        );
        assert_eq!(stalled([], at(60_000)), None);
    }

    #[test]
    fn a_thread_at_rest_is_not_watched() {
        let beats = Beats::default();
        beats.beat("the draw loop");
        let later = Instant::now() + STALL;
        assert_eq!(beats.stalled(later).as_deref(), Some("the draw loop"));
        beats.rest("the draw loop");
        assert_eq!(beats.stalled(later), None);
        beats.beat("the draw loop");
        assert_eq!(beats.stalled(Instant::now()), None);
    }
}
