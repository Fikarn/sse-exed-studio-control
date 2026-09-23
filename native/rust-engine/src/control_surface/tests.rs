use super::test_support::{ready_audio_test_db, TestDir};
use super::*;
use crate::storage::initialize_test_database;

#[test]
fn truncate_preserves_short_text() {
    assert_eq!(truncate("Host Mic", 12), "Host Mic");
}

#[test]
fn truncate_limits_long_text() {
    assert_eq!(truncate("Very Long Fixture Name", 12), "Very Long Fi");
}

#[test]
fn cycle_value_wraps_forward() {
    assert_eq!(cycle_value(PROJECT_STATUS_CYCLE, "done", true), "todo");
}

#[test]
fn cycle_value_wraps_backward() {
    assert_eq!(cycle_value(PROJECT_STATUS_CYCLE, "todo", false), "done");
}

#[test]
fn audio_strip_lcd_shows_gate_reason_until_verified() {
    let test_dir = TestDir::new("lcd-gated");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");

    let text = read_control_surface_lcd_text(test_dir.db_path().as_path(), "audio_strip_1")
        .expect("lcd text should render");
    assert_eq!(text, "AUDIO\\nNOT VERIFIED");
    let key_text = read_control_surface_lcd_text(test_dir.db_path().as_path(), "audio_key_5")
        .expect("lcd text should render");
    assert_eq!(key_text, "DIM\\n--");
}

#[test]
fn audio_strip_lcd_renders_live_state_with_selection_and_mute() {
    let test_dir = ready_audio_test_db("lcd-live");
    let db_path = test_dir.db_path();

    let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
        .expect("lcd text should render");
    assert!(
        text.contains("HOST"),
        "strip should name the channel: {text}"
    );
    assert!(text.contains("dB"), "strip should show a level: {text}");
    assert!(
        !text.contains("\u{2192}"),
        "the v2 strip drops the target arrow line: {text}"
    );

    handle_audio_action(db_path.as_path(), "stripTap", Some("1"))
        .expect("tap should select the strip");
    let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
        .expect("lcd text should render");
    assert!(
        text.starts_with("\u{2022} HOST"),
        "selected strip should carry the marker: {text}"
    );

    handle_audio_action(db_path.as_path(), "dialPress", Some("1")).expect("mute should engage");
    let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
        .expect("lcd text should render");
    assert!(
        text.contains("MUTED"),
        "muted strip should say MUTED instead of a level: {text}"
    );

    handle_audio_action(db_path.as_path(), "toggleDialMode", None)
        .expect("gain mode should engage");
    let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
        .expect("lcd text should render");
    assert!(
        text.contains("GAIN 34 dB"),
        "gain mode should show the preamp gain: {text}"
    );
}

#[test]
fn audio_key_lcd_reflects_target_bank_and_talk() {
    let test_dir = ready_audio_test_db("lcd-keys");
    let db_path = test_dir.db_path();

    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_key_1")
            .expect("lcd text should render"),
        "MAIN"
    );
    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_key_2")
            .expect("lcd text should render"),
        "PH 1"
    );
    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_state_target")
            .expect("state should render"),
        "main"
    );

    handle_audio_action(db_path.as_path(), "setMixTarget", Some("phones-a"))
        .expect("target switch should succeed");
    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_state_target")
            .expect("state should render"),
        "phones-a"
    );

    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_key_4")
            .expect("lcd text should render"),
        "BANK\\nINPUTS"
    );
    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_key_7")
            .expect("lcd text should render"),
        "TALK\\nHOLD"
    );
    handle_audio_action(db_path.as_path(), "talkOn", None).expect("talk should engage");
    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_key_7")
            .expect("lcd text should render"),
        "TALK\\nLIVE"
    );
    handle_audio_action(db_path.as_path(), "talkOff", None).expect("talk should release");

    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_key_8")
            .expect("lcd text should render"),
        "SOLO\\nCLEAR"
    );
}

#[test]
fn workspace_lcd_key_reads_shell_workspace() {
    let test_dir = TestDir::new("workspace-key");
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");

    assert_eq!(
        read_control_surface_lcd_text(test_dir.db_path().as_path(), "workspace")
            .expect("workspace key should render"),
        DEFAULT_WORKSPACE
    );

    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(String::from(WORKSPACE_KEY), String::from("audio"))],
    )
    .expect("workspace should persist");
    assert_eq!(
        read_control_surface_lcd_text(test_dir.db_path().as_path(), "workspace")
            .expect("workspace key should render"),
        "audio"
    );
}

