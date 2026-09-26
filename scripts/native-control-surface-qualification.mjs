import { connect } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECK_PAGE_LABELS,
  SAVED_DATA_MARKER_CHANGED,
  SEEDED_WORKSPACE,
  seedSavedWorkspace,
} from "./native-parity-acceptance.mjs";
import { assert, EngineHarness, hardenedLaneEnv, resolvePathFromRoot } from "./native-runtime-harness.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controlSurfaceHost = "127.0.0.1";
// New pages program, Slice 2 (D5): the deck lost its PROJECTS and TASKS pages,
// their route (`POST /api/deck/action`) and the deck mode with Planning. The
// checks that went through them now go through the LIGHTS page and its route;
// each changed step says so in summary.json.
const DECK_ROUTES_CHANGED =
  "New pages program, Slices 2 and 2b: the deck key followed into the hardware link's own snapshot is the LIGHTS page's next-light key (lighting.snapshot) and the page saved through settings.update is read back through the deck; until Slice 2b that page came from a db.json fixture through the import, and until Slice 2 the key was the PROJECTS page's filter key (planning.snapshot) and the deck mode.";
const REFUSALS_CHANGED =
  "New pages program, Slice 2: the refused requests go to the LIGHTS route (/api/deck/light-action) and the deck's last event and selected light prove nothing got through; until then they went to the PROJECTS and TASKS pages' route and the project count proved it.";
const PROFILE_CHANGED =
  "New pages program, Slice 2: the profile has two pages, LIGHTS and AUDIO, a page-follow trigger for each, and every LCD it reads is answered by this bridge; until then it had four pages, PROJECTS and TASKS first.";
/** The two routes a key of the exported profile may post to. */
const DECK_ACTION_ROUTES = ["/api/deck/light-action", "/api/deck/audio-action"];
const FOLLOW_TRIGGER_PREFIX = "sse-trigger-follow-";
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
  if (value === "windows") {
    return value;
  }

  throw new Error(`Unsupported control-surface qualification target '${value}'. Use --target=windows.`);
}

