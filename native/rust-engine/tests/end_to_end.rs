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
        let runtime_dir = unique_runtime_dir(label);
        let mut child = Command::new(engine_binary_path())
            .env("SSE_APP_DATA_DIR", &runtime_dir)
            .env("SSE_LOG_DIR", runtime_dir.join("logs"))
            .env("SSE_DISABLE_AUTO_IMPORT", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("engine binary should spawn");
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
