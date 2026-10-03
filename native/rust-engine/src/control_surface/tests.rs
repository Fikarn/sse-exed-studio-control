use super::test_support::{ready_audio_test_db, TestDir};
use super::*;
use crate::storage::initialize_test_database;
use std::cell::Cell;
use std::time::Duration;

thread_local! {
    /// The test's own clock for the deck's presses: a second apart, so no
    /// press of a test is the same press again (the dwell) unless it says so.
    static PRESS_CLOCK: Cell<Option<Instant>> = const { Cell::new(None) };
}

/// The next moment of the test's clock, a second after the last.
fn next_press_moment() -> Instant {
    PRESS_CLOCK.with(|clock| {
        let at = clock
            .get()
            .map_or_else(Instant::now, |last| last + Duration::from_secs(1));
        clock.set(Some(at));
        at
    })
}

#[test]
fn truncate_preserves_short_text() {
    assert_eq!(truncate("Host Mic", 12), "Host Mic");
}

#[test]
fn truncate_limits_long_text() {
    assert_eq!(truncate("Very Long Fixture Name", 12), "Very Long Fi");
}

// A four-value cycle (new pages program, Slice 2: until then the Planning
// project statuses, which left with the page).
const FOUR_VALUES: &[&str] = &["one", "two", "three", "four"];

#[test]
fn cycle_value_wraps_forward() {
    assert_eq!(cycle_value(FOUR_VALUES, "four", true), "one");
}

#[test]
fn cycle_value_wraps_backward() {
    assert_eq!(cycle_value(FOUR_VALUES, "one", false), "four");
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

// 2026-10-03: the strip taps and GAIN left the deck. A tap still selects
// the screen's strip (its route is kept until a later cleanup), and the
// strip no longer marks it; a saved gain mode no longer shows the gain.
#[test]
fn audio_strip_lcd_renders_live_state_and_mute_without_a_selection_mark() {
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
        text.starts_with("HOST\\n") && !text.contains('\u{2022}'),
        "the selected strip carries no marker: {text}"
    );

    handle_audio_action(db_path.as_path(), "dialPress", Some("1")).expect("mute should engage");
    let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
        .expect("lcd text should render");
    assert!(
        text.contains("MUTED"),
        "muted strip should say MUTED instead of a level: {text}"
    );

    set_settings_owned(
        db_path.as_path(),
        &[(
            String::from("app.control_surface.audio.dial_mode"),
            String::from("gain"),
        )],
    )
    .expect("the old GAIN key's mode, as an old build saved it");
    let text = read_control_surface_lcd_text(db_path.as_path(), "audio_strip_1")
        .expect("lcd text should render");
    assert_eq!(text, "HOST\\nMUTED", "a saved gain mode shows no gain");
}

