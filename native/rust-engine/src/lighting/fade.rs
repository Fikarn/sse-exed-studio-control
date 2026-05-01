use std::collections::HashMap;

use super::helpers::clamp_i64;
use super::types::{
    LightingEditorFadeState, LightingEditorFixtureState, LightingEditorSceneFixtureState,
    LightingEditorState,
};

#[derive(Debug, Clone)]
pub(super) struct LightingFadeRuntimeStatus {
    pub scene_id: String,
    pub progress: f64,
    pub duration_ms: i64,
}

pub(super) fn fade_duration_ms_from_seconds(seconds: f64) -> i64 {
    ((seconds * 1000.0).round() as i64).clamp(0, 10_000)
}

pub(super) fn fade_progress(started_at_ms: i64, now_ms: i64, duration_ms: i64) -> f64 {
    if duration_ms <= 0 {
        return 1.0;
    }
    ((now_ms - started_at_ms) as f64 / duration_ms as f64).clamp(0.0, 1.0)
}

pub(super) fn sample_lighting_fade_state(
    origin: &LightingEditorSceneFixtureState,
    target: &LightingEditorSceneFixtureState,
    progress: f64,
) -> LightingEditorSceneFixtureState {
    let t = progress.clamp(0.0, 1.0);
    let origin_level = if origin.on { origin.intensity } else { 0 };
    let target_level = if target.on { target.intensity } else { 0 };
    let intensity = lerp_i64(origin_level, target_level, t).clamp(0, 100);
    let cct = lerp_i64(origin.cct, target.cct, t);
    let on = if target_level > origin_level {
        intensity > 0 || target.on
    } else if target_level < origin_level {
        t < 1.0 && origin.on
    } else {
        target.on
    };

    LightingEditorSceneFixtureState {
        fixture_id: target.fixture_id.clone(),
        intensity,
        cct,
        on,
    }
}

pub(super) fn start_lighting_fade(
    state: &mut LightingEditorState,
    scene_id: String,
    now_ms: i64,
    duration_ms: i64,
    target_fixture_states: Vec<LightingEditorSceneFixtureState>,
) {
    if duration_ms <= 0 {
        state.active_fade = None;
        return;
    }
    state.active_fade = Some(LightingEditorFadeState {
        scene_id,
        started_at_ms: now_ms,
        duration_ms,
        origin_fixture_states: capture_fixture_states(&state.fixtures),
        target_fixture_states,
    });
}

pub(super) fn apply_active_fade_sample(
    state: &mut LightingEditorState,
    now_ms: i64,
) -> Option<LightingFadeRuntimeStatus> {
    let fade = state.active_fade.clone()?;
    let progress = fade_progress(fade.started_at_ms, now_ms, fade.duration_ms);
    let origin_by_id = states_by_fixture_id(&fade.origin_fixture_states);
    let target_by_id = states_by_fixture_id(&fade.target_fixture_states);

    for fixture in &mut state.fixtures {
        let fallback = LightingEditorSceneFixtureState {
            fixture_id: fixture.id.clone(),
            intensity: fixture.intensity,
            cct: fixture.cct,
            on: fixture.on,
        };
        let origin = origin_by_id.get(fixture.id.as_str()).copied().unwrap_or(&fallback);
        let target = target_by_id.get(fixture.id.as_str()).copied().unwrap_or(origin);
        let sampled = sample_lighting_fade_state(origin, target, progress);
        fixture.intensity = sampled.intensity;
        fixture.cct = sampled.cct;
        fixture.on = sampled.on;
    }

    if progress >= 1.0 {
        state.active_fade = None;
    }

    Some(LightingFadeRuntimeStatus {
        scene_id: fade.scene_id,
        progress,
        duration_ms: fade.duration_ms,
    })
}

pub(super) fn remove_fixture_from_active_fade(state: &mut LightingEditorState, fixture_id: &str) {
    if let Some(fade) = &mut state.active_fade {
        fade.origin_fixture_states
            .retain(|entry| entry.fixture_id != fixture_id);
        fade.target_fixture_states
            .retain(|entry| entry.fixture_id != fixture_id);
        if fade.target_fixture_states.is_empty() {
            state.active_fade = None;
        }
    }
}

pub(super) fn clear_active_fade(state: &mut LightingEditorState) {
    state.active_fade = None;
}

fn capture_fixture_states(
    fixtures: &[LightingEditorFixtureState],
) -> Vec<LightingEditorSceneFixtureState> {
    fixtures
        .iter()
        .map(|fixture| LightingEditorSceneFixtureState {
            fixture_id: fixture.id.clone(),
            intensity: clamp_i64(fixture.intensity, 0, 100),
            cct: fixture.cct,
            on: fixture.on,
        })
        .collect()
}

fn states_by_fixture_id(
    states: &[LightingEditorSceneFixtureState],
) -> HashMap<&str, &LightingEditorSceneFixtureState> {
    states
        .iter()
        .map(|state| (state.fixture_id.as_str(), state))
        .collect()
}

fn lerp_i64(origin: i64, target: i64, progress: f64) -> i64 {
    (origin as f64 + (target - origin) as f64 * progress)
        .round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(id: &str, intensity: i64, cct: i64, on: bool) -> LightingEditorSceneFixtureState {
        LightingEditorSceneFixtureState {
            fixture_id: id.to_string(),
            intensity,
            cct,
            on,
        }
    }

    #[test]
    fn recall_with_fade_interpolates_intensity() {
        let sampled = sample_lighting_fade_state(
            &state("fixture-key", 20, 3200, true),
            &state("fixture-key", 80, 3200, true),
            0.5,
        );

        assert_eq!(sampled.intensity, 50);
        assert_eq!(sampled.cct, 3200);
        assert!(sampled.on);
    }

    #[test]
    fn recall_with_fade_correlates_cct_pair() {
        let sampled = sample_lighting_fade_state(
            &state("fixture-key", 0, 3200, false),
            &state("fixture-key", 100, 5600, true),
            0.5,
        );

        assert_eq!(sampled.intensity, 50);
        assert_eq!(sampled.cct, 4400);
        assert!(sampled.on);
    }

    #[test]
    fn recall_mid_fade_cancels_and_restarts_from_sample() {
        let first_sample = sample_lighting_fade_state(
            &state("fixture-key", 0, 3200, false),
            &state("fixture-key", 100, 5600, true),
            0.25,
        );
        let restarted = sample_lighting_fade_state(
            &first_sample,
            &state("fixture-key", 40, 4000, true),
            0.5,
        );

        assert_eq!(first_sample.intensity, 25);
        assert_eq!(first_sample.cct, 3800);
        assert_eq!(restarted.intensity, 33);
        assert_eq!(restarted.cct, 3900);
    }

    #[test]
    fn recall_fade_zero_is_snap_behavior() {
        let sampled = sample_lighting_fade_state(
            &state("fixture-key", 10, 3200, true),
            &state("fixture-key", 90, 5600, true),
            fade_progress(10_000, 10_000, 0),
        );

        assert_eq!(sampled.intensity, 90);
        assert_eq!(sampled.cct, 5600);
        assert!(sampled.on);
    }
}
