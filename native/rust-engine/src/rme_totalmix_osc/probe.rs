//! Setup's audio probe (the audit of 2026-10-12, M4).
//!
//! The probe used to send bytes nobody reads to the typed address and pass when
//! levels were already arriving from whatever address was bound; the typed
//! address and ports were never exercised. It now asks the metering loop, which
//! owns the sockets, to ask TotalMix for its status on the Global remote at the
//! address and ports the probe was given, and passes only when TotalMix
//! answers from that address on that port. The probe posts its request here;
//! the metering loop serves it at each poll once it has bound the slots for
//! those settings (the settings refresh, 500 ms at most), and answers through
//! the probe's channel.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::GlobalOscSlot;

/// The settings a probe asks TotalMix's answer for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProbeKey {
    pub host: String,
    pub send_port: i64,
    pub receive_port: i64,
}

impl ProbeKey {
    fn matches(&self, bound: &(String, i64, i64)) -> bool {
        bound.0.trim() == self.host.trim()
            && bound.1 == self.send_port
            && bound.2 == self.receive_port
    }
}

/// How a probe ended.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProbeAnswer {
    /// TotalMix answered on remote 4 from the probe's address.
    Answered,
    /// The slots for the probe's settings are bound, but the Global remote's
    /// receive port could not be: another program holds it.
    SlotUnbound,
    /// Nothing came back before the deadline. `asked` says whether the
    /// request went out at all: it does not while the loop has not bound the
    /// probe's settings (OSC off, or the settings not yet re-read).
    Unanswered { asked: bool },
}

/// Why a probe was not run at all.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProbeRefused {
    /// The metering thread is not running (a test, or a start that did not
    /// start it): nobody would send the request.
    NoMetering,
    /// Another probe is still waiting for its answer.
    Busy,
}

struct PendingProbe {
    key: ProbeKey,
    deadline: Instant,
    /// When the request went out, once the slots matched the key.
    asked_at: Option<Instant>,
    /// The slot's count of datagrams heard when the request went out.
    heard_before: u64,
    reply: SyncSender<ProbeAnswer>,
}

/// Where a probe waits for the metering loop: one at a time.
pub(crate) struct ProbeMailbox {
    pending: Mutex<Option<PendingProbe>>,
}

pub(super) static PROBE_MAILBOX: ProbeMailbox = ProbeMailbox::new();

/// Whether the metering loop is running, so a posted probe will be served.
pub(super) static METERING_RUNNING: AtomicBool = AtomicBool::new(false);

impl ProbeMailbox {
    pub(crate) const fn new() -> Self {
        Self {
            pending: Mutex::new(None),
        }
    }

    fn take_lock(&self) -> MutexGuard<'_, Option<PendingProbe>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Posts a probe; the answer comes on the receiver by `deadline` at the
    /// latest, once the loop serves it.
    pub(super) fn post(
        &self,
        key: ProbeKey,
        deadline: Instant,
    ) -> Result<Receiver<ProbeAnswer>, ProbeRefused> {
        let mut pending = self.take_lock();
        if pending.is_some() {
            return Err(ProbeRefused::Busy);
        }
        let (reply, receiver) = sync_channel(1);
        *pending = Some(PendingProbe {
            key,
            deadline,
            asked_at: None,
            heard_before: 0,
            reply,
        });
        Ok(receiver)
    }

    /// Forgets a probe nobody waits for any more.
    pub(super) fn withdraw(&self) {
        *self.take_lock() = None;
    }

    /// One poll's service of the pending probe, if any: the request goes out
    /// once the loop's bound settings are the probe's (`bound`, with the slot
    /// they bound), the answer is TotalMix's first datagram after it, and the
    /// deadline ends an unanswered one. `host` is the bound settings' host.
    pub(super) fn service(
        &self,
        bound: Option<&(String, i64, i64)>,
        slot: Option<&GlobalOscSlot>,
        now: Instant,
    ) {
        let mut pending = self.take_lock();
        let Some(probe) = pending.as_mut() else {
            return;
        };
        let answer = match bound.filter(|bound| probe.key.matches(bound)) {
            Some(bound) => match slot {
                None => Some(ProbeAnswer::SlotUnbound),
                Some(slot) if probe.asked_at.is_none() => {
                    probe.heard_before = slot.heard;
                    if slot.ask_for_state(&bound.0) {
                        probe.asked_at = Some(now);
                    }
                    None
                }
                Some(slot) if slot.heard > probe.heard_before => Some(ProbeAnswer::Answered),
                Some(_) => None,
            },
            None => None,
        };
        let answer = answer.or_else(|| {
            (now >= probe.deadline).then_some(ProbeAnswer::Unanswered {
                asked: probe.asked_at.is_some(),
            })
        });
        if let Some(answer) = answer {
            let _ = probe.reply.try_send(answer);
            *pending = None;
        }
    }
}

/// Whether the metering loop runs, and so would serve a probe.
pub(super) fn metering_running() -> bool {
    METERING_RUNNING.load(Ordering::SeqCst)
}

/// The metering loop's presence, held for the loop's life: made at its start,
/// cleared when it is dropped, so a loop that panics (`liveness` catches it)
/// clears it too, and a probe after that is refused as "not running" rather
/// than left to wait for an answer that never comes (the review).
pub(super) struct MeteringRunning;

impl MeteringRunning {
    pub(super) fn enter() -> Self {
        METERING_RUNNING.store(true, Ordering::SeqCst);
        Self
    }
}

impl Drop for MeteringRunning {
    fn drop(&mut self) {
        METERING_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// Setup's audio probe: asks the metering loop to ask TotalMix for its status
/// on remote 4 at `key`'s address and ports, and waits up to `timeout` for the
/// answer. The loop serves it once it has bound those settings, so the probe's
/// caller saves them first.
pub(crate) fn probe_console(key: ProbeKey, timeout: Duration) -> Result<ProbeAnswer, ProbeRefused> {
    if !metering_running() {
        return Err(ProbeRefused::NoMetering);
    }
    let deadline = Instant::now() + timeout;
    let receiver = PROBE_MAILBOX.post(key, deadline)?;
    // The loop answers by the deadline; a loop that stalls past it answers
    // nothing, and the probe is withdrawn as unanswered.
    match receiver.recv_timeout(timeout + Duration::from_secs(1)) {
        Ok(answer) => Ok(answer),
        Err(_) => {
            PROBE_MAILBOX.withdraw();
            // An answer that came in the same instant is still the answer.
            Ok(receiver
                .try_recv()
                .unwrap_or(ProbeAnswer::Unanswered { asked: false }))
        }
    }
}