#[test]
fn audio_key_lcd_reflects_target_and_bank() {
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
    // Key 7 held TALK until 2026-09-28 (D26): the bridge answers no display
    // for it, and a deck with the old profile reads an error there.
    assert!(read_control_surface_lcd_text(db_path.as_path(), "audio_key_7").is_err());
    assert!(read_control_surface_lcd_text(db_path.as_path(), "audio_state_talk").is_err());

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

    // New pages program, D1: the default is the Console (`audio`) now, so the
    // stored page that proves the key reads the setting is Lighting.
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[(String::from(WORKSPACE_KEY), String::from("lighting"))],
    )
    .expect("workspace should persist");
    assert_eq!(
        read_control_surface_lcd_text(test_dir.db_path().as_path(), "workspace")
            .expect("workspace key should render"),
        "lighting"
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

// New pages program, Slice 2: the Planning LCD keys and the Planning
// selection in the deck context left with the page.
#[test]
fn planning_lcd_keys_and_context_are_gone() {
    let test_dir = ready_audio_test_db("lcd-planning");
    let db_path = test_dir.db_path();
    for key in [
        "project_nav",
        "project_status",
        "project_priority",
        "sort_mode",
        "task_nav",
    ] {
        assert!(
            matches!(
                read_control_surface_lcd_text(db_path.as_path(), key),
                Err(ControlSurfaceError::InvalidParams(_))
            ),
            "{key} still answers"
        );
    }
    let context = read_control_surface_context(db_path.as_path()).expect("context should load");
    let mut fields = context
        .as_object()
        .expect("the context is an object")
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    fields.sort();
    assert_eq!(
        fields,
        vec![String::from("audio"), String::from("workspace")]
    );
}

#[test]
fn legacy_audio_lcd_keys_are_gone() {
    let test_dir = ready_audio_test_db("lcd-legacy");
    assert!(matches!(
        read_control_surface_lcd_text(test_dir.db_path().as_path(), "audio_ch_nav"),
        Err(ControlSurfaceError::InvalidParams(_))
    ));
}

// New pages program, Slice 2: the page keys posted `switchToDeckMode`, which
// stored the deck's page as the Planning setting `planning.deck_mode`. Only
// the Planning snapshot and the app snapshot's Planning block read it, and
// both left; the deck follows the app through `shell.workspace` (the
// `workspace` LCD key). The key is refused on both routes now, stores
// nothing and stamps no event for Setup's echo.
#[test]
fn the_deck_mode_key_is_refused_and_stores_nothing() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_audio_test_db("deck-mode");
    let db_path = test_dir.db_path();
    let settings_before = list_settings_by_prefix(db_path.as_path(), "").expect("settings");

    for (route, value) in [
        ("/api/deck/light-action", "project"),
        ("/api/deck/light-action", "light"),
        ("/api/deck/audio-action", "audio"),
    ] {
        let refused = handle_control_surface_http_action(
            db_path.as_path(),
            route,
            &json!({ "action": "switchToDeckMode", "value": value }),
        )
        .expect_err("the deck-mode key left with Planning");
        assert_eq!(refused.status_code(), 501, "{route}: {}", refused.message());
    }

    assert_eq!(
        list_settings_by_prefix(db_path.as_path(), "").expect("settings"),
        settings_before,
        "a refused deck-mode key writes nothing"
    );
    assert!(control_surface_last_event(db_path.as_path()).is_null());
}

// D26 (2026-09-28): talkback left the app. A deck that still has the profile
// of the build before posts `talkOn` while its TALK key is held and `talkOff`
// at the release, and polls the key's two displays every second: each is
// refused, and none stores anything or stamps an event.
#[test]
fn the_talk_key_of_an_old_profile_is_refused_and_stores_nothing() {
    let test_dir = ready_audio_test_db("old-talk-key");
    let db_path = test_dir.db_path();
    let settings_before = list_settings_by_prefix(db_path.as_path(), "").expect("settings");

    for action in ["talkOn", "talkOff"] {
        let refused = handle_control_surface_http_action(
            db_path.as_path(),
            "/api/deck/audio-action",
            &json!({ "action": action }),
        )
        .expect_err("talkback left the app");
        assert_eq!(
            refused.status_code(),
            501,
            "{action}: {}",
            refused.message()
        );
    }
    for key in ["audio_key_7", "audio_state_talk"] {
        let refused = read_control_surface_lcd_text(db_path.as_path(), key)
            .expect_err("the TALK key's displays left with it");
        assert_eq!(refused.status_code(), 400, "{key}: {}", refused.message());
    }

    assert_eq!(
        list_settings_by_prefix(db_path.as_path(), "").expect("settings"),
        settings_before,
        "a refused TALK key writes nothing"
    );
    assert!(control_surface_last_event(db_path.as_path()).is_null());
    assert!(recent_actions(db_path.as_path()).is_empty());
}

