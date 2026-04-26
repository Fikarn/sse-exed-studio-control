use std::path::Path;

use crate::commissioning::{LIGHTING_BRIDGE_IP_KEY, LIGHTING_CHECK_ID, LIGHTING_UNIVERSE_KEY};

use super::editor_state::*;
use super::helpers::*;
use super::types::*;
use super::*;

pub fn update_lighting_settings(
    db_path: &Path,
    request: &LightingSettingsUpdateRequest,
) -> Result<LightingSettingsUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    let current_config = resolve_lighting_config(&app_settings);

    if let Some(Some(fixture_id)) = &request.selected_fixture_id {
        if !editor_state
            .fixtures
            .iter()
            .any(|fixture| fixture.id == *fixture_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    fixture_id
                ),
            ));
        }
    }
    if let Some(Some(scene_id)) = &request.selected_scene_id {
        if !editor_state
            .scenes
            .iter()
            .any(|scene| scene.id == *scene_id)
        {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_SCENE_NOT_FOUND",
                format!(
                    "Lighting scene '{}' is not exposed by the native editor state.",
                    scene_id
                ),
            ));
        }
    }

    let enabled = request.enabled.unwrap_or(current_config.enabled);
    let bridge_ip = request
        .bridge_ip
        .clone()
        .unwrap_or_else(|| current_config.bridge_ip.clone());
    let universe = request.universe.unwrap_or(current_config.universe);
    let grand_master = request
        .grand_master
        .unwrap_or_else(|| read_lighting_grand_master(&app_settings));

    if enabled && bridge_ip.trim().is_empty() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_BRIDGE_REQUIRED",
            String::from("bridgeIp is required while native lighting output is enabled."),
        ));
    }
    if !bridge_ip.trim().is_empty() && !is_valid_ipv4(&bridge_ip) {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_BRIDGE_INVALID",
            String::from("bridgeIp must be a valid IPv4 address."),
        ));
    }

    let selected_fixture_id = request.selected_fixture_id.clone().unwrap_or_else(|| {
        read_selected_fixture_id(&app_settings, &snapshot_fixtures(&editor_state.fixtures))
    });
    let selected_scene_id = request.selected_scene_id.clone().unwrap_or_else(|| {
        read_optional_setting(&app_settings, LIGHTING_SELECTED_SCENE_ID_KEY).filter(|scene_id| {
            editor_state
                .scenes
                .iter()
                .any(|scene| scene.id == *scene_id)
        })
    });
    let camera_marker = request
        .camera_marker
        .clone()
        .unwrap_or_else(|| read_marker_setting(&app_settings, LIGHTING_CAMERA_MARKER_KEY));
    let subject_marker = request
        .subject_marker
        .clone()
        .unwrap_or_else(|| read_marker_setting(&app_settings, LIGHTING_SUBJECT_MARKER_KEY));
    let transport_changed =
        request.enabled.is_some() || request.bridge_ip.is_some() || request.universe.is_some();
    let mut updates = Vec::new();
    let mut summary_parts = Vec::new();

    if let Some(enabled) = request.enabled {
        updates.push((
            String::from(LIGHTING_ENABLED_KEY),
            if enabled {
                String::from("true")
            } else {
                String::from("false")
            },
        ));
        summary_parts.push(if enabled {
            String::from("lighting output enabled")
        } else {
            String::from("lighting output disabled")
        });
    }
    if let Some(bridge_ip) = &request.bridge_ip {
        updates.push((String::from(LIGHTING_BRIDGE_IP_KEY), bridge_ip.clone()));
        summary_parts.push(if bridge_ip.is_empty() {
            String::from("bridge cleared")
        } else {
            format!("bridge -> {}", bridge_ip)
        });
    }
    if let Some(universe) = request.universe {
        updates.push((String::from(LIGHTING_UNIVERSE_KEY), universe.to_string()));
        summary_parts.push(format!("universe -> {}", universe));
    }
    if let Some(grand_master) = request.grand_master {
        updates.push((
            String::from(LIGHTING_GRAND_MASTER_KEY),
            grand_master.to_string(),
        ));
        summary_parts.push(format!("grand master -> {}%", grand_master));
    }
    if let Some(selected_scene_id) = &request.selected_scene_id {
        let value = selected_scene_id.clone().unwrap_or_default();
        updates.push((String::from(LIGHTING_SELECTED_SCENE_ID_KEY), value.clone()));
        summary_parts.push(if value.is_empty() {
            String::from("selected scene cleared")
        } else {
            format!("selected scene -> {}", value)
        });
    }

    if let Some(selected_fixture_id) = &request.selected_fixture_id {
        updates.push((
            String::from(LIGHTING_SELECTED_FIXTURE_ID_KEY),
            selected_fixture_id.clone().unwrap_or_default(),
        ));
        summary_parts.push(
            selected_fixture_id
                .as_ref()
                .and_then(|fixture_id| {
                    editor_state
                        .fixtures
                        .iter()
                        .find(|fixture| fixture.id == *fixture_id)
                        .map(|fixture| format!("selected fixture -> {}", fixture.name))
                })
                .unwrap_or_else(|| String::from("selected fixture cleared")),
        );
    }
    if let Some(camera_marker) = &request.camera_marker {
        updates.push((
            String::from(LIGHTING_CAMERA_MARKER_KEY),
            serialize_optional_marker(camera_marker.as_ref())?,
        ));
        summary_parts.push(if camera_marker.is_some() {
            String::from("camera marker set")
        } else {
            String::from("camera marker hidden")
        });
    }
    if let Some(subject_marker) = &request.subject_marker {
        updates.push((
            String::from(LIGHTING_SUBJECT_MARKER_KEY),
            serialize_optional_marker(subject_marker.as_ref())?,
        ));
        summary_parts.push(if subject_marker.is_some() {
            String::from("subject marker set")
        } else {
            String::from("subject marker hidden")
        });
    }
    if transport_changed {
        updates.push((
            format!("app.commissioning.check.{LIGHTING_CHECK_ID}.status"),
            String::from("idle"),
        ));
        updates.push((
            format!("app.commissioning.check.{LIGHTING_CHECK_ID}.message"),
            String::from(
                "Lighting transport settings changed in the native lighting workspace. Rerun the lighting probe.",
            ),
        ));
        updates.push((
            format!("app.commissioning.check.{LIGHTING_CHECK_ID}.checked_at"),
            String::new(),
        ));
        summary_parts.push(String::from("lighting probe reset"));
    }
    let summary = if summary_parts.is_empty() {
        String::from("Native lighting settings updated.")
    } else {
        format!(
            "Native lighting settings updated: {}.",
            summary_parts.join(", ")
        )
    };
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

    Ok(LightingSettingsUpdateResult {
        enabled,
        bridge_ip,
        universe,
        grand_master,
        selected_scene_id,
        selected_fixture_id,
        camera_marker,
        subject_marker,
        summary,
    })
}
