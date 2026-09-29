//! plan PR 8 / workstream E1.
//!
//! End-to-end integration test that spawns the studio-control-engine
//! binary, drives a minimal JSONL request lifecycle over stdin/stdout
//! (`engine.ping` → `app.snapshot`), and confirms a clean shutdown when
//! stdin closes. Reuses the patterns from `scripts/native-acceptance.mjs`
//! but in Rust so the engine's public contract is exercised in
//! `cargo test`, not only in the Node harness.
//!
//! Scope is deliberately small: the larger workflow (seed → mutate →
//! backup → restart → restore → verify rollback) already runs under
//! `npm run native:acceptance` + the CI `rust` job's `native-acceptance`
//! step (B3). This test gives the same lane Rust-side coverage of the
//! "engine boots, dispatch works, exits clean" contract.

use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use studio_control_protocol::development::development_build;
use studio_control_protocol::PROTOCOL_VERSION;

fn engine_binary_path() -> PathBuf {
    // Cargo sets this env var for integration tests of crates that
    // define a binary target with the same name.
    PathBuf::from(env!("CARGO_BIN_EXE_studio-control-engine"))
}

fn unique_runtime_dir(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = env::temp_dir().join(format!(
        "studio-control-engine-e2e-{label}-{}-{unique}",
        std::process::id()
    ));
    fs::create_dir_all(&path).expect("runtime dir should be created");
    path
}

struct EngineProcess {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    runtime_dir: PathBuf,
}

impl EngineProcess {
    fn spawn(label: &str) -> Self {
        Self::spawn_with(label, |_command, _runtime_dir| {})
    }

