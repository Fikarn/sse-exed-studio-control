import { connect, createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, EngineHarness, resolvePathFromRoot } from "./native-runtime-harness.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(rootDir, "native", "rust-engine", "fixtures", "commissioning-sample-db.json");
const controlSurfaceHost = "127.0.0.1";
// The bridge answers only requests that carry the per-install token the engine
// writes into <app-data>/control-surface.token (2026-09 production readiness,
// Slice 2 — F01). The positive checks send it; the negatives below prove the
// refusals.
const bridgeTokenFileName = "control-surface.token";
const bridgeTokenPattern = /^[0-9a-f]{64}$/;
let bridgeAuthorization = null;

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
      headers: {
        ...(bridgeAuthorization ? { Authorization: bridgeAuthorization } : {}),
        ...(options.headers ?? {}),
      },
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

async function postJsonExpectingStatus(url, body, expectedStatus) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...(bridgeAuthorization ? { Authorization: bridgeAuthorization } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    assert(
      response.status === expectedStatus,
      `Packaged control-surface bridge qualification failed: POST ${url} returned ${response.status} but the qualification expected ${expectedStatus}: ${text}`
    );
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timeout);
  }
}

// A request with explicit credentials (`authorization: null` sends none) that
// reports the status instead of asserting success.
async function fetchStatus(url, { method = "GET", headers = {}, body, authorization = bridgeAuthorization } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, headers: response.headers, body: parsed, text };
  } finally {
    clearTimeout(timeout);
  }
}

// Sends raw bytes for the cases a well-behaved HTTP client cannot produce (a
// foreign Host, a browser Origin, a body that never finishes) and returns what
// the bridge answered before it closed the connection, with the time to the
// first response byte.
function rawHttp(port, request, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let firstByteAt = null;
    const chunks = [];
    const socket = connect({ host: controlSurfaceHost, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          `Packaged control-surface bridge qualification failed: no response within ${timeoutMs} ms to a raw request.`
        )
      );
    }, timeoutMs);
    socket.on("connect", () => {
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      if (firstByteAt === null) {
        firstByteAt = Date.now();
      }
      chunks.push(chunk);
    });
    socket.on("error", (error) => {
      if (chunks.length === 0) {
        clearTimeout(timer);
        reject(error);
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8");
      const status = Number.parseInt(text.split(" ")[1] ?? "0", 10);
      const separator = text.indexOf("\r\n\r\n");
      resolve({
        status,
        text,
        head: separator === -1 ? text : text.slice(0, separator),
        body: separator === -1 ? "" : text.slice(separator + 4),
        firstByteMs: firstByteAt === null ? null : firstByteAt - startedAt,
      });
    });
  });
}

function rawRequestLines(method, target, port, headers, body = "") {
  const lines = [`${method} ${target} HTTP/1.1`, `Host: ${controlSurfaceHost}:${port}`, ...headers, "", ""];
  return `${lines.join("\r\n")}${body}`;
}

