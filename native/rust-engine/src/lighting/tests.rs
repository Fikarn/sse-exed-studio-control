use super::helpers::fixture_cct_range;
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

#[test]
fn lighting_identify_overlay_reports_full_white_during_active_burst() {
    let test_dir = TestDir::new("identify-active");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("setup should persist");

    let result = identify_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureIdentifyRequest {
            fixture_id: String::from("fixture-key-left"),
            duration_ms: Some(2000),
        },
    )
    .expect("identify burst should succeed");
    assert_eq!(result.fixture_id, "fixture-key-left");
    assert_eq!(result.duration_ms, 2000);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_lighting_snapshot(&settings);
    let fixture = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("fixture should exist in snapshot");
    assert!(fixture.on, "burst overlay should report fixture on");
    assert_eq!(
        fixture.intensity, 100,
        "burst overlay should drive intensity to 100"
    );
    let (_, max_cct) = fixture_cct_range(fixture.fixture_type.as_str());
    assert_eq!(
        fixture.cct, max_cct,
        "burst overlay should drive cct to fixture max"
    );
}

#[test]
fn lighting_identify_overlay_clears_when_burst_expires() {
    let test_dir = TestDir::new("identify-expires");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
            // Pre-seed an already-expired burst entry: started 10s ago,
            // duration 1.2s.
            (
                String::from("app.lighting.identify_bursts"),
                format!(
                    "{{\"fixture-key-left\":{{\"startedAtMs\":{},\"durationMs\":1200}}}}",
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64 - 10_000)
                        .unwrap_or(0)
                ),
            ),
        ],
    )
    .expect("setup should persist");

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_lighting_snapshot(&settings);
    let fixture = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("fixture should exist in snapshot");
    // Default seeded fixture is off, intensity 100 stored, cct 4500 — confirm
    // the expired burst is NOT applied as overlay.
    assert!(
        !fixture.on,
        "expired burst must not keep fixture on; default state should win"
    );
}

#[test]
fn lighting_identify_burst_rejects_unknown_fixture() {
    let test_dir = TestDir::new("identify-unknown");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("setup should persist");

    let error = identify_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureIdentifyRequest {
            fixture_id: String::from("fixture-does-not-exist"),
            duration_ms: None,
        },
    )
    .expect_err("identify burst on unknown fixture must fail");

    match error {
        LightingCommandError::Rejected(code, _) => {
            assert_eq!(code, "LIGHTING_FIXTURE_NOT_FOUND");
        }
        other => panic!("expected LIGHTING_FIXTURE_NOT_FOUND, got {:?}", other),
    }
}

#[test]
fn output_override_highlight_overlays_intensity_and_neutral_cct() {
    let test_dir = TestDir::new("override-highlight");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("setup should persist");

    let result = set_lighting_fixture_highlight(
        test_dir.db_path().as_path(),
        &LightingFixtureHighlightRequest {
            fixture_ids: vec![String::from("fixture-key-left")],
            mode: FixtureHighlightMode::Highlight,
        },
    )
    .expect("highlight should succeed");
    assert_eq!(result.mode, "highlight");
    assert_eq!(result.fixture_count, 1);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_lighting_snapshot(&settings);

    let highlighted = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("highlighted fixture should exist in snapshot");
    assert!(highlighted.on, "highlight overlay must drive fixture on");
    assert_eq!(
        highlighted.intensity, 100,
        "highlight overlay must drive intensity to 100"
    );
    assert_eq!(
        highlighted.cct, 4500,
        "highlight overlay must drive cct to neutral 4500 K"
    );

    // Sibling fixture not in the highlight set keeps its stored state
    // (default seeded fixtures are off).
    let untouched = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-right")
        .expect("sibling fixture should exist in snapshot");
    assert!(!untouched.on, "non-highlighted fixture stays at stored on");
}

