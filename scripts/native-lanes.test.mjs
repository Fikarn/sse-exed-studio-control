import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acceptanceEngineEnv,
  LIVE_CONSOLE,
  MOVED_WORKSPACE,
  NEW_DATA_WORKSPACE,
  SEEDED_WORKSPACE,
} from "./native-parity-acceptance.mjs";
import {
  EngineHarness,
  hardenedLaneEnv,
  LIVE_APP_CONTROL_SURFACE_PORT,
  laneEnvRefusal,
} from "./native-runtime-harness.mjs";

// New pages program, Slice 2: Planning left the hardware link. Every lane that
// still asked for it (a `planning.*` request, the PROJECTS and TASKS pages'
// route `/api/deck/action`, the `project_nav` LCD) failed only when it ran,
// and the packaged, installer, delivery and bridge lanes run only at a release.
// These tests read the lanes and hold them to what the hardware link answers:
// the contract's methods, the bridge's routes and its LCD keys.
//
// Slice 2b (2026-09-25): the db.json import is retired, and the lanes seed
// their saved data through the app's own requests. These tests also hold
// them to that — no lane names the import's variables or fixtures, and every
// publish carries the probe override a fresh hardware link needs — and to
// the program's hardware-safety rule: every engine and shell a lane starts
// has a bridge port of its own, holds the light outputs and (outside the live
// console lane) runs the simulated console.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The scripts that send requests to a test hardware link. */
const LANES = [
  "scripts/native-acceptance.mjs",
  "scripts/native-parity-acceptance.mjs",
  "scripts/native-control-surface-qualification.mjs",
  "scripts/native-packaged-acceptance.mjs",
  "scripts/native-installer-acceptance.mjs",
  "scripts/native-delivery-acceptance.mjs",
  "scripts/native-release-safety.mjs",
];
const BRIDGE_LANE = "scripts/native-control-surface-qualification.mjs";
/** The scripts that start the app — an engine or a shell — for a lane, and the harness that starts their engines. */
const PROCESS_LANES = [
  "scripts/native-runtime-harness.mjs",
  "scripts/native-acceptance.mjs",
  "scripts/native-control-surface-qualification.mjs",
  "scripts/native-package.mjs",
  "scripts/native-packaged-acceptance.mjs",
  "scripts/native-installer-acceptance.mjs",
  "scripts/native-delivery-acceptance.mjs",
  "scripts/legacy/tauri-package-candidate.mjs",
  "scripts/tauri-setup-support-qualification.mjs",
  "scripts/tauri-workspace-qualification.mjs",
  "scripts/tauri-smoke.mjs",
];
const ALL_LANES = [...new Set([...LANES, ...PROCESS_LANES])];
/** The one launch that leaves the safe start out (its step 8 proves a hold outlives the launch that made it). */
const SAFE_START_WAIVER_LANE = "scripts/tauri-setup-support-qualification.mjs";

function read(relative) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

