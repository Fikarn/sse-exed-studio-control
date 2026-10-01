//! Whether TotalMix is in touch on its Global OSC remote, remote 4 (the
//! studio walk of 2026-10-01).
//!
//! While nothing has come on the Global slot for 3 s, the metering loop asks
//! TotalMix for its values (`/sendall 2` and `/sendstate`) once a second, and
//! TotalMix always answers `/sendstate`. A desk that is merely still answers
//! the first request, so it is never quiet here. Two requests in a row left
//! unanswered mean TotalMix is out of touch: remote 4 switched off, or
//! TotalMix closed. The first datagram after that ends the quiet, and the
//! Console then reads assumed until a Sync: on the walk a fader moved with
//! remote 4 off never arrived, and the Console kept the old value as
//! verified.
//!
//! A link that has just begun listening asks at once, as nothing has come
//! yet; its first 3 s count as a running link's 3 s of quiet, so TotalMix
//! slow to answer the first requests is not out of touch. TotalMix that does
//! not answer at all is, and when it is heard the Console reads assumed with
//! a sentence of its own: the desk has not been read since the start.
//!
//! The struct holds no socket and every method takes the time, so the tests
//! need no sleeps. The lines it returns are for `engine.log`.

use std::time::{Duration, Instant};

/// Requests in a row that may go unanswered before TotalMix counts as quiet.
const UNANSWERED_FOR_QUIET: u32 = 2;
/// The start's grace: requests in a link's first 3 s are not counted, as a
/// running link asks only after 3 s of quiet.
const START_GRACE: Duration = Duration::from_secs(3);
/// How long after TotalMix is heard again what it sends is counted for the
/// log: long enough for a full dump, which ends about 250 ms after its
/// request.
const COUNT_AFTER: Duration = Duration::from_secs(3);

/// Whether the Global slot is in touch with TotalMix, and what it heard after
/// a quiet.
#[derive(Debug)]
pub(super) struct GlobalQuiet {
    /// The slot's own receive port, for the log.
    port: u16,
    listening_since: Instant,
    last_heard_at: Option<Instant>,
    last_request_at: Option<Instant>,
    /// Every request since TotalMix was last heard, for the log.
    requests_since_heard: u32,
    /// The requests that count towards a quiet: not those in the start's
    /// grace.
    unanswered: u32,
    quiet: bool,
    after: Option<AfterCount>,
}

/// What TotalMix sent in the first seconds after it was heard again.
#[derive(Debug)]
struct AfterCount {
    until: Instant,
    control: u64,
    levels: u64,
}

/// TotalMix heard again after a quiet: for how long it was quiet, whether it
/// had not been heard at all since the link began listening, and the line
/// for the log.
#[derive(Debug, PartialEq)]
pub(super) struct HeardAgain {
    pub(super) quiet_for: Duration,
    pub(super) since_start: bool,
    pub(super) line: String,
}

impl GlobalQuiet {
    pub(super) fn new(now: Instant, port: u16) -> Self {
        Self {
            port,
            listening_since: now,
            last_heard_at: None,
            last_request_at: None,
            requests_since_heard: 0,
            unanswered: 0,
            quiet: false,
            after: None,
        }
    }

    /// A request for TotalMix's values went out. Returns the warning once per
    /// quiet, at the request that follows two unanswered ones.
    pub(super) fn request_sent(&mut self, now: Instant) -> Option<String> {
        self.requests_since_heard = self.requests_since_heard.saturating_add(1);
        self.last_request_at = Some(now);
        let in_start_grace = self.last_heard_at.is_none()
            && now.saturating_duration_since(self.listening_since) < START_GRACE;
        if in_start_grace {
            return None;
        }
        self.unanswered = self.unanswered.saturating_add(1);
        if self.quiet || self.unanswered <= UNANSWERED_FOR_QUIET {
            return None;
        }
        self.quiet = true;
        let unanswered = self.unanswered - 1;
        Some(match self.last_heard_at {
            Some(heard) => format!(
                "TotalMix went quiet on remote 4 (port {}): nothing heard for {}, and {unanswered} requests for its values went unanswered. They go on once a second.",
                self.port,
                seconds(now.saturating_duration_since(heard))
            ),
            None => format!(
                "TotalMix has not been heard on remote 4 (port {}) since the link began listening {} ago, and {unanswered} requests for its values went unanswered. They go on once a second.",
                self.port,
                seconds(now.saturating_duration_since(self.listening_since))
            ),
        })
    }

