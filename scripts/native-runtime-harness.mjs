import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

// New pages program, Slice 2b (2026-09-25): the program's hardware-safety
// rule, held here for every lane instead of by each lane remembering it.
// Every engine and every shell a lane starts gets a scratch app-data and log
// folder of its own (never the platform's default app data, which on the
// studio workstation is the live data), a bridge port of its own (never the
// live app's), holds the light outputs from its first instant
// (`SSE_SAFE_START`) and runs the simulated console, so no lane can open the
// operator's saved data, take the studio's Stream Deck port, stream to a
// lighting bridge or write to a real TotalMix. The one exception is the
// workstation-only live console lane (`SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1`,
// whose engines native-parity-acceptance.mjs `acceptanceEngineEnv` builds),
// which keeps the real console and nothing else; no lane can ask for it
// (`laneProcessEnv` refuses a `liveConsole` option). Until then only the
// bridge lane chose its port, only the acceptance engines simulated the
// console, no lane held the light outputs and nothing checked the app data.

/** The port the live app's Stream Deck bridge holds on the studio workstation. */
export const LIVE_APP_CONTROL_SURFACE_PORT = 38201;

/** The workstation-only live console lane's opt-in. */
export const LIVE_CONSOLE = process.env.SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE === "1";

/** The app's folder in the platform's app-data folder (bootstrap.rs `DEFAULT_APP_DATA_DIR_NAME`). */
export const DEFAULT_APP_DATA_DIR_NAME = "ExEd Studio Control Native";

// A variable as the engine reads it: an empty value counts as unset
// (bootstrap.rs `env_path`), and Windows names are case-insensitive.
function envValue(env, name, platform) {
  const key = platform === "win32" ? Object.keys(env).find((candidate) => candidate.toUpperCase() === name) : name;
  const value = key === undefined ? undefined : env[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Every folder the hardware link or the shell could open as its app data when
 * `SSE_APP_DATA_DIR` is not set, read as bootstrap.rs
 * `default_app_data_dir_for_platform` reads it — `%APPDATA%`, else
 * `%LOCALAPPDATA%`, on Windows; `~/Library/Application Support` on macOS;
 * `$XDG_DATA_HOME`, else `~/.local/share`, elsewhere — each candidate, not only
 * the one that wins, joined with the app's folder name. On the studio
 * workstation the first is the operator's live data (2026-09-25).
 */
export function defaultAppDataDirs(env, platform = process.platform) {
  const flavour = platform === "win32" ? path.win32 : path.posix;
  const value = (name) => {
    const found = envValue(env, name, platform);
    return found === null ? [] : [found];
  };
  let bases;
  if (platform === "win32") {
    bases = [...value("APPDATA"), ...value("LOCALAPPDATA")];
  } else if (platform === "darwin") {
    bases = value("HOME").map((home) => flavour.join(home, "Library", "Application Support"));
  } else {
    bases = [...value("XDG_DATA_HOME"), ...value("HOME").map((home) => flavour.join(home, ".local", "share"))];
  }
  return bases.map((base) => flavour.join(base, DEFAULT_APP_DATA_DIR_NAME));
}

// A path as the file system knows it: the nearest folder that exists is
// resolved (a junction, a symbolic link or a short 8.3 name spell the same
// folder differently) and the rest is appended as written; compared without
// case where the file system ignores it.
function canonicalPath(target) {
  const rest = [];
  let existing = path.resolve(target);
  for (;;) {
    let resolved = null;
    try {
      resolved = path.join(realpathSync.native(existing), ...rest);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) {
        resolved = path.resolve(target);
      } else {
        rest.unshift(path.basename(existing));
        existing = parent;
      }
    }
    if (resolved !== null) {
      return process.platform === "linux" ? resolved : resolved.toLowerCase();
    }
  }
}

/** Whether `candidate` is `directory` or lies inside it, as the file system resolves both. */
export function isSameOrInside(candidate, directory) {
  const relative = path.relative(canonicalPath(directory), canonicalPath(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Why a lane process's app-data or log folder is not a scratch folder of its
// own, or null. A relative one the app resolves against its working
// directory, the repository.
function scratchFolderRefusal(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || !path.isAbsolute(value)) {
    const fallback =
      name === "SSE_LOG_DIR"
        ? "without one the app writes its log inside its app-data folder"
        : `without one the app opens the real app data ('${DEFAULT_APP_DATA_DIR_NAME}' in the platform's app-data folder)`;
    return `${name} must name an absolute scratch folder of the lane's own (got '${value ?? ""}'); ${fallback}.`;
  }
  // The child's own variables and this process's: a lane that moves APPDATA
  // or HOME still may not point into the real one.
  const real = [...defaultAppDataDirs(env), ...defaultAppDataDirs(process.env)].find((folder) =>
    isSameOrInside(value, folder)
  );
  return real ? `${name} is ${value}, inside the real app data ${real}.` : null;
}

/**
 * A free localhost port for a lane's bridge: the system hands one out and it
 * is released again for the engine to bind. Never the live app's port.
 */
export async function reserveLocalPort(host = "127.0.0.1") {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, host, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => {
            reject(new Error("Failed to resolve a dedicated control-surface port for the lane."));
          });
          return;
        }

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(address.port);
        });
      });
    });
    if (port !== LIVE_APP_CONTROL_SURFACE_PORT) {
      return port;
    }
  }
}

