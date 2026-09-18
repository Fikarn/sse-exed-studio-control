// The fixture catalog, patch validation, the snapshot, palettes, recall gating and preview mode.

use super::*;

#[test]
fn lighting_fixture_catalog_contains_verified_and_research_entries() {
    let catalog = read_lighting_fixture_catalog_snapshot();
    let ids = catalog
        .definitions
        .iter()
        .map(|definition| definition.id.as_str())
        .collect::<HashSet<_>>();

    for expected in [
        "litepanels-astra-bicolor",
        "aputure-infinimat-generic",
        "aputure-infinibar-pb12",
        "aputure-ls-600d-pro",
        "aputure-storm-80c",
        "aputure-storm-1200x",
        "litepanels-astra-ip",
        "litepanels-gemini-1x1",
        "litepanels-gemini-2x1",
        "litepanels-studio-x-bicolor",
    ] {
        assert!(
            ids.contains(expected),
            "missing verified catalog entry {expected}"
        );
    }

    let research_needed = catalog
        .definitions
        .iter()
        .find(|definition| definition.id == "aputure-storm-1000c")
        .expect("research-needed entry should be exposed");
    assert_eq!(research_needed.status, "research-needed");
    assert_eq!(research_needed.modes[0].channel_count, 0);
}

#[test]
fn lighting_fixture_catalog_modes_have_valid_channel_maps() {
    let catalog = read_lighting_fixture_catalog_snapshot();
    let mut definition_ids = HashSet::new();
    for definition in &catalog.definitions {
        assert!(
            definition_ids.insert(definition.id.as_str()),
            "duplicate catalog definition {}",
            definition.id
        );
        assert!(
            definition
                .modes
                .iter()
                .any(|mode| mode.id == definition.default_mode_id),
            "definition {} default mode should exist",
            definition.id
        );
        for mode in &definition.modes {
            assert_eq!(mode.channel_count, mode.channels.len() as i64);
            assert!(mode.channel_count <= 512);
            let mut offsets = HashSet::new();
            for channel in &mode.channels {
                assert!(channel.offset >= 1);
                assert!(
                    offsets.insert(channel.offset),
                    "duplicate channel offset {} in {} / {}",
                    channel.offset,
                    definition.id,
                    mode.id
                );
                assert!(channel.default_dmx >= 0 && channel.default_dmx <= 255);
            }
            if definition.status == "verified" && definition.kind != "control-node" {
                assert!(
                    mode.channel_count > 0,
                    "{} / {} should be selectable with DMX channels",
                    definition.id,
                    mode.id
                );
            }
        }
    }
}

