//! TotalMix's own snapshots (2026-10-01, the studio walk).
//!
//! The Console's snapshots are TotalMix's eight; the app keeps none of its
//! own, stores none and names none. A load goes to TotalMix as
//! `/snapshot/load/N` with `1.0` on the Global OSC remote, and only from a
//! studio build: a development build never loads a mix in TotalMix, whichever
//! console it reaches. The page asks for a load only at the operator's second
//! press on the slot; nothing else asks (the deck's one-press recall went with
//! the app's own snapshots).
//!
//! TotalMix reports each slot on `/snapshot/load/N`: 0 off, 2 active, 3
//! changed. Whether it reports a load to the remote that sent it is read on
//! the walk (it echoes no value written over Global OSC), so a load waits a
//! moment for that report, reads the desk back as Sync does, and marks the
//! slot active itself when the desk said nothing. A read-back that fails
//! after the load went out is no failed load: the desk has the mix, and the
//! Console asks for a Sync.

use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use studio_control_protocol::development::studio_build;

use crate::rme_console_link::{link_now_ms, shared_console_link, SnapshotSlotState};
use crate::rme_totalmix_names::{
    names_source, refresh_totalmix_snapshot_names, totalmix_snapshot_names, SNAPSHOT_SLOTS,
};
use crate::rme_totalmix_osc::{send_console_snapshot_load, SIMULATED_AUDIO_SOURCE};

use super::helpers::*;
use super::sync::{pull_console_state, PullCause, PullTiming};
use super::types::*;
use super::*;

/// How a load waits for TotalMix before it reads the desk back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoadTiming {
    /// How long the load waits for TotalMix to report the slot it loaded.
    /// The read-back follows either way, and a desk that has not finished
    /// loading would answer with the mix before.
    pub report_wait_ms: u64,
    pub poll_ms: u64,
    pub pull: PullTiming,
}

impl Default for LoadTiming {
    fn default() -> Self {
        Self {
            report_wait_ms: 500,
            poll_ms: 10,
            pull: PullTiming::default(),
        }
    }
}

pub fn load_audio_console_snapshot(
    db_path: &Path,
    request: &AudioSnapshotLoadRequest,
) -> Result<AudioSnapshotLoadResult, AudioCommandError> {
    load_audio_console_snapshot_with(db_path, request, LoadTiming::default(), studio_build())
}

