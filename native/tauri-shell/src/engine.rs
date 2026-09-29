use serde::Serialize;
use serde_json::{json, Value};
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fs::create_dir_all;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::shell_log::{SharedShellLog, ShellLog, SHELL_LOG_FILE_NAME};
use crate::shell_pictures::{PicturesLink, PicturesLog, PicturesStore};
use crate::shell_prompter_window::WatchWake;
use crate::shell_windows::{deliveries, listens_in};
use studio_control_protocol::development::{
    build_marked_in, default_app_data_dir, development_build, host_platform, refuse_studio_folders,
    MarkedBuild,
};
use studio_control_protocol::pictures::{LINK_ADDRESS_ENV, LINK_SECRET_ENV};
use studio_control_protocol::{
    error_response, RequestEnvelope, ResponseEnvelope, EVENT_ENGINE_EXITED, EVENT_ENGINE_READY,
    PROTOCOL_VERSION,
};
use tauri::{AppHandle, Emitter, Manager};

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

/// An event goes to the windows it is for (`shell_windows::windows_for`),
/// each on its own channel (`shell_windows::event_channel`): every window
/// heard every event, the meters 30 times a second among them. When the
/// hardware link has started, the watch over the screens is woken, so that
/// the hardware link hears of the Prompter XL at once and not a second
/// later: it starts knowing nothing of it.
fn app_event_sink(app: AppHandle) -> EventSink {
    Arc::new(move |message: Value| {
        let name = message
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if name == EVENT_ENGINE_READY {
            if let Some(wake) = app.try_state::<WatchWake>() {
                wake.wake();
            }
        }
        let payload = json!({ "event": message });
        for (window, channel) in deliveries(&name) {
            let _ = app.emit_filter(channel, payload.clone(), |target| {
                listens_in(target, &[window])
            });
        }
    })
}

#[derive(Default)]
pub struct EngineBridge {
    process: Arc<Mutex<Option<EngineProcess>>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    /// `<logs>/shell.log`, where every engine stderr line is kept (2026-09
    /// production readiness, Slice 8 — finding F16). Opened by the first
    /// start and shared by every launch after it, so the rotation counts
    /// across engine restarts.
    shell_log: Mutex<Option<SharedShellLog>>,
    /// Counts engine launches for the life of the shell. Each launch's
    /// generation tags its `engine.exited` event, so the front-end can tell
    /// a report about a process it already replaced from one about the
    /// process it is talking to.
    generations: AtomicU64,
    /// The newest frame of each camera, which the page takes
    /// (`shell_pictures.rs`), for the life of the shell.
    pictures: Arc<PicturesStore>,
}

struct EngineProcess {
    child: Child,
    /// `None` once a stop closed the pipe: the engine's request loop ends on
    /// EOF.
    stdin: Option<ChildStdin>,
    binary_path: PathBuf,
    generation: u64,
    pid: u32,
    /// Set by `stop()` before it closes stdin, so an exit the watcher sees
    /// first is still reported as `graceful: true`. Only read and written
    /// under the process mutex.
    expected_exit: bool,
    sink: EventSink,
    /// This start's frame listener; it closes with the process.
    _pictures_link: Option<PicturesLink>,
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

        let binary_path = resolve_engine_binary().map_err(|not_started| {
            self.log_shell_line("SHELL", &not_started.detail);
            not_started.sentence
        })?;
        let (app_data_dir, logs_dir) = resolve_runtime_directories()?;
        create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        create_dir_all(&logs_dir).map_err(|error| error.to_string())?;
        create_dir_all(exports_dir_for(&app_data_dir)).map_err(|error| error.to_string())?;