#[test]
fn lighting_fixture_catalog_visual_metadata_is_complete() {
    let catalog = read_lighting_fixture_catalog_snapshot();
    let allowed_symbol_kinds = ["control-node", "fresnel", "linear-bar", "panel", "soft-mat"];
    let allowed_beam_types = ["fresnel", "glow", "none", "rectangle", "spot", "wash"];
    let allowed_confidence = ["catalogue-derived", "fallback", "verified"];

    for definition in &catalog.definitions {
        let visual = &definition.visual;
        assert!(
            allowed_symbol_kinds.contains(&visual.symbol_kind.as_str()),
            "{} has invalid symbolKind {}",
            definition.id,
            visual.symbol_kind
        );
        assert!(
            !visual.symbol_variant.trim().is_empty(),
            "{} should expose a stable symbolVariant",
            definition.id
        );
        assert!(
            allowed_beam_types.contains(&visual.output.beam_type.as_str()),
            "{} has invalid beamType {}",
            definition.id,
            visual.output.beam_type
        );
        assert!(
            allowed_confidence.contains(&visual.visual_confidence.as_str()),
            "{} has invalid visualConfidence {}",
            definition.id,
            visual.visual_confidence
        );

        if visual.shape == "control-node" {
            assert_eq!(visual.symbol_kind, "control-node");
            assert_eq!(visual.output.beam_type, "none");
            assert!(visual.output.photometric_samples.is_empty());
        }

        if let Some(emitter_layout) = &visual.emitter_layout {
            assert!(
                emitter_layout.rows > 0,
                "{} emitter rows should be positive",
                definition.id
            );
            assert!(
                emitter_layout.columns > 0,
                "{} emitter columns should be positive",
                definition.id
            );
            assert!(
                emitter_layout.segments > 0,
                "{} emitter segments should be positive",
                definition.id
            );
            if let Some(pixel_layout) = &visual.pixel_layout {
                assert_eq!(emitter_layout.rows, pixel_layout.rows);
                assert_eq!(emitter_layout.columns, pixel_layout.columns);
                assert_eq!(emitter_layout.segments, pixel_layout.segments);
                assert_eq!(emitter_layout.direction, pixel_layout.order);
            }
        }
    }

    let pb12 = catalog
        .definitions
        .iter()
        .find(|definition| definition.id == "aputure-infinibar-pb12")
        .expect("PB12 definition should be present");
    assert_eq!(pb12.visual.symbol_kind, "linear-bar");
    assert_eq!(pb12.visual.symbol_variant, "infinibar-pb12");
    assert_eq!(pb12.visual.output.beam_type, "rectangle");
    assert_eq!(
        pb12.visual
            .emitter_layout
            .as_ref()
            .and_then(|layout| layout.physical_pixels),
        Some(96)
    );
    let samples = &pb12.visual.output.photometric_samples;
    assert_eq!(samples.len(), 2);
    assert_eq!(samples[0].cct, 5600);
    assert_eq!(samples[0].distance_meters, 0.5);
    assert_eq!(samples[0].lux, 1600.0);
    assert_eq!(samples[0].modifier, "none");
    assert_eq!(samples[0].source, "Aputure INFINIBAR PB12 product page");
    assert_eq!(samples[1].cct, 5600);
    assert_eq!(samples[1].distance_meters, 1.0);
    assert_eq!(samples[1].lux, 593.0);
    assert_eq!(samples[1].modifier, "none");
    assert_eq!(samples[1].source, "Aputure INFINIBAR PB12 product page");
}

#[test]
fn lighting_snapshot_backfills_catalog_identity_for_legacy_fixture_types() {
    let test_dir = initialize_ready_lighting("catalog-legacy-bridge");
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let key = fixture_snapshot(&snapshot, "fixture-key-left");
    assert_eq!(key.fixture_type, "astra-bicolor");
    assert_eq!(key.definition_id, "litepanels-astra-bicolor");
    assert_eq!(key.mode_id, "default");
    assert_eq!(key.universe, 1);
    assert!(key.control_values.contains_key("intensity"));

    let practicals = fixture_snapshot(&snapshot, "fixture-house-practicals");
    assert_eq!(practicals.definition_id, "aputure-infinibar-pb12");
    assert_eq!(practicals.mode_id, "default");
}

#[test]
fn lighting_patch_validation_is_universe_aware() {
    let test_dir = initialize_ready_lighting("catalog-universe-overlap");

    update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-right"),
            name: None,
            fixture_type: None,
            definition_id: None,
            mode_id: None,
            universe: Some(2),
            dmx_start_address: Some(1),
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("same address should be allowed on a different universe");

    let error = update_lighting_fixture(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-right"),
            name: None,
            fixture_type: None,
            definition_id: None,
            mode_id: None,
            universe: Some(1),
            dmx_start_address: Some(1),
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect_err("same universe overlap should reject");
    match error {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_DMX_OVERLAP"),
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn lighting_catalog_control_values_drive_dmx_and_scene_capture() {
    let test_dir = initialize_ready_lighting("catalog-control-values");
    let mut controls = HashMap::new();
    controls.insert(String::from("red"), 255);
    controls.insert(String::from("green"), 12);
    update_lighting_fixture(
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
            on: Some(true),
            intensity: Some(100),
            cct: None,
            control_values: Some(controls),
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture control values should update");

    let monitor = read_lighting_dmx_monitor_snapshot(&load_test_app_settings(&test_dir));
    let red_channel = monitor
        .channels
        .iter()
        .find(|channel| channel.universe == 1 && channel.channel == 12)
        .expect("red channel should be present");
    assert_eq!(red_channel.label, "Red");
    assert_eq!(red_channel.value, 255);

    let scene = create_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneCreateRequest {
            name: String::from("RGB Practical"),
            fixture_states: None,
            color_index: None,
        },
    )
    .expect("scene should capture current state");
    let practical_state = scene
        .scene
        .fixture_states
        .iter()
        .find(|fixture| fixture.fixture_id == "fixture-house-practicals")
        .expect("captured scene should include practicals");
    assert_eq!(practical_state.control_values.get("red"), Some(&255));
    assert_eq!(practical_state.control_values.get("green"), Some(&12));
}

fn palette_snapshot<'a>(
    snapshot: &'a LightingSnapshot,
    palette_id: &str,
) -> &'a LightingPaletteSnapshot {
    snapshot
        .palettes
        .iter()
        .find(|palette| palette.id == palette_id)
        .expect("palette should be present")
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
        .any(|channel| channel.light_name == "Backline Wash"
            && channel.label == "+/- G/M"
            && channel.universe == 1));
    assert!(monitor
        .channels
        .iter()
        .any(|channel| channel.light_name == "House Practicals" && channel.label == "FX"));
}

