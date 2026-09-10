import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// 2026-09 production readiness, Slice 1 (finding F24): the Vite dev server
// listened on every interface (`host: "0.0.0.0"`), so the dev shell's
// front end — and with it the test bridge in `tauri dev` — was reachable
// from the studio LAN. Every server this repo starts binds loopback; this
// test is the guard that fails if an all-interfaces bind comes back.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const ALL_INTERFACES = /\b0\.0\.0\.0\b/;

// Surfaces that decide where a local server listens. Test fixtures that use
// 0.0.0.0 as a deliberately unreachable lighting-bridge address
// (frontend/app/tests/setup.spec.ts, the engine-client fixture transport)
// are not server binds and are not scanned.
const SERVER_SURFACES = [
  "frontend/app/vite.config.ts",
  "frontend/app/playwright.config.ts",
  "frontend/app/.storybook/main.ts",
  "frontend/app/package.json",
  "native/tauri-shell/tauri.conf.json",
  "package.json",
];

function listScriptSources(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    if (statSync(absolute).isDirectory()) {
      entries.push(...listScriptSources(absolute));
    } else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) {
      entries.push(absolute);
    }
  }
  return entries;
}

test("the Vite dev server binds loopback only", () => {
  const config = readFileSync(path.join(repoRoot, "frontend/app/vite.config.ts"), "utf8");
  assert.match(config, /host:\s*"127\.0\.0\.1"/, 'frontend/app/vite.config.ts must set server.host to "127.0.0.1"');
  assert.doesNotMatch(config, ALL_INTERFACES, "frontend/app/vite.config.ts must not bind 0.0.0.0");
});

test("no local server surface binds every interface", () => {
  const offenders = [];
  for (const relative of SERVER_SURFACES) {
    const contents = readFileSync(path.join(repoRoot, relative), "utf8");
    if (ALL_INTERFACES.test(contents)) {
      offenders.push(relative);
    }
  }
  assert.deepEqual(offenders, [], `server surfaces binding 0.0.0.0: ${offenders.join(", ")}`);
});

test("no helper script starts a server on every interface", () => {
  const offenders = listScriptSources(path.join(repoRoot, "scripts"))
    .filter((file) => ALL_INTERFACES.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(repoRoot, file).replace(/\\/g, "/"));
  assert.deepEqual(offenders, [], `scripts binding 0.0.0.0: ${offenders.join(", ")}`);
});
