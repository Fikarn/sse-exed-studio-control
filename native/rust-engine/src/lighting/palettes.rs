use std::path::Path;

use super::editor_state::*;
use super::fade::{apply_active_fade_sample, remove_fixture_from_active_fade};
use super::helpers::*;
use super::identify::current_unix_ms;
use super::preview::LightingPreviewRuntimeState;
use super::types::*;
use super::*;

pub fn list_lighting_palettes(
    db_path: &Path,
) -> Result<LightingPaletteListResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    Ok(LightingPaletteListResult {
        palettes: ordered_lighting_palette_snapshots(&editor_state),
    })
}

pub fn create_lighting_palette(
    db_path: &Path,
    request: &LightingPaletteCreateRequest,
) -> Result<LightingPaletteCreateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let palette = LightingEditorPaletteState {
        id: next_custom_palette_id(&editor_state.palettes),
        name: request.name.clone(),
        kind: request.kind,
        value: validated_palette_value(request.kind, request.value)?,
        color_index: request.color_index,
    };
    editor_state.palettes.push(palette.clone());
    move_palette_in_order(
        &mut editor_state.palette_order,
        &editor_state.palettes,
        palette.id.as_str(),
        None,
    )?;

    let summary = format!(
        "Lighting {} palette '{}' was created at {}.",
        palette_kind_label(palette.kind),
        palette.name,
        format_palette_value(palette.kind, palette.value)
    );
    persist_palette_state(db_path, &editor_state, &summary)?;

    Ok(LightingPaletteCreateResult {
        palette: lighting_palette_snapshot_from_state(&palette),
        summary,
    })
}

pub fn update_lighting_palette(
    db_path: &Path,
    request: &LightingPaletteUpdateRequest,
) -> Result<LightingPaletteUpdateResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let palette_index = editor_state
        .palettes
        .iter()
        .position(|palette| palette.id == request.palette_id)
        .ok_or_else(|| palette_not_found(request.palette_id.as_str()))?;
    let palette_kind = editor_state.palettes[palette_index].kind;
    validate_reorder_target(
        editor_state.palettes.as_slice(),
        request.palette_id.as_str(),
        palette_kind,
        request
            .before_palette_id
            .as_ref()
            .and_then(|before_palette_id| before_palette_id.as_deref()),
    )?;

    {
        let palette = &mut editor_state.palettes[palette_index];
        if let Some(name) = &request.name {
            palette.name = name.clone();
        }
        if let Some(value) = request.value {
            palette.value = validated_palette_value(palette.kind, value)?;
        }
        if let Some(color_index) = request.color_index {
            palette.color_index = color_index;
        }
    }

    if let Some(before_palette_id) = &request.before_palette_id {
        move_palette_in_order(
            &mut editor_state.palette_order,
            &editor_state.palettes,
            request.palette_id.as_str(),
            before_palette_id.as_deref(),
        )?;
    }

    let updated_palette = editor_state.palettes[palette_index].clone();
    let summary = lighting_palette_update_summary(&updated_palette, request);
    persist_palette_state(db_path, &editor_state, &summary)?;

    Ok(LightingPaletteUpdateResult {
        palette: lighting_palette_snapshot_from_state(&updated_palette),
        summary,
    })
}

pub fn delete_lighting_palette(
    db_path: &Path,
    request: &LightingPaletteDeleteRequest,
) -> Result<LightingPaletteDeleteResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    let palette = editor_state
        .palettes
        .iter()
        .find(|palette| palette.id == request.palette_id)
        .cloned()
        .ok_or_else(|| palette_not_found(request.palette_id.as_str()))?;
    editor_state
        .palettes
        .retain(|palette| palette.id != request.palette_id);
    editor_state
        .palette_order
        .retain(|palette_id| palette_id != &request.palette_id);

    let summary = format!("Lighting palette '{}' was deleted.", palette.name);
    persist_palette_state(db_path, &editor_state, &summary)?;

    Ok(LightingPaletteDeleteResult {
        deleted: true,
        palette_id: request.palette_id.clone(),
        summary,
    })
}

