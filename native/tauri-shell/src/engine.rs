use serde::Serialize;
use serde_json::{json, Value};
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::create_dir_all;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use studio_control_protocol::{
    error_response, RequestEnvelope, ResponseEnvelope, EVENT_ENGINE_EXITED, PROTOCOL_VERSION,
};
use tauri::{AppHandle, Emitter};

const ENGINE_EVENT_CHANNEL: &str = "engine://event";
const DEFAULT_APP_DATA_DIR_NAME: &str = "ExEd Studio Control Native";
/// Sub-directory of the app-data directory that receives the shell's
/// diagnostics exports (2026-09 production readiness, Slice 4 — finding F15).
pub(crate) const EXPORTS_DIR_NAME: &str = "exports";
/// Error code answered when a request id is already waiting for the engine's
/// response (finding F08).
pub const DUPLICATE_REQUEST_ID_CODE: &str = "DUPLICATE_REQUEST_ID";
/// Error code answered to every request still waiting for a response when the
/// engine process exits (2026-09 production readiness, Slice 5 — finding F09).
pub const ENGINE_EXITED_CODE: &str = "ENGINE_EXITED";
/// How often the exit watcher polls the engine process (finding F09). The
/// process mutex is held only for the poll itself.
pub const ENGINE_EXIT_WATCH_INTERVAL: Duration = Duration::from_millis(250);
/// How long a graceful stop waits for the engine to exit after stdin closes
/// before falling back to a kill.
pub const ENGINE_STOP_GRACE: Duration = Duration::from_secs(2);
const ENGINE_STOP_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Where the shell delivers what the engine says: every event line the engine
/// writes to stdout, and the `engine.exited` event the shell raises itself
/// when the process is gone. Production wraps the Tauri event channel; the
/// unit tests record into a channel.
type EventSink = Arc<dyn Fn(Value) + Send + Sync>;

fn app_event_sink(app: AppHandle) -> EventSink {
    Arc::new(move |message: Value| {
        let _ = app.emit(ENGINE_EVENT_CHANNEL, json!({ "event": message }));
    })
}

#[derive(Default)]
pub struct EngineBridge {
    process: Arc<Mutex<Option<EngineProcess>>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    /// Counts engine launches for the life of the shell. Each launch's
    /// generation tags its `engine.exited` event, so the front-end can tell
    /// a report about a process it already replaced from one about the
    /// process it is talking to.
    generations: AtomicU64,
}

struct EngineProcess {
    child: Child,
    /// `None` once a stop closed the pipe: the engine's request loop ends on
    /// EOF and it releases any talkback hold on its way out.
    stdin: Option<ChildStdin>,
    binary_path: PathBuf,
    generation: u64,
    pid: u32,
    /// Set by `stop()` before it closes stdin, so an exit the watcher sees
    /// first is still reported as `graceful: true`. Only read and written
    /// under the process mutex.
    expected_exit: bool,
    sink: EventSink,
}

