use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::create_dir_all;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use studio_control_protocol::{RequestEnvelope, ResponseEnvelope, PROTOCOL_VERSION};
use tauri::{AppHandle, Emitter};

const ENGINE_EVENT_CHANNEL: &str = "engine://event";

#[derive(Default)]
pub struct EngineBridge {
    process: Mutex<Option<EngineProcess>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
}

struct EngineProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    binary_path: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct EngineBootstrapSummary {
    pub running: bool,
    pub protocol: &'static str,
    pub binary_path: String,
}

impl EngineBridge {
    pub fn start(&self, app: &AppHandle) -> Result<EngineBootstrapSummary, String> {
        let mut process_guard = self.process.lock().map_err(|_| "Engine bridge poisoned".to_string())?;

        if let Some(process) = process_guard.as_ref() {
            return Ok(EngineBootstrapSummary {
                running: true,
                protocol: PROTOCOL_VERSION,
                binary_path: process.binary_path.display().to_string(),
            });
        }

        let binary_path = resolve_engine_binary()?;
        let (app_data_dir, logs_dir) = resolve_runtime_directories()?;
        create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        create_dir_all(&logs_dir).map_err(|error| error.to_string())?;

        let mut child = Command::new(&binary_path)
            .env("SSE_PROTOCOL_VERSION", PROTOCOL_VERSION)
            .env("SSE_APP_DATA_DIR", &app_data_dir)
            .env("SSE_LOG_DIR", &logs_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start engine: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Engine stdin was unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Engine stdout was unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Engine stderr was unavailable".to_string())?;

        spawn_stdout_thread(app.clone(), stdout, Arc::clone(&self.pending));
        spawn_stderr_thread(stderr);

        *process_guard = Some(EngineProcess {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            binary_path: binary_path.clone(),
        });

        Ok(EngineBootstrapSummary {
            running: true,
            protocol: PROTOCOL_VERSION,
            binary_path: binary_path.display().to_string(),
        })
    }

    pub fn request(&self, request: RequestEnvelope) -> Result<ResponseEnvelope, String> {
        let request_id = value_key(&request.id);
        let (sender, receiver): (Sender<Value>, Receiver<Value>) = mpsc::channel();

        self.pending
            .lock()
            .map_err(|_| "Engine pending requests poisoned".to_string())?
            .insert(request_id.clone(), sender);

        let result = self.write_request(&request).and_then(|_| {
            receiver
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| format!("Timed out waiting for engine response: {}", request.method))
        });

        self.pending
            .lock()
            .map_err(|_| "Engine pending requests poisoned".to_string())?
            .remove(&request_id);

        let raw_response = result?;
        serde_json::from_value(raw_response).map_err(|error| format!("Invalid engine response: {error}"))
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().map_err(|_| "Engine bridge poisoned".to_string())?;

        if let Some(mut process) = process_guard.take() {
            process
                .child
                .kill()
                .map_err(|error| format!("Failed to stop engine process: {error}"))?;
            let _ = process.child.wait();
        }

        self.pending
            .lock()
            .map_err(|_| "Engine pending requests poisoned".to_string())?
            .clear();

        Ok(())
    }

    fn write_request(&self, request: &RequestEnvelope) -> Result<(), String> {
        let process_guard = self.process.lock().map_err(|_| "Engine bridge poisoned".to_string())?;
        let process = process_guard
            .as_ref()
            .ok_or_else(|| "Engine is not running".to_string())?;

        let mut stdin = process
            .stdin
            .lock()
            .map_err(|_| "Engine stdin mutex poisoned".to_string())?;

        serde_json::to_writer(&mut *stdin, request)
            .map_err(|error| format!("Failed to serialize engine request: {error}"))?;
        stdin
            .write_all(b"\n")
            .map_err(|error| format!("Failed to send engine request: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("Failed to flush engine request: {error}"))?;
        Ok(())
    }
}

fn spawn_stdout_thread(app: AppHandle, stdout: ChildStdout, pending: Arc<Mutex<HashMap<String, Sender<Value>>>>) {
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };

            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };

            let message_type = message
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();

            if message_type == "response" {
                if let Some(id) = message.get("id") {
                    let key = value_key(id);
                    if let Ok(mut pending_map) = pending.lock() {
                        if let Some(sender) = pending_map.remove(&key) {
                            let _ = sender.send(message);
                        }
                    }
                }
                continue;
            }

            if message_type == "event" {
                let _ = app.emit(ENGINE_EVENT_CHANNEL, json!({ "event": message }));
            }
        }
    });
}

fn spawn_stderr_thread(stderr: ChildStderr) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            eprintln!("engine stderr: {line}");
        }
    });
}

fn resolve_runtime_directories() -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = std::env::var_os("SSE_APP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("sse-exed-tauri").join("app-data"));
    let logs_dir = std::env::var_os("SSE_LOG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| app_data_dir.join("logs"));

    if !app_data_dir.is_absolute() || !logs_dir.is_absolute() {
        return Err("Runtime paths must resolve to absolute directories.".to_string());
    }

    Ok((app_data_dir, logs_dir))
}

fn resolve_engine_binary() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("SSE_ENGINE_BIN") {
        let binary_path = PathBuf::from(path);
        if binary_exists(&binary_path) {
            return Ok(binary_path);
        }
        return Err(format!(
            "Configured engine binary does not exist: {}",
            binary_path.display()
        ));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let binary_name = if cfg!(target_os = "windows") {
        "studio-control-engine.exe"
    } else {
        "studio-control-engine"
    };

    let candidates = [
        manifest_dir.join("../rust-engine/target/debug").join(binary_name),
        manifest_dir.join("../rust-engine/target/release").join(binary_name),
    ];

    candidates
        .into_iter()
        .find(|candidate| binary_exists(candidate))
        .ok_or_else(|| {
            "Unable to locate the Rust engine binary. Set SSE_ENGINE_BIN or build native/rust-engine first."
                .to_string()
        })
}

fn binary_exists(path: &Path) -> bool {
    path.exists() && path.is_file()
}

fn value_key(value: &Value) -> String {
    match value {
        Value::String(string) => string.clone(),
        _ => value.to_string(),
    }
}
