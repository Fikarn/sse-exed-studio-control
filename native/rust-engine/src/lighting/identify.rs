use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::editor_state::*;
use super::helpers::*;
use super::types::*;
use super::*;

const DEFAULT_IDENTIFY_DURATION_MS: i64 = 1200;
const MIN_IDENTIFY_DURATION_MS: i64 = 100;
const MAX_IDENTIFY_DURATION_MS: i64 = 5000;

pub(super) fn current_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Read the identify-burst overlay map from settings. Missing or malformed
/// blobs collapse to an empty map so reads never fail loudly.
pub(super) fn read_identify_bursts(
    settings: &HashMap<String, String>,
) -> HashMap<String, IdentifyBurst> {
    let raw = match settings.get(LIGHTING_IDENTIFY_BURSTS_KEY) {
        Some(value) if !value.trim().is_empty() => value,
        _ => return HashMap::new(),
    };
    serde_json::from_str(raw).unwrap_or_default()
}

/// Returns the set of fixture ids whose burst is still active at `now_ms`.
pub fn active_identify_burst_ids(
    settings: &HashMap<String, String>,
    now_ms: i64,
) -> std::collections::HashSet<String> {
    read_identify_bursts(settings)
        .into_iter()
        .filter(|(_, burst)| now_ms.saturating_sub(burst.started_at_ms) < burst.duration_ms)
        .map(|(id, _)| id)
        .collect()
}

pub fn identify_lighting_fixture(
    db_path: &Path,
    request: &LightingFixtureIdentifyRequest,
) -> Result<LightingFixtureIdentifyResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let config = resolve_lighting_config(&app_settings);
    let editor_state = load_lighting_editor_state(&app_settings);

    let fixture = editor_state
        .fixtures
        .iter()
        .find(|fixture| fixture.id == request.fixture_id)
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    request.fixture_id
                ),
            )
        })?;

    let duration_ms = request
        .duration_ms
        .unwrap_or(DEFAULT_IDENTIFY_DURATION_MS)
        .clamp(MIN_IDENTIFY_DURATION_MS, MAX_IDENTIFY_DURATION_MS);

    let now_ms = current_unix_ms();
    let mut bursts = read_identify_bursts(&app_settings);

    // Drop expired entries while we have the map open so storage doesn't grow
    // unbounded across long sessions.
    bursts.retain(|_, burst| now_ms.saturating_sub(burst.started_at_ms) < burst.duration_ms);

    bursts.insert(
        request.fixture_id.clone(),
        IdentifyBurst {
            started_at_ms: now_ms,
            duration_ms,
        },
    );

    let serialized = serde_json::to_string(&bursts).unwrap_or_else(|_| String::from("{}"));
    let summary = format!(
        "Identify burst for {} ({} ms on universe {})",
        fixture.name, duration_ms, config.universe
    );
    let updates = vec![
        (String::from(LIGHTING_IDENTIFY_BURSTS_KEY), serialized),
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ];
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingFixtureIdentifyResult {
        fixture_id: request.fixture_id.clone(),
        duration_ms,
        summary,
    })
}
