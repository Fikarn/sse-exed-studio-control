use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const PROTOCOL_VERSION: &str = "1";

pub const EVENT_APP_CHANGED: &str = "app.changed";
pub const EVENT_AUDIO_CHANGED: &str = "audio.changed";
pub const EVENT_COMMISSIONING_CHANGED: &str = "commissioning.changed";
pub const EVENT_ENGINE_READY: &str = "engine.ready";
pub const EVENT_ENGINE_STARTUP_FAILED: &str = "engine.startupFailed";
pub const EVENT_LIGHTING_CHANGED: &str = "lighting.changed";
pub const EVENT_PLANNING_CHANGED: &str = "planning.changed";
pub const EVENT_SETTINGS_CHANGED: &str = "settings.changed";
pub const EVENT_SUPPORT_CHANGED: &str = "support.changed";

pub const EVENT_NAMES: &[&str] = &[
    EVENT_APP_CHANGED,
    EVENT_AUDIO_CHANGED,
    EVENT_COMMISSIONING_CHANGED,
    EVENT_ENGINE_READY,
    EVENT_ENGINE_STARTUP_FAILED,
    EVENT_LIGHTING_CHANGED,
    EVENT_PLANNING_CHANGED,
    EVENT_SETTINGS_CHANGED,
    EVENT_SUPPORT_CHANGED,
];

fn empty_object() -> Value {
    Value::Object(Default::default())
}

fn default_request_kind() -> String {
    "request".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RequestEnvelope {
    #[serde(rename = "type", default = "default_request_kind")]
    pub kind: String,
    pub id: Value,
    pub method: String,
    #[serde(default = "empty_object")]
    pub params: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResponseEnvelope {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: Value,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventEnvelope {
    #[serde(rename = "type")]
    pub kind: String,
    pub event: String,
    pub payload: Value,
}

pub fn event_message(event: &str, payload: Value) -> Value {
    serde_json::to_value(EventEnvelope {
        kind: "event".to_string(),
        event: event.to_string(),
        payload,
    })
    .unwrap_or_else(|_| {
        json!({
            "type": "event",
            "event": event,
            "payload": {}
        })
    })
}

pub fn ok_response(id: Value, result: Value) -> ResponseEnvelope {
    ResponseEnvelope {
        kind: "response".to_string(),
        id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

pub fn error_response(id: Value, code: &str, message: String) -> ResponseEnvelope {
    ResponseEnvelope {
        kind: "response".to_string(),
        id,
        ok: false,
        result: None,
        error: Some(json!({
            "code": code,
            "message": message
        })),
    }
}

pub fn invalid_params(id: Value, message: String) -> ResponseEnvelope {
    error_response(id, "INVALID_PARAMS", message)
}