/**
 * The variables that harden a process a lane starts: a reserved bridge port,
 * a safe start and, unless `simulatedAudio` is false (the live console lane
 * only), the simulated console.
 */
export async function hardenedLaneEnv({ simulatedAudio = true } = {}) {
  return {
    SSE_CONTROL_SURFACE_PORT: String(await reserveLocalPort()),
    SSE_SAFE_START: "1",
    ...(simulatedAudio ? { SSE_AUDIO_SIMULATED_INPUT_MODE: "1" } : {}),
  };
}

// The engine's own readings of the three variables (control_surface.rs
// `resolve_control_surface_port`, bootstrap.rs `safe_start_requested`,
// audio/helpers.rs `resolve_audio_config`): a port the engine cannot parse
// falls back to the live app's.
function bridgePortOf(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) {
    return null;
  }
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

function safeStartRequested(value) {
  return !["", "0", "false", "off", "no"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase()
  );
}

function simulatedConsoleRequested(value) {
  return ["1", "true", "TRUE", "yes", "YES"].includes(value);
}

/**
 * Why a lane process's environment is not hardened, or null when it is.
 * `safeStart: false` is for the one launch that proves a hold outlives the
 * launch that made it (tauri-setup-support-qualification.mjs, step 8).
 * `liveConsole` defaults to the live console lane's opt-in; only this
 * module's own tests pass it (`laneProcessEnv` refuses it).
 */
export function laneEnvRefusal(env, { safeStart = true, liveConsole = LIVE_CONSOLE } = {}) {
  for (const name of ["SSE_APP_DATA_DIR", "SSE_LOG_DIR"]) {
    const refusal = scratchFolderRefusal(env, name);
    if (refusal) {
      return refusal;
    }
  }
  const port = bridgePortOf(env.SSE_CONTROL_SURFACE_PORT);
  if (port === null) {
    return `SSE_CONTROL_SURFACE_PORT must name a port of the lane's own (got '${env.SSE_CONTROL_SURFACE_PORT ?? ""}'); without one the bridge takes the live app's ${LIVE_APP_CONTROL_SURFACE_PORT}.`;
  }
  if (port === LIVE_APP_CONTROL_SURFACE_PORT) {
    return `SSE_CONTROL_SURFACE_PORT is ${LIVE_APP_CONTROL_SURFACE_PORT}, the live app's bridge port.`;
  }
  if (safeStart && !safeStartRequested(env.SSE_SAFE_START)) {
    return `SSE_SAFE_START must hold the light outputs (got '${env.SSE_SAFE_START ?? ""}').`;
  }
  if (!liveConsole && !simulatedConsoleRequested(env.SSE_AUDIO_SIMULATED_INPUT_MODE)) {
    return `SSE_AUDIO_SIMULATED_INPUT_MODE must be 1 outside the live console lane (got '${env.SSE_AUDIO_SIMULATED_INPUT_MODE ?? ""}').`;
  }
  return null;
}

export function assertHardenedLaneEnv(env, label, options = {}) {
  const refusal = laneEnvRefusal(env, options);
  if (refusal) {
    throw new Error(`${label} was not started: ${refusal}`);
  }
}

/**
 * The environment of a process a lane starts — this process's, then `base`,
 * then `overrides`, a later layer winning — held to the hardening before
 * anything is spawned. A lane passes its hardening as `base` and the
 * scenario's own variables and scratch folders as `overrides`; the harness
 * passes the folders first and the lane's environment last, as it always did.
 * No lane may choose the real console: `liveConsole` is refused, so only the
 * live console lane's opt-in leaves the simulated console (2026-09-25).
 */
export function laneProcessEnv(base, overrides = {}, { label = "A lane process", ...options } = {}) {
  if (Object.hasOwn(options, "liveConsole")) {
    throw new Error(
      `${label} was not started: a lane cannot choose the real console; only the live console lane's opt-in (SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1, read by acceptanceEngineEnv) leaves the simulated console.`
    );
  }
  const env = { ...process.env, ...base, ...overrides };
  assertHardenedLaneEnv(env, label, options);
  return env;
}

// The protocol version the engine is asked for is the contract's own.
export function contractProtocolVersion(rootDir) {
  const contract = JSON.parse(readFileSync(path.join(rootDir, "native", "protocol", "v1.contract.json"), "utf8"));
  return contract.version;
}

