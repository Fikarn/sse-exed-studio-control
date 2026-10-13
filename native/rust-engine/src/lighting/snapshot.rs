use std::collections::HashMap;
use std::net::Ipv4Addr;

use super::editor_state::*;
use super::fade::{apply_active_fade_sample, LightingFadeRuntimeStatus};
use super::helpers::*;
use super::*;
use crate::lighting_backend::{LightingBackendConfig, LightingBackendInventory};

/// The lighting state as the settings hold it, parsed once: the rig's
/// configuration, the inventory it names and the editor state (the JSON under
/// `LIGHTING_EDITOR_STATE_KEY`, normalised). The snapshot and the sACN output
/// both render from one of these. The output keeps its own between ticks and
/// parses again only when the render generation has moved
/// (`lighting_sacn_output`): parsing at every tick, 25 times a second, was a
/// share of an idle engine's cost (the audit of 2026-10-12). The clock's part
/// (a running fade, an identify burst) is not in here: it is read at each
/// render, so a kept state renders a later moment.
pub struct ParsedLightingState {
    config: LightingBackendConfig,
    inventory: LightingBackendInventory,
    editor_state: LightingEditorState,
}

impl ParsedLightingState {
    pub fn read(settings: &HashMap<String, String>) -> Self {
        let config = resolve_lighting_config(settings);
        let inventory = read_lighting_editor_inventory(&config);
        let editor_state = load_lighting_editor_state_with_inventory(settings, &config, &inventory);
        Self {
            config,
            inventory,
            editor_state,
        }
    }
}

pub fn read_lighting_snapshot(settings: &HashMap<String, String>) -> LightingSnapshot {
    read_lighting_snapshot_from(settings, &ParsedLightingState::read(settings))
}