    /// Something came from TotalMix. After a quiet, says for how long it was
    /// quiet and starts counting what it sends next.
    pub(super) fn heard(&mut self, now: Instant) -> Option<HeardAgain> {
        let requests = std::mem::take(&mut self.requests_since_heard);
        self.unanswered = 0;
        let was_quiet = std::mem::take(&mut self.quiet);
        let since = self.last_heard_at.replace(now);
        if !was_quiet {
            return None;
        }
        let quiet_for = now.saturating_duration_since(since.unwrap_or(self.listening_since));
        let last_request = self
            .last_request_at
            .map(|at| seconds(now.saturating_duration_since(at)))
            .unwrap_or_else(|| String::from("never"));
        self.after = Some(AfterCount {
            until: now + COUNT_AFTER,
            control: 0,
            levels: 0,
        });
        let when = match since {
            Some(_) => format!("again after {} quiet", seconds(quiet_for)),
            None => format!(
                "for the first time, {} after the link began listening",
                seconds(quiet_for)
            ),
        };
        Some(HeardAgain {
            quiet_for,
            since_start: since.is_none(),
            line: format!(
                "TotalMix heard on remote 4 (port {}) {when}; {requests} requests for its values went out meanwhile, the last {last_request} before.",
                self.port
            ),
        })
    }

    /// Counts what TotalMix sent while the count after a quiet is open:
    /// control values (everything but `/level/`, as a Sync counts them) and
    /// levels.
    pub(super) fn count(&mut self, control: u64, levels: u64) {
        if let Some(after) = self.after.as_mut() {
            after.control = after.control.saturating_add(control);
            after.levels = after.levels.saturating_add(levels);
        }
    }

    /// The count's line, once its time is up.
    pub(super) fn count_closed_at(&mut self, now: Instant) -> Option<String> {
        if self.after.as_ref().is_none_or(|after| now < after.until) {
            return None;
        }
        let after = self.after.take()?;
        Some(format!(
            "In the {} s after TotalMix was heard again on remote 4 it sent {} control values and {} levels (a full dump is 3,100 to 3,500 control values).",
            COUNT_AFTER.as_secs(),
            after.control,
            after.levels
        ))
    }
}

