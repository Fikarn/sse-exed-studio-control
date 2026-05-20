mod app;
mod app_state;
mod audio;
mod audio_backend;
mod audio_meter_fixture;
mod bootstrap;
mod commissioning;
mod control_surface;
mod diagnostics;
mod exports;
mod legacy_import;
mod lighting;
mod lighting_backend;
mod parity_fixtures;
mod planning;
mod planning_settings;
mod protocol;
mod rme_totalmix_osc;
mod shell_settings;
mod storage;
mod support;

use crate::app::EngineApp;
use crate::app_state::APP_SETTINGS_PREFIX;
use crate::audio::{
    refresh_audio_snapshot_metering, AudioChannelSnapshot, AudioMixTargetSnapshot, AudioSnapshot,
};
use crate::audio_backend::{read_default_audio_inventory, AudioBackendConfig};
use crate::bootstrap::{resolve_runtime_paths, validate_protocol_version};
use crate::protocol::{
    event_message, RequestEnvelope, EVENT_AUDIO_METERS, EVENT_ENGINE_STARTUP_FAILED,
};
use crate::storage::list_settings_by_prefix;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

const SIMULATED_AUDIO_METER_INTERVAL: Duration = Duration::from_millis(33);
const SIMULATED_AUDIO_METER_CACHE_REFRESH: Duration = Duration::from_millis(500);
const SIMULATED_AUDIO_METER_CADENCE_HZ: f64 = 30.0;
const AUDIO_METER_FLOOR_DBFS: f64 = -60.0;
const CONSOLE_METER_POINT_INPUT: &str = "input";
const CONSOLE_METER_POINT_PLAYBACK: &str = "playback";
const CONSOLE_METER_POINT_POST_FADER: &str = "post-fader";
const CONSOLE_PEAK_WARNING_DBFS: f64 = -3.0;
const CONSOLE_OVER_DBFS: f64 = 0.0;

fn meter_point_for_channel(channel: &AudioChannelSnapshot) -> &'static str {
    if channel.role == "playback-pair" {
        CONSOLE_METER_POINT_PLAYBACK
    } else {
        CONSOLE_METER_POINT_INPUT
    }
}

fn write_json<W: Write, T: Serialize>(writer: &mut W, message: &T) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, message)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn spawn_output_writer(receiver: Receiver<Value>) {
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut writer = stdout.lock();
        for message in receiver {
            if let Err(error) = write_json(&mut writer, &message) {
                eprintln!("Engine output writer failed: {error}");
                break;
            }
        }
    });
}

fn send_output(sender: &Sender<Value>, message: Value) -> io::Result<()> {
    sender
        .send(message)
        .map_err(|error| io::Error::new(io::ErrorKind::BrokenPipe, error.to_string()))
}

fn normalized_to_dbfs(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return AUDIO_METER_FLOOR_DBFS;
    }

    (20.0 * value.clamp(0.0, 1.0).log10()).clamp(AUDIO_METER_FLOOR_DBFS, 0.0)
}

