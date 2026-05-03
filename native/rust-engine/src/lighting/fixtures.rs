use std::path::Path;

use super::editor_state::*;
use super::fade::{apply_active_fade_sample, clear_active_fade, remove_fixture_from_active_fade};
use super::helpers::*;
use super::identify::current_unix_ms;
use super::types::*;
use super::*;

pub fn create_lighting_fixture(
    db_path: &Path,
    request: &LightingFixtureCreateRequest,
) -> Result<LightingFixtureCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);

    validate_group_exists(editor_state.groups.as_slice(), request.group_id.as_deref())?;
    let profile = resolve_fixture_profile(
        Some(request.definition_id.as_str()),
        Some(request.mode_id.as_str()),
        Some(request.fixture_type.as_str()),
        None,
        "",
    );
    validate_dmx_start_address(
        editor_state.fixtures.as_slice(),
        &profile,
        request.universe,
        request.dmx_start_address,
        None,
    )?;

    let fixture = LightingEditorFixtureState {
        id: next_custom_fixture_id(editor_state.fixtures.as_slice()),
        name: request.name.clone(),
        fixture_type: request.fixture_type.clone(),
        definition_id: Some(profile.definition_id.clone()),
        mode_id: Some(profile.mode_id.clone()),
        universe: request.universe,
        dmx_start_address: request.dmx_start_address,
        kind: profile.kind.clone(),
        group_id: request.group_id.clone(),
        spatial_x: None,
        spatial_y: None,
        spatial_rotation: 0.0,
        rig_z: None,
        beam_angle_degrees: None,
        intensity: DEFAULT_FIXTURE_INTENSITY,
        cct: fixture_default_cct(&profile),
        on: false,
        control_values: normalize_fixture_control_values(&profile, &Default::default()),
        effect: None,
    };
    append_fixture_to_scenes(&mut editor_state.scenes, &fixture);
    editor_state.fixtures.push(fixture.clone());
    editor_state
        .removed_fixture_ids
        .retain(|fixture_id| fixture_id != &fixture.id);

    let summary = format!(
        "Lighting fixture '{}' was created as {} on DMX {}.",
        fixture.name, fixture.fixture_type, fixture.dmx_start_address
    );
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingFixtureCreateResult {
        fixture: lighting_fixture_snapshot_from_state(fixture),
        summary,
    })
}

pub fn update_lighting_fixture(
    db_path: &Path,
    request: &LightingFixtureUpdateRequest,
) -> Result<LightingFixtureUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    apply_active_fade_sample(&mut editor_state, current_unix_ms());
    validate_group_exists(
        editor_state.groups.as_slice(),
        request
            .group_id
            .as_ref()
            .and_then(|group_id| group_id.as_deref()),
    )?;

    let existing_fixture = editor_state
        .fixtures
        .iter()
        .find(|entry| entry.id == request.fixture_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    request.fixture_id
                ),
            )
        })?;
    let next_fixture_type = request
        .fixture_type
        .clone()
        .unwrap_or_else(|| existing_fixture.fixture_type.clone());
    let next_definition_id = if let Some(definition_id) = &request.definition_id {
        definition_id.clone()
    } else if request.fixture_type.is_some() {
        resolve_fixture_profile(
            None,
            None,
            Some(next_fixture_type.as_str()),
            Some(existing_fixture.kind.as_str()),
            existing_fixture.id.as_str(),
        )
        .definition_id
    } else {
        existing_fixture.definition_id.clone().unwrap_or_else(|| {
            resolve_fixture_profile(
                None,
                None,
                Some(next_fixture_type.as_str()),
                Some(existing_fixture.kind.as_str()),
                existing_fixture.id.as_str(),
            )
            .definition_id
        })
    };
    let next_mode_id = if let Some(mode_id) = &request.mode_id {
        mode_id.clone()
    } else if request.definition_id.is_some() || request.fixture_type.is_some() {
        resolve_fixture_profile(
            Some(next_definition_id.as_str()),
            None,
            Some(next_fixture_type.as_str()),
            Some(existing_fixture.kind.as_str()),
            existing_fixture.id.as_str(),
        )
        .mode_id
    } else {
        existing_fixture.mode_id.clone().unwrap_or_else(|| {
            resolve_fixture_profile(
                Some(next_definition_id.as_str()),
                None,
                Some(next_fixture_type.as_str()),
                Some(existing_fixture.kind.as_str()),
                existing_fixture.id.as_str(),
            )
            .mode_id
        })
    };
    let next_universe = request.universe.unwrap_or(existing_fixture.universe);
    let next_profile = resolve_fixture_profile(
        Some(next_definition_id.as_str()),
        Some(next_mode_id.as_str()),
        Some(next_fixture_type.as_str()),
        Some(existing_fixture.kind.as_str()),
        existing_fixture.id.as_str(),
    );
    let next_dmx_start_address = request
        .dmx_start_address
        .unwrap_or(existing_fixture.dmx_start_address);
    validate_dmx_start_address(
        editor_state.fixtures.as_slice(),
        &next_profile,
        next_universe,
        next_dmx_start_address,
        Some(request.fixture_id.as_str()),
    )?;

    let updated_fixture = {
        let fixture = editor_state
            .fixtures
            .iter_mut()
            .find(|entry| entry.id == request.fixture_id)
            .expect("fixture presence already validated");

        if let Some(name) = &request.name {
            fixture.name = name.clone();
        }
        if let Some(fixture_type) = &request.fixture_type {
            fixture.fixture_type = fixture_type.clone();
        }
        if request.definition_id.is_some()
            || request.mode_id.is_some()
            || request.fixture_type.is_some()
        {
            fixture.definition_id = Some(next_profile.definition_id.clone());
            fixture.mode_id = Some(next_profile.mode_id.clone());
            fixture.kind = next_profile.kind.clone();
            let default_cct = fixture_default_cct(&next_profile);
            let (min_cct, max_cct) = fixture_cct_range_from_profile(&next_profile);
            fixture.cct = clamp_i64(
                if fixture.cct == 0 {
                    default_cct
                } else {
                    fixture.cct
                },
                min_cct,
                max_cct,
            );
            fixture.control_values =
                normalize_fixture_control_values(&next_profile, &fixture.control_values);
        }
        if let Some(universe) = request.universe {
            fixture.universe = universe;
        }
        if let Some(dmx_start_address) = request.dmx_start_address {
            fixture.dmx_start_address = dmx_start_address;
        }
        if let Some(effect) = &request.effect {
            fixture.effect = effect.clone().map(normalize_lighting_effect);
        }

        if let Some(on) = request.on {
            fixture.on = on;
        }
        if let Some(intensity) = request.intensity {
            fixture.intensity = clamp_i64(intensity, 0, 100);
        }
        if let Some(cct) = request.cct {
            let profile = fixture_profile_for_state(fixture);
            let default_cct = fixture_default_cct(&profile);
            let (min_cct, max_cct) = fixture_cct_range_from_profile(&profile);
            fixture.cct = clamp_i64(if cct == 0 { default_cct } else { cct }, min_cct, max_cct);
        }
        if let Some(control_values) = &request.control_values {
            let profile = fixture_profile_for_state(fixture);
            fixture.control_values = normalize_fixture_control_values(&profile, control_values);
        }
        if let Some(group_id) = &request.group_id {
            fixture.group_id = group_id.clone();
        }
        if let Some(spatial_x) = request.spatial_x {
            fixture.spatial_x = spatial_x;
        }
        if let Some(spatial_y) = request.spatial_y {
            fixture.spatial_y = spatial_y;
        }
        if let Some(spatial_rotation) = request.spatial_rotation {
            fixture.spatial_rotation = normalize_rotation(spatial_rotation);
        }
        if let Some(rig_z) = request.rig_z {
            fixture.rig_z = rig_z;
        }
        if let Some(beam_angle_degrees) = request.beam_angle_degrees {
            fixture.beam_angle_degrees = beam_angle_degrees;
        }

        fixture.clone()
    };
    remove_fixture_from_active_fade(&mut editor_state, request.fixture_id.as_str());
    let summary = lighting_fixture_update_summary(&updated_fixture);
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingFixtureUpdateResult {
        fixture: lighting_fixture_snapshot_from_state(updated_fixture),
        source: String::from("live"),
        summary,
    })
}

