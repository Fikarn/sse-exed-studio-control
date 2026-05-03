use serde_json::Value;
use std::collections::HashMap;

use super::fixture_catalog::{
    fixture_type_for_definition, normalized_catalog_id, resolve_fixture_profile,
};
use super::helpers::*;
use super::types::{
    FixtureHighlightMode, LightingAllPowerRequest, LightingEditorSceneFixtureState, LightingEffect,
    LightingFixtureCreateRequest, LightingFixtureDeleteRequest, LightingFixtureHighlightRequest,
    LightingFixtureIdentifyClearAllRequest, LightingFixtureIdentifyRequest,
    LightingFixtureIdentifySequenceRequest, LightingFixtureUpdateRequest,
    LightingGroupCreateRequest, LightingGroupDeleteRequest, LightingGroupPowerRequest,
    LightingGroupReorderRequest, LightingGroupUpdateRequest, LightingPaletteApplyRequest,
    LightingPaletteCreateRequest, LightingPaletteDeleteRequest, LightingPaletteKind,
    LightingPaletteUpdateRequest, LightingPreviewDiscardRequest, LightingPreviewModeRequest,
    LightingSceneCreateRequest, LightingSceneDeleteRequest, LightingScenePinRequest,
    LightingSceneRecallRequest, LightingSceneReorderRequest, LightingSceneUpdateRequest,
    LightingSettingsUpdateRequest, LightingSpatialMarker,
};
use super::{MAX_FIXTURE_CCT, MIN_FIXTURE_CCT};

pub fn parse_lighting_scene_recall_request(
    params: &Value,
) -> Result<LightingSceneRecallRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    let fade_duration_seconds = if let Some(value) = params.get("fadeMs") {
        let fade_ms = value
            .as_f64()
            .ok_or_else(|| String::from("fadeMs must be a number"))?;
        fade_ms / 1000.0
    } else {
        params
            .get("fadeDurationSeconds")
            .map(|value| {
                value
                    .as_f64()
                    .ok_or_else(|| String::from("fadeDurationSeconds must be a number"))
            })
            .transpose()?
            .unwrap_or(0.0)
    };

    if !(0.0..=10.0).contains(&fade_duration_seconds) {
        return Err(String::from(
            "fadeDurationSeconds/fadeMs must be between 0 and 10 seconds",
        ));
    }

    Ok(LightingSceneRecallRequest {
        scene_id: String::from(scene_id),
        fade_duration_seconds,
    })
}

pub fn parse_lighting_preview_mode_request(
    params: &Value,
) -> Result<LightingPreviewModeRequest, String> {
    let enabled = params
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| String::from("enabled must be a boolean"))?;
    let patch_mode_active = params
        .get("patchModeActive")
        .or_else(|| params.get("patchMode"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Ok(LightingPreviewModeRequest {
        enabled,
        patch_mode_active,
    })
}

pub fn parse_lighting_preview_discard_request(
    _params: &Value,
) -> Result<LightingPreviewDiscardRequest, String> {
    Ok(LightingPreviewDiscardRequest)
}

pub fn parse_lighting_fixture_create_request(
    params: &Value,
) -> Result<LightingFixtureCreateRequest, String> {
    let (definition_id, mode_id, fixture_type) = parse_fixture_identity(
        params.get("definitionId"),
        params.get("modeId"),
        params.get("type"),
        true,
    )?;
    let universe = params
        .get("universe")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 1, 63999))
        .unwrap_or(super::DEFAULT_UNIVERSE);
    let dmx_start_address = parse_required_fixture_dmx_start_address(
        params.get("dmxStartAddress"),
        &definition_id,
        &mode_id,
        &fixture_type,
    )?;
    let group_id = params
        .get("groupId")
        .map(parse_optional_group_id)
        .transpose()?
        .unwrap_or(None);

    Ok(LightingFixtureCreateRequest {
        name: parse_required_fixture_name(params.get("name"))?,
        fixture_type,
        definition_id,
        mode_id,
        universe,
        dmx_start_address,
        group_id,
    })
}

