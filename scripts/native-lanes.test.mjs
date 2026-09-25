import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { IMPORTED_WORKSPACE } from "./native-parity-acceptance.mjs";

// New pages program, Slice 2: Planning left the hardware link. Every lane that
// still asked for it (a `planning.*` request, the PROJECTS and TASKS pages'
// route `/api/deck/action`, the `project_nav` LCD) failed only when it ran,
// and the packaged, installer, delivery and bridge lanes run only at a release.
// These tests read the lanes and hold them to what the hardware link answers:
// the contract's methods, the bridge's routes and its LCD keys, and the two
// db.json fixtures to what the (interim) import reads.

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

function read(relative) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

/** Drops whole-line `//` comments and `/* … *\/` blocks, which may name what is gone. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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

test("the db.json fixtures hold only what the interim import reads, and the sample's import can be seen", () => {
  // `LegacyDbWire` / `LegacySettingsWire` in legacy_import.rs: the import
  // reads `schemaVersion`, `settings.dashboardView` and
  // `settings.hasCompletedSetup`, nothing else (Slice 2; Slice 2b retires it).
  const importSource = read("native/rust-engine/src/legacy_import.rs");
  for (const field of ["schemaVersion", "dashboardView", "hasCompletedSetup"]) {
    assert.ok(importSource.includes(`rename = "${field}"`), `legacy_import.rs no longer reads ${field}`);
  }
  const fixtures = {
    "commissioning-sample-db.json": false,
    "dashboard-ready-db.json": true,
  };
  for (const [name, completed] of Object.entries(fixtures)) {
    const fixture = JSON.parse(read(`native/rust-engine/fixtures/${name}`));
    assert.deepEqual(Object.keys(fixture).sort(), ["schemaVersion", "settings"], `${name}: top-level keys`);
    assert.deepEqual(
      Object.keys(fixture.settings).sort(),
      ["dashboardView", "hasCompletedSetup"],
      `${name}: settings keys`
    );
    assert.equal(fixture.settings.hasCompletedSetup, completed, `${name}: hasCompletedSetup`);
    assert.ok(["lighting", "audio"].includes(fixture.settings.dashboardView), `${name}: a page the app still has`);
  }

  // The lanes see the sample's import by the page it writes, so that page
  // must differ from the one new saved data opens on.
  const defaultWorkspace = /pub const DEFAULT_WORKSPACE: &str = "([a-z]+)";/.exec(
    read("native/rust-engine/src/shell_settings.rs")
  )?.[1];
  const sample = JSON.parse(read("native/rust-engine/fixtures/commissioning-sample-db.json"));
  assert.equal(sample.settings.dashboardView, IMPORTED_WORKSPACE, "the lanes' imported page is the sample's");
  assert.ok(defaultWorkspace, "DEFAULT_WORKSPACE not found in shell_settings.rs");
  assert.notEqual(IMPORTED_WORKSPACE, defaultWorkspace, "the imported page must differ from the default page");
});