    /// Spawns the engine against a fresh runtime dir (`SSE_APP_DATA_DIR` and
    /// `SSE_LOG_DIR` set) and lets the caller stage files in that dir or
    /// adjust the command before the process starts. New pages program,
    /// Slice 2b (2026-09-25): hardened as the lanes are — a Stream Deck
    /// bridge port the system picks (never the live app's 38201), the light
    /// outputs held (`SSE_SAFE_START`) and the simulated console
    /// (`SSE_AUDIO_SIMULATED_INPUT_MODE`). Slice 8:
    /// the simulated cameras too (`SSE_CAMERAS_SIMULATED`), so no spawn can
    /// reach a camera. Streamlining, 2026-09-28: and the simulated lights
    /// (`SSE_LIGHTS_SIMULATED`).
    fn spawn_with<F: FnOnce(&mut Command, &PathBuf)>(label: &str, configure: F) -> Self {
        let runtime_dir = unique_runtime_dir(label);
        let mut command = Command::new(engine_binary_path());
        command
            .env("SSE_APP_DATA_DIR", &runtime_dir)
            .env("SSE_LOG_DIR", runtime_dir.join("logs"))
            .env("SSE_CONTROL_SURFACE_PORT", "0")
            .env("SSE_SAFE_START", "1")
            .env("SSE_LIGHTS_SIMULATED", "1")
            .env("SSE_AUDIO_SIMULATED_INPUT_MODE", "1")
            .env("SSE_CAMERAS_SIMULATED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure(&mut command, &runtime_dir);
        let mut child = command.spawn().expect("engine binary should spawn");
        let stdin = child.stdin.take().expect("stdin pipe");
        let stdout = BufReader::new(child.stdout.take().expect("stdout pipe"));
        Self {
            child,
            stdin,
            stdout,
            runtime_dir,
        }
    }

    fn send(&mut self, payload: &Value) {
        let line = format!("{payload}\n");
        self.stdin.write_all(line.as_bytes()).expect("stdin write");
        self.stdin.flush().expect("stdin flush");
    }

    /// Read JSON messages from stdout until one matches `predicate`, or
    /// the deadline elapses. Returns the matching message.
    fn wait_for<F: Fn(&Value) -> bool>(&mut self, label: &str, predicate: F) -> Value {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut line = String::new();
        while Instant::now() < deadline {
            line.clear();
            let read = self
                .stdout
                .read_line(&mut line)
                .expect("stdout should be readable");
            if read == 0 {
                panic!(
                    "engine closed stdout before {label} was observed (last line buffer: {line:?})"
                );
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: Value = serde_json::from_str(trimmed)
                .unwrap_or_else(|err| panic!("engine emitted non-JSON line {trimmed:?}: {err}"));
            if predicate(&parsed) {
                return parsed;
            }
        }
        panic!("timed out waiting for {label}");
    }

    fn shutdown(mut self) {
        // Close stdin to signal the engine to exit cleanly.
        drop(self.stdin);
        let status = self
            .child
            .wait()
            .expect("engine should exit after stdin closes");
        assert!(
            status.success(),
            "engine must exit cleanly after stdin EOF (got {status:?})"
        );
        let _ = fs::remove_dir_all(&self.runtime_dir);
    }
}

fn response_with_id(id: &'static str) -> impl Fn(&Value) -> bool {
    move |value| {
        value.get("type").and_then(Value::as_str) == Some("response")
            && value.get("id").and_then(Value::as_str) == Some(id)
    }
}

// 2026-09 audit remediation, Slice 8 (operator decision 7): a fresh
// workstation has run no probe, so `stage: ready` must be refused and name
// every probe; the explicit override publishes and is recorded.
#[test]
fn commissioning_publish_is_refused_until_probes_pass_or_the_operator_overrides() {
    let mut engine = EngineProcess::spawn("publish-gate");
    engine.wait_for("engine.ready event", |value| {
        value.get("type").and_then(Value::as_str) == Some("event")
            && value.get("event").and_then(Value::as_str) == Some("engine.ready")
    });

    engine.send(&json!({
        "type": "request",
        "id": "publish-1",
        "method": "commissioning.update",
        "params": { "stage": "ready" }
    }));
    let refused = engine.wait_for("publish refusal", response_with_id("publish-1"));
    assert_eq!(
        refused.get("ok").and_then(Value::as_bool),
        Some(false),
        "publishing with no probe run must be refused (got {refused})"
    );
    assert_eq!(
        refused.pointer("/error/code").and_then(Value::as_str),
        Some("COMMISSIONING_PROBES_INCOMPLETE"),
        "{refused}"
    );
    let message = refused
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or_default();
    for probe in [
        "Control Surface Probe not run",
        "Lighting Bridge Probe not run",
        "Audio OSC Probe not run",
    ] {
        assert!(message.contains(probe), "{message}");
    }

    engine.send(&json!({
        "type": "request",
        "id": "snapshot-1",
        "method": "commissioning.snapshot",
        "params": {}
    }));
    let before = engine.wait_for("snapshot before override", response_with_id("snapshot-1"));
    assert_eq!(
        before
            .pointer("/result/hasCompletedSetup")
            .and_then(Value::as_bool),
        Some(false),
        "a refused publish must leave setup incomplete (got {before})"
    );
    assert!(
        before
            .pointer("/result/publishOverrideAt")
            .is_none_or(Value::is_null),
        "{before}"
    );

    engine.send(&json!({
        "type": "request",
        "id": "publish-2",
        "method": "commissioning.update",
        "params": { "stage": "ready", "overrideProbes": true }
    }));
    let published = engine.wait_for("overridden publish", response_with_id("publish-2"));
    assert_eq!(
        published.get("ok").and_then(Value::as_bool),
        Some(true),
        "the explicit override must publish (got {published})"
    );
    assert_eq!(
        published
            .pointer("/result/startup/targetSurface")
            .and_then(Value::as_str),
        Some("dashboard"),
        "{published}"
    );

    engine.send(&json!({
        "type": "request",
        "id": "snapshot-2",
        "method": "commissioning.snapshot",
        "params": {}
    }));
    let after = engine.wait_for("snapshot after override", response_with_id("snapshot-2"));
    assert_eq!(
        after
            .pointer("/result/hasCompletedSetup")
            .and_then(Value::as_bool),
        Some(true),
        "{after}"
    );
    let override_at = after
        .pointer("/result/publishOverrideAt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(
        !override_at.is_empty(),
        "an override must be recorded ({after})"
    );
    let readiness = after
        .pointer("/result/readinessSummary")
        .and_then(Value::as_str)
        .unwrap_or_default();
    assert!(
        readiness.contains(&format!("Published with a probe override at {override_at}")),
        "{readiness}"
    );

    engine.shutdown();
}

fn wait_for_ready(engine: &mut EngineProcess) {
    engine.wait_for("engine.ready event", |value| {
        value.get("type").and_then(Value::as_str) == Some("event")
            && value.get("event").and_then(Value::as_str) == Some("engine.ready")
    });
}

#[test]
fn engine_boots_dispatches_a_request_and_exits_cleanly() {
    let mut engine = EngineProcess::spawn("ping");

    // 1. Engine must announce ready with the current protocol version.
    let ready = engine.wait_for("engine.ready event", |value| {
        value.get("type").and_then(Value::as_str) == Some("event")
            && value.get("event").and_then(Value::as_str) == Some("engine.ready")
    });
    assert_eq!(
        ready.pointer("/payload/protocol").and_then(Value::as_str),
        Some(PROTOCOL_VERSION),
        "engine.ready payload should declare the current protocol"
    );

    // 2. engine.ping round-trip — the simplest dispatch arm.
    engine.send(&json!({
        "type": "request",
        "id": "ping-1",
        "method": "engine.ping",
        "params": {}
    }));
    let ping_response = engine.wait_for("ping response", |value| {
        value.get("type").and_then(Value::as_str) == Some("response")
            && value.get("id").and_then(Value::as_str) == Some("ping-1")
    });
    assert_eq!(
        ping_response.get("ok").and_then(Value::as_bool),
        Some(true),
        "engine.ping must respond ok=true (got {ping_response})"
    );
    assert_eq!(
        ping_response
            .pointer("/result/protocol")
            .and_then(Value::as_str),
        Some(PROTOCOL_VERSION),
        "engine.ping result should echo the current protocol"
    );

    // 3. app.snapshot — exercises the read dispatcher + storage layer.
    engine.send(&json!({
        "type": "request",
        "id": "snapshot-1",
        "method": "app.snapshot",
        "params": {}
    }));
    let snapshot_response = engine.wait_for("app.snapshot response", |value| {
        value.get("type").and_then(Value::as_str) == Some("response")
            && value.get("id").and_then(Value::as_str) == Some("snapshot-1")
    });
    assert_eq!(
        snapshot_response.get("ok").and_then(Value::as_bool),
        Some(true),
        "app.snapshot must respond ok=true (got {snapshot_response})"
    );
    assert!(
        snapshot_response.get("result").is_some(),
        "app.snapshot must include a result body (got {snapshot_response})"
    );

    // 4. Clean shutdown.
    engine.shutdown();
}

// New pages program, Slice 8: over the pipe, a spawn with the simulated
// cameras (`SSE_CAMERAS_SIMULATED=1`) starts with no camera set up and CAM 1
// selected; pairing CAM 1 answers its setup and raises `cameras.changed {
// reason: "setup", camera: 1 }`; the camera then reads HELD with board 2's
// values, and `checks.cameras` is in `health.snapshot`.
#[test]
fn the_simulated_cameras_answer_over_the_pipe() {
    let mut engine = EngineProcess::spawn("cameras");
    wait_for_ready(&mut engine);

    engine.send(&json!({
        "type": "request", "id": "cameras-1", "method": "cameras.snapshot", "params": {}
    }));
    let snapshot = engine.wait_for("cameras.snapshot", response_with_id("cameras-1"));
    assert_eq!(
        snapshot.pointer("/result/selected"),
        Some(&json!(1)),
        "{snapshot}"
    );
    assert_eq!(
        snapshot.pointer("/result/cameras/0/word"),
        Some(&json!("NOT SET UP")),
        "{snapshot}"
    );

    engine.send(&json!({
        "type": "request", "id": "cameras-2", "method": "cameras.setup.pair", "params": { "camera": 1 }
    }));
    // The response comes first, then the events it raised.
    let paired = engine.wait_for("cameras.setup.pair", response_with_id("cameras-2"));
    assert_eq!(
        paired.pointer("/result/setup/paired"),
        Some(&json!(true)),
        "{paired}"
    );
    // The pictures helper a development engine starts says `pictures` when
    // it likes, so the pairing's own event is picked out by its reason.
    let changed = engine.wait_for("cameras.changed", |value| {
        value.get("event").and_then(Value::as_str) == Some("cameras.changed")
            && value.pointer("/payload/reason") == Some(&json!("setup"))
    });
    assert_eq!(
        changed.get("payload"),
        Some(&json!({ "reason": "setup", "camera": 1 })),
        "{changed}"
    );

    engine.send(&json!({
        "type": "request", "id": "cameras-3", "method": "cameras.snapshot", "params": {}
    }));
    let snapshot = engine.wait_for("cameras.snapshot", response_with_id("cameras-3"));
    assert_eq!(
        snapshot.pointer("/result/cameras/0/word"),
        Some(&json!("HELD"))
    );
    assert_eq!(
        snapshot.pointer("/result/cameras/0/values/iso/value"),
        Some(&json!("400"))
    );

    engine.send(&json!({
        "type": "request", "id": "cameras-4", "method": "health.snapshot", "params": {}
    }));
    let health = engine.wait_for("health.snapshot", response_with_id("cameras-4"));
    assert_eq!(
        health.pointer("/result/checks/cameras/cameras/0/word"),
        Some(&json!("HELD")),
        "{health}"
    );

    engine.shutdown();
}

// 2026-09 production readiness, Slice 5 (F19): a second engine pointed at an
// app-data directory another engine holds reports ENGINE_ALREADY_RUNNING and
// exits without touching the database; once the holder shuts down, the
// directory accepts a new engine again.
#[test]
fn second_engine_on_the_same_app_data_dir_is_refused() {
    let mut first = EngineProcess::spawn("single-instance-first");
    wait_for_ready(&mut first);
    let shared_dir = first.runtime_dir.clone();

    let mut second = EngineProcess::spawn_with("single-instance-second", |command, _| {
        command
            .env("SSE_APP_DATA_DIR", &shared_dir)
            .env("SSE_LOG_DIR", shared_dir.join("logs"));
    });
    let failure = second.wait_for("engine.startupFailed event", |value| {
        value.get("type").and_then(Value::as_str) == Some("event")
            && value.get("event").and_then(Value::as_str) == Some("engine.startupFailed")
    });
    assert_eq!(failure["payload"]["code"], json!("ENGINE_ALREADY_RUNNING"));
    assert_eq!(failure["payload"]["stage"], json!("bootstrap"));
    let message = failure["payload"]["message"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(message.contains("already open"), "{message}");
    let status = second.child.wait().expect("the refused engine exits");
    assert!(
        !status.success(),
        "a refused engine exits with an error status (got {status:?})"
    );
    let _ = fs::remove_dir_all(&second.runtime_dir);

    first.shutdown();

    let mut third = EngineProcess::spawn_with("single-instance-third", |command, _| {
        command
            .env("SSE_APP_DATA_DIR", &shared_dir)
            .env("SSE_LOG_DIR", shared_dir.join("logs"));
    });
    wait_for_ready(&mut third);
    let _ = fs::remove_dir_all(&third.runtime_dir);
    third.shutdown();
    let _ = fs::remove_dir_all(&shared_dir);
}

// Streamlining, 2026-09-28: a development build (every build but the one
// `npm run release` makes) is refused the studio's folders: the platform's
// default app-data folder and everything in it. Started with no
// SSE_APP_DATA_DIR, with the folder named, or with only its logs sent there,
// it reports BOOTSTRAP_FAILED and ends, and creates nothing. The platform's
// base is a scratch folder here, so the default is never this machine's own.
#[test]
fn a_development_build_is_refused_the_studios_folders() {
    if !development_build() {
        // A studio build opens the default folder: nothing to refuse.
        return;
    }
    let host = unique_runtime_dir("refused-studio-folders");
    let base = host.join("base");
    fs::create_dir_all(&base).expect("the platform's base");
    let studio = base.join("ExEd Studio Control Native");
    let scratch = host.join("scratch");
    let refused = |label: &str, data_dir: Option<&PathBuf>, logs_dir: Option<PathBuf>| {
        let mut command = Command::new(engine_binary_path());
        command
            .env_remove("SSE_APP_DATA_DIR")
            .env_remove("SSE_LOG_DIR")
            .env("APPDATA", &base)
            .env("LOCALAPPDATA", &base)
            .env("XDG_DATA_HOME", &base)
            .env("HOME", &base)
            .env("SSE_CONTROL_SURFACE_PORT", "0")
            .env("SSE_SAFE_START", "1")
            .env("SSE_LIGHTS_SIMULATED", "1")
            .env("SSE_AUDIO_SIMULATED_INPUT_MODE", "1")
            .env("SSE_CAMERAS_SIMULATED", "1")
            .stdin(Stdio::null());
        if let Some(data_dir) = data_dir {
            command.env("SSE_APP_DATA_DIR", data_dir);
        }
        if let Some(logs_dir) = logs_dir {
            command.env("SSE_LOG_DIR", logs_dir);
        }
        let output = command.output().expect("engine binary should run");
        assert!(
            !output.status.success(),
            "{label}: a refused engine exits with an error status (got {:?})",
            output.status
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        let failure: Value = stdout
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
            .find(|value| {
                value.get("event").and_then(Value::as_str) == Some("engine.startupFailed")
            })
            .unwrap_or_else(|| panic!("{label}: no engine.startupFailed event in {stdout:?}"));
        assert_eq!(failure["payload"]["code"], json!("BOOTSTRAP_FAILED"));
        let message = failure["payload"]["message"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(message.contains("development build"), "{label}: {message}");
        assert!(message.contains("npm run app"), "{label}: {message}");
        let left_behind: Vec<_> = fs::read_dir(&host)
            .expect("the scratch host reads")
            .chain(fs::read_dir(&base).expect("the base reads"))
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path != &base)
            .collect();
        assert!(
            left_behind.is_empty(),
            "{label}: the refused start created {left_behind:?}"
        );
    };

    refused("no folder named", None, None);
    refused("the default folder named", Some(&studio), None);
    refused(
        "a folder inside the default folder",
        Some(&studio.join("development")),
        None,
    );
    refused(
        "only the logs in the default folder",
        Some(&scratch),
        Some(studio.join("logs")),
    );

    let _ = fs::remove_dir_all(&host);
}

// Streamlining, 2026-09-28: a development build started with no switch set
// takes the safe value of each by itself and says so in its log. The bridge
// port is given here (0: the system picks), so the test binds no fixed port;
// `development.rs` tests the port's default.
#[test]
fn a_development_build_sets_its_own_switches() {
    if !development_build() {
        return;
    }
    let runtime_dir = unique_runtime_dir("development-defaults");
    let mut command = Command::new(engine_binary_path());
    command
        .env("SSE_APP_DATA_DIR", &runtime_dir)
        .env("SSE_LOG_DIR", runtime_dir.join("logs"))
        .env("SSE_CONTROL_SURFACE_PORT", "0")
        .env_remove("SSE_SAFE_START")
        .env_remove("SSE_LIGHTS_SIMULATED")
        .env_remove("SSE_AUDIO_SIMULATED_INPUT_MODE")
        .env_remove("SSE_CAMERAS_SIMULATED")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().expect("engine binary should spawn");
    let stdin = child.stdin.take().expect("stdin pipe");
    let stdout = BufReader::new(child.stdout.take().expect("stdout pipe"));
    let mut engine = EngineProcess {
        child,
        stdin,
        stdout,
        runtime_dir: runtime_dir.clone(),
    };
    wait_for_ready(&mut engine);

    engine.send(&json!({
        "type": "request",
        "id": "development-health",
        "method": "health.snapshot",
        "params": {}
    }));
    let health = engine.wait_for("health.snapshot", response_with_id("development-health"));
    let health_text = health.to_string();
    assert!(
        health_text.contains("Light outputs held"),
        "the lights start held: {health_text}"
    );

    // The lighting output's thread writes its line once it runs, which can be
    // after the engine has said it is ready: the log is read until it is
    // there.
    let log_path = runtime_dir.join("logs").join("engine.log");
    let deadline = Instant::now() + Duration::from_secs(10);
    let log = loop {
        let log = fs::read_to_string(&log_path).expect("the engine log should exist");
        if log.contains("Lights simulated (SSE_LIGHTS_SIMULATED)") || Instant::now() >= deadline {
            break log;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let line = log
        .lines()
        .find(|line| line.contains("Development build: set by itself"))
        .unwrap_or_else(|| panic!("no development line in {log}"));
    for switch in [
        "SSE_SAFE_START=1",
        "SSE_LIGHTS_SIMULATED=1",
        "SSE_AUDIO_SIMULATED_INPUT_MODE=1",
        "SSE_CAMERAS_SIMULATED=1",
    ] {
        assert!(line.contains(switch), "{switch}: {line}");
    }
    assert!(!line.contains("SSE_CONTROL_SURFACE_PORT"), "{line}");
    assert!(log.contains("Safe start (SSE_SAFE_START)"), "{log}");
    assert!(
        log.contains("Lights simulated (SSE_LIGHTS_SIMULATED)"),
        "{log}"
    );

    engine.shutdown();
}