#[test]
fn context_includes_workspace_and_audio_deck_block() {
    let test_dir = ready_audio_test_db("context-audio");
    let db_path = test_dir.db_path();

    let context = read_control_surface_context(db_path.as_path()).expect("context should load");
    assert_eq!(context["workspace"], DEFAULT_WORKSPACE);
    assert_eq!(context["audio"]["bank"], "inputs");
    assert_eq!(context["audio"]["gated"], false);
    let strips = context["audio"]["strips"]
        .as_array()
        .expect("strips should be an array");
    assert_eq!(strips.len(), 4);
    assert_eq!(strips[0]["id"], "audio-input-9");

    handle_audio_action(db_path.as_path(), "cycleBank", None).expect("cycle should succeed");
    handle_audio_action(db_path.as_path(), "cycleBank", None).expect("cycle should succeed");
    let context = read_control_surface_context(db_path.as_path()).expect("context should load");
    assert_eq!(context["audio"]["bank"], "outputs");
    assert_eq!(context["audio"]["strips"][3]["kind"], "empty");
}

#[test]
fn legacy_audio_lcd_keys_are_gone() {
    let test_dir = ready_audio_test_db("lcd-legacy");
    assert!(matches!(
        read_control_surface_lcd_text(test_dir.db_path().as_path(), "audio_ch_nav"),
        Err(ControlSurfaceError::InvalidParams(_))
    ));
}

#[test]
fn successful_actions_stamp_the_last_event_for_verify_echo() {
    let test_dir = ready_audio_test_db("last-event");
    let db_path = test_dir.db_path();

    assert!(control_surface_last_event(db_path.as_path()).is_null());

    handle_control_surface_http_action(
        db_path.as_path(),
        "/api/deck/audio-action",
        &json!({"action": "dialPress", "value": "2"}),
    )
    .expect("dial press should succeed");

    let event = control_surface_last_event(db_path.as_path());
    assert_eq!(event["route"], "/api/deck/audio-action");
    assert_eq!(event["action"], "dialPress");
    assert_eq!(event["value"], "2");
    assert!(event["at"].as_u64().unwrap_or(0) > 0);

    let failed = handle_control_surface_http_action(
        db_path.as_path(),
        "/api/deck/audio-action",
        &json!({"action": "nonsense"}),
    );
    assert!(failed.is_err());
    assert_eq!(
        control_surface_last_event(db_path.as_path())["action"],
        "dialPress",
        "failed actions must not stamp the echo event"
    );
}

// ---------------------------------------------------------------------
// 2026-09 production readiness, Slice 10 (F12): the deck's lighting keys.
// Every test here reads or writes through the process-wide preview, so
// each holds the shared-preview test guard for its whole length.
// ---------------------------------------------------------------------

const KEY_LEFT: &str = "fixture-key-left";

fn ready_lighting_deck_db(label: &str) -> TestDir {
    let test_dir = TestDir::new(label);
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(crate::commissioning::LIGHTING_BRIDGE_IP_KEY),
                String::from("127.0.0.1"),
            ),
            (
                format!(
                    "app.commissioning.check.{}.status",
                    crate::commissioning::LIGHTING_CHECK_ID
                ),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting settings should persist");
    test_dir
}

fn light_action(db_path: &Path, action: &str) -> Value {
    handle_control_surface_http_action(
        db_path,
        "/api/deck/light-action",
        &json!({ "action": action }),
    )
    .unwrap_or_else(|error| panic!("{action} should succeed: {}", error.message()))
}

fn deck_app_settings(db_path: &Path) -> HashMap<String, String> {
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX).expect("settings should load")
}

fn live_fixture(db_path: &Path, fixture_id: &str) -> crate::lighting::LightingFixtureSnapshot {
    crate::lighting::read_lighting_snapshot(&deck_app_settings(db_path))
        .fixtures
        .into_iter()
        .find(|fixture| fixture.id == fixture_id)
        .expect("fixture should be present")
}