/// `5.2 s`: tenths are enough for the log.
fn seconds(duration: Duration) -> String {
    format!("{:.1} s", duration.as_secs_f64())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 9004;

    fn at(start: Instant, millis: u64) -> Instant {
        start + Duration::from_millis(millis)
    }

    #[test]
    fn a_still_desk_that_answers_each_request_never_goes_quiet() {
        let start = Instant::now();
        let mut quiet = GlobalQuiet::new(start, PORT);
        assert_eq!(quiet.heard(start), None);
        for second in 1..=10 {
            let asked = at(start, second * 4_000);
            assert_eq!(quiet.request_sent(asked), None);
            assert_eq!(quiet.heard(at(start, second * 4_000 + 30)), None);
        }
    }

    #[test]
    fn two_unanswered_requests_make_remote_4_quiet_once() {
        let start = Instant::now();
        let mut quiet = GlobalQuiet::new(start, PORT);
        quiet.heard(start);
        assert_eq!(quiet.request_sent(at(start, 3_000)), None);
        assert_eq!(quiet.request_sent(at(start, 4_000)), None);
        assert_eq!(
            quiet.request_sent(at(start, 5_000)),
            Some(String::from(
                "TotalMix went quiet on remote 4 (port 9004): nothing heard for 5.0 s, and 2 requests for its values went unanswered. They go on once a second."
            ))
        );
        for second in 6..=30 {
            assert_eq!(quiet.request_sent(at(start, second * 1_000)), None);
        }
    }

    #[test]
    fn quiet_from_the_start_counts_from_when_the_link_began_listening() {
        let start = Instant::now();
        let mut quiet = GlobalQuiet::new(start, PORT);
        // The first 3 s are the start's grace, as a running link's quiet.
        for second in 0..3 {
            assert_eq!(quiet.request_sent(at(start, second * 1_000)), None);
        }
        assert_eq!(quiet.request_sent(at(start, 3_000)), None);
        assert_eq!(quiet.request_sent(at(start, 4_000)), None);
        assert_eq!(
            quiet.request_sent(at(start, 5_000)),
            Some(String::from(
                "TotalMix has not been heard on remote 4 (port 9004) since the link began listening 5.0 s ago, and 2 requests for its values went unanswered. They go on once a second."
            ))
        );
        let back = quiet.heard(at(start, 31_400)).expect("heard after a quiet");
        assert_eq!(back.quiet_for, Duration::from_millis(31_400));
        assert!(back.since_start);
        assert!(
            back.line
                .starts_with("TotalMix heard on remote 4 (port 9004) for the first time, 31.4 s after the link began listening; 6 requests"),
            "{}",
            back.line
        );
    }

    #[test]
    fn totalmix_slow_to_answer_at_the_start_is_not_out_of_touch() {
        let start = Instant::now();
        let mut quiet = GlobalQuiet::new(start, PORT);
        assert_eq!(quiet.request_sent(start), None);
        assert_eq!(quiet.request_sent(at(start, 1_000)), None);
        assert_eq!(quiet.request_sent(at(start, 2_000)), None);
        assert_eq!(quiet.heard(at(start, 2_400)), None, "answered in the grace");
    }

    #[test]
    fn heard_again_says_how_long_and_counts_what_follows() {
        let start = Instant::now();
        let mut quiet = GlobalQuiet::new(start, PORT);
        quiet.heard(start);
        // Asked once a second from 3 s on: 28 requests, the last at 30.8 s.
        for request in 0..28 {
            quiet.request_sent(at(start, 3_000 + request * 1_000 + (request / 27) * 800));
        }
        // What came before the quiet ended is not counted.
        quiet.count(5, 5);
        let back = quiet.heard(at(start, 31_400)).expect("heard after a quiet");
        assert_eq!(back.quiet_for, Duration::from_millis(31_400));
        assert!(!back.since_start);
        assert_eq!(
            back.line,
            "TotalMix heard on remote 4 (port 9004) again after 31.4 s quiet; 28 requests for its values went out meanwhile, the last 0.6 s before."
        );
        assert_eq!(quiet.heard(at(start, 31_450)), None, "once per quiet");

        quiet.count(3_200, 40);
        quiet.count(14, 142);
        assert_eq!(quiet.count_closed_at(at(start, 34_300)), None);
        assert_eq!(
            quiet.count_closed_at(at(start, 34_400)),
            Some(String::from(
                "In the 3 s after TotalMix was heard again on remote 4 it sent 3214 control values and 182 levels (a full dump is 3,100 to 3,500 control values)."
            ))
        );
        assert_eq!(quiet.count_closed_at(at(start, 40_000)), None);
        quiet.count(1, 1);
        assert_eq!(quiet.count_closed_at(at(start, 50_000)), None);
    }

    #[test]
    fn heard_without_a_declared_quiet_marks_nothing() {
        let start = Instant::now();
        let mut quiet = GlobalQuiet::new(start, PORT);
        quiet.heard(start);
        quiet.request_sent(at(start, 3_000));
        quiet.request_sent(at(start, 4_000));
        assert_eq!(
            quiet.heard(at(start, 4_200)),
            None,
            "two requests are not a quiet yet"
        );
        quiet.count(3_000, 0);
        assert_eq!(quiet.count_closed_at(at(start, 9_000)), None);
        // The count starts again from the last time TotalMix was heard.
        assert_eq!(quiet.request_sent(at(start, 7_200)), None);
        assert_eq!(quiet.request_sent(at(start, 8_200)), None);
        assert!(quiet.request_sent(at(start, 9_200)).is_some());
    }
}
