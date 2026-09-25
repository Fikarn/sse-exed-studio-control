use crate::bootstrap::RuntimeContext;
use crate::commissioning::AUDIO_CHECK_ID;
use crate::legacy_import::{ImportLegacyError, LegacyImportRequest};
use crate::lighting::import_legacy_lighting_fixture;
use crate::storage::{import_legacy_db, set_settings_owned};
use serde::Serialize;
use serde_json::Value;
use std::fmt;
use std::fs;

const LIGHTING_POPULATED_DB_JSON: &str =
    include_str!("../fixtures/parity-lighting-populated-db.json");
const AUDIO_POPULATED_DB_JSON: &str = include_str!("../fixtures/parity-audio-populated-db.json");
const SETUP_REQUIRED_DB_JSON: &str = include_str!("../fixtures/parity-setup-required-db.json");
const SETUP_READY_DB_JSON: &str = include_str!("../fixtures/parity-setup-ready-db.json");

#[derive(Debug)]
pub enum ParityFixtureError {
    InvalidParams(String),
    Storage(String),
}

impl fmt::Display for ParityFixtureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidParams(message) => write!(f, "{message}"),
            Self::Storage(message) => write!(f, "{message}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParityFixtureId {
    LightingPopulated,
    AudioPopulated,
    SetupRequired,
    SetupReady,
}

impl ParityFixtureId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LightingPopulated => "lighting-populated",
            Self::AudioPopulated => "audio-populated",
            Self::SetupRequired => "setup-required",
            Self::SetupReady => "setup-ready",
        }
    }

    fn summary(&self) -> &'static str {
        match self {
            Self::LightingPopulated => {
                "Populated lighting workspace fixture aligned with the legacy operator console reference."
            }
            Self::AudioPopulated => {
                "Populated audio workspace fixture aligned with the legacy operator console reference."
            }
            Self::SetupRequired => {
                "Setup-required startup fixture loaded so commissioning remains the primary surface."
            }
            Self::SetupReady => {
                "Setup-ready startup fixture loaded so the dashboard remains the primary surface."
            }
        }
    }

    fn target_surface(&self) -> &'static str {
        match self {
            Self::SetupRequired => "commissioning",
            Self::LightingPopulated | Self::AudioPopulated | Self::SetupReady => "dashboard",
        }
    }

    fn bundled_payload(&self) -> &'static str {
        match self {
            Self::LightingPopulated => LIGHTING_POPULATED_DB_JSON,
            Self::AudioPopulated => AUDIO_POPULATED_DB_JSON,
            Self::SetupRequired => SETUP_REQUIRED_DB_JSON,
            Self::SetupReady => SETUP_READY_DB_JSON,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParityFixtureRequest {
    pub fixture_id: ParityFixtureId,
    pub replace_existing_data: bool,
}

#[derive(Debug, Serialize)]
pub struct ParityFixtureSummary {
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "targetSurface")]
    pub target_surface: String,
    pub summary: String,
}

pub fn parse_parity_fixture_request(params: &Value) -> Result<ParityFixtureRequest, String> {
    let fixture_id = match params.get("fixtureId").and_then(Value::as_str) {
        Some("lighting-populated") => ParityFixtureId::LightingPopulated,
        Some("audio-populated") => ParityFixtureId::AudioPopulated,
        Some("setup-required") => ParityFixtureId::SetupRequired,
        Some("setup-ready") => ParityFixtureId::SetupReady,
        Some(_) => {
            return Err(String::from(
                "fixtureId must be one of: lighting-populated, audio-populated, setup-required, setup-ready",
            ))
        }
        None => return Err(String::from("fixtureId is required")),
    };

    // Default is a merge: a fixture load never replaces existing saved
    // data unless the caller says so (2026-09 production readiness, Slice 1
    // — finding F04). `import_legacy_db` refuses the merge when the saved
    // data holds a completed setup or an earlier import, an earlier fixture
    // load included (new pages program, Slice 2; until then, when Planning's
    // tables held rows).
    let replace_existing_data = params
        .get("replaceExistingData")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("replaceExistingData must be a boolean"))
        })
        .transpose()?
        .unwrap_or(false);

    Ok(ParityFixtureRequest {
        fixture_id,
        replace_existing_data,
    })
}