pub fn parse_lighting_fixture_update_request(
    params: &Value,
) -> Result<LightingFixtureUpdateRequest, String> {
    let fixture_id = params
        .get("fixtureId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("fixtureId is required"))?;
    let name = params
        .get("name")
        .map(|value| parse_required_fixture_name(Some(value)))
        .transpose()?;
    let fixture_type = params
        .get("type")
        .map(|value| parse_required_fixture_type(Some(value)))
        .transpose()?;
    let definition_id = params
        .get("definitionId")
        .map(parse_required_definition_id)
        .transpose()?;
    let mode_id = params
        .get("modeId")
        .map(parse_required_mode_id)
        .transpose()?;
    let universe = params
        .get("universe")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 1, 63999));
    let dmx_start_address = params
        .get("dmxStartAddress")
        .map(parse_positive_i64_value)
        .transpose()?;
    let effect = params
        .get("effect")
        .map(|value| parse_optional_effect(value, "effect"))
        .transpose()?;

    let on = params
        .get("on")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("on must be a boolean"))
        })
        .transpose()?;

    let intensity = params
        .get("intensity")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 0, 100));

    let cct = params.get("cct").map(parse_i64_value).transpose()?;
    let control_values = params
        .get("controlValues")
        .map(parse_control_values)
        .transpose()?;

    let group_id = params
        .get("groupId")
        .map(parse_optional_group_id)
        .transpose()?;
    let spatial_x = params
        .get("spatialX")
        .map(|value| parse_optional_spatial_coordinate(value, "spatialX"))
        .transpose()?;
    let spatial_y = params
        .get("spatialY")
        .map(|value| parse_optional_spatial_coordinate(value, "spatialY"))
        .transpose()?;
    let spatial_rotation = params
        .get("spatialRotation")
        .map(|value| parse_spatial_rotation_value(value, "spatialRotation"))
        .transpose()?;
    let rig_z = params.get("rigZ").map(parse_optional_rig_z).transpose()?;
    let beam_angle_degrees = params
        .get("beamAngleDegrees")
        .map(parse_optional_beam_angle_degrees)
        .transpose()?;

    if on.is_none()
        && name.is_none()
        && fixture_type.is_none()
        && definition_id.is_none()
        && mode_id.is_none()
        && universe.is_none()
        && dmx_start_address.is_none()
        && effect.is_none()
        && intensity.is_none()
        && cct.is_none()
        && control_values.is_none()
        && group_id.is_none()
        && spatial_x.is_none()
        && spatial_y.is_none()
        && spatial_rotation.is_none()
        && rig_z.is_none()
        && beam_angle_degrees.is_none()
    {
        return Err(String::from(
            "lighting.fixture.update requires one or more supported fields",
        ));
    }

    Ok(LightingFixtureUpdateRequest {
        fixture_id: String::from(fixture_id),
        name,
        fixture_type,
        definition_id,
        mode_id,
        universe,
        dmx_start_address,
        effect,
        on,
        intensity,
        cct,
        control_values,
        group_id,
        spatial_x,
        spatial_y,
        spatial_rotation,
        rig_z,
        beam_angle_degrees,
    })
}