fn channel_meter_payload(channel: &AudioChannelSnapshot) -> Value {
    let rms_left = channel.meter_left;
    let rms_right = channel.meter_right;
    let level_left_dbfs = normalized_to_dbfs(rms_left);
    let level_right_dbfs = normalized_to_dbfs(rms_right);
    let peak_left = channel.peak_hold_left.max(channel.meter_left);
    let peak_right = channel.peak_hold_right.max(channel.meter_right);
    let over_left = level_left_dbfs >= CONSOLE_OVER_DBFS;
    let over_right = level_right_dbfs >= CONSOLE_OVER_DBFS;
    let meter_point_over = over_left || over_right;
    let peak_warning = level_left_dbfs >= CONSOLE_PEAK_WARNING_DBFS
        || level_right_dbfs >= CONSOLE_PEAK_WARNING_DBFS
        || channel.clip;

    json!({
        "channelPathClip": channel.clip,
        "channelPathClipHold": channel.clip,
        "id": channel.id,
        "meterPoint": meter_point_for_channel(channel),
        "meterLeft": channel.meter_left,
        "meterRight": channel.meter_right,
        "meterLevel": channel.meter_level,
        "peakHold": channel.peak_hold,
        "peakHoldLeft": channel.peak_hold_left,
        "peakHoldRight": channel.peak_hold_right,
        "levelLeftDbfs": level_left_dbfs,
        "levelRightDbfs": level_right_dbfs,
        "peakLeftDbfs": normalized_to_dbfs(peak_left),
        "peakRightDbfs": normalized_to_dbfs(peak_right),
        "rmsLeftDbfs": level_left_dbfs,
        "rmsRightDbfs": level_right_dbfs,
        "peakHoldLeftDbfs": normalized_to_dbfs(channel.peak_hold_left),
        "peakHoldRightDbfs": normalized_to_dbfs(channel.peak_hold_right),
        "peakWarning": peak_warning,
        "meterPointOver": meter_point_over,
        "meterPointOverLeft": over_left,
        "meterPointOverRight": over_right,
        "over": meter_point_over,
        "overLeft": over_left,
        "overRight": over_right,
        "clipHold": channel.clip,
        "clip": channel.clip,
    })
}

fn mix_target_meter_payload(mix_target: &AudioMixTargetSnapshot) -> Value {
    let rms_left = mix_target.meter_left;
    let rms_right = mix_target.meter_right;
    let level_left_dbfs = normalized_to_dbfs(rms_left);
    let level_right_dbfs = normalized_to_dbfs(rms_right);
    let peak_left = mix_target.peak_hold_left.max(mix_target.meter_left);
    let peak_right = mix_target.peak_hold_right.max(mix_target.meter_right);
    let over_left = level_left_dbfs >= CONSOLE_OVER_DBFS;
    let over_right = level_right_dbfs >= CONSOLE_OVER_DBFS;
    let meter_point_over = over_left || over_right;
    let peak_warning = level_left_dbfs >= CONSOLE_PEAK_WARNING_DBFS
        || level_right_dbfs >= CONSOLE_PEAK_WARNING_DBFS;

    json!({
        "channelPathClip": false,
        "channelPathClipHold": false,
        "id": mix_target.id,
        "meterPoint": CONSOLE_METER_POINT_POST_FADER,
        "meterLeft": mix_target.meter_left,
        "meterRight": mix_target.meter_right,
        "meterLevel": mix_target.meter_level,
        "peakHold": mix_target.peak_hold,
        "peakHoldLeft": mix_target.peak_hold_left,
        "peakHoldRight": mix_target.peak_hold_right,
        "levelLeftDbfs": level_left_dbfs,
        "levelRightDbfs": level_right_dbfs,
        "peakLeftDbfs": normalized_to_dbfs(peak_left),
        "peakRightDbfs": normalized_to_dbfs(peak_right),
        "rmsLeftDbfs": level_left_dbfs,
        "rmsRightDbfs": level_right_dbfs,
        "peakHoldLeftDbfs": normalized_to_dbfs(mix_target.peak_hold_left),
        "peakHoldRightDbfs": normalized_to_dbfs(mix_target.peak_hold_right),
        "peakWarning": peak_warning,
        "meterPointOver": meter_point_over,
        "meterPointOverLeft": over_left,
        "meterPointOverRight": over_right,
        "over": meter_point_over,
        "overLeft": over_left,
        "overRight": over_right,
        "clipHold": false,
    })
}

fn audio_meter_tick_payload(
    snapshot: &AudioSnapshot,
    sequence: u64,
    metering_started_at: Instant,
) -> Value {
    json!({
        "reason": "metering-tick",
        "sequence": sequence,
        "monotonicTimestampMs": metering_started_at.elapsed().as_secs_f64() * 1000.0,
        "cadenceHz": SIMULATED_AUDIO_METER_CADENCE_HZ,
        "meteringSource": crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE,
        "meteringState": "simulated",
        "lastPacketAgeMs": null,
        "selectedMixTargetId": snapshot.selected_mix_target_id,
        "channels": snapshot
            .channels
            .iter()
            .map(channel_meter_payload)
            .collect::<Vec<_>>(),
        "mixTargets": snapshot
            .mix_targets
            .iter()
            .map(mix_target_meter_payload)
            .collect::<Vec<_>>(),
    })
}