impl EngineProcess {
    fn summary(&self) -> EngineBootstrapSummary {
        EngineBootstrapSummary {
            running: true,
            protocol: PROTOCOL_VERSION,
            binary_path: self.binary_path.display().to_string(),
            pid: self.pid,
            generation: self.generation,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct EngineBootstrapSummary {
    pub running: bool,
    pub protocol: &'static str,
    pub binary_path: String,
    /// The engine's process id, so a qualification lane can end the process
    /// from outside and watch the shell notice (finding F09).
    pub pid: u32,
    /// The launch number within this shell; `engine.exited` carries it.
    pub generation: u64,
}

impl EngineBridge {
    pub fn start(&self, app: &AppHandle) -> Result<EngineBootstrapSummary, String> {
        if let Some(summary) = self.summary()? {
            return Ok(summary);
        }

        let binary_path = resolve_engine_binary()?;
        let (app_data_dir, logs_dir) = resolve_runtime_directories()?;
        create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        create_dir_all(&logs_dir).map_err(|error| error.to_string())?;
        create_dir_all(exports_dir_for(&app_data_dir)).map_err(|error| error.to_string())?;

        let mut command = Command::new(&binary_path);
        command
            .env("SSE_PROTOCOL_VERSION", PROTOCOL_VERSION)
            .env("SSE_APP_DATA_DIR", &app_data_dir)
            .env("SSE_LOG_DIR", &logs_dir);
        // The engine is a console-subsystem binary; without CREATE_NO_WINDOW a
        // GUI-subsystem shell would pop a fresh terminal for it on Windows.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        self.launch(command, binary_path, app_event_sink(app.clone()))
    }

    /// Spawns `command` as the engine process, wires its stdout to `sink`,
    /// and starts the exit watcher for it. A running engine is returned as it
    /// is; nothing is spawned twice.
    fn launch(
        &self,
        mut command: Command,
        binary_path: PathBuf,
        sink: EventSink,
    ) -> Result<EngineBootstrapSummary, String> {
        let mut process_guard = self
            .process
            .lock()
            .map_err(|_| "Engine bridge poisoned".to_string())?;

        if let Some(process) = process_guard.as_ref() {
            return Ok(process.summary());
        }

        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
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

        let generation = self.generations.fetch_add(1, Ordering::SeqCst) + 1;
        let pid = child.id();
        spawn_stdout_thread(Arc::clone(&sink), stdout, Arc::clone(&self.pending));
        spawn_stderr_thread(stderr);

        let process = EngineProcess {
            child,
            stdin: Some(stdin),
            binary_path,
            generation,
            pid,
            expected_exit: false,
            sink,
        };
        let summary = process.summary();
        *process_guard = Some(process);
        spawn_exit_watcher(
            Arc::clone(&self.process),
            Arc::clone(&self.pending),
            generation,
        );

        Ok(summary)
    }

    /// Sends `request` to the engine and waits for its response. An id that is
    /// already waiting for a response is refused with `DUPLICATE_REQUEST_ID`
    /// before anything is written, and the original waiter keeps its reply
    /// slot (2026-09 production readiness, Slice 4 — finding F08): two live
    /// requests under one id shared one slot, so whichever response arrived
    /// first went to the wrong caller and the other timed out.
    pub fn request(&self, request: RequestEnvelope) -> Result<ResponseEnvelope, String> {
        let request_id = value_key(&request.id);
        let (sender, receiver): (Sender<Value>, Receiver<Value>) = mpsc::channel();

        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "Engine pending requests poisoned".to_string())?;
            match pending.entry(request_id.clone()) {
                Entry::Occupied(_) => {
                    return Ok(error_response(
                        request.id.clone(),
                        DUPLICATE_REQUEST_ID_CODE,
                        format!(
                            "Request id {request_id} is already waiting for a response from the engine; the {} request was not sent.",
                            request.method
                        ),
                    ));
                }
                Entry::Vacant(slot) => {
                    slot.insert(sender);
                }
            }
        }

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

    /// Stops the engine gracefully (2026-09 audit Slice 11): close its stdin
    /// so the request loop ends — the engine releases any talkback hold on
    /// its way out — wait up to `ENGINE_STOP_GRACE` for it to exit, and kill
    /// it only if it does not. Used by the close confirmation and by engine
    /// restarts alike. The exit is reported like any other, with
    /// `graceful: true` (2026-09 production readiness, Slice 5 — finding F09).
    pub fn stop(&self) -> Result<(), String> {
        self.stop_with_grace(ENGINE_STOP_GRACE)
    }

    fn stop_with_grace(&self, grace: Duration) -> Result<(), String> {
        let stopping = {
            let mut slot = self
                .process
                .lock()
                .map_err(|_| "Engine bridge poisoned".to_string())?;
            slot.as_mut().map(|process| {
                // The flag goes up before the pipe closes: whichever of the
                // watcher and this call sees the exit first reports it as
                // expected.
                process.expected_exit = true;
                process.stdin = None;
                process.generation
            })
        };

        if let Some(generation) = stopping {
            let deadline = Instant::now() + grace;
            loop {
                let taken = {
                    let mut slot = self
                        .process
                        .lock()
                        .map_err(|_| "Engine bridge poisoned".to_string())?;
                    let exit = match slot.as_mut() {
                        Some(process) if process.generation == generation => {
                            match process.child.try_wait() {
                                Ok(None) if Instant::now() < deadline => None,
                                Ok(None) => {
                                    let _ = process.child.kill();
                                    Some(process.child.wait().ok().and_then(|status| status.code()))
                                }
                                Ok(Some(status)) => Some(status.code()),
                                Err(_) => Some(None),
                            }
                        }
                        // The watcher saw the exit first and reported it.
                        _ => break,
                    };
                    exit.and_then(|status| slot.take().map(|process| (process, status)))
                };
                match taken {
                    Some((process, status)) => {
                        report_engine_exit(process, status, &self.pending);
                        break;
                    }
                    None => thread::sleep(ENGINE_STOP_POLL_INTERVAL),
                }
            }
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

        Ok(process_guard.as_ref().map(EngineProcess::summary))
    }

    fn write_request(&self, request: &RequestEnvelope) -> Result<(), String> {
        let mut process_guard = self
            .process
            .lock()
            .map_err(|_| "Engine bridge poisoned".to_string())?;
        let process = process_guard
            .as_mut()
            .ok_or_else(|| "Engine is not running".to_string())?;
        let stdin = process
            .stdin
            .as_mut()
            .ok_or_else(|| "Engine is stopping".to_string())?;

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

/// Polls the engine process every `ENGINE_EXIT_WATCH_INTERVAL` and reports
/// its exit (2026-09 production readiness, Slice 5 — finding F09): until this
/// slice nothing watched the child, so a crashed engine left every request
/// waiting for its ten-second timeout and the front-end painting a session
/// that no longer existed. The mutex is held only for the poll; whichever of
/// the watcher and `stop()` takes the process out of the slot reports it, so
/// an exit is reported exactly once.
fn spawn_exit_watcher(
    process: Arc<Mutex<Option<EngineProcess>>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    generation: u64,
) {
    let _ = thread::Builder::new()
        .name(format!("engine-exit-watcher-{generation}"))
        .spawn(move || loop {
            thread::sleep(ENGINE_EXIT_WATCH_INTERVAL);
            let exited = {
                let Ok(mut slot) = process.lock() else {
                    return;
                };
                let status = match slot.as_mut() {
                    Some(current) if current.generation == generation => {
                        match current.child.try_wait() {
                            Ok(None) => continue,
                            Ok(Some(status)) => status.code(),
                            Err(_) => None,
                        }
                    }
                    // Taken by `stop()`, which reports it, or replaced by a
                    // newer launch: nothing left to watch.
                    _ => return,
                };
                slot.take().map(|process| (process, status))
            };
            if let Some((process, status)) = exited {
                report_engine_exit(process, status, &pending);
            }
            return;
        });
}

/// Fails every request still waiting for the process with `ENGINE_EXITED`,
/// then raises `engine.exited` for the front-end. Called once per process,
/// by whoever took it out of the slot.
fn report_engine_exit(
    mut process: EngineProcess,
    status: Option<i32>,
    pending: &Mutex<HashMap<String, Sender<Value>>>,
) {
    // Reaps the process: a no-op after `try_wait` saw the exit, required
    // after a kill.
    let _ = process.child.wait();

    let waiters: Vec<(String, Sender<Value>)> = match pending.lock() {
        Ok(mut pending) => pending.drain().collect(),
        Err(_) => Vec::new(),
    };
    let status_text = status
        .map(|code| format!("exit status {code}"))
        .unwrap_or_else(|| "no exit status".to_string());
    for (id, sender) in waiters {
        let response = error_response(
            Value::String(id),
            ENGINE_EXITED_CODE,
            format!("The hardware link stopped ({status_text}) before it answered this request."),
        );
        if let Ok(value) = serde_json::to_value(&response) {
            let _ = sender.send(value);
        }
    }

    (process.sink)(json!({
        "type": "event",
        "event": EVENT_ENGINE_EXITED,
        "payload": {
            "status": status,
            "graceful": process.expected_exit,
            "generation": process.generation,
            "pid": process.pid,
        },
    }));
}

fn spawn_stdout_thread(
    sink: EventSink,
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
                sink(message);
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

/// `<app-data>/exports`: the only place the shell writes a diagnostics export.
pub(crate) fn exports_dir_for(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(EXPORTS_DIR_NAME)
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
        Some(manifest_dir.join("../target/debug").join(binary_name)),
        Some(manifest_dir.join("../target/release").join(binary_name)),
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

    /// A process that exits on its own right away.
    fn short_lived_process() -> std::process::Command {
        if cfg!(windows) {
            let mut command = std::process::Command::new("cmd");
            command.args(["/C", "exit 0"]);
            command
        } else {
            std::process::Command::new("true")
        }
    }

    /// A process that ignores its stdin and lives for half a minute.
    fn lingering_process() -> std::process::Command {
        if cfg!(windows) {
            let mut command = std::process::Command::new("cmd");
            command.args(["/C", "ping -n 30 127.0.0.1 > nul"]);
            command
        } else {
            let mut command = std::process::Command::new("sleep");
            command.arg("30");
            command
        }
    }

    /// A process that exits once its stdin closes — the engine's own
    /// behaviour on a graceful stop.
    fn stdin_bound_process() -> std::process::Command {
        std::process::Command::new("sort")
    }

    /// An event sink that records into a channel, standing in for the Tauri
    /// event channel the production sink wraps.
    fn recording_sink() -> (EventSink, Receiver<Value>) {
        let (sender, receiver) = mpsc::channel::<Value>();
        let sink: EventSink = Arc::new(move |message: Value| {
            let _ = sender.send(message);
        });
        (sink, receiver)
    }

    fn payload_of(event: &Value) -> &Value {
        assert_eq!(event["type"], json!("event"), "{event}");
        assert_eq!(event["event"], json!(EVENT_ENGINE_EXITED), "{event}");
        &event["payload"]
    }

    // 2026-09 production readiness, Slice 5 (finding F09): an engine that
    // dies fails every waiting request with ENGINE_EXITED, raises
    // `engine.exited` with the exit status and its generation, and leaves the
    // bridge empty so the next start spawns a new process.
    #[test]
    fn exit_watcher_fails_pending_and_emits_event() {
        let bridge = EngineBridge::default();
        let (sink, events) = recording_sink();
        let (waiter_sender, waiter) = mpsc::channel::<Value>();
        bridge
            .pending
            .lock()
            .expect("pending map should lock")
            .insert("app.snapshot:7:abc".to_string(), waiter_sender);

        let summary = bridge
            .launch(short_lived_process(), PathBuf::from("short-lived"), sink)
            .expect("the short-lived process should launch");
        assert!(summary.running);
        assert_eq!(summary.generation, 1);
        assert!(summary.pid > 0);

        let raw = waiter
            .recv_timeout(Duration::from_secs(10))
            .expect("the waiting request is answered when the process exits");
        let response: ResponseEnvelope =
            serde_json::from_value(raw).expect("the drain sends a response envelope");
        assert!(!response.ok);
        assert_eq!(response.id, json!("app.snapshot:7:abc"));
        assert_eq!(
            response
                .error
                .as_ref()
                .and_then(|error| error.get("code"))
                .and_then(Value::as_str),
            Some(ENGINE_EXITED_CODE)
        );

        let event = events
            .recv_timeout(Duration::from_secs(10))
            .expect("engine.exited is raised");
        let payload = payload_of(&event);
        assert_eq!(payload["status"], json!(0));
        assert_eq!(payload["graceful"], json!(false));
        assert_eq!(payload["generation"], json!(1));
        assert_eq!(payload["pid"], json!(summary.pid));

        assert!(bridge.summary().expect("summary should answer").is_none());
        assert!(bridge
            .pending
            .lock()
            .expect("pending map should lock")
            .is_empty());
        assert!(events.try_recv().is_err(), "the exit is reported once");
    }

    // 2026-09 production readiness, Slice 5 (finding F09), replacing the
    // audit Slice 11 wait_for_exit test: a graceful stop closes stdin, waits
    // for the process to exit, and reports `graceful: true`; a process that
    // ignores its stdin is killed once the grace elapses and still gets its
    // report. Whichever path takes the process reports it exactly once.
    #[test]
    fn stop_reports_a_graceful_exit_and_kills_a_lingering_engine() {
        let bridge = EngineBridge::default();
        let (sink, events) = recording_sink();

        bridge
            .launch(stdin_bound_process(), PathBuf::from("stdin-bound"), sink)
            .expect("the stdin-bound process should launch");
        let started = Instant::now();
        bridge
            .stop_with_grace(Duration::from_secs(10))
            .expect("stop should succeed");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "closing stdin ends the process without waiting for the grace"
        );
        let event = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the stop reports the exit");
        let payload = payload_of(&event);
        assert_eq!(payload["graceful"], json!(true));
        assert_eq!(payload["generation"], json!(1));
        assert!(bridge.summary().expect("summary").is_none());

        let (sink, events) = recording_sink();
        let summary = bridge
            .launch(lingering_process(), PathBuf::from("lingering"), sink)
            .expect("the lingering process should launch");
        assert_eq!(summary.generation, 2);
        let started = Instant::now();
        bridge
            .stop_with_grace(Duration::from_millis(200))
            .expect("stop should succeed");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the lingering process is killed after the grace"
        );
        let event = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the kill is reported too");
        let payload = payload_of(&event);
        assert_eq!(payload["graceful"], json!(true));
        assert_eq!(payload["generation"], json!(2));
        assert!(bridge.summary().expect("summary").is_none());
        // The watcher of the killed process finds an empty slot and stays
        // silent.
        thread::sleep(ENGINE_EXIT_WATCH_INTERVAL * 2);
        assert!(events.try_recv().is_err(), "the exit is reported once");
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
        let dev_engine = manifest_dir.join("../target/debug").join(binary_name);

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
        let dev_engine = manifest_dir.join("../target/debug").join(binary_name);

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
        let dev_engine = manifest_dir.join("../target/debug").join(binary_name);

        touch(&shell_exe);
        touch(&manifest_dir.join("Cargo.toml"));
        touch(&dev_engine);

        let resolved =
            resolve_engine_binary_from(None, Some(shell_exe), &manifest_dir, binary_name)
                .expect("dev engine candidate should resolve");

        assert_eq!(resolved, dev_engine);
    }

    // 2026-09 production readiness, Slice 4 (finding F08): an id that is
    // already waiting for a response is refused before anything is written,
    // the original waiter keeps its slot, and a fresh id still fails on the
    // write (no engine) without leaving a slot behind.
    #[test]
    fn request_refuses_duplicate_pending_id() {
        let bridge = EngineBridge::default();
        let (first_sender, first_receiver) = mpsc::channel::<Value>();
        bridge
            .pending
            .lock()
            .expect("pending map should lock")
            .insert("app.snapshot:1:abc".to_string(), first_sender);

        let duplicate = RequestEnvelope {
            kind: "request".to_string(),
            id: json!("app.snapshot:1:abc"),
            method: "app.snapshot".to_string(),
            params: json!({}),
        };
        let response = bridge
            .request(duplicate)
            .expect("a duplicate id is answered, not dropped");

        assert!(!response.ok);
        assert_eq!(response.id, json!("app.snapshot:1:abc"));
        assert_eq!(
            response
                .error
                .as_ref()
                .and_then(|error| error.get("code"))
                .and_then(Value::as_str),
            Some(DUPLICATE_REQUEST_ID_CODE)
        );
        let message = response
            .error
            .as_ref()
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        assert!(message.contains("app.snapshot:1:abc"), "{message}");

        // The original waiter still owns the slot: a reply routed by id reaches it.
        {
            let pending = bridge.pending.lock().expect("pending map should lock");
            let original = pending
                .get("app.snapshot:1:abc")
                .expect("the original slot survives the refusal");
            original
                .send(json!({ "type": "response", "id": "app.snapshot:1:abc", "ok": true }))
                .expect("the original receiver is still alive");
        }
        assert!(first_receiver.try_recv().is_ok());

        let fresh = RequestEnvelope {
            kind: "request".to_string(),
            id: json!("app.snapshot:2:abc"),
            method: "app.snapshot".to_string(),
            params: json!({}),
        };
        let error = bridge.request(fresh).expect_err("no engine is running");
        assert!(error.contains("Engine is not running"), "{error}");
        assert!(!bridge
            .pending
            .lock()
            .expect("pending map should lock")
            .contains_key("app.snapshot:2:abc"));
    }
}
