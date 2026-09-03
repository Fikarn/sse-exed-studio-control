//! Applies what the console reported back to the app's stored audio state.
//!
//! The metering thread drains `rme_console_link::shared_console_link()` every
//! `FLUSH_INTERVAL_MS`: external changes (operator at TotalMix, another
//! remote, read-back replies for parameters the app never touched) and
//! adjusted sends (the console accepted something else than what was sent)
//! are written into `channels_state` / `mix_targets_state` under
//! `AUDIO_STATE_LOCK`, in one transaction, and one
//! `audio.changed { reason: "console-echo" }` follows. Sends that were never
//! confirmed downgrade console-state confidence to `assumed` and surface as
//! `AUDIO_CONSOLE_UNCONFIRMED`; a `/status/connection 0` resets it to
//! `unknown`. Nothing here ever raises confidence — only a complete pull or a
//! fully confirmed push may do that.

use std::collections::HashMap;
use std::path::Path;

use crate::rme_console_link::{
    link_now_ms, shared_console_link, ChannelFlag, ConsoleBus, ConsoleUpdate, ConsoleValue,
    ControlRoomFunction, ParamKey, PendingSend,
};
use crate::rme_totalmix_osc::{global_channel_surface, global_output_mix_target};

use super::fader_curve::fader_db_to_lin;
use super::helpers::*;
use super::types::*;
use super::*;

const MAIN_MIX_TARGET_ID: &str = "audio-mix-main";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConsoleFlushReport {
    /// Console changes that actually altered stored state.
    pub applied: usize,
    /// Sends that timed out without confirmation in this flush.
    pub unconfirmed: usize,
    pub connection_lost: bool,
}

impl ConsoleFlushReport {
    pub fn changed(&self) -> bool {
        self.applied > 0 || self.unconfirmed > 0 || self.connection_lost
    }
}

/// Drains the shared console link and persists whatever it produced. Safe to
/// call every tick: it touches the database only when there is something to
/// write.
pub fn flush_console_link(db_path: &Path) -> Result<ConsoleFlushReport, AudioCommandError> {
    let (updates, expired, connection_lost) = {
        let link = shared_console_link();
        let mut link = match link.lock() {
            Ok(link) => link,
            Err(poisoned) => poisoned.into_inner(),
        };
        (
            link.take_queued(),
            link.take_expired(),
            link.take_connection_lost(),
        )
    };
    apply_console_activity(db_path, &updates, &expired, connection_lost)
}

/// The persistence half of [`flush_console_link`], separated so tests can
/// feed it directly.
pub(crate) fn apply_console_activity(
    db_path: &Path,
    updates: &[ConsoleUpdate],
    expired: &[PendingSend],
    connection_lost: bool,
) -> Result<ConsoleFlushReport, AudioCommandError> {
    if updates.is_empty() && expired.is_empty() && !connection_lost {
        return Ok(ConsoleFlushReport::default());
    }

    let _state_guard = lock_audio_state();
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    let mut channel_state = read_channel_state_map(&app_settings);
    let mut mix_target_state = read_mix_target_state_map(&app_settings);

    let mut applied = 0usize;
    for update in updates {
        if apply_console_update(&snapshot, &mut channel_state, &mut mix_target_state, update) {
            applied += 1;
        }
    }

    let mut writes: Vec<(String, String)> = Vec::new();
    if applied > 0 {
        writes.push((
            String::from(AUDIO_CHANNEL_STATE_KEY),
            serialize_json_state(&channel_state)?,
        ));
        writes.push((
            String::from(AUDIO_MIX_TARGET_STATE_KEY),
            serialize_json_state(&mix_target_state)?,
        ));
    }
    if !expired.is_empty() {
        let mut names: Vec<String> = expired.iter().map(|send| send.key.describe()).collect();
        names.sort();
        names.dedup();
        let listed = if names.len() > 6 {
            format!("{} and {} more", names[..6].join(", "), names.len() - 6)
        } else {
            names.join(", ")
        };
        // A send the console never confirmed leaves the app's state assumed,
        // never aligned. The operator recovers with Sync (a console pull).
        writes.push(confidence_setting(ConsoleConfidence::Assumed));
        writes.push((
            String::from(AUDIO_LAST_ACTION_STATUS_KEY),
            String::from("failed"),
        ));
        writes.push((
            String::from(AUDIO_LAST_ACTION_CODE_KEY),
            String::from("AUDIO_CONSOLE_UNCONFIRMED"),
        ));
        writes.push((
            String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
            format!(
                "TotalMix did not confirm {} change{} ({}). Press Sync to pull the console state.",
                expired.len(),
                if expired.len() == 1 { "" } else { "s" },
                listed
            ),
        ));
    }
    if connection_lost {
        writes.push(confidence_setting(ConsoleConfidence::Unknown));
    }
    if !writes.is_empty() {
        persist_audio_state(db_path, &writes)?;
    }

    Ok(ConsoleFlushReport {
        applied,
        unconfirmed: expired.len(),
        connection_lost,
    })
}

