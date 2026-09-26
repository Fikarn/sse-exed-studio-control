use crate::app_state::{
    CommissioningSnapshot, COMMISSIONING_COMPLETED_KEY, COMMISSIONING_RUNNER_STAGE_KEY,
    COMMISSIONING_STAGE_KEY,
};
use crate::bootstrap::RuntimeContext;
use crate::commissioning::AUDIO_CHECK_ID;
use crate::lighting::parity_lighting_settings;
use crate::shell_settings::WORKSPACE_KEY;
use crate::storage::{list_settings_by_prefix, set_settings_owned};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::Path;

/// The `lighting-populated` fixture's rig: its lights, groups, scenes and
/// lighting settings. New pages program, Slice 2b: the one bundled payload
/// left. Every fixture's setup flag and page are written directly
/// (`ParityFixtureId::setup_settings`); until then each fixture was a db.json
/// loaded through the import, which Slice 2b retired.
const LIGHTING_POPULATED_JSON: &str = include_str!("../fixtures/parity-lighting-populated.json");

/// A load onto saved data whose setup is complete, without
/// `replaceExistingData` (F04; new pages program, Slice 2b).
const COMPLETED_SETUP_NEEDS_REPLACE: &str =
    "The saved data already holds a completed setup. Load the fixture over it with replaceExistingData: true.";

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
        if self.setup_completed() {
            "dashboard"
        } else {
            "commissioning"
        }
    }

    /// Whether the fixture's setup is complete: every fixture's but
    /// `setup-required`'s.
    fn setup_completed(&self) -> bool {
        !matches!(self, Self::SetupRequired)
    }

    /// The page the fixture opens on.
    fn workspace(&self) -> &'static str {
        match self {
            Self::LightingPopulated => "lighting",
            Self::AudioPopulated | Self::SetupRequired | Self::SetupReady => "audio",
        }
    }

    /// The setup flag, as the three commissioning keys, and the page to open
    /// — the four settings the db.json import wrote from each fixture's
    /// payload until Slice 2b: a completed setup is published and ready, one
    /// that is not is back at the import step.
    fn setup_settings(&self) -> Vec<(String, String)> {
        let (runner_stage, stage) = if self.setup_completed() {
            ("publish", "ready")
        } else {
            ("import", "setup-required")
        };
        vec![
            (
                String::from(COMMISSIONING_COMPLETED_KEY),
                self.setup_completed().to_string(),
            ),
            (
                String::from(COMMISSIONING_RUNNER_STAGE_KEY),
                String::from(runner_stage),
            ),
            (String::from(COMMISSIONING_STAGE_KEY), String::from(stage)),
            (String::from(WORKSPACE_KEY), String::from(self.workspace())),
        ]
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

/// What a load wrote, kept beside the saved data as
/// `parity-fixture-<id>.json` and named by the reply's `sourcePath`
/// (Slice 2b; until then that file was the fixture's db.json, copied there
/// for the import to read).
#[derive(Serialize)]
struct ParityFixtureRecord<'a> {
    #[serde(rename = "fixtureId")]
    fixture_id: &'a str,
    settings: BTreeMap<&'a str, &'a str>,
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
    // — finding F04). Since the new pages program's Slice 2b a load onto
    // saved data whose setup is complete is refused without it; until then
    // the db.json import's gate refused it — a completed setup or an earlier
    // import, an earlier fixture load included — and before Slice 2, rows in
    // Planning's tables.
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
    load_parity_fixture_into(&runtime.app_data_dir, &runtime.db_path, request)
}

/// New pages program, Slice 2b: a load writes its settings directly, in one
/// transaction — the setup flag and the page, the fixture's own settings
/// and, for `lighting-populated`, its rig — no longer through the db.json
/// import. The merge gate comes before anything is written, the record
/// included, so a refused load writes nothing; the record comes before the
/// database, so a load that cannot write it leaves the saved data alone.
fn load_parity_fixture_into(
    app_data_dir: &Path,
    db_path: &Path,
    request: &ParityFixtureRequest,
) -> Result<ParityFixtureSummary, ParityFixtureError> {
    if !request.replace_existing_data && saved_setup_is_complete(db_path)? {
        return Err(ParityFixtureError::InvalidParams(String::from(
            COMPLETED_SETUP_NEEDS_REPLACE,
        )));
    }

    let mut settings = request.fixture_id.setup_settings();
    settings.extend(parity_app_setting_overrides(request.fixture_id));
    if request.fixture_id == ParityFixtureId::LightingPopulated {
        settings.extend(
            parity_lighting_settings(LIGHTING_POPULATED_JSON)
                .map_err(|error| ParityFixtureError::Storage(error.to_string()))?,
        );
    }

    let record_path = app_data_dir.join(format!(
        "parity-fixture-{}.json",
        request.fixture_id.as_str()
    ));
    let record = serde_json::to_vec_pretty(&ParityFixtureRecord {
        fixture_id: request.fixture_id.as_str(),
        settings: settings
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect(),
    })
    .map_err(|error| ParityFixtureError::Storage(error.to_string()))?;
    fs::write(&record_path, record)
        .map_err(|error| ParityFixtureError::Storage(error.to_string()))?;

    set_settings_owned(db_path, &settings)
        .map_err(|error| ParityFixtureError::Storage(error.to_string()))?;

    Ok(ParityFixtureSummary {
        fixture_id: request.fixture_id.as_str().to_string(),
        source_path: record_path.display().to_string(),
        target_surface: request.fixture_id.target_surface().to_string(),
        summary: request.fixture_id.summary().to_string(),
    })
}