/// The snapshot from a state parsed earlier, from these same settings.
pub fn read_lighting_snapshot_from(
    settings: &HashMap<String, String>,
    parsed: &ParsedLightingState,
) -> LightingSnapshot {
    let config = &parsed.config;
    let check_status = lighting_check_status(settings);
    let enabled = config.enabled;
    let reachable = enabled && check_status == "passed";
    // The bridge watch's word, for the address the rig is set to; none while
    // lighting is off.
    let bridge_watch = if enabled {
        crate::lighting_bridge_watch::bridge_watch_report(&config.bridge_ip)
    } else {
        None
    };
    let last_recalled_scene_id =
        read_optional_setting(settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY);
    let last_scene_recall_at = read_optional_setting(settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY);
    let last_action_status = read_optional_setting(settings, LIGHTING_LAST_ACTION_STATUS_KEY)
        .unwrap_or_else(|| String::from("idle"));
    let last_action_code = read_optional_setting(settings, LIGHTING_LAST_ACTION_CODE_KEY);
    let last_action_message = read_optional_setting(settings, LIGHTING_LAST_ACTION_MESSAGE_KEY);
    let grand_master = read_lighting_grand_master(settings);
    let now_ms = current_unix_ms();
    let mut editor_state = parsed.editor_state.clone();
    // Whether the rig holds the live scene: the last recalled, else the
    // selected one. Decided on the rig as stored, before a running fade is
    // sampled: a scene being faded in is the rig's (`scene_state`).
    let has_scene = |id: &String| editor_state.scenes.iter().any(|scene| scene.id == *id);
    let live_scene_id = last_recalled_scene_id
        .clone()
        .filter(has_scene)
        .or_else(|| {
            read_optional_setting(settings, LIGHTING_SELECTED_SCENE_ID_KEY).filter(has_scene)
        });
    let scene_state = String::from(super::scene_state::scene_state(
        &editor_state,
        live_scene_id.as_deref(),
        last_recalled_scene_id.as_deref(),
        false,
    ));
    let FixturesNow {
        fixtures,
        fade_status,
        overrides,
    } = fixtures_now(settings, &mut editor_state, now_ms);
    // Emit groups in display order following group_order; orphans (groups
    // that exist on the editor state but not in group_order, e.g. legacy
    // state mid-migration) tail-pad in editor_state.groups order.
    let group_by_id: std::collections::HashMap<&str, &LightingEditorGroupState> = editor_state
        .groups
        .iter()
        .map(|group| (group.id.as_str(), group))
        .collect();
    let mut ordered_groups: Vec<&LightingEditorGroupState> =
        Vec::with_capacity(editor_state.groups.len());
    for id in &editor_state.group_order {
        if let Some(group) = group_by_id.get(id.as_str()).copied() {
            if !ordered_groups.iter().any(|other| other.id == group.id) {
                ordered_groups.push(group);
            }
        }
    }
    for group in &editor_state.groups {
        if !ordered_groups.iter().any(|other| other.id == group.id) {
            ordered_groups.push(group);
        }
    }
    let groups = ordered_groups
        .into_iter()
        .map(|group| {
            let fixture_count = fixtures
                .iter()
                .filter(|fixture| fixture.group_id.as_deref() == Some(group.id.as_str()))
                .count();
            LightingGroupSnapshot {
                id: group.id.clone(),
                name: group.name.clone(),
                fixture_count,
                color_index: group.color_index,
            }
        })
        .collect::<Vec<_>>();
    let selected_fixture_id = read_selected_fixture_id(settings, &fixtures);
    let camera_marker = read_marker_setting(settings, LIGHTING_CAMERA_MARKER_KEY);
    let subject_marker = read_marker_setting(settings, LIGHTING_SUBJECT_MARKER_KEY);
    // Emit scenes in display order: pinned first (preserving their slot
    // in scene_order), then unpinned (in scene_order). Per-scene `pinned`
    // flag drives the rail's visual treatment and snapshots reflect
    // recall / pin state from the engine without the frontend
    // re-deriving order. If scene_order somehow drops an id the live
    // scenes have, the orphans tail-pad in scenes-vec order.
    let pinned_set: std::collections::HashSet<&str> = editor_state
        .pinned_scene_ids
        .iter()
        .map(|id| id.as_str())
        .collect();
    let scene_by_id: std::collections::HashMap<&str, &LightingEditorSceneState> = editor_state
        .scenes
        .iter()
        .map(|scene| (scene.id.as_str(), scene))
        .collect();
    let mut ordered: Vec<&LightingEditorSceneState> = Vec::with_capacity(editor_state.scenes.len());
    for is_pinned_pass in [true, false] {
        for id in &editor_state.scene_order {
            if let Some(scene) = scene_by_id.get(id.as_str()).copied() {
                if pinned_set.contains(scene.id.as_str()) == is_pinned_pass
                    && !ordered.iter().any(|other| other.id == scene.id)
                {
                    ordered.push(scene);
                }
            }
        }
    }
    for scene in &editor_state.scenes {
        if !ordered.iter().any(|other| other.id == scene.id) {
            ordered.push(scene);
        }
    }
    let scenes = ordered
        .into_iter()
        .map(|scene| {
            lighting_scene_snapshot_from_state(
                scene,
                last_recalled_scene_id.as_deref(),
                last_scene_recall_at.as_deref(),
                pinned_set.contains(scene.id.as_str()),
                fade_status.as_ref(),
            )
        })
        .collect::<Vec<_>>();
    let palettes = ordered_lighting_palette_snapshots(&editor_state);
    let selected_scene_id = read_selected_scene_id(settings, &scenes);
    let status = if !enabled && config.bridge_ip.trim().is_empty() {
        String::from("unconfigured")
    } else if !enabled {
        String::from("disabled")
    } else if check_status == "passed" {
        String::from("ready")
    } else if check_status == "failed" {
        String::from("attention")
    } else {
        String::from("not-verified")
    };

    let mut highlight_fixture_ids: Vec<String> = overrides.highlight_ids.iter().cloned().collect();
    highlight_fixture_ids.sort();
    let mut solo_fixture_ids: Vec<String> = overrides.solo_ids.iter().cloned().collect();
    solo_fixture_ids.sort();

    LightingSnapshot {
        summary: lighting_summary(LightingSummaryContext {
            status: &status,
            bridge_ip: &config.bridge_ip,
            universe: config.universe,
            fixture_count: fixtures.len(),
            group_count: groups.len(),
            scene_count: scenes.len(),
            last_recalled_scene_id: last_recalled_scene_id.as_deref(),
            last_scene_recall_at: last_scene_recall_at.as_deref(),
            last_action_status: &last_action_status,
            last_action_code: last_action_code.as_deref(),
            last_action_message: last_action_message.as_deref(),
        }),
        status,
        adapter_mode: parsed.inventory.adapter_mode.clone(),
        bridge_ip: config.bridge_ip.clone(),
        universe: config.universe,
        enabled,
        grand_master,
        connected: reachable,
        reachable,
        bridge_answering: bridge_watch.as_ref().map(|report| report.answering),
        bridge_silent_since: bridge_watch.and_then(|report| report.silent_since),
        output_armed: lighting_output_armed(settings),
        last_recalled_scene_id,
        last_scene_recall_at,
        scene_state,
        recall_fade_ms: read_lighting_recall_fade_ms(settings),
        last_action_status,
        last_action_code,
        last_action_message,
        selected_scene_id,
        selected_fixture_id,
        camera_marker,
        subject_marker,
        fixtures,
        groups,
        scenes,
        palettes,
        preview_mode: false,
        preview_dirty: false,
        preview_scene_id: None,
        preview_fixtures: Vec::new(),
        highlight_fixture_ids,
        solo_fixture_ids,
    }
}