fn value_to_position(value: &ConsoleValue) -> Option<f64> {
    match value {
        ConsoleValue::Position(position) => Some(clamp_level(*position)),
        ConsoleValue::Db(db) => Some(fader_db_to_lin(*db)),
        _ => None,
    }
}

fn value_to_flag(value: &ConsoleValue) -> Option<bool> {
    match value {
        ConsoleValue::Flag(flag) => Some(*flag),
        ConsoleValue::Number(number) => Some(*number >= 0.5),
        _ => None,
    }
}

fn channel_state_entry<'a>(
    snapshot: &AudioSnapshot,
    channel_state: &'a mut HashMap<String, StoredAudioChannelState>,
    surface_id: &str,
) -> Option<(&'a mut StoredAudioChannelState, AudioChannelSnapshot)> {
    let channel = snapshot
        .channels
        .iter()
        .find(|entry| entry.id == surface_id)?
        .clone();
    let entry = channel_state
        .entry(surface_id.to_string())
        .or_insert_with(|| stored_channel_state_from_snapshot(&channel));
    Some((entry, channel))
}

fn mix_target_state_entry<'a>(
    snapshot: &AudioSnapshot,
    mix_target_state: &'a mut HashMap<String, StoredAudioMixTargetState>,
    mix_target_id: &str,
) -> Option<&'a mut StoredAudioMixTargetState> {
    let mix_target = snapshot
        .mix_targets
        .iter()
        .find(|entry| entry.id == mix_target_id)?;
    Some(
        mix_target_state
            .entry(mix_target_id.to_string())
            .or_insert_with(|| stored_mix_target_state_from_snapshot(mix_target)),
    )
}

fn set_if_changed<T: PartialEq + Copy>(slot: &mut T, next: T) -> bool {
    if *slot == next {
        false
    } else {
        *slot = next;
        true
    }
}