/// What the wire would carry right now: every universe's 512 slots.
fn wire_slots(db_path: &Path) -> Vec<(u16, Vec<u8>)> {
    crate::lighting::read_lighting_sacn_output_state(&deck_app_settings(db_path))
        .expect("a commissioned rig renders frames")
        .frames
        .into_iter()
        .map(|frame| (frame.universe, frame.slots.to_vec()))
        .collect()
}

fn set_live_fixture(db_path: &Path, fixture_id: &str, on: bool, intensity: i64) {
    crate::lighting::update_lighting_fixture(
        db_path,
        &parse_lighting_fixture_update_request(&json!({
            "fixtureId": fixture_id,
            "on": on,
            "intensity": intensity,
        }))
        .expect("the update should parse"),
    )
    .expect("the fixture should update");
}

fn set_shared_preview_mode(db_path: &Path, enabled: bool) {
    with_lighting_state_and_preview(|preview| {
        crate::lighting::set_lighting_preview_mode(
            db_path,
            &crate::lighting::parse_lighting_preview_mode_request(&json!({ "enabled": enabled }))
                .expect("the request should parse"),
            preview,
        )
    })
    .expect("preview mode should change");
}

// F12, the second half: a deck key pressed while the operator previews
// edits the preview buffer the screen shows. The stored state and the
// frames the wire would carry do not move.
#[test]
fn deck_preview_action_updates_preview_runtime() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("light-preview");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    set_live_fixture(db_path, KEY_LEFT, true, 40);
    let wire_before = wire_slots(db_path);
    let cct_before = live_fixture(db_path, KEY_LEFT).cct;

    set_shared_preview_mode(db_path, true);

    let reply = light_action(db_path, "intensityUp");
    assert_eq!(reply["light"]["id"], KEY_LEFT);
    assert_eq!(reply["light"]["intensity"], 45);
    assert_eq!(reply["preview"], true);
    assert_eq!(light_action(db_path, "toggleLight")["light"]["on"], false);
    light_action(db_path, "cctUp");
    {
        let preview = lock_shared_lighting_preview();
        let staged = preview
            .fixture_states
            .get(KEY_LEFT)
            .expect("the key edited the shared preview buffer");
        assert!(preview.enabled && preview.dirty);
        assert_eq!(staged.intensity, 45);
        assert!(!staged.on);
        assert_eq!(staged.cct, cct_before + 200);
    }
    assert_eq!(light_action(db_path, "allOn")["preview"], true);
    assert!(lock_shared_lighting_preview().fixture_states[KEY_LEFT].on);
    let recalled = light_action(db_path, "recallScene");
    assert_eq!(recalled["preview"], true);

    let live = live_fixture(db_path, KEY_LEFT);
    assert!(live.on, "the stored fixture did not move");
    assert_eq!(live.intensity, 40);
    assert_eq!(live.cct, cct_before);
    assert_eq!(
        wire_slots(db_path),
        wire_before,
        "the light output did not move while previewing"
    );
    assert!(
        read_lighting_snapshot_last_recall(db_path).is_none(),
        "a recall into the preview is not a recall on the rig"
    );

    // The LCD shows the staged number and says so.
    light_action(db_path, "resetIntensity");
    assert_eq!(
        read_control_surface_lcd_text(db_path, "light_intensity").expect("lcd text"),
        "INTENSITY\\n100%\\nPREVIEW"
    );
    assert!(read_control_surface_lcd_text(db_path, "light_cct")
        .expect("lcd text")
        .ends_with("K\\nPREVIEW"));

    // Out of preview the same key moves the rig.
    set_shared_preview_mode(db_path, false);
    assert_eq!(
        read_control_surface_lcd_text(db_path, "light_intensity").expect("lcd text"),
        "INTENSITY\\n40%"
    );
    let reply = light_action(db_path, "intensityUp");
    assert_eq!(reply["light"]["intensity"], 45);
    assert_eq!(reply["preview"], false);
    assert_eq!(live_fixture(db_path, KEY_LEFT).intensity, 45);
    assert_ne!(wire_slots(db_path), wire_before);
}

fn read_lighting_snapshot_last_recall(db_path: &Path) -> Option<String> {
    crate::lighting::read_lighting_snapshot(&deck_app_settings(db_path)).last_recalled_scene_id
}