pub fn apply_lighting_palette_with_preview(
    db_path: &Path,
    request: &LightingPaletteApplyRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingPaletteApplyResult, LightingCommandError> {
    if request.patch_mode_active {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PALETTE_PATCH_MODE_CONFLICT",
            String::from("Exit patch mode before applying lighting palettes."),
        ));
    }

    if preview.enabled {
        apply_lighting_palette_preview(db_path, request, preview)
    } else {
        apply_lighting_palette_live(db_path, request)
    }
}

fn apply_lighting_palette_live(
    db_path: &Path,
    request: &LightingPaletteApplyRequest,
) -> Result<LightingPaletteApplyResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let mut editor_state = load_lighting_editor_state(&app_settings);
    apply_active_fade_sample(&mut editor_state, current_unix_ms());
    let palette = editor_state
        .palettes
        .iter()
        .find(|palette| palette.id == request.palette_id)
        .cloned()
        .ok_or_else(|| palette_not_found(request.palette_id.as_str()))?;
    validate_palette_fixture_ids(
        editor_state.fixtures.as_slice(),
        request.fixture_ids.as_slice(),
    )?;

    let mut affected_fixtures = 0usize;
    for fixture_id in &request.fixture_ids {
        if let Some(fixture) = editor_state
            .fixtures
            .iter_mut()
            .find(|fixture| fixture.id == *fixture_id)
        {
            apply_palette_to_fixture(fixture, &palette);
            affected_fixtures += 1;
        }
        remove_fixture_from_active_fade(&mut editor_state, fixture_id.as_str());
    }

    let summary = palette_apply_summary(&palette, affected_fixtures, false);
    persist_palette_state(db_path, &editor_state, &summary)?;

    Ok(LightingPaletteApplyResult {
        palette_id: palette.id,
        palette_name: palette.name,
        kind: palette.kind,
        affected_fixtures,
        preview_mode: false,
        summary,
    })
}

fn apply_lighting_palette_preview(
    db_path: &Path,
    request: &LightingPaletteApplyRequest,
    preview: &mut LightingPreviewRuntimeState,
) -> Result<LightingPaletteApplyResult, LightingCommandError> {
    let app_settings = load_lighting_settings(db_path)?;
    let editor_state = load_lighting_editor_state(&app_settings);
    let palette = editor_state
        .palettes
        .iter()
        .find(|palette| palette.id == request.palette_id)
        .cloned()
        .ok_or_else(|| palette_not_found(request.palette_id.as_str()))?;
    validate_palette_fixture_ids(
        editor_state.fixtures.as_slice(),
        request.fixture_ids.as_slice(),
    )?;

    let mut affected_fixtures = 0usize;
    for fixture_id in &request.fixture_ids {
        if let Some(fixture) = editor_state
            .fixtures
            .iter()
            .find(|fixture| fixture.id == *fixture_id)
        {
            let preview_state = preview
                .fixture_states
                .entry(fixture.id.clone())
                .or_insert_with(|| LightingEditorSceneFixtureState {
                    fixture_id: fixture.id.clone(),
                    intensity: clamp_i64(fixture.intensity, 0, 100),
                    cct: fixture.cct,
                    on: fixture.on,
                    control_values: fixture.control_values.clone(),
                });
            apply_palette_to_preview_state(preview_state, fixture, &palette);
            affected_fixtures += 1;
        }
    }
    preview.dirty = true;

    Ok(LightingPaletteApplyResult {
        palette_id: palette.id.clone(),
        palette_name: palette.name.clone(),
        kind: palette.kind,
        affected_fixtures,
        preview_mode: true,
        summary: palette_apply_summary(&palette, affected_fixtures, true),
    })
}

