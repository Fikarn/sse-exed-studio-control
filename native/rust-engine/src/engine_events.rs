//! One process-wide sender for engine events that originate outside the IPC
//! request loop: the control-surface bridge, the console link flush on the
//! metering thread, and anything else that changes audio state on its own.
//!
//! The IPC loop still answers requests with their own event lists; this is
//! only for changes nobody asked for over stdin. Registered once at startup
//! by `main.rs`; before that (and in unit tests) emitting is a no-op.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

use serde_json::{json, Value};

use crate::prompter::clock::PrompterAnchor;
use crate::protocol::{
    event_message, EVENT_APP_CHANGED, EVENT_AUDIO_CHANGED, EVENT_CAMERAS_CHANGED,
    EVENT_LIGHTING_CHANGED, EVENT_PROMPTER_CHANGED,
};

static ENGINE_EVENT_SENDER: OnceLock<Sender<Value>> = OnceLock::new();

pub fn register_engine_event_sender(sender: Sender<Value>) {
    let _ = ENGINE_EVENT_SENDER.set(sender);
}

/// Emits an event with a payload of the caller's. In the tests, where no
/// sender is registered, the event is kept for the test that raised it
/// (`EMITTED`).
pub(crate) fn emit_event(event: &str, payload: Value) {
    #[cfg(test)]
    EMITTED.with(|events| {
        events
            .borrow_mut()
            .push((String::from(event), payload.clone()));
    });
    if let Some(sender) = ENGINE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(event, payload));
    }
}

#[cfg(test)]
thread_local! {
    /// The events `emit_event` raised on this thread.
    pub(crate) static EMITTED: std::cell::RefCell<Vec<(String, Value)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Emits `audio.changed { reason }`.
pub(crate) fn emit_audio_changed(reason: &str) {
    emit_audio_changed_with(json!({ "reason": reason }));
}

/// Emits `audio.changed` with a caller-built payload (must carry `reason`).
pub(crate) fn emit_audio_changed_with(payload: Value) {
    if let Some(sender) = ENGINE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(EVENT_AUDIO_CHANGED, payload));
    }
}

/// Emits `app.changed { reason }`. The health registry's transitions arrive
/// this way (2026-09 production readiness, Slice 8 — F14) as `"health"`.
pub(crate) fn emit_app_changed(reason: &str) {
    if let Some(sender) = ENGINE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(
            EVENT_APP_CHANGED,
            json!({ "reason": reason }),
        ));
    }
}

/// Emits `lighting.changed { reason }`. A Stream Deck lighting key arrives
/// this way (2026-09 production readiness, Slice 10) as `"control-surface"`,
/// so an open Lighting workspace follows the deck.
pub(crate) fn emit_lighting_changed(reason: &str) {
    if let Some(sender) = ENGINE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(
            EVENT_LIGHTING_CHANGED,
            json!({ "reason": reason }),
        ));
    }
}

/// `prompter.changed { reason, anchor }`, the payload the IPC replies carry
/// too: the Teleprompter's clock stopping the text at `END` arrives this way
/// (new pages program, Slice 4).
pub(crate) fn prompter_changed_payload(reason: &str, anchor: Option<PrompterAnchor>) -> Value {
    json!({ "reason": reason, "anchor": anchor })
}

/// Emits `prompter.changed` from outside the request loop.
pub(crate) fn emit_prompter_changed(reason: &str, anchor: Option<PrompterAnchor>) {
    if let Some(sender) = ENGINE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(
            EVENT_PROMPTER_CHANGED,
            prompter_changed_payload(reason, anchor),
        ));
    }
}

/// `cameras.changed { reason, camera }`, the payload the IPC replies carry
/// too (new pages program, Slice 8); `camera` is `null` when it is about all
/// three.
pub(crate) fn cameras_changed_payload(reason: &str, camera: Option<u8>) -> Value {
    json!({ "reason": reason, "camera": camera })
}

/// Emits `cameras.changed` from outside the request loop: a value a camera
/// changed itself, a camera that stops answering or answers again.
pub(crate) fn emit_cameras_changed(reason: &str, camera: Option<u8>) {
    if let Some(sender) = ENGINE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(
            EVENT_CAMERAS_CHANGED,
            cameras_changed_payload(reason, camera),
        ));
    }
}

// ---------------------------------------------------------------------------
// The meter stream's bound (the audit of 2026-10-12).
//
// The console's meters, TotalMix's or the simulated ones, are published 30
// times a second into the output channel, which has no bound of its own. A
// writer that falls behind (the app busy, its pipe full, the stop under way)
// used to be handed every frame all the same: the channel grew with them for
// as long as the spell lasted, and the page then read levels already stale.
// Here a frame is offered only while the writer holds fewer than
// `METER_BACKLOG_LIMIT` of them; a frame dropped costs nothing, since the next
// tick's levels are as good.
// ---------------------------------------------------------------------------

/// A meter frame's `reason`: what marks the 30 Hz frames of the console's
/// meters among the output's messages.
pub(crate) const METER_TICK_REASON: &str = "metering-tick";

/// Meter frames the output writer may hold before the metering skips one.
/// Two frames are a fifteenth of a second.
const METER_BACKLOG_LIMIT: usize = 2;

/// The meter frames handed to the output writer and not yet written.
static METER_FRAMES_QUEUED: AtomicUsize = AtomicUsize::new(0);

