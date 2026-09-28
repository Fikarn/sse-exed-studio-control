//! One process-wide sender for engine events that originate outside the IPC
//! request loop: the control-surface bridge, the console link flush on the
//! metering thread, and anything else that changes audio state on its own.
//!
//! The IPC loop still answers requests with their own event lists; this is
//! only for changes nobody asked for over stdin. Registered once at startup
//! by `main.rs`; before that (and in unit tests) emitting is a no-op.

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
