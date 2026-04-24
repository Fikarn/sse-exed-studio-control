use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
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
const DEFAULT_APP_DATA_DIR_NAME: &str = "ExEd Studio Control Native";

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
        let mut process_guard = self
            .process
            .lock()
            .map_err(|_| "Engine bridge poisoned".to_string())?;

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
        serde_json::from_value(raw_response)
            .map_err(|error| format!("Invalid engine response: {error}"))
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut process_guard = self
            .process
            .lock()
            .map_err(|_| "Engine bridge poisoned".to_string())?;

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

    pub fn summary(&self) -> Result<Option<EngineBootstrapSummary>, String> {
        let process_guard = self
            .process
            .lock()
            .map_err(|_| "Engine bridge poisoned".to_string())?;

        Ok(process_guard
            .as_ref()
            .map(|process| EngineBootstrapSummary {
                running: true,
                protocol: PROTOCOL_VERSION,
                binary_path: process.binary_path.display().to_string(),
            }))
    }

    fn write_request(&self, request: &RequestEnvelope) -> Result<(), String> {
        let process_guard = self
            .process
            .lock()
            .map_err(|_| "Engine bridge poisoned".to_string())?;
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

fn spawn_stdout_thread(
    app: AppHandle,
    stdout: ChildStdout,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
) {
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

pub(crate) fn resolve_runtime_directories() -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = match env_path("SSE_APP_DATA_DIR") {
        Some(path) => path,
        None => default_app_data_dir()?,
    };
    let logs_dir = env_path("SSE_LOG_DIR").unwrap_or_else(|| app_data_dir.join("logs"));

    if !app_data_dir.is_absolute() || !logs_dir.is_absolute() {
        return Err("Runtime paths must resolve to absolute directories.".to_string());
    }

    Ok((app_data_dir, logs_dir))
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[derive(Clone, Copy)]
enum RuntimePlatform {
    Macos,
    Unix,
    Windows,
}

fn current_runtime_platform() -> RuntimePlatform {
    if cfg!(target_os = "windows") {
        RuntimePlatform::Windows
    } else if cfg!(target_os = "macos") {
        RuntimePlatform::Macos
    } else {
        RuntimePlatform::Unix
    }
}

fn default_app_data_dir() -> Result<PathBuf, String> {
    default_app_data_dir_for_platform(current_runtime_platform(), |name| std::env::var_os(name))
}

fn default_app_data_dir_for_platform<F>(
    platform: RuntimePlatform,
    mut get_env: F,
) -> Result<PathBuf, String>
where
    F: FnMut(&str) -> Option<OsString>,
{
    let env_path = |name: &str, get_env: &mut F| -> Option<PathBuf> {
        get_env(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };

    let base = match platform {
        RuntimePlatform::Windows => {
            env_path("APPDATA", &mut get_env).or_else(|| env_path("LOCALAPPDATA", &mut get_env))
        }
        RuntimePlatform::Macos => env_path("HOME", &mut get_env)
            .map(|home| home.join("Library").join("Application Support")),
        RuntimePlatform::Unix => env_path("XDG_DATA_HOME", &mut get_env).or_else(|| {
            env_path("HOME", &mut get_env).map(|home| home.join(".local").join("share"))
        }),
    };

    base.map(|path| path.join(DEFAULT_APP_DATA_DIR_NAME)).ok_or_else(|| {
        "Unable to resolve a durable app-data directory. Set SSE_APP_DATA_DIR to an absolute path."
            .to_string()
    })
}

pub(crate) fn resolve_engine_binary() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let binary_name = if cfg!(target_os = "windows") {
        "studio-control-engine.exe"
    } else {
        "studio-control-engine"
    };

    resolve_engine_binary_from(
        std::env::var_os("SSE_ENGINE_BIN").map(PathBuf::from),
        std::env::current_exe().ok(),
        &manifest_dir,
        binary_name,
    )
}

fn resolve_engine_binary_from(
    explicit_path: Option<PathBuf>,
    current_exe: Option<PathBuf>,
    manifest_dir: &Path,
    binary_name: &str,
) -> Result<PathBuf, String> {
    if let Some(binary_path) = explicit_path {
        if binary_exists(&binary_path) {
            return Ok(binary_path);
        }
        return Err(format!(
            "Configured engine binary does not exist: {}",
            binary_path.display()
        ));
    }

    let candidates = [
        current_exe.and_then(|path| path.parent().map(|parent| parent.join(binary_name))),
        Some(
            manifest_dir
                .join("../rust-engine/target/debug")
                .join(binary_name),
        ),
        Some(
            manifest_dir
                .join("../rust-engine/target/release")
                .join(binary_name),
        ),
    ];

    candidates
        .into_iter()
        .flatten()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "sse-tauri-engine-resolution-{label}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("test temp root should be creatable");
            Self { root }
        }

        fn path(&self, path: &str) -> PathBuf {
            self.root.join(path)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().expect("test path should have a parent"))
            .expect("test parent directory should be creatable");
        File::create(path).expect("test file should be creatable");
    }

    fn env_fixture<'a>(
        entries: &'a [(&'a str, &'a str)],
    ) -> impl FnMut(&str) -> Option<OsString> + 'a {
        move |name| {
            entries
                .iter()
                .find_map(|(key, value)| (*key == name).then(|| OsString::from(value)))
        }
    }

    #[test]
    fn windows_default_app_data_matches_durable_qt_style_location() {
        let resolved = default_app_data_dir_for_platform(
            RuntimePlatform::Windows,
            env_fixture(&[("APPDATA", "C:/Users/operator/AppData/Roaming")]),
        )
        .expect("windows app data should resolve");

        assert_eq!(
            resolved,
            PathBuf::from("C:/Users/operator/AppData/Roaming").join(DEFAULT_APP_DATA_DIR_NAME)
        );
    }

    #[test]
    fn macos_default_app_data_matches_application_support_location() {
        let resolved = default_app_data_dir_for_platform(
            RuntimePlatform::Macos,
            env_fixture(&[("HOME", "/Users/operator")]),
        )
        .expect("macos app data should resolve");

        assert_eq!(
            resolved,
            PathBuf::from("/Users/operator")
                .join("Library")
                .join("Application Support")
                .join(DEFAULT_APP_DATA_DIR_NAME)
        );
    }

    #[test]
    fn unix_default_app_data_honors_xdg_data_home() {
        let resolved = default_app_data_dir_for_platform(
            RuntimePlatform::Unix,
            env_fixture(&[("XDG_DATA_HOME", "/home/operator/.local/data")]),
        )
        .expect("unix app data should resolve");

        assert_eq!(
            resolved,
            PathBuf::from("/home/operator/.local/data").join(DEFAULT_APP_DATA_DIR_NAME)
        );
    }

    #[test]
    fn engine_override_wins_before_packaged_and_dev_candidates() {
        let tree = TempTree::new("override");
        let binary_name = "studio-control-engine";
        let override_engine = tree.path("override/studio-control-engine");
        let shell_exe = tree.path("package/sse-exed-tauri-shell");
        let packaged_engine = tree.path("package/studio-control-engine");
        let manifest_dir = tree.path("repo/native/tauri-shell");
        let dev_engine = manifest_dir
            .join("../rust-engine/target/debug")
            .join(binary_name);

        touch(&override_engine);
        touch(&shell_exe);
        touch(&packaged_engine);
        touch(&manifest_dir.join("Cargo.toml"));
        touch(&dev_engine);

        let resolved = resolve_engine_binary_from(
            Some(override_engine.clone()),
            Some(shell_exe),
            &manifest_dir,
            binary_name,
        )
        .expect("explicit engine override should resolve");

        assert_eq!(resolved, override_engine);
    }

    #[test]
    fn packaged_engine_next_to_shell_wins_before_dev_candidate() {
        let tree = TempTree::new("packaged");
        let binary_name = "studio-control-engine";
        let shell_exe = tree.path("package/sse-exed-tauri-shell");
        let packaged_engine = tree.path("package/studio-control-engine");
        let manifest_dir = tree.path("repo/native/tauri-shell");
        let dev_engine = manifest_dir
            .join("../rust-engine/target/debug")
            .join(binary_name);

        touch(&shell_exe);
        touch(&packaged_engine);
        touch(&manifest_dir.join("Cargo.toml"));
        touch(&dev_engine);

        let resolved =
            resolve_engine_binary_from(None, Some(shell_exe), &manifest_dir, binary_name)
                .expect("packaged side-by-side engine should resolve");

        assert_eq!(resolved, packaged_engine);
    }

    #[test]
    fn dev_engine_resolves_when_packaged_candidate_is_missing() {
        let tree = TempTree::new("dev");
        let binary_name = "studio-control-engine";
        let shell_exe = tree.path("package/sse-exed-tauri-shell");
        let manifest_dir = tree.path("repo/native/tauri-shell");
        let dev_engine = manifest_dir
            .join("../rust-engine/target/debug")
            .join(binary_name);

        touch(&shell_exe);
        touch(&manifest_dir.join("Cargo.toml"));
        touch(&dev_engine);

        let resolved =
            resolve_engine_binary_from(None, Some(shell_exe), &manifest_dir, binary_name)
                .expect("dev engine candidate should resolve");

        assert_eq!(resolved, dev_engine);
    }
}