/// What became of a meter frame offered to the writer.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MeterOffer {
    Sent,
    /// The writer holds `METER_BACKLOG_LIMIT` frames already: this one is
    /// dropped.
    Skipped,
    /// The writer has gone: the metering ends.
    WriterGone,
}

/// Whether the writer has room for a meter frame: asked before one is built,
/// so a writer that is behind costs the metering no frame at all.
pub(crate) fn meter_frame_room() -> bool {
    METER_FRAMES_QUEUED.load(Ordering::SeqCst) < METER_BACKLOG_LIMIT
}

/// Hands a meter frame (an event whose payload carries `METER_TICK_REASON`)
/// to the output writer while it holds fewer than `METER_BACKLOG_LIMIT` of
/// them. The frame's slot is taken here and given back by the writer
/// (`meter_frame_written`), or here when the send fails.
pub(crate) fn offer_meter_frame(sender: &Sender<Value>, frame: Value) -> MeterOffer {
    debug_assert!(is_meter_frame(&frame), "a meter frame carries its reason");
    let taken = METER_FRAMES_QUEUED.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |queued| {
        (queued < METER_BACKLOG_LIMIT).then_some(queued + 1)
    });
    if taken.is_err() {
        return MeterOffer::Skipped;
    }
    match sender.send(frame) {
        Ok(()) => MeterOffer::Sent,
        Err(_) => {
            meter_frame_written();
            MeterOffer::WriterGone
        }
    }
}

/// Whether an output message is a meter frame; the writer asks, to give its
/// slot back once it is written.
pub(crate) fn is_meter_frame(message: &Value) -> bool {
    message
        .get("payload")
        .and_then(|payload| payload.get("reason"))
        .and_then(Value::as_str)
        == Some(METER_TICK_REASON)
}

/// A meter frame left the writer's hands (written, or given up on): its slot
/// is free again.
pub(crate) fn meter_frame_written() {
    let _ = METER_FRAMES_QUEUED.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |queued| {
        queued.checked_sub(1)
    });
}

/// The writer has ended with frames still queued: every slot is free again.
/// The writer is the only taker of frames, so none is legitimately held
/// after it; called once its channel is closed, so no offer that follows
/// can queue a frame (one that took its slot before the close fails to send
/// and gives it back itself). Without this a writer that ended would keep
/// the count at its limit for good, and the metering would skip every frame
/// without ever offering one and finding the writer gone (the review).
pub(crate) fn meter_frames_abandoned() {
    METER_FRAMES_QUEUED.store(0, Ordering::SeqCst);
}

#[cfg(test)]
mod meter_backlog_tests {
    use super::*;
    use std::sync::mpsc;

    fn frame(sequence: u64) -> Value {
        event_message(
            crate::protocol::EVENT_AUDIO_METERS,
            json!({ "reason": METER_TICK_REASON, "sequence": sequence }),
        )
    }

    // The one test of the process-wide count: it leaves the count at zero.
    #[test]
    fn the_writer_holds_two_frames_and_the_third_is_skipped_until_one_is_written() {
        let (sender, receiver) = mpsc::channel::<Value>();
        assert!(meter_frame_room());
        assert_eq!(offer_meter_frame(&sender, frame(1)), MeterOffer::Sent);
        assert_eq!(offer_meter_frame(&sender, frame(2)), MeterOffer::Sent);
        assert!(!meter_frame_room());
        assert_eq!(
            offer_meter_frame(&sender, frame(3)),
            MeterOffer::Skipped,
            "the writer holds two frames"
        );
        assert_eq!(
            receiver.try_iter().count(),
            2,
            "the skipped frame never reached the channel"
        );

        // The writer wrote one: the next frame has its slot.
        meter_frame_written();
        assert!(meter_frame_room());
        assert_eq!(offer_meter_frame(&sender, frame(4)), MeterOffer::Sent);
        assert!(is_meter_frame(&receiver.recv().expect("the fourth frame")));
        meter_frame_written();
        meter_frame_written();
        assert!(meter_frame_room());

        // Giving back more than was taken never underflows.
        meter_frame_written();
        assert_eq!(METER_FRAMES_QUEUED.load(Ordering::SeqCst), 0);

        // The writer gone: said so, and the slot given back.
        drop(receiver);
        assert_eq!(offer_meter_frame(&sender, frame(5)), MeterOffer::WriterGone);
        assert_eq!(METER_FRAMES_QUEUED.load(Ordering::SeqCst), 0);

        // A writer that ends with two frames in its hands gives them up, so
        // the next offer is made, reaches the gone writer, and the metering
        // learns it (the review's finding).
        let (sender, receiver) = mpsc::channel::<Value>();
        assert_eq!(offer_meter_frame(&sender, frame(6)), MeterOffer::Sent);
        assert_eq!(offer_meter_frame(&sender, frame(7)), MeterOffer::Sent);
        assert!(!meter_frame_room());
        drop(receiver);
        meter_frames_abandoned();
        assert!(meter_frame_room());
        assert_eq!(offer_meter_frame(&sender, frame(8)), MeterOffer::WriterGone);
        assert_eq!(METER_FRAMES_QUEUED.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn only_a_frame_with_the_meter_reason_counts_as_one() {
        assert!(is_meter_frame(&frame(1)));
        assert!(!is_meter_frame(&event_message(
            EVENT_AUDIO_CHANGED,
            json!({ "reason": "control-surface" })
        )));
        assert!(!is_meter_frame(&json!({ "type": "response", "id": "1" })));
    }
}
