//! The deck's bridge's minute line (fix D, 2026-10-02). On the morning of
//! 2026-10-02 three of the bridge's four workers were held for 5 s with
//! nothing playing, and nothing said by what. Each bridge now counts its
//! minute: what it served, the longest a request waited for a worker and the
//! longest one took, the most that waited at once, and what it turned away
//! or timed out. `engine.log` gets the line for a minute that had a refusal,
//! a timeout, or a wait or handling of `SLOW` or more, and for every minute
//! in which the prompter played, beside the prompter's own line; a quiet day
//! writes nothing.

use crate::prompter::minute::{by, milliseconds};
use std::time::Duration;

/// A minute with a wait or a handling this long gets its line.
pub(crate) const SLOW: Duration = Duration::from_millis(50);

/// What a request was, for the minute's counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    /// A key or a dial of the deck: a POST to one of the pages' routes.
    Press,
    /// A display's read: `GET /api/deck/lcd`.
    Display,
    /// Anything else: the context, a refused or malformed request.
    Other,
}

/// One bridge's figures for the minute so far.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct BridgeMinute {
    pub presses: u64,
    pub displays: u64,
    pub other: u64,
    /// The longest a request waited from its arrival until a worker began on
    /// it, and what it was.
    pub longest_wait: (Duration, String),
    /// The longest a worker took over one, its answer written, and what it was.
    pub longest_handling: (Duration, String),
    /// The most connections and parked reads that waited at once.
    pub deepest: usize,
    /// Turned away because the queue was full (503).
    pub refused: u64,
    /// Requests that did not arrive in time (408).
    pub timed_out: u64,
}

impl BridgeMinute {
    pub(crate) fn note_served(
        &mut self,
        kind: Kind,
        what: &str,
        waited: Duration,
        handled: Duration,
    ) {
        match kind {
            Kind::Press => self.presses += 1,
            Kind::Display => self.displays += 1,
            Kind::Other => self.other += 1,
        }
        if waited > self.longest_wait.0 {
            self.longest_wait = (waited, what.to_string());
        }
        if handled > self.longest_handling.0 {
            self.longest_handling = (handled, what.to_string());
        }
    }

    pub(crate) fn note_depth(&mut self, depth: usize) {
        self.deepest = self.deepest.max(depth);
    }

    pub(crate) fn note_refused(&mut self) {
        self.refused += 1;
    }

    pub(crate) fn note_timed_out(&mut self) {
        self.timed_out += 1;
    }

    /// Whether the minute gets its line: something was turned away, timed
    /// out or slow, or the prompter played in it.
    pub(crate) fn worth_a_line(&self, prompter_played: bool) -> bool {
        prompter_played
            || self.refused > 0
            || self.timed_out > 0
            || self.longest_wait.0 >= SLOW
            || self.longest_handling.0 >= SLOW
    }

    /// The line, in the log's words.
    pub(crate) fn line(&self) -> String {
        format!(
            "Stream Deck bridge, the last minute: {} presses, {} displays and {} other requests served; waited for a worker {} at most{}, took {} at most{}; {} waiting at most; {} turned away busy, {} timed out.",
            self.presses,
            self.displays,
            self.other,
            milliseconds(self.longest_wait.0),
            by(&self.longest_wait.1),
            milliseconds(self.longest_handling.0),
            by(&self.longest_handling.1),
            self.deepest,
            self.refused,
            self.timed_out,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_minute_line_says_what_the_bridge_served_and_where_the_time_went() {
        let mut minute = BridgeMinute::default();
        minute.note_served(
            Kind::Display,
            "GET lcd",
            Duration::from_micros(1_200),
            Duration::from_micros(800),
        );
        minute.note_served(
            Kind::Press,
            "POST prompter-action",
            Duration::from_micros(300),
            Duration::from_millis(12),
        );
        minute.note_served(Kind::Other, "GET context", Duration::ZERO, Duration::ZERO);
        minute.note_depth(47);
        minute.note_depth(3);
        minute.note_refused();
        minute.note_timed_out();
        assert_eq!(
            minute.line(),
            "Stream Deck bridge, the last minute: 1 presses, 1 displays and 1 other requests served; waited for a worker 1.2 ms at most (GET lcd), took 12 ms at most (POST prompter-action); 47 waiting at most; 1 turned away busy, 1 timed out."
        );
    }

    #[test]
    fn a_quiet_minute_gets_no_line_unless_the_prompter_played() {
        let mut minute = BridgeMinute::default();
        minute.note_served(
            Kind::Display,
            "GET lcd",
            Duration::from_millis(2),
            Duration::from_millis(49),
        );
        minute.note_depth(64);
        assert!(!minute.worth_a_line(false), "fast, nothing turned away");
        assert!(minute.worth_a_line(true), "the prompter played");

        let slow_wait = BridgeMinute {
            longest_wait: (SLOW, String::new()),
            ..BridgeMinute::default()
        };
        let slow_handling = BridgeMinute {
            longest_handling: (SLOW, String::new()),
            ..BridgeMinute::default()
        };
        let refused = BridgeMinute {
            refused: 1,
            ..BridgeMinute::default()
        };
        let timed_out = BridgeMinute {
            timed_out: 1,
            ..BridgeMinute::default()
        };
        for minute in [slow_wait, slow_handling, refused, timed_out] {
            assert!(minute.worth_a_line(false), "{minute:?}");
        }
    }
}