// The relative keys go through the fixture update the screen uses: the
// reply and the LCD carry what was stored, and the fixture's own colour
// temperature range wins over the deck's 2700–6500 K.
#[test]
fn deck_relative_keys_store_through_the_fixture_update() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("light-relative");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    set_live_fixture(db_path, KEY_LEFT, true, 97);

    assert_eq!(
        light_action(db_path, "intensityUp")["light"]["intensity"],
        100
    );
    assert_eq!(
        light_action(db_path, "intensityDown")["light"]["intensity"],
        95
    );
    assert_eq!(live_fixture(db_path, KEY_LEFT).intensity, 95);
    assert_eq!(light_action(db_path, "toggleLight")["light"]["on"], false);
    assert!(!live_fixture(db_path, KEY_LEFT).on);

    let mut last_cct = 0;
    for _ in 0..12 {
        last_cct = light_action(db_path, "cctUp")["light"]["cct"]
            .as_i64()
            .expect("cct is a number");
    }
    assert!(last_cct <= 6500, "{last_cct}");
    assert_eq!(
        live_fixture(db_path, KEY_LEFT).cct,
        last_cct,
        "the reply is the stored value"
    );
    assert_eq!(
        read_control_surface_lcd_text(db_path, "light_cct").expect("lcd text"),
        format!("CCT\\n{last_cct}K")
    );
    assert_eq!(light_action(db_path, "resetCct")["light"]["cct"], 4500);
    assert_eq!(
        light_action(db_path, "allOn"),
        json!({ "on": true, "preview": false })
    );
    assert!(live_fixture(db_path, KEY_LEFT).on);

    let next = light_action(db_path, "selectNextLight");
    assert_eq!(next["selectedLightId"], "fixture-key-right");
}

// The deck used to save its pre-recall copy of the whole state over what
// the recall had just written: a fade the screen had started came back
// and pulled the rig away from the scene the key recalled.
#[test]
fn deck_recall_writes_what_a_recall_writes_and_nothing_after_it() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("light-recall");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();

    crate::lighting::recall_lighting_scene(
        db_path,
        &parse_lighting_scene_recall_request(&json!({
            "sceneId": "scene-teaching",
            "fadeDurationSeconds": 10.0
        }))
        .expect("the recall should parse"),
    )
    .expect("the screen's recall should start its fade");
    assert!(load_lighting_editor_state(&deck_app_settings(db_path))
        .active_fade
        .is_some());
    set_settings_owned(
        db_path,
        &[(
            String::from(SELECTED_SCENE_ID_KEY),
            String::from("scene-stream"),
        )],
    )
    .expect("the deck's scene selection should persist");

    let reply = light_action(db_path, "recallScene");
    assert_eq!(reply["preview"], false);

    let state = load_lighting_editor_state(&deck_app_settings(db_path));
    assert!(
        state.active_fade.is_none(),
        "the instant recall ended the fade and nothing brought it back"
    );
    let scene = state
        .scenes
        .iter()
        .find(|scene| scene.id == "scene-stream")
        .expect("the scene exists");
    for scene_fixture in &scene.fixture_states {
        let fixture = state
            .fixtures
            .iter()
            .find(|fixture| fixture.id == scene_fixture.fixture_id)
            .expect("the fixture exists");
        assert_eq!(fixture.on, scene_fixture.on, "{}", fixture.id);
        assert_eq!(fixture.intensity, scene_fixture.intensity, "{}", fixture.id);
        assert_eq!(fixture.cct, scene_fixture.cct, "{}", fixture.id);
    }
    assert_eq!(
        read_lighting_snapshot_last_recall(db_path).as_deref(),
        Some("scene-stream")
    );
}

