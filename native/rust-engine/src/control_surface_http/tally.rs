//! The bridge's log lines of one kind, a refusal's status or a failed
//! request's kind: one a minute at most, and the next line of that kind counts
//! those between (2026-09-28 for the refusals, 2026-10-01 for the failures).
//! Split out of `control_surface_http.rs` under the 2,000-line file-health
//! guard.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const REJECTION_LOG_INTERVAL: Duration = Duration::from_secs(60);

/// When a line of one kind (a refusal's status, a failure's kind) was last
/// written to the log, and how many of that kind have gone unwritten since.
pub(super) struct RejectionTally {
    last_written: Instant,
    unwritten: u64,
}

/// Whether the line for `key` is due, one a `REJECTION_LOG_INTERVAL` at
/// most: `Some` with how many went unwritten since the last line of that
/// key, or `None` when this one is only counted.
pub(super) fn tally_line_due<K: Eq + Hash>(
    tallies: &Mutex<HashMap<K, RejectionTally>>,
    key: K,
    now: Instant,
) -> Option<u64> {
    let mut recent = tallies
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match recent.get_mut(&key) {
        Some(tally)
            if now.saturating_duration_since(tally.last_written) < REJECTION_LOG_INTERVAL =>
        {
            tally.unwritten += 1;
            None
        }
        Some(tally) => {
            let unwritten = tally.unwritten;
            *tally = RejectionTally {
                last_written: now,
                unwritten: 0,
            };
            Some(unwritten)
        }
        None => {
            recent.insert(
                key,
                RejectionTally {
                    last_written: now,
                    unwritten: 0,
                },
            );
            Some(0)
        }
    }
}
