//! The bridge watch: whether the Apollo Bridge still answers, during a
//! session (Found, to check, 2026-09-28; the owner's decision, 2026-09-29).
//!
//! Until then `REACHABLE` and the lamp's `ready` came from Setup's last
//! lighting probe, and nothing looked at the bridge again. The watch looks
//! every `WATCH_INTERVAL`, the way the probe does (a connection to port 80,
//! `look_at_bridge`), off the request loop. Two silent looks in a row make the
//! bridge `not answering`; one answer makes it answering again.
//!
//! The watch says it and locks nothing (the owner, 2026-09-29): the sACN
//! stream never needed port 80, so what is pressed is still sent. The lock
//! stays Setup's probe's (`lighting_refusal`). The lighting snapshot carries
//! the watch's word (`bridgeAnswering`, `bridgeSilentSince`), and a change of
//! it is `lighting.changed { reason: "bridge" }`.
//!
//! Only a studio build watches: with the simulated lights, as every test and
//! development run has, the watch is not started and contacts nothing.
//!
//! A development build can be told to stall (D46): a look at the address
//! `SSE_BRIDGE_LOOK_STALLS` names waits the whole timeout and finds silence,
//! and no connection is made. The Setup/Support lane sets it for its
//! stalled-request check, which until 2026-10-09 connected to an address of
//! no network instead, and so kept the lane off the studio PC.
//!
//! A refused connection counts as an answer, as it does for the probe: the
//! refusal comes from the address itself. On Windows it hardly arises: after a
//! refusal Windows tries twice more and reports it about 2 s later (measured
//! on the studio PC, 2026-09-29), past the 1.5 s a look waits, so a refusal
//! reads as silence. The studio's probe has passed, so the bridge takes the
//! connection. The log says which answer came, the first time and at every
//! change.

use crate::app_state::APP_SETTINGS_PREFIX;
use crate::cameras::runtime::utc_text;
use crate::diagnostics::append_log;
use crate::lighting::lighting_watched_bridge;
use crate::lighting_sacn_output::{simulated_lights_requested, LIGHTS_SIMULATED_ENV};
use crate::storage::{enable_thread_read_connection, list_settings_by_prefix};
use std::io::ErrorKind;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime};
use studio_control_protocol::development::{
    bridge_look_stall_address, development_build, BRIDGE_LOOK_STALLS_ENV,
};

/// The port the probe and the watch knock on: the bridge's web page.
pub(crate) const BRIDGE_PORT: u16 = 80;
/// How long a look waits for an answer: the probe's time.
pub(crate) const BRIDGE_LOOK_TIMEOUT: Duration = Duration::from_millis(1500);
const WATCH_INTERVAL: Duration = Duration::from_secs(5);
/// Silent looks in a row before the bridge is `not answering`: one lost
/// connection on a busy network is not a bridge that went.
const SILENT_LOOKS_TO_NOT_ANSWERING: u32 = 2;

/// What one look at the bridge found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BridgeAnswer {
    /// It took the connection.
    Accepted,
    /// It refused the connection: something at the address answered.
    Refused,
    /// Nothing answered in time, or the address cannot be reached from here.
    Silent,
}

impl BridgeAnswer {
    pub(crate) fn answers(self) -> bool {
        !matches!(self, BridgeAnswer::Silent)
    }
}

/// One look at `address`: a connection, closed at once, and nothing sent.
/// The probe and the watch both look this way.
pub(crate) fn look_at_bridge(address: SocketAddr, timeout: Duration) -> BridgeAnswer {
    look_at_bridge_or_stall(address, timeout, stalled_address())
}

/// The address a development build's looks stall at
/// (`BRIDGE_LOOK_STALLS_ENV`), read once; `None` in a studio build.
fn stalled_address() -> Option<Ipv4Addr> {
    static STALLED: OnceLock<Option<Ipv4Addr>> = OnceLock::new();
    *STALLED.get_or_init(|| {
        if !development_build() {
            return None;
        }
        std::env::var(BRIDGE_LOOK_STALLS_ENV)
            .ok()
            .and_then(|value| bridge_look_stall_address(&value))
    })
}

/// `look_at_bridge` with the stalled address given: a look at it waits the
/// whole timeout and finds silence, and no connection is made.
fn look_at_bridge_or_stall(
    address: SocketAddr,
    timeout: Duration,
    stalled: Option<Ipv4Addr>,
) -> BridgeAnswer {
    if stalled.is_some_and(|stalled| address.ip() == IpAddr::V4(stalled)) {
        thread::sleep(timeout);
        return BridgeAnswer::Silent;
    }
    match TcpStream::connect_timeout(&address, timeout) {
        Ok(stream) => {
            let _ = stream.shutdown(std::net::Shutdown::Both);
            BridgeAnswer::Accepted
        }
        Err(error) if error.kind() == ErrorKind::ConnectionRefused => BridgeAnswer::Refused,
        Err(_) => BridgeAnswer::Silent,
    }
}

