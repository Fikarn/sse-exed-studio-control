use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_CHECK_ID, LIGHTING_UNIVERSE_KEY};
use crate::storage::{initialize_database, list_settings_by_prefix, set_settings_owned};
use std::collections::HashMap;
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

#[test]
fn lighting_snapshot_reports_unconfigured_when_no_bridge_exists() {
    let snapshot = read_lighting_snapshot(&HashMap::new());
    assert_eq!(snapshot.status, "unconfigured");
    assert!(!snapshot.enabled);
    assert!(!snapshot.connected);
}

#[test]
fn lighting_snapshot_reports_ready_when_probe_passed() {
    let settings = HashMap::from([
        (
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        ),
        (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
        (
            String::from("app.commissioning.check.lighting.status"),
            String::from("passed"),
        ),
    ]);

    let snapshot = read_lighting_snapshot(&settings);
    assert_eq!(snapshot.status, "ready");
    assert!(snapshot.reachable);
    assert!(snapshot.connected);
    assert_eq!(snapshot.fixtures.len(), 4);
    assert_eq!(snapshot.groups.len(), 2);
    assert_eq!(snapshot.scenes.len(), 3);
    assert_eq!(snapshot.groups[0].fixture_count, 3);
}

#[test]
fn lighting_dmx_monitor_matches_legacy_channel_shape() {
    let settings = HashMap::from([
        (
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        ),
        (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
        (String::from(LIGHTING_ENABLED_KEY), String::from("true")),
        (String::from(LIGHTING_GRAND_MASTER_KEY), String::from("50")),
    ]);

    let monitor = read_lighting_dmx_monitor_snapshot(&settings);
    assert!(!monitor.channels.is_empty());
    assert_eq!(monitor.channels[0].channel, 1);
    assert_eq!(monitor.channels[0].light_name, "Key Left");
    assert_eq!(monitor.channels[0].label, "Dimmer");
    assert_eq!(monitor.channels[0].value, 0);
    assert!(monitor
        .channels
        .iter()
        .any(|channel| channel.label == "CCT" && channel.channel == 2));
    assert!(monitor
        .channels
        .iter()
        .any(|channel| channel.light_name == "Backline Wash" && channel.label == "±G/M"));
    assert!(monitor
        .channels
        .iter()
        .any(|channel| channel.light_name == "House Practicals" && channel.label == "FX"));
}

#[test]
fn lighting_scene_recall_rejects_until_probe_passes() {
    let test_dir = TestDir::new("scene-rejects");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("bridge ip should persist");

    let error = recall_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneRecallRequest {
            scene_id: String::from("scene-prep"),
            fade_duration_seconds: 0.0,
        },
    )
    .expect_err("scene recall should reject");

    match error {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_NOT_VERIFIED"),
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn lighting_scene_recall_updates_last_recalled_scene() {
    let test_dir = TestDir::new("scene-ready");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting state should persist");

    let result = recall_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneRecallRequest {
            scene_id: String::from("scene-stream"),
            fade_duration_seconds: 1.5,
        },
    )
    .expect("scene recall should succeed");

    assert!(result.recalled);
    assert_eq!(result.scene_name, "Stream");
    assert_eq!(result.fade_duration_seconds, 1.5);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_lighting_snapshot(&settings);
    assert_eq!(
        snapshot.last_recalled_scene_id.as_deref(),
        Some("scene-stream")
    );
    assert!(snapshot
        .scenes
        .iter()
        .any(|entry| entry.id == "scene-stream" && entry.last_recalled));
    assert_eq!(snapshot.last_action_status, "succeeded");
    assert!(snapshot
        .fixtures
        .iter()
        .any(|entry| entry.id == "fixture-key-left" && entry.on && entry.intensity == 90));
}

#[test]
fn lighting_fixture_effect_and_all_power_refresh_snapshot_state() {
    let test_dir = TestDir::new("fixture-update");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting state should persist");

    let updated = update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-left"),
            name: None,
            fixture_type: None,
            dmx_start_address: None,
            effect: Some(Some(LightingEffect {
                effect_type: String::from("strobe"),
                speed: 7,
            })),
            on: Some(true),
            intensity: Some(72),
            cct: Some(5100),
            group_id: Some(Some(String::from("group-room"))),
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture update should succeed");
    assert!(updated.fixture.on);
    assert_eq!(updated.fixture.intensity, 72);
    assert_eq!(updated.fixture.cct, 5100);
    assert_eq!(updated.fixture.group_id.as_deref(), Some("group-room"));
    assert_eq!(
        updated
            .fixture
            .effect
            .as_ref()
            .map(|effect| effect.effect_type.as_str()),
        Some("strobe")
    );

    let power = set_lighting_all_power(
        test_dir.db_path().as_path(),
        &LightingAllPowerRequest { on: false },
    )
    .expect("all power should succeed");
    assert_eq!(power.affected_fixtures, 4);

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(snapshot.fixtures.iter().all(|entry| !entry.on));
    assert_eq!(
        snapshot
            .fixtures
            .iter()
            .find(|entry| entry.id == "fixture-key-left")
            .and_then(|entry| entry.effect.as_ref())
            .map(|effect| effect.effect_type.as_str()),
        Some("strobe")
    );
    assert_eq!(snapshot.last_action_status, "succeeded");
}

#[test]
fn lighting_group_crud_updates_fixture_assignments() {
    let test_dir = TestDir::new("group-crud");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let created = create_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupCreateRequest {
            name: String::from("Audience"),
        },
    )
    .expect("group create should succeed");
    assert_eq!(created.group.name, "Audience");

    let reassigned_fixture = update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-house-practicals"),
            name: None,
            fixture_type: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            group_id: Some(Some(created.group.id.clone())),
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture reassignment should succeed");
    assert_eq!(
        reassigned_fixture.fixture.group_id.as_deref(),
        Some(created.group.id.as_str())
    );

    let renamed = update_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupUpdateRequest {
            group_id: created.group.id.clone(),
            name: String::from("Audience Fill"),
        },
    )
    .expect("group rename should succeed");
    assert_eq!(renamed.group.name, "Audience Fill");
    assert_eq!(renamed.group.fixture_count, 1);

    let deleted = delete_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupDeleteRequest {
            group_id: created.group.id.clone(),
        },
    )
    .expect("group delete should succeed");
    assert!(deleted.deleted);

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(snapshot
        .groups
        .iter()
        .all(|group| group.id != created.group.id));
    assert_eq!(
        snapshot
            .fixtures
            .iter()
            .find(|fixture| fixture.id == "fixture-house-practicals")
            .and_then(|fixture| fixture.group_id.as_deref()),
        None
    );
}

