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
use crate::bootstrap::{resolve_runtime_paths, validate_protocol_version};
use crate::protocol::{event_message, RequestEnvelope};
use serde::Serialize;
use serde_json::json;
use std::io::{self, BufRead, BufReader, Write};

fn write_json<W: Write, T: Serialize>(writer: &mut W, message: &T) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, message)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();
    let planned_paths = resolve_runtime_paths();

    if let Err(message) = validate_protocol_version(&planned_paths.requested_protocol_version) {
        let startup_failure = event_message(
            "engine.startupFailed",
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
                "engine.startupFailed",
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

    write_json(&mut writer, &app.ready_event())?;

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
        write_json(&mut writer, &reply.response)?;
        for event in reply.events {
            write_json(&mut writer, &event)?;
        }
    }

    Ok(())
}