// The deck keeps its own scene names ("Scene N"); the id comes from the
// rule the screen's scenes use. The deck's old rule counted the scenes,
// so a save after a delete handed out an id a live scene already had.
#[test]
fn deck_save_scene_never_reuses_a_live_scene_id() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("light-save-scene");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let scenes_before = load_lighting_editor_state(&deck_app_settings(db_path))
        .scenes
        .len();

    let first = light_action(db_path, "saveScene");
    let second = light_action(db_path, "saveScene");
    assert_eq!(
        first["scene"]["name"],
        format!("Scene {}", scenes_before + 1)
    );
    let first_id = first["scene"]["id"].as_str().expect("an id").to_string();
    let second_id = second["scene"]["id"].as_str().expect("an id").to_string();

    set_settings_owned(
        db_path,
        &[(String::from(SELECTED_SCENE_ID_KEY), first_id.clone())],
    )
    .expect("the deck's scene selection should persist");
    let deleted = light_action(db_path, "deleteScene");
    assert_eq!(deleted["sceneId"], first_id.as_str());
    let third = light_action(db_path, "saveScene");
    let third_id = third["scene"]["id"].as_str().expect("an id").to_string();
    assert_ne!(third_id, second_id, "a live scene's id is never handed out");

    let state = load_lighting_editor_state(&deck_app_settings(db_path));
    let mut ids = state
        .scenes
        .iter()
        .map(|scene| scene.id.clone())
        .collect::<Vec<_>>();
    assert_eq!(ids.len(), scenes_before + 2);
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), scenes_before + 2, "every scene id is unique");
    assert!(state.scene_order.contains(&third_id));
    assert!(!state.scene_order.contains(&first_id));
    assert_eq!(
        deck_app_settings(db_path)
            .get(SELECTED_SCENE_ID_KEY)
            .map(String::as_str),
        Some(third_id.as_str()),
        "the deck selects the scene it saved"
    );
}

// The screen follows the deck (Slice 10): a successful lighting key
// raises lighting.changed, a planning key — and the deck mode, a planning
// setting on the lighting route — planning.changed, both with the reason
// `control-surface`. This is the one test that installs the process-wide
// event sender; other tests' events land in the channel too, so it looks
// for its own and ignores the rest.
#[test]
fn deck_light_and_planning_actions_raise_their_events() {
    assert_eq!(
        deck_change_event("/api/deck/light-action", "toggleLight"),
        Some(DeckChange::Lighting)
    );
    assert_eq!(
        deck_change_event("/api/deck/light-action", "selectNextScene"),
        Some(DeckChange::Lighting)
    );
    assert_eq!(
        deck_change_event("/api/deck/light-action", "switchToDeckMode"),
        Some(DeckChange::Planning)
    );
    assert_eq!(
        deck_change_event("/api/deck/action", "nextStatus"),
        Some(DeckChange::Planning)
    );
    assert_eq!(deck_change_event("/api/deck/action", "openDetail"), None);
    assert_eq!(
        deck_change_event("/api/deck/audio-action", "dialPress"),
        None,
        "the audio route announces itself"
    );

    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("light-events");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let (sender, receiver) = std::sync::mpsc::channel::<Value>();
    register_control_surface_event_sender(sender);
    let raised = |event: &str| {
        receiver.try_iter().any(|message| {
            message["event"] == event && message["payload"]["reason"] == "control-surface"
        })
    };

    let failed = handle_control_surface_http_action(
        db_path,
        "/api/deck/light-action",
        &json!({ "action": "nonsense" }),
    );
    assert!(failed.is_err());
    assert!(!raised("lighting.changed"), "a refused key raises nothing");

    light_action(db_path, "toggleLight");
    assert!(raised("lighting.changed"));

    handle_control_surface_http_action(
        db_path,
        "/api/deck/light-action",
        &json!({ "action": "switchToDeckMode", "value": "project" }),
    )
    .expect("the deck mode should switch");
    assert!(raised("planning.changed"));

    handle_control_surface_http_action(
        db_path,
        "/api/deck/action",
        &json!({ "action": "nextSort" }),
    )
    .expect("the sort should cycle");
    assert!(raised("planning.changed"));
}

// ---------------------------------------------------------------------
// 2026-09 production readiness, Slice 11 (F30): every key through the
// bridge is the Stream Deck's, and the action log says so.
// ---------------------------------------------------------------------

fn recent_actions(db_path: &Path) -> Vec<(String, String, String)> {
    crate::action_log::list_recent_actions(db_path, crate::action_log::RECENT_ACTIONS_LIMIT)
        .expect("the action log should list")
        .into_iter()
        .map(|entry| (entry.source, entry.action, entry.detail))
        .collect()
}

