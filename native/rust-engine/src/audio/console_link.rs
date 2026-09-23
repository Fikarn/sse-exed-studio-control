//! Applies what the console reported back to the app's stored audio state.
//!
//! The metering thread drains `rme_console_link::shared_console_link()` every
//! `FLUSH_INTERVAL_MS`: external changes (operator at TotalMix, another
//! remote, read-back replies for parameters the app never touched), adjusted
//! sends (the console accepted something else than what was sent) and
//! confirmed sends (the app's own value, so it lands after anything the desk
//! reported before it) are written into `channels_state` / `mix_targets_state`
//! under `AUDIO_STATE_LOCK`, in one transaction, and one
//! `audio.changed { reason: "console-echo" }` follows when that changed
//! anything. Sends that were never
//! confirmed downgrade console-state confidence to `assumed` and surface as
//! `AUDIO_CONSOLE_UNCONFIRMED`; a `/status/connection 0`, or an earlier
//! flush whose write failed and dropped what the desk reported (the link's
//! lost-reports mark), resets it to `unknown`. Nothing here ever raises confidence — only a complete pull or a
//! fully confirmed push may do that.

use std::collections::HashMap;
use std::path::Path;

use crate::action_log::{ActionRecord, ActionSource, DOMAIN_AUDIO};
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
    /// The desk refused a talkback the app asked for; the refusal is recorded
    /// even when a newer talkback send meant nothing else was written.
    pub talkback_refused: bool,
    /// An earlier flush's write failed and dropped desk reports, so this one
    /// marked the desk unread: the Console asks for a Sync.
    pub desk_unread: bool,
}

impl ConsoleFlushReport {
    pub fn changed(&self) -> bool {
        self.applied > 0
            || self.unconfirmed > 0
            || self.connection_lost
            || self.talkback_refused
            || self.desk_unread
    }
}

/// Drains the shared console link and persists whatever it produced. Safe to
/// call every tick: it touches the database only when there is something to
/// write.
///
/// The app's audio state is locked before the link gives up what it holds and
/// stays locked until it is written (lock order: state, then link). A flush
/// that took the reports first and waited for the state afterwards could write
/// them after a write of the app's that came later — a recall's, an edit's, or
/// another flush that took the confirmations that followed them.
pub fn flush_console_link(db_path: &Path) -> Result<ConsoleFlushReport, AudioCommandError> {
    flush_console_link_at(db_path, link_now_ms())
}

/// [`flush_console_link`] on the link's clock at `now_ms`, which decides
/// whether a lost-reports mark is due again (tests hand it in).
///
/// A flush whose write fails has already taken what it wrote from the link,
/// and it is not put back: kept, it would pile up while the database stays
/// down, and a report kept past a newer edit of the app's could later be
/// written over it. Instead the link is marked, so the next flush that writes
/// marks the desk unread and the Console asks for a Sync, which reads the
/// desk again.
pub(crate) fn flush_console_link_at(
    db_path: &Path,
    now_ms: u64,
) -> Result<ConsoleFlushReport, AudioCommandError> {
    let started = std::time::Instant::now();
    let link = shared_console_link();
    let lock_link = || match link.lock() {
        Ok(link) => link,
        Err(poisoned) => poisoned.into_inner(),
    };
    if !lock_link().has_activity_at(now_ms) {
        return Ok(ConsoleFlushReport::default());
    }
    let _state_guard = lock_audio_state();
    let (updates, superseded, expired, connection_lost, desk_unread) = {
        let mut link = lock_link();
        // A report or a confirmation of a parameter the app has sent again
        // since is older than that send: the desk takes the app's newer value,
        // and its own read-back will confirm, adjust or expire it. (The link
        // queues nothing for a parameter while a send of it is pending, and
        // every edit registers its send under the state lock this flush holds,
        // before it writes.)
        let queued = link.take_queued();
        let (superseded, updates): (Vec<ConsoleUpdate>, Vec<ConsoleUpdate>) = queued
            .into_iter()
            .partition(|update| link.has_pending(&update.key));
        (
            updates,
            superseded,
            link.take_expired(),
            link.take_connection_lost(),
            link.take_reports_lost(),
        )
    };
    let result = apply_console_activity_locked(
        db_path,
        &updates,
        &superseded,
        &expired,
        connection_lost,
        desk_unread,
    );
    if result.is_err() {
        // Under the state lock, so no Sync or recall writes `aligned` between
        // this failure and the mark. The retry is counted from the failure,
        // not from the start: a write that waited out a locked database (up
        // to 5 s) must not be tried again on the very next tick.
        let failed_at =
            now_ms.saturating_add(u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX));
        lock_link().mark_reports_lost(failed_at);
    }
    result
}