pub fn parse_lighting_fixture_delete_request(
    params: &Value,
) -> Result<LightingFixtureDeleteRequest, String> {
    let fixture_id = params
        .get("fixtureId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("fixtureId is required"))?;

    Ok(LightingFixtureDeleteRequest {
        fixture_id: String::from(fixture_id),
    })
}

pub fn parse_lighting_fixture_identify_request(
    params: &Value,
) -> Result<LightingFixtureIdentifyRequest, String> {
    let fixture_id = params
        .get("fixtureId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("fixtureId is required"))?;

    let duration_ms = match params.get("durationMs") {
        Some(value) if value.is_null() => None,
        Some(value) => Some(
            value
                .as_i64()
                .ok_or_else(|| String::from("durationMs must be a number"))?,
        ),
        None => None,
    };

    Ok(LightingFixtureIdentifyRequest {
        fixture_id: String::from(fixture_id),
        duration_ms,
    })
}

pub fn parse_lighting_fixture_highlight_request(
    params: &Value,
) -> Result<LightingFixtureHighlightRequest, String> {
    let mode = params
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| String::from("mode is required"))?;
    let mode = match mode {
        "highlight" => FixtureHighlightMode::Highlight,
        "solo" => FixtureHighlightMode::Solo,
        "off" => FixtureHighlightMode::Off,
        _ => {
            return Err(String::from(
                "mode must be one of \"highlight\", \"solo\", or \"off\"",
            ))
        }
    };

    let fixture_ids = parse_fixture_id_array(params.get("fixtureIds"), "fixtureIds")?;

    Ok(LightingFixtureHighlightRequest { fixture_ids, mode })
}

pub fn parse_lighting_fixture_identify_sequence_request(
    params: &Value,
) -> Result<LightingFixtureIdentifySequenceRequest, String> {
    let fixture_ids = parse_fixture_id_array(params.get("fixtureIds"), "fixtureIds")?;
    if fixture_ids.is_empty() {
        return Err(String::from("fixtureIds must contain at least one id"));
    }

    let step_ms = params
        .get("stepMs")
        .map(parse_i64_value)
        .transpose()?
        .ok_or_else(|| String::from("stepMs is required"))?;
    let duration_ms = params
        .get("durationMs")
        .map(parse_i64_value)
        .transpose()?
        .ok_or_else(|| String::from("durationMs is required"))?;

    Ok(LightingFixtureIdentifySequenceRequest {
        fixture_ids,
        step_ms,
        duration_ms,
    })
}

pub fn parse_lighting_fixture_identify_clear_all_request(
    _params: &Value,
) -> Result<LightingFixtureIdentifyClearAllRequest, String> {
    Ok(LightingFixtureIdentifyClearAllRequest)
}

fn parse_fixture_id_array(value: Option<&Value>, field: &str) -> Result<Vec<String>, String> {
    let array = value
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{field} must be an array of strings"))?;
    let mut ids = Vec::with_capacity(array.len());
    for entry in array {
        let id = entry
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("{field} entries must be non-empty strings"))?;
        ids.push(String::from(id));
    }
    Ok(ids)
}

fn dedupe_string_ids(ids: &mut Vec<String>) {
    let mut seen = Vec::with_capacity(ids.len());
    ids.retain(|id| {
        if seen.iter().any(|seen_id| seen_id == id) {
            false
        } else {
            seen.push(id.clone());
            true
        }
    });
}

pub fn parse_lighting_group_power_request(
    params: &Value,
) -> Result<LightingGroupPowerRequest, String> {
    let group_id = params
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("groupId is required"))?;

    let on = params
        .get("on")
        .and_then(Value::as_bool)
        .ok_or_else(|| String::from("on must be a boolean"))?;

    Ok(LightingGroupPowerRequest {
        group_id: String::from(group_id),
        on,
    })
}

pub fn parse_lighting_all_power_request(params: &Value) -> Result<LightingAllPowerRequest, String> {
    let on = params
        .get("on")
        .and_then(Value::as_bool)
        .ok_or_else(|| String::from("on must be a boolean"))?;

    Ok(LightingAllPowerRequest { on })
}

pub fn parse_lighting_group_create_request(
    params: &Value,
) -> Result<LightingGroupCreateRequest, String> {
    let name = parse_required_group_name(params.get("name"))?;
    Ok(LightingGroupCreateRequest { name })
}

pub fn parse_lighting_group_update_request(
    params: &Value,
) -> Result<LightingGroupUpdateRequest, String> {
    let group_id = params
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("groupId is required"))?;
    let name = params
        .get("name")
        .map(|value| parse_required_group_name(Some(value)))
        .transpose()?;
    let color_index = params
        .get("colorIndex")
        .map(parse_optional_color_index)
        .transpose()?;

    if name.is_none() && color_index.is_none() {
        return Err(String::from(
            "lighting.group.update requires a name or colorIndex",
        ));
    }

    Ok(LightingGroupUpdateRequest {
        group_id: String::from(group_id),
        name,
        color_index,
    })
}