#[test]
fn lighting_palette_defaults_are_exposed_in_snapshot_and_list() {
    let test_dir = initialize_ready_lighting("palette-defaults");
    let snapshot = read_lighting_snapshot(&load_test_app_settings(&test_dir));

    assert_eq!(snapshot.palettes.len(), 8);
    assert_eq!(snapshot.palettes[0].id, "palette-intensity-low");
    assert_eq!(snapshot.palettes[0].kind, LightingPaletteKind::Intensity);
    assert_eq!(snapshot.palettes[4].id, "palette-cct-warm");
    assert_eq!(snapshot.palettes[4].kind, LightingPaletteKind::Cct);
    assert_eq!(
        palette_snapshot(&snapshot, "palette-intensity-half").value,
        50.0
    );

    let list = list_lighting_palettes(test_dir.db_path().as_path())
        .expect("palette list should load from editor state");
    assert_eq!(list.palettes.len(), 8);
    assert_eq!(list.palettes[2].name, "Half");
    assert_eq!(list.palettes[6].value, 5600.0);
}

#[test]
fn lighting_palette_crud_round_trips_and_reorders_within_kind() {
    let test_dir = initialize_ready_lighting("palette-crud");

    let created = create_lighting_palette(
        test_dir.db_path().as_path(),
        &LightingPaletteCreateRequest {
            name: String::from("Interview"),
            kind: LightingPaletteKind::Intensity,
            value: 35.0,
            color_index: Some(6),
        },
    )
    .expect("palette should create");
    assert_eq!(created.palette.name, "Interview");
    assert_eq!(created.palette.kind, LightingPaletteKind::Intensity);

    let updated = update_lighting_palette(
        test_dir.db_path().as_path(),
        &LightingPaletteUpdateRequest {
            palette_id: created.palette.id.clone(),
            name: Some(String::from("Interview Half")),
            value: Some(40.0),
            color_index: Some(None),
            before_palette_id: Some(Some(String::from("palette-intensity-low"))),
        },
    )
    .expect("palette should update");
    assert_eq!(updated.palette.name, "Interview Half");
    assert_eq!(updated.palette.value, 40.0);
    assert_eq!(updated.palette.color_index, None);

    let snapshot = read_lighting_snapshot(&load_test_app_settings(&test_dir));
    assert_eq!(snapshot.palettes[0].id, created.palette.id);
    assert_eq!(snapshot.palettes[1].id, "palette-intensity-low");

    delete_lighting_palette(
        test_dir.db_path().as_path(),
        &LightingPaletteDeleteRequest {
            palette_id: created.palette.id.clone(),
        },
    )
    .expect("palette should delete");
    let snapshot = read_lighting_snapshot(&load_test_app_settings(&test_dir));
    assert!(!snapshot
        .palettes
        .iter()
        .any(|palette| palette.id == created.palette.id));
}

