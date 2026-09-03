//! Sync = console pull (2026-09 audit remediation, Slice 3; operator decision 1).
//!
//! Sync never changes hardware. It asks TotalMix for a full dump over the
//! Global OSC remote (`/sendall 2` + `/sendstate`), lets the console link
//! ingest every parameter the app models (the metering thread applies them as
//! they arrive), waits for the burst to go quiet, treats the mix nodes the
//! console omitted as off (`/sendall 2` lists only nodes above -65 dB), and
//! only then writes `aligned`. No answer → `AUDIO_SYNC_NO_ECHO`; a dump that
//! never ends → `AUDIO_SYNC_INCOMPLETE`; both leave confidence `unknown` and
//! keep whatever arrived. In simulated input mode there is no console to
//! pull; the simulated console mirrors the app and sync just says so.
//!
//! Measured on the studio UFX III: a dump is ~3 000–3 500 messages and ends
//! ~220–270 ms after the request; status arrives at the start, not the end.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use crate::audio_backend::AudioBackendConfig;
use crate::rme_console_link::{
    link_now_ms, shared_console_link, ConsoleBus, ConsoleLinkState, PullProgress,
};
use crate::rme_totalmix_osc::{
    global_channel_target, global_output_channel, send_console_pull_request, SIMULATED_AUDIO_SOURCE,
};

use super::helpers::*;
use super::types::*;
use super::*;

/// How a pull decides that the dump has ended, or gives up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PullTiming {
    /// Silence on the control stream that ends the dump.
    pub quiet_ms: u64,
    /// Hard stop; a dump still flowing at this point is incomplete.
    pub timeout_ms: u64,
    pub poll_ms: u64,
}

impl Default for PullTiming {
    fn default() -> Self {
        Self {
            quiet_ms: 300,
            timeout_ms: 3_000,
            poll_ms: 20,
        }
    }
}

pub fn sync_audio_console(db_path: &Path) -> Result<AudioSyncResult, AudioCommandError> {
    sync_audio_console_with_timing(db_path, PullTiming::default())
}

pub fn sync_audio_console_with_timing(
    db_path: &Path,
    timing: PullTiming,
) -> Result<AudioSyncResult, AudioCommandError> {
    let app_settings = load_audio_settings(db_path)?;
    let snapshot = read_audio_snapshot(&app_settings);
    ensure_audio_action_allowed(db_path, &snapshot)?;
    let config = resolve_audio_config(&app_settings);
    if config.metering_source == SIMULATED_AUDIO_SOURCE {
        return sync_simulated_console(db_path);
    }
    pull_console_state(db_path, &config, timing)
}

fn sync_simulated_console(db_path: &Path) -> Result<AudioSyncResult, AudioCommandError> {
    let synced_at = current_timestamp(db_path)?;
    let summary =
        String::from("Simulated console mirrors the app; nothing was pulled (test mode).");
    persist_audio_state(
        db_path,
        &[
            confidence_setting(ConsoleConfidence::Aligned),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                synced_at.clone(),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                String::from("simulated-sync"),
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
        ],
    )?;
    Ok(AudioSyncResult {
        synced: true,
        synced_at,
        summary,
        console_state_confidence: String::from("aligned"),
        pulled_values: 0,
        channels: 0,
        mix_targets: 0,
        complete: true,
        connection: String::from("simulated"),
    })
}

fn lock_link(link: &Arc<Mutex<ConsoleLinkState>>) -> MutexGuard<'_, ConsoleLinkState> {
    link.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn fail(
    db_path: &Path,
    code: &'static str,
    message: String,
    confidence: Option<ConsoleConfidence>,
) -> AudioCommandError {
    if let Some(confidence) = confidence {
        if let Err(error) = persist_audio_state(db_path, &[confidence_setting(confidence)]) {
            return error;
        }
    }
    if let Err(error) = record_audio_action_failure(db_path, code, &message) {
        return error;
    }
    AudioCommandError::Rejected(code, message)
}