pub fn parse_lighting_palette_create_request(
    params: &Value,
) -> Result<LightingPaletteCreateRequest, String> {
    let name = parse_required_palette_name(params.get("name"))?;
    let kind = parse_required_palette_kind(params.get("kind"))?;
    let value = parse_required_palette_value(params.get("value"), kind)?;
    let color_index = params
        .get("colorIndex")
        .map(parse_optional_color_index)
        .transpose()?
        .unwrap_or(None);

    Ok(LightingPaletteCreateRequest {
        name,
        kind,
        value,
        color_index,
    })
}

pub fn parse_lighting_palette_update_request(
    params: &Value,
) -> Result<LightingPaletteUpdateRequest, String> {
    let palette_id = params
        .get("paletteId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("paletteId is required"))?;
    if params.get("kind").is_some() {
        return Err(String::from("lighting.palette.update cannot change kind"));
    }
    let name = params
        .get("name")
        .map(|value| parse_required_palette_name(Some(value)))
        .transpose()?;
    let value = params
        .get("value")
        .map(parse_finite_palette_value)
        .transpose()?;
    let color_index = params
        .get("colorIndex")
        .map(parse_optional_color_index)
        .transpose()?;
    let before_palette_id = match params.get("beforePaletteId") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Some(None)
            } else if trimmed == palette_id {
                return Err(String::from("beforePaletteId must differ from paletteId"));
            } else {
                Some(Some(String::from(trimmed)))
            }
        }
        Some(_) => return Err(String::from("beforePaletteId must be a string or null")),
    };

    if name.is_none() && value.is_none() && color_index.is_none() && before_palette_id.is_none() {
        return Err(String::from(
            "lighting.palette.update requires a name, value, colorIndex, or beforePaletteId",
        ));
    }

    Ok(LightingPaletteUpdateRequest {
        palette_id: String::from(palette_id),
        name,
        value,
        color_index,
        before_palette_id,
    })
}

pub fn parse_lighting_palette_delete_request(
    params: &Value,
) -> Result<LightingPaletteDeleteRequest, String> {
    let palette_id = params
        .get("paletteId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("paletteId is required"))?;

    Ok(LightingPaletteDeleteRequest {
        palette_id: String::from(palette_id),
    })
}

pub fn parse_lighting_palette_apply_request(
    params: &Value,
) -> Result<LightingPaletteApplyRequest, String> {
    let palette_id = params
        .get("paletteId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("paletteId is required"))?;
    let mut fixture_ids = parse_fixture_id_array(params.get("fixtureIds"), "fixtureIds")?;
    dedupe_string_ids(&mut fixture_ids);
    if fixture_ids.is_empty() {
        return Err(String::from("fixtureIds must contain at least one id"));
    }
    let patch_mode_active = params
        .get("patchModeActive")
        .or_else(|| params.get("patchMode"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Ok(LightingPaletteApplyRequest {
        palette_id: String::from(palette_id),
        fixture_ids,
        patch_mode_active,
    })
}

pub fn parse_lighting_group_delete_request(
    params: &Value,
) -> Result<LightingGroupDeleteRequest, String> {
    let group_id = params
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("groupId is required"))?;

    Ok(LightingGroupDeleteRequest {
        group_id: String::from(group_id),
    })
}

pub fn parse_lighting_settings_update_request(
    params: &Value,
) -> Result<LightingSettingsUpdateRequest, String> {
    let enabled = params
        .get("enabled")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("enabled must be a boolean"))
        })
        .transpose()?;
    let bridge_ip = params
        .get("bridgeIp")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| String::from("bridgeIp must be a string"))
                .map(|text| text.trim().to_string())
        })
        .transpose()?;
    let universe = params
        .get("universe")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 1, 63999));
    let grand_master = params
        .get("grandMaster")
        .map(parse_i64_value)
        .transpose()?
        .map(|value| clamp_i64(value, 0, 100));
    let selected_scene_id = params
        .get("selectedSceneId")
        .map(|value| parse_optional_trimmed_string_or_null(value, "selectedSceneId"))
        .transpose()?;
    let selected_fixture_id = params
        .get("selectedFixtureId")
        .map(|value| parse_optional_trimmed_string_or_null(value, "selectedFixtureId"))
        .transpose()?;
    let camera_marker = params
        .get("cameraMarker")
        .map(|value| parse_optional_spatial_marker(value, "cameraMarker"))
        .transpose()?;
    let subject_marker = params
        .get("subjectMarker")
        .map(|value| parse_optional_spatial_marker(value, "subjectMarker"))
        .transpose()?;

    if enabled.is_none()
        && bridge_ip.is_none()
        && universe.is_none()
        && grand_master.is_none()
        && selected_scene_id.is_none()
        && selected_fixture_id.is_none()
        && camera_marker.is_none()
        && subject_marker.is_none()
    {
        return Err(String::from(
            "lighting.settings.update requires one or more supported fields",
        ));
    }

    Ok(LightingSettingsUpdateRequest {
        enabled,
        bridge_ip,
        universe,
        grand_master,
        selected_scene_id,
        selected_fixture_id,
        camera_marker,
        subject_marker,
    })
}

