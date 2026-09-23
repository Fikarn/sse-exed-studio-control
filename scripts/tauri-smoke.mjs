import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredPaths = [
  "native/tauri-shell/Cargo.toml",
  "native/tauri-shell/tauri.conf.json",
  "native/tauri-shell/capabilities/default.json",
  "frontend/app/package.json",
  "frontend/packages/test-fixtures/package.json",
  "native/protocol/v1.contract.json",
  "native/protocol/generated/v1.schema.json",
];

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required Tauri foundation file: ${relativePath}`);
  }
}

const config = JSON.parse(readFileSync(path.join(rootDir, "native", "tauri-shell", "tauri.conf.json"), "utf8"));
const protocolContract = JSON.parse(readFileSync(path.join(rootDir, "native", "protocol", "v1.contract.json"), "utf8"));

if (!config.app?.windows?.length || config.app.windows.length !== 1) {
  throw new Error("Tauri shell must remain single-window during the migration foundation phase.");
}

if (!protocolContract.devParityFixtures.includes("setup-required")) {
  throw new Error("Protocol contract must include the setup-required parity fixture.");
}

verifyContentSecurityPolicy(config);

const engineBinary = resolveEngineBinary();

await verifyReadyHandshake(engineBinary);
await verifyProtocolMismatch(engineBinary);
await verifyBootstrapFailure(engineBinary);

console.log("Tauri foundation smoke checks passed.");

// 2026-09 production readiness, Slice 4 (finding F15): the shell ships a
// Content Security Policy. Tauri injects `app.security.csp` into every HTML
// document it serves from the packaged assets — a response header and a
// <meta> tag on `http://tauri.localhost` — and only there: the dev webview
// loads Vite's document straight from the dev server, so `devCsp` records the
// policy the dev document would need (the HMR websocket, the React refresh
// preamble) without Tauri 2.11 ever applying it. This check keeps both
// present and keeps the packaged policy strict; removing either fails
// `tauri:smoke` and with it the `tauri-foundation` CI job.
function verifyContentSecurityPolicy(shellConfig) {
  const csp = shellConfig.app?.security?.csp;
  if (typeof csp !== "string" || !csp.trim()) {
    throw new Error("Tauri shell must set app.security.csp (2026-09 production readiness, Slice 4 — finding F15).");
  }
  const directives = parseContentSecurityPolicy(csp);
  expectCspSources(directives, "default-src", ["'self'"]);
  expectCspSources(directives, "script-src", ["'self'"]);
  expectCspSources(directives, "connect-src", ["ipc:", "http://ipc.localhost"]);
  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "*", "http:", "https:"]) {
    if (directives.get("script-src").includes(forbidden)) {
      throw new Error(`Tauri shell CSP script-src must not allow ${forbidden}.`);
    }
  }
  for (const [name, sources] of directives) {
    if (sources.includes("*")) {
      throw new Error(`Tauri shell CSP ${name} must not allow every origin.`);
    }
  }

  const devCsp = shellConfig.app?.security?.devCsp;
  if (typeof devCsp !== "string" || !devCsp.trim()) {
    throw new Error("Tauri shell must set app.security.devCsp so the dev document keeps a policy of its own.");
  }
  const devDirectives = parseContentSecurityPolicy(devCsp);
  expectCspSources(devDirectives, "connect-src", ["ipc:", "http://ipc.localhost", "ws://127.0.0.1:4173"]);
}

function parseContentSecurityPolicy(value) {
  const directives = new Map();
  for (const entry of value.split(";")) {
    const [name, ...sources] = entry.trim().split(/\s+/).filter(Boolean);
    if (name) {
      directives.set(name, sources);
    }
  }
  return directives;
}

function expectCspSources(directives, name, required) {
  const sources = directives.get(name);
  if (!sources) {
    throw new Error(`Tauri shell CSP is missing ${name}.`);
  }
  for (const source of required) {
    if (!sources.includes(source)) {
      throw new Error(`Tauri shell CSP ${name} must include ${source}.`);
    }
  }
}

function resolveEngineBinary() {
  const binaryName = process.platform === "win32" ? "studio-control-engine.exe" : "studio-control-engine";
  const candidates = [
    path.join(rootDir, "native", "target", "debug", binaryName),
    path.join(rootDir, "native", "target", "release", binaryName),
  ];

  const binaryPath = candidates.find((candidate) => existsSync(candidate));
  if (!binaryPath) {
    throw new Error("Missing Rust engine binary for Tauri foundation smoke.");
  }

  return binaryPath;
}

function createRuntimeDirs(prefix) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), prefix));
  return {
    appDataDir: path.join(tempRoot, "app-data"),
    cleanup: () => rmSync(tempRoot, { force: true, recursive: true }),
    logsDir: path.join(tempRoot, "app-data", "logs"),
  };
}

function createBlockedRuntimeDirs(prefix) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), prefix));
  const blockedPath = path.join(tempRoot, "blocked-runtime");
  writeFileSync(blockedPath, "blocked");

  return {
    appDataDir: blockedPath,
    cleanup: () => rmSync(tempRoot, { force: true, recursive: true }),
    logsDir: path.join(blockedPath, "logs"),
  };
}