/// Applies one console change to the stored state maps. Returns `true` only
/// when a value actually changed, so read-back replies that merely restate
/// the app's own state cause no write and no event.
pub(crate) fn apply_console_update(
    snapshot: &AudioSnapshot,
    channel_state: &mut HashMap<String, StoredAudioChannelState>,
    mix_target_state: &mut HashMap<String, StoredAudioMixTargetState>,
    update: &ConsoleUpdate,
) -> bool {
    match &update.key {
        ParamKey::ChannelFlag {
            bus: ConsoleBus::Output,
            channel,
            flag: ChannelFlag::Mute,
        } => {
            let Some(target_id) = global_output_mix_target(*channel) else {
                return false;
            };
            let Some(flag) = value_to_flag(&update.value) else {
                return false;
            };
            let Some(entry) = mix_target_state_entry(snapshot, mix_target_state, target_id) else {
                return false;
            };
            set_if_changed(&mut entry.mute, flag)
        }
        ParamKey::ChannelFlag { bus, channel, flag } => {
            let Some(surface_id) = global_channel_surface(bus.word(), *channel) else {
                return false;
            };
            let Some(value) = value_to_flag(&update.value) else {
                return false;
            };
            let Some((entry, channel)) = channel_state_entry(snapshot, channel_state, &surface_id)
            else {
                return false;
            };
            match flag {
                ChannelFlag::Mute => set_if_changed(&mut entry.mute, value),
                ChannelFlag::Phantom if channel_supports_phantom(&channel) => {
                    set_if_changed(&mut entry.phantom, value)
                }
                ChannelFlag::Phase if channel_supports_phase(&channel) => {
                    set_if_changed(&mut entry.phase, value)
                }
                ChannelFlag::Instrument if channel_supports_instrument(&channel) => {
                    set_if_changed(&mut entry.instrument, value)
                }
                ChannelFlag::AutoSet if channel_supports_auto_set(&channel) => {
                    set_if_changed(&mut entry.auto_set, value)
                }
                ChannelFlag::Pad if channel_supports_pad(&channel) => {
                    set_if_changed(&mut entry.pad, value)
                }
                _ => false,
            }
        }
        ParamKey::InputGain { channel } => {
            let Some(surface_id) = global_channel_surface("input", *channel) else {
                return false;
            };
            let ConsoleValue::Db(db) = update.value else {
                return false;
            };
            let Some((entry, channel)) = channel_state_entry(snapshot, channel_state, &surface_id)
            else {
                return false;
            };
            if !channel_supports_gain(&channel) {
                return false;
            }
            set_if_changed(&mut entry.gain, clamp_gain(db.round() as i64))
        }
        ParamKey::OutputVolume { output } => {
            let Some(target_id) = global_output_mix_target(*output) else {
                return false;
            };
            let Some(position) = value_to_position(&update.value) else {
                return false;
            };
            let Some(entry) = mix_target_state_entry(snapshot, mix_target_state, target_id) else {
                return false;
            };
            set_if_changed(&mut entry.volume, position)
        }
        ParamKey::MixFader {
            bus,
            channel,
            output,
        } => {
            let Some(surface_id) = global_channel_surface(bus.word(), *channel) else {
                return false;
            };
            let Some(target_id) = global_output_mix_target(*output) else {
                return false;
            };
            let Some(position) = value_to_position(&update.value) else {
                return false;
            };
            let Some((entry, _)) = channel_state_entry(snapshot, channel_state, &surface_id) else {
                return false;
            };
            let mut changed = entry
                .mix_levels
                .insert(String::from(target_id), position)
                .map(|previous| (previous - position).abs() > f64::EPSILON)
                .unwrap_or(true);
            if target_id == MAIN_MIX_TARGET_ID {
                changed |= set_if_changed(&mut entry.fader, position);
            }
            changed
        }
        ParamKey::MixSolo {
            bus,
            channel,
            output,
        } => {
            if *output != 0 {
                return false;
            }
            let Some(surface_id) = global_channel_surface(bus.word(), *channel) else {
                return false;
            };
            let Some(flag) = value_to_flag(&update.value) else {
                return false;
            };
            let Some((entry, _)) = channel_state_entry(snapshot, channel_state, &surface_id) else {
                return false;
            };
            set_if_changed(&mut entry.solo, flag)
        }
        ParamKey::ControlRoom(function) => {
            let Some(flag) = value_to_flag(&update.value) else {
                return false;
            };
            let Some(entry) =
                mix_target_state_entry(snapshot, mix_target_state, MAIN_MIX_TARGET_ID)
            else {
                return false;
            };
            match function {
                ControlRoomFunction::Dim => set_if_changed(&mut entry.dim, flag),
                ControlRoomFunction::MainMono => set_if_changed(&mut entry.mono, flag),
                ControlRoomFunction::Talkback => set_if_changed(&mut entry.talkback, flag),
            }
        }
        ParamKey::StatusConnection
        | ParamKey::StatusDevice
        | ParamKey::StatusDsp
        | ParamKey::SnapshotLoad { .. } => false,
    }
}

/// The console-link part of `audio.snapshot`, read from the shared link plus
/// the persisted pull bookkeeping.
pub fn console_link_snapshot(settings: &HashMap<String, String>) -> AudioConsoleLinkSnapshot {
    let summary = {
        let link = shared_console_link();
        let link = match link.lock() {
            Ok(link) => link,
            Err(poisoned) => poisoned.into_inner(),
        };
        link.summary(link_now_ms())
    };
    AudioConsoleLinkSnapshot {
        slot_bound: summary.slot_bound,
        connection: String::from(summary.connection.as_str()),
        device: summary.device,
        dsp_load: summary.dsp_load,
        last_echo_age_ms: summary.last_echo_age_ms.map(|age| age as i64),
        pending_sends: summary.pending_sends as i64,
        unconfirmed_sends: summary.unconfirmed_sends as i64,
        unconfirmed_addresses: summary.unconfirmed_addresses,
        confirmed_sends: summary.confirmed_sends as i64,
        adjusted_sends: summary.adjusted_sends as i64,
        external_changes: summary.external_changes as i64,
        active_console_snapshot: summary.active_snapshot.map(|number| number as i64),
        last_pull_at: read_optional_setting(settings, AUDIO_LAST_CONSOLE_PULL_AT_KEY),
        last_pull_values: settings
            .get(AUDIO_LAST_CONSOLE_PULL_VALUES_KEY)
            .and_then(|value| value.parse::<i64>().ok()),
    }
}