fn persist_palette_state(
    db_path: &Path,
    editor_state: &LightingEditorState,
    summary: &str,
) -> Result<(), LightingCommandError> {
    let mut updates = lighting_editor_state_updates(editor_state)?;
    updates.extend_from_slice(&[
        (
            String::from(LIGHTING_LAST_ACTION_STATUS_KEY),
            String::from("succeeded"),
        ),
        (String::from(LIGHTING_LAST_ACTION_CODE_KEY), String::new()),
        (
            String::from(LIGHTING_LAST_ACTION_MESSAGE_KEY),
            String::from(summary),
        ),
    ]);
    persist_lighting_state(db_path, &updates)
}

fn validate_reorder_target(
    palettes: &[LightingEditorPaletteState],
    palette_id: &str,
    palette_kind: LightingPaletteKind,
    before_palette_id: Option<&str>,
) -> Result<(), LightingCommandError> {
    let Some(before_palette_id) = before_palette_id else {
        return Ok(());
    };
    if before_palette_id == palette_id {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PALETTE_REORDER_INVALID",
            String::from("beforePaletteId must differ from paletteId."),
        ));
    }
    let target = palettes
        .iter()
        .find(|palette| palette.id == before_palette_id)
        .ok_or_else(|| palette_not_found(before_palette_id))?;
    if target.kind != palette_kind {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PALETTE_KIND_MISMATCH",
            String::from("Palettes can only be reordered within the same attribute pool."),
        ));
    }
    Ok(())
}

fn move_palette_in_order(
    palette_order: &mut Vec<String>,
    palettes: &[LightingEditorPaletteState],
    palette_id: &str,
    before_palette_id: Option<&str>,
) -> Result<(), LightingCommandError> {
    let palette_kind = palettes
        .iter()
        .find(|palette| palette.id == palette_id)
        .map(|palette| palette.kind)
        .ok_or_else(|| palette_not_found(palette_id))?;
    validate_reorder_target(palettes, palette_id, palette_kind, before_palette_id)?;

    let mut order = normalize_lighting_palette_order(palettes, palette_order);
    order.retain(|id| id != palette_id);
    match before_palette_id {
        Some(before_palette_id) => {
            let index = order
                .iter()
                .position(|id| id == before_palette_id)
                .ok_or_else(|| palette_not_found(before_palette_id))?;
            order.insert(index, String::from(palette_id));
        }
        None => {
            let insert_index = order
                .iter()
                .rposition(|id| {
                    palettes
                        .iter()
                        .find(|palette| palette.id == *id)
                        .is_some_and(|palette| palette.kind == palette_kind)
                })
                .map(|index| index + 1)
                .unwrap_or_else(|| {
                    order
                        .iter()
                        .position(|id| {
                            palettes
                                .iter()
                                .find(|palette| palette.id == *id)
                                .is_some_and(|palette| palette.kind != palette_kind)
                        })
                        .unwrap_or(order.len())
                });
            order.insert(insert_index, String::from(palette_id));
        }
    }
    *palette_order = normalize_lighting_palette_order(palettes, &order);
    Ok(())
}

fn validate_palette_fixture_ids(
    fixtures: &[LightingEditorFixtureState],
    fixture_ids: &[String],
) -> Result<(), LightingCommandError> {
    if fixture_ids.is_empty() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PALETTE_NO_FIXTURES",
            String::from("Select at least one lighting fixture before applying a palette."),
        ));
    }
    for fixture_id in fixture_ids {
        if !fixtures.iter().any(|fixture| &fixture.id == fixture_id) {
            return Err(LightingCommandError::Rejected(
                "LIGHTING_FIXTURE_NOT_FOUND",
                format!(
                    "Lighting fixture '{}' is not exposed by the native editor state.",
                    fixture_id
                ),
            ));
        }
    }
    Ok(())
}

fn apply_palette_to_fixture(
    fixture: &mut LightingEditorFixtureState,
    palette: &LightingEditorPaletteState,
) {
    match palette.kind {
        LightingPaletteKind::Intensity => {
            let intensity = clamp_i64(palette.value.round() as i64, 0, 100);
            fixture.intensity = intensity;
            fixture.on = intensity > 0;
        }
        LightingPaletteKind::Cct => {
            let default_cct = default_fixture_cct_for_type(fixture.fixture_type.as_str());
            fixture.cct = clamp_cct_for_type(
                palette.value.round() as i64,
                fixture.fixture_type.as_str(),
                default_cct,
            );
        }
    }
}

