//! Recall = push (2026-09 audit remediation, Slice 4; operator decision 2).
//!
//! Recalling a snapshot pushes its captured console state to TotalMix in
//! four phases — mutes that turn on, then every value, then mutes that turn
//! off, then the main control room — so nothing is ever loud for a moment it
//! should not be. 48V is never pushed (each difference is listed and needs its
//! own armed confirm), talkback is momentary and never part of a recall, and
//! pad has no supported console command. Every command is registered on the
//! console link, whose read-backs decide whether the push was confirmed; app
//! state is written first and marked `assumed`, and becomes `aligned` only
//! when the console has confirmed (or adjusted) every pushed value.

use rosc::{OscMessage, OscType};
use std::collections::HashMap;

use crate::rme_console_link::{parse_console_message, ParamKey};
use crate::rme_totalmix_osc::{global_channel_target, global_output_channel};

use super::helpers::*;
use super::types::*;

const MAIN_MIX_TARGET_ID: &str = "audio-mix-main";

/// How long a recall waits for the console to read the push back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PushTiming {
    pub confirm_wait_ms: u64,
    pub poll_ms: u64,
}

impl Default for PushTiming {
    fn default() -> Self {
        Self {
            // Equals the link's confirm timeout, so by the time the wait ends
            // every pushed parameter is either confirmed, adjusted or expired.
            confirm_wait_ms: crate::rme_console_link::CONFIRM_TIMEOUT_MS,
            poll_ms: 20,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RecallPlan {
    /// `[mutes on, values, mutes off, control room]`, in send order.
    pub phases: Vec<Vec<(String, OscType)>>,
    /// The parameters the push touches, for the console link's push tracker.
    pub keys: Vec<ParamKey>,
    pub phantom_differences: Vec<PhantomDifference>,
}

impl RecallPlan {
    pub fn message_count(&self) -> usize {
        self.phases.iter().map(Vec::len).sum()
    }
}

fn flag(value: bool) -> OscType {
    OscType::Float(if value { 1.0 } else { 0.0 })
}

/// Builds the push for `contents` against the current console surface. Only
/// surfaces with a Global OSC mapping produce commands; app-local channels
/// and fields (EQ, dynamics, send modes, names) simply persist.
pub(crate) fn build_recall_plan(
    current: &AudioSnapshot,
    contents: &AudioSceneContentsSnapshot,
) -> RecallPlan {
    let mut mutes_on: Vec<(String, OscType)> = Vec::new();
    let mut values: Vec<(String, OscType)> = Vec::new();
    let mut mutes_off: Vec<(String, OscType)> = Vec::new();
    let mut control_room: Vec<(String, OscType)> = Vec::new();
    let mut phantom_differences = Vec::new();

    for channel in &current.channels {
        let Some(target) = contents.channels.get(&channel.id) else {
            continue;
        };
        let Some((bus_word, hardware_channel)) = global_channel_target(&channel.id) else {
            continue;
        };
        let is_input = bus_word == "input";
        let mix_word = if is_input { "in" } else { "pb" };

        let mute_phase = if target.mute {
            &mut mutes_on
        } else {
            &mut mutes_off
        };
        mute_phase.push((
            format!("/{bus_word}/{hardware_channel}/mute"),
            flag(target.mute),
        ));

        for mix_target in &current.mix_targets {
            let Some(output) = global_output_channel(&mix_target.id) else {
                continue;
            };
            // A send the snapshot never captured is not routed: off.
            let level = target
                .mix_levels
                .get(&mix_target.id)
                .copied()
                .unwrap_or(0.0);
            values.push((
                format!("/mix/{mix_word}/{hardware_channel}/{output}/faderlin"),
                OscType::Float(clamp_level(level) as f32),
            ));
        }
        // Solo acts on the main submix, matching the console's solo bus.
        values.push((
            format!("/mix/{mix_word}/{hardware_channel}/0/solo"),
            flag(target.solo),
        ));

        if is_input {
            if channel_supports_gain(channel) {
                values.push((
                    format!("/input/{hardware_channel}/gain"),
                    OscType::Float(clamp_gain(target.gain) as f32),
                ));
            }
            if channel_supports_phase(channel) {
                values.push((
                    format!("/input/{hardware_channel}/phase"),
                    flag(target.phase),
                ));
            }
            if channel_supports_instrument(channel) {
                values.push((
                    format!("/input/{hardware_channel}/instrument"),
                    flag(target.instrument),
                ));
            }
            if channel_supports_auto_set(channel) {
                values.push((
                    format!("/input/{hardware_channel}/autoset"),
                    flag(target.auto_set),
                ));
            }
            // 48V is deliberately not pushed (operator decision 2).
            if channel_supports_phantom(channel) && target.phantom != channel.phantom {
                phantom_differences.push(PhantomDifference {
                    channel_id: channel.id.clone(),
                    channel_name: channel.name.clone(),
                    current: channel.phantom,
                    target: target.phantom,
                });
            }
            // Pad has no supported console command; it stays app-local.
        }
    }

    for mix_target in &current.mix_targets {
        let Some(target) = contents.mix_targets.get(&mix_target.id) else {
            continue;
        };
        let Some(output) = global_output_channel(&mix_target.id) else {
            continue;
        };
        let mute_phase = if target.mute {
            &mut mutes_on
        } else {
            &mut mutes_off
        };
        mute_phase.push((format!("/output/{output}/mute"), flag(target.mute)));
        values.push((
            format!("/output/{output}/faderlin"),
            OscType::Float(clamp_level(target.volume) as f32),
        ));
        if mix_target.id == MAIN_MIX_TARGET_ID {
            control_room.push((String::from("/controlroom/dim"), flag(target.dim)));
            control_room.push((String::from("/controlroom/mainmono"), flag(target.mono)));
            // Talkback is momentary and never part of a recall.
        }
    }

    let phases = vec![mutes_on, values, mutes_off, control_room];
    let mut keys: Vec<ParamKey> = Vec::new();
    for (address, value) in phases.iter().flatten() {
        let message = OscMessage {
            addr: address.clone(),
            args: vec![value.clone()],
        };
        if let Some(parsed) = parse_console_message(&message) {
            if !keys.contains(&parsed.key) {
                keys.push(parsed.key);
            }
        }
    }
    RecallPlan {
        phases,
        keys,
        phantom_differences,
    }
}

/// The app state a recall persists: the snapshot's contents, except that
/// 48V and talkback keep the console's current values because the recall
/// never pushes them.
pub(crate) fn recalled_state_maps(
    current: &AudioSnapshot,
    contents: &AudioSceneContentsSnapshot,
) -> (
    HashMap<String, StoredAudioChannelState>,
    HashMap<String, StoredAudioMixTargetState>,
) {
    let mut channels = contents.channels.clone();
    for channel in &current.channels {
        if let Some(entry) = channels.get_mut(&channel.id) {
            entry.phantom = channel.phantom;
        }
    }
    let mut mix_targets = contents.mix_targets.clone();
    for mix_target in &current.mix_targets {
        if let Some(entry) = mix_targets.get_mut(&mix_target.id) {
            entry.talkback = mix_target.talkback;
        }
    }
    (channels, mix_targets)
}
