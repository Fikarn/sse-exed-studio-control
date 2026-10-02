//! The prompter's minute line (2026-10-02, after the afternoon recording):
//! while the text plays, `engine.log` gets one line a minute with the longest
//! the prompter's lock was held and waited for, and by what, what the saver
//! wrote and how long its longest write took, and how many anchors went to
//! the views. A recording that stutters again then says where the time went.
//!
//! Every taking of the prompter's lock goes through `runtime::hold`, which
//! notes the wait and the hold here. The figures are the process's: one
//! prompter runs in the live app.

use crate::prompter::saver::SaverCounts;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

/// The minute's figures so far.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Minute {
    /// The longest the lock was held, and by what.
    pub longest_hold: (Duration, String),
    /// The longest anything waited for the lock, and what.
    pub longest_wait: (Duration, String),
    /// Anchors that went into a reply or an event.
    pub anchors: u64,
}

static MINUTE: Mutex<Minute> = Mutex::new(Minute {
    longest_hold: (Duration::ZERO, String::new()),
    longest_wait: (Duration::ZERO, String::new()),
    anchors: 0,
});

/// A leaf lock: nothing else is taken while it is held.
fn minute() -> MutexGuard<'static, Minute> {
    MINUTE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn note_hold(what: &str, held: Duration) {
    let mut minute = minute();
    if held > minute.longest_hold.0 {
        minute.longest_hold = (held, what.to_string());
    }
}

pub(crate) fn note_wait(what: &str, waited: Duration) {
    let mut minute = minute();
    if waited > minute.longest_wait.0 {
        minute.longest_wait = (waited, what.to_string());
    }
}

pub(crate) fn note_anchor() {
    minute().anchors += 1;
}

/// The minute's figures, and the next minute starts from nothing.
pub(crate) fn take() -> Minute {
    std::mem::take(&mut *minute())
}

fn milliseconds(duration: Duration) -> String {
    let ms = duration.as_secs_f64() * 1000.0;
    if ms < 10.0 {
        format!("{ms:.1} ms")
    } else {
        format!("{ms:.0} ms")
    }
}

fn by(what: &str) -> String {
    if what.is_empty() {
        String::new()
    } else {
        format!(" ({what})")
    }
}

/// The line, in the log's words.
pub(crate) fn line(minute: &Minute, saver: SaverCounts) -> String {
    format!(
        "Prompter, the last minute: its lock held {} at most{}, waited for {} at most{}; {} saved, {} refused, {} failed, the longest write {}; {} anchors sent.",
        milliseconds(minute.longest_hold.0),
        by(&minute.longest_hold.1),
        milliseconds(minute.longest_wait.0),
        by(&minute.longest_wait.1),
        saver.saved,
        saver.refused,
        saver.failed,
        milliseconds(saver.longest),
        minute.anchors,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_minute_line_says_where_the_time_went() {
        let minute = Minute {
            longest_hold: (
                Duration::from_micros(2_400),
                String::from("prompter.update"),
            ),
            longest_wait: (Duration::from_millis(31), String::from("deck speed")),
            anchors: 41,
        };
        let saver = SaverCounts {
            saved: 58,
            refused: 1,
            failed: 0,
            longest: Duration::from_millis(449),
        };
        assert_eq!(
            line(&minute, saver),
            "Prompter, the last minute: its lock held 2.4 ms at most (prompter.update), waited for 31 ms at most (deck speed); 58 saved, 1 refused, 0 failed, the longest write 449 ms; 41 anchors sent."
        );
        assert_eq!(
            line(&Minute::default(), SaverCounts::default()),
            "Prompter, the last minute: its lock held 0.0 ms at most, waited for 0.0 ms at most; 0 saved, 0 refused, 0 failed, the longest write 0.0 ms; 0 anchors sent."
        );
    }
}
