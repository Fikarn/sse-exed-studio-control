//! 2026-09 production readiness, Slice 10 (F12, F18): the lighting state
//! lock, the render generation, and the values a Stream Deck key starts from.
//! The generation is process-wide and other tests advance it while these
//! run, so it is only ever asserted to have advanced.

use super::*;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_CHECK_ID};
use crate::control_surface::test_support::TestDir;
use crate::storage::{initialize_test_database, list_settings_by_prefix, set_settings_owned};
use std::collections::HashMap;
use std::path::Path;
use std::thread;

fn ready_lighting(label: &str) -> TestDir {
    let test_dir = TestDir::new(label);
    initialize_test_database(test_dir.db_path().as_path()).expect("database should initialize");
    set_settings_owned(
        test_dir.db_path().as_path(),
        &[
            (
                String::from(LIGHTING_BRIDGE_IP_KEY),
                String::from("127.0.0.1"),
            ),
            (
                format!("app.commissioning.check.{LIGHTING_CHECK_ID}.status"),
                String::from("passed"),
            ),
        ],
    )
    .expect("lighting settings should persist");
    test_dir
}

fn app_settings(db_path: &Path) -> HashMap<String, String> {
    list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX).expect("settings should load")
}

fn set_fixture(db_path: &Path, fixture_id: &str, on: bool, intensity: i64, cct: i64) {
    update_lighting_fixture(
        db_path,
        &parse_lighting_fixture_update_request(&serde_json::json!({
            "fixtureId": fixture_id,
            "on": on,
            "intensity": intensity,
            "cct": cct,
        }))
        .expect("the update should parse"),
    )
    .expect("the fixture should update");
}

#[test]
fn with_lighting_state_advances_the_render_generation() {
    let before = lighting_render_generation();
    assert_eq!(with_lighting_state(|| 7), 7);
    assert!(lighting_render_generation() > before);

    // A refused mutation advances it too: the cost is one read on the sACN
    // thread, and a change is never missed.
    let before = lighting_render_generation();
    let refused: Result<(), LightingCommandError> = with_lighting_state(|| {
        Err(LightingCommandError::Rejected(
            "LIGHTING_TEST_REFUSAL",
            String::from("refused"),
        ))
    });
    assert!(refused.is_err());
    assert!(lighting_render_generation() > before);

    let before = lighting_render_generation();
    with_lighting_state_and_preview(|_preview| ());
    assert!(lighting_render_generation() > before);

    let before = lighting_render_generation();
    bump_lighting_render_generation();
    assert!(lighting_render_generation() > before);
}

#[test]
fn fixture_levels_are_the_stored_values_with_a_finished_fade_applied() {
    let test_dir = ready_lighting("levels-fade");
    let db_path = test_dir.db_path();
    set_fixture(db_path.as_path(), "fixture-key-left", true, 40, 3200);
    let preview = LightingPreviewRuntimeState::default();

    let levels = read_lighting_fixture_levels(
        &app_settings(db_path.as_path()),
        &preview,
        "fixture-key-left",
    )
    .expect("the fixture exists");
    assert_eq!(
        levels,
        LightingFixtureLevels {
            on: true,
            intensity: 40,
            cct: 3200,
            previewing: false,
        }
    );
    assert!(read_lighting_fixture_levels(
        &app_settings(db_path.as_path()),
        &preview,
        "fixture-missing"
    )
    .is_none());

    // A fade that ran out twenty seconds ago: nothing wrote its end values
    // back, so the stored fixture still carries where the fade started.
    let mut state = load_lighting_editor_state(&app_settings(db_path.as_path()));
    let now_ms = identify::current_unix_ms();
    let mut target = editor_state::capture_scene_fixture_states(&state.fixtures);
    for entry in &mut target {
        if entry.fixture_id == "fixture-key-left" {
            entry.intensity = 85;
            entry.cct = 5000;
        }
    }
    fade::start_lighting_fade(
        &mut state,
        String::from("scene-teaching"),
        now_ms - 20_000,
        10_000,
        target,
    );
    save_lighting_editor_state(db_path.as_path(), &state).expect("the fade should persist");

    let stored = load_lighting_editor_state(&app_settings(db_path.as_path()));
    let stored_fixture = stored
        .fixtures
        .iter()
        .find(|fixture| fixture.id == "fixture-key-left")
        .expect("the fixture exists");
    assert_eq!(
        stored_fixture.intensity, 40,
        "the stored value is the origin"
    );

    let levels = read_lighting_fixture_levels(
        &app_settings(db_path.as_path()),
        &preview,
        "fixture-key-left",
    )
    .expect("the fixture exists");
    assert_eq!(levels.intensity, 85, "the fade's end value is what is lit");
    assert_eq!(levels.cct, 5000);
    assert!(!levels.previewing);
}

#[test]
fn fixture_levels_follow_the_preview_buffer_while_previewing() {
    let test_dir = ready_lighting("levels-preview");
    let db_path = test_dir.db_path();
    set_fixture(db_path.as_path(), "fixture-key-left", true, 40, 3200);

    // A preview of this test's own, not the process-wide one.
    let mut preview = LightingPreviewRuntimeState::default();
    set_lighting_preview_mode(
        db_path.as_path(),
        &parse_lighting_preview_mode_request(&serde_json::json!({ "enabled": true }))
            .expect("the request should parse"),
        &mut preview,
    )
    .expect("preview mode should enable");
    update_lighting_fixture_with_preview(
        db_path.as_path(),
        &parse_lighting_fixture_update_request(&serde_json::json!({
            "fixtureId": "fixture-key-left",
            "intensity": 70,
        }))
        .expect("the update should parse"),
        &mut preview,
    )
    .expect("the preview should take the value");

    let levels = read_lighting_fixture_levels(
        &app_settings(db_path.as_path()),
        &preview,
        "fixture-key-left",
    )
    .expect("the fixture exists");
    assert_eq!(
        levels,
        LightingFixtureLevels {
            on: true,
            intensity: 70,
            cct: 3200,
            previewing: true,
        }
    );

    // A fixture the buffer does not hold reads its stored values, still
    // marked as previewing.
    preview.fixture_states.remove("fixture-key-right");
    let other = read_lighting_fixture_levels(
        &app_settings(db_path.as_path()),
        &preview,
        "fixture-key-right",
    )
    .expect("the fixture exists");
    assert!(other.previewing);
}

// Lock order: the state lock, then the shared preview; a reader takes the
// preview alone. A mistake here does not fail — it hangs this test.
#[test]
fn writers_and_readers_of_the_shared_preview_never_wait_on_each_other_forever() {
    let _preview_guard = shared_preview_test_guard();

    let writers = (0..2)
        .map(|_| {
            thread::spawn(|| {
                for _ in 0..200 {
                    with_lighting_state_and_preview(|preview| {
                        preview.dirty = !preview.dirty;
                    });
                }
            })
        })
        .collect::<Vec<_>>();
    let reader = thread::spawn(|| {
        let mut seen = 0_usize;
        for _ in 0..200 {
            let preview = lock_shared_lighting_preview();
            if !preview.enabled {
                seen += 1;
            }
        }
        seen
    });

    for writer in writers {
        writer.join().expect("a writer should finish");
    }
    assert_eq!(reader.join().expect("the reader should finish"), 200);
    reset_shared_preview();
}
