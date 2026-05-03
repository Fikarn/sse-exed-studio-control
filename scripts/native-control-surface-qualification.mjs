import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, EngineHarness, resolvePathFromRoot } from "./native-runtime-harness.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(rootDir, "native", "rust-engine", "fixtures", "commissioning-sample-db.json");
const controlSurfaceHost = "127.0.0.1";

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function parseTarget(value) {
  if (value === "macos" || value === "windows") {
    return value;
  }

  throw new Error(
    `Unsupported control-surface qualification target '${value}'. Use --target=macos or --target=windows.`
  );
}

function resolvePackagedRuntime(target) {
  if (target === "macos") {
    return {
      label: "macOS",
      enginePath: path.join(
        rootDir,
        "release",
        "native",
        "macos",
        "SSE ExEd Studio Control Native.app",
        "Contents",
        "MacOS",
        "studio-control-engine"
      ),
    };
  }

  return {
    label: "Windows",
    enginePath: path.join(
      rootDir,
      "release",
      "native",
      "windows",
      "SSE ExEd Studio Control Native",
      "studio-control-engine.exe"
    ),
  };
}

async function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, controlSurfaceHost, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to resolve a dedicated control-surface qualification port."));
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
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const method = options.method ?? "GET";

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    assert(
      response.ok,
      `Packaged control-surface bridge qualification failed: ${method} ${url} returned ${response.status} ${response.statusText}: ${text}`
    );

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Packaged control-surface bridge qualification failed: ${method} ${url} did not return JSON: ${error.message}`,
        { cause: error }
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function writeSummary(qualificationRoot, summary) {
  mkdirSync(qualificationRoot, { recursive: true });
  writeFileSync(path.join(qualificationRoot, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
}

async function main() {
  const target = parseTarget(readFlag("--target"));
  const expectedPlatform = target === "macos" ? "darwin" : "win32";
  if (process.platform !== expectedPlatform) {
    throw new Error(
      `native-control-surface-qualification.mjs target '${target}' must run on a matching host platform.`
    );
  }

  assert(existsSync(fixturePath), `Fixture missing: ${fixturePath}`);

  const packaged = resolvePackagedRuntime(target);
  assert(
    existsSync(packaged.enginePath),
    `Packaged native ${packaged.label} engine not found at ${packaged.enginePath}. Run the matching package smoke command first.`
  );

  const explicitRoot = resolvePathFromRoot(rootDir, process.env.SSE_NATIVE_BRIDGE_ACCEPTANCE_DIR);
  const qualificationRoot = explicitRoot ?? mkdtempSync(path.join(os.tmpdir(), "sse-native-bridge-acceptance-"));
  rmSync(qualificationRoot, { force: true, recursive: true });
  mkdirSync(qualificationRoot, { recursive: true });

  const runtime = {
    appDataDir: path.join(qualificationRoot, "runtime", "app-data"),
    logsDir: path.join(qualificationRoot, "runtime", "logs"),
  };
  mkdirSync(runtime.appDataDir, { recursive: true });
  mkdirSync(runtime.logsDir, { recursive: true });

  const summary = {
    target,
    label: packaged.label,
    fixturePath,
    qualificationRoot,
    enginePath: packaged.enginePath,
    appDataDir: runtime.appDataDir,
    logsDir: runtime.logsDir,
    startedAt: new Date().toISOString(),
    steps: [],
    success: false,
  };

  let harness = null;
  let failure = null;

  try {
    const reservedPort = await reserveLocalPort();
    const expectedBaseUrl = `http://${controlSurfaceHost}:${reservedPort}`;
    summary.requestedPort = reservedPort;
    summary.expectedBaseUrl = expectedBaseUrl;

    console.log(`Packaged control-surface bridge qualification root: ${qualificationRoot}`);
    console.log(
      "Step 1: start the packaged engine with imported workstation data on a dedicated localhost bridge port."
    );

    harness = new EngineHarness({
      rootDir,
      appDataDir: runtime.appDataDir,
      logsDir: runtime.logsDir,
      engineExecutable: packaged.enginePath,
      env: {
        SSE_LEGACY_DB_PATH: fixturePath,
        SSE_CONTROL_SURFACE_PORT: String(reservedPort),
      },
    });

    await harness.start();
    summary.steps.push({
      name: "packaged-engine-start",
      status: "passed",
      message: "Packaged engine started with imported workstation data.",
    });

    summary.sqliteVersion = await assertSafeBundledSqlite(
      harness,
      "native-bridge-qualification",
      `Packaged native ${packaged.label} engine`
    );

    const healthSnapshot = await harness.request("bridge-qualification-health", "health.snapshot");
    const appSnapshot = await harness.request("bridge-qualification-app", "app.snapshot");
    const controlSurfaceSnapshot = await harness.request(
      "bridge-qualification-control-surface",
      "controlSurface.snapshot"
    );

    summary.healthControlSurface = healthSnapshot?.checks?.controlSurface ?? null;
    summary.appControlSurface = appSnapshot?.runtime?.controlSurface ?? null;
    summary.controlSurfacePages = (controlSurfaceSnapshot?.pages ?? []).map((page) => page.label);

    assert(
      healthSnapshot?.checks?.controlSurface?.ok === true,
      `Packaged control-surface bridge qualification failed: health.snapshot reports the bridge as unavailable (${healthSnapshot?.checks?.controlSurface?.error ?? "no error detail"}).`
    );
    assert(
      healthSnapshot?.checks?.controlSurface?.baseUrl === expectedBaseUrl,
      `Packaged control-surface bridge qualification failed: health.snapshot reported baseUrl '${healthSnapshot?.checks?.controlSurface?.baseUrl}' instead of '${expectedBaseUrl}'.`
    );
    assert(
      appSnapshot?.runtime?.controlSurface?.available === true,
      `Packaged control-surface bridge qualification failed: app.snapshot reports the bridge as unavailable (${appSnapshot?.runtime?.controlSurface?.error ?? "no error detail"}).`
    );
    assert(
      appSnapshot?.runtime?.controlSurface?.baseUrl === expectedBaseUrl,
      `Packaged control-surface bridge qualification failed: app.snapshot reported baseUrl '${appSnapshot?.runtime?.controlSurface?.baseUrl}' instead of '${expectedBaseUrl}'.`
    );
    assert(
      Array.isArray(controlSurfaceSnapshot?.pages) && controlSurfaceSnapshot.pages.length === 4,
      "Packaged control-surface bridge qualification failed: controlSurface.snapshot must expose the four legacy deck pages."
    );
    assert(
      ["PROJECTS", "TASKS", "LIGHTS", "AUDIO"].every((label) =>
        controlSurfaceSnapshot.pages.some((page) => page.label === label)
      ),
      "Packaged control-surface bridge qualification failed: controlSurface.snapshot is missing one or more expected page labels."
    );

    summary.steps.push({
      name: "bridge-snapshot-contract",
      status: "passed",
      message: "Packaged engine exposed a live bridge and the expected control-surface page model.",
    });

    console.log("Step 2: verify live HTTP bind, LCD, and action endpoints against the packaged bridge.");

    const contextBefore = await fetchJson(`${expectedBaseUrl}/api/deck/context`);
    const lcdProjectNav = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=project_nav`);
    const lcdAudioBefore = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=audio_ch_nav`);

    assert(
      typeof contextBefore.projectCount === "number" &&
        typeof contextBefore.viewFilter === "string" &&
        typeof contextBefore.sortBy === "string",
      "Packaged control-surface bridge qualification failed: GET /api/deck/context returned an invalid planning context payload."
    );
    assert(
      typeof lcdProjectNav === "string" && lcdProjectNav.includes("PROJECT"),
      "Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=project_nav did not return the expected LCD text."
    );
    assert(
      typeof lcdAudioBefore === "string" && lcdAudioBefore.includes("dB"),
      "Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=audio_ch_nav did not return the expected audio LCD text."
    );

    const filterResponse = await postJson(`${expectedBaseUrl}/api/deck/action`, {
      action: "setFilter",
      value: "todo",
    });
    assert(
      filterResponse?.viewFilter === "todo",
      "Packaged control-surface bridge qualification failed: POST /api/deck/action did not persist the todo filter."
    );

    const contextAfterFilter = await fetchJson(`${expectedBaseUrl}/api/deck/context`);
    const planningAfterFilter = await harness.request("bridge-qualification-planning-filter", "planning.snapshot");
    assert(
      contextAfterFilter.viewFilter === "todo" && planningAfterFilter?.settings?.viewFilter === "todo",
      "Packaged control-surface bridge qualification failed: planning filter changes did not round-trip through the bridge and engine snapshot."
    );

    const lightResponse = await postJson(`${expectedBaseUrl}/api/deck/light-action`, {
      action: "switchToDeckMode",
      value: "light",
    });
    assert(
      lightResponse?.deckMode === "light",
      "Packaged control-surface bridge qualification failed: POST /api/deck/light-action did not switch the deck mode to light."
    );

    const planningAfterDeckMode = await harness.request("bridge-qualification-planning-deck-mode", "planning.snapshot");
    assert(
      planningAfterDeckMode?.settings?.deckMode === "light",
      "Packaged control-surface bridge qualification failed: lighting deck-mode changes did not persist into planning.snapshot."
    );

    const audioResponse = await postJson(`${expectedBaseUrl}/api/deck/audio-action`, {
      action: "toggleMute",
      value: "1",
    });
    assert(
      typeof audioResponse?.mute === "boolean",
      "Packaged control-surface bridge qualification failed: POST /api/deck/audio-action did not return the channel mute state."
    );

    const lcdAudioAfter = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=audio_ch_nav`);
    assert(
      typeof lcdAudioAfter === "string" &&
        lcdAudioAfter.includes("dB") &&
        lcdAudioAfter.includes(audioResponse.mute ? " M" : "dB"),
      "Packaged control-surface bridge qualification failed: audio LCD state did not reflect the mute action."
    );
    assert(
      lcdAudioAfter !== lcdAudioBefore,
      "Packaged control-surface bridge qualification failed: audio LCD state did not change after the mute action."
    );

    summary.httpChecks = {
      contextBefore,
      lcdProjectNav,
      lcdAudioBefore,
      filterResponse,
      contextAfterFilter,
      planningAfterFilter: {
        viewFilter: planningAfterFilter?.settings?.viewFilter ?? null,
      },
      lightResponse,
      planningAfterDeckMode: {
        deckMode: planningAfterDeckMode?.settings?.deckMode ?? null,
      },
      audioResponse,
      lcdAudioAfter,
    };
    summary.steps.push({
      name: "bridge-http-routes",
      status: "passed",
      message: "Packaged bridge accepted live HTTP requests and round-tripped planning, lighting, and audio actions.",
    });

    summary.success = true;
    summary.completedAt = new Date().toISOString();
  } catch (error) {
    failure = error;
    summary.success = false;
    summary.error = {
      message: error.message,
      stack: error.stack ?? null,
    };
    summary.completedAt = new Date().toISOString();
  }

  if (harness) {
    try {
      await harness.close();
    } catch (error) {
      if (!failure) {
        failure = error;
        summary.success = false;
        summary.error = {
          message: error.message,
          stack: error.stack ?? null,
        };
        summary.completedAt = new Date().toISOString();
      } else {
        summary.closeError = error.message;
      }
    }
  }

  writeSummary(qualificationRoot, summary);

  if (failure) {
    throw failure;
  }

  console.log(
    `Packaged control-surface bridge qualification passed: ${packaged.label} bridge bound at ${summary.expectedBaseUrl} and served live deck HTTP routes.`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