#[test]
fn output_override_solo_dims_unselected() {
    let test_dir = TestDir::new("override-solo");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("setup should persist");

    // Power both key fixtures on so we have something for solo to dim.
    set_lighting_all_power(
        test_dir.db_path().as_path(),
        &LightingAllPowerRequest { on: true },
    )
    .expect("all-on should succeed");

    let result = set_lighting_fixture_highlight(
        test_dir.db_path().as_path(),
        &LightingFixtureHighlightRequest {
            fixture_ids: vec![String::from("fixture-key-left")],
            mode: FixtureHighlightMode::Solo,
        },
    )
    .expect("solo should succeed");
    assert_eq!(result.mode, "solo");
    assert_eq!(result.fixture_count, 1);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_lighting_snapshot(&settings);

    let soloed = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("solo-selected fixture should exist in snapshot");
    assert!(soloed.on, "solo-selected fixture keeps stored on=true");
    assert_eq!(
        soloed.intensity, 100,
        "solo-selected fixture keeps stored intensity"
    );

    let masked = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-right")
        .expect("non-soloed fixture should exist in snapshot");
    assert!(!masked.on, "solo mask must drive non-selected fixtures off");
    assert_eq!(
        masked.intensity, 0,
        "solo mask must zero intensity for non-selected fixtures"
    );

    let backline = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-backline-wash")
        .expect("backline fixture should exist in snapshot");
    assert!(
        !backline.on && backline.intensity == 0,
        "all non-selected fixtures must be dimmed by solo mask"
    );
}

#[test]
fn output_override_off_clears_overlay() {
    let test_dir = TestDir::new("override-off");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("setup should persist");

    // Start with highlight active.
    set_lighting_fixture_highlight(
        test_dir.db_path().as_path(),
        &LightingFixtureHighlightRequest {
            fixture_ids: vec![String::from("fixture-key-left")],
            mode: FixtureHighlightMode::Highlight,
        },
    )
    .expect("highlight setup should succeed");

    let mid_snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let mid_fixture = mid_snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("fixture in mid snapshot");
    assert!(
        mid_fixture.on && mid_fixture.intensity == 100,
        "highlight should be visible before clear"
    );

    // Clear via mode: off — fixture_ids ignored.
    let result = set_lighting_fixture_highlight(
        test_dir.db_path().as_path(),
        &LightingFixtureHighlightRequest {
            fixture_ids: Vec::new(),
            mode: FixtureHighlightMode::Off,
        },
    )
    .expect("clear should succeed");
    assert_eq!(result.mode, "off");
    assert_eq!(result.fixture_count, 0);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    assert_eq!(
        settings
            .get("app.lighting.highlight_ids")
            .map(String::as_str),
        Some("[]"),
        "highlight_ids should be cleared to empty array"
    );
    assert_eq!(
        settings.get("app.lighting.solo_ids").map(String::as_str),
        Some("[]"),
        "solo_ids should be cleared to empty array"
    );

    let snapshot = read_lighting_snapshot(&settings);
    let cleared = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("fixture should exist in snapshot");
    assert!(
        !cleared.on,
        "after clear, fixture returns to stored on=false"
    );
}