/// The fixtures as the rig shows them at one moment, with what was read to
/// draw them.
struct FixturesNow {
    fixtures: Vec<LightingFixtureSnapshot>,
    fade_status: Option<LightingFadeRuntimeStatus>,
    overrides: OutputOverrides,
}

/// Draws the fixtures as the rig shows them at `now_ms` from the stored
/// state: the running fade sampled, then the output overrides laid over each
/// fixture. The snapshot and the sACN output both read through here, so UI
/// and wire cannot drift. `editor_state` is the caller's copy: the sample
/// moves its fixtures, and ends its fade when the fade is over.
fn fixtures_now(
    settings: &HashMap<String, String>,
    editor_state: &mut LightingEditorState,
    now_ms: i64,
) -> FixturesNow {
    let fade_status = apply_active_fade_sample(editor_state, now_ms);
    let active_burst_ids = active_identify_burst_ids(settings, now_ms);
    let overrides = read_output_overrides(settings);
    let solo_active = overrides.solo_active();
    let fixtures = editor_state
        .fixtures
        .iter()
        .cloned()
        .map(lighting_fixture_snapshot_from_state)
        .map(|mut fixture| {
            // Output-overrides overlay. Three modes compose with strict
            // precedence so the operator can never see a fixture in two
            // overlay states at once: burst (transient flash) > highlight
            // (sustained 100 % at neutral CCT) > solo-mask (everything
            // else dimmed). Stored state is never mutated — the overlay
            // is applied at snapshot read time so downstream DMX
            // rendering and UI both reflect the override consistently.
            if active_burst_ids.contains(&fixture.id) {
                let (_, max_cct) = fixture_cct_range(fixture.fixture_type.as_str());
                fixture.intensity = 100;
                fixture.on = true;
                fixture.cct = max_cct;
                show_white_light_under_overlay(&mut fixture);
            } else if overrides.highlight_ids.contains(&fixture.id) {
                let (min_cct, max_cct) = fixture_cct_range(fixture.fixture_type.as_str());
                fixture.intensity = 100;
                fixture.on = true;
                fixture.cct = NEUTRAL_HIGHLIGHT_CCT.clamp(min_cct, max_cct);
                show_white_light_under_overlay(&mut fixture);
            } else if solo_active && !overrides.solo_ids.contains(&fixture.id) {
                fixture.intensity = 0;
                fixture.on = false;
            }
            fixture
        })
        .collect::<Vec<_>>();
    FixturesNow {
        fixtures,
        fade_status,
        overrides,
    }
}

pub fn read_lighting_dmx_monitor_snapshot(
    settings: &HashMap<String, String>,
) -> LightingDmxMonitorSnapshot {
    let snapshot = read_lighting_snapshot(settings);
    let channel_data = compute_dmx_channel_data(&snapshot.fixtures, snapshot.grand_master);
    let mut channels = Vec::new();
    for fixture in &snapshot.fixtures {
        let profile = fixture_profile_for_snapshot(fixture);
        let labels = profile.labels;
        for offset in 0..profile.channel_count {
            let channel = fixture.dmx_start_address + offset;
            channels.push(LightingDmxChannelSnapshot {
                universe: fixture.universe,
                channel,
                value: *channel_data.get(&(fixture.universe, channel)).unwrap_or(&0),
                light_name: fixture.name.clone(),
                label: labels
                    .get(offset as usize)
                    .cloned()
                    .unwrap_or_else(|| format!("Ch{}", offset + 1)),
            });
        }
    }
    channels.sort_by(|left, right| {
        left.universe
            .cmp(&right.universe)
            .then_with(|| left.channel.cmp(&right.channel))
    });

    LightingDmxMonitorSnapshot { channels }
}