        let mut command = Command::new(&binary_path);
        command
            .env("SSE_PROTOCOL_VERSION", PROTOCOL_VERSION)
            .env("SSE_APP_DATA_DIR", &app_data_dir)
            .env("SSE_LOG_DIR", &logs_dir);
        let shell_log = self.shell_log_for(&logs_dir)?;
        // The pictures' frame listener of this start, its address and its
        // secret for the engine alone (it hands them to the pictures helper).
        // Without it the hardware link starts all the same, with no pictures.
        // Only a development build has a helper to use it until NDI is built
        // (the owner, 2026-09-29); elsewhere, and when it does not open, no
        // value from the shell's own environment reaches the engine.
        command
            .env_remove(LINK_ADDRESS_ENV)
            .env_remove(LINK_SECRET_ENV);
        let pictures_link = development_build()
            .then(|| {
                let shell_log = Arc::clone(&shell_log);
                let log: PicturesLog = Arc::new(move |line: &str| {
                    if let Ok(mut log) = shell_log.lock() {
                        let _ = log.write_line("PICTURES", line);
                    }
                });
                match PicturesLink::open(Arc::clone(&self.pictures), Arc::clone(&log)) {
                    Ok(link) => {
                        command
                            .env(LINK_ADDRESS_ENV, link.address().to_string())
                            .env(LINK_SECRET_ENV, link.secret());
                        Some(link)
                    }
                    Err(error) => {
                        log(&format!(
                            "The pictures' listener did not open: {error}. No pictures."
                        ));
                        None
                    }
                }
            })
            .flatten();
        // The engine is a console-subsystem binary; without CREATE_NO_WINDOW a
        // GUI-subsystem shell would pop a fresh terminal for it on Windows.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        self.launch_with_link(
            command,
            binary_path,
            app_event_sink(app.clone()),
            Some(shell_log),
            pictures_link,
        )
    }

    /// The newest frame of each camera.
    pub(crate) fn pictures(&self) -> &PicturesStore {
        &self.pictures
    }

    /// One line of the shell's own in `<logs>/shell.log`, the file the
    /// engine's stderr goes to, through the same shared handle (new pages
    /// program, Slice 3: the technical detail of a window command that did not
    /// finish, whose screen sentence stays plain; a WebView2 setting the shell
    /// could not apply). Best effort: when the logs folder cannot be resolved
    /// or written, the line goes to stderr; debug builds echo it there as
    /// well, like the engine's lines.
    pub fn log_shell_line(&self, label: &str, message: &str) {
        let written = resolve_runtime_directories()
            .map(|(_, logs_dir)| self.log_shell_line_in(&logs_dir, label, message))
            .unwrap_or(false);
        if !written || cfg!(debug_assertions) {
            eprintln!("{label} {message}");
        }
    }

    /// `log_shell_line` for a known logs folder; true when the line was written.
    fn log_shell_line_in(&self, logs_dir: &Path, label: &str, message: &str) -> bool {
        self.shell_log_for(logs_dir)
            .map(|log| {
                log.lock()
                    .map(|mut log| log.write_line(label, message).is_ok())
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    /// The shell log for `logs_dir`, opened once per shell.
    fn shell_log_for(&self, logs_dir: &Path) -> Result<SharedShellLog, String> {
        let mut slot = self
            .shell_log
            .lock()
            .map_err(|_| "Engine shell log poisoned".to_string())?;
        if let Some(log) = slot.as_ref() {
            let same_file = log
                .lock()
                .map(|log| log.path() == logs_dir.join(SHELL_LOG_FILE_NAME))
                .unwrap_or(false);
            if same_file {
                return Ok(Arc::clone(log));
            }
        }
        let log = ShellLog::open(logs_dir).shared();
        *slot = Some(Arc::clone(&log));
        Ok(log)
    }

    /// `launch_with_link` without a frame listener: the tests' stand-ins.
    #[cfg(test)]
    fn launch(
        &self,
        command: Command,
        binary_path: PathBuf,
        sink: EventSink,
        shell_log: Option<SharedShellLog>,
    ) -> Result<EngineBootstrapSummary, String> {
        self.launch_with_link(command, binary_path, sink, shell_log, None)
    }

    /// Spawns `command` as the engine process, wires its stdout to `sink`
    /// and its stderr to `shell_log` (the production path always has one),
    /// and starts the exit watcher for it. A running engine is returned as
    /// it is; nothing is spawned twice, and a frame listener opened for a
    /// start that did not happen closes unused, its secret with it.
    fn launch_with_link(
        &self,
        mut command: Command,
        binary_path: PathBuf,
        sink: EventSink,
        shell_log: Option<SharedShellLog>,
        pictures_link: Option<PicturesLink>,
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
        spawn_stderr_thread(stderr, shell_log);

        let process = EngineProcess {
            child,
            stdin: Some(stdin),
            binary_path,
            generation,
            pid,
            expected_exit: false,
            sink,
            _pictures_link: pictures_link,
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
    /// so the request loop ends, wait up to `ENGINE_STOP_GRACE` for it to exit, and kill
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

/// Every engine stderr line goes to `<logs>/shell.log` (finding F16): the
/// engine keeps its own log once its runtime paths resolve, so what arrives
/// here is what it could not log — the failures before that point, a
/// panic. Debug builds echo the line to the console as well.
fn spawn_stderr_thread(stderr: ChildStderr, shell_log: Option<SharedShellLog>) {
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else {
                continue;
            };
            if let Some(log) = shell_log.as_ref() {
                if let Ok(mut log) = log.lock() {
                    let _ = log.write_line("ENGINE-STDERR", &line);
                }
            }
            #[cfg(debug_assertions)]
            eprintln!("engine stderr: {line}");
        }
    });
}

/// `<app-data>/exports`: the only place the shell writes a diagnostics export.
pub(crate) fn exports_dir_for(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(EXPORTS_DIR_NAME)
}

/// The folders of this start. A development build is refused the studio's
/// folders here (`studio_control_protocol::development`): every folder the
/// shell creates, writes or opens comes from this function, so a development
/// shell stops before it writes as much as a line of `shell.log` there.
pub(crate) fn resolve_runtime_directories() -> Result<(PathBuf, PathBuf), String> {
    let platform = host_platform();
    let app_data_dir = match env_path("SSE_APP_DATA_DIR") {
        Some(path) => path,
        None => default_app_data_dir(platform, |name| std::env::var_os(name))?,
    };
    let logs_dir = env_path("SSE_LOG_DIR").unwrap_or_else(|| app_data_dir.join("logs"));

    if !app_data_dir.is_absolute() || !logs_dir.is_absolute() {
        return Err("Runtime paths must resolve to absolute directories.".to_string());
    }
    refuse_studio_folders(
        development_build(),
        platform,
        &[&app_data_dir, &logs_dir],
        |name| std::env::var_os(name),
    )?;

    Ok((app_data_dir, logs_dir))
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// The engine this shell starts: the one in the shell's own folder, and no
/// other. A studio build is a folder that holds both, and cargo puts both in
/// one folder as well (`native/target/debug`, where `npm run app` and the
/// lanes run them). Until 2026-09-28 a shell with no engine beside it went
/// on to the repository's `target/debug` and `target/release`, whose path is
/// compiled in, and `SSE_ENGINE_BIN` named any other: a studio build could
/// start whatever engine the last development build had left there.
///
/// And only an engine of the shell's own build (2026-09-29): until then a
/// development shell built alone into `native/target/release` would have
/// started the studio engine `npm run release` leaves there, which drives
/// the studio's devices.
pub(crate) fn resolve_engine_binary() -> Result<PathBuf, NotStarted> {
    let binary_name = if cfg!(target_os = "windows") {
        "studio-control-engine.exe"
    } else {
        // The Linux CI runners' build.
        "studio-control-engine"
    };

    engine_to_start(
        std::env::current_exe().ok(),
        binary_name,
        MarkedBuild::this_build(),
    )
}

/// Why the shell did not start the engine beside it: a sentence for the
/// screen, and the detail for `shell.log`.
#[derive(Debug)]
pub(crate) struct NotStarted {
    pub(crate) sentence: String,
    pub(crate) detail: String,
}

impl NotStarted {
    fn saying(message: String) -> Self {
        Self {
            sentence: message.clone(),
            detail: message,
        }
    }
}

/// The engine beside the shell, when its file says it is of `shell`'s build
/// (`MarkedBuild::this_build`): both development builds, or the studio build
/// of one commit. The file is read, never started: an engine, once started,
/// opens its saved data and the devices at once.
fn engine_to_start(
    current_exe: Option<PathBuf>,
    binary_name: &str,
    shell: MarkedBuild<'_>,
) -> Result<PathBuf, NotStarted> {
    let path = resolve_engine_binary_from(current_exe, binary_name).map_err(NotStarted::saying)?;
    let (this, advice) = match shell {
        MarkedBuild::Studio(commit) => (
            format!("This studio build of Studio Control ({})", short(commit)),
            "Start Studio Control from the builds folder, where each build holds both.",
        ),
        _ => (
            "This development build of Studio Control".to_string(),
            "Build both with npm run app.",
        ),
    };
    let file = std::fs::read(&path).map_err(|error| NotStarted {
        sentence: format!(
            "{this} could not read the hardware link beside it, so it did not start it: {error}. {advice}"
        ),
        detail: format!("Not started: {} could not be read: {error}.", path.display()),
    })?;
    let engine = build_marked_in(&file);
    let why = match (shell, engine) {
        (MarkedBuild::Development, MarkedBuild::Development) => return Ok(path),
        (MarkedBuild::Studio(own), MarkedBuild::Studio(theirs)) if own == theirs => {
            return Ok(path)
        }
        (MarkedBuild::Studio(_), MarkedBuild::Studio(theirs)) => {
            format!(
                "that one is the studio build of {}, another commit",
                short(theirs)
            )
        }
        (_, MarkedBuild::Studio(theirs)) => format!(
            "that one is a studio build ({}), which drives the studio's devices",
            short(theirs)
        ),
        (_, MarkedBuild::Development) => "that one is a development build".to_string(),
        (_, MarkedBuild::Unmarked) => {
            "that one is from an older build, which does not say what build it is".to_string()
        }
        (_, MarkedBuild::Conflicting) => {
            "that one says two different things about what build it is".to_string()
        }
    };
    Err(NotStarted {
        sentence: format!("{this} did not start the hardware link beside it: {why}. {advice}"),
        detail: format!(
            "Not started: {} is {}, and this shell is {}.",
            path.display(),
            described(engine),
            described(shell)
        ),
    })
}

/// A commit as the screen shows it.
fn short(commit: &str) -> &str {
    commit.get(..7).unwrap_or(commit)
}

/// A build as `shell.log` names it.
fn described(build: MarkedBuild<'_>) -> String {
    match build {
        MarkedBuild::Development => "a development build".to_string(),
        MarkedBuild::Studio(commit) => format!("the studio build of {commit}"),
        MarkedBuild::Unmarked => "unmarked".to_string(),
        MarkedBuild::Conflicting => "marked as two different builds".to_string(),
    }
}

fn resolve_engine_binary_from(
    current_exe: Option<PathBuf>,
    binary_name: &str,
) -> Result<PathBuf, String> {
    let beside = current_exe
        .as_deref()
        .and_then(Path::parent)
        .map(|folder| folder.join(binary_name))
        .ok_or_else(|| {
            format!("The app could not read its own folder, where it starts {binary_name}.")
        })?;
    if binary_exists(&beside) {
        return Ok(beside);
    }
    Err(format!(
        "{} is missing. The app starts it from its own folder and from nowhere else, so this build is incomplete.",
        beside.display()
    ))
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

    /// A process that ignores its stdin and lives for half a minute. On
    /// Windows it is `ping` itself, not `cmd /C ping`: killing `cmd` left
    /// PING.EXE running with the test run's output handles, so a piped
    /// `cargo test` sat 20 s after its last test (2026-09-25).
    fn lingering_process() -> std::process::Command {
        if cfg!(windows) {
            let mut command = std::process::Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
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

    /// A process that writes one line to stderr and exits.
    fn stderr_process() -> std::process::Command {
        if cfg!(windows) {
            let mut command = std::process::Command::new("cmd");
            command.args(["/C", "echo engine-stderr-probe 1>&2"]);
            command
        } else {
            let mut command = std::process::Command::new("sh");
            command.args(["-c", "echo engine-stderr-probe >&2"]);
            command
        }
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
            .launch(
                short_lived_process(),
                PathBuf::from("short-lived"),
                sink,
                None,
            )
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

    // 2026-09 production readiness, Slice 8 (finding F16): what the engine
    // writes to stderr is kept in `<logs>/shell.log`.
    #[test]
    fn stderr_lines_reach_shell_log() {
        let bridge = EngineBridge::default();
        let (sink, _events) = recording_sink();
        let tree = TempTree::new("stderr-to-shell-log");
        let logs_dir = tree.path("logs");
        let shell_log = ShellLog::open(&logs_dir).shared();

        bridge
            .launch(
                stderr_process(),
                PathBuf::from("stderr-probe"),
                sink,
                Some(Arc::clone(&shell_log)),
            )
            .expect("the stderr process should launch");

        let log_path = logs_dir.join(SHELL_LOG_FILE_NAME);
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut content = String::new();
        while Instant::now() < deadline {
            content = fs::read_to_string(&log_path).unwrap_or_default();
            if content.contains("engine-stderr-probe") {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            content.contains("ENGINE-STDERR engine-stderr-probe"),
            "shell.log should carry the engine's stderr line, got: {content:?}"
        );
        assert!(content.starts_with('['), "{content:?}");
    }

    // New pages program, Slice 3: what the shell keeps off the screen — the
    // detail of a window command that did not finish, a WebView2 setting it
    // could not apply — is one line of its own in shell.log, beside the
    // engine's, through the handle the engine's launches share.
    #[test]
    fn shell_lines_reach_shell_log_through_the_shared_handle() {
        let bridge = EngineBridge::default();
        let tree = TempTree::new("shell-line");
        let logs_dir = tree.path("logs");

        assert!(bridge.log_shell_line_in(
            &logs_dir,
            "SHELL",
            "WebView2 browser keys stayed on: probe"
        ));
        assert!(bridge.log_shell_line_in(&logs_dir, "SHELL", "second line"));

        let content =
            fs::read_to_string(logs_dir.join(SHELL_LOG_FILE_NAME)).expect("shell.log is written");
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "{content:?}");
        assert!(lines[0].starts_with('['), "{content:?}");
        assert!(
            lines[0].ends_with("] SHELL WebView2 browser keys stayed on: probe"),
            "{content:?}"
        );
        assert!(lines[1].ends_with("] SHELL second line"), "{content:?}");
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
            .launch(
                stdin_bound_process(),
                PathBuf::from("stdin-bound"),
                sink,
                None,
            )
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
            .launch(lingering_process(), PathBuf::from("lingering"), sink, None)
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

    // Streamlining, 2026-09-28: the shell starts the engine in its own folder
    // and no other. Until then a shell with none beside it took the
    // repository's `target/debug`, then its `target/release`, and
    // `SSE_ENGINE_BIN` named any other.
    #[test]
    fn the_engine_beside_the_shell_is_the_one_started() {
        let tree = TempTree::new("beside");
        let binary_name = "studio-control-engine";
        let shell_exe = tree.path("build/sse-exed-tauri-shell");
        let engine = tree.path("build/studio-control-engine");
        touch(&shell_exe);
        touch(&engine);

        let resolved = resolve_engine_binary_from(Some(shell_exe), binary_name)
            .expect("the engine beside the shell resolves");

        assert_eq!(resolved, engine);
    }

    #[test]
    fn a_shell_with_no_engine_beside_it_starts_none() {
        let tree = TempTree::new("alone");
        let binary_name = "studio-control-engine";
        let shell_exe = tree.path("build/sse-exed-tauri-shell");
        touch(&shell_exe);
        // What the old search went on to: the engines a development build
        // leaves in the repository.
        touch(&tree.path("repo/native/target/debug/studio-control-engine"));
        touch(&tree.path("repo/native/target/release/studio-control-engine"));
        // A folder of that name is not an engine.
        fs::create_dir_all(tree.path("folder/studio-control-engine")).expect("a folder");
        touch(&tree.path("folder/sse-exed-tauri-shell"));

        let expected = shell_exe
            .parent()
            .expect("the shell's folder")
            .join(binary_name);
        let error = resolve_engine_binary_from(Some(shell_exe), binary_name)
            .expect_err("no engine beside the shell");
        assert!(error.contains(&expected.display().to_string()), "{error}");
        assert!(error.contains("missing"), "{error}");

        resolve_engine_binary_from(Some(tree.path("folder/sse-exed-tauri-shell")), binary_name)
            .expect_err("a folder is not an engine");
        let error = resolve_engine_binary_from(None, binary_name)
            .expect_err("a shell that cannot read its own path starts nothing");
        assert!(error.contains(binary_name), "{error}");
    }

    // 2026-09-29: the shell reads the mark in the engine's file and starts
    // only an engine of its own build. A development shell built alone into
    // `native/target/release` would have started the studio engine that
    // `npm run release` leaves there.
    #[test]
    fn a_shell_starts_only_a_hardware_link_of_its_own_build() {
        use studio_control_protocol::development::build_mark_of;

        let a = "55efa2990123456789abcdef0123456789abcdef";
        let b = "0123456789abcdef0123456789abcdef01234567";
        let binary_name = "studio-control-engine";
        let tree = TempTree::new("kind");
        let junk: &[u8] = b"\0\x7fELF the hardware link's code and strings \xff";
        let file = |marks: &[&[u8]]| {
            let mut bytes = junk.to_vec();
            for mark in marks {
                bytes.extend_from_slice(mark);
                bytes.extend_from_slice(junk);
            }
            bytes
        };
        let start = |label: &str, shell: MarkedBuild<'static>, engine: &[u8]| {
            let shell_exe = tree.path(&format!("{label}/sse-exed-tauri-shell"));
            touch(&shell_exe);
            fs::write(tree.path(&format!("{label}/{binary_name}")), engine)
                .expect("the engine's file is written");
            engine_to_start(Some(shell_exe), binary_name, shell)
        };
        let development = build_mark_of(None);
        let studio_a = build_mark_of(Some(a));
        let studio_b = build_mark_of(Some(b));

        // Started: both development builds, or the studio build of one commit.
        let started = start("dev-dev", MarkedBuild::Development, &file(&[&development]))
            .expect("a development shell starts a development engine");
        assert_eq!(started, tree.path(&format!("dev-dev/{binary_name}")));
        start("a-a", MarkedBuild::Studio(a), &file(&[&studio_a]))
            .expect("a studio shell starts the studio engine of its own commit");

        // Refused, each with its reason, in words the screen may show.
        for (label, shell, engine, reason, commits) in [
            (
                "dev-a",
                MarkedBuild::Development,
                file(&[&studio_a]),
                "that one is a studio build (55efa29), which drives the studio's devices",
                vec![a],
            ),
            (
                "a-dev",
                MarkedBuild::Studio(a),
                file(&[&development]),
                "that one is a development build",
                vec![a],
            ),
            (
                "a-b",
                MarkedBuild::Studio(a),
                file(&[&studio_b]),
                "that one is the studio build of 0123456, another commit",
                vec![a, b],
            ),
            (
                "dev-empty",
                MarkedBuild::Development,
                Vec::new(),
                "that one is from an older build",
                vec![],
            ),
            (
                "a-unmarked",
                MarkedBuild::Studio(a),
                file(&[]),
                "that one is from an older build",
                vec![a],
            ),
            (
                "dev-both",
                MarkedBuild::Development,
                file(&[&development, &studio_a]),
                "that one says two different things",
                vec![],
            ),
        ] {
            let refused = start(label, shell, &engine).expect_err(label);
            let sentence = &refused.sentence;
            assert!(sentence.contains(reason), "{label}: {sentence}");
            assert!(
                sentence.contains("did not start the hardware link beside it"),
                "{label}: {sentence}"
            );
            let advice = match shell {
                MarkedBuild::Studio(_) => "from the builds folder",
                _ => "npm run app",
            };
            assert!(sentence.contains(advice), "{label}: {sentence}");
            let lower = sentence.to_lowercase();
            for word in ["engine", "backend", "transport", "ipc", "snapshot"] {
                assert!(!lower.contains(word), "{label}: {word} in {sentence}");
            }
            // Joined, as the shell joins it: a `/` in the middle would print
            // otherwise than the shell's path on Windows.
            let engine_path = tree.path(label).join(binary_name);
            assert!(
                refused.detail.contains(&engine_path.display().to_string()),
                "{label}: {}",
                refused.detail
            );
            for commit in commits {
                assert!(
                    refused.detail.contains(commit),
                    "{label}: {}",
                    refused.detail
                );
            }
        }

        // With no engine beside it, the shell says so, as before.
        let alone = tree.path("alone/sse-exed-tauri-shell");
        touch(&alone);
        let missing = engine_to_start(Some(alone), binary_name, MarkedBuild::Development)
            .expect_err("no engine beside the shell");
        assert!(missing.sentence.contains("missing"), "{}", missing.sentence);
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