pub fn parse_lighting_scene_create_request(
    params: &Value,
) -> Result<LightingSceneCreateRequest, String> {
    let name = parse_required_scene_name(params.get("name"))?;
    let fixture_states = params
        .get("fixtureStates")
        .map(parse_lighting_scene_fixture_states)
        .transpose()?;
    let color_index = params
        .get("colorIndex")
        .map(parse_optional_color_index)
        .transpose()?
        .unwrap_or(None);
    Ok(LightingSceneCreateRequest {
        name,
        fixture_states,
        color_index,
    })
}

fn parse_lighting_scene_fixture_states(
    value: &Value,
) -> Result<Vec<LightingEditorSceneFixtureState>, String> {
    let entries = value
        .as_array()
        .ok_or_else(|| String::from("fixtureStates must be an array"))?;
    let mut fixture_states = Vec::with_capacity(entries.len());
    for entry in entries {
        let object = entry
            .as_object()
            .ok_or_else(|| String::from("fixtureStates entries must be objects"))?;
        let fixture_id = object
            .get("fixtureId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| String::from("fixtureStates.fixtureId is required"))?;
        let intensity = parse_i64_value(
            object
                .get("intensity")
                .ok_or_else(|| String::from("fixtureStates.intensity is required"))?,
        )?;
        if !(0..=100).contains(&intensity) {
            return Err(String::from(
                "fixtureStates.intensity must be between 0 and 100",
            ));
        }
        let cct = parse_i64_value(
            object
                .get("cct")
                .ok_or_else(|| String::from("fixtureStates.cct is required"))?,
        )?;
        if !(MIN_FIXTURE_CCT..=MAX_FIXTURE_CCT).contains(&cct) {
            return Err(format!(
                "fixtureStates.cct must be between {MIN_FIXTURE_CCT} and {MAX_FIXTURE_CCT}"
            ));
        }
        let on = object
            .get("on")
            .and_then(Value::as_bool)
            .ok_or_else(|| String::from("fixtureStates.on must be a boolean"))?;
        let control_values = object
            .get("controlValues")
            .map(parse_control_values)
            .transpose()?
            .unwrap_or_default();
        fixture_states.push(LightingEditorSceneFixtureState {
            fixture_id: String::from(fixture_id),
            intensity,
            cct,
            on,
            control_values,
        });
    }
    Ok(fixture_states)
}

pub fn parse_lighting_scene_update_request(
    params: &Value,
) -> Result<LightingSceneUpdateRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    let name = params
        .get("name")
        .map(|value| parse_required_scene_name(Some(value)))
        .transpose()?;
    let capture_current_state = params
        .get("captureCurrentState")
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| String::from("captureCurrentState must be a boolean"))
        })
        .transpose()?
        .unwrap_or(false);
    let color_index = params
        .get("colorIndex")
        .map(parse_optional_color_index)
        .transpose()?;

    if name.is_none() && !capture_current_state && color_index.is_none() {
        return Err(String::from(
            "lighting.scene.update requires a name, captureCurrentState, or colorIndex",
        ));
    }

    Ok(LightingSceneUpdateRequest {
        scene_id: String::from(scene_id),
        name,
        capture_current_state,
        color_index,
    })
}