pub fn load_parity_fixture(
    runtime: &RuntimeContext,
    request: &ParityFixtureRequest,
) -> Result<ParityFixtureSummary, ParityFixtureError> {
    let fixture_path = runtime.app_data_dir.join(format!(
        "parity-fixture-{}.json",
        request.fixture_id.as_str()
    ));
    fs::write(&fixture_path, request.fixture_id.bundled_payload())
        .map_err(|error| ParityFixtureError::Storage(error.to_string()))?;

    import_legacy_db(
        &runtime.db_path,
        &LegacyImportRequest {
            source_path: fixture_path.clone(),
            force: request.replace_existing_data,
        },
    )
    .map_err(map_import_error)?;

    let app_setting_overrides = parity_app_setting_overrides(request.fixture_id);
    if !app_setting_overrides.is_empty() {
        set_settings_owned(&runtime.db_path, &app_setting_overrides)
            .map_err(|error| ParityFixtureError::Storage(error.to_string()))?;
    }

    if request.fixture_id == ParityFixtureId::LightingPopulated {
        import_legacy_lighting_fixture(&runtime.db_path, request.fixture_id.bundled_payload())
            .map_err(|error| ParityFixtureError::Storage(error.to_string()))?;
    }

    Ok(ParityFixtureSummary {
        fixture_id: request.fixture_id.as_str().to_string(),
        source_path: fixture_path.display().to_string(),
        target_surface: request.fixture_id.target_surface().to_string(),
        summary: request.fixture_id.summary().to_string(),
    })
}

fn parity_app_setting_overrides(fixture_id: ParityFixtureId) -> Vec<(String, String)> {
    match fixture_id {
        ParityFixtureId::LightingPopulated
        | ParityFixtureId::SetupRequired
        | ParityFixtureId::SetupReady => vec![(
            String::from("app.audio.osc_enabled"),
            String::from("false"),
        )],
        ParityFixtureId::AudioPopulated => vec![
            (String::from("app.audio.osc_enabled"), String::from("false")),
            (
                format!("app.commissioning.check.{AUDIO_CHECK_ID}.status"),
                String::from("passed"),
            ),
            (
                format!("app.commissioning.check.{AUDIO_CHECK_ID}.message"),
                String::from(
                    "Audio OSC transport probe passed for the legacy parity console fixture.",
                ),
            ),
            (
                format!("app.commissioning.check.{AUDIO_CHECK_ID}.checked_at"),
                String::from("2026-04-16T20:14:00Z"),
            ),
            (
                String::from("app.audio.selected_channel_id"),
                String::from("audio-input-9"),
            ),
            (
                String::from("app.audio.selected_mix_target_id"),
                String::from("audio-mix-main"),
            ),
            (
                String::from("app.audio.expected_peak_data"),
                String::from("true"),
            ),
            (
                String::from("app.audio.expected_submix_lock"),
                String::from("true"),
            ),
            (
                String::from("app.audio.expected_compatibility_mode"),
                String::from("false"),
            ),
            crate::audio::confidence_setting(crate::audio::ConsoleConfidence::Assumed),
            (
                String::from("app.audio.last_console_sync_at"),
                String::new(),
            ),
            (
                String::from("app.audio.last_console_sync_reason"),
                String::from("startup"),
            ),
            (
                String::from("app.audio.last_recalled_snapshot_id"),
                String::new(),
            ),
            (
                String::from("app.audio.last_snapshot_recall_at"),
                String::new(),
            ),
            (
                String::from("app.audio.snapshots_state"),
                String::from(
                    "[{\"id\":\"asnap-1\",\"name\":\"Interview Setup\",\"oscIndex\":0,\"order\":0},{\"id\":\"asnap-2\",\"name\":\"Solo Podcast\",\"oscIndex\":1,\"order\":1}]",
                ),
            ),
        ],
    }
}

