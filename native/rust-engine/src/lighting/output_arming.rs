//! Whether the light outputs are armed (2026-09 production readiness, Slice
//! 11 — finding F31; operator decision D1).
//!
//! Armed is the default and today's behaviour: once lighting is enabled, the
//! bridge is commissioned and a fixture is patched, the engine streams. Held
//! means the sACN output sends nothing at all — no frame, no keep-alive —
//! until the operator arms it from Setup / Support. A hold is not a blackout:
//! the rig does whatever the bridge does when its source goes away, which for
//! the Apollo Bridge is to hold the last look. Everything else keeps working
//! while held — scenes recall, faders move, the DMX monitor shows what would
//! be sent — so the operator can look before anything reaches the rig.
//!
//! The flag is persisted, so a hold outlives the launch that made it:
//! `SSE_SAFE_START=1` writes `false` at the bootstrap, and only the operator
//! writes `true` again. A restore never changes it (`support.rs`, and the
//! bootstrap's pending database restore).

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::helpers::persist_lighting_state;
use super::LightingCommandError;

/// `"false"` holds; anything else — above all a database that has never had
/// the key — is armed, so a default launch is what it was before this key.
pub const LIGHTING_OUTPUT_ARMED_KEY: &str = "app.lighting.output_armed";

pub fn lighting_output_armed(settings: &HashMap<String, String>) -> bool {
    settings
        .get(LIGHTING_OUTPUT_ARMED_KEY)
        .is_none_or(|value| value != "false")
}

/// The stored form of the flag.
pub fn lighting_output_armed_setting(armed: bool) -> (String, String) {
    (
        String::from(LIGHTING_OUTPUT_ARMED_KEY),
        String::from(if armed { "true" } else { "false" }),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LightingOutputArmedRequest {
    pub armed: bool,
}

#[derive(Debug, Serialize)]
pub struct LightingOutputArmedResult {
    pub armed: bool,
    pub summary: String,
}

pub fn parse_lighting_output_armed_request(
    params: &Value,
) -> Result<LightingOutputArmedRequest, String> {
    params
        .get("armed")
        .and_then(Value::as_bool)
        .map(|armed| LightingOutputArmedRequest { armed })
        .ok_or_else(|| String::from("armed is required and must be true or false"))
}

/// `lighting.output.setArmed`. Runs under the lighting state lock like every
/// lighting mutation (its dispatcher takes it), so the render generation
/// moves and the sACN thread sees the flag on its next tick.
pub fn set_lighting_output_armed(
    db_path: &Path,
    request: &LightingOutputArmedRequest,
) -> Result<LightingOutputArmedResult, LightingCommandError> {
    persist_lighting_state(db_path, &[lighting_output_armed_setting(request.armed)])?;
    Ok(LightingOutputArmedResult {
        armed: request.armed,
        summary: String::from(if request.armed {
            "Light outputs armed: the rig follows the app."
        } else {
            "Light outputs held: nothing is sent to the rig until they are armed."
        }),
    })
}
