use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use super::editor_state::*;
use super::helpers::*;
use super::types::*;
use super::*;

const DEFAULT_IDENTIFY_DURATION_MS: i64 = 1200;
const MIN_IDENTIFY_DURATION_MS: i64 = 100;
const MAX_IDENTIFY_DURATION_MS: i64 = 5000;
const MIN_IDENTIFY_STEP_MS: i64 = 100;
const MAX_IDENTIFY_STEP_MS: i64 = 5000;
const MAX_IDENTIFY_SEQUENCE_FIXTURES: usize = 64;

/// "Open white" CCT applied to fixtures under the Highlight overlay.
/// Sits within the CCT range of every supported fixture type
/// (astra-bicolor 3200-5600, infinimat / infinibar 2000-10000) so no
/// per-fixture clamping is needed in practice. Centralised here so the
/// snapshot reader and tests share the same constant.
pub const NEUTRAL_HIGHLIGHT_CCT: i64 = 4500;

pub(super) fn current_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Aggregated highlight + solo overlay state. Bursts read through their
/// own active-window filter (`active_identify_burst_ids`) so the
/// snapshot reader can compose burst → highlight → solo precedence
/// without re-reading bursts twice. The mutator paths read the full
/// override state to enforce highlight/solo mutual exclusion.
pub struct OutputOverrides {
    pub highlight_ids: HashSet<String>,
    pub solo_ids: HashSet<String>,
}

impl OutputOverrides {
    pub fn solo_active(&self) -> bool {
        !self.solo_ids.is_empty()
    }
}

pub fn read_output_overrides(settings: &HashMap<String, String>) -> OutputOverrides {
    OutputOverrides {
        highlight_ids: read_id_set(settings, LIGHTING_HIGHLIGHT_IDS_KEY),
        solo_ids: read_id_set(settings, LIGHTING_SOLO_IDS_KEY),
    }
}

fn read_id_set(settings: &HashMap<String, String>, key: &str) -> HashSet<String> {
    let raw = match settings.get(key) {
        Some(value) if !value.trim().is_empty() => value,
        _ => return HashSet::new(),
    };
    serde_json::from_str::<Vec<String>>(raw)
        .map(|ids| ids.into_iter().collect())
        .unwrap_or_default()
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

/// Returns the set of fixture ids whose burst is currently flashing at
/// `now_ms`. A burst is active when its scheduled start has already
/// occurred AND the elapsed time has not exceeded its duration. The
/// `started_at_ms <= now_ms` gate is what makes future-scheduled bursts
/// (used by `start_lighting_identify_sequence`) wait their turn —
/// without it, `saturating_sub` would clamp to 0 and report future
/// entries as already active. Existing single-fixture identify writes
/// continue to use `now_ms` as the start so they activate immediately.
pub fn active_identify_burst_ids(
    settings: &HashMap<String, String>,
    now_ms: i64,
) -> HashSet<String> {
    read_identify_bursts(settings)
        .into_iter()
        .filter(|(_, burst)| {
            burst.started_at_ms <= now_ms
                && now_ms.saturating_sub(burst.started_at_ms) < burst.duration_ms
        })
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
    // unbounded across long sessions. Future-scheduled entries (started_at_ms
    // > now_ms) survive because their elapsed-vs-duration check is negative.
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

/// Sets / clears the Highlight or Solo overlay. The two modes are
/// mutually exclusive — switching from one to the other requires an
/// explicit clear (`mode: Off`) first; the engine refuses to silently
/// drop the active mode when the operator's button bound to the other
/// mode is pressed. This keeps the toolbar's mutual-exclusion the
/// source-of-truth contract: if both buttons are illuminated, the
/// engine has a bug.
pub fn set_lighting_fixture_highlight(
    db_path: &Path,
    request: &LightingFixtureHighlightRequest,
) -> Result<LightingFixtureHighlightResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);

    let known: HashSet<&str> = editor_state
        .fixtures
        .iter()
        .map(|fixture| fixture.id.as_str())
        .collect();
    for id in &request.fixture_ids {
        if !known.contains(id.as_str()) {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    id
                ),
            ));
        }
    }

    let current = read_output_overrides(&app_settings);

    let (next_highlight, next_solo, mode_label) = match request.mode {
        FixtureHighlightMode::Highlight => {
            if current.solo_active() {
                return Err(LightingCommandError::Rejected(
                    "LIGHTING_HIGHLIGHT_SOLO_CONFLICT",
                    String::from("Solo is active; clear solo before activating highlight."),
                ));
            }
            (
                request.fixture_ids.iter().cloned().collect::<HashSet<_>>(),
                HashSet::new(),
                "highlight",
            )
        }
        FixtureHighlightMode::Solo => {
            if !current.highlight_ids.is_empty() {
                return Err(LightingCommandError::Rejected(
                    "LIGHTING_HIGHLIGHT_SOLO_CONFLICT",
                    String::from("Highlight is active; clear highlight before activating solo."),
                ));
            }
            (
                HashSet::new(),
                request.fixture_ids.iter().cloned().collect::<HashSet<_>>(),
                "solo",
            )
        }
        FixtureHighlightMode::Off => (HashSet::new(), HashSet::new(), "off"),
    };

    let fixture_count = match request.mode {
        FixtureHighlightMode::Off => 0,
        _ => request.fixture_ids.len(),
    };
    let summary = match request.mode {
        FixtureHighlightMode::Highlight => {
            format!("Highlight on {} fixture(s)", fixture_count)
        }
        FixtureHighlightMode::Solo => format!("Solo on {} fixture(s)", fixture_count),
        FixtureHighlightMode::Off => String::from("Cleared highlight + solo overlays"),
    };

    let updates = vec![
        (
            String::from(LIGHTING_HIGHLIGHT_IDS_KEY),
            serialize_id_set(&next_highlight),
        ),
        (
            String::from(LIGHTING_SOLO_IDS_KEY),
            serialize_id_set(&next_solo),
        ),
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

    Ok(LightingFixtureHighlightResult {
        mode: String::from(mode_label),
        fixture_count,
        summary,
    })
}