#[test]
fn lighting_spatial_updates_and_markers_round_trip() {
    let test_dir = TestDir::new("spatial-state");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let fixture_update = update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-left"),
            name: None,
            fixture_type: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            group_id: None,
            spatial_x: Some(Some(0.62)),
            spatial_y: Some(Some(0.38)),
            spatial_rotation: Some(225.0),
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture spatial update should succeed");
    assert_eq!(fixture_update.fixture.spatial_x, Some(0.62));
    assert_eq!(fixture_update.fixture.spatial_y, Some(0.38));
    assert_eq!(fixture_update.fixture.spatial_rotation, 225.0);

    let settings_update = update_lighting_settings(
        test_dir.db_path().as_path(),
        &LightingSettingsUpdateRequest {
            enabled: None,
            bridge_ip: None,
            universe: None,
            grand_master: None,
            selected_scene_id: None,
            selected_fixture_id: Some(Some(String::from("fixture-key-left"))),
            camera_marker: Some(Some(LightingSpatialMarker {
                x: 0.5,
                y: 0.82,
                rotation: 0.0,
            })),
            subject_marker: Some(Some(LightingSpatialMarker {
                x: 0.5,
                y: 0.44,
                rotation: 180.0,
            })),
        },
    )
    .expect("lighting settings update should succeed");
    assert_eq!(
        settings_update.selected_fixture_id.as_deref(),
        Some("fixture-key-left")
    );
    assert!(settings_update.camera_marker.is_some());
    assert!(settings_update.subject_marker.is_some());

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let fixture = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("fixture should remain present");
    assert_eq!(fixture.spatial_x, Some(0.62));
    assert_eq!(fixture.spatial_y, Some(0.38));
    assert_eq!(fixture.spatial_rotation, 225.0);
    assert_eq!(
        snapshot.selected_fixture_id.as_deref(),
        Some("fixture-key-left")
    );
    assert_eq!(
        snapshot.camera_marker.as_ref().map(|marker| marker.y),
        Some(0.82)
    );
    assert_eq!(
        snapshot
            .subject_marker
            .as_ref()
            .map(|marker| marker.rotation),
        Some(180.0)
    );
}