pub fn parse_lighting_scene_delete_request(
    params: &Value,
) -> Result<LightingSceneDeleteRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    Ok(LightingSceneDeleteRequest {
        scene_id: String::from(scene_id),
    })
}

pub fn parse_lighting_scene_reorder_request(
    params: &Value,
) -> Result<LightingSceneReorderRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    // beforeSceneId is optional — null / missing means "move to end".
    let before_scene_id = match params.get("beforeSceneId") {
        Some(Value::Null) | None => None,
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else if trimmed == scene_id {
                return Err(String::from("beforeSceneId must differ from sceneId"));
            } else {
                Some(String::from(trimmed))
            }
        }
        _ => return Err(String::from("beforeSceneId must be a string or null")),
    };

    Ok(LightingSceneReorderRequest {
        scene_id: String::from(scene_id),
        before_scene_id,
    })
}

pub fn parse_lighting_group_reorder_request(
    params: &Value,
) -> Result<LightingGroupReorderRequest, String> {
    let group_id = params
        .get("groupId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("groupId is required"))?;

    // beforeGroupId is optional — null / missing means "move to end".
    let before_group_id = match params.get("beforeGroupId") {
        Some(Value::Null) | None => None,
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else if trimmed == group_id {
                return Err(String::from("beforeGroupId must differ from groupId"));
            } else {
                Some(String::from(trimmed))
            }
        }
        _ => return Err(String::from("beforeGroupId must be a string or null")),
    };

    Ok(LightingGroupReorderRequest {
        group_id: String::from(group_id),
        before_group_id,
    })
}

pub fn parse_lighting_scene_pin_request(params: &Value) -> Result<LightingScenePinRequest, String> {
    let scene_id = params
        .get("sceneId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("sceneId is required"))?;

    let pinned = params
        .get("pinned")
        .and_then(Value::as_bool)
        .ok_or_else(|| String::from("pinned must be a boolean"))?;

    Ok(LightingScenePinRequest {
        scene_id: String::from(scene_id),
        pinned,
    })
}

pub(super) fn parse_required_scene_name(value: Option<&Value>) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("name is required"))
}

pub(super) fn parse_required_group_name(value: Option<&Value>) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("name is required"))
}

pub(super) fn parse_required_fixture_name(value: Option<&Value>) -> Result<String, String> {
    let name = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("name is required"))?;
    if name.len() > 50 {
        return Err(String::from("name must be 50 characters or fewer"));
    }
    Ok(name)
}

pub(super) fn parse_required_palette_name(value: Option<&Value>) -> Result<String, String> {
    let name = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("name is required"))?;
    if name.len() > 50 {
        return Err(String::from("name must be 50 characters or fewer"));
    }
    Ok(name)
}

pub(super) fn parse_required_palette_kind(
    value: Option<&Value>,
) -> Result<LightingPaletteKind, String> {
    match value.and_then(Value::as_str).map(str::trim) {
        Some("intensity") => Ok(LightingPaletteKind::Intensity),
        Some("cct") => Ok(LightingPaletteKind::Cct),
        _ => Err(String::from("kind must be one of intensity or cct")),
    }
}

pub(super) fn parse_required_palette_value(
    value: Option<&Value>,
    kind: LightingPaletteKind,
) -> Result<f64, String> {
    let parsed = value
        .ok_or_else(|| String::from("value is required"))
        .and_then(parse_finite_palette_value)?;
    let (min, max, label) = match kind {
        LightingPaletteKind::Intensity => (0.0, 100.0, "intensity"),
        LightingPaletteKind::Cct => (MIN_FIXTURE_CCT as f64, MAX_FIXTURE_CCT as f64, "CCT"),
    };
    if !(min..=max).contains(&parsed) {
        return Err(format!(
            "value for {label} palettes must be between {min:.0} and {max:.0}"
        ));
    }
    Ok(parsed)
}

