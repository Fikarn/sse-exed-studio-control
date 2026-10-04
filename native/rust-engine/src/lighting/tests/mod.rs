// Lighting integration tests. The helpers live here; the tests are in the
// modules below, by what they cover (2026-09 production readiness, Slice 14:
// one 3,480-line file became four, every test verbatim).
use super::helpers::fixture_cct_range;
use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_CHECK_ID, LIGHTING_UNIVERSE_KEY};
use crate::storage::{initialize_test_database, list_settings_by_prefix, set_settings_owned};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "studio-control-engine-lighting-{label}-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&path).expect("test dir should be created");
        Self { path }
    }

    fn db_path(&self) -> PathBuf {
        self.path.join("native.sqlite3")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn initialize_ready_lighting(label: &str) -> TestDir {
    let test_dir = TestDir::new(label);
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (
                format!("app.commissioning.check.{LIGHTING_CHECK_ID}.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting state should persist");
    test_dir
}

fn load_test_app_settings(test_dir: &TestDir) -> HashMap<String, String> {
    list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load")
}

fn fixture_snapshot<'a>(
    snapshot: &'a LightingSnapshot,
    fixture_id: &str,
) -> &'a LightingFixtureSnapshot {
    snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == fixture_id)
        .expect("fixture should be present")
}

fn preview_fixture_snapshot<'a>(
    snapshot: &'a LightingSnapshot,
    fixture_id: &str,
) -> &'a LightingFixtureSnapshot {
    snapshot
        .preview_fixtures
        .iter()
        .find(|fixture| fixture.id == fixture_id)
        .expect("preview fixture should be present")
}

fn scene_snapshot<'a>(snapshot: &'a LightingSnapshot, scene_id: &str) -> &'a LightingSceneSnapshot {
    snapshot
        .scenes
        .iter()
        .find(|scene| scene.id == scene_id)
        .expect("scene should be present")
}

/// What the wire carries right now in one fixture's channel, found by the
/// fixture's name and the channel's label in the DMX monitor (which reads
/// the same numbers as the sACN frames).
fn wire_slot(test_dir: &TestDir, light_name: &str, label: &str) -> u8 {
    let settings = load_test_app_settings(test_dir);
    let monitor = read_lighting_dmx_monitor_snapshot(&settings);
    let channel = monitor
        .channels
        .iter()
        .find(|channel| channel.light_name == light_name && channel.label == label)
        .unwrap_or_else(|| panic!("{light_name} should have a {label} channel"));
    let output =
        read_lighting_sacn_output_state(&settings).expect("a commissioned rig renders frames");
    let frame = output
        .frames
        .iter()
        .find(|frame| i64::from(frame.universe) == channel.universe)
        .expect("the fixture's universe should be rendered");
    frame.slots[(channel.channel - 1) as usize]
}

/// Every fixture's dimmer on the wire, by the fixture's name.
fn wire_dimmers(test_dir: &TestDir) -> Vec<(String, u8)> {
    let names: Vec<String> = read_lighting_snapshot(&load_test_app_settings(test_dir))
        .fixtures
        .into_iter()
        .map(|fixture| fixture.name)
        .collect();
    names
        .into_iter()
        .map(|name| {
            let slot = wire_slot(test_dir, &name, "Dimmer");
            (name, slot)
        })
        .collect()
}

fn update_fixture_json(
    test_dir: &TestDir,
    request: serde_json::Value,
) -> LightingFixtureUpdateResult {
    update_lighting_fixture(
        test_dir.db_path().as_path(),
        &parse_lighting_fixture_update_request(&request).expect("the update should parse"),
    )
    .expect("the fixture should update")
}

mod catalog_and_preview;
mod fixtures_and_overlays;
mod ordering;
mod scene_state_rules;
