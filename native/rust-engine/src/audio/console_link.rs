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
//! lost-reports mark), resets it to `unknown`. Nothing here ever raises confidence — only a complete pull
//! may do that.
//!
//! TotalMix heard again after it was out of touch on remote 4 (switched off,
//! or TotalMix closed; the walk of 2026-10-01) makes a known console
//! `assumed` with `AUDIO_CONSOLE_OUT_OF_TOUCH`: a change made at TotalMix
//! meanwhile may never arrive, and only a Sync reads the desk whole.
//!
//! Channel and output names come from TotalMix (2026-10-01) and are written
//! like any change made there, without a row in Recent actions. TotalMix's
//! snapshot slots stay on the link: a flush only reports that one changed.

use std::collections::HashMap;
use std::path::Path;

use crate::action_log::{ActionRecord, ActionSource, DOMAIN_AUDIO};
use crate::rme_console_link::{
    link_now_ms, shared_console_link, ChannelFlag, ConsoleBus, ConsoleUpdate, ConsoleValue,
    ControlRoomFunction, OutOfTouch, ParamKey, PendingSend,
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
    /// An earlier flush's write failed and dropped desk reports, so this one
    /// marked the desk unread: the Console asks for a Sync.
    pub desk_unread: bool,
    /// One of TotalMix's snapshot slots changed state (the link holds the
    /// slots; nothing is written): the Console reads them again.
    pub slots_changed: bool,
    /// TotalMix is back after it was out of touch, and this flush made the
    /// Console assumed.
    pub out_of_touch: bool,
}

impl ConsoleFlushReport {
    pub fn changed(&self) -> bool {
        self.applied > 0
            || self.unconfirmed > 0
            || self.connection_lost
            || self.desk_unread
            || self.slots_changed
            || self.out_of_touch
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
    let (updates, superseded, expired, marks, slots_changed) = {
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
            ConsoleMarks {
                connection_lost: link.take_connection_lost(),
                desk_unread: link.take_reports_lost(),
                out_of_touch: link.take_out_of_touch(),
            },
            link.take_snapshot_slots_changed(),
        )
    };
    // A changed slot is reported, not written. A failed write drops the mark
    // with the rest: the desk-unread flush that follows is reported too, and
    // the Console then reads the slots as the link holds them.
    let result = apply_console_activity_locked(db_path, &updates, &superseded, &expired, marks)
        .map(|report| ConsoleFlushReport {
            slots_changed,
            ..report
        });
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
    apply_console_activity_locked(
        db_path,
        updates,
        &[],
        expired,
        ConsoleMarks {
            connection_lost,
            ..ConsoleMarks::default()
        },
    )
}

/// The marks a flush takes from the console link besides its changes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct ConsoleMarks {
    /// TotalMix reported the interface gone.
    connection_lost: bool,
    /// An earlier flush's write failed and dropped what the desk reported.
    desk_unread: bool,
    /// TotalMix is heard again after it was out of touch.
    out_of_touch: Option<OutOfTouch>,
}