struct SimulatedAudioMeterCache {
    last_snapshot_refresh_at: Option<Instant>,
    snapshot: Option<AudioSnapshot>,
}

impl SimulatedAudioMeterCache {
    fn new() -> Self {
        Self {
            last_snapshot_refresh_at: None,
            snapshot: None,
        }
    }

    fn should_refresh_snapshot(&self) -> bool {
        self.snapshot.is_none()
            || self
                .last_snapshot_refresh_at
                .map(|last_refresh| last_refresh.elapsed() >= SIMULATED_AUDIO_METER_CACHE_REFRESH)
                .unwrap_or(true)
    }

    fn refresh_snapshot(&mut self, db_path: &Path) -> Result<(), String> {
        let settings = list_settings_by_prefix(db_path, APP_SETTINGS_PREFIX)
            .map_err(|error| error.to_string())?;
        self.snapshot = Some(crate::audio::read_audio_snapshot(&settings));
        self.last_snapshot_refresh_at = Some(Instant::now());
        Ok(())
    }

    fn refresh_live_metering(&mut self) {
        let Some(snapshot) = self.snapshot.as_mut() else {
            return;
        };

        let config = AudioBackendConfig {
            send_host: snapshot.send_host.clone(),
            send_port: snapshot.send_port,
            receive_port: snapshot.receive_port,
            metering_source: snapshot.metering_source.clone(),
        };
        let inventory = read_default_audio_inventory(&config);
        refresh_audio_snapshot_metering(snapshot, inventory.channels.as_slice());
    }

    fn tick_payload(
        &mut self,
        db_path: &Path,
        sequence: u64,
        metering_started_at: Instant,
    ) -> Value {
        if self.should_refresh_snapshot() {
            if let Err(error) = self.refresh_snapshot(db_path) {
                return json!({
                    "reason": "metering-tick",
                    "sequence": sequence,
                    "monotonicTimestampMs": metering_started_at.elapsed().as_secs_f64() * 1000.0,
                    "cadenceHz": SIMULATED_AUDIO_METER_CADENCE_HZ,
                    "meteringSource": crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE,
                    "meteringState": "simulated",
                    "lastPacketAgeMs": null,
                    "error": error,
                });
            }
        }

        self.refresh_live_metering();
        match self.snapshot.as_ref() {
            Some(snapshot) => audio_meter_tick_payload(snapshot, sequence, metering_started_at),
            None => json!({
                "reason": "metering-tick",
                "sequence": sequence,
                "monotonicTimestampMs": metering_started_at.elapsed().as_secs_f64() * 1000.0,
                "cadenceHz": SIMULATED_AUDIO_METER_CADENCE_HZ,
                "meteringSource": crate::rme_totalmix_osc::SIMULATED_AUDIO_SOURCE,
                "meteringState": "simulated",
                "lastPacketAgeMs": null,
                "error": "audio meter cache is empty",
            }),
        }
    }
}

