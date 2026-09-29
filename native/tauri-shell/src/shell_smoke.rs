//! `--smoke-test`: the shell starts the hardware link beside it, asks it
//! for `app.snapshot`, writes what it found to a status file and exits. No
//! window is built. `npm run release` tries a build this way.

use crate::engine;
use serde_json::{json, Value};
use std::fs::{create_dir_all, write};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

fn read_arg_value(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    args.iter()
        .find_map(|value| value.strip_prefix(&prefix).map(ToString::to_string))
}

fn write_smoke_status(status_path: Option<&str>, status: Value) {
    let Some(path) = status_path else {
        return;
    };

    let output_path = PathBuf::from(path);
    if let Some(parent) = output_path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(payload) = serde_json::to_vec_pretty(&status) {
        let _ = write(output_path, payload);
    }
}

fn spawn_smoke_reader(stdout: std::process::ChildStdout) -> Receiver<Value> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let _ = sender.send(message);
        }
    });
    receiver
}

fn wait_for_smoke_message(receiver: &Receiver<Value>, deadline: Instant) -> Result<Value, String> {
    let now = Instant::now();
    if now >= deadline {
        return Err("Timed out waiting for engine smoke output.".to_string());
    }

    receiver
        .recv_timeout(deadline.saturating_duration_since(now))
        .map_err(|_| "Timed out waiting for engine smoke output.".to_string())
}

fn write_engine_request(
    stdin: &mut std::process::ChildStdin,
    id: &str,
    method: &str,
) -> Result<(), String> {
    serde_json::to_writer(
        &mut *stdin,
        &json!({
            "type": "request",
            "id": id,
            "method": method,
            "params": {}
        }),
    )
    .map_err(|error| format!("Failed to serialize smoke request: {error}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed to write smoke request: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Failed to flush smoke request: {error}"))?;
    Ok(())
}

fn wait_for_smoke_startup(receiver: &Receiver<Value>, deadline: Instant) -> Result<(), String> {
    loop {
        let message = wait_for_smoke_message(receiver, deadline)?;
        let message_type = message
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if message_type != "event" {
            continue;
        }

        let event = message
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if event == "engine.ready" {
            return Ok(());
        }

        if event == "engine.startupFailed" {
            return Err(format!(
                "Engine startup failed during Tauri smoke: {}",
                message
                    .get("payload")
                    .and_then(|payload| payload.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("unknown startup failure")
            ));
        }
    }
}

fn wait_for_smoke_response(
    receiver: &Receiver<Value>,
    id: &str,
    deadline: Instant,
) -> Result<Value, String> {
    loop {
        let message = wait_for_smoke_message(receiver, deadline)?;
        if message.get("type").and_then(Value::as_str) != Some("response") {
            continue;
        }
        if message.get("id").and_then(Value::as_str) != Some(id) {
            continue;
        }
        if message.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(format!("Engine smoke request '{id}' failed: {message}"));
        }
        return Ok(message.get("result").cloned().unwrap_or_else(|| json!({})));
    }
}

pub(crate) fn run_smoke_test(args: &[String]) -> i32 {
    let status_path = read_arg_value(args, "--smoke-status-path");
    let binary_path = match engine::resolve_engine_binary() {
        Ok(path) => path,
        Err(not_started) => {
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 1,
                    "error": not_started.detail,
                }),
            );
            eprintln!("{}", not_started.detail);
            return 1;
        }
    };
    let (app_data_dir, logs_dir) = match engine::resolve_runtime_directories() {
        Ok(paths) => paths,
        Err(message) => {
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 1,
                    "startedEnginePath": binary_path.display().to_string(),
                    "error": message,
                }),
            );
            eprintln!("{message}");
            return 1;
        }
    };

    let result = (|| -> Result<Value, String> {
        create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        create_dir_all(&logs_dir).map_err(|error| error.to_string())?;

        let mut child = Command::new(&binary_path)
            .env(
                "SSE_PROTOCOL_VERSION",
                studio_control_protocol::PROTOCOL_VERSION,
            )
            .env("SSE_APP_DATA_DIR", &app_data_dir)
            .env("SSE_LOG_DIR", &logs_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("Failed to start engine: {error}"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Engine stdin was unavailable.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Engine stdout was unavailable.".to_string())?;
        let receiver = spawn_smoke_reader(stdout);
        let deadline = Instant::now() + Duration::from_secs(15);

        wait_for_smoke_startup(&receiver, deadline)?;
        write_engine_request(&mut stdin, "tauri-smoke-app-snapshot", "app.snapshot")?;
        let app_snapshot =
            wait_for_smoke_response(&receiver, "tauri-smoke-app-snapshot", deadline)?;
        drop(stdin);

        let stop_deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < stop_deadline {
            if child
                .try_wait()
                .map_err(|error| format!("Failed to wait for engine smoke exit: {error}"))?
                .is_some()
            {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        if child
            .try_wait()
            .map_err(|error| format!("Failed to wait for engine smoke exit: {error}"))?
            .is_none()
        {
            let _ = child.kill();
            let _ = child.wait();
        }

        Ok(app_snapshot)
    })();

    match result {
        Ok(app_snapshot) => {
            let target_surface = app_snapshot
                .get("startup")
                .and_then(|startup| startup.get("targetSurface"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 0,
                    "startedEnginePath": binary_path.display().to_string(),
                    "targetSurface": target_surface,
                    "appDataPath": app_data_dir.display().to_string(),
                    "logsPath": logs_dir.display().to_string(),
                    "protocol": studio_control_protocol::PROTOCOL_VERSION,
                    "studioBuild": studio_control_protocol::development::studio_build_commit(),
                }),
            );
            0
        }
        Err(message) => {
            write_smoke_status(
                status_path.as_deref(),
                json!({
                    "finished": true,
                    "exitCode": 1,
                    "startedEnginePath": binary_path.display().to_string(),
                    "error": message,
                    "appDataPath": app_data_dir.display().to_string(),
                    "logsPath": logs_dir.display().to_string(),
                    "protocol": studio_control_protocol::PROTOCOL_VERSION,
                    "studioBuild": studio_control_protocol::development::studio_build_commit(),
                }),
            );
            eprintln!("{message}");
            1
        }
    }
}