#[test]
fn lighting_scene_recall_rejects_until_probe_passes() {
    let test_dir = TestDir::new("scene-rejects");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    assert_eq!(result.fade_ms, 1500);

    let settings = list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
        .expect("settings should load");
    let snapshot = read_lighting_snapshot(&settings);
    assert_eq!(
        snapshot.last_recalled_scene_id.as_deref(),
        Some("scene-stream")
    );
    let recalled_scene = snapshot
        .scenes
        .iter()
        .find(|entry| entry.id == "scene-stream")
        .expect("stream scene should be present");
    assert!(recalled_scene.last_recalled);
    assert_eq!(recalled_scene.fade_duration_ms, Some(1500));
    assert!(recalled_scene
        .fade_progress
        .is_some_and(|progress| (0.0..=1.0).contains(&progress)));
    assert_eq!(snapshot.last_action_status, "succeeded");
    let key_left = snapshot
        .fixtures
        .iter()
        .find(|entry| entry.id == "fixture-key-left")
        .expect("key-left fixture should be present");
    assert!(key_left.on);
    assert!(key_left.intensity <= 90);
}

#[test]
fn lighting_preview_enable_seeds_from_live_state() {
    let test_dir = initialize_ready_lighting("preview-enable");
    let mut preview = LightingPreviewRuntimeState::default();

    let result = set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");

    assert!(result.enabled);
    assert!(!result.dirty);
    assert!(preview.enabled);
    let settings = load_test_app_settings(&test_dir);
    let snapshot = read_lighting_snapshot_with_preview(&settings, &preview);
    assert!(snapshot.preview_mode);
    assert!(!snapshot.preview_dirty);
    assert_eq!(snapshot.preview_fixtures.len(), snapshot.fixtures.len());
    assert_eq!(
        preview_fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        fixture_snapshot(&snapshot, "fixture-key-left").intensity
    );

    let restarted_snapshot =
        read_lighting_snapshot_with_preview(&settings, &LightingPreviewRuntimeState::default());
    assert!(!restarted_snapshot.preview_mode);
    assert!(restarted_snapshot.preview_fixtures.is_empty());
}

#[test]
fn lighting_preview_fixture_update_changes_preview_only() {
    let test_dir = initialize_ready_lighting("preview-fixture-update");
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");

    let result = update_lighting_fixture_with_preview(
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
            intensity: Some(42),
            cct: Some(4100),
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
        &mut preview,
    )
    .expect("preview fixture update should succeed");

    assert_eq!(result.source, "preview");
    assert_eq!(result.fixture.intensity, 42);
    assert!(preview.dirty);
    let snapshot =
        read_lighting_snapshot_with_preview(&load_test_app_settings(&test_dir), &preview);
    assert_eq!(
        preview_fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        42
    );
    assert_ne!(
        fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        42
    );
}

#[test]
fn lighting_preview_power_commands_change_preview_only() {
    let test_dir = initialize_ready_lighting("preview-power");
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");

    let group = set_lighting_group_power_with_preview(
        test_dir.db_path().as_path(),
        &LightingGroupPowerRequest {
            group_id: String::from("group-stage"),
            on: true,
        },
        &mut preview,
    )
    .expect("preview group power should succeed");
    assert_eq!(group.affected_fixtures, 3);
    let snapshot =
        read_lighting_snapshot_with_preview(&load_test_app_settings(&test_dir), &preview);
    assert!(preview_fixture_snapshot(&snapshot, "fixture-key-left").on);
    assert!(!fixture_snapshot(&snapshot, "fixture-key-left").on);

    set_lighting_all_power_with_preview(
        test_dir.db_path().as_path(),
        &LightingAllPowerRequest { on: false },
        &mut preview,
    )
    .expect("preview all power should succeed");
    let snapshot =
        read_lighting_snapshot_with_preview(&load_test_app_settings(&test_dir), &preview);
    assert!(snapshot.preview_fixtures.iter().all(|fixture| !fixture.on));
    assert!(snapshot.fixtures.iter().all(|fixture| !fixture.on));
}