pub(super) fn parse_finite_palette_value(value: &Value) -> Result<f64, String> {
    let parsed = value
        .as_f64()
        .ok_or_else(|| String::from("value must be a finite number"))?;
    if !parsed.is_finite() {
        return Err(String::from("value must be a finite number"));
    }
    Ok(parsed)
}

pub(super) fn parse_required_fixture_type(value: Option<&Value>) -> Result<String, String> {
    let fixture_type = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("type is required"))?;

    validate_fixture_type(fixture_type)
        .ok_or_else(|| String::from("type must resolve to a known fixture catalog entry"))
}

pub(super) fn parse_required_fixture_dmx_start_address(
    value: Option<&Value>,
    definition_id: &str,
    mode_id: &str,
    fixture_type: &str,
) -> Result<i64, String> {
    let dmx_start_address = value
        .ok_or_else(|| String::from("dmxStartAddress is required"))
        .and_then(parse_positive_i64_value)?;
    let profile = resolve_fixture_profile(
        Some(definition_id),
        Some(mode_id),
        Some(fixture_type),
        None,
        "",
    );
    if profile.channel_count <= 0 {
        return Ok(0);
    }
    let max_start = 512 - profile.channel_count + 1;
    if !(1..=max_start).contains(&dmx_start_address) {
        return Err(format!(
            "dmxStartAddress must be between 1 and {} for definition '{}' mode '{}'",
            max_start, definition_id, mode_id
        ));
    }
    Ok(dmx_start_address)
}

fn parse_fixture_identity(
    definition_value: Option<&Value>,
    mode_value: Option<&Value>,
    type_value: Option<&Value>,
    required: bool,
) -> Result<(String, String, String), String> {
    let definition_id = definition_value
        .map(parse_required_definition_id)
        .transpose()?;
    let fixture_type = type_value
        .map(|value| parse_required_fixture_type(Some(value)))
        .transpose()?;
    if required && definition_id.is_none() && fixture_type.is_none() {
        return Err(String::from("definitionId or type is required"));
    }
    let mode_id = mode_value.map(parse_required_mode_id).transpose()?;
    let profile = resolve_fixture_profile(
        definition_id.as_deref(),
        mode_id.as_deref(),
        fixture_type.as_deref(),
        None,
        "",
    );
    let fixture_type =
        fixture_type.unwrap_or_else(|| fixture_type_for_definition(profile.definition_id.as_str()));
    Ok((profile.definition_id, profile.mode_id, fixture_type))
}

fn parse_required_definition_id(value: &Value) -> Result<String, String> {
    let definition_id = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("definitionId must be a non-empty string"))?;
    normalized_catalog_id(definition_id).ok_or_else(|| {
        format!("definitionId '{definition_id}' is not present in the fixture catalog")
    })
}

fn parse_required_mode_id(value: &Value) -> Result<String, String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .ok_or_else(|| String::from("modeId must be a non-empty string"))
}

fn parse_control_values(value: &Value) -> Result<HashMap<String, i64>, String> {
    let object = value
        .as_object()
        .ok_or_else(|| String::from("controlValues must be an object"))?;
    let mut values = HashMap::with_capacity(object.len());
    for (key, value) in object {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            return Err(String::from("controlValues keys must be non-empty"));
        }
        values.insert(String::from(trimmed), parse_i64_value(value)?);
    }
    Ok(values)
}

pub(super) fn parse_optional_trimmed_string_or_null(
    value: &Value,
    field: &str,
) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }

    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
        .map(Some)
        .ok_or_else(|| format!("{field} must be a string or null"))
}

pub(super) fn parse_optional_group_id(value: &Value) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }

    value
        .as_str()
        .map(str::trim)
        .filter(|group_id| !group_id.is_empty())
        .map(String::from)
        .map(Some)
        .ok_or_else(|| String::from("groupId must be a string or null"))
}