/** Drops whole-line `//` comments and `/* … *\/` blocks, which may name what is gone. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The index of the bracket that closes the one at `open`, skipping quoted text; -1 when it never closes. */
function closingIndex(source, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (pairs[char]) {
      stack.push(pairs[char]);
    } else if (char === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** The params of every `.request(<id>, "commissioning.update", …)` call; null for params that are not an object literal. */
function commissioningUpdateParams(source) {
  const text = withoutComments(source);
  const pattern = /\.request\(\s*(?:`[^`]*`|"[^"]*"|'[^']*')\s*,\s*"commissioning\.update"\s*(,\s*\{)?/g;
  return [...text.matchAll(pattern)].map((match) => {
    if (!match[1]) {
      return null;
    }
    const open = match.index + match[0].length - 1;
    return text.slice(open, closingIndex(text, open) + 1);
  });
}

/** Every `laneProcessEnv(…)` call of a source, as [open, close] indexes. */
function laneProcessEnvCalls(text) {
  return [...text.matchAll(/\blaneProcessEnv\(/g)].map((match) => {
    const open = match.index + match[0].length - 1;
    return [open, closingIndex(text, open)];
  });
}

/** The method of every `.request(<id>, "<method>"…)` call in a source. */
function requestedMethods(source) {
  const pattern = /\.request\(\s*(?:`[^`]*`|"[^"]*"|'[^']*')\s*,\s*"([^"]+)"/g;
  return [...withoutComments(source).matchAll(pattern)].map((match) => match[1]);
}

/** The body of a Rust function, from its signature to the next `fn`. */
function rustFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found`);
  const next = source.indexOf("\nfn ", start + signature.length);
  const nextPub = source.indexOf("\npub fn ", start + signature.length);
  const ends = [next, nextPub].filter((index) => index !== -1);
  return source.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

function contractMethods() {
  const contract = JSON.parse(read("native/protocol/v1.contract.json"));
  return new Set(contract.methods);
}

function bridgeRoutes() {
  const body = rustFunctionBody(
    read("native/rust-engine/src/control_surface_http.rs"),
    "fn route_control_surface_request("
  );
  return new Set([...body.matchAll(/\("(?:GET|POST)",\s*"(\/api\/deck\/[^"]+)"\)/g)].map((match) => match[1]));
}

function bridgeLcdKeys() {
  const body = rustFunctionBody(
    read("native/rust-engine/src/control_surface.rs"),
    "pub fn read_control_surface_lcd_text("
  );
  return new Set([...body.matchAll(/"([a-z0-9_]+)"\s*(?==>|\|)/g)].map((match) => match[1]));
}

test("the contract and the bridge sources parse into methods, routes and LCD keys", () => {
  const methods = contractMethods();
  assert.ok(methods.has("app.snapshot") && methods.has("support.backup.restore"), "contract methods");
  assert.deepEqual(
    [...bridgeRoutes()].sort(),
    ["/api/deck/audio-action", "/api/deck/context", "/api/deck/lcd", "/api/deck/light-action"],
    "bridge routes"
  );
  const lcdKeys = bridgeLcdKeys();
  for (const key of ["light_nav", "scene_nav", "audio_strip_1", "audio_key_8", "audio_state_gated", "workspace"]) {
    assert.ok(lcdKeys.has(key), `LCD key ${key}`);
  }
  assert.deepEqual(requestedMethods('await h.request(`${p}-x`, "a.b", {}); h.request("id", "c.d")'), ["a.b", "c.d"]);
});

test("every request a hardware-link lane sends is a method of the contract", () => {
  const methods = contractMethods();
  const strays = [];
  for (const lane of LANES) {
    const requested = requestedMethods(read(lane));
    assert.ok(requested.length > 0, `${lane} sends no request the scan can see`);
    for (const method of requested) {
      if (!methods.has(method)) {
        strays.push(`${lane}: ${method}`);
      }
    }
  }
  assert.deepEqual(strays, [], "requests the hardware link answers with UNKNOWN_METHOD");
});

test("the bridge lane calls only routes the bridge serves and reads only LCD keys it answers", () => {
  const source = withoutComments(read(BRIDGE_LANE));
  const routes = bridgeRoutes();
  const paths = new Set([...source.matchAll(/\/api\/deck\/[a-z-]+/g)].map((match) => match[0]));
  assert.ok(paths.size > 0, "the scan found no bridge path");
  assert.deepEqual(
    [...paths].filter((route) => !routes.has(route)),
    [],
    "bridge paths the lane uses that the bridge no longer routes"
  );

  // The LCDs the lane reads with fetchJson, which requires a 200; the keys it
  // sends to be refused go through fetchStatus.
  const lcdKeys = bridgeLcdKeys();
  const readKeys = [
    ...source.matchAll(/fetchJson\(`\$\{expectedBaseUrl\}\/api\/deck\/lcd\?key=([A-Za-z0-9_%]+)`\)/g),
  ].map((match) => decodeURIComponent(match[1]));
  assert.ok(readKeys.length > 0, "the scan found no LCD the lane reads");
  assert.deepEqual(
    readKeys.filter((key) => !lcdKeys.has(key)),
    [],
    "LCD keys the lane reads that the bridge refuses"
  );
});

test("every publish a lane sends carries the probe override a fresh hardware link needs", () => {
  assert.deepEqual(
    commissioningUpdateParams(
      'await h.request(`${p}-x`, "commissioning.update", { stage: "ready", a: { b: "}" } }); h.request("y", "commissioning.update", params)'
    ),
    ['{ stage: "ready", a: { b: "}" } }', null],
    "the scanner reads the params object whole and names params it cannot read"
  );

  const publishes = [];
  const refused = [];
  for (const lane of ALL_LANES) {
    for (const params of commissioningUpdateParams(read(lane))) {
      if (params === null) {
        refused.push(`${lane}: params the scan cannot read`);
      } else if (/\bstage:\s*"ready"/.test(params)) {
        publishes.push(lane);
        if (!/\boverrideProbes:\s*true\b/.test(params)) {
          refused.push(`${lane}: ${params.replace(/\s+/g, " ")}`);
        }
      }
    }
  }
  assert.ok(publishes.length > 0, "the scan found no publish");
  // Without the override the hardware link refuses the publish while any
  // probe has not passed (COMMISSIONING_PROBES_INCOMPLETE), and no lane host
  // has the studio's hardware.
  assert.deepEqual(refused, [], "publishes a fresh hardware link refuses");
});

test("no lane names the retired db.json import, its variables or its fixtures", () => {
  const retired = [
    /SSE_LEGACY_DB_PATH/,
    /SSE_DISABLE_AUTO_IMPORT/,
    /[\w-]+-db\.json/,
    /rust-engine["'`]\s*,\s*["'`]fixtures|rust-engine[\\/]fixtures/,
  ];
  const strays = [];
  for (const lane of ALL_LANES) {
    const text = withoutComments(read(lane));
    for (const pattern of retired) {
      const match = pattern.exec(text);
      if (match) {
        strays.push(`${lane}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(strays, [], "the lanes seed through the app's own requests now");
});

test("the lanes' hardening: a bridge port of their own, the light outputs held, the simulated console", async () => {
  const env = await hardenedLaneEnv();
  assert.match(env.SSE_CONTROL_SURFACE_PORT, /^\d{1,5}$/);
  assert.notEqual(Number(env.SSE_CONTROL_SURFACE_PORT), LIVE_APP_CONTROL_SURFACE_PORT);
  assert.equal(env.SSE_SAFE_START, "1");
  assert.equal(env.SSE_AUDIO_SIMULATED_INPUT_MODE, "1");
  assert.equal(laneEnvRefusal(env, { liveConsole: false }), null);

  // The live console lane keeps the real console and nothing else.
  const live = await hardenedLaneEnv({ simulatedAudio: false });
  assert.equal(Object.hasOwn(live, "SSE_AUDIO_SIMULATED_INPUT_MODE"), false);
  assert.equal(laneEnvRefusal(live, { liveConsole: true }), null);
  assert.match(laneEnvRefusal(live, { liveConsole: false }), /SSE_AUDIO_SIMULATED_INPUT_MODE/);
  const acceptance = await acceptanceEngineEnv({ SSE_LANE_MARKER: "kept" });
  assert.equal(acceptance.SSE_LANE_MARKER, "kept");
  assert.equal(acceptance.SSE_SAFE_START, "1");
  assert.equal(acceptance.SSE_AUDIO_SIMULATED_INPUT_MODE, LIVE_CONSOLE ? undefined : "1");
  assert.equal(laneEnvRefusal(acceptance), null);

  const hardened = { SSE_CONTROL_SURFACE_PORT: "45123", SSE_SAFE_START: "1", SSE_AUDIO_SIMULATED_INPUT_MODE: "1" };
  assert.equal(laneEnvRefusal(hardened, { liveConsole: false }), null);
  const refused = {
    "no port": { ...hardened, SSE_CONTROL_SURFACE_PORT: undefined },
    "the live app's port": { ...hardened, SSE_CONTROL_SURFACE_PORT: String(LIVE_APP_CONTROL_SURFACE_PORT) },
    "a port the engine cannot read (it would fall back to the live app's)": {
      ...hardened,
      SSE_CONTROL_SURFACE_PORT: "0x10",
    },
    "a port out of range": { ...hardened, SSE_CONTROL_SURFACE_PORT: "70000" },
    "no safe start": { ...hardened, SSE_SAFE_START: undefined },
    "a safe start switched off": { ...hardened, SSE_SAFE_START: "off" },
    "the real console": { ...hardened, SSE_AUDIO_SIMULATED_INPUT_MODE: undefined },
    "a simulated console the engine does not read": { ...hardened, SSE_AUDIO_SIMULATED_INPUT_MODE: "on" },
  };
  for (const [label, candidate] of Object.entries(refused)) {
    assert.notEqual(laneEnvRefusal(candidate, { liveConsole: false }), null, label);
  }
  // The waiver leaves out the safe start and nothing else.
  const armedStart = { ...hardened, SSE_SAFE_START: "0" };
  assert.equal(laneEnvRefusal(armedStart, { safeStart: false, liveConsole: false }), null);
  assert.notEqual(
    laneEnvRefusal({ ...armedStart, SSE_CONTROL_SURFACE_PORT: "38201" }, { safeStart: false, liveConsole: false }),
    null
  );
});

test("the harness starts no engine without the lanes' hardening, and checks before it looks or makes anything", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sse-native-lanes-"));
  try {
    const engineExecutable = path.join(root, "no-engine-here.exe");
    const unhardened = new EngineHarness({
      rootDir: repoRoot,
      appDataDir: path.join(root, "unhardened", "app-data"),
      logsDir: path.join(root, "unhardened", "logs"),
      engineExecutable,
      env: {
        SSE_CONTROL_SURFACE_PORT: String(LIVE_APP_CONTROL_SURFACE_PORT),
        SSE_SAFE_START: "1",
        SSE_AUDIO_SIMULATED_INPUT_MODE: "1",
      },
    });
    await assert.rejects(unhardened.start(), /was not started: SSE_CONTROL_SURFACE_PORT is 38201/);
    assert.equal(existsSync(path.join(root, "unhardened")), false, "the refused start made no folder");

    // A hardened environment passes the check and stops only at the missing
    // executable: no engine runs in this test.
    const hardened = new EngineHarness({
      rootDir: repoRoot,
      appDataDir: path.join(root, "hardened", "app-data"),
      logsDir: path.join(root, "hardened", "logs"),
      engineExecutable,
      env: await acceptanceEngineEnv(),
    });
    await assert.rejects(hardened.start(), /Native engine executable not found/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("every app a lane starts gets its scratch folders and the hardening check in one place", () => {
  const strays = [];
  for (const lane of PROCESS_LANES) {
    const text = withoutComments(read(lane));
    const calls = laneProcessEnvCalls(text);
    assert.ok(
      calls.every(([, close]) => close !== -1),
      `${lane}: a laneProcessEnv( call the scan cannot close`
    );
    // An engine or a shell is handed its app data as `SSE_APP_DATA_DIR`; one
    // started without it would open the real app data.
    const handovers = [...text.matchAll(/\bSSE_APP_DATA_DIR\s*:/g)].map((match) => match.index);
    assert.ok(handovers.length > 0 || /\bnew EngineHarness\(/.test(text), `${lane} starts nothing the scan can see`);
    for (const at of handovers) {
      if (!calls.some(([open, close]) => open < at && at < close)) {
        strays.push(`${lane}: …${text.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, " ")}…`);
      }
    }
  }
  assert.deepEqual(strays, [], "app data handed to a process outside laneProcessEnv, which holds it to the hardening");

  const waivers = PROCESS_LANES.flatMap((lane) =>
    [...withoutComments(read(lane)).matchAll(/\bsafeStart:\s*false\b/g)].map(() => lane)
  );
  assert.deepEqual(waivers, [SAFE_START_WAIVER_LANE], "a launch without the safe start other than the one allowed");
});

test("the page a lane seeds can be seen: new saved data opens on another, and the restore's marker differs from it", () => {
  const defaultWorkspace = /pub const DEFAULT_WORKSPACE: &str = "([a-z]+)";/.exec(
    read("native/rust-engine/src/shell_settings.rs")
  )?.[1];
  assert.ok(defaultWorkspace, "DEFAULT_WORKSPACE not found in shell_settings.rs");
  assert.equal(NEW_DATA_WORKSPACE, defaultWorkspace, "the lanes' new-data page is the hardware link's default");
  assert.notEqual(SEEDED_WORKSPACE, NEW_DATA_WORKSPACE, "the seeded page must differ from the default page");
  assert.notEqual(MOVED_WORKSPACE, SEEDED_WORKSPACE, "the page saved after the backup must differ from the seeded one");
});