/// The merge gate (F04): whether the saved data's setup is complete, read as
/// the commissioning snapshot reads it. An earlier fixture load no longer
/// counts by itself (Slice 2b) — only through the setup it completed.
fn saved_setup_is_complete(db_path: &Path) -> Result<bool, ParityFixtureError> {
    let settings = list_settings_by_prefix(db_path, "app.commissioning.")
        .map_err(|error| ParityFixtureError::Storage(error.to_string()))?;
    Ok(CommissioningSnapshot::from_settings(&settings).has_completed_setup)
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

#[cfg(test)]
mod tests {
    use super::{
        load_parity_fixture_into, parse_parity_fixture_request, ParityFixtureError,
        ParityFixtureId, ParityFixtureRequest, ParityFixtureSummary, COMPLETED_SETUP_NEEDS_REPLACE,
    };
    use crate::app_state::{
        COMMISSIONING_COMPLETED_KEY, COMMISSIONING_RUNNER_STAGE_KEY, COMMISSIONING_STAGE_KEY,
    };
    use crate::shell_settings::WORKSPACE_KEY;
    use crate::storage::{initialize_test_database, list_settings_by_prefix, set_settings};
    use serde_json::{json, Value};
    use std::collections::{BTreeMap, HashMap};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    const DB_FILE_NAME: &str = "native.sqlite3";

    /// A fresh app-data folder holding a new database; removed on drop.
    struct TestAppData {
        dir: PathBuf,
    }

    impl TestAppData {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "studio-control-parity-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).expect("test dir should be created");
            initialize_test_database(&dir.join(DB_FILE_NAME)).expect("database should initialize");
            Self { dir }
        }

        fn db_path(&self) -> PathBuf {
            self.dir.join(DB_FILE_NAME)
        }

        fn load(
            &self,
            fixture_id: ParityFixtureId,
            replace_existing_data: bool,
        ) -> Result<ParityFixtureSummary, ParityFixtureError> {
            load_parity_fixture_into(
                &self.dir,
                &self.db_path(),
                &ParityFixtureRequest {
                    fixture_id,
                    replace_existing_data,
                },
            )
        }

        fn settings(&self) -> HashMap<String, String> {
            list_settings_by_prefix(&self.db_path(), "").expect("settings should read")
        }

        /// Every file in the folder but the database's own (its journal
        /// files come and go with each connection).
        fn files(&self) -> Vec<String> {
            let mut names = fs::read_dir(&self.dir)
                .expect("test dir should list")
                .map(|entry| entry.expect("directory entry").file_name())
                .map(|name| name.to_string_lossy().into_owned())
                .filter(|name| !name.starts_with(DB_FILE_NAME))
                .collect::<Vec<_>>();
            names.sort_unstable();
            names
        }
    }

    impl Drop for TestAppData {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn lighting_settings(settings: &HashMap<String, String>) -> BTreeMap<String, String> {
        settings
            .iter()
            .filter(|(key, _)| key.starts_with("app.lighting."))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    }

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

    // New pages program, Slice 2b: each fixture writes its setup flag (the
    // three commissioning keys) and its page itself, onto a fresh database.
    // Until then they came from the fixture's db.json through the import, and
    // `the_bundled_fixtures_carry_no_planning` read those files (Slice 2).
    // Only lighting-populated carries a rig; the others leave the lighting
    // settings as they were. The reply's `sourcePath` is the record of what
    // the load wrote.
    #[test]
    fn each_fixture_writes_its_setup_and_page() {
        for (fixture_id, completed, runner_stage, stage, page, surface, rig) in [
            (
                ParityFixtureId::LightingPopulated,
                "true",
                "publish",
                "ready",
                "lighting",
                "dashboard",
                Some((8, 4, 3)),
            ),
            (
                ParityFixtureId::AudioPopulated,
                "true",
                "publish",
                "ready",
                "audio",
                "dashboard",
                None,
            ),
            (
                ParityFixtureId::SetupReady,
                "true",
                "publish",
                "ready",
                "audio",
                "dashboard",
                None,
            ),
            (
                ParityFixtureId::SetupRequired,
                "false",
                "import",
                "setup-required",
                "audio",
                "commissioning",
                None,
            ),
        ] {
            let name = fixture_id.as_str();
            let app_data = TestAppData::new(name);
            let lighting_before = lighting_settings(&app_data.settings());

            let summary = app_data
                .load(fixture_id, false)
                .unwrap_or_else(|error| panic!("{name}: {error}"));

            let settings = app_data.settings();
            assert_eq!(settings[COMMISSIONING_COMPLETED_KEY], completed, "{name}");
            assert_eq!(
                settings[COMMISSIONING_RUNNER_STAGE_KEY], runner_stage,
                "{name}"
            );
            assert_eq!(settings[COMMISSIONING_STAGE_KEY], stage, "{name}");
            assert_eq!(settings[WORKSPACE_KEY], page, "{name}");
            assert_eq!(summary.fixture_id, name);
            assert_eq!(summary.target_surface, surface, "{name}");

            let record: Value = serde_json::from_slice(
                &fs::read(&summary.source_path)
                    .unwrap_or_else(|error| panic!("{name}: no record: {error}")),
            )
            .unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(record["fixtureId"], name);
            assert_eq!(record["settings"][WORKSPACE_KEY], page, "{name}");
            assert_eq!(
                record["settings"][COMMISSIONING_COMPLETED_KEY], completed,
                "{name}"
            );

            match rig {
                Some((lights, groups, scenes)) => {
                    let editor: Value =
                        serde_json::from_str(&settings["app.lighting.editor.state"])
                            .unwrap_or_else(|error| panic!("{name}: {error}"));
                    for (part, count) in
                        [("fixtures", lights), ("groups", groups), ("scenes", scenes)]
                    {
                        assert_eq!(
                            editor[part].as_array().map(Vec::len),
                            Some(count),
                            "{name}: {part}"
                        );
                    }
                    assert_eq!(
                        settings["app.lighting.enabled"], "false",
                        "{name}: the fixture never enables the light output"
                    );
                }
                None => assert_eq!(
                    lighting_settings(&settings),
                    lighting_before,
                    "{name} changed the lighting settings"
                ),
            }
        }
    }

    // New pages program, Slice 2b (F04): a load onto saved data whose setup
    // is complete is refused without `replaceExistingData` before anything is
    // written — no setting and no file; with it, the fixture loads over the
    // saved data. An earlier load whose setup is not complete does not count.
    // Until Slice 2b the import's gate refused such a load, but only after the
    // fixture's db.json had been copied into the app-data folder, and it
    // refused a second load after any earlier one.
    #[test]
    fn a_load_onto_a_completed_setup_needs_replace_existing_data() {
        let app_data = TestAppData::new("completed-setup");
        for _ in 0..2 {
            app_data
                .load(ParityFixtureId::SetupRequired, false)
                .expect("a setup that is not complete takes a load without the flag");
        }

        set_settings(
            &app_data.db_path(),
            &[
                (COMMISSIONING_COMPLETED_KEY, String::from("true")),
                (COMMISSIONING_RUNNER_STAGE_KEY, String::from("publish")),
                (COMMISSIONING_STAGE_KEY, String::from("ready")),
            ],
        )
        .expect("the setup should be marked complete");
        let settings_before = app_data.settings();
        let files_before = app_data.files();

        match app_data.load(ParityFixtureId::LightingPopulated, false) {
            Err(ParityFixtureError::InvalidParams(message)) => {
                assert_eq!(message, COMPLETED_SETUP_NEEDS_REPLACE);
            }
            other => panic!("a load over a completed setup must be refused, got {other:?}"),
        }
        assert_eq!(
            app_data.settings(),
            settings_before,
            "a refused load writes no setting"
        );
        assert_eq!(
            app_data.files(),
            files_before,
            "a refused load writes no file"
        );

        let summary = app_data
            .load(ParityFixtureId::LightingPopulated, true)
            .expect("replaceExistingData loads the fixture over a completed setup");
        assert_eq!(app_data.settings()[WORKSPACE_KEY], "lighting");
        assert!(Path::new(&summary.source_path).exists());
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
