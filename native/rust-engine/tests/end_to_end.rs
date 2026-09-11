//! plan PR 8 / workstream E1.
//!
//! End-to-end integration test that spawns the studio-control-engine
//! binary, drives a minimal JSONL request lifecycle over stdin/stdout
//! (`engine.ping` → `app.snapshot`), and confirms a clean shutdown when
//! stdin closes. Reuses the patterns from `scripts/native-acceptance.mjs`
//! but in Rust so the engine's public contract is exercised in
//! `cargo test`, not only in the Node harness.
//!
//! Scope is deliberately small: the larger workflow (import → mutate →
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
        Self::spawn_with(label, |command, _runtime_dir| {
            command.env("SSE_DISABLE_AUTO_IMPORT", "1");
        })
    }

    /// Spawns the engine against a fresh runtime dir (`SSE_APP_DATA_DIR` and
    /// `SSE_LOG_DIR` set) and lets the caller stage files in that dir or
    /// adjust the command before the process starts.
    fn spawn_with<F: FnOnce(&mut Command, &PathBuf)>(label: &str, configure: F) -> Self {
        let runtime_dir = unique_runtime_dir(label);
        let mut command = Command::new(engine_binary_path());
        command
            .env("SSE_APP_DATA_DIR", &runtime_dir)
            .env("SSE_LOG_DIR", runtime_dir.join("logs"))
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

fn legacy_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join("commissioning-sample-db.json")
}

fn wait_for_ready(engine: &mut EngineProcess) {
    engine.wait_for("engine.ready event", |value| {
        value.get("type").and_then(Value::as_str) == Some("event")
            && value.get("event").and_then(Value::as_str) == Some("engine.ready")
    });
}

fn planning_project_count(engine: &mut EngineProcess, id: &'static str) -> u64 {
    engine.send(&json!({
        "type": "request",
        "id": id,
        "method": "commissioning.snapshot",
        "params": {}
    }));
    let snapshot = engine.wait_for("commissioning snapshot", response_with_id(id));
    snapshot
        .pointer("/result/planningProjectCount")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| {
            panic!("commissioning.snapshot must report planningProjectCount ({snapshot})")
        })
}

// 2026-09 production readiness, Slice 1 (finding F23): the engine used to
// auto-import `<cwd>/data/db.json` whenever its planning tables were empty,
// so whatever directory a packaged engine happened to be launched from
// could seed the operator's database. The only sources now are
// `SSE_LEGACY_DB_PATH` and `<app-data>/import/db.json`.
#[test]
fn auto_import_ignores_cwd() {
    let working_dir = unique_runtime_dir("auto-import-cwd");
    fs::create_dir_all(working_dir.join("data")).expect("cwd data dir");
    fs::copy(
        legacy_fixture_path(),
        working_dir.join("data").join("db.json"),
    )
    .expect("legacy fixture should copy under the working directory");

    let mut engine = EngineProcess::spawn_with("auto-import-ignores-cwd", |command, _| {
        command
            .current_dir(&working_dir)
            .env_remove("SSE_DISABLE_AUTO_IMPORT")
            .env_remove("SSE_LEGACY_DB_PATH");
    });
    wait_for_ready(&mut engine);

    assert_eq!(
        planning_project_count(&mut engine, "cwd-snapshot"),
        0,
        "a db.json under the engine's working directory must not be imported"
    );

    engine.shutdown();
    let _ = fs::remove_dir_all(&working_dir);
}

#[test]
fn auto_import_reads_the_staged_app_data_file() {
    let mut engine = EngineProcess::spawn_with("auto-import-staged", |command, runtime_dir| {
        let import_dir = runtime_dir.join("import");
        fs::create_dir_all(&import_dir).expect("app-data import dir");
        fs::copy(legacy_fixture_path(), import_dir.join("db.json"))
            .expect("legacy fixture should copy into app-data/import");
        command
            .env_remove("SSE_DISABLE_AUTO_IMPORT")
            .env_remove("SSE_LEGACY_DB_PATH");
    });
    wait_for_ready(&mut engine);

    assert_eq!(
        planning_project_count(&mut engine, "staged-snapshot"),
        2,
        "the staged <app-data>/import/db.json (commissioning-sample-db.json, two projects) must be imported"
    );

    engine.shutdown();
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
        Some("1"),
        "engine.ready payload should declare protocol 1"
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
        Some("1"),
        "engine.ping result should echo protocol 1"
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
            .env("SSE_DISABLE_AUTO_IMPORT", "1")
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
            .env("SSE_DISABLE_AUTO_IMPORT", "1")
            .env("SSE_APP_DATA_DIR", &shared_dir)
            .env("SSE_LOG_DIR", shared_dir.join("logs"));
    });
    wait_for_ready(&mut third);
    let _ = fs::remove_dir_all(&third.runtime_dir);
    third.shutdown();
    let _ = fs::remove_dir_all(&shared_dir);
}
