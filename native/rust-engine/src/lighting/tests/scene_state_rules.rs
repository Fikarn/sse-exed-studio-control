// The scene's state (`scene_state.rs`, 2026-10-03) and the Lighting page's
// Fade, pinned on their own (the review of #293): the deck's tests read them
// only through the bridge.

use super::super::helpers::{effective_fixture_control_values, fixture_profile_for_state};
use super::super::scene_state::{
    scene_state, SCENE_STATE_CHOSEN, SCENE_STATE_LIVE, SCENE_STATE_NONE, SCENE_STATE_PREVIEW,
    SCENE_STATE_UNSAVED,
};
use super::*;
use serde_json::{json, Value};

const HELD: &str = "scene-held";

/// The rig of a ready test database, with a scene `HELD` that holds it as it
/// stands, put on the rig last.
fn rig_holding_its_scene(
    label: &str,
    set_up: impl FnOnce(&mut LightingEditorState),
) -> LightingEditorState {
    let test_dir = initialize_ready_lighting(label);
    let mut state = load_lighting_editor_state(&load_test_app_settings(&test_dir));
    set_up(&mut state);
    let held = LightingEditorSceneState {
        id: String::from(HELD),
        name: String::from("Held"),
        fixture_states: state
            .fixtures
            .iter()
            .map(|fixture| LightingEditorSceneFixtureState {
                fixture_id: fixture.id.clone(),
                intensity: fixture.intensity,
                cct: fixture.cct,
                on: fixture.on,
                control_values: effective_fixture_control_values(fixture),
            })
            .collect(),
        color_index: None,
    };
    state.scenes.push(held);
    assert_eq!(
        state_of(&state),
        SCENE_STATE_LIVE,
        "the rig holds its scene"
    );
    state
}

fn state_of(state: &LightingEditorState) -> &'static str {
    scene_state(state, Some(HELD), Some(HELD), false)
}

fn fixture<'a>(state: &'a mut LightingEditorState, id: &str) -> &'a mut LightingEditorFixtureState {
    state
        .fixtures
        .iter_mut()
        .find(|fixture| fixture.id == id)
        .expect("the fixture")
}

fn has_cct(state: &LightingEditorState, id: &str) -> bool {
    let fixture = state
        .fixtures
        .iter()
        .find(|fixture| fixture.id == id)
        .expect("the fixture");
    fixture_profile_for_state(fixture)
        .capabilities
        .iter()
        .any(|capability| capability == "cct")
}

#[test]
fn the_words_follow_preview_the_choice_and_the_last_recall() {
    let state = rig_holding_its_scene("scene-state-words", |_| {});
    assert_eq!(
        scene_state(&state, Some(HELD), Some(HELD), true),
        SCENE_STATE_PREVIEW
    );
    assert_eq!(
        scene_state(&state, Some(HELD), Some("scene-stream"), false),
        SCENE_STATE_CHOSEN
    );
    assert_eq!(
        scene_state(&state, Some(HELD), None, false),
        SCENE_STATE_CHOSEN
    );
    assert_eq!(
        scene_state(&state, Some("scene-gone"), Some("scene-gone"), false),
        SCENE_STATE_NONE
    );
    assert_eq!(
        scene_state(&state, None, Some(HELD), false),
        SCENE_STATE_NONE
    );
}

// Colour temperature counts within 25 K, and only on a fixture that has it:
// a fixture without it keeps whatever number the scene saved.
#[test]
fn colour_temperature_counts_within_25_k_and_only_where_a_fixture_has_it() {
    let mut state = rig_holding_its_scene("scene-state-cct", |state| {
        for fixture in &mut state.fixtures {
            fixture.on = true;
            fixture.intensity = 60;
        }
        let key = fixture(state, "fixture-key-left");
        key.cct = 4500;
        // A light of the catalog with a dimmer and effects and no colour
        // temperature.
        let plain = fixture(state, "fixture-backline-wash");
        plain.definition_id = Some(String::from("aputure-ls-600d-pro"));
        plain.mode_id = Some(String::from("5ch-fx"));
    });
    assert!(has_cct(&state, "fixture-key-left"));
    assert!(!has_cct(&state, "fixture-backline-wash"));

    for (cct, expected) in [
        (4525, SCENE_STATE_LIVE),
        (4475, SCENE_STATE_LIVE),
        (4526, SCENE_STATE_UNSAVED),
        (4474, SCENE_STATE_UNSAVED),
        (4500, SCENE_STATE_LIVE),
    ] {
        fixture(&mut state, "fixture-key-left").cct = cct;
        assert_eq!(state_of(&state), expected, "{cct} K");
    }

    let saved = fixture(&mut state, "fixture-backline-wash").cct;
    for cct in [saved + 1000, saved - 1000] {
        fixture(&mut state, "fixture-backline-wash").cct = cct;
        assert_eq!(
            state_of(&state),
            SCENE_STATE_LIVE,
            "{cct} K on a light without it"
        );
    }

    // A light the scene keeps off: its colour temperature does not count
    // either.
    let key = fixture(&mut state, "fixture-key-left");
    key.cct = 4500;
    key.on = false;
    let held = state
        .scenes
        .iter_mut()
        .find(|scene| scene.id == HELD)
        .expect("the scene");
    for saved in &mut held.fixture_states {
        if saved.fixture_id == "fixture-key-left" {
            saved.on = false;
        }
    }
    fixture(&mut state, "fixture-key-left").cct = 6000;
    assert_eq!(state_of(&state), SCENE_STATE_LIVE);
}