export function resolvePathFromRoot(rootDir, value) {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

export function resolveDebugEngineExecutable(rootDir) {
  return process.platform === "win32"
    ? path.join(rootDir, "native", "target", "debug", "studio-control-engine.exe")
    : path.join(rootDir, "native", "target", "debug", "studio-control-engine");
}

export function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export class EngineHarness {
  constructor({ rootDir, appDataDir, logsDir, env = {}, engineExecutable = null }) {
    this.rootDir = rootDir;
    this.appDataDir = appDataDir;
    this.logsDir = logsDir;
    this.env = env;
    this.engineExecutable = engineExecutable;
    this.child = null;
    this.responseWaiters = new Map();
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.readyResolve = null;
    this.readyReject = null;
    this.exitResolve = null;
    this.exitReject = null;
    this.readySettled = false;
    this.closed = false;
    this.lastReadyPayload = null;
  }

  async start() {
    // Refused before anything is looked for or made (new pages program,
    // Slice 2b): an engine a lane starts is always hardened.
    const env = laneProcessEnv(
      {
        SSE_PROTOCOL_VERSION: contractProtocolVersion(this.rootDir),
        SSE_APP_DATA_DIR: this.appDataDir,
        SSE_LOG_DIR: this.logsDir,
      },
      this.env,
      { label: "The lane's engine" }
    );
    const engineExecutable = this.engineExecutable ?? resolveDebugEngineExecutable(this.rootDir);
    if (!existsSync(engineExecutable)) {
      throw new Error(
        `Native engine executable not found at ${engineExecutable}. Run \`npm run native:engine:build\` first.`
      );
    }

    mkdirSync(this.appDataDir, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });

    console.log(`Starting native engine: ${engineExecutable}`);

    this.child = spawn(engineExecutable, [], {
      cwd: this.rootDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => this.handleStderr(chunk));
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code, signal) => this.handleExit(code, signal));

    const readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    await Promise.race([
      readyPromise,
      wait(8000).then(() => {
        throw new Error("Timed out waiting for engine.ready.");
      }),
    ]);
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      console.log(`[engine stdout] ${line}`);

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.failAll(new Error(`Failed to parse engine stdout JSON: ${error.message}`));
        continue;
      }

      if (message.type === "event") {
        this.handleEvent(message);
        continue;
      }

      if (message.type === "response") {
        const waiter = this.responseWaiters.get(String(message.id));
        if (waiter) {
          this.responseWaiters.delete(String(message.id));
          waiter.resolve(message);
        }
      }
    }
  }

  handleStderr(chunk) {
    this.stderrBuffer += chunk;
    const lines = chunk.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      console.log(`[engine stderr] ${line}`);
    }
  }

  handleEvent(message) {
    if (message.event === "engine.ready") {
      this.lastReadyPayload = message.payload ?? null;
      if (!this.readySettled && this.readyResolve) {
        this.readySettled = true;
        this.readyResolve(message.payload ?? {});
      }
      return;
    }

    if (message.event === "engine.startupFailed") {
      const details = message.payload?.message ?? "Engine startup failed.";
      const error = new Error(details);
      error.code = message.payload?.code;
      if (!this.readySettled && this.readyReject) {
        this.readySettled = true;
        this.readyReject(error);
      }
      this.failAll(error);
    }
  }

  handleExit(code, signal) {
    const exitCode = code ?? 1;
    const exitDescription = signal ? `signal ${signal}` : `code ${exitCode}`;
    if (!this.closed && exitCode !== 0) {
      this.failAll(new Error(`Engine exited unexpectedly with ${exitDescription}.`));
      return;
    }

    if (this.exitResolve) {
      this.exitResolve({ code: exitCode, signal });
      this.exitResolve = null;
      this.exitReject = null;
    }
  }

  failAll(error) {
    if (!this.readySettled && this.readyReject) {
      this.readySettled = true;
      this.readyReject(error);
    }

    for (const waiter of this.responseWaiters.values()) {
      waiter.reject(error);
    }
    this.responseWaiters.clear();

    if (this.exitReject) {
      this.exitReject(error);
      this.exitResolve = null;
      this.exitReject = null;
    }
  }

  async request(id, method, params = {}) {
    if (!this.child || !this.child.stdin || this.child.exitCode !== null) {
      throw new Error(`Cannot send request ${method}; engine is not running.`);
    }

    const envelope = JSON.stringify({ id, method, params });
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseWaiters.delete(String(id));
        reject(new Error(`Timed out waiting for response to ${method}.`));
      }, 8000);

      this.responseWaiters.set(String(id), {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });

    this.child.stdin.write(`${envelope}\n`);
    const response = await responsePromise;
    if (!response.ok) {
      const code = response.error?.code ?? "UNKNOWN_ERROR";
      const message = response.error?.message ?? `Request ${method} failed.`;
      throw new Error(`${method} failed with ${code}: ${message}`);
    }

    return response.result ?? {};
  }

  async close() {
    if (!this.child || this.closed) {
      return;
    }

    this.closed = true;
    const exitPromise = new Promise((resolve, reject) => {
      this.exitResolve = resolve;
      this.exitReject = reject;
    });

    this.child.stdin.end();

    const result = await Promise.race([
      exitPromise,
      wait(3000).then(async () => {
        this.child.kill("SIGKILL");
        await wait(200);
        throw new Error("Engine did not exit cleanly after stdin closed.");
      }),
    ]);

    assert(result.code === 0, `Engine closed with exit code ${result.code}.`);
  }
}