// The review of #293: the old profile's GAIN key is refused as its TALK key
// is, and a gain mode an old build saved is reported nowhere: the context's
// `dialMode` and the `audio_state_mode` display read `fader`.
#[test]
fn the_gain_key_of_an_old_profile_is_refused_and_stores_nothing() {
    let test_dir = ready_audio_test_db("old-gain-key");
    let db_path = test_dir.db_path();
    set_settings_owned(
        db_path.as_path(),
        &[(
            String::from("app.control_surface.audio.dial_mode"),
            String::from("gain"),
        )],
    )
    .expect("the old GAIN key's mode, as an old build saved it");
    let settings_before = list_settings_by_prefix(db_path.as_path(), "").expect("settings");

    let refused = handle_control_surface_http_action(
        db_path.as_path(),
        "/api/deck/audio-action",
        &json!({ "action": "toggleDialMode" }),
    )
    .expect_err("the GAIN key left the deck");
    assert_eq!(refused.status_code(), 501, "{}", refused.message());
    assert_eq!(
        list_settings_by_prefix(db_path.as_path(), "").expect("settings"),
        settings_before,
        "a refused GAIN key writes nothing"
    );
    assert!(control_surface_last_event(db_path.as_path()).is_null());
    assert!(recent_actions(db_path.as_path()).is_empty());

    let context = read_control_surface_context(db_path.as_path()).expect("context should load");
    assert_eq!(context["audio"]["dialMode"], "fader");
    assert_eq!(
        read_control_surface_lcd_text(db_path.as_path(), "audio_state_mode")
            .expect("state should render"),
        "fader"
    );
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
    handle_control_surface_http_action_at(
        db_path,
        "/api/deck/light-action",
        &json!({ "action": action }),
        next_press_moment(),
    )
    .unwrap_or_else(|error| panic!("{action} should succeed: {}", error.message()))
}