#[test]
fn identify_sequence_steps_through_in_order() {
    let test_dir = TestDir::new("identify-sequence");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
            (
                String::from("app.commissioning.check.lighting.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("setup should persist");

    let result = start_lighting_identify_sequence(
        test_dir.db_path().as_path(),
        &LightingFixtureIdentifySequenceRequest {
            fixture_ids: vec![
                String::from("fixture-key-left"),
                String::from("fixture-key-right"),
                String::from("fixture-backline-wash"),
            ],
            step_ms: 500,
            duration_ms: 400,
        },
    )
    .expect("sequence start should succeed");
    assert_eq!(result.fixture_count, 3);
    assert_eq!(result.step_ms, 500);
    assert_eq!(result.duration_ms, 400);
    assert_eq!(result.total_duration_ms, 1400); // (3-1)*500 + 400

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let raw = settings
        .get("app.lighting.identify_bursts")
        .expect("bursts persisted")
        .clone();
    let bursts: HashMap<String, IdentifyBurst> =
        serde_json::from_str(&raw).expect("bursts blob parses");
    assert_eq!(bursts.len(), 3);

    let started_left = bursts
        .get("fixture-key-left")
        .expect("first slot persisted")
        .started_at_ms;
    let started_right = bursts
        .get("fixture-key-right")
        .expect("second slot persisted")
        .started_at_ms;
    let started_back = bursts
        .get("fixture-backline-wash")
        .expect("third slot persisted")
        .started_at_ms;
    assert_eq!(started_right - started_left, 500);
    assert_eq!(started_back - started_left, 1000);

    // Step through virtual time relative to the first slot's started_at_ms.
    // Window 1: 100 ms after first slot starts → only first fixture active.
    let active_t1 = active_identify_burst_ids(&settings, started_left + 100);
    assert!(
        active_t1.contains("fixture-key-left") && active_t1.len() == 1,
        "at t1 only fixture-key-left should be active, got {:?}",
        active_t1
    );

    // Window 2: 600 ms after start → first slot has ended (400 ms duration),
    // second slot has started (500 ms offset, 100 ms into its 400 ms window).
    let active_t2 = active_identify_burst_ids(&settings, started_left + 600);
    assert!(
        active_t2.contains("fixture-key-right") && active_t2.len() == 1,
        "at t2 only fixture-key-right should be active, got {:?}",
        active_t2
    );

    // Window 3: 1100 ms after start → third slot active alone.
    let active_t3 = active_identify_burst_ids(&settings, started_left + 1100);
    assert!(
        active_t3.contains("fixture-backline-wash") && active_t3.len() == 1,
        "at t3 only fixture-backline-wash should be active, got {:?}",
        active_t3
    );

    // Beyond the sequence: no active bursts.
    let active_t4 = active_identify_burst_ids(&settings, started_left + 2000);
    assert!(
        active_t4.is_empty(),
        "after the sequence ends the active set should be empty, got {:?}",
        active_t4
    );
}

#[test]
fn identify_sequence_respects_unreachable_bridge() {
    let test_dir = TestDir::new("identify-sequence-unreachable");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    // Seed bridge ip but NOT the commissioning passed status — bridge
    // remains unreachable, mirroring an in-the-field "DMX unplugged" state.
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("2.0.0.10"),
            ),
            (String::from(LIGHTING_UNIVERSE_KEY), String::from("1")),
        ],
    )
    .expect("setup should persist");

    let result = start_lighting_identify_sequence(
        test_dir.db_path().as_path(),
        &LightingFixtureIdentifySequenceRequest {
            fixture_ids: vec![
                String::from("fixture-key-left"),
                String::from("fixture-key-right"),
            ],
            step_ms: 500,
            duration_ms: 400,
        },
    )
    .expect("sequence should still succeed when bridge is unreachable");
    assert_eq!(result.fixture_count, 2);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_lighting_snapshot(&settings);
    assert!(
        !snapshot.reachable,
        "bridge should remain unreachable after sequence starts"
    );

    // Bursts are persisted so the snapshot overlay still flashes the
    // first fixture in the sequence — operator sees the find indicator
    // even when DMX isn't being driven to the rig.
    let raw = settings
        .get("app.lighting.identify_bursts")
        .expect("bursts persisted even when bridge unreachable");
    let bursts: HashMap<String, IdentifyBurst> =
        serde_json::from_str(raw).expect("bursts blob parses");
    assert_eq!(bursts.len(), 2);
    let first_fixture = snapshot
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("first fixture in snapshot");
    assert!(
        first_fixture.on,
        "first scheduled burst should overlay snapshot regardless of reachability"
    );
}

#[test]
fn lighting_scene_reorder_parser_accepts_valid_payloads() {
    let with_anchor = parse_lighting_scene_reorder_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "beforeSceneId": "scene-prep",
    }))
    .expect("reorder parser should accept anchor");
    assert_eq!(with_anchor.scene_id, "scene-stream");
    assert_eq!(with_anchor.before_scene_id.as_deref(), Some("scene-prep"));

    let null_anchor = parse_lighting_scene_reorder_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "beforeSceneId": serde_json::Value::Null,
    }))
    .expect("reorder parser should accept null anchor");
    assert!(null_anchor.before_scene_id.is_none());

    let omitted_anchor = parse_lighting_scene_reorder_request(&serde_json::json!({
        "sceneId": "scene-stream",
    }))
    .expect("reorder parser should accept omitted anchor");
    assert!(omitted_anchor.before_scene_id.is_none());

    let blank_anchor = parse_lighting_scene_reorder_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "beforeSceneId": "   ",
    }))
    .expect("reorder parser should treat whitespace anchor as None");
    assert!(blank_anchor.before_scene_id.is_none());

    let trimmed_anchor = parse_lighting_scene_reorder_request(&serde_json::json!({
        "sceneId": "  scene-stream  ",
        "beforeSceneId": "  scene-prep  ",
    }))
    .expect("reorder parser should trim whitespace");
    assert_eq!(trimmed_anchor.scene_id, "scene-stream");
    assert_eq!(
        trimmed_anchor.before_scene_id.as_deref(),
        Some("scene-prep")
    );
}