#[test]
fn lighting_preview_scene_recall_leaves_live_recall_state_unchanged() {
    let test_dir = initialize_ready_lighting("preview-scene-recall");
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");

    let result = recall_lighting_scene_with_preview(
        test_dir.db_path().as_path(),
        &LightingSceneRecallRequest {
            scene_id: String::from("scene-stream"),
            fade_duration_seconds: 1.5,
        },
        &mut preview,
    )
    .expect("preview scene recall should succeed");

    assert!(result.preview_mode);
    assert_eq!(result.fade_ms, 0);
    assert!(!preview.dirty);
    assert_eq!(preview.target_scene_id.as_deref(), Some("scene-stream"));
    let snapshot =
        read_lighting_snapshot_with_preview(&load_test_app_settings(&test_dir), &preview);
    assert_eq!(snapshot.last_recalled_scene_id, None);
    assert!(!scene_snapshot(&snapshot, "scene-stream").last_recalled);
    assert_eq!(
        preview_fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        90
    );
    assert_ne!(
        fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        90
    );
}

#[test]
fn lighting_preview_save_commits_preview_scene_without_live_output() {
    let test_dir = initialize_ready_lighting("preview-save");
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");
    recall_lighting_scene_with_preview(
        test_dir.db_path().as_path(),
        &LightingSceneRecallRequest {
            scene_id: String::from("scene-stream"),
            fade_duration_seconds: 0.0,
        },
        &mut preview,
    )
    .expect("preview scene recall should succeed");
    update_lighting_fixture_with_preview(
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
            intensity: Some(44),
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
        &mut preview,
    )
    .expect("preview fixture update should succeed");

    update_lighting_scene_with_preview(
        test_dir.db_path().as_path(),
        &LightingSceneUpdateRequest {
            scene_id: String::from("scene-stream"),
            name: None,
            capture_current_state: true,
            color_index: None,
        },
        &mut preview,
    )
    .expect("preview scene save should succeed");

    assert!(!preview.enabled);
    let settings = load_test_app_settings(&test_dir);
    let state = load_lighting_editor_state(&settings);
    let scene = state
        .scenes
        .iter()
        .find(|scene| scene.id == "scene-stream")
        .expect("stream scene should exist");
    assert_eq!(
        scene
            .fixture_states
            .iter()
            .find(|fixture| fixture.fixture_id == "fixture-key-left")
            .map(|fixture| fixture.intensity),
        Some(44)
    );
    assert_ne!(
        state
            .fixtures
            .iter()
            .find(|fixture| fixture.id == "fixture-key-left")
            .map(|fixture| fixture.intensity),
        Some(44)
    );
}

#[test]
fn lighting_preview_save_as_creates_scene_and_selects_it() {
    let test_dir = initialize_ready_lighting("preview-save-as");
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");
    update_lighting_fixture_with_preview(
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
            intensity: Some(33),
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
        &mut preview,
    )
    .expect("preview fixture update should succeed");

    let created = create_lighting_scene_with_preview(
        test_dir.db_path().as_path(),
        &LightingSceneCreateRequest {
            name: String::from("Preview Look"),
            fixture_states: None,
            color_index: None,
        },
        &mut preview,
    )
    .expect("preview save as should succeed");

    assert!(!preview.enabled);
    assert_eq!(created.scene.name, "Preview Look");
    let settings = load_test_app_settings(&test_dir);
    let snapshot = read_lighting_snapshot(&settings);
    assert_eq!(
        snapshot.selected_scene_id.as_deref(),
        Some(created.scene.id.as_str())
    );
    let scene = scene_snapshot(&snapshot, created.scene.id.as_str());
    assert_eq!(
        scene
            .fixture_states
            .iter()
            .find(|fixture| fixture.fixture_id == "fixture-key-left")
            .map(|fixture| fixture.intensity),
        Some(33)
    );
}

#[test]
fn lighting_preview_discard_and_patch_conflict_are_engine_owned() {
    let test_dir = initialize_ready_lighting("preview-discard");
    let mut preview = LightingPreviewRuntimeState::default();
    let conflict = set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: true,
        },
        &mut preview,
    )
    .expect_err("patch conflict should reject");
    match conflict {
        LightingCommandError::Rejected(code, _) => {
            assert_eq!(code, "LIGHTING_PREVIEW_PATCH_MODE_CONFLICT")
        }
        other => panic!("unexpected error: {other:?}"),
    }

    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");
    update_lighting_fixture_with_preview(
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
            intensity: Some(22),
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
        &mut preview,
    )
    .expect("preview fixture update should succeed");
    assert!(preview.dirty);

    discard_lighting_preview(
        test_dir.db_path().as_path(),
        &LightingPreviewDiscardRequest,
        &mut preview,
    )
    .expect("discard should succeed");

    assert!(!preview.enabled);
    let snapshot =
        read_lighting_snapshot_with_preview(&load_test_app_settings(&test_dir), &preview);
    assert!(!snapshot.preview_mode);
    assert_ne!(
        fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        22
    );
}