/// `All Off` or `Del Scene` as the operator presses it (2026-09-28): the
/// first press arms and changes nothing, the second, a second later, acts.
fn asked_light_action(db_path: &Path, action: &str) -> Value {
    assert_eq!(light_action(db_path, action)["did"], "armed");
    light_action(db_path, action)
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

    // The LCD shows the staged number, and the scene's state says that it
    // is staged (2026-10-03: a third line said PREVIEW until then; the deck
    // now turns the values blue from the state). A light that is off reads
    // OFF.
    light_action(db_path, "resetIntensity");
    if !lock_shared_lighting_preview().fixture_states[KEY_LEFT].on {
        light_action(db_path, "toggleLight");
    }
    assert_eq!(
        read_control_surface_lcd_text(db_path, "light_intensity").expect("lcd text"),
        "INTENSITY\\n100 %"
    );
    let cct = read_control_surface_lcd_text(db_path, "light_cct").expect("lcd text");
    assert!(cct.starts_with("CCT\\n") && cct.ends_with(" K"), "{cct}");
    assert_eq!(
        read_control_surface_lcd_text(db_path, "scene_state").expect("lcd text"),
        "preview"
    );
    light_action(db_path, "toggleLight");
    assert_eq!(
        read_control_surface_lcd_text(db_path, "light_intensity").expect("lcd text"),
        "INTENSITY\\nOFF"
    );

    // Out of preview the same key moves the rig.
    set_shared_preview_mode(db_path, false);
    assert_eq!(
        read_control_surface_lcd_text(db_path, "light_intensity").expect("lcd text"),
        "INTENSITY\\n40 %"
    );
    assert_ne!(
        read_control_surface_lcd_text(db_path, "scene_state").expect("lcd text"),
        "preview"
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
        format!("CCT\\n{last_cct} K")
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

/// The Lighting page's Fade, as the page sets it (`lighting.settings.update`).
fn set_recall_fade_ms(db_path: &Path, fade_ms: i64) {
    crate::lighting::update_lighting_settings(
        db_path,
        &crate::lighting::parse_lighting_settings_update_request(
            &json!({ "recallFadeMs": fade_ms }),
        )
        .expect("the update should parse"),
    )
    .expect("the fade should be saved");
}

// The owner's answer to question 5 (2026-10-03): the deck's RECALL fades as
// the Lighting page's recall does, with the page's Fade; into the preview
// it loads at once, as the page's does. Until then the deck always recalled
// at once.
#[test]
fn the_decks_recall_uses_the_lighting_pages_fade() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("light-recall-fade");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    set_settings_owned(
        db_path,
        &[(
            String::from(SELECTED_SCENE_ID_KEY),
            String::from("scene-stream"),
        )],
    )
    .expect("the deck's scene selection should persist");

    set_recall_fade_ms(db_path, 2_500);
    assert_eq!(
        crate::lighting::read_lighting_snapshot(&deck_app_settings(db_path)).recall_fade_ms,
        2_500
    );
    assert_eq!(light_action(db_path, "recallScene")["preview"], false);
    let fade = load_lighting_editor_state(&deck_app_settings(db_path))
        .active_fade
        .expect("the recall fades");
    assert_eq!(fade.scene_id, "scene-stream");
    assert_eq!(fade.duration_ms, 2_500);
    assert_eq!(
        read_lighting_snapshot_last_recall(db_path).as_deref(),
        Some("scene-stream")
    );
    // A scene being faded in is the rig's: RECALL reads ON RIG at once.
    assert_eq!(
        read_control_surface_lcd_text(db_path, "scene_state").expect("lcd text"),
        "live"
    );

    // No Fade: at once, as before.
    set_recall_fade_ms(db_path, 0);
    light_action(db_path, "recallScene");
    assert!(load_lighting_editor_state(&deck_app_settings(db_path))
        .active_fade
        .is_none());

    // Into the preview: at once, whatever the Fade, and the rig stays.
    set_recall_fade_ms(db_path, 4_000);
    set_shared_preview_mode(db_path, true);
    assert_eq!(light_action(db_path, "recallScene")["preview"], true);
    assert!(load_lighting_editor_state(&deck_app_settings(db_path))
        .active_fade
        .is_none());
    set_shared_preview_mode(db_path, false);
}

// 2026-10-03: whether the rig holds a scene is decided once, in the hardware
// link, for the screen (`lighting.snapshot`'s `sceneState`, of the live
// scene) and the deck (`scene_state`, of the scene its SCENE dial chose),
// with the same rule. The words are the deck's colour rules', letter for
// letter.
#[test]
fn the_scene_state_is_decided_once_for_the_screen_and_the_deck() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("scene-state");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let deck = || read_control_surface_lcd_text(db_path, "scene_state").expect("lcd text");
    let screen =
        || crate::lighting::read_lighting_snapshot(&deck_app_settings(db_path)).scene_state;
    for word in [deck(), screen()] {
        assert!(
            crate::lighting::SCENE_STATES.contains(&word.as_str()),
            "{word}"
        );
    }
    set_settings_owned(
        db_path,
        &[(
            String::from(SELECTED_SCENE_ID_KEY),
            String::from("scene-stream"),
        )],
    )
    .expect("the deck's scene selection should persist");

    // Chosen, not on the rig: a press will change the rig.
    if read_lighting_snapshot_last_recall(db_path).as_deref() != Some("scene-stream") {
        assert_eq!(deck(), "chosen");
    }
    light_action(db_path, "recallScene");
    assert_eq!(deck(), "live");
    assert_eq!(screen(), "live");

    // The rig changed since: both say so.
    let scene_fixture = load_lighting_editor_state(&deck_app_settings(db_path))
        .scenes
        .into_iter()
        .find(|scene| scene.id == "scene-stream")
        .and_then(|scene| scene.fixture_states.into_iter().find(|state| state.on))
        .expect("the scene lights a fixture");
    set_live_fixture(
        db_path,
        &scene_fixture.fixture_id,
        true,
        if scene_fixture.intensity > 50 { 10 } else { 90 },
    );
    assert_eq!(deck(), "unsaved");
    assert_eq!(screen(), "unsaved");

    // The deck's SCENE dial moves on: its scene is only chosen; the screen's
    // live scene is still the one on the rig, changed.
    light_action(db_path, "selectNextScene");
    assert_eq!(deck(), "chosen");
    assert_eq!(screen(), "unsaved");

    // Preview: both.
    set_shared_preview_mode(db_path, true);
    assert_eq!(deck(), "preview");
    let previewing = with_lighting_state_and_preview(|preview| {
        crate::lighting::read_lighting_snapshot_with_preview(&deck_app_settings(db_path), preview)
    });
    assert_eq!(previewing.scene_state, "preview");
    set_shared_preview_mode(db_path, false);
}