function resolvePackagedRuntime() {
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
  if (process.platform !== "win32") {
    throw new Error(
      `native-control-surface-qualification.mjs target '${target}' must run on a matching host platform.`
    );
  }

  const packaged = resolvePackagedRuntime();
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
    // The lanes' hardening (native-runtime-harness.mjs) names the bridge's
    // own port, which this lane then expects every answer to come from.
    const laneEnv = await hardenedLaneEnv();
    const reservedPort = Number(laneEnv.SSE_CONTROL_SURFACE_PORT);
    const expectedBaseUrl = `http://${controlSurfaceHost}:${reservedPort}`;
    summary.requestedPort = reservedPort;
    summary.expectedBaseUrl = expectedBaseUrl;

    console.log(`Packaged control-surface bridge qualification root: ${qualificationRoot}`);
    console.log(
      "Step 1: start the packaged engine on fresh saved data on a dedicated localhost bridge port and save the page it opens on."
    );

    harness = new EngineHarness({
      rootDir,
      appDataDir: runtime.appDataDir,
      logsDir: runtime.logsDir,
      engineExecutable: packaged.enginePath,
      env: laneEnv,
    });

    await harness.start();
    await seedSavedWorkspace(harness, "bridge-qualification", `Packaged native ${packaged.label} engine`);
    summary.steps.push({
      name: "packaged-engine-start",
      status: "passed",
      message:
        "Packaged engine started on fresh saved data with the light outputs held and the simulated console, and saved Lighting as the page it opens on.",
      scopeChanged: SAVED_DATA_MARKER_CHANGED,
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
      JSON.stringify(summary.controlSurfacePages) === JSON.stringify(DECK_PAGE_LABELS),
      `Packaged control-surface bridge qualification failed: controlSurface.snapshot must expose the deck pages ${DECK_PAGE_LABELS.join(" and ")} in that order, got ${JSON.stringify(summary.controlSurfacePages)}.`
    );

    summary.steps.push({
      name: "bridge-snapshot-contract",
      status: "passed",
      message: `Packaged engine exposed a live bridge and the control-surface page model ${DECK_PAGE_LABELS.join(", ")}.`,
      scopeChanged:
        "New pages program, Slice 2: the page model is LIGHTS and AUDIO in that order; until then it was four pages, PROJECTS and TASKS included.",
    });

    console.log("Step 2: verify live HTTP bind, LCD, and action endpoints against the packaged bridge.");

    const contextBefore = await fetchJson(`${expectedBaseUrl}/api/deck/context`);
    const lcdAudioBefore = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=audio_strip_1`);
    const lcdWorkspace = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=workspace`);

    // The page saved in step 1 reaches the deck: the context and the
    // `workspace` LCD, which the profile's page-follow triggers read.
    assert(
      contextBefore.workspace === SEEDED_WORKSPACE &&
        typeof contextBefore.audio?.bank === "string" &&
        Array.isArray(contextBefore.audio?.strips) &&
        contextBefore.audio.strips.length === 4,
      `Packaged control-surface bridge qualification failed: GET /api/deck/context is missing the saved page '${SEEDED_WORKSPACE}' (got '${contextBefore.workspace}') or the audio deck block.`
    );
    assert(
      typeof lcdAudioBefore === "string" && lcdAudioBefore.length > 0,
      "Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=audio_strip_1 did not return audio strip text."
    );
    assert(
      lcdWorkspace === SEEDED_WORKSPACE,
      `Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=workspace returned '${lcdWorkspace}' instead of the saved page '${SEEDED_WORKSPACE}'.`
    );

    // New saved data holds no lights, so the lane adds two through the app's
    // own requests for the LIGHTS page's next-light key to move between.
    const qualificationLights = [];
    for (const [index, dmxStartAddress] of [481, 489].entries()) {
      const created = await harness.request(`bridge-qualification-light-${index + 1}`, "lighting.fixture.create", {
        name: `Qualification Light ${index + 1}`,
        type: "astra-bicolor",
        dmxStartAddress,
        groupId: null,
      });
      assert(
        typeof created?.fixture?.id === "string",
        `Packaged control-surface bridge qualification failed: lighting.fixture.create did not add qualification light ${index + 1}.`
      );
      qualificationLights.push(created.fixture.id);
    }

    const lcdLightNavBefore = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=light_nav`);
    assert(
      typeof lcdLightNavBefore === "string" &&
        lcdLightNavBefore.startsWith("LIGHT") &&
        lcdLightNavBefore.includes("1/2"),
      `Packaged control-surface bridge qualification failed: GET /api/deck/lcd?key=light_nav did not show the first of the two lights: ${JSON.stringify(lcdLightNavBefore)}.`
    );

    const lightResponse = await postJson(`${expectedBaseUrl}/api/deck/light-action`, {
      action: "selectNextLight",
    });
    assert(
      lightResponse?.selectedLightId === qualificationLights[1],
      `Packaged control-surface bridge qualification failed: POST /api/deck/light-action selectNextLight selected '${lightResponse?.selectedLightId}' instead of the second light '${qualificationLights[1]}'.`
    );

    const lightingAfterKey = await harness.request("bridge-qualification-lighting-select", "lighting.snapshot");
    const lcdLightNavAfter = await fetchJson(`${expectedBaseUrl}/api/deck/lcd?key=light_nav`);
    assert(
      lightingAfterKey?.selectedFixtureId === qualificationLights[1] &&
        typeof lcdLightNavAfter === "string" &&
        lcdLightNavAfter.includes("2/2"),
      "Packaged control-surface bridge qualification failed: the deck's next-light key did not round-trip through the bridge LCD and lighting.snapshot."
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
      lcdAudioBefore,
      lcdWorkspace,
      qualificationLights,
      lcdLightNavBefore,
      lightResponse,
      lightingAfterKey: {
        selectedFixtureId: lightingAfterKey?.selectedFixtureId ?? null,
      },
      lcdLightNavAfter,
      mixTargetResponse,
      audioVerified,
      audioResponse,
      lcdAudioAfter,
    };
    summary.steps.push({
      name: "bridge-http-routes",
      status: "passed",
      message:
        "Packaged bridge accepted live HTTP requests, showed the saved page to the deck, and round-tripped lighting and audio actions.",
      scopeChanged: DECK_ROUTES_CHANGED,
    });

    console.log(
      "Step 3: verify the bridge refuses requests without the workstation token, browser origins, foreign hosts, oversized bodies and bodies that never finish, and decodes percent-encoded LCD keys."
    );

    // What a refused key would have changed: the deck's last event (every
    // key that gets through stamps it) and the selected light (the refused
    // key below is the next-light key).
    const readDeckState = async (id) => ({
      lastEvent: (await harness.request(`${id}-control-surface`, "controlSurface.snapshot"))?.lastEvent ?? null,
      selectedLightId: (await harness.request(`${id}-lighting`, "lighting.snapshot"))?.selectedFixtureId ?? null,
    });
    const deckStateBefore = await readDeckState("bridge-qualification-refusals-before");
    assert(
      deckStateBefore.lastEvent !== null && deckStateBefore.selectedLightId === qualificationLights[1],
      "Packaged control-surface bridge qualification failed: the deck state before the refusals holds no last event or not the selected second light."
    );
    const refusedKeyBody = JSON.stringify({ action: "selectNextLight" });
    const jsonHeaders = { "Content-Type": "application/json" };

    const noToken = await fetchStatus(`${expectedBaseUrl}/api/deck/light-action`, {
      method: "POST",
      headers: jsonHeaders,
      body: refusedKeyBody,
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

    const wrongToken = await fetchStatus(`${expectedBaseUrl}/api/deck/light-action`, {
      method: "POST",
      headers: jsonHeaders,
      body: refusedKeyBody,
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

    const oversizedBody = `{"action":"selectNextLight","value":"${"x".repeat(17 * 1024)}"}`;
    const oversized = await rawHttp(
      reservedPort,
      rawRequestLines(
        "POST",
        "/api/deck/light-action",
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
        "/api/deck/light-action",
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
        "/api/deck/light-action",
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

    const deckStateAfter = await readDeckState("bridge-qualification-refusals-after");
    assert(
      JSON.stringify(deckStateAfter) === JSON.stringify(deckStateBefore),
      `Packaged control-surface bridge qualification failed: a refused request changed the deck state (${JSON.stringify(deckStateBefore)} → ${JSON.stringify(deckStateAfter)}).`
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
      deckStateBefore,
      deckStateAfter,
    };
    summary.steps.push({
      name: "bridge-request-refusals",
      status: "passed",
      message:
        "Packaged bridge refused requests without the token (401), with a browser Origin (403), with a foreign Host (400), with an oversized body (413) and with a stalled body (408), none of them changed the deck state, and it decoded percent-encoded LCD keys.",
      markerChanged: REFUSALS_CHANGED,
    });

    console.log(
      "Step 4: verify the exported Stream Deck profile carries the bridge token on every request and holds the two-page deck (LIGHTS, AUDIO)."
    );

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

    // The two-page profile (new pages program, D5): LIGHTS then AUDIO, a
    // page-follow trigger for each, and nothing it sends that this bridge no
    // longer answers. Every LCD the profile reads is asked of the bridge
    // (reads only); the keys it posts are checked by route, never pressed.
    const profilePages = Object.entries(profile.pages ?? {})
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([number, page]) => `${number}:${page?.name}`);
    const expectedProfilePages = DECK_PAGE_LABELS.map((label, index) => `${index + 1}:${label}`);
    assert(
      exportSummary.pageCount === DECK_PAGE_LABELS.length &&
        JSON.stringify(profilePages) === JSON.stringify(expectedProfilePages),
      `Packaged control-surface bridge qualification failed: the exported profile's pages are ${JSON.stringify(profilePages)} (pageCount ${exportSummary.pageCount}) instead of ${JSON.stringify(expectedProfilePages)}.`
    );

    const followTriggers = Object.entries(profile.triggers ?? {})
      .filter(([id]) => id.startsWith(FOLLOW_TRIGGER_PREFIX))
      .map(([id, trigger]) => ({
        workspace: id.slice(FOLLOW_TRIGGER_PREFIX.length),
        condition: trigger?.condition?.[0]?.options ?? null,
        page: trigger?.actions?.find((action) => action?.definitionId === "set_page")?.options?.page ?? null,
      }));
    const followTargets = followTriggers.map(({ workspace, page }) => `${workspace}:${page}`).sort();
    assert(
      JSON.stringify(followTargets) === JSON.stringify(["audio:2", "lighting:1"]) &&
        followTriggers.every(
          ({ workspace, condition }) =>
            condition?.variable === "custom:lcd_workspace" && condition?.op === "eq" && condition?.value === workspace
        ),
      `Packaged control-surface bridge qualification failed: the page-follow triggers are ${JSON.stringify(followTriggers)} instead of lighting to page 1 and audio to page 2 on custom:lcd_workspace.`
    );
    const savedFollow = followTriggers.find(({ workspace }) => workspace === lcdWorkspace);
    assert(
      savedFollow && profile.pages?.[String(savedFollow.page)]?.name === "LIGHTS",
      `Packaged control-surface bridge qualification failed: the saved page '${lcdWorkspace}' does not bring the deck to LIGHTS.`
    );

    const lcdKeys = new Set();
    const strayRequests = [];
    for (const action of bridgeActions) {
      const url = action.options?.url ?? "";
      if (action.definitionId === "get" && url.startsWith("/api/deck/lcd?key=")) {
        lcdKeys.add(url.slice("/api/deck/lcd?key=".length));
        continue;
      }
      let body = null;
      try {
        body = JSON.parse(action.options?.body ?? "");
      } catch {
        body = null;
      }
      if (
        action.definitionId !== "post" ||
        !DECK_ACTION_ROUTES.includes(url) ||
        typeof body?.action !== "string" ||
        body.action === "switchToDeckMode"
      ) {
        strayRequests.push(`${action.definitionId} ${url} ${action.options?.body ?? ""}`.trim());
      }
    }
    assert(
      strayRequests.length === 0,
      `Packaged control-surface bridge qualification failed: the exported profile sends requests this bridge no longer answers: ${strayRequests.join("; ")}.`
    );
    const unansweredLcds = [];
    for (const key of [...lcdKeys].sort()) {
      const answer = await fetchStatus(`${expectedBaseUrl}/api/deck/lcd?key=${key}`);
      if (answer.status !== 200 || typeof answer.body !== "string") {
        unansweredLcds.push(`${key} (${answer.status})`);
      }
    }
    assert(
      lcdKeys.size > 0 && unansweredLcds.length === 0,
      `Packaged control-surface bridge qualification failed: the bridge did not answer the profile's LCDs: ${unansweredLcds.join(", ") || "none read"}.`
    );

    summary.profilePages = {
      pages: profilePages,
      pageCount: exportSummary.pageCount,
      triggerCount: exportSummary.triggerCount,
      followTargets,
      lcdKeysAnswered: lcdKeys.size,
    };
    summary.steps.push({
      name: "profile-two-pages",
      status: "passed",
      message: `Exported Stream Deck profile holds the pages ${profilePages.join(", ")}, follows the app's page to them, posts only to ${DECK_ACTION_ROUTES.join(" and ")}, and the bridge answered all ${lcdKeys.size} LCDs it reads.`,
      scopeChanged: PROFILE_CHANGED,
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
    `Packaged control-surface bridge qualification passed: ${packaged.label} bridge bound at ${summary.expectedBaseUrl}, served live deck HTTP routes with the bridge token, refused the unauthenticated and malformed cases, and exported a two-page profile that carries the token and reads only LCDs the bridge answers.`
  );
}

// Runs only as `node scripts/native-control-surface-qualification.mjs …`: an
// import does nothing (2026-09-26; the run starts the packaged engine from
// release/native and its bridge). The two paths are compared as real paths —
// through a directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
// would skip the run without a word (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  let same = false;
  try {
    same = realpathSync.native(started) === realpathSync.native(self);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  if (!same && path.basename(started) === path.basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