/// What the watch says of the bridge, for the lighting snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BridgeWatchReport {
    pub answering: bool,
    /// When the first look of the silence was, UTC; `None` while it answers.
    pub silent_since: Option<String>,
}

/// What a look changed, for the log and the event.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct WatchChange {
    /// The log line, when the answer's kind or the verdict moved.
    log: Option<String>,
    /// The verdict moved: the screen hears of it.
    verdict_moved: bool,
}

/// The watch's memory of one address.
#[derive(Debug)]
struct Watch {
    address: Ipv4Addr,
    /// The last answer that was one (taken or refused), for the log: a
    /// silent look between two alike is not worth a line (the review of #260).
    last_answering_kind: Option<BridgeAnswer>,
    silent_looks: u32,
    silent_since: Option<String>,
    /// `None` until the first verdict: one answer, or two silent looks.
    answering: Option<bool>,
}

impl Watch {
    fn new(address: Ipv4Addr) -> Self {
        Self {
            address,
            last_answering_kind: None,
            silent_looks: 0,
            silent_since: None,
            answering: None,
        }
    }

    fn take(&mut self, answer: BridgeAnswer, now: SystemTime) -> WatchChange {
        let kind_moved = answer.answers() && self.last_answering_kind != Some(answer);
        if answer.answers() {
            self.last_answering_kind = Some(answer);
        }
        let before = self.answering;
        if answer.answers() {
            self.silent_looks = 0;
            self.silent_since = None;
            self.answering = Some(true);
        } else {
            if self.silent_looks == 0 {
                self.silent_since = Some(utc_text(now));
            }
            self.silent_looks = self.silent_looks.saturating_add(1);
            if self.silent_looks >= SILENT_LOOKS_TO_NOT_ANSWERING {
                self.answering = Some(false);
            }
        }
        let verdict_moved = self.answering != before;
        let address = self.address;
        let log = if verdict_moved && self.answering == Some(false) {
            Some(format!(
                "The bridge at {address} has not answered on port {BRIDGE_PORT} for {SILENT_LOOKS_TO_NOT_ANSWERING} looks in a row: Lighting says so, and nothing is locked."
            ))
        } else if answer.answers() && (verdict_moved || kind_moved) {
            let again = if before == Some(false) { " again" } else { "" };
            Some(match answer {
                BridgeAnswer::Accepted => {
                    format!("The bridge at {address} answers{again}: it took a connection on port {BRIDGE_PORT}.")
                }
                _ => format!(
                    "The bridge at {address} answers{again}: it refused a connection on port {BRIDGE_PORT}, so something is at that address."
                ),
            })
        } else {
            None
        };
        WatchChange { log, verdict_moved }
    }

    fn report(&self) -> Option<BridgeWatchReport> {
        self.answering.map(|answering| BridgeWatchReport {
            answering,
            silent_since: if answering {
                None
            } else {
                self.silent_since.clone()
            },
        })
    }
}

static WATCH: Mutex<Option<Watch>> = Mutex::new(None);

fn with_watch<T>(action: impl FnOnce(&mut Option<Watch>) -> T) -> T {
    let mut guard = WATCH
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

/// What the watch says of the bridge at `bridge_ip`; `None` when it is not
/// watching that address or has no verdict yet (the snapshot then reads as
/// Setup's probe left it).
pub(crate) fn bridge_watch_report(bridge_ip: &str) -> Option<BridgeWatchReport> {
    let address = bridge_ip.trim().parse::<Ipv4Addr>().ok()?;
    with_watch(|watch| {
        watch
            .as_ref()
            .filter(|watch| watch.address == address)
            .and_then(Watch::report)
    })
}

/// Starts the watch in a studio build. With the simulated lights it is not
/// started: nothing is looked at.
pub fn spawn_lighting_bridge_watch(db_path: PathBuf, log_file_path: PathBuf) {
    let simulated =
        std::env::var(LIGHTS_SIMULATED_ENV).is_ok_and(|value| simulated_lights_requested(&value));
    if simulated {
        return;
    }
    let _ = thread::Builder::new()
        .name(String::from("bridge-watch"))
        .spawn(move || run_watch(&db_path, &log_file_path));
}

fn run_watch(db_path: &Path, log_file_path: &Path) {
    enable_thread_read_connection();
    loop {
        // A read that fails leaves the watch as it was, and is tried again.
        if let Ok(settings) = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX) {
            let target = lighting_watched_bridge(&settings);
            let answer = target.map(|address| {
                look_at_bridge(
                    SocketAddr::from((address, BRIDGE_PORT)),
                    BRIDGE_LOOK_TIMEOUT,
                )
            });
            let change = apply_look(target, answer, SystemTime::now());
            if let Some(line) = &change.log {
                let _ = append_log(log_file_path, "INFO", line);
            }
            if change.verdict_moved {
                crate::engine_events::emit_lighting_changed("bridge");
            }
        }
        thread::sleep(WATCH_INTERVAL);
    }
}