#[test]
fn lighting_scene_reorder_parser_rejects_invalid_payloads() {
    parse_lighting_scene_reorder_request(&serde_json::json!({}))
        .expect_err("missing sceneId must reject");
    parse_lighting_scene_reorder_request(&serde_json::json!({ "sceneId": "  " }))
        .expect_err("blank sceneId must reject");
    parse_lighting_scene_reorder_request(&serde_json::json!({ "sceneId": 42 }))
        .expect_err("non-string sceneId must reject");
    parse_lighting_scene_reorder_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "beforeSceneId": "scene-stream",
    }))
    .expect_err("self-anchor must reject");
    parse_lighting_scene_reorder_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "beforeSceneId": 7,
    }))
    .expect_err("non-string non-null beforeSceneId must reject");
}

#[test]
fn lighting_scene_pin_parser_accepts_true_and_false() {
    let pinned = parse_lighting_scene_pin_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "pinned": true,
    }))
    .expect("pin parser should accept pinned=true");
    assert_eq!(pinned.scene_id, "scene-stream");
    assert!(pinned.pinned);

    let unpinned = parse_lighting_scene_pin_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "pinned": false,
    }))
    .expect("pin parser should accept pinned=false");
    assert!(!unpinned.pinned);

    let trimmed = parse_lighting_scene_pin_request(&serde_json::json!({
        "sceneId": "  scene-stream  ",
        "pinned": true,
    }))
    .expect("pin parser should trim whitespace");
    assert_eq!(trimmed.scene_id, "scene-stream");
}

#[test]
fn lighting_scene_pin_parser_rejects_invalid_payloads() {
    parse_lighting_scene_pin_request(&serde_json::json!({}))
        .expect_err("empty payload must reject");
    parse_lighting_scene_pin_request(&serde_json::json!({ "sceneId": "scene-stream" }))
        .expect_err("missing pinned must reject");
    parse_lighting_scene_pin_request(&serde_json::json!({
        "sceneId": "  ",
        "pinned": true,
    }))
    .expect_err("blank sceneId must reject");
    parse_lighting_scene_pin_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "pinned": "yes",
    }))
    .expect_err("non-boolean pinned must reject");
    parse_lighting_scene_pin_request(&serde_json::json!({
        "sceneId": "scene-stream",
        "pinned": 1,
    }))
    .expect_err("numeric pinned must reject");
}

#[test]
fn lighting_scene_reorder_moves_scene_in_scene_order() {
    let test_dir = TestDir::new("scene-reorder-move");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let baseline = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let baseline_ids: Vec<&str> = baseline.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        baseline_ids,
        ["scene-prep", "scene-teaching", "scene-stream"]
    );

    // Move scene-teaching before scene-prep:
    // [prep, teaching, stream] -> [teaching, prep, stream]
    reorder_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneReorderRequest {
            scene_id: String::from("scene-teaching"),
            before_scene_id: Some(String::from("scene-prep")),
        },
    )
    .expect("reorder before-anchor should succeed");
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let ordered_ids: Vec<&str> = snapshot.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ordered_ids,
        ["scene-teaching", "scene-prep", "scene-stream"]
    );

    // Move scene-teaching to the end (no anchor):
    // [teaching, prep, stream] -> [prep, stream, teaching]
    reorder_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneReorderRequest {
            scene_id: String::from("scene-teaching"),
            before_scene_id: None,
        },
    )
    .expect("reorder to end should succeed");
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let ordered_ids: Vec<&str> = snapshot.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ordered_ids,
        ["scene-prep", "scene-stream", "scene-teaching"]
    );

    // No-op: re-running the same "move scene-prep before scene-stream"
    // when scene-prep already sits before scene-stream must leave the
    // order unchanged.
    reorder_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneReorderRequest {
            scene_id: String::from("scene-prep"),
            before_scene_id: Some(String::from("scene-stream")),
        },
    )
    .expect("no-op reorder should succeed");
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let ordered_ids: Vec<&str> = snapshot.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ordered_ids,
        ["scene-prep", "scene-stream", "scene-teaching"],
        "no-op reorder must leave order untouched"
    );
}

