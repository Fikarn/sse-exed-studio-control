// Scene and group order, pins and colour tags, and their request parsers.

use super::*;

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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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

// -- Wave 30a — group reorder + scene/group color round-trips ----------

#[test]
fn lighting_group_reorder_parser_accepts_valid_payloads() {
    let with_anchor = parse_lighting_group_reorder_request(&serde_json::json!({
        "groupId": "group-room",
        "beforeGroupId": "group-stage",
    }))
    .expect("group reorder parser should accept anchor");
    assert_eq!(with_anchor.group_id, "group-room");
    assert_eq!(with_anchor.before_group_id.as_deref(), Some("group-stage"));

    let null_anchor = parse_lighting_group_reorder_request(&serde_json::json!({
        "groupId": "group-room",
        "beforeGroupId": serde_json::Value::Null,
    }))
    .expect("group reorder parser should accept null anchor");
    assert!(null_anchor.before_group_id.is_none());

    let omitted_anchor = parse_lighting_group_reorder_request(&serde_json::json!({
        "groupId": "group-room",
    }))
    .expect("group reorder parser should accept omitted anchor");
    assert!(omitted_anchor.before_group_id.is_none());

    let blank_anchor = parse_lighting_group_reorder_request(&serde_json::json!({
        "groupId": "group-room",
        "beforeGroupId": "   ",
    }))
    .expect("group reorder parser should treat whitespace anchor as None");
    assert!(blank_anchor.before_group_id.is_none());

    let trimmed = parse_lighting_group_reorder_request(&serde_json::json!({
        "groupId": "  group-room  ",
        "beforeGroupId": "  group-stage  ",
    }))
    .expect("group reorder parser should trim whitespace");
    assert_eq!(trimmed.group_id, "group-room");
    assert_eq!(trimmed.before_group_id.as_deref(), Some("group-stage"));
}

#[test]
fn lighting_group_reorder_parser_rejects_invalid_payloads() {
    parse_lighting_group_reorder_request(&serde_json::json!({}))
        .expect_err("missing groupId must reject");
    parse_lighting_group_reorder_request(&serde_json::json!({ "groupId": "  " }))
        .expect_err("blank groupId must reject");
    parse_lighting_group_reorder_request(&serde_json::json!({ "groupId": 42 }))
        .expect_err("non-string groupId must reject");
    parse_lighting_group_reorder_request(&serde_json::json!({
        "groupId": "group-room",
        "beforeGroupId": "group-room",
    }))
    .expect_err("self-anchor must reject");
    parse_lighting_group_reorder_request(&serde_json::json!({
        "groupId": "group-room",
        "beforeGroupId": 7,
    }))
    .expect_err("non-string non-null beforeGroupId must reject");
}

#[test]
fn lighting_group_reorder_move_before_anchor() {
    let test_dir = TestDir::new("group-reorder-before");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
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
    let baseline_ids: Vec<&str> = baseline.groups.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(
        baseline_ids,
        ["group-stage", "group-room"],
        "default group order must follow inventory insertion"
    );

    // Move group-room before group-stage:
    // [stage, room] -> [room, stage]
    reorder_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupReorderRequest {
            group_id: String::from("group-room"),
            before_group_id: Some(String::from("group-stage")),
        },
    )
    .expect("reorder before-anchor should succeed");

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let ordered_ids: Vec<&str> = snapshot.groups.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(
        ordered_ids,
        ["group-room", "group-stage"],
        "snapshot order must reflect reordered group_order"
    );
}

#[test]
fn lighting_group_reorder_move_to_end() {
    let test_dir = TestDir::new("group-reorder-end");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    // Move group-stage to the end (no anchor): [stage, room] -> [room, stage]
    reorder_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupReorderRequest {
            group_id: String::from("group-stage"),
            before_group_id: None,
        },
    )
    .expect("reorder to end should succeed");

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let ordered_ids: Vec<&str> = snapshot.groups.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(
        ordered_ids,
        ["group-room", "group-stage"],
        "snapshot order must place reordered group at the end"
    );
}

#[test]
fn lighting_group_reorder_rejects_unknown_ids() {
    let test_dir = TestDir::new("group-reorder-unknown");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    let unknown_group = reorder_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupReorderRequest {
            group_id: String::from("group-imaginary"),
            before_group_id: None,
        },
    )
    .expect_err("reorder with unknown group must fail");
    match unknown_group {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_GROUP_NOT_FOUND"),
        other => panic!("expected LIGHTING_GROUP_NOT_FOUND, got {:?}", other),
    }

    let unknown_anchor = reorder_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupReorderRequest {
            group_id: String::from("group-stage"),
            before_group_id: Some(String::from("group-imaginary")),
        },
    )
    .expect_err("reorder with unknown anchor must fail");
    match unknown_anchor {
        LightingCommandError::Rejected(code, _) => assert_eq!(code, "LIGHTING_GROUP_NOT_FOUND"),
        other => panic!("expected LIGHTING_GROUP_NOT_FOUND, got {:?}", other),
    }
}