pub(super) fn parse_optional_effect(
    value: &Value,
    field: &str,
) -> Result<Option<LightingEffect>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let object = value
        .as_object()
        .ok_or_else(|| format!("{field} must be an object or null"))?;
    let effect_type = object
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{field}.type is required"))?;
    let normalized_type = validate_effect_type(effect_type)
        .ok_or_else(|| format!("{field}.type must be one of pulse, strobe, or candle"))?;
    let speed = object
        .get("speed")
        .map(parse_i64_value)
        .transpose()?
        .unwrap_or(5);

    Ok(Some(LightingEffect {
        effect_type: normalized_type,
        speed: clamp_i64(speed, 1, 10),
    }))
}

pub(super) fn parse_optional_spatial_coordinate(
    value: &Value,
    field: &str,
) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let coordinate = value
        .as_f64()
        .ok_or_else(|| format!("{field} must be a finite number or null"))?;
    if !coordinate.is_finite() {
        return Err(format!("{field} must be a finite number or null"));
    }

    Ok(Some(clamp_f64(coordinate, 0.0, 20.0)))
}

pub(super) fn parse_spatial_rotation_value(value: &Value, field: &str) -> Result<f64, String> {
    let rotation = value
        .as_f64()
        .ok_or_else(|| format!("{field} must be a finite number"))?;
    if !rotation.is_finite() {
        return Err(format!("{field} must be a finite number"));
    }
    Ok(normalize_rotation(rotation))
}

pub(super) fn parse_optional_rig_z(value: &Value) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let meters = value
        .as_f64()
        .ok_or_else(|| String::from("rigZ must be a finite number or null"))?;
    if !meters.is_finite() {
        return Err(String::from("rigZ must be a finite number or null"));
    }
    Ok(Some(clamp_f64(meters, 0.0, 20.0)))
}

pub(super) fn parse_optional_color_index(value: &Value) -> Result<Option<u8>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let raw = value
        .as_i64()
        .ok_or_else(|| String::from("colorIndex must be an integer 0..7 or null"))?;
    if !(0..=7).contains(&raw) {
        return Err(String::from("colorIndex must be an integer 0..7 or null"));
    }
    Ok(Some(raw as u8))
}

pub(super) fn parse_optional_beam_angle_degrees(value: &Value) -> Result<Option<f64>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let degrees = value
        .as_f64()
        .ok_or_else(|| String::from("beamAngleDegrees must be a finite number or null"))?;
    if !degrees.is_finite() {
        return Err(String::from(
            "beamAngleDegrees must be a finite number or null",
        ));
    }
    Ok(Some(clamp_f64(degrees, 1.0, 180.0)))
}

pub(super) fn parse_optional_spatial_marker(
    value: &Value,
    field: &str,
) -> Result<Option<LightingSpatialMarker>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let object = value
        .as_object()
        .ok_or_else(|| format!("{field} must be an object or null"))?;
    let x = parse_optional_spatial_coordinate(
        object
            .get("x")
            .ok_or_else(|| format!("{field}.x is required"))?,
        &format!("{field}.x"),
    )?
    .ok_or_else(|| format!("{field}.x is required"))?;
    let y = parse_optional_spatial_coordinate(
        object
            .get("y")
            .ok_or_else(|| format!("{field}.y is required"))?,
        &format!("{field}.y"),
    )?
    .ok_or_else(|| format!("{field}.y is required"))?;
    let rotation = parse_spatial_rotation_value(
        object
            .get("rotation")
            .ok_or_else(|| format!("{field}.rotation is required"))?,
        &format!("{field}.rotation"),
    )?;

    Ok(Some(LightingSpatialMarker {
        x: clamp_f64(x, 0.0, 1.0),
        y: clamp_f64(y, 0.0, 1.0),
        rotation,
    }))
}

pub(super) fn parse_i64_value(value: &Value) -> Result<i64, String> {
    if let Some(number) = value.as_i64() {
        Ok(number)
    } else if let Some(number) = value.as_f64() {
        if number.is_finite() {
            Ok(number.round() as i64)
        } else {
            Err(String::from("value must be a finite number"))
        }
    } else {
        Err(String::from("value must be a number"))
    }
}

pub(super) fn parse_positive_i64_value(value: &Value) -> Result<i64, String> {
    let number = parse_i64_value(value)?;
    if number < 1 {
        return Err(String::from("value must be a positive integer"));
    }
    Ok(number)
}
