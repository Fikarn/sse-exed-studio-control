use std::collections::HashMap;

use super::editor_state::*;
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
    let editor_state = load_lighting_editor_state_with_inventory(settings, &config, &inventory);
    let fixtures = editor_state
        .fixtures
        .iter()
        .cloned()
        .map(lighting_fixture_snapshot_from_state)
        .collect::<Vec<_>>();
    let groups = editor_state
        .groups
        .iter()
        .map(|group| {
            let fixture_count = fixtures
                .iter()
                .filter(|fixture| fixture.group_id.as_deref() == Some(group.id.as_str()))
                .count();
            LightingGroupSnapshot {
                id: group.id.clone(),
                name: group.name.clone(),
                fixture_count,
            }
        })
        .collect::<Vec<_>>();
    let selected_fixture_id = read_selected_fixture_id(settings, &fixtures);
    let camera_marker = read_marker_setting(settings, LIGHTING_CAMERA_MARKER_KEY);
    let subject_marker = read_marker_setting(settings, LIGHTING_SUBJECT_MARKER_KEY);
    let scenes = editor_state
        .scenes
        .iter()
        .map(|scene| {
            lighting_scene_snapshot_from_state(
                scene,
                last_recalled_scene_id.as_deref(),
                last_scene_recall_at.as_deref(),
            )
        })
        .collect::<Vec<_>>();
    let selected_scene_id = read_selected_scene_id(settings, &scenes);
    let cue_states = load_lighting_cues(settings);
    let active_cue_id = read_optional_setting(settings, LIGHTING_ACTIVE_CUE_ID_KEY)
        .filter(|id| cue_states.iter().any(|cue| cue.id == *id));
    let cues = cue_states
        .iter()
        .map(|cue| lighting_cue_snapshot_from_state(cue, active_cue_id.as_deref()))
        .collect::<Vec<_>>();
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
        cues,
        active_cue_id,
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