#[test]
fn lighting_normalize_populates_group_order_for_legacy_state() {
    let test_dir = TestDir::new("normalize-legacy-group-order");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    // Persist a state with an empty group_order, simulating an editor blob
    // serialized before Wave 30a introduced the field. Also seed an
    // orphan id to verify the filter pass drops ids that don't match a
    // live group. normalize_lighting_editor_state must rebuild
    // group_order from the live groups vec on load.
    let mut state = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    state.group_order.clear();
    state.group_order.push(String::from("group-deleted-ghost"));
    save_lighting_editor_state(test_dir.db_path().as_path(), &state)
        .expect("legacy-shaped state should persist");

    let normalized = load_lighting_editor_state(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let group_order_ids: Vec<&str> = normalized
        .group_order
        .iter()
        .map(|id| id.as_str())
        .collect();
    let live_group_ids: Vec<&str> = normalized.groups.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(
        group_order_ids, live_group_ids,
        "legacy state must rebuild group_order from live groups insertion order"
    );
    assert!(
        !normalized
            .group_order
            .iter()
            .any(|id| id == "group-deleted-ghost"),
        "orphan group_order ids must be filtered on load"
    );

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let snapshot_ids: Vec<&str> = snapshot.groups.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(
        snapshot_ids,
        ["group-stage", "group-room"],
        "snapshot order must follow rebuilt group_order"
    );
}

#[test]
fn lighting_scene_color_round_trip() {
    let test_dir = TestDir::new("scene-color-round-trip");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    // Set color on an existing seed scene.
    let updated = update_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneUpdateRequest {
            scene_id: String::from("scene-prep"),
            name: None,
            capture_current_state: false,
            color_index: Some(Some(3)),
        },
    )
    .expect("scene color set should succeed");
    assert_eq!(updated.scene.color_index, Some(3));

    // Snapshot reflects the persisted color.
    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let prep = snapshot
        .scenes
        .iter()
        .find(|s| s.id == "scene-prep")
        .expect("scene-prep must be present");
    assert_eq!(prep.color_index, Some(3));

    // Clear color via colorIndex: null payload (Some(None) on the request).
    let cleared = update_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneUpdateRequest {
            scene_id: String::from("scene-prep"),
            name: None,
            capture_current_state: false,
            color_index: Some(None),
        },
    )
    .expect("scene color clear should succeed");
    assert_eq!(cleared.scene.color_index, None);

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let prep = snapshot
        .scenes
        .iter()
        .find(|s| s.id == "scene-prep")
        .expect("scene-prep must be present");
    assert_eq!(prep.color_index, None);
}

#[test]
fn lighting_group_color_round_trip() {
    let test_dir = TestDir::new("group-color-round-trip");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(
            String::from(LIGHTING_BRIDGE_IP_KEY),
            String::from("2.0.0.10"),
        )],
    )
    .expect("lighting state should persist");

    // Set color on an existing seed group via the relaxed update IPC
    // (color-only, no name).
    let updated = update_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupUpdateRequest {
            group_id: String::from("group-stage"),
            name: None,
            color_index: Some(Some(5)),
        },
    )
    .expect("group color set should succeed");
    assert_eq!(updated.group.color_index, Some(5));

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let stage = snapshot
        .groups
        .iter()
        .find(|g| g.id == "group-stage")
        .expect("group-stage must be present");
    assert_eq!(stage.color_index, Some(5));

    // Clear color while also renaming in the same request.
    let cleared = update_lighting_group(
        test_dir.db_path().as_path(),
        &LightingGroupUpdateRequest {
            group_id: String::from("group-stage"),
            name: Some(String::from("Stage Wash")),
            color_index: Some(None),
        },
    )
    .expect("group color clear + rename should succeed");
    assert_eq!(cleared.group.color_index, None);
    assert_eq!(cleared.group.name, "Stage Wash");

    let snapshot = read_lighting_snapshot(
        &list_settings_by_prefix(test_dir.db_path().as_path(), APP_SETTINGS_PREFIX)
            .expect("settings should load"),
    );
    let stage = snapshot
        .groups
        .iter()
        .find(|g| g.id == "group-stage")
        .expect("group-stage must be present");
    assert_eq!(stage.color_index, None);
    assert_eq!(stage.name, "Stage Wash");
}

#[test]
fn lighting_group_update_parser_relaxation() {
    // name-only payload (legacy shape) — accepted.
    let name_only = parse_lighting_group_update_request(&serde_json::json!({
        "groupId": "group-stage",
        "name": "Stage Wash",
    }))
    .expect("name-only payload should succeed");
    assert_eq!(name_only.name.as_deref(), Some("Stage Wash"));
    assert!(name_only.color_index.is_none());

    // color-only payload (relaxed shape) — accepted.
    let color_only = parse_lighting_group_update_request(&serde_json::json!({
        "groupId": "group-stage",
        "colorIndex": 4,
    }))
    .expect("color-only payload should succeed");
    assert!(color_only.name.is_none());
    assert_eq!(color_only.color_index, Some(Some(4)));

    // both fields supplied — accepted.
    let both = parse_lighting_group_update_request(&serde_json::json!({
        "groupId": "group-stage",
        "name": "Stage Wash",
        "colorIndex": serde_json::Value::Null,
    }))
    .expect("both-field payload should succeed");
    assert_eq!(both.name.as_deref(), Some("Stage Wash"));
    assert_eq!(both.color_index, Some(None));

    // neither — rejected.
    parse_lighting_group_update_request(&serde_json::json!({
        "groupId": "group-stage",
    }))
    .expect_err("empty payload (only groupId) must reject");

    // out-of-range color — rejected.
    parse_lighting_group_update_request(&serde_json::json!({
        "groupId": "group-stage",
        "colorIndex": 8,
    }))
    .expect_err("color index 8 must reject (range 0..7)");
    parse_lighting_group_update_request(&serde_json::json!({
        "groupId": "group-stage",
        "colorIndex": -1,
    }))
    .expect_err("negative color index must reject");
}