/// [`load_audio_console_snapshot`] with the waits and the build kind given:
/// the engine's own tests are development builds, and only a studio build
/// loads a mix on a real console.
pub fn load_audio_console_snapshot_with(
    db_path: &Path,
    request: &AudioSnapshotLoadRequest,
    timing: LoadTiming,
    studio: bool,
) -> Result<AudioSnapshotLoadResult, AudioCommandError> {
    let slot = request.slot;
    if !(1..=SNAPSHOT_SLOTS).contains(&slot) {
        return Err(AudioCommandError::Rejected(
            "AUDIO_SNAPSHOT_SLOT_INVALID",
            format!("TotalMix has slots 1 to {SNAPSHOT_SLOTS}; there is no slot {slot}."),
        ));
    }
    let (config, loaded_at) = {
        let _state_guard = lock_audio_state();
        let app_settings = load_audio_settings(db_path)?;
        let snapshot = read_audio_snapshot(&app_settings);
        ensure_audio_action_allowed(db_path, &snapshot)?;
        (
            resolve_audio_config(&app_settings),
            current_timestamp(db_path)?,
        )
    };
    let name = totalmix_snapshot_names().names[slot - 1].clone();
    let label = slot_label(slot, name.as_deref());
    let result = |summary: String, confidence: &str, pulled_values: i64, reported: bool| {
        AudioSnapshotLoadResult {
            loaded: true,
            slot: slot as i64,
            name: name.clone(),
            loaded_at: loaded_at.clone(),
            summary,
            console_state_confidence: String::from(confidence),
            pulled_values,
            total_mix_reported: reported,
        }
    };

    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        if let Ok(mut link) = shared_console_link().lock() {
            link.mark_snapshot_loaded(slot);
        }
        refresh_console_snapshot_names(true);
        let summary =
            format!("Loaded {label} on the simulated console; nothing was sent (test mode).");
        let _state_guard = lock_audio_state();
        persist_audio_state(
            db_path,
            &[
                confidence_setting(ConsoleConfidence::Aligned),
                (
                    String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                    loaded_at.clone(),
                ),
                (
                    String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                    String::from("simulated-load"),
                ),
                (
                    String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                    String::from("succeeded"),
                ),
                (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
                (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
            ],
        )?;
        return Ok(result(summary, "aligned", 0, false));
    }

    if !studio {
        let message = String::from(
            "A development run never loads a mix in TotalMix; only the studio's build does.",
        );
        record_audio_action_failure(db_path, "AUDIO_SNAPSHOT_LOAD_STUDIO_ONLY", &message)?;
        return Err(AudioCommandError::Rejected(
            "AUDIO_SNAPSHOT_LOAD_STUDIO_ONLY",
            message,
        ));
    }

    let link = shared_console_link();
    let seq_before = {
        let guard = link.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !guard.slot_bound {
            let message = format!(
                "Nothing was sent: Studio Control is not listening on TotalMix's port {}. Check Setup.",
                config.receive_port + 3
            );
            drop(guard);
            record_audio_action_failure(db_path, "AUDIO_GLOBAL_OSC_UNBOUND", &message)?;
            return Err(AudioCommandError::Rejected(
                "AUDIO_GLOBAL_OSC_UNBOUND",
                message,
            ));
        }
        guard.snapshot_report_seq()
    };

    if let Err(message) = send_console_snapshot_load(&config.send_host, config.send_port, slot) {
        record_audio_action_failure(db_path, "AUDIO_SNAPSHOT_LOAD_FAILED", &message)?;
        return Err(AudioCommandError::Rejected(
            "AUDIO_SNAPSHOT_LOAD_FAILED",
            message,
        ));
    }

    // TotalMix's own word that it loaded the slot, when it gives one.
    let reported_after_send = || {
        link.lock()
            .ok()
            .and_then(|guard| guard.snapshot_slot(slot))
            .is_some_and(|(state, seq)| {
                seq > seq_before
                    && matches!(
                        state,
                        SnapshotSlotState::Active | SnapshotSlotState::Changed
                    )
            })
    };
    let started = Instant::now();
    let wait = Duration::from_millis(timing.report_wait_ms);
    while !reported_after_send() && started.elapsed() < wait {
        thread::sleep(Duration::from_millis(timing.poll_ms.max(1)));
    }

    match pull_console_state(
        db_path,
        &config,
        timing.pull,
        PullCause::Load { label: &label },
    ) {
        Ok(pulled) => {
            let reported = reported_after_send();
            if !reported {
                // The desk answered the read-back but said nothing about the
                // slot: what it now holds is the load's, so the slot is marked
                // as TotalMix would have reported it.
                if let Ok(mut guard) = link.lock() {
                    guard.mark_snapshot_loaded(slot);
                }
            }
            refresh_console_snapshot_names(false);
            Ok(result(
                pulled.summary,
                &pulled.console_state_confidence,
                pulled.pulled_values,
                reported,
            ))
        }
        // The pull wrote the failure, with confidence `unknown`; the load
        // itself went out, so the reply says it did.
        Err(AudioCommandError::Rejected(_, message)) => {
            Ok(result(message, "unknown", 0, reported_after_send()))
        }
        Err(error) => Err(error),
    }
}

/// How a slot is named in the engine's sentences and the action log: its
/// TotalMix name, or its number. The engine's words never say "snapshot".
fn slot_label(slot: usize, name: Option<&str>) -> String {
    name.map(String::from)
        .unwrap_or_else(|| format!("slot {slot}"))
}

/// TotalMix's eight slots as `audio.snapshot` shows them: the states the
/// console link holds and the names TotalMix last saved. Reads no file.
pub(crate) fn console_snapshots_now() -> AudioConsoleSnapshots {
    let names = totalmix_snapshot_names();
    let states: Vec<SnapshotSlotState> = match shared_console_link().lock() {
        Ok(link) => (1..=SNAPSHOT_SLOTS)
            .map(|slot| {
                link.snapshot_slot(slot)
                    .map(|(state, _)| state)
                    .unwrap_or(SnapshotSlotState::Unknown)
            })
            .collect(),
        Err(_) => vec![SnapshotSlotState::Unknown; SNAPSHOT_SLOTS],
    };
    AudioConsoleSnapshots {
        slots: states
            .into_iter()
            .enumerate()
            .map(|(index, state)| AudioConsoleSnapshotSlot {
                slot: index as i64 + 1,
                name: names.names[index].clone(),
                state: String::from(slot_state_word(state)),
            })
            .collect(),
        names_saved_at: names.saved_at,
        names_note: names.note,
    }
}

fn slot_state_word(state: SnapshotSlotState) -> &'static str {
    match state {
        SnapshotSlotState::Unknown => "unknown",
        SnapshotSlotState::Off => "off",
        SnapshotSlotState::Active => "active",
        SnapshotSlotState::Changed => "changed",
    }
}

/// At the start, off the request thread: the names TotalMix saved, so the
/// Console shows them before the first Sync.
pub fn refresh_console_snapshot_names_at_start(db_path: &Path) {
    let simulated = load_audio_settings(db_path)
        .map(|settings| audio_metering_is_simulated(&settings))
        .unwrap_or(true);
    thread::spawn(move || refresh_console_snapshot_names(simulated));
}

/// Looks at the names TotalMix saved again (only a studio build on the real
/// console reads TotalMix's file; it is read again only when it changed).
pub(crate) fn refresh_console_snapshot_names(simulated: bool) {
    // The names module's tests read the process-wide names under this lock; a
    // Sync or a load in another test must not change them in between.
    #[cfg(test)]
    let _names = crate::rme_totalmix_names::NAMES_CACHE_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let device = shared_console_link()
        .lock()
        .ok()
        .and_then(|link| link.summary(link_now_ms()).device);
    refresh_totalmix_snapshot_names(names_source(studio_build(), simulated), device.as_deref());
}
