import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "check-slice-rescope.mjs");

function makeFakeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "sse-check-slice-rescope-"));
  // Quiet `git` invocations from any user-level hook.
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}

function stageFile(root, relativePath, contents) {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
  spawnSync("git", ["add", relativePath], { cwd: root });
  return absolute;
}

function runChecker(root, ...args) {
  return spawnSync("node", [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("exits 0 when no plan files are staged", () => {
  const result = runChecker(repoRoot);
  assert.equal(result.status, 0);
});

test("exits 0 when a plan file changes but has no slice title edits", () => {
  const root = makeFakeRepo();
  const file = stageFile(root, "docs/plans/example.md", "# Example\n\n## Slice 1 — Initial slice\n\nBody.\n");
  spawnSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

  // Edit only the body (not the slice title); no Rescope: required.
  writeFileSync(file, "# Example\n\n## Slice 1 — Initial slice\n\nBody, updated.\n", "utf8");
  spawnSync("git", ["add", "docs/plans/example.md"], { cwd: root });

  const result = runChecker(root, file);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status} (${result.stderr})`);
});

test("fails when a slice title changes and no Rescope paragraph exists", () => {
  const root = makeFakeRepo();
  const file = stageFile(root, "docs/plans/example.md", "# Example\n\n## Slice 4 — Original slice\n\nBody.\n");
  spawnSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

  // Rename the slice title without adding a Rescope paragraph.
  writeFileSync(file, "# Example\n\n## Slice 4 — Different work\n\nBody.\n", "utf8");
  spawnSync("git", ["add", "docs/plans/example.md"], { cwd: root });

  const result = runChecker(root, file);
  assert.equal(result.status, 1, "should fail with the title changed and no Rescope paragraph");
  assert.match(result.stderr, /Rescope/);
});

test("passes when a slice title changes AND a Rescope paragraph is added", () => {
  const root = makeFakeRepo();
  const file = stageFile(root, "docs/plans/example.md", "# Example\n\n## Slice 6 — Original slice\n\nBody.\n");
  spawnSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

  writeFileSync(
    file,
    "# Example\n\n## Slice 6 — Different work\n\n**Rescope:** original premise didn't survive inspection — replaced with the X approach.\n",
    "utf8"
  );
  spawnSync("git", ["add", "docs/plans/example.md"], { cwd: root });

  const result = runChecker(root, file);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status} (${result.stderr})`);
});

test("ignores non-plan files (.md outside docs/plans)", () => {
  const root = makeFakeRepo();
  const file = stageFile(root, "docs/example.md", "# Example\n\n## Slice 7 — Some heading that looks like a slice\n");
  // Even though the file modifies a "slice title" line, it's outside
  // docs/plans/ and must be skipped entirely.
  spawnSync("git", ["add", "docs/example.md"], { cwd: root });
  const result = runChecker(root, file);
  assert.equal(result.status, 0);
});
