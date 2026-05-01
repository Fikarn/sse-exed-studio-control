use std::collections::HashMap;

use super::editor_state::*;
use super::fade::apply_active_fade_sample;
use super::helpers::*;
use super::*;

pub fn read_lighting_snapshot(settings: &HashMap<String, String>) -> LightingSnapshot {
    let config = resolve_lighting_config(settings);
    let check_status = lighting_check_status(settings);
    let enabled = config.enabled;
    let reachable = enabled && check_status == "passed";
    let inventory = read_lighting_editor_inventory(&config);
    let last_recalled_scene_id =
        read_optional_setting(settings, LIGHTING_LAST_RECALLED_SCENE_ID_KEY);
    let last_scene_recall_at = read_optional_setting(settings, LIGHTING_LAST_SCENE_RECALL_AT_KEY);
    let last_action_status = read_optional_setting(settings, LIGHTING_LAST_ACTION_STATUS_KEY)
        .unwrap_or_else(|| String::from("idle"));
    let last_action_code = read_optional_setting(settings, LIGHTING_LAST_ACTION_CODE_KEY);
    let last_action_message = read_optional_setting(settings, LIGHTING_LAST_ACTION_MESSAGE_KEY);
    let grand_master = read_lighting_grand_master(settings);
    let now_ms = current_unix_ms();
    let mut editor_state = load_lighting_editor_state_with_inventory(settings, &config, &inventory);
    let fade_status = apply_active_fade_sample(&mut editor_state, now_ms);
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
            } else if overrides.highlight_ids.contains(&fixture.id) {
                let (min_cct, max_cct) = fixture_cct_range(fixture.fixture_type.as_str());
                fixture.intensity = 100;
                fixture.on = true;
                fixture.cct = NEUTRAL_HIGHLIGHT_CCT.clamp(min_cct, max_cct);
            } else if solo_active && !overrides.solo_ids.contains(&fixture.id) {
                fixture.intensity = 0;
                fixture.on = false;
            }
            fixture
        })
        .collect::<Vec<_>>();
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
        summary: lighting_summary(
            &status,
            &config.bridge_ip,
            config.universe,
            fixtures.len(),
            groups.len(),
            scenes.len(),
            last_recalled_scene_id.as_deref(),
            last_scene_recall_at.as_deref(),
            &last_action_status,
            last_action_code.as_deref(),
            last_action_message.as_deref(),
        ),
        status,
        adapter_mode: inventory.adapter_mode,
        bridge_ip: config.bridge_ip,
        universe: config.universe,
        enabled,
        grand_master,
        connected: reachable,
        reachable,
        last_recalled_scene_id,
        last_scene_recall_at,
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
        preview_mode: false,
        preview_dirty: false,
        preview_scene_id: None,
        preview_fixtures: Vec::new(),
        highlight_fixture_ids,
        solo_fixture_ids,
    }
}

pub fn read_lighting_dmx_monitor_snapshot(
    settings: &HashMap<String, String>,
) -> LightingDmxMonitorSnapshot {
    let snapshot = read_lighting_snapshot(settings);
    let channel_data = compute_dmx_channel_data(&snapshot);
    let mut channels = Vec::new();
    for fixture in &snapshot.fixtures {
        let labels = fixture_channel_labels(fixture.fixture_type.as_str());
        for offset in 0..fixture_channel_count(fixture.fixture_type.as_str()) {
            let channel = fixture.dmx_start_address + offset;
            channels.push(LightingDmxChannelSnapshot {
                channel,
                value: *channel_data.get(&channel).unwrap_or(&0),
                light_name: fixture.name.clone(),
                label: labels
                    .get(offset as usize)
                    .cloned()
                    .unwrap_or_else(|| format!("Ch{}", offset + 1)),
            });
        }
    }
    channels.sort_by(|left, right| left.channel.cmp(&right.channel));

    LightingDmxMonitorSnapshot { channels }
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

fn compute_dmx_channel_data(snapshot: &LightingSnapshot) -> HashMap<i64, i64> {
    let mut channel_data = HashMap::new();
    let grand_master = (snapshot.grand_master as f64 / 100.0).clamp(0.0, 1.0);

    for fixture in &snapshot.fixtures {
        let address = fixture.dmx_start_address;
        let dimmer = if fixture.on {
            ((intensity_to_dmx(fixture.intensity) as f64) * grand_master).round() as i64
        } else {
            0
        };
        let (cct_min, cct_max) = fixture_cct_range(fixture.fixture_type.as_str());

        channel_data.insert(address, dimmer);
        channel_data.insert(address + 1, cct_to_dmx(fixture.cct, cct_min, cct_max));

        match fixture_channel_count(fixture.fixture_type.as_str()) {
            8 => {
                channel_data.insert(address + 2, 0);
                channel_data.insert(address + 3, 0);
                channel_data.insert(address + 4, 0);
                channel_data.insert(address + 5, 0);
                channel_data.insert(address + 6, 0);
                channel_data.insert(address + 7, 0);
            }
            4 => {
                channel_data.insert(address + 2, 0);
                channel_data.insert(address + 3, 0);
            }
            _ => {}
        }
    }

    channel_data
}