async function verifyReadyHandshake(engineBinaryPath) {
  const runtime = createRuntimeDirs("sse-tauri-ready-");

  try {
    await runScenario({
      appDataDir: runtime.appDataDir,
      engineBinaryPath,
      label: "ready-handshake",
      logsDir: runtime.logsDir,
      onReady(sendRequest) {
        sendRequest("ping-1", "engine.ping");
      },
      onResponse(message, sendRequest, finish) {
        if (message.id === "ping-1") {
          if (message.result?.protocol !== "1") {
            throw new Error(`Expected ping protocol 1, received ${String(message.result?.protocol)}`);
          }
          sendRequest("health-1", "health.snapshot");
          return;
        }

        if (message.id === "health-1") {
          if (typeof message.result?.summary !== "string") {
            throw new Error("health.snapshot did not return a summary string.");
          }
          sendRequest("app-1", "app.snapshot");
          return;
        }

        if (message.id === "app-1") {
          if (typeof message.result?.summary !== "string") {
            throw new Error("app.snapshot did not return a summary string.");
          }
          finish();
        }
      },
      requestedProtocol: "1",
    });
  } finally {
    runtime.cleanup();
  }
}

async function verifyProtocolMismatch(engineBinaryPath) {
  const runtime = createRuntimeDirs("sse-tauri-mismatch-");

  try {
    await runScenario({
      appDataDir: runtime.appDataDir,
      engineBinaryPath,
      expectFailure: {
        code: "PROTOCOL_MISMATCH",
        stage: "protocol-negotiation",
      },
      label: "protocol-mismatch",
      logsDir: runtime.logsDir,
      requestedProtocol: "999",
    });
  } finally {
    runtime.cleanup();
  }
}

async function verifyBootstrapFailure(engineBinaryPath) {
  const runtime = createBlockedRuntimeDirs("sse-tauri-bootstrap-");

  try {
    await runScenario({
      appDataDir: runtime.appDataDir,
      engineBinaryPath,
      expectFailure: {
        code: "BOOTSTRAP_FAILED",
        stage: "bootstrap",
      },
      label: "bootstrap-failure",
      logsDir: runtime.logsDir,
      requestedProtocol: "1",
    });
  } finally {
    runtime.cleanup();
  }
}

function runScenario({
  appDataDir,
  engineBinaryPath,
  expectFailure = null,
  label,
  logsDir,
  onReady,
  onResponse,
  requestedProtocol,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(engineBinaryPath, {
      env: {
        ...process.env,
        SSE_APP_DATA_DIR: appDataDir,
        SSE_LOG_DIR: logsDir,
        SSE_PROTOCOL_VERSION: requestedProtocol,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let finished = false;
    let sawExpectedFailure = false;
    let awaitingCleanExit = false;

    const timeoutId = setTimeout(() => {
      child.kill();
      fail(new Error(`Timed out while running Tauri smoke scenario '${label}'.`));
    }, 10_000);

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    const fail = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(new Error(`${error.message}\nScenario: ${label}\nStderr:\n${stderrBuffer || "(empty)"}`));
    };

    const succeed = () => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve();
    };

    const sendRequest = (id, method, params = {}) => {
      child.stdin.write(`${JSON.stringify({ type: "request", id, method, params })}\n`);
    };

    const finishReadyScenario = () => {
      awaitingCleanExit = true;
      child.stdin.end();
    };

    const handleMessage = (message) => {
      if (message.type === "event" && message.event === "engine.ready") {
        if (expectFailure) {
          fail(new Error(`Expected startup failure '${expectFailure.code}' but engine emitted engine.ready.`));
          return;
        }

        if (message.payload?.protocol !== "1") {
          fail(new Error(`Expected engine.ready protocol 1 but received ${String(message.payload?.protocol)}.`));
          return;
        }

        onReady?.(sendRequest);
        return;
      }

      if (message.type === "event" && message.event === "engine.startupFailed") {
        if (!expectFailure) {
          fail(new Error(`Unexpected startup failure ${String(message.payload?.code)}.`));
          return;
        }

        if (message.payload?.code !== expectFailure.code || message.payload?.stage !== expectFailure.stage) {
          fail(
            new Error(
              `Expected startup failure ${expectFailure.code}/${expectFailure.stage} but received ${String(message.payload?.code)}/${String(message.payload?.stage)}.`
            )
          );
          return;
        }

        sawExpectedFailure = true;
        return;
      }

      if (message.type === "response") {
        if (!message.ok) {
          fail(new Error(`Engine returned request failure for ${String(message.id)}.`));
          return;
        }

        try {
          onResponse?.(message, sendRequest, finishReadyScenario);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;

      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

        if (line) {
          try {
            handleMessage(JSON.parse(line));
          } catch {
            fail(new Error(`Malformed engine output: ${line}`));
            return;
          }
        }

        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk;
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("exit", (code, signal) => {
      if (finished) {
        return;
      }

      if (signal) {
        fail(new Error(`Engine exited via signal ${signal}.`));
        return;
      }

      if (expectFailure) {
        if (!sawExpectedFailure) {
          fail(new Error(`Engine exited before emitting expected startup failure ${expectFailure.code}.`));
          return;
        }

        if (code === 0) {
          fail(new Error("Engine exited successfully when a startup failure was expected."));
          return;
        }

        succeed();
        return;
      }

      if (!awaitingCleanExit) {
        fail(new Error(`Engine exited unexpectedly with code ${String(code)}.`));
        return;
      }

      if (code !== 0) {
        fail(new Error(`Engine exited with non-zero code ${String(code)} after ready handshake.`));
        return;
      }

      succeed();
    });
  });
}