#[test]
fn lighting_scene_reorder_rejects_unknown_ids() {
    let test_dir = TestDir::new("scene-reorder-unknown");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let unknown_scene = reorder_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneReorderRequest {
            scene_id: String::from("scene-imaginary"),
            before_scene_id: None,
        },
    )
    .expect_err("reorder with unknown scene must fail");
    match unknown_scene {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_SCENE_NOT_FOUND"),
        other => panic!("expected LIGHTING_SCENE_NOT_FOUND, got {:?}", other),
    }

    let unknown_anchor = reorder_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneReorderRequest {
            scene_id: String::from("scene-stream"),
            before_scene_id: Some(String::from("scene-imaginary")),
        },
    )
    .expect_err("reorder with unknown anchor must fail");
    match unknown_anchor {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_SCENE_NOT_FOUND"),
        other => panic!("expected LIGHTING_SCENE_NOT_FOUND, got {:?}", other),
    }
}

#[test]
fn lighting_scene_pin_floats_to_top_of_snapshot() {
    let test_dir = TestDir::new("scene-pin-top");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    // scene-stream is the third default scene; pinning floats it to the top.
    let result = pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-stream"),
            pinned: true,
        },
    )
    .expect("pin should succeed");
    assert!(result.scene.pinned);
    assert_eq!(result.scene.id, "scene-stream");

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert_eq!(snapshot.scenes[0].id, "scene-stream");
    assert!(snapshot.scenes[0].pinned);
    assert_eq!(snapshot.scenes.iter().filter(|s| s.pinned).count(), 1);
    let unpinned: Vec<&str> = snapshot
        .scenes
        .iter()
        .skip(1)
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(unpinned, ["scene-prep", "scene-teaching"]);
}

#[test]
fn lighting_scene_pin_is_idempotent_and_unpin_clears_state() {
    let test_dir = TestDir::new("scene-pin-idempotent");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-stream"),
            pinned: true,
        },
    )
    .expect("first pin should succeed");
    pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-stream"),
            pinned: true,
        },
    )
    .expect("repeat pin should succeed");

    let state = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let pinned_count = state
        .pinned_scene_ids
        .iter()
        .filter(|id| id.as_str() == "scene-stream")
        .count();
    assert_eq!(pinned_count, 1, "duplicate pin must not double-add");

    pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-stream"),
            pinned: false,
        },
    )
    .expect("first unpin should succeed");
    pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-stream"),
            pinned: false,
        },
    )
    .expect("repeat unpin should succeed");

    let state = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(state.pinned_scene_ids.is_empty());
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(snapshot.scenes.iter().all(|s| !s.pinned));
}

#[test]
fn lighting_scene_pin_rejects_unknown_scene() {
    let test_dir = TestDir::new("scene-pin-unknown");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let error = pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-imaginary"),
            pinned: true,
        },
    )
    .expect_err("pin on unknown scene must fail");
    match error {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_SCENE_NOT_FOUND"),
        other => panic!("expected LIGHTING_SCENE_NOT_FOUND, got {:?}", other),
    }
}