/// The persistence half of `flush_console_link`, for a caller that holds
/// `AUDIO_STATE_LOCK`. `superseded` are the drained updates a newer send of
/// the app's replaces: they are not written, but a change made at TotalMix
/// among them is still a row in Recent actions.
fn apply_console_activity_locked(
    db_path: &Path,
    updates: &[ConsoleUpdate],
    superseded: &[ConsoleUpdate],
    expired: &[PendingSend],
    marks: ConsoleMarks,
) -> Result<ConsoleFlushReport, AudioCommandError> {
    let ConsoleMarks {
        connection_lost,
        desk_unread,
        out_of_touch,
    } = marks;
    if updates.is_empty()
        && superseded.is_empty()
        && expired.is_empty()
        && marks == ConsoleMarks::default()
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
            // TotalMix; so is what the desk reports while a load in
            // TotalMix is under way (the load's own row says it).
            if !update.confirms_send && !update.during_load {
                actions.extend(console_update_action(&snapshot, update));
            }
        }
    }
    // A change made at TotalMix that a newer send of the app's replaces is not
    // written (the desk takes the app's value), but it happened: it is a row,
    // measured against what the app now holds.
    if superseded
        .iter()
        .any(|update| !update.confirms_send && !update.during_load)
    {
        let mut replaced_channels = channel_state.clone();
        let mut replaced_targets = mix_target_state.clone();
        for update in superseded
            .iter()
            .filter(|update| !update.confirms_send && !update.during_load)
        {
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
    // TotalMix is heard again after it was out of touch on remote 4: a change
    // made there meanwhile may never arrive (the walk of 2026-10-01), so a
    // known console is assumed until a Sync reads it whole. It comes after
    // the unconfirmed sends, so its sentence is the one shown. It never lifts
    // an unknown console, nor marks one this flush makes unknown.
    let out_of_touch = out_of_touch.filter(|_| {
        snapshot.console_state_confidence != "unknown" && !connection_lost && !desk_unread
    });
    if let Some(mark) = out_of_touch {
        writes.push(confidence_setting(ConsoleConfidence::Assumed));
        writes.push((
            String::from(AUDIO_LAST_ACTION_STATUS_KEY),
            String::from("failed"),
        ));
        writes.push((
            String::from(AUDIO_LAST_ACTION_CODE_KEY),
            String::from(AUDIO_CONSOLE_OUT_OF_TOUCH),
        ));
        writes.push((
            String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
            out_of_touch_sentence(mark),
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
        desk_unread,
        slots_changed: false,
        out_of_touch: out_of_touch.is_some(),
    })
}

/// The last action's code when TotalMix was out of touch on remote 4; the
/// Console's state display shows the sentence that goes with it.
pub(crate) const AUDIO_CONSOLE_OUT_OF_TOUCH: &str = "AUDIO_CONSOLE_OUT_OF_TOUCH";

/// The Console's sentence for an assumed desk after TotalMix was out of
/// touch.
pub(crate) fn out_of_touch_sentence(mark: OutOfTouch) -> String {
    format!(
        "TotalMix was out of touch for {}, so a change made there meanwhile may be missing. Press Sync from TotalMix.",
        out_of_touch_words(mark.secs)
    )
}

/// The last action's code when the Console is assumed because Studio
/// Control has not read the desk since it started.
pub(crate) const AUDIO_CONSOLE_UNREAD_SINCE_START: &str = "AUDIO_CONSOLE_UNREAD_SINCE_START";

/// The Console's sentence for it.
pub(crate) const UNREAD_SINCE_START_SENTENCE: &str =
    "Studio Control has not read the desk since it started. Press Sync from TotalMix.";

/// At a start on the real TotalMix (the owner's decision, 2026-10-02): a
/// console saved as aligned, or as assumed (from the last session, with
/// its reason), is assumed until a Sync, saying so for this start, as
/// TotalMix may have changed while Studio Control was closed and only a Sync
/// reads the desk whole. Every start of the hardware link counts: a restart
/// by itself, `Restart the hardware link…` and a database restore too. A
/// simulated console, and an unknown one (it already asks for a Sync), stay
/// as they are. Returns whether the Console was marked.
pub fn mark_console_unread_at_start(db_path: &Path) -> Result<bool, AudioCommandError> {
    let _state_guard = lock_audio_state();
    let settings = load_audio_settings(db_path)?;
    if audio_metering_is_simulated(&settings)
        || read_audio_snapshot(&settings).console_state_confidence == "unknown"
    {
        return Ok(false);
    }
    persist_audio_state(
        db_path,
        &[
            confidence_setting(ConsoleConfidence::Assumed),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("failed"),
            ),
            (
                String::from(AUDIO_LAST_ACTION_CODE_KEY),
                String::from(AUDIO_CONSOLE_UNREAD_SINCE_START),
            ),
            (
                String::from(AUDIO_LAST_ACTION_MESSAGE_KEY),
                String::from(UNREAD_SINCE_START_SENTENCE),
            ),
        ],
    )?;
    Ok(true)
}

/// How long TotalMix was out of touch, in the operator's words: seconds
/// under two minutes, minutes under two hours, then hours.
pub(crate) fn out_of_touch_words(secs: u64) -> String {
    if secs < 120 {
        format!("{secs} s")
    } else if secs < 2 * 60 * 60 {
        format!("{} min", secs / 60)
    } else {
        format!("{} h", secs / (60 * 60))
    }
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

/// The longest channel name the app keeps, as for a name given in the app.
const CHANNEL_NAME_MAX_CHARS: usize = 50;

/// A name TotalMix reported, as the app keeps it: trimmed, 1 to 50
/// characters, no control characters. Anything else is `None` and leaves the
/// stored name as it was.
fn console_channel_name(value: &ConsoleValue) -> Option<&str> {
    let ConsoleValue::Text(name) = value else {
        return None;
    };
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > CHANNEL_NAME_MAX_CHARS
        || name.chars().any(char::is_control)
    {
        return None;
    }
    Some(name)
}

/// Only a name that differs is written: TotalMix repeats every name in each
/// dump, and the metering thread asks for one whenever the desk has been
/// quiet for three seconds.
fn set_name_if_changed(slot: &mut Option<String>, name: &str) -> bool {
    if slot.as_deref() == Some(name) {
        false
    } else {
        *slot = Some(String::from(name));
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
        ParamKey::ChannelName {
            bus: ConsoleBus::Output,
            channel,
        } => {
            let Some(target_id) = global_output_mix_target(*channel) else {
                return false;
            };
            let Some(name) = console_channel_name(&update.value) else {
                return false;
            };
            let Some(entry) = mix_target_state_entry(snapshot, mix_target_state, target_id) else {
                return false;
            };
            set_name_if_changed(&mut entry.name, name)
        }
        ParamKey::ChannelName { bus, channel } => {
            let Some(surface_id) = global_channel_surface(bus.word(), *channel) else {
                return false;
            };
            let Some(name) = console_channel_name(&update.value) else {
                return false;
            };
            let Some((entry, _)) = channel_state_entry(snapshot, channel_state, &surface_id) else {
                return false;
            };
            set_name_if_changed(&mut entry.name, name)
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
            }
        }
        ParamKey::StatusConnection
        | ParamKey::StatusDevice
        | ParamKey::StatusDsp
        | ParamKey::SnapshotLoad { .. } => false,
    }
}

/// The action-log row for a console change that was applied: the switches,
/// named as the screen names them. `None` for a ride, a name and the status
/// parameters.
pub(crate) fn console_update_action(
    snapshot: &AudioSnapshot,
    update: &ConsoleUpdate,
) -> Option<ActionRecord> {
    // A name given at TotalMix is shown on the Console, and is not a row in
    // Recent actions (2026-10-01).
    if matches!(update.key, ParamKey::ChannelName { .. }) {
        return None;
    }
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
        last_pull_at: read_optional_setting(settings, AUDIO_LAST_CONSOLE_PULL_AT_KEY),
        last_pull_values: settings
            .get(AUDIO_LAST_CONSOLE_PULL_VALUES_KEY)
            .and_then(|value| value.parse::<i64>().ok()),
    }
}
