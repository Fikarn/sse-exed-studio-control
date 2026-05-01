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
    validate_dmx_start_address(
        editor_state.fixtures.as_slice(),
        &request.fixture_type,
        request.dmx_start_address,
        None,
    )?;

    let fixture = LightingEditorFixtureState {
        id: next_custom_fixture_id(editor_state.fixtures.as_slice()),
        name: request.name.clone(),
        fixture_type: request.fixture_type.clone(),
        dmx_start_address: request.dmx_start_address,
        kind: lighting_kind_for_type(&request.fixture_type),
        group_id: request.group_id.clone(),
        spatial_x: None,
        spatial_y: None,
        spatial_rotation: 0.0,
        rig_z: None,
        beam_angle_degrees: None,
        intensity: DEFAULT_FIXTURE_INTENSITY,
        cct: default_fixture_cct_for_type(&request.fixture_type),
        on: false,
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
    let next_dmx_start_address = request
        .dmx_start_address
        .unwrap_or(existing_fixture.dmx_start_address);
    validate_dmx_start_address(
        editor_state.fixtures.as_slice(),
        &next_fixture_type,
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
            fixture.kind = lighting_kind_for_type(fixture_type);
            let default_cct = default_fixture_cct_for_type(fixture_type);
            fixture.cct = clamp_cct_for_type(fixture.cct, fixture_type, default_cct);
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
            let default_cct = default_fixture_cct_for_type(&fixture.fixture_type);
            fixture.cct = clamp_cct_for_type(cct, &fixture.fixture_type, default_cct);
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