fn apply_palette_to_preview_state(
    preview_state: &mut LightingEditorSceneFixtureState,
    fixture: &LightingEditorFixtureState,
    palette: &LightingEditorPaletteState,
) {
    match palette.kind {
        LightingPaletteKind::Intensity => {
            let intensity = clamp_i64(palette.value.round() as i64, 0, 100);
            preview_state.intensity = intensity;
            preview_state.on = intensity > 0;
        }
        LightingPaletteKind::Cct => {
            let default_cct = default_fixture_cct_for_type(fixture.fixture_type.as_str());
            preview_state.cct = clamp_cct_for_type(
                palette.value.round() as i64,
                fixture.fixture_type.as_str(),
                default_cct,
            );
        }
    }
}

pub(super) fn validated_palette_value(
    kind: LightingPaletteKind,
    value: f64,
) -> Result<f64, LightingCommandError> {
    if !value.is_finite() {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PALETTE_INVALID_VALUE",
            String::from("Palette value must be a finite number."),
        ));
    }
    let (min, max, label) = match kind {
        LightingPaletteKind::Intensity => (0.0, 100.0, "intensity"),
        LightingPaletteKind::Cct => (MIN_FIXTURE_CCT as f64, MAX_FIXTURE_CCT as f64, "CCT"),
    };
    if !(min..=max).contains(&value) {
        return Err(LightingCommandError::Rejected(
            "LIGHTING_PALETTE_INVALID_VALUE",
            format!("Palette {label} value must be between {min:.0} and {max:.0}."),
        ));
    }
    Ok(value)
}

fn lighting_palette_update_summary(
    palette: &LightingEditorPaletteState,
    request: &LightingPaletteUpdateRequest,
) -> String {
    let mut parts = Vec::new();
    if request.name.is_some() {
        parts.push(String::from("renamed"));
    }
    if request.value.is_some() {
        parts.push(format!(
            "set to {}",
            format_palette_value(palette.kind, palette.value)
        ));
    }
    if let Some(color_index) = request.color_index {
        parts.push(if color_index.is_some() {
            String::from("recolored")
        } else {
            String::from("color cleared")
        });
    }
    if request.before_palette_id.is_some() {
        parts.push(String::from("reordered"));
    }

    if parts.is_empty() {
        format!("Lighting palette '{}' was updated.", palette.name)
    } else {
        format!(
            "Lighting palette '{}' {}.",
            palette.name,
            parts.join(" and ")
        )
    }
}

fn palette_apply_summary(
    palette: &LightingEditorPaletteState,
    affected_fixtures: usize,
    preview_mode: bool,
) -> String {
    format!(
        "Lighting {} palette '{}' applied to {} fixture{}{}.",
        palette_kind_label(palette.kind),
        palette.name,
        affected_fixtures,
        if affected_fixtures == 1 { "" } else { "s" },
        if preview_mode { " in preview" } else { "" }
    )
}

fn format_palette_value(kind: LightingPaletteKind, value: f64) -> String {
    match kind {
        LightingPaletteKind::Intensity => format!("{:.0}%", value.round()),
        LightingPaletteKind::Cct => format!("{:.0}K", value.round()),
    }
}

fn palette_kind_label(kind: LightingPaletteKind) -> &'static str {
    match kind {
        LightingPaletteKind::Intensity => "intensity",
        LightingPaletteKind::Cct => "CCT",
    }
}

fn palette_not_found(palette_id: &str) -> LightingCommandError {
    LightingCommandError::Rejected(
        "LIGHTING_PALETTE_NOT_FOUND",
        format!(
            "Lighting palette '{}' is not exposed by the native editor state.",
            palette_id
        ),
    )
}