fn spawn_simulated_audio_meter_ticks(sender: Sender<Value>, db_path: PathBuf) {
    thread::spawn(move || {
        let mut cache = SimulatedAudioMeterCache::new();
        let metering_started_at = Instant::now();
        let mut sequence = 0_u64;

        loop {
            thread::sleep(SIMULATED_AUDIO_METER_INTERVAL);
            sequence = sequence.saturating_add(1);
            let event = event_message(
                EVENT_AUDIO_METERS,
                cache.tick_payload(&db_path, sequence, metering_started_at),
            );
            if sender.send(event).is_err() {
                break;
            }
        }
    });
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();
    let planned_paths = resolve_runtime_paths();

    if let Err(message) = validate_protocol_version(&planned_paths.requested_protocol_version) {
        let startup_failure = event_message(
            EVENT_ENGINE_STARTUP_FAILED,
            json!({
                "stage": "protocol-negotiation",
                "code": "PROTOCOL_MISMATCH",
                "message": message,
                "requestedProtocol": planned_paths.requested_protocol_version,
                "supportedProtocol": planned_paths.protocol_version,
                "paths": {
                    "appDataDir": planned_paths.app_data_dir.display().to_string(),
                    "logsDir": planned_paths.logs_dir.display().to_string(),
                    "logFilePath": planned_paths.log_file_path.display().to_string(),
                    "dbPath": planned_paths.db_path.display().to_string(),
                    "backupDir": planned_paths.backups_dir.display().to_string(),
                    "updateRepositoryPath": planned_paths
                        .update_repository_path
                        .as_ref()
                        .map(|path| path.display().to_string())
                }
            }),
        );
        let _ = write_json(&mut writer, &startup_failure);
        eprintln!("Engine protocol mismatch: {message}");
        return Err(io::Error::other(message));
    }

    let app = match EngineApp::bootstrap() {
        Ok(app) => app,
        Err(error) => {
            let startup_failure = event_message(
                EVENT_ENGINE_STARTUP_FAILED,
                json!({
                    "stage": "bootstrap",
                    "code": "BOOTSTRAP_FAILED",
                    "message": error.to_string(),
                    "paths": {
                        "appDataDir": planned_paths.app_data_dir.display().to_string(),
                        "logsDir": planned_paths.logs_dir.display().to_string(),
                        "logFilePath": planned_paths.log_file_path.display().to_string(),
                        "dbPath": planned_paths.db_path.display().to_string(),
                        "backupDir": planned_paths.backups_dir.display().to_string(),
                        "updateRepositoryPath": planned_paths
                            .update_repository_path
                            .as_ref()
                            .map(|path| path.display().to_string())
                    }
                }),
            );
            let _ = write_json(&mut writer, &startup_failure);
            eprintln!("Engine bootstrap failed: {error}");
            return Err(io::Error::other(error));
        }
    };

    drop(writer);

    let (output_sender, output_receiver) = mpsc::channel::<Value>();
    spawn_output_writer(output_receiver);
    send_output(&output_sender, app.ready_event())?;
    if app.should_emit_simulated_audio_meter_ticks() {
        spawn_simulated_audio_meter_ticks(output_sender.clone(), planned_paths.db_path);
    } else if app.should_emit_rme_totalmix_audio_metering() {
        rme_totalmix_osc::spawn_rme_totalmix_audio_metering(
            output_sender.clone(),
            planned_paths.db_path,
        );
    }

    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<RequestEnvelope>(trimmed) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Malformed request: {error}");
                continue;
            }
        };

        let reply = app.handle_request(request);
        send_output(
            &output_sender,
            serde_json::to_value(&reply.response)
                .map_err(|error| io::Error::other(error.to_string()))?,
        )?;
        for event in reply.events {
            send_output(&output_sender, event)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::read_audio_snapshot;
    use std::collections::HashMap;

    #[test]
    fn compact_channel_meter_payload_separates_rms_body_from_held_peak() {
        let mut snapshot = read_audio_snapshot(&HashMap::new());
        let channel = snapshot
            .channels
            .iter_mut()
            .find(|channel| channel.id == "audio-input-9")
            .expect("default audio snapshot should include host input");

        channel.stereo = true;
        channel.meter_left = 0.25;
        channel.meter_right = 0.10;
        channel.meter_level = 0.25;
        channel.peak_hold_left = 0.80;
        channel.peak_hold_right = 0.40;
        channel.peak_hold = 0.80;

        let payload = channel_meter_payload(channel);

        assert!(
            (payload["rmsLeftDbfs"].as_f64().unwrap() - normalized_to_dbfs(0.25)).abs() < 0.001
        );
        assert!(
            (payload["rmsRightDbfs"].as_f64().unwrap() - normalized_to_dbfs(0.10)).abs() < 0.001
        );
        assert!(
            (payload["peakLeftDbfs"].as_f64().unwrap() - normalized_to_dbfs(0.80)).abs() < 0.001
        );
        assert!(
            (payload["peakRightDbfs"].as_f64().unwrap() - normalized_to_dbfs(0.40)).abs() < 0.001
        );
    }
}