#[test]
fn lighting_scene_pin_and_reorder_keep_pinned_cluster_in_front() {
    let test_dir = TestDir::new("scene-pin-reorder-roundtrip");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-prep"),
            pinned: true,
        },
    )
    .expect("pin scene-prep should succeed");
    pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-stream"),
            pinned: true,
        },
    )
    .expect("pin scene-stream should succeed");

    // Reorder a pinned scene: the pinned cluster's internal order must
    // reflect the reordered scene_order, and unpinned scenes must stay
    // behind the pinned cluster regardless of scene_order position.
    reorder_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneReorderRequest {
            scene_id: String::from("scene-stream"),
            before_scene_id: Some(String::from("scene-prep")),
        },
    )
    .expect("reorder of pinned scene should succeed");

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let pinned_ids: Vec<&str> = snapshot
        .scenes
        .iter()
        .filter(|s| s.pinned)
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(
        pinned_ids,
        ["scene-stream", "scene-prep"],
        "pinned cluster must respect reordered scene_order"
    );
    let unpinned_ids: Vec<&str> = snapshot
        .scenes
        .iter()
        .filter(|s| !s.pinned)
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(
        unpinned_ids,
        ["scene-teaching"],
        "unpinned scenes must trail the pinned cluster"
    );

    pin_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingScenePinRequest {
            scene_id: String::from("scene-prep"),
            pinned: false,
        },
    )
    .expect("unpin scene-prep should succeed");

    // After unpinning scene-prep, scene_order is still
    // [scene-stream, scene-prep, scene-teaching]; pinned-first ordering
    // emits scene-stream (pinned), then scene-prep + scene-teaching in
    // scene_order.
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let ordered: Vec<&str> = snapshot.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ordered,
        ["scene-stream", "scene-prep", "scene-teaching"],
        "unpin must return scene to its scene_order slot among unpinned"
    );
    let pinned_ids: Vec<&str> = snapshot
        .scenes
        .iter()
        .filter(|s| s.pinned)
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(pinned_ids, ["scene-stream"]);
}

#[test]
fn lighting_normalize_populates_scene_order_for_legacy_state() {
    let test_dir = TestDir::new("normalize-legacy-order");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    // Persist a state with an empty scene_order + pinned_scene_ids,
    // simulating an editor blob serialized before #55/#56 introduced
    // those fields. normalize_lighting_editor_state must rebuild
    // scene_order from the live scenes vec on load.
    let mut state = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    state.scene_order.clear();
    state.pinned_scene_ids.clear();
    save_lighting_editor_state(test_dir.db_path().as_path(), &state)
        .expect("legacy-shaped state should persist");

    let normalized = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let order_ids: Vec<&str> = normalized
        .scene_order
        .iter()
        .map(|id| id.as_str())
        .collect();
    let scene_ids: Vec<&str> = normalized.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        order_ids, scene_ids,
        "legacy state must rebuild scene_order from live scenes"
    );
    assert!(normalized.pinned_scene_ids.is_empty());
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let snapshot_ids: Vec<&str> = snapshot.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        snapshot_ids,
        ["scene-prep", "scene-teaching", "scene-stream"],
        "snapshot order must follow rebuilt scene_order"
    );
}

#[test]
fn lighting_normalize_drops_pinned_orphans_and_scene_order_orphans() {
    let test_dir = TestDir::new("normalize-orphans");
    initialize_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let mut state = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    state.pinned_scene_ids = vec![
        String::from("scene-stream"),
        String::from("scene-deleted-ghost"),
    ];
    state.scene_order.push(String::from("scene-also-ghost"));
    save_lighting_editor_state(test_dir.db_path().as_path(), &state)
        .expect("orphan-bearing state should persist");

    let normalized = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    assert!(normalized
        .pinned_scene_ids
        .iter()
        .any(|id| id == "scene-stream"));
    assert!(
        !normalized
            .pinned_scene_ids
            .iter()
            .any(|id| id == "scene-deleted-ghost"),
        "orphan pinned ids must be filtered on load"
    );
    assert!(
        !normalized
            .scene_order
            .iter()
            .any(|id| id == "scene-also-ghost"),
        "orphan scene_order ids must be filtered on load"
    );
    // All live scenes must still appear in the rebuilt scene_order.
    for scene in &normalized.scenes {
        assert!(
            normalized.scene_order.iter().any(|id| id == &scene.id),
            "live scene {} must appear in scene_order after normalization",
            scene.id
        );
    }
}
