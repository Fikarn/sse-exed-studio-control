import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

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
      env: {
        ...process.env,
        SSE_PROTOCOL_VERSION: "1",
        SSE_APP_DATA_DIR: this.appDataDir,
        SSE_LOG_DIR: this.logsDir,
        ...this.env,
      },
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
