import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Production readiness 2026-09, Slice 14 (finding F26) — "the 2,000-line guard is
// bypassed by an allowlist that keeps growing". The allowlist for source files is
// gone; these cases hold the guard to that. Each runs the real script inside a
// throwaway git repository, because the script reads `git ls-files`.

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptsDir, "file-health.mjs");

const linesOf = (count) =>
  Array.from({ length: count }, (_, index) => `export const line${index} = ${index};`).join("\n");

function runIn(files) {
  const root = mkdtempSync(path.join(tmpdir(), "sse-file-health-"));
  try {
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    };
    git("init", "--quiet");
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
    git("add", "--all");
    return spawnSync(process.execPath, [scriptPath], { cwd: root, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a source file of exactly 2,000 lines passes", () => {
  const result = runIn({ "edge.ts": linesOf(2000) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /File health guard passed/);
});

test("a source file of 2,001 lines fails and is named", () => {
  const result = runIn({ "edge.ts": linesOf(2000), "big.tsx": linesOf(2001) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /big\.tsx \(2001 lines\)/);
  assert.doesNotMatch(result.stderr, /edge\.ts/);
});

test("every source extension is held to the limit, and nothing else is", () => {
  for (const extension of [".css", ".mjs", ".rs", ".ts", ".tsx"]) {
    const result = runIn({ [`big${extension}`]: linesOf(2001) });
    assert.equal(result.status, 1, `${extension} should be held to the limit`);
  }
  const result = runIn({ "notes.md": linesOf(2001), "data.json": linesOf(2001) });
  assert.equal(result.status, 0, result.stderr);
});

test("the script carries no allowlist for oversized source files", () => {
  // The paths that were once excused must fail like any other file: a path the
  // old allowlist named, at the old size, is refused.
  const onceExcused = "frontend/app/src/app/lighting/LightingWorkspace.tsx";
  const result = runIn({ [onceExcused]: linesOf(3170) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LightingWorkspace\.tsx \(3170 lines\)/);

  assert.doesNotMatch(readFileSync(scriptPath, "utf8"), /oversizedSourceAllowlist/);
});