fn serialize_id_set(ids: &HashSet<String>) -> String {
    let mut sorted: Vec<&String> = ids.iter().collect();
    sorted.sort();
    serde_json::to_string(&sorted).unwrap_or_else(|_| String::from("[]"))
}

/// Schedules a "find" sequence by pre-writing N burst entries with
/// staggered `started_at_ms` so each fixture flashes in turn. The
/// snapshot reader's `started_at_ms <= now_ms` gate keeps unstarted
/// entries dormant until their slot. Replaces any in-flight bursts —
/// "start a new sequence" is the operator's clear-and-restart intent.
pub fn start_lighting_identify_sequence(
    db_path: &Path,
    request: &LightingFixtureIdentifySequenceRequest,
) -> Result<LightingFixtureIdentifySequenceResult, LightingCommandError> {
    if request.fixture_ids.is_empty() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_IDENTIFY_SEQUENCE_EMPTY",
            String::from("identifySequence requires at least one fixture id."),
        ));
    }
    if request.fixture_ids.len() > MAX_IDENTIFY_SEQUENCE_FIXTURES {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_IDENTIFY_SEQUENCE_TOO_LARGE",
            format!(
                "identifySequence accepts at most {} fixtures.",
                MAX_IDENTIFY_SEQUENCE_FIXTURES
            ),
        ));
    }

    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);

    let known: HashSet<&str> = editor_state
        .fixtures
        .iter()
        .map(|fixture| fixture.id.as_str())
        .collect();
    for id in &request.fixture_ids {
        if !known.contains(id.as_str()) {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    id
                ),
            ));
        }
    }

    let step_ms = request
        .step_ms
        .clamp(MIN_IDENTIFY_STEP_MS, MAX_IDENTIFY_STEP_MS);
    let duration_ms = request
        .duration_ms
        .clamp(MIN_IDENTIFY_DURATION_MS, MAX_IDENTIFY_DURATION_MS);
    let now_ms = current_unix_ms();

    let mut bursts: HashMap<String, IdentifyBurst> = HashMap::new();
    for (idx, fixture_id) in request.fixture_ids.iter().enumerate() {
        bursts.insert(
            fixture_id.clone(),
            IdentifyBurst {
                started_at_ms: now_ms + (idx as i64) * step_ms,
                duration_ms,
            },
        );
    }

    let serialized = serde_json::to_string(&bursts).unwrap_or_else(|_| String::from("{}"));
    let total_duration_ms = (request.fixture_ids.len() as i64 - 1).max(0) * step_ms + duration_ms;
    let summary = format!(
        "Identify sequence on {} fixture(s) (step {} ms, {} ms each)",
        request.fixture_ids.len(),
        step_ms,
        duration_ms,
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

    Ok(LightingFixtureIdentifySequenceResult {
        fixture_count: request.fixture_ids.len(),
        step_ms,
        duration_ms,
        total_duration_ms,
        summary,
    })
}

/// Clears all in-flight identify bursts (active and future-scheduled).
/// Used by Esc and workspace-switch handlers to cancel a Find sequence
/// without waiting for it to finish naturally.
pub fn clear_lighting_identify_bursts(
    db_path: &Path,
    _request: &LightingFixtureIdentifyClearAllRequest,
) -> Result<LightingFixtureIdentifyClearAllResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let bursts = read_identify_bursts(&app_settings);
    let cleared_count = bursts.len();
    let summary = format!("Cleared {} identify burst(s)", cleared_count);

    let updates = vec![
        (
            String::from(LIGHTING_IDENTIFY_BURSTS_KEY),
            String::from("{}"),
        ),
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

    Ok(LightingFixtureIdentifyClearAllResult {
        cleared_count,
        summary,
    })
}
