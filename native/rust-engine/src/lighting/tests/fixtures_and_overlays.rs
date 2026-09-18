// Fixture edits and inventory, scene restore, and the identify / highlight / solo / find overlays.

use super::*;

#[test]
fn lighting_fixture_effect_and_all_power_refresh_snapshot_state() {
    let test_dir = TestDir::new("fixture-update");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: None,
            effect: Some(Some(LightingEffect {
                effect_type: String::from("strobe"),
                speed: 7,
            })),
            on: Some(true),
            intensity: Some(72),
            cct: Some(5100),
            control_values: None,
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            control_values: None,
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
            name: Some(String::from("Audience Fill")),
            color_index: None,
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: Some(Some(6.2)),
            spatial_y: Some(Some(3.8)),
            spatial_rotation: Some(225.0),
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture spatial update should succeed");
    assert_eq!(fixture_update.fixture.spatial_x, Some(6.2));
    assert_eq!(fixture_update.fixture.spatial_y, Some(3.8));
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
    assert_eq!(fixture.spatial_x, Some(6.2));
    assert_eq!(fixture.spatial_y, Some(3.8));
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
            definition_id: String::from("litepanels-astra-bicolor"),
            mode_id: String::from("default"),
            universe: 1,
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
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: Some(41),
            effect: Some(Some(LightingEffect {
                effect_type: String::from("candle"),
                speed: 4,
            })),
            on: None,
            intensity: None,
            cct: Some(6100),
            control_values: None,
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: None,
            effect: None,
            on: Some(true),
            intensity: Some(61),
            cct: Some(4900),
            control_values: None,
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
            fixture_states: None,
            color_index: None,
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
            color_index: None,
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
fn lighting_scene_create_accepts_explicit_fixture_states_for_restore() {
    let test_dir = initialize_ready_lighting("scene-create-explicit-state");
    update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-left"),
            name: None,
            fixture_type: None,
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: None,
            effect: None,
            on: Some(false),
            intensity: Some(10),
            cct: Some(3200),
            control_values: None,
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
            name: String::from("Restored Look"),
            fixture_states: Some(vec![LightingEditorSceneFixtureState {
                fixture_id: String::from("fixture-key-left"),
                intensity: 77,
                cct: 5600,
                on: true,
                control_values: HashMap::new(),
            }]),
            color_index: Some(4),
        },
    )
    .expect("scene create with explicit state should succeed");

    assert_eq!(created.scene.name, "Restored Look");
    assert_eq!(created.scene.color_index, Some(4));
    assert_eq!(created.scene.fixture_states.len(), 1);
    assert_eq!(created.scene.fixture_states[0].intensity, 77);
    assert_eq!(created.scene.fixture_states[0].cct, 5600);
    assert!(created.scene.fixture_states[0].on);
}

#[test]
fn lighting_fixture_rig_z_and_beam_angle_round_trip() {
    let test_dir = TestDir::new("fixture-rig-beam");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            control_values: None,
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
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: None,
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            control_values: None,
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