#[test]
fn lighting_settings_update_persists_transport_scene_focus_and_grand_master() {
    let test_dir = TestDir::new("lighting-settings");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (
                String::from(format!(
                    "app.commissioning.check.{LIGHTING_CHECK_ID}.status"
                )),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting state should persist");

    let updated = update_lighting_settings(
        test_dir.db_path().as_path(),
        &LightingSettingsUpdateRequest {
            enabled: Some(false),
            bridge_ip: Some(String::from("2.0.0.20")),
            universe: Some(4),
            grand_master: Some(68),
            selected_scene_id: Some(Some(String::from("scene-stream"))),
            selected_fixture_id: None,
            camera_marker: None,
            subject_marker: None,
        },
    )
    .expect("lighting settings update should succeed");

    assert!(!updated.enabled);
    assert_eq!(updated.bridge_ip, "2.0.0.20");
    assert_eq!(updated.universe, 4);
    assert_eq!(updated.grand_master, 68);
    assert_eq!(updated.selected_scene_id.as_deref(), Some("scene-stream"));

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert_eq!(snapshot.status, "disabled");
    assert!(!snapshot.enabled);
    assert!(!snapshot.connected);
    assert!(!snapshot.reachable);
    assert_eq!(snapshot.bridge_ip, "2.0.0.20");
    assert_eq!(snapshot.universe, 4);
    assert_eq!(snapshot.grand_master, 68);
    assert_eq!(snapshot.fixtures.len(), 4);
    assert_eq!(snapshot.scenes.len(), 3);
    assert_eq!(snapshot.selected_scene_id.as_deref(), Some("scene-stream"));
}

#[test]
fn lighting_fixture_crud_preserves_custom_and_deleted_inventory_state() {
    let test_dir = TestDir::new("fixture-crud");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let created = create_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureCreateRequest {
            name: String::from("Audience Key"),
            fixture_type: String::from("astra-bicolor"),
            dmx_start_address: 33,
            group_id: Some(String::from("group-room")),
        },
    )
    .expect("fixture create should succeed");
    assert_eq!(created.fixture.fixture_type, "astra-bicolor");
    assert_eq!(created.fixture.dmx_start_address, 33);

    let updated = update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: created.fixture.id.clone(),
            name: Some(String::from("Audience Fill")),
            fixture_type: Some(String::from("infinimat")),
            dmx_start_address: Some(41),
            effect: Some(Some(LightingEffect {
                effect_type: String::from("candle"),
                speed: 4,
            })),
            on: None,
            intensity: None,
            cct: Some(6100),
            group_id: Some(Some(String::from("group-stage"))),
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture update should succeed");
    assert_eq!(updated.fixture.name, "Audience Fill");
    assert_eq!(updated.fixture.fixture_type, "infinimat");
    assert_eq!(updated.fixture.dmx_start_address, 41);
    assert_eq!(updated.fixture.group_id.as_deref(), Some("group-stage"));
    assert_eq!(
        updated
            .fixture
            .effect
            .as_ref()
            .map(|effect| effect.effect_type.as_str()),
        Some("candle")
    );

    let deleted = delete_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureDeleteRequest {
            fixture_id: String::from("fixture-key-left"),
        },
    )
    .expect("fixture delete should succeed");
    assert!(deleted.deleted);

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(snapshot
        .fixtures
        .iter()
        .all(|fixture| fixture.id != "fixture-key-left"));
    assert!(snapshot
        .fixtures
        .iter()
        .any(|fixture| fixture.id == created.fixture.id && fixture.dmx_start_address == 41));

    let reloaded_state = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(reloaded_state
        .fixtures
        .iter()
        .all(|fixture| fixture.id != "fixture-key-left"));
    assert!(reloaded_state
        .fixtures
        .iter()
        .any(|fixture| fixture.id == created.fixture.id));
}

#[test]
fn lighting_scene_crud_uses_shared_editor_state() {
    let test_dir = TestDir::new("scene-crud");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-left"),
            name: None,
            fixture_type: None,
            dmx_start_address: None,
            effect: None,
            on: Some(true),
            intensity: Some(61),
            cct: Some(4900),
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture update should succeed");

    let created = create_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneCreateRequest {
            name: String::from("Cue A"),
        },
    )
    .expect("scene create should succeed");
    assert_eq!(created.scene.name, "Cue A");

    let renamed = update_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneUpdateRequest {
            scene_id: created.scene.id.clone(),
            name: Some(String::from("Cue B")),
            capture_current_state: true,
        },
    )
    .expect("scene update should succeed");
    assert_eq!(renamed.scene.name, "Cue B");

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(snapshot.scenes.iter().any(|scene| scene.name == "Cue B"));

    let deleted = delete_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneDeleteRequest {
            scene_id: created.scene.id.clone(),
        },
    )
    .expect("scene delete should succeed");
    assert!(deleted.deleted);

    let final_snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(final_snapshot
        .scenes
        .iter()
        .all(|scene| scene.id != created.scene.id));
}

#[test]
fn lighting_fixture_rig_z_and_beam_angle_round_trip() {
    let test_dir = TestDir::new("fixture-rig-beam");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let updated = update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-left"),
            name: None,
            fixture_type: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: Some(Some(4.5)),
            beam_angle_degrees: Some(Some(36.0)),
        },
    )
    .expect("fixture update should succeed");
    assert_eq!(updated.fixture.rig_z, Some(4.5));
    assert_eq!(updated.fixture.beam_angle_degrees, Some(36.0));

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let fixture = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("fixture should round-trip through snapshot");
    assert_eq!(fixture.rig_z, Some(4.5));
    assert_eq!(fixture.beam_angle_degrees, Some(36.0));

    let cleared = update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-left"),
            name: None,
            fixture_type: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: Some(None),
            beam_angle_degrees: Some(None),
        },
    )
    .expect("fixture clear should succeed");
    assert_eq!(cleared.fixture.rig_z, None);
    assert_eq!(cleared.fixture.beam_angle_degrees, None);
}
