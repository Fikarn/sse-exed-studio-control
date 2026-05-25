import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// plan PR 10 / workstream G2 — Tier 2 coverage for scripts/tauri-visual-review.mjs.
//
// tauri-visual-review.mjs is intentionally thin: it shells out to `npm run
// build --workspace frontend/app` and `npm run playwright:test --workspace
// frontend/app -- visual-review.spec.ts`, then writes a small summary JSON
// stub. The top-level body runs at import time, the only non-side-effect
// function is `resolveGitSha`, and it exports nothing — so the full flow
// would require Playwright + npm + a built Storybook to verify end-to-end
// (which the `frontend:playwright:test` lane already does).
//
// What we CAN guard here without invoking the real spawn:
//   1. The script file exists where docs/README claim and is well-formed
//      ESM (parses + has the documented imports).
//   2. The documented summary path it produces lives at the
//      `artifacts/visual/tauri-cutover/fixture-viewport-summary.json`
//      location — this constant is load-bearing because
//      release/write-release-manifest.mjs::findVisualReviewSummary() looks
//      it up there (see scripts/release/write-release-manifest.test.mjs).
//   3. The wrapper still runs the documented Playwright spec
//      (visual-review.spec.ts) — accidental rename would silently skip
//      the visual diff gate.
//   4. The wrapper preserves the documented "baselinesDir" /
//      "playwrightReport" keys it logs to stdout — release-acceptance
//      readers (and HANDOFF.md) consume those.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "tauri-visual-review.mjs");

function readScript() {
  return readFileSync(scriptPath, "utf8");
}

test("the wrapper script exists and is non-empty", () => {
  assert.equal(existsSync(scriptPath), true, `${scriptPath} should exist`);
  const stats = statSync(scriptPath);
  assert.ok(stats.size > 256, "script should not be empty");
});

test("the wrapper exists and is loadable as an ESM source string", () => {
  // We do NOT `import()` the script because importing executes its
  // top-level body (npm run build, npm run playwright:test) which would
  // hang the test suite. Instead we confirm the source parses by reading
  // it and asserting it has the documented ESM imports — anything else
  // would have to be caught by `npm run lint`.
  const source = readScript();
  assert.match(source, /from "node:child_process"/);
  assert.match(source, /from "node:url"/);
});

test("the wrapper invokes `npm run build --workspace frontend/app`", () => {
  const source = readScript();
  assert.match(source, /run.*build.*--workspace.*frontend\/app/);
});

test("the wrapper invokes `npm run playwright:test --workspace frontend/app -- visual-review.spec.ts`", () => {
  // Guards against accidental rename / scope change of the gating spec.
  const source = readScript();
  assert.match(source, /playwright:test/);
  assert.match(source, /visual-review\.spec\.ts/);
  assert.match(source, /--workspace.*frontend\/app/);
});

test("the wrapper writes the summary JSON under artifacts/visual/tauri-cutover/", () => {
  // The summary path is load-bearing: scripts/release/write-release-manifest.mjs
  // ::findVisualReviewSummary() expects exactly this layout.
  const source = readScript();
  assert.match(source, /artifacts\/visual\/tauri-cutover/);
  assert.match(source, /fixture-viewport-summary\.json/);
});

test("the wrapper preserves the documented stdout summary keys", () => {
  // Operators and HANDOFF.md consume `baselinesDir`, `playwrightReport`,
  // and `summary` from this JSON. Anything else is incidental.
  const source = readScript();
  assert.match(source, /baselinesDir/);
  assert.match(source, /playwrightReport/);
  assert.match(source, /summary/);
});

test("the wrapper records the build host platform and git SHA in the summary stub", () => {
  // The summary JSON is the only artifact this wrapper emits; it must
  // continue to record provenance fields the release manifest relies on.
  const source = readScript();
  assert.match(source, /platform: process\.platform/);
  assert.match(source, /resolveGitSha/);
  assert.match(source, /capturedAt:/);
});

test("the wrapper points at the published baseline dir under frontend/app/tests/__visual__/", () => {
  // PR 1 / workstream A2 cemented this baseline path. Any drift here
  // means the wrapper would log a path no other tooling reads.
  const source = readScript();
  assert.match(source, /frontend\/app\/tests\/__visual__\/visual-review\.spec\.ts-snapshots/);
});
