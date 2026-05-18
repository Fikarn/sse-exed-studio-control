mod app;
mod app_state;
mod audio;
mod audio_backend;
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
mod shell_settings;
mod storage;
mod support;

use crate::app::EngineApp;
use crate::audio_backend::build_simulated_audio_meters_payload;
use crate::bootstrap::{resolve_runtime_paths, validate_protocol_version};
use crate::protocol::{
    event_message, RequestEnvelope, EVENT_AUDIO_METERS, EVENT_ENGINE_STARTUP_FAILED,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

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

fn spawn_simulated_audio_meter_ticks(sender: Sender<Value>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(33));
        let event = event_message(EVENT_AUDIO_METERS, build_simulated_audio_meters_payload());
        if sender.send(event).is_err() {
            break;
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
        spawn_simulated_audio_meter_ticks(output_sender.clone());
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