// The deck's ALL OFF leaves one row with the source `deck`, in the same
// transaction as the last-event stamp. A dial detent is a ride and leaves
// none; a key staged in the preview never reached the rig and leaves none; a
// refused key leaves none.
#[test]
fn deck_all_off_records_source_deck() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("deck-action-log");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    assert!(recent_actions(db_path).is_empty());

    light_action(db_path, "allOff");
    assert_eq!(
        recent_actions(db_path),
        vec![(
            String::from("deck"),
            String::from("all-off"),
            String::from("All lights off")
        )]
    );
    assert_eq!(control_surface_last_event(db_path)["action"], "allOff");

    // Rides and selections: the stamp moves, the log does not.
    for ride in ["intensityUp", "intensityDown", "cctUp", "selectNextLight"] {
        light_action(db_path, ride);
        assert_eq!(control_surface_last_event(db_path)["action"], ride);
    }
    assert_eq!(recent_actions(db_path).len(), 1);

    // The fixture is named as the screen names it.
    let reply = light_action(db_path, "toggleLight");
    let name = reply["light"]["name"]
        .as_str()
        .expect("the reply names the fixture")
        .to_string();
    let on = reply["light"]["on"]
        .as_bool()
        .expect("the reply says what was stored");
    assert_eq!(
        recent_actions(db_path)[0],
        (
            String::from("deck"),
            String::from(if on { "light-on" } else { "light-off" }),
            format!("{name} {}", if on { "on" } else { "off" })
        )
    );

    // Staged in the preview: the rig did not move, so there is no row.
    set_shared_preview_mode(db_path, true);
    assert_eq!(light_action(db_path, "allOn")["preview"], true);
    assert_eq!(light_action(db_path, "recallScene")["preview"], true);
    assert_eq!(recent_actions(db_path).len(), 2);
    set_shared_preview_mode(db_path, false);

    let recalled = light_action(db_path, "recallScene");
    assert_eq!(recalled["preview"], false);
    assert_eq!(
        recent_actions(db_path)[0],
        (
            String::from("deck"),
            String::from("scene-recalled"),
            format!(
                "Scene recalled: {}",
                recalled["recalled"].as_str().expect("a scene name")
            )
        )
    );

    // A refused key leaves nothing.
    assert!(handle_control_surface_http_action(
        db_path,
        "/api/deck/light-action",
        &json!({ "action": "nonsense" }),
    )
    .is_err());
    assert_eq!(recent_actions(db_path).len(), 3);
}

// The audio half: a mute, the dim key and the first and last of a held TALK
// key are rows; the dial, a strip tap and the repeats Companion sends while
// TALK is held are not.
#[test]
fn deck_audio_keys_record_source_deck() {
    let test_dir = ready_audio_test_db("deck-audio-action-log");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let audio_action = |action: &str, value: Option<&str>| {
        handle_control_surface_http_action(
            db_path,
            "/api/deck/audio-action",
            &json!({ "action": action, "value": value }),
        )
        .unwrap_or_else(|error| panic!("{action} should succeed: {}", error.message()))
    };

    audio_action("dialTurn", Some("1:up"));
    audio_action("stripTap", Some("1"));
    audio_action("cycleBank", None);
    audio_action("cycleBank", None);
    audio_action("cycleBank", None);
    assert!(recent_actions(db_path).is_empty(), "rides and selections");

    let muted = audio_action("dialPress", Some("1"));
    let name = muted["name"]
        .as_str()
        .expect("the strip's name")
        .to_string();
    assert_eq!(
        recent_actions(db_path)[0],
        (
            String::from("deck"),
            String::from("mute"),
            format!("Mute on: {name}")
        )
    );

    assert_eq!(audio_action("talkOn", None)["changed"], true);
    assert_eq!(audio_action("talkOn", None)["changed"], false);
    assert_eq!(audio_action("talkOn", None)["changed"], false);
    assert_eq!(audio_action("talkOff", None)["changed"], true);
    let rows = recent_actions(db_path);
    assert_eq!(
        rows.iter()
            .map(|(source, action, _)| (source.as_str(), action.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("deck", "talkback-off"),
            ("deck", "talkback-on"),
            ("deck", "mute")
        ],
        "the press and the release, not the repeats in between"
    );
}