pub fn set_lighting_all_power(
    db_path: &Path,
    request: &LightingAllPowerRequest,
) -> Result<LightingAllPowerResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    apply_active_fade_sample(&mut editor_state, current_unix_ms());
    let affected_fixtures = editor_state.fixtures.len();

    if affected_fixtures == 0 {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_FIXTURES_EMPTY",
            String::from("No lighting fixtures are exposed by the native editor state."),
        ));
    }

    for fixture in &mut editor_state.fixtures {
        fixture.on = request.on;
    }
    clear_active_fade(&mut editor_state);

    let summary = format!(
        "All native lighting fixtures set {} across {} fixtures.",
        if request.on { "on" } else { "off" },
        affected_fixtures
    );
    let mut updates = lighting_editor_state_updates(&editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingAllPowerResult {
        affected_fixtures,
        summary,
    })
}

pub fn delete_lighting_fixture(
    db_path: &Path,
    request: &LightingFixtureDeleteRequest,
) -> Result<LightingFixtureDeleteResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let config = resolve_lighting_config(&app_settings);
    let inventory = read_lighting_editor_inventory(&config);
    let mut editor_state =
        load_lighting_editor_state_with_inventory(&app_settings, &config, &inventory);

    let deleted_fixture = editor_state
        .fixtures
        .iter()
        .find(|fixture| fixture.id == request.fixture_id)
        .cloned()
        .ok_or_else(|| {
            LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    request.fixture_id
                ),
            )
        })?;

    editor_state
        .fixtures
        .retain(|fixture| fixture.id != request.fixture_id);
    remove_fixture_from_scenes(&mut editor_state.scenes, request.fixture_id.as_str());
    if inventory
        .fixtures
        .iter()
        .any(|fixture| fixture.id == request.fixture_id)
        && !editor_state
            .removed_fixture_ids
            .iter()
            .any(|fixture_id| fixture_id == &request.fixture_id)
    {
        editor_state
            .removed_fixture_ids
            .push(request.fixture_id.clone());
    }

    let mut updates = lighting_editor_state_updates(&editor_state)?;
    if read_optional_setting(&app_settings, LIGHTING_SELECTED_FIXTURE_ID_KEY).as_deref()
        == Some(request.fixture_id.as_str())
    {
        updates.push((
            String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
            String::new(),
        ));
    }
    let summary = format!("Lighting fixture '{}' was deleted.", deleted_fixture.name);
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            summary.clone(),
        ),
    ]);
    persist_lighting_state(db_path, &updates)?;

    Ok(LightingFixtureDeleteResult {
        deleted: true,
        fixture_id: request.fixture_id.clone(),
        summary,
    })
}