fn pull_console_state(
    db_path: &Path,
    config: &AudioBackendConfig,
    timing: PullTiming,
) -> Result<AudioSyncResult, AudioCommandError> {
    let link = shared_console_link();
    {
        let mut guard = lock_link(&link);
        if !guard.slot_bound {
            return Err(fail(
                db_path,
                "AUDIO_GLOBAL_OSC_UNBOUND",
                format!(
                    "The engine is not listening on the Global OSC receive port {}. Another program may be using it, or audio metering is not running; check Setup and try again.",
                    config.receive_port + 3
                ),
                None,
            ));
        }
        guard.begin_pull(link_now_ms());
    }

    if let Err(message) = send_console_pull_request(&config.send_host, config.send_port) {
        lock_link(&link).finish_pull(link_now_ms());
        return Err(fail(db_path, "AUDIO_SYNC_FAILED", message, None));
    }

    let started = Instant::now();
    let timeout = Duration::from_millis(timing.timeout_ms);
    let complete = loop {
        thread::sleep(Duration::from_millis(timing.poll_ms.max(1)));
        let progress = lock_link(&link).pull_progress(link_now_ms());
        match progress {
            Some(progress) if progress.is_complete(timing.quiet_ms) => break true,
            Some(_) if started.elapsed() < timeout => continue,
            _ => break false,
        }
    };
    let progress = lock_link(&link)
        .finish_pull(link_now_ms())
        .unwrap_or_else(|| PullProgress {
            started_at_ms: 0,
            control_messages: 0,
            parsed_messages: 0,
            last_message_age_ms: None,
            status_seen: false,
            channels_seen: Vec::new(),
            outputs_seen: Vec::new(),
            mix_nodes_seen: Vec::new(),
        });

    // Whatever arrived is console truth and stays, even when the pull fails.
    flush_console_link(db_path)?;

    if progress.control_messages == 0 {
        return Err(fail(
            db_path,
            "AUDIO_SYNC_NO_ECHO",
            format!(
                "TotalMix did not answer on the Global OSC remote (send {} → receive {}). Check that remote 4 is In Use in Global OSC mode with these ports.",
                config.send_port + 3,
                config.receive_port + 3
            ),
            Some(ConsoleConfidence::Unknown),
        ));
    }
    if !complete {
        return Err(fail(
            db_path,
            "AUDIO_SYNC_INCOMPLETE",
            format!(
                "TotalMix was still sending after {} ms ({} values so far), so the console state is incomplete. Press Sync again.",
                timing.timeout_ms, progress.parsed_messages
            ),
            Some(ConsoleConfidence::Unknown),
        ));
    }

    let synced_at = current_timestamp(db_path)?;
    let connection = lock_link(&link).connection_label();
    let summary_base = format!(
        "Pulled {} values from TotalMix · {} channels · {} outputs · {} mix nodes",
        progress.parsed_messages,
        progress.channels_seen.len(),
        progress.outputs_seen.len(),
        progress.mix_nodes_seen.len()
    );

    let summary = {
        let _state_guard = lock_audio_state();
        let app_settings = load_audio_settings(db_path)?;
        let snapshot = read_audio_snapshot(&app_settings);
        let mut channel_state = read_channel_state_map(&app_settings);
        let zeroed = zero_absent_mix_nodes(&snapshot, &mut channel_state, &progress);
        let summary = if zeroed > 0 {
            format!("{summary_base} · {zeroed} sends off")
        } else {
            summary_base
        };
        let mut writes = vec![
            confidence_setting(ConsoleConfidence::Aligned),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_AT_KEY),
                synced_at.clone(),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_SYNC_REASON_KEY),
                String::from("console-pull"),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_PULL_AT_KEY),
                synced_at.clone(),
            ),
            (
                String::from(AUDIO_LAST_CONSOLE_PULL_VALUES_KEY),
                progress.parsed_messages.to_string(),
            ),
            (
                String::from(AUDIO_LAST_ACTION_STATUS_KEY),
                String::from("succeeded"),
            ),
            (String::from(AUDIO_LAST_ACTION_CODE_KEY), String::new()),
            (String::from(AUDIO_LAST_ACTION_MESSAGE_KEY), summary.clone()),
        ];
        if zeroed > 0 {
            writes.push((
                String::from(AUDIO_CHANNEL_STATE_KEY),
                serialize_json_state(&channel_state)?,
            ));
        }
        persist_audio_state(db_path, &writes)?;
        summary
    };
    // The pull re-established the truth; earlier unconfirmed sends no longer
    // describe the desk.
    lock_link(&link).reset_unconfirmed();

    Ok(AudioSyncResult {
        synced: true,
        synced_at,
        summary,
        console_state_confidence: String::from("aligned"),
        pulled_values: progress.parsed_messages as i64,
        channels: progress.channels_seen.len() as i64,
        mix_targets: progress.outputs_seen.len() as i64,
        complete: true,
        connection,
    })
}

/// `/sendall 2` lists only mix nodes above -65 dB, so a mapped node the dump
/// did not mention is off. Returns how many stored levels changed.
pub(crate) fn zero_absent_mix_nodes(
    snapshot: &AudioSnapshot,
    channel_state: &mut HashMap<String, StoredAudioChannelState>,
    progress: &PullProgress,
) -> usize {
    let mut zeroed = 0usize;
    for channel in &snapshot.channels {
        let Some((bus_word, hardware_channel)) = global_channel_target(&channel.id) else {
            continue;
        };
        let bus = if bus_word == "input" {
            ConsoleBus::Input
        } else {
            ConsoleBus::Playback
        };
        for mix_target in &snapshot.mix_targets {
            let Some(output) = global_output_channel(&mix_target.id) else {
                continue;
            };
            if progress
                .mix_nodes_seen
                .contains(&(bus, hardware_channel, output))
            {
                continue;
            }
            let entry = channel_state
                .entry(channel.id.clone())
                .or_insert_with(|| stored_channel_state_from_snapshot(channel));
            let previous = entry.mix_levels.insert(mix_target.id.clone(), 0.0);
            let mut changed = previous.map(|level| level > f64::EPSILON).unwrap_or(true);
            if mix_target.id == "audio-mix-main" && entry.fader > f64::EPSILON {
                entry.fader = 0.0;
                changed = true;
            }
            if changed {
                zeroed += 1;
            }
        }
    }
    zeroed
}