// A fixture the scene does not hold drifts only while it is lit: on at 0 %
// or off is still the scene.
#[test]
fn a_lit_fixture_the_scene_does_not_hold_is_unsaved_and_one_at_zero_is_not() {
    let mut state = rig_holding_its_scene("scene-state-unheld", |state| {
        for fixture in &mut state.fixtures {
            fixture.on = false;
        }
    });
    let held = state
        .scenes
        .iter_mut()
        .find(|scene| scene.id == HELD)
        .expect("the scene");
    held.fixture_states
        .retain(|saved| saved.fixture_id != "fixture-house-practicals");
    assert_eq!(state_of(&state), SCENE_STATE_LIVE);

    let unheld = fixture(&mut state, "fixture-house-practicals");
    unheld.on = true;
    unheld.intensity = 40;
    assert_eq!(state_of(&state), SCENE_STATE_UNSAVED, "lit");

    fixture(&mut state, "fixture-house-practicals").intensity = 0;
    assert_eq!(state_of(&state), SCENE_STATE_LIVE, "on at 0 %");

    let unheld = fixture(&mut state, "fixture-house-practicals");
    unheld.on = false;
    unheld.intensity = 80;
    assert_eq!(state_of(&state), SCENE_STATE_LIVE, "off");
}

// The rig is compared as a running fade will leave it: a scene being faded
// in is on the rig. A fixture the fade no longer holds (an edit takes it out
// of the fade) is compared as it stands.
#[test]
fn a_running_fade_is_compared_at_its_end() {
    let mut state = rig_holding_its_scene("scene-state-fade", |state| {
        for fixture in &mut state.fixtures {
            fixture.on = true;
            fixture.intensity = 80;
        }
    });
    let targets: Vec<LightingEditorSceneFixtureState> = state
        .scenes
        .iter()
        .find(|scene| scene.id == HELD)
        .expect("the scene")
        .fixture_states
        .clone();
    // The fade has only begun: the stored rig still holds the origin.
    let origin: Vec<LightingEditorSceneFixtureState> = targets
        .iter()
        .cloned()
        .map(|mut origin| {
            origin.intensity = 10;
            origin
        })
        .collect();
    for fixture in &mut state.fixtures {
        fixture.intensity = 10;
    }
    state.active_fade = Some(LightingEditorFadeState {
        scene_id: String::from(HELD),
        started_at_ms: 0,
        duration_ms: 5_000,
        origin_fixture_states: origin,
        target_fixture_states: targets,
    });
    assert_eq!(state_of(&state), SCENE_STATE_LIVE, "fading in");

    // An edit during the fade: the fixture leaves the fade at its new value.
    let fade = state.active_fade.as_mut().expect("the fade");
    fade.target_fixture_states
        .retain(|target| target.fixture_id != "fixture-key-left");
    fade.origin_fixture_states
        .retain(|origin| origin.fixture_id != "fixture-key-left");
    fixture(&mut state, "fixture-key-left").intensity = 40;
    assert_eq!(state_of(&state), SCENE_STATE_UNSAVED, "edited mid-fade");
}

/// The screen's word for the live scene, as `lighting.snapshot` reads it.
fn snapshot_scene_state(test_dir: &TestDir) -> String {
    read_lighting_snapshot(&load_test_app_settings(test_dir)).scene_state
}

fn recall(test_dir: &TestDir, scene_id: &str, fade_seconds: f64) {
    recall_lighting_scene(
        test_dir.db_path().as_path(),
        &LightingSceneRecallRequest {
            scene_id: String::from(scene_id),
            fade_duration_seconds: fade_seconds,
        },
    )
    .expect("the recall");
}