/// The persistence half of [`flush_console_link`], separated so tests can
/// feed it directly.
#[cfg(test)]
pub(crate) fn apply_console_activity(
    db_path: &Path,
    updates: &[ConsoleUpdate],
    expired: &[PendingSend],
    connection_lost: bool,
) -> Result<ConsoleFlushReport, AudioCommandError> {
    let _state_guard = lock_audio_state();
    apply_console_activity_locked(db_path, updates, &[], expired, connection_lost, false)
}

/// The persistence half of `flush_console_link`, for a caller that holds
/// `AUDIO_STATE_LOCK`. `superseded` are the drained updates a newer send of
/// the app's replaces: they are not written, but a change made at TotalMix
/// among them is still a row in Recent actions, and a talkback refusal among
/// them is still acted on.
fn apply_console_activity_locked(
    db_path: &Path,
    updates: &[ConsoleUpdate],
    superseded: &[ConsoleUpdate],
    expired: &[PendingSend],
    connection_lost: bool,
    desk_unread: bool,
) -> Result<ConsoleFlushReport, AudioCommandError> {
    // A talkback the app asked for that the console answered with "off" is a
    // refusal, not a mystery. Live on the studio UFX III (2026-09-04): with
    // no talkback input channel assigned in TotalMix (`/controlroom/talkchannel
    // -1`) the desk ignores `/controlroom/talkback 1` from every remote and
    // reports 0, so the app must say so instead of silently flipping back —
    // and the hold is dropped so the watchdog has nothing to release. A
    // talkback the desk refused is a refusal even when the app has sent
    // talkback again since (a release, or a press right after it).
    let talkback_refused = updates.iter().chain(superseded).any(|update| {
        update.adjusted
            && matches!(
                update.key,
                ParamKey::ControlRoom(ControlRoomFunction::Talkback)
            )
            && matches!(update.value, ConsoleValue::Flag(false))
    });
    if updates.is_empty()
        && superseded.is_empty()
        && expired.is_empty()
        && !connection_lost
        && !desk_unread
    {
        return Ok(ConsoleFlushReport::default());
    }

    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    let mut channel_state = read_channel_state_map(&app_settings);
    let mut mix_target_state = read_mix_target_state_map(&app_settings);

    // The action log (Slice 11 — F30): a change made at TotalMix is the
    // console's, and this flush is where it enters the app. A switch that
    // actually changed is a row; a fader, a gain and a volume are rides.
    let mut applied = 0usize;
    let mut actions: Vec<ActionRecord> = Vec::new();
    for update in updates {
        if apply_console_update(&snapshot, &mut channel_state, &mut mix_target_state, update) {
            applied += 1;
            // A confirmation of the app's own send is the app's action,
            // already recorded where it was asked for, not a change at
            // TotalMix.
            if !update.confirms_send {
                actions.extend(console_update_action(&snapshot, update));
            }
        }
    }
    // A change made at TotalMix that a newer send of the app's replaces is not
    // written (the desk takes the app's value), but it happened: it is a row,
    // measured against what the app now holds.
    if superseded.iter().any(|update| !update.confirms_send) {
        let mut replaced_channels = channel_state.clone();
        let mut replaced_targets = mix_target_state.clone();
        for update in superseded.iter().filter(|update| !update.confirms_send) {
            if apply_console_update(
                &snapshot,
                &mut replaced_channels,
                &mut replaced_targets,
                update,
            ) {
                actions.extend(console_update_action(&snapshot, update));
            }
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
    if talkback_refused {
        super::talkback::clear_talkback_hold(db_path, MAIN_MIX_TARGET_ID);
        writes.push((
            String::from(AUDIO_LAST_ACTION_STATUS_KEY),
            String::from("failed"),
        ));
        writes.push((
            String::from(AUDIO_LAST_ACTION_CODE_KEY),
            String::from("AUDIO_TALKBACK_REFUSED"),
        ));
        writes.push((
            String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
            String::from(
                "TotalMix kept talkback off. Assign a talkback input channel in TotalMix \
                 (Options › Settings › Mixer › Talkback); with none assigned the desk \
                 ignores talkback from every remote.",
            ),
        ));
    }
    // TotalMix reported the interface gone, or an earlier write failed and
    // dropped what the desk reported: either way the app no longer knows what
    // the desk is set to.
    if connection_lost || desk_unread {
        writes.push(confidence_setting(ConsoleConfidence::Unknown));
    }
    if !writes.is_empty() || !actions.is_empty() {
        persist_audio_state_with_actions(db_path, &writes, &actions)?;
    }

    Ok(ConsoleFlushReport {
        applied,
        unconfirmed: expired.len(),
        connection_lost,
        talkback_refused,
        desk_unread,
    })
}

/// A confirmation carries the level the app sent, which travelled as a 32-bit
/// float: a stored level that rounds to it is the level the app sent, so the
/// confirmation changes nothing.
fn confirms_own_level(update: &ConsoleUpdate, stored: f64, confirmed: f64) -> bool {
    update.confirms_send && stored as f32 == confirmed as f32
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
            if confirms_own_level(update, entry.volume, position) {
                return false;
            }
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
            let mut changed = false;
            match entry.mix_levels.get(target_id).copied() {
                Some(previous) if confirms_own_level(update, previous, position) => {}
                previous => {
                    entry.mix_levels.insert(String::from(target_id), position);
                    changed = previous
                        .map(|previous| (previous - position).abs() > f64::EPSILON)
                        .unwrap_or(true);
                }
            }
            if target_id == MAIN_MIX_TARGET_ID && !confirms_own_level(update, entry.fader, position)
            {
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

/// The action-log row for a console change that was applied: the switches,
/// named as the screen names them. `None` for a ride and for the status
/// parameters.
pub(crate) fn console_update_action(
    snapshot: &AudioSnapshot,
    update: &ConsoleUpdate,
) -> Option<ActionRecord> {
    let on = value_to_flag(&update.value)?;
    let word = if on { "on" } else { "off" };
    let channel_name = |surface_id: &str| {
        snapshot
            .channels
            .iter()
            .find(|entry| entry.id == surface_id)
            .map(|entry| entry.name.clone())
    };
    let mix_target_name = |target_id: &str| {
        snapshot
            .mix_targets
            .iter()
            .find(|entry| entry.id == target_id)
            .map(|entry| entry.name.clone())
    };
    let (action, label, target) = match &update.key {
        ParamKey::ChannelFlag {
            bus: ConsoleBus::Output,
            channel,
            flag: ChannelFlag::Mute,
        } => (
            "mute",
            "Mute",
            mix_target_name(global_output_mix_target(*channel)?)?,
        ),
        ParamKey::ChannelFlag { bus, channel, flag } => {
            let name = channel_name(&global_channel_surface(bus.word(), *channel)?)?;
            match flag {
                ChannelFlag::Mute => ("mute", "Mute", name),
                ChannelFlag::Phantom => ("phantom", "48 V", name),
                ChannelFlag::Phase => ("phase", "Phase invert", name),
                ChannelFlag::Instrument => ("instrument", "Instrument input", name),
                ChannelFlag::AutoSet => ("auto-set", "AutoSet", name),
                ChannelFlag::Pad => ("pad", "Pad", name),
            }
        }
        ParamKey::MixSolo { bus, channel, .. } => (
            "solo",
            "Solo",
            channel_name(&global_channel_surface(bus.word(), *channel)?)?,
        ),
        ParamKey::ControlRoom(function) => {
            let name = mix_target_name(MAIN_MIX_TARGET_ID)?;
            match function {
                ControlRoomFunction::Dim => ("dim", "Dim", name),
                ControlRoomFunction::MainMono => ("mono", "Mono", name),
                ControlRoomFunction::Talkback => ("talkback", "Talkback", name),
            }
        }
        _ => return None,
    };
    Some(ActionRecord::new(
        ActionSource::Console,
        DOMAIN_AUDIO,
        action,
        target.clone(),
        format!("{label} {word} at TotalMix: {target}"),
    ))
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