/// One rendered sACN universe: the full 512-slot DMX payload for the wire.
pub struct LightingUniverseFrame {
    pub universe: u16,
    pub slots: [u8; 512],
}

/// Everything the sACN output lane needs for one transmission pass.
pub struct LightingSacnOutputState {
    pub bridge_ip: Ipv4Addr,
    pub frames: Vec<LightingUniverseFrame>,
}

/// Renders the current lighting state into per-universe DMX frames for the
/// native sACN output. Returns `None` while output must stay dark: lighting
/// disabled, no valid commissioned bridge address, or nothing patched. The
/// slot values are the same numbers the operator sees in the DMX monitor —
/// both read through `compute_dmx_channel_data`, so UI and wire cannot drift.
/// The tests' read, parsing and rendering in one; the output itself renders
/// from a kept `ParsedLightingState` (`read_lighting_sacn_output_state_from`).
#[cfg(test)]
pub fn read_lighting_sacn_output_state(
    settings: &HashMap<String, String>,
) -> Option<LightingSacnOutputState> {
    read_lighting_sacn_output_state_from(settings, &ParsedLightingState::read(settings))
}

/// The frames from a state parsed earlier, from these same settings, at this
/// moment: what the sACN output renders at each tick.
pub fn read_lighting_sacn_output_state_from(
    settings: &HashMap<String, String>,
    parsed: &ParsedLightingState,
) -> Option<LightingSacnOutputState> {
    read_lighting_sacn_output_state_at(settings, parsed, current_unix_ms())
}

/// The frames at `now_ms`: the moment is a parameter so that a test can
/// render a running fade at two moments from one kept state.
pub(crate) fn read_lighting_sacn_output_state_at(
    settings: &HashMap<String, String>,
    parsed: &ParsedLightingState,
    now_ms: i64,
) -> Option<LightingSacnOutputState> {
    if !parsed.config.enabled {
        return None;
    }
    // An address that is not one machine's (saved data from before the rule)
    // is never streamed to: a multicast address would reach every sACN
    // receiver on the LAN (the audit of 2026-10-12).
    let bridge_ip = crate::commissioning::one_machine_ipv4(&parsed.config.bridge_ip)?;
    let mut editor_state = parsed.editor_state.clone();
    let fixtures = fixtures_now(settings, &mut editor_state, now_ms).fixtures;
    if fixtures.is_empty() {
        return None;
    }

    let channel_data = compute_dmx_channel_data(&fixtures, read_lighting_grand_master(settings));
    let mut universes: Vec<i64> = fixtures
        .iter()
        .map(|fixture| fixture.universe)
        .filter(|universe| (1..=63999).contains(universe))
        .collect();
    universes.sort_unstable();
    universes.dedup();

    let frames: Vec<LightingUniverseFrame> = universes
        .into_iter()
        .map(|universe| {
            let mut slots = [0_u8; 512];
            for ((frame_universe, channel), value) in &channel_data {
                if *frame_universe == universe && (1..=512).contains(channel) {
                    slots[(*channel - 1) as usize] = (*value).clamp(0, 255) as u8;
                }
            }
            LightingUniverseFrame {
                universe: universe as u16,
                slots,
            }
        })
        .collect();

    if frames.is_empty() {
        return None;
    }

    Some(LightingSacnOutputState { bridge_ip, frames })
}

/// The address the bridge watch looks at: the bridge's, while lighting is on
/// and it is a valid address; `None` otherwise, and the watch then ends.
pub fn lighting_watched_bridge(settings: &HashMap<String, String>) -> Option<Ipv4Addr> {
    let config = resolve_lighting_config(settings);
    if !config.enabled {
        return None;
    }
    crate::commissioning::one_machine_ipv4(&config.bridge_ip)
}

pub fn build_lighting_health_check(settings: &HashMap<String, String>) -> LightingHealthCheck {
    let snapshot = read_lighting_snapshot(settings);
    LightingHealthCheck {
        ok: snapshot.status == "ready",
        status: snapshot.status.clone(),
        summary: snapshot.summary.clone(),
        bridge_ip: snapshot.bridge_ip,
        universe: snapshot.universe,
        reachable: snapshot.reachable,
    }
}

