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

use crate::protocol::{
    event_message, EVENT_APP_CHANGED, EVENT_AUDIO_CHANGED, EVENT_LIGHTING_CHANGED,
    EVENT_PLANNING_CHANGED,
};

static ENGINE_EVENT_SENDER: OnceLock<Sender<Value>> = OnceLock::new();

pub fn register_engine_event_sender(sender: Sender<Value>) {
    let _ = ENGINE_EVENT_SENDER.set(sender);
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

/// Emits `planning.changed { reason }` with the payload shape the IPC loop
/// uses; the deck names no project or task, so both are null.
pub(crate) fn emit_planning_changed(reason: &str) {
    if let Some(sender) = ENGINE_EVENT_SENDER.get() {
        let _ = sender.send(event_message(
            EVENT_PLANNING_CHANGED,
            json!({ "reason": reason, "projectId": null, "taskId": null }),
        ));
    }
}