/// Takes one look's answer for `target`. A new address starts a new watch;
/// no address (lighting off, none set) ends it.
fn apply_look(
    target: Option<Ipv4Addr>,
    answer: Option<BridgeAnswer>,
    now: SystemTime,
) -> WatchChange {
    with_watch(|watch| {
        let (Some(address), Some(answer)) = (target, answer) else {
            let had_verdict = watch.take().is_some_and(|old| old.answering.is_some());
            return WatchChange {
                log: None,
                verdict_moved: had_verdict,
            };
        };
        // Another address than the one watched: the old address's word
        // leaves the screen, and the new one starts without a verdict.
        let mut dropped_verdict = false;
        if watch
            .as_ref()
            .is_none_or(|current| current.address != address)
        {
            dropped_verdict = watch.as_ref().is_some_and(|old| old.answering.is_some());
            *watch = Some(Watch::new(address));
        }
        let mut change = watch
            .as_mut()
            .map(|current| current.take(answer, now))
            .unwrap_or_default();
        change.verdict_moved |= dropped_verdict;
        change
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn at(seconds: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_790_000_000 + seconds)
    }

    // Every look here is at 127.0.0.1, on a port this test was given: a
    // listener that takes the connection, or a port whose listener is gone.
    #[test]
    fn a_look_tells_a_connection_from_a_refusal() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("a listener binds");
        let open = listener.local_addr().expect("its address");
        assert_eq!(
            look_at_bridge(open, BRIDGE_LOOK_TIMEOUT),
            BridgeAnswer::Accepted
        );

        // A port given up at once; another test may take the same port in
        // between, so up to three are tried (the review of #260). Windows
        // reports a refusal about 2 s after it (it tries twice more), so the
        // look waits longer here than the watch's 1.5 s.
        let refused = (0..3).any(|_| {
            let closed = {
                let gone = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("a listener binds");
                gone.local_addr().expect("its address")
            };
            look_at_bridge(closed, Duration::from_secs(10)) == BridgeAnswer::Refused
        });
        assert!(refused, "a port nobody listens on refuses");
        assert!(BridgeAnswer::Refused.answers());
        assert!(!BridgeAnswer::Silent.answers());
    }

    // 2026-10-09 (D46): the Setup/Support lane's stalled-request check asks
    // the engine to stall at an address of no network instead of connecting
    // to one, so the lane runs on the studio PC without a packet.
    //
    // The stalled address here is a loopback listener's, which would take the
    // connection: a look that answers silence after the timeout made none (a
    // broken stall would answer `Accepted`), and no packet leaves the host
    // either way. A documentation address would prove nothing: a look that
    // did connect would time out and answer silence too, and from this PC
    // that packet could leave towards the lighting bridge (the review of
    // #332).
    #[test]
    fn a_look_at_the_stalled_address_waits_the_whole_timeout_and_connects_nowhere() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("a listener binds");
        let open = listener.local_addr().expect("its address");
        let timeout = Duration::from_millis(80);
        let started = std::time::Instant::now();
        assert_eq!(
            look_at_bridge_or_stall(open, timeout, Some(Ipv4Addr::LOCALHOST)),
            BridgeAnswer::Silent,
            "the listener would accept: silence means no connection was made"
        );
        assert!(
            started.elapsed() >= timeout,
            "the look waits the whole timeout"
        );

        // Every other address is looked at as before: the same listener,
        // with another address stalled, takes the connection.
        assert_eq!(
            look_at_bridge_or_stall(
                open,
                BRIDGE_LOOK_TIMEOUT,
                Some(Ipv4Addr::new(203, 0, 113, 113))
            ),
            BridgeAnswer::Accepted
        );
        // Tests run with nothing set: the looks of this process stall nowhere.
        assert_eq!(stalled_address(), None);
    }

    #[test]
    fn two_silent_looks_make_the_bridge_not_answering_and_one_answer_brings_it_back() {
        let address = Ipv4Addr::new(10, 1, 0, 1);
        let mut watch = Watch::new(address);
        assert_eq!(watch.report(), None, "no verdict before the first look");

        let first = watch.take(BridgeAnswer::Refused, at(0));
        assert!(first.verdict_moved);
        assert_eq!(
            first.log.as_deref(),
            Some("The bridge at 10.1.0.1 answers: it refused a connection on port 80, so something is at that address.")
        );
        assert_eq!(
            watch.report(),
            Some(BridgeWatchReport {
                answering: true,
                silent_since: None
            })
        );
        assert_eq!(
            watch.take(BridgeAnswer::Refused, at(5)),
            WatchChange::default(),
            "the same answer again: nothing to say"
        );

        let one_silent = watch.take(BridgeAnswer::Silent, at(10));
        assert_eq!(
            one_silent,
            WatchChange::default(),
            "one silent look is not a verdict"
        );
        assert_eq!(watch.report().map(|report| report.answering), Some(true));

        let two_silent = watch.take(BridgeAnswer::Silent, at(15));
        assert!(two_silent.verdict_moved);
        assert!(two_silent.log.as_deref().is_some_and(
            |line| line.contains("has not answered") && line.contains("nothing is locked")
        ));
        assert_eq!(
            watch.report(),
            Some(BridgeWatchReport {
                answering: false,
                silent_since: Some(utc_text(at(10))),
            }),
            "silent since the first silent look"
        );
        assert_eq!(
            watch.take(BridgeAnswer::Silent, at(20)),
            WatchChange::default()
        );
        assert_eq!(
            watch.report().and_then(|report| report.silent_since),
            Some(utc_text(at(10)))
        );

        let back = watch.take(BridgeAnswer::Accepted, at(25));
        assert!(back.verdict_moved);
        assert_eq!(
            back.log.as_deref(),
            Some("The bridge at 10.1.0.1 answers again: it took a connection on port 80.")
        );
        assert_eq!(
            watch.report(),
            Some(BridgeWatchReport {
                answering: true,
                silent_since: None
            })
        );
    }

    // The review of #260: one silent look between two answers alike is no
    // verdict and no line in the log.
    #[test]
    fn one_missed_look_says_nothing() {
        let mut watch = Watch::new(Ipv4Addr::new(10, 1, 0, 1));
        assert!(watch.take(BridgeAnswer::Accepted, at(0)).log.is_some());
        assert_eq!(
            watch.take(BridgeAnswer::Silent, at(5)),
            WatchChange::default()
        );
        assert_eq!(
            watch.take(BridgeAnswer::Accepted, at(10)),
            WatchChange::default()
        );
        // A different kind of answer is worth its line.
        let refused = watch.take(BridgeAnswer::Refused, at(15));
        assert!(!refused.verdict_moved);
        assert_eq!(
            refused.log.as_deref(),
            Some("The bridge at 10.1.0.1 answers: it refused a connection on port 80, so something is at that address.")
        );
    }

    #[test]
    fn a_bridge_silent_from_the_start_is_not_answering_after_two_looks() {
        let mut watch = Watch::new(Ipv4Addr::new(10, 1, 0, 1));
        assert_eq!(
            watch.take(BridgeAnswer::Silent, at(0)),
            WatchChange::default()
        );
        assert_eq!(watch.report(), None);
        assert!(watch.take(BridgeAnswer::Silent, at(5)).verdict_moved);
        assert_eq!(watch.report().map(|report| report.answering), Some(false));
        let first_answer = watch.take(BridgeAnswer::Accepted, at(10));
        assert_eq!(
            first_answer.log.as_deref(),
            Some("The bridge at 10.1.0.1 answers again: it took a connection on port 80.")
        );
    }

    // The watch is one per process; this test alone touches it, and on
    // addresses of the documentation range (192.0.2.0/24) that no other test's
    // rig has, so a lighting snapshot read beside it never sees its word.
    #[test]
    fn the_report_follows_the_watched_address_and_ends_with_it() {
        let bridge = Ipv4Addr::new(192, 0, 2, 10);
        let other = Ipv4Addr::new(192, 0, 2, 11);
        assert_eq!(bridge_watch_report("192.0.2.10"), None);

        assert!(apply_look(Some(bridge), Some(BridgeAnswer::Accepted), at(0)).verdict_moved);
        assert_eq!(
            bridge_watch_report(" 192.0.2.10 ").map(|report| report.answering),
            Some(true)
        );
        assert_eq!(bridge_watch_report("192.0.2.11"), None, "another address");
        assert_eq!(bridge_watch_report("not an address"), None);

        // Setup takes another address: the old word leaves, the new one has
        // no verdict until its own answer.
        let moved = apply_look(Some(other), Some(BridgeAnswer::Silent), at(5));
        assert!(
            moved.verdict_moved,
            "the screen drops the old address's word"
        );
        assert_eq!(bridge_watch_report("192.0.2.10"), None);
        assert_eq!(bridge_watch_report("192.0.2.11"), None);

        // Lighting switched off: the watch ends.
        apply_look(Some(other), Some(BridgeAnswer::Accepted), at(10));
        assert!(apply_look(None, None, at(15)).verdict_moved);
        assert_eq!(bridge_watch_report("192.0.2.11"), None);
        assert_eq!(apply_look(None, None, at(20)), WatchChange::default());
    }
}