// Highlight, solo and identify exist only when the rig is drawn and sent:
// they change nothing a scene saves, so the scene stays on the rig.
#[test]
fn highlight_solo_and_identify_do_not_count() {
    let test_dir = initialize_ready_lighting("scene-state-overlays");
    let db_path = test_dir.db_path();
    recall(&test_dir, "scene-stream", 0.0);
    assert_eq!(snapshot_scene_state(&test_dir), SCENE_STATE_LIVE);

    for mode in [FixtureHighlightMode::Highlight, FixtureHighlightMode::Solo] {
        set_lighting_fixture_highlight(
            db_path.as_path(),
            &LightingFixtureHighlightRequest {
                fixture_ids: vec![String::from("fixture-key-left")],
                mode,
            },
        )
        .expect("the overlay");
        let snapshot = read_lighting_snapshot(&load_test_app_settings(&test_dir));
        // The overlay is drawn: a light reads what no scene saved.
        assert!(
            snapshot.fixtures.iter().any(|fixture| {
                (fixture.id == "fixture-key-left" && fixture.intensity == 100)
                    || (fixture.id == "fixture-key-right" && !fixture.on)
            }),
            "the overlay shows"
        );
        assert_eq!(snapshot.scene_state, SCENE_STATE_LIVE);
        // One overlay at a time: the next is refused while this one is on.
        set_lighting_fixture_highlight(
            db_path.as_path(),
            &LightingFixtureHighlightRequest {
                fixture_ids: Vec::new(),
                mode: FixtureHighlightMode::Off,
            },
        )
        .expect("the overlay off");
    }

    identify_lighting_fixture(
        db_path.as_path(),
        &LightingFixtureIdentifyRequest {
            fixture_id: String::from("fixture-backline-wash"),
            duration_ms: Some(10_000),
        },
    )
    .expect("the identify");
    assert_eq!(snapshot_scene_state(&test_dir), SCENE_STATE_LIVE);
}

// An edit while a recall fades: the rig no longer holds the scene.
#[test]
fn an_edit_during_a_fade_is_unsaved() {
    let test_dir = initialize_ready_lighting("scene-state-fade-edit");
    recall(&test_dir, "scene-stream", 10.0);
    assert!(
        load_lighting_editor_state(&load_test_app_settings(&test_dir))
            .active_fade
            .is_some()
    );
    assert_eq!(
        snapshot_scene_state(&test_dir),
        SCENE_STATE_LIVE,
        "fading in"
    );

    update_lighting_fixture(
        test_dir.db_path().as_path(),
        &parse_lighting_fixture_update_request(
            &json!({ "fixtureId": "fixture-key-left", "intensity": 40 }),
        )
        .expect("the edit parses"),
    )
    .expect("the edit");
    assert!(
        load_lighting_editor_state(&load_test_app_settings(&test_dir))
            .active_fade
            .is_some(),
        "the other lights still fade"
    );
    assert_eq!(snapshot_scene_state(&test_dir), SCENE_STATE_UNSAVED);
}

// The Lighting page's Fade (2026-10-03): whole milliseconds, 0 to 10 s, as
// the page sends it and as the saved data holds it.
#[test]
fn the_fade_is_clamped_and_rounded() {
    let parsed = |value: Value| {
        parse_lighting_settings_update_request(&json!({ "recallFadeMs": value }))
            .map(|request| request.recall_fade_ms)
    };
    assert_eq!(parsed(json!(12_000)), Ok(Some(10_000)));
    assert_eq!(parsed(json!(-1)), Ok(Some(0)));
    assert_eq!(parsed(json!(1499.6)), Ok(Some(1500)));
    assert_eq!(parsed(json!(2500)), Ok(Some(2500)));
    assert!(parsed(json!("2")).is_err(), "a string is refused");
    assert!(parsed(Value::Null).is_err(), "null is refused");

    let stored = |value: &str| {
        read_lighting_recall_fade_ms(&HashMap::from([(
            String::from(LIGHTING_RECALL_FADE_MS_KEY),
            String::from(value),
        )]))
    };
    assert_eq!(stored("abc"), 0);
    assert_eq!(stored("20000"), 10_000);
    assert_eq!(stored("-5"), 0);
    assert_eq!(stored(" 1500 "), 1500);
    assert_eq!(read_lighting_recall_fade_ms(&HashMap::new()), 0);
}