fn map_import_error(error: ImportLegacyError) -> ParityFixtureError {
    match error {
        ImportLegacyError::ExistingDataRequiresForce => {
            ParityFixtureError::InvalidParams(error.to_string())
        }
        other => ParityFixtureError::Storage(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_parity_fixture_request, ParityFixtureId};
    use serde_json::{json, Value};

    // 2026-09 production readiness, Slice 1 (finding F04): a fixture load
    // merges by default; replacing the operator's saved data takes an
    // explicit `replaceExistingData: true`. (New pages program, Slice 2: the
    // Planning fixtures left, so the case loads Lighting.)
    #[test]
    fn load_defaults_to_merge() {
        let request = parse_parity_fixture_request(&json!({ "fixtureId": "lighting-populated" }))
            .expect("a fixture id alone should parse");

        assert_eq!(request.fixture_id, ParityFixtureId::LightingPopulated);
        assert!(
            !request.replace_existing_data,
            "a fixture load must not replace existing saved data unless asked to"
        );
    }

    // New pages program, Slice 2: the two Planning fixtures left with the page.
    #[test]
    fn planning_fixtures_are_refused() {
        for fixture_id in ["planning-empty", "planning-populated"] {
            let error = parse_parity_fixture_request(&json!({ "fixtureId": fixture_id }))
                .expect_err("a Planning fixture is no longer a fixture");
            assert_eq!(
                error,
                "fixtureId must be one of: lighting-populated, audio-populated, setup-required, setup-ready"
            );
        }
    }

    // New pages program, Slice 2: the import reads only a db.json's
    // `schemaVersion`, `settings.dashboardView` and `settings.hasCompletedSetup`,
    // so the bundled fixtures carry no Planning part (projects, tasks, the
    // activity log, the Planning view settings and selection, the deck mode)
    // and no Planning board (`kanban`). Until then the four held one, which
    // the import then wrote into the Planning tables.
    #[test]
    fn the_bundled_fixtures_carry_no_planning() {
        for fixture_id in [
            ParityFixtureId::LightingPopulated,
            ParityFixtureId::AudioPopulated,
            ParityFixtureId::SetupRequired,
            ParityFixtureId::SetupReady,
        ] {
            let name = fixture_id.as_str();
            let payload: Value = serde_json::from_str(fixture_id.bundled_payload())
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            for key in ["projects", "tasks", "activityLog"] {
                assert!(payload.get(key).is_none(), "{name} still carries `{key}`");
            }
            let settings = payload
                .get("settings")
                .and_then(Value::as_object)
                .unwrap_or_else(|| panic!("{name} has no settings"));
            let mut keys = settings.keys().map(String::as_str).collect::<Vec<_>>();
            keys.sort_unstable();
            assert_eq!(keys, ["dashboardView", "hasCompletedSetup"], "{name}");
            let expected_view = if fixture_id == ParityFixtureId::LightingPopulated {
                "lighting"
            } else {
                "audio"
            };
            assert_eq!(settings["dashboardView"], expected_view, "{name}");
        }
    }

    #[test]
    fn load_honours_an_explicit_replace_flag() {
        let request = parse_parity_fixture_request(
            &json!({ "fixtureId": "setup-ready", "replaceExistingData": true }),
        )
        .expect("an explicit replace flag should parse");
        assert!(request.replace_existing_data);

        let error = parse_parity_fixture_request(
            &json!({ "fixtureId": "setup-ready", "replaceExistingData": "yes" }),
        )
        .expect_err("a non-boolean replace flag is invalid");
        assert!(error.contains("boolean"), "{error}");
    }
}