// A rig with no scene reads `none`, on the deck and on the screen. Every
// scene is deleted, and the bridge's address is cleared: with an address the
// rig's three default scenes come back when its last scene goes, so the
// assertions are unconditional (the review of #293: they sat inside an `if`
// that never held).
#[test]
fn a_rig_with_no_scene_is_none() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("scene-state-none");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    for scene in load_lighting_editor_state(&deck_app_settings(db_path)).scenes {
        crate::lighting::delete_lighting_scene(
            db_path,
            &parse_lighting_scene_delete_request(&json!({ "sceneId": scene.id }))
                .expect("the delete should parse"),
        )
        .expect("the scene should go");
    }
    set_settings_owned(
        db_path,
        &[(
            String::from(crate::commissioning::LIGHTING_BRIDGE_IP_KEY),
            String::new(),
        )],
    )
    .expect("the address should clear");
    assert!(
        load_lighting_editor_state(&deck_app_settings(db_path))
            .scenes
            .is_empty(),
        "no scene is left"
    );
    assert_eq!(
        read_control_surface_lcd_text(db_path, "scene_state").expect("lcd text"),
        "none"
    );
    assert_eq!(
        read_control_surface_lcd_text(db_path, "scene_nav").expect("lcd text"),
        "SCENE\\n--"
    );
    assert_eq!(
        crate::lighting::read_lighting_snapshot(&deck_app_settings(db_path)).scene_state,
        "none"
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
    let deleted = asked_light_action(db_path, "deleteScene");
    assert_eq!(deleted["sceneId"], first_id.as_str());
    assert_eq!(deleted["did"], "deleted");
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
// raises lighting.changed with the reason `control-surface`. This is the one
// test that installs the process-wide event sender; other tests' events land
// in the channel too, so it looks for its own and ignores the rest. (New
// pages program, Slice 2: the Planning keys and their planning.changed left,
// and so did the deck-mode key, whose Planning setting raised it too; the
// deck-mode key is refused now and raises nothing.)
#[test]
fn deck_light_actions_raise_their_events() {
    assert_eq!(
        deck_change_event("/api/deck/light-action", "toggleLight"),
        Some(DeckChange::Lighting)
    );
    assert_eq!(
        deck_change_event("/api/deck/light-action", "selectNextScene"),
        Some(DeckChange::Lighting)
    );
    assert_eq!(deck_change_event("/api/deck/action", "nextStatus"), None);
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

    let deck_mode_key = handle_control_surface_http_action(
        db_path,
        "/api/deck/light-action",
        &json!({ "action": "switchToDeckMode", "value": "project" }),
    )
    .expect_err("the deck-mode key left with Planning");
    assert_eq!(deck_mode_key.status_code(), 501);
    assert!(
        !raised("lighting.changed"),
        "a refused deck-mode key raises nothing"
    );

    let planning_key = handle_control_surface_http_action(
        db_path,
        "/api/deck/action",
        &json!({ "action": "nextSort" }),
    )
    .expect_err("the Planning keys' route is gone");
    assert_eq!(planning_key.status_code(), 400);
    assert_eq!(
        planning_key.message(),
        "Unsupported action route: /api/deck/action"
    );
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

    // The first press arms: no row, and the key's display asks.
    assert_eq!(light_action(db_path, "allOff")["did"], "armed");
    assert!(recent_actions(db_path).is_empty(), "an arm is no row");
    assert_eq!(light_action(db_path, "allOff")["did"], "switched");
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

// The audio half: a mute and the dim key are rows; the dial and a strip tap
// are not.
#[test]
fn deck_audio_keys_record_source_deck() {
    let test_dir = ready_audio_test_db("deck-audio-action-log");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let audio_action = |action: &str, value: Option<&str>| {
        handle_control_surface_http_action_at(
            db_path,
            "/api/deck/audio-action",
            &json!({ "action": action, "value": value }),
            next_press_moment(),
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

    assert_eq!(audio_action("dimToggle", None)["dim"], true);
    let rows = recent_actions(db_path);
    // The main output as the screen and TotalMix name it (2026-09-28).
    assert_eq!(rows[0].2, "Dim on: Main Out");
    assert_eq!(
        rows.iter()
            .map(|(source, action, _)| (source.as_str(), action.as_str()))
            .collect::<Vec<_>>(),
        vec![("deck", "dim"), ("deck", "mute")],
        "newest first"
    );
}

// ---------------------------------------------------------------------------
// The keys that ask first, and the ones that dwell (the owner's decisions,
// 2026-09-28). The tests give the moment of each press themselves.
// ---------------------------------------------------------------------------

fn light_action_at(db_path: &Path, action: &str, at: Instant) -> Value {
    handle_control_surface_http_action_at(
        db_path,
        "/api/deck/light-action",
        &json!({ "action": action }),
        at,
    )
    .unwrap_or_else(|error| panic!("{action} should succeed: {}", error.message()))
}

fn lit_count(db_path: &Path) -> usize {
    load_lighting_editor_state(&deck_app_settings(db_path))
        .fixtures
        .iter()
        .filter(|fixture| fixture.on)
        .count()
}

fn scene_count(db_path: &Path) -> usize {
    load_lighting_editor_state(&deck_app_settings(db_path))
        .scenes
        .len()
}

// `All Off` arms at the first press and reads `OFF?`; the rig does not move
// and nothing is written. A second press within 3 s switches every fixture
// off, once, and a press sooner than the dwell after it changes nothing. The
// key reads its name again once it acted, or once its 3 s are over.
#[test]
fn all_off_asks_first_and_switches_at_the_second_press() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("all-off-asks");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let start = next_press_moment();
    light_action_at(db_path, "allOn", start);
    let lit = lit_count(db_path);
    assert!(lit > 0, "the rig is lit");
    let rows = recent_actions(db_path).len();

    let armed = start + Duration::from_secs(10);
    assert_eq!(light_action_at(db_path, "allOff", armed)["did"], "armed");
    assert_eq!(lit_count(db_path), lit, "an arm moves nothing");
    assert_eq!(recent_actions(db_path).len(), rows, "an arm is no row");
    assert_eq!(
        read_control_surface_lcd_text_at(db_path, "light_key_off", armed).expect("a display"),
        "OFF?"
    );
    assert_eq!(
        read_control_surface_lcd_text_at(db_path, "light_key_del", armed).expect("a display"),
        "Del\\nScene"
    );
    // A bounce inside the dwell is the same press.
    assert_eq!(
        light_action_at(db_path, "allOff", armed + Duration::from_millis(100))["did"],
        "kept"
    );
    assert_eq!(lit_count(db_path), lit);

    let second = armed + Duration::from_secs(2);
    assert_eq!(
        light_action_at(db_path, "allOff", second)["did"],
        "switched"
    );
    assert_eq!(lit_count(db_path), 0);
    assert_eq!(recent_actions(db_path).len(), rows + 1);
    assert_eq!(
        read_control_surface_lcd_text_at(db_path, "light_key_off", second).expect("a display"),
        "ALL OFF"
    );
    assert_eq!(
        light_action_at(db_path, "allOff", second + Duration::from_millis(200))["did"],
        "kept",
        "a double press on the confirm switches once"
    );
    assert_eq!(recent_actions(db_path).len(), rows + 1);

    // An arm that runs out: the key reads its name, and the next press
    // arms again rather than acting.
    let late = second + Duration::from_secs(10);
    light_action_at(db_path, "allOn", late);
    assert_eq!(
        light_action_at(db_path, "allOff", late + Duration::from_secs(1))["did"],
        "armed"
    );
    let over = late + Duration::from_secs(5);
    assert_eq!(
        read_control_surface_lcd_text_at(db_path, "light_key_off", over).expect("a display"),
        "ALL OFF"
    );
    assert_eq!(light_action_at(db_path, "allOff", over)["did"], "armed");
    assert!(lit_count(db_path) > 0, "nothing went off at one press");
}

// `Del Scene` asks about the scene the deck has selected. A press of another
// key of the page ends the arm, and so does a selection that moved: the
// second press never deletes a scene the first did not ask about.
#[test]
fn del_scene_asks_about_the_selected_scene_only() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("del-scene-asks");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    light_action(db_path, "saveScene");
    light_action(db_path, "saveScene");
    let scenes = scene_count(db_path);
    assert!(scenes >= 2, "two scenes to choose from");

    let start = next_press_moment() + Duration::from_secs(10);
    assert_eq!(
        light_action_at(db_path, "deleteScene", start)["did"],
        "armed"
    );
    assert_eq!(
        read_control_surface_lcd_text_at(db_path, "light_key_del", start).expect("a display"),
        "DEL?"
    );
    // The scene dial moves the selection: the arm ends.
    light_action_at(db_path, "selectPrevScene", start + Duration::from_secs(1));
    assert_eq!(
        read_control_surface_lcd_text_at(db_path, "light_key_del", start + Duration::from_secs(1))
            .expect("a display"),
        "Del\\nScene"
    );
    assert_eq!(
        light_action_at(db_path, "deleteScene", start + Duration::from_secs(2))["did"],
        "armed",
        "a press after the arm ended asks again"
    );
    assert_eq!(scene_count(db_path), scenes);

    // The selection moved on screen, not at the deck: the second press is
    // about another scene, and does nothing.
    let other = load_lighting_editor_state(&deck_app_settings(db_path))
        .scenes
        .iter()
        .map(|scene| scene.id.clone())
        .find(|id| {
            deck_app_settings(db_path)
                .get(SELECTED_SCENE_ID_KEY)
                .map(String::as_str)
                != Some(id.as_str())
        })
        .expect("another scene");
    set_settings_owned(db_path, &[(String::from(SELECTED_SCENE_ID_KEY), other)])
        .expect("the selection should persist");
    assert_eq!(
        light_action_at(db_path, "deleteScene", start + Duration::from_secs(3))["did"],
        "kept"
    );
    assert_eq!(scene_count(db_path), scenes);

    // Asked and confirmed: one scene goes, however fast the confirm bounces.
    let armed = start + Duration::from_secs(10);
    assert_eq!(
        light_action_at(db_path, "deleteScene", armed)["did"],
        "armed"
    );
    let second = armed + Duration::from_secs(1);
    assert_eq!(
        light_action_at(db_path, "deleteScene", second)["did"],
        "deleted"
    );
    assert_eq!(
        light_action_at(db_path, "deleteScene", second + Duration::from_millis(100))["did"],
        "kept"
    );
    assert_eq!(scene_count(db_path), scenes - 1);
}

// `Toggle`, `DIM` and a mute switch at one press, and a second press within
// the dwell (a bounce, a double press) switches nothing. The dwell counts
// from the press that acted, and each strip's mute has its own.
#[test]
fn toggle_dim_and_a_mute_drop_a_second_press_within_the_dwell() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("toggle-dwells");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let start = next_press_moment() + Duration::from_secs(10);
    let first = light_action_at(db_path, "toggleLight", start);
    let on = first["light"]["on"]
        .as_bool()
        .expect("the reply says what was stored");
    let rows = recent_actions(db_path).len();
    assert_eq!(
        light_action_at(db_path, "toggleLight", start + Duration::from_millis(200))["did"],
        "kept"
    );
    assert_eq!(
        recent_actions(db_path).len(),
        rows,
        "the same press leaves no row"
    );
    let third = light_action_at(db_path, "toggleLight", start + Duration::from_millis(400));
    assert_eq!(
        third["light"]["on"], !on,
        "a press after the dwell switches"
    );

    let audio_dir = ready_audio_test_db("dim-and-mute-dwell");
    let audio_db = audio_dir.db_path();
    let audio_db = audio_db.as_path();
    let audio = |action: &str, value: Option<&str>, at: Instant| {
        handle_control_surface_http_action_at(
            audio_db,
            "/api/deck/audio-action",
            &json!({ "action": action, "value": value }),
            at,
        )
        .unwrap_or_else(|error| panic!("{action} should succeed: {}", error.message()))
    };
    assert_eq!(audio("dimToggle", None, start)["dim"], true);
    assert_eq!(
        audio("dimToggle", None, start + Duration::from_millis(100))["did"],
        "kept"
    );
    assert_eq!(
        audio("dimToggle", None, start + Duration::from_millis(500))["dim"],
        false
    );

    assert_eq!(audio("dialPress", Some("1"), start)["mute"], true);
    assert_eq!(
        audio("dialPress", Some("1"), start + Duration::from_millis(100))["did"],
        "kept"
    );
    // Another strip's mute is a press of its own.
    assert_eq!(
        audio("dialPress", Some("2"), start + Duration::from_millis(100))["mute"],
        true
    );
    assert_eq!(
        recent_actions(audio_db)
            .iter()
            .filter(|(_, action, _)| action == "mute")
            .count(),
        2
    );
}

// The review of #293: `PHONES` goes on to the next phones mix at each
// press, so a bounce or a double press would land on the other one. It
// dwells as `PLAY` does: a second press within 350 ms of the one that acted
// is the same press, answered `kept`, and the target stays.
#[test]
fn phones_drops_a_second_press_within_the_dwell() {
    let test_dir = ready_audio_test_db("phones-dwell");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let start = next_press_moment() + Duration::from_secs(10);
    let press = |value: &str, at: Instant| {
        handle_control_surface_http_action_at(
            db_path,
            "/api/deck/audio-action",
            &json!({ "action": "setMixTarget", "value": value }),
            at,
        )
        .unwrap_or_else(|error| panic!("{value} should succeed: {}", error.message()))
    };
    let target = || {
        read_control_surface_lcd_text(db_path, "audio_state_target").expect("state should render")
    };
    assert_eq!(
        press("phones", start)["selectedMixTargetId"],
        "audio-mix-phones-a"
    );
    let kept = press("phones", start + Duration::from_millis(200));
    assert_eq!(kept["did"], "kept", "{kept}");
    assert_eq!(target(), "phones-a", "the same press moves nothing");
    assert_eq!(
        press("phones", start + Duration::from_millis(400))["selectedMixTargetId"],
        "audio-mix-phones-b",
        "a press after the dwell goes on"
    );
    // MAIN OUT does not dwell: a second press leaves it where it is anyway.
    let main = start + Duration::from_secs(1);
    assert_eq!(press("main", main)["selectedMixTargetId"], "audio-mix-main");
    let again = press("main", main + Duration::from_millis(100));
    assert_eq!(again["selectedMixTargetId"], "audio-mix-main", "{again}");
    assert_eq!(target(), "main");
}

// The review of #254: an armed or kept press of `All Off` raises no
// `lighting.changed`, another key of the page ends its arm, and the press
// that acts is heard.
#[test]
fn an_arm_raises_nothing_and_another_key_ends_it() {
    let _preview_guard = crate::lighting::shared_preview_test_guard();
    let test_dir = ready_lighting_deck_db("asking-keys-events");
    let db_path = test_dir.db_path();
    let db_path = db_path.as_path();
    let start = next_press_moment() + Duration::from_secs(10);
    let press = |action: &str, at: Instant| {
        deck_key_stamped(
            db_path,
            true,
            "/api/deck/light-action",
            &json!({ "action": action }),
            at,
        )
    };

    let (armed, events) = press("allOff", start);
    assert_eq!(armed.expect("an answer")["did"], "armed");
    assert!(events.is_empty(), "an arm raises nothing: {events:?}");
    let (kept, events) = press("allOff", start + Duration::from_millis(100));
    assert_eq!(kept.expect("an answer")["did"], "kept");
    assert!(
        events.is_empty(),
        "the same press raises nothing: {events:?}"
    );

    // Another key of the page ends the arm: the next press asks again.
    let (moved, _) = press("selectNextScene", start + Duration::from_millis(500));
    moved.expect("the dial moves the selection");
    let (again, events) = press("allOff", start + Duration::from_secs(1));
    assert_eq!(again.expect("an answer")["did"], "armed");
    assert!(events.is_empty());

    let (switched, events) = press("allOff", start + Duration::from_secs(2));
    assert_eq!(switched.expect("an answer")["did"], "switched");
    assert_eq!(
        events,
        vec![KeyEvent::Lighting],
        "the press that acted is heard"
    );
}