/// A bar whose colour crosses over its CCT light (the INFINIBAR PB12, D44)
/// shows the overlay's white light: the flash and the highlight promise
/// 100 % at a CCT, and a bar at 100 % in a colour would otherwise not flash
/// at all (the review of #323). The stored colour is untouched: the overlay
/// is drawn at read time and the colour is back when it ends.
fn show_white_light_under_overlay(fixture: &mut LightingFixtureSnapshot) {
    let profile = fixture_profile_for_snapshot(fixture);
    let definition =
        resolve_fixture_definition(Some(profile.definition_id.as_str()), None, None, "");
    let mode = resolve_fixture_mode(definition, Some(profile.mode_id.as_str()));
    if mode
        .channels
        .iter()
        .any(|channel| channel.control_id == "cct-rgb-crossfade")
    {
        for control in ["red", "green", "blue"] {
            fixture.control_values.insert(String::from(control), 0);
        }
    }
}

/// Every patched slot's value, by universe and channel, from the fixtures as
/// the rig shows them and the grand master in per cent.
fn compute_dmx_channel_data(
    fixtures: &[LightingFixtureSnapshot],
    grand_master: i64,
) -> HashMap<(i64, i64), i64> {
    let mut channel_data = HashMap::new();
    let grand_master = (grand_master as f64 / 100.0).clamp(0.0, 1.0);

    for fixture in fixtures {
        let address = fixture.dmx_start_address;
        let profile = fixture_profile_for_snapshot(fixture);
        let dimmer = if fixture.on {
            ((intensity_to_dmx(fixture.intensity) as f64) * grand_master).round() as i64
        } else {
            0
        };
        let (cct_min, cct_max) = fixture_cct_range_from_profile(&profile);
        let definition =
            resolve_fixture_definition(Some(profile.definition_id.as_str()), None, None, "");
        let mode = resolve_fixture_mode(definition, Some(profile.mode_id.as_str()));

        for channel in &mode.channels {
            let value = match channel.control_id.as_str() {
                "intensity" => dimmer,
                "cct" => cct_to_dmx(fixture.cct, cct_min, cct_max),
                "red" | "green" | "blue" | "white" | "mix" | "fx" | "speed" | "fan" | "zoom"
                | "mode" | "trigger" | "control" | "dimming-curve" => fixture
                    .control_values
                    .get(channel.control_id.as_str())
                    .copied()
                    .unwrap_or(channel.default_dmx)
                    .clamp(0, 255),
                "hue" => {
                    let hue = fixture
                        .control_values
                        .get("hue")
                        .copied()
                        .unwrap_or(0)
                        .clamp(0, 359);
                    ((hue as f64 / 359.0) * 255.0).round() as i64
                }
                "saturation" => intensity_to_dmx(
                    fixture
                        .control_values
                        .get("saturation")
                        .copied()
                        .unwrap_or(0),
                ),
                // The INFINIBAR's G/M runs Aputure's banded table; the
                // INFINIMAT's channel keeps its straight line below.
                "green-magenta" if channel.value_type == "aputure-gm" => {
                    aputure_green_magenta_to_dmx(
                        fixture
                            .control_values
                            .get("green-magenta")
                            .copied()
                            .unwrap_or(0),
                    )
                }
                "green-magenta" => {
                    let value = fixture
                        .control_values
                        .get("green-magenta")
                        .copied()
                        .unwrap_or(0)
                        .clamp(-100, 100);
                    (((value + 100) as f64 / 200.0) * 255.0).round() as i64
                }
                // The INFINIBAR's crossfade from its CCT light to its RGB
                // colour has no control: the bar shows a colour while one is
                // set and its CCT light otherwise (the owner, 2026-10-08).
                "cct-rgb-crossfade" => {
                    let colour_set = ["red", "green", "blue"].iter().any(|control| {
                        fixture
                            .control_values
                            .get(*control)
                            .copied()
                            .unwrap_or(0)
                            .clamp(0, 255)
                            > 0
                    });
                    if colour_set {
                        255
                    } else {
                        0
                    }
                }
                "reserved" => 0,
                _ if channel.value_type == "fine" => 0,
                _ => channel.default_dmx,
            };
            channel_data.insert((fixture.universe, address + channel.offset - 1), value);
        }
    }

    channel_data
}