#[test]
fn lighting_preview_rejects_structural_fixture_updates() {
    let test_dir = initialize_ready_lighting("preview-structural-reject");
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");

    let error = update_lighting_fixture_with_preview(
        test_dir.db_path().as_path(),
        &LightingFixtureUpdateRequest {
            fixture_id: String::from("fixture-key-left"),
            name: None,
            fixture_type: None,
            definition_id: None,
            mode_id: None,
            universe: None,
            dmx_start_address: Some(21),
            effect: None,
            on: None,
            intensity: None,
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
        &mut preview,
    )
    .expect_err("structural preview update should reject");

    match error {
        LightingCommandError::Rejected(code, _) => {
            assert_eq!(code, "LIGHTING_PREVIEW_UNSUPPORTED_UPDATE")
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn lighting_palette_apply_intensity_updates_selected_live_fixtures() {
    let test_dir = initialize_ready_lighting("palette-apply-intensity");

    let result = apply_lighting_palette_with_preview(
        test_dir.db_path().as_path(),
        &LightingPaletteApplyRequest {
            palette_id: String::from("palette-intensity-low"),
            fixture_ids: vec![
                String::from("fixture-key-left"),
                String::from("fixture-key-right"),
            ],
            patch_mode_active: false,
        },
        &mut LightingPreviewRuntimeState::default(),
    )
    .expect("palette should apply live");

    assert_eq!(result.affected_fixtures, 2);
    assert!(!result.preview_mode);
    let snapshot = read_lighting_snapshot(&load_test_app_settings(&test_dir));
    assert_eq!(
        fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        10
    );
    assert!(fixture_snapshot(&snapshot, "fixture-key-left").on);
    assert_eq!(
        fixture_snapshot(&snapshot, "fixture-key-right").intensity,
        10
    );
    assert!(fixture_snapshot(&snapshot, "fixture-key-right").on);
    assert_ne!(
        fixture_snapshot(&snapshot, "fixture-house-practicals").intensity,
        10
    );
}

#[test]
fn lighting_palette_apply_cct_clamps_per_fixture_and_preserves_power() {
    let test_dir = initialize_ready_lighting("palette-apply-cct");

    apply_lighting_palette_with_preview(
        test_dir.db_path().as_path(),
        &LightingPaletteApplyRequest {
            palette_id: String::from("palette-cct-cool"),
            fixture_ids: vec![String::from("fixture-key-left")],
            patch_mode_active: false,
        },
        &mut LightingPreviewRuntimeState::default(),
    )
    .expect("cct palette should apply");

    let snapshot = read_lighting_snapshot(&load_test_app_settings(&test_dir));
    let key_left = fixture_snapshot(&snapshot, "fixture-key-left");
    assert_eq!(key_left.cct, 5600);
    assert!(!key_left.on);
    assert_eq!(key_left.intensity, 100);
}

#[test]
fn lighting_palette_apply_zero_intensity_turns_fixture_off() {
    let test_dir = initialize_ready_lighting("palette-apply-zero");
    let zero = create_lighting_palette(
        test_dir.db_path().as_path(),
        &LightingPaletteCreateRequest {
            name: String::from("Blackout"),
            kind: LightingPaletteKind::Intensity,
            value: 0.0,
            color_index: None,
        },
    )
    .expect("zero palette should create");

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
            intensity: Some(44),
            cct: None,
            control_values: None,
            group_id: None,
            spatial_x: None,
            spatial_y: None,
            spatial_rotation: None,
            rig_z: None,
            beam_angle_degrees: None,
        },
    )
    .expect("fixture should turn on");

    apply_lighting_palette_with_preview(
        test_dir.db_path().as_path(),
        &LightingPaletteApplyRequest {
            palette_id: zero.palette.id,
            fixture_ids: vec![String::from("fixture-key-left")],
            patch_mode_active: false,
        },
        &mut LightingPreviewRuntimeState::default(),
    )
    .expect("zero palette should apply");

    let snapshot = read_lighting_snapshot(&load_test_app_settings(&test_dir));
    let key_left = fixture_snapshot(&snapshot, "fixture-key-left");
    assert_eq!(key_left.intensity, 0);
    assert!(!key_left.on);
}

#[test]
fn lighting_palette_apply_preview_changes_preview_only() {
    let test_dir = initialize_ready_lighting("palette-preview");
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        test_dir.db_path().as_path(),
        &LightingPreviewModeRequest {
            enabled: true,
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("preview mode should enable");

    let result = apply_lighting_palette_with_preview(
        test_dir.db_path().as_path(),
        &LightingPaletteApplyRequest {
            palette_id: String::from("palette-intensity-low"),
            fixture_ids: vec![String::from("fixture-key-left")],
            patch_mode_active: false,
        },
        &mut preview,
    )
    .expect("palette should apply to preview");

    assert!(result.preview_mode);
    assert!(preview.dirty);
    let snapshot =
        read_lighting_snapshot_with_preview(&load_test_app_settings(&test_dir), &preview);
    assert_eq!(
        preview_fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        10
    );
    assert!(preview_fixture_snapshot(&snapshot, "fixture-key-left").on);
    assert_ne!(
        fixture_snapshot(&snapshot, "fixture-key-left").intensity,
        10
    );
}

#[test]
fn lighting_palette_apply_rejects_patch_mode_and_unknown_fixture() {
    let test_dir = initialize_ready_lighting("palette-apply-rejects");

    let patch_error = apply_lighting_palette_with_preview(
        test_dir.db_path().as_path(),
        &LightingPaletteApplyRequest {
            palette_id: String::from("palette-intensity-low"),
            fixture_ids: vec![String::from("fixture-key-left")],
            patch_mode_active: true,
        },
        &mut LightingPreviewRuntimeState::default(),
    )
    .expect_err("patch mode should reject");
    match patch_error {
        LightingCommandError::Rejected(code, _) => {
            assert_eq!(code, "LIGHTING_PALETTE_PATCH_MODE_CONFLICT")
        }
        other => panic!("unexpected error: {other:?}"),
    }

    let missing_error = apply_lighting_palette_with_preview(
        test_dir.db_path().as_path(),
        &LightingPaletteApplyRequest {
            palette_id: String::from("palette-intensity-low"),
            fixture_ids: vec![String::from("fixture-missing")],
            patch_mode_active: false,
        },
        &mut LightingPreviewRuntimeState::default(),
    )
    .expect_err("unknown fixture should reject");
    match missing_error {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_FIXTURE_NOT_FOUND"),
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn lighting_palette_parsers_validate_shapes() {
    let create = parse_lighting_palette_create_request(&serde_json::json!({
        "name": "Interview",
        "kind": "cct",
        "value": 4300,
        "colorIndex": 1
    }))
    .expect("create payload should parse");
    assert_eq!(create.kind, LightingPaletteKind::Cct);
    assert_eq!(create.color_index, Some(1));

    let update = parse_lighting_palette_update_request(&serde_json::json!({
        "paletteId": "palette-cct-studio",
        "colorIndex": serde_json::Value::Null,
        "beforePaletteId": serde_json::Value::Null
    }))
    .expect("update payload should parse");
    assert_eq!(update.color_index, Some(None));
    assert_eq!(update.before_palette_id, Some(None));

    let apply = parse_lighting_palette_apply_request(&serde_json::json!({
        "paletteId": "palette-intensity-low",
        "fixtureIds": ["fixture-key-left", "fixture-key-left"],
        "patchModeActive": true
    }))
    .expect("apply payload should parse");
    assert_eq!(apply.fixture_ids, vec![String::from("fixture-key-left")]);
    assert!(apply.patch_mode_active);

    parse_lighting_palette_create_request(&serde_json::json!({
        "name": "Bad",
        "kind": "cct",
        "value": 1200
    }))
    .expect_err("invalid cct value should reject");
}