function collectBridgeActions(value, connectionId, into = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBridgeActions(item, connectionId, into);
    }
    return into;
  }
  if (value && typeof value === "object") {
    if (
      value.connectionId === connectionId &&
      value.options &&
      typeof value.options === "object" &&
      "header" in value.options
    ) {
      into.push(value);
    }
    for (const child of Object.values(value)) {
      collectBridgeActions(child, connectionId, into);
    }
  }
  return into;
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

    const bridgeTokenPath = path.join(runtime.appDataDir, bridgeTokenFileName);
    assert(
      existsSync(bridgeTokenPath),
      `Packaged control-surface bridge qualification failed: the engine did not write its bridge token to ${bridgeTokenPath}.`
    );
    const bridgeToken = readFileSync(bridgeTokenPath, "utf8").trim();
    assert(
      bridgeTokenPattern.test(bridgeToken),
      `Packaged control-surface bridge qualification failed: ${bridgeTokenPath} does not hold a 64-character hex token.`
    );
    bridgeAuthorization = `Bearer ${bridgeToken}`;
    summary.bridgeTokenPath = bridgeTokenPath;
    summary.steps.push({
      name: "bridge-token-file",
      status: "passed",
      message: "Packaged engine wrote a per-install bridge token; the positive checks below send it.",
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
    const lcdAudioBefore = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=audio_strip_1`);
    const lcdWorkspace = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=workspace`);

    assert(
      typeof contextBefore.projectCount === "number" &&
        typeof contextBefore.viewFilter === "string" &&
        typeof contextBefore.sortBy === "string",
      "Packaged control-surface bridge qualification failed: GET /api/deck/context returned an invalid planning context payload."
    );
    assert(
      typeof contextBefore.workspace === "string" &&
        typeof contextBefore.audio?.bank === "string" &&
        Array.isArray(contextBefore.audio?.strips) &&
        contextBefore.audio.strips.length === 4,
      "Packaged control-surface bridge qualification failed: GET /api/deck/context is missing the workspace or audio deck block."
    );
    assert(
      typeof lcdProjectNav === "string" && lcdProjectNav.includes("PROJECT"),
      "Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=project_nav did not return the expected LCD text."
    );
    assert(
      typeof lcdAudioBefore === "string" && lcdAudioBefore.length > 0,
      "Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=audio_strip_1 did not return audio strip text."
    );
    assert(
      typeof lcdWorkspace === "string" && lcdWorkspace.length > 0,
      "Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=workspace did not return the active workspace."
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

    const mixTargetResponse = await postJson(`${expectedBaseUrl}/api/deck/audio-action`, {
      action: "setMixTarget",
      value: "phones-a",
    });
    assert(
      mixTargetResponse?.selectedMixTargetId === "audio-mix-phones-a",
      "Packaged control-surface bridge qualification failed: POST /api/deck/audio-action setMixTarget did not select Phones 1."
    );

    const audioAfterMixTarget = await harness.request("bridge-qualification-audio-mix-target", "audio.snapshot");
    assert(
      audioAfterMixTarget?.selectedMixTargetId === "audio-mix-phones-a",
      "Packaged control-surface bridge qualification failed: the deck mix-target selection did not round-trip into audio.snapshot."
    );

    const audioVerified = audioAfterMixTarget?.status === "ready";
    let audioResponse;
    let lcdAudioAfter;
    if (audioVerified) {
      audioResponse = await postJson(`${expectedBaseUrl}/api/deck/audio-action`, {
        action: "dialPress",
        value: "1",
      });
      assert(
        typeof audioResponse?.mute === "boolean",
        "Packaged control-surface bridge qualification failed: POST /api/deck/audio-action dialPress did not return the channel mute state."
      );

      const audioAfterPress = await harness.request("bridge-qualification-audio-mute", "audio.snapshot");
      const pressedChannel = audioAfterPress?.channels?.find((channel) => channel.id === audioResponse.channelId);
      assert(
        pressedChannel?.mute === audioResponse.mute,
        "Packaged control-surface bridge qualification failed: the deck mute did not land in the real audio.snapshot channel state."
      );

      lcdAudioAfter = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=audio_strip_1`);
      assert(
        typeof lcdAudioAfter === "string" && (!audioResponse.mute || lcdAudioAfter.includes("MUTED")),
        "Packaged control-surface bridge qualification failed: audio strip LCD did not reflect the mute action."
      );
      assert(
        lcdAudioAfter !== lcdAudioBefore,
        "Packaged control-surface bridge qualification failed: audio strip LCD did not change after the mute action."
      );
    } else {
      audioResponse = await postJsonExpectingStatus(
        `${expectedBaseUrl}/api/deck/audio-action`,
        {
          action: "dialTurn",
          value: "1:up",
        },
        409
      );
      assert(
        typeof audioResponse?.error === "string" && audioResponse.error.length > 0,
        "Packaged control-surface bridge qualification failed: gated audio dialTurn did not return the rejection reason."
      );
      lcdAudioAfter = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=audio_strip_1`);
      assert(
        typeof lcdAudioAfter === "string" && lcdAudioAfter.startsWith("AUDIO"),
        "Packaged control-surface bridge qualification failed: gated audio strips must render the gate reason."
      );
    }

    summary.httpChecks = {
      contextBefore,
      lcdProjectNav,
      lcdAudioBefore,
      lcdWorkspace,
      filterResponse,
      contextAfterFilter,
      planningAfterFilter: {
        viewFilter: planningAfterFilter?.settings?.viewFilter ?? null,
      },
      lightResponse,
      planningAfterDeckMode: {
        deckMode: planningAfterDeckMode?.settings?.deckMode ?? null,
      },
      mixTargetResponse,
      audioVerified,
      audioResponse,
      lcdAudioAfter,
    };
    summary.steps.push({
      name: "bridge-http-routes",
      status: "passed",
      message: "Packaged bridge accepted live HTTP requests and round-tripped planning, lighting, and audio actions.",
    });

    console.log(
      "Step 3: verify the bridge refuses requests without the workstation token, browser origins, foreign hosts, oversized bodies and bodies that never finish, and decodes percent-encoded LCD keys."
    );

    const projectCountBefore = (await fetchJson(`${expectedBaseUrl}/api/deck/context`)).projectCount;
    const deleteProjectBody = JSON.stringify({ action: "deleteProject" });
    const jsonHeaders = { "Content-Type": "application/json" };

    const noToken = await fetchStatus(`${expectedBaseUrl}/api/deck/action`, {
      method: "POST",
      headers: jsonHeaders,
      body: deleteProjectBody,
      authorization: null,
    });
    assert(
      noToken.status === 401,
      `Packaged control-surface bridge qualification failed: a POST without the bridge token returned ${noToken.status} instead of 401: ${noToken.text}`
    );
    assert(
      (noToken.headers.get("www-authenticate") ?? "").startsWith("Bearer"),
      "Packaged control-surface bridge qualification failed: the 401 did not carry a WWW-Authenticate: Bearer challenge."
    );

    const wrongToken = await fetchStatus(`${expectedBaseUrl}/api/deck/action`, {
      method: "POST",
      headers: jsonHeaders,
      body: deleteProjectBody,
      authorization: `Bearer ${bridgeToken.replace(/[0-9a-f]/g, (digit) => (digit === "0" ? "1" : "0"))}`,
    });
    assert(
      wrongToken.status === 401,
      `Packaged control-surface bridge qualification failed: a POST with a wrong token returned ${wrongToken.status} instead of 401: ${wrongToken.text}`
    );

    const browserOrigin = await rawHttp(
      reservedPort,
      rawRequestLines("GET", "/api/deck/context", reservedPort, [
        `Origin: http://${controlSurfaceHost}:${reservedPort}`,
        `Authorization: ${bridgeAuthorization}`,
      ])
    );
    assert(
      browserOrigin.status === 403,
      `Packaged control-surface bridge qualification failed: a request with a browser Origin returned ${browserOrigin.status} instead of 403: ${browserOrigin.text}`
    );

    const foreignHost = await rawHttp(
      reservedPort,
      `GET /api/deck/context HTTP/1.1\r\nHost: studio-pc.local:${reservedPort}\r\nAuthorization: ${bridgeAuthorization}\r\n\r\n`
    );
    assert(
      foreignHost.status === 400,
      `Packaged control-surface bridge qualification failed: a request with a foreign Host returned ${foreignHost.status} instead of 400: ${foreignHost.text}`
    );

    const oversizedBody = `{"action":"setFilter","value":"${"x".repeat(17 * 1024)}"}`;
    const oversized = await rawHttp(
      reservedPort,
      rawRequestLines(
        "POST",
        "/api/deck/action",
        reservedPort,
        [
          `Authorization: ${bridgeAuthorization}`,
          "Content-Type: application/json",
          `Content-Length: ${Buffer.byteLength(oversizedBody)}`,
        ],
        oversizedBody
      )
    );
    assert(
      oversized.status === 413,
      `Packaged control-surface bridge qualification failed: a 17 KiB body returned ${oversized.status} instead of 413: ${oversized.text}`
    );

    const absurdLength = await rawHttp(
      reservedPort,
      rawRequestLines(
        "POST",
        "/api/deck/action",
        reservedPort,
        [`Authorization: ${bridgeAuthorization}`, "Content-Type: application/json", "Content-Length: 99999999"],
        '{"action":'
      )
    );
    assert(
      absurdLength.status === 413,
      `Packaged control-surface bridge qualification failed: a declared 99999999-byte body returned ${absurdLength.status} instead of 413: ${absurdLength.text}`
    );

    const stalled = await rawHttp(
      reservedPort,
      rawRequestLines(
        "POST",
        "/api/deck/action",
        reservedPort,
        [`Authorization: ${bridgeAuthorization}`, "Content-Type: application/json", "Content-Length: 4000"],
        '{"action":'
      )
    );
    assert(
      stalled.status === 408,
      `Packaged control-surface bridge qualification failed: a body that never finished returned ${stalled.status} instead of 408: ${stalled.text}`
    );
    assert(
      stalled.firstByteMs !== null && stalled.firstByteMs <= 1500,
      `Packaged control-surface bridge qualification failed: the 408 took ${stalled.firstByteMs} ms; the bridge deadline is 1 s.`
    );

    const decodedKey = await fetchStatus(`${expectedBaseUrl}/api/deck/lcd?key=audio%2Fstrip_1`);
    assert(
      decodedKey.status === 400 &&
        typeof decodedKey.body?.error === "string" &&
        decodedKey.body.error.includes("audio/strip_1"),
      `Packaged control-surface bridge qualification failed: a percent-encoded LCD key was not decoded before lookup: ${decodedKey.status} ${decodedKey.text}`
    );
    const encodedKnownKey = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=audio%5Fstrip%5F1`);
    assert(
      encodedKnownKey === lcdAudioAfter,
      "Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=audio%5Fstrip%5F1 did not decode to the audio_strip_1 text."
    );

    const projectCountAfter = (await fetchJson(`${expectedBaseUrl}/api/deck/context`)).projectCount;
    assert(
      projectCountAfter === projectCountBefore,
      `Packaged control-surface bridge qualification failed: a refused deleteProject changed the project count (${projectCountBefore} → ${projectCountAfter}).`
    );

    summary.refusalChecks = {
      noToken: noToken.status,
      wrongToken: wrongToken.status,
      browserOrigin: browserOrigin.status,
      foreignHost: foreignHost.status,
      oversizedBody: oversized.status,
      absurdContentLength: absurdLength.status,
      stalledBody: { status: stalled.status, firstByteMs: stalled.firstByteMs },
      decodedKey: decodedKey.status,
      projectCountBefore,
      projectCountAfter,
    };
    summary.steps.push({
      name: "bridge-request-refusals",
      status: "passed",
      message:
        "Packaged bridge refused requests without the token (401), with a browser Origin (403), with a foreign Host (400), with an oversized body (413) and with a stalled body (408), and decoded percent-encoded LCD keys.",
    });

    console.log("Step 4: verify the exported Stream Deck profile carries the bridge token on every request.");

    const exportSummary = await harness.request("bridge-qualification-export", "exports.companion.export");
    assert(
      typeof exportSummary?.path === "string" && existsSync(exportSummary.path),
      "Packaged control-surface bridge qualification failed: exports.companion.export did not write a profile."
    );
    const profile = JSON.parse(readFileSync(exportSummary.path, "utf8"));
    const bridgeConnectionId = Object.entries(profile.instances ?? {}).find(
      ([, instance]) => instance?.instance_type === "generic-http"
    )?.[0];
    assert(
      typeof bridgeConnectionId === "string",
      "Packaged control-surface bridge qualification failed: the exported profile has no generic-http connection."
    );
    const bridgeActions = collectBridgeActions(profile, bridgeConnectionId);
    assert(
      bridgeActions.length > 50,
      `Packaged control-surface bridge qualification failed: the exported profile holds only ${bridgeActions.length} bridge requests.`
    );
    for (const action of bridgeActions) {
      let header = null;
      try {
        header = JSON.parse(action.options.header);
      } catch {
        header = null;
      }
      assert(
        header?.Authorization === bridgeAuthorization,
        `Packaged control-surface bridge qualification failed: a profile request to ${action.options.url} does not carry the bridge token.`
      );
    }
    const pollActions = profile.triggers?.["sse-trigger-lcd-poll"]?.actions ?? [];
    assert(
      pollActions.length > 0 &&
        pollActions.every(
          (action) => typeof action.options?.header === "string" && action.options.header.includes(bridgeToken)
        ),
      "Packaged control-surface bridge qualification failed: the 1 s LCD poll trigger does not carry the bridge token."
    );

    summary.profileCheck = {
      path: exportSummary.path,
      bridgeConnectionId,
      bridgeActionCount: bridgeActions.length,
      lcdPollActionCount: pollActions.length,
    };
    summary.steps.push({
      name: "profile-carries-token",
      status: "passed",
      message: `Exported Stream Deck profile carries the bridge token on all ${bridgeActions.length} bridge requests, the LCD poll included.`,
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
    `Packaged control-surface bridge qualification passed: ${packaged.label} bridge bound at ${summary.expectedBaseUrl}, served live deck HTTP routes with the bridge token, refused the unauthenticated and malformed cases, and exported a profile that carries the token.`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
