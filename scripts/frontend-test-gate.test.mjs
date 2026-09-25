import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Faster checks, 2026-09-25: `dev:check` and CI's `frontend-test` run the
// frontend's tests once, through `frontend:test:coverage`
// (`npm run test:coverage --workspaces --if-present`); they used to run them
// twice, once without and once with coverage. A workspace whose tests have no
// `test:coverage` script would drop out of both gates without a word.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function workspaceDirs() {
  const patterns = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).workspaces;
  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) {
      return [pattern];
    }
    const parent = pattern.slice(0, -2);
    return readdirSync(path.join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

test("every frontend workspace with tests runs them in the coverage gate", () => {
  const dirs = workspaceDirs().filter((dir) => existsSync(path.join(root, dir, "package.json")));
  assert.ok(dirs.length >= 5, `workspaces found: ${dirs.join(", ")}`);
  const missing = dirs.filter((dir) => {
    const scripts = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")).scripts ?? {};
    return scripts.test !== undefined && scripts["test:coverage"] === undefined;
  });
  assert.deepEqual(missing, [], "these run `test` but have no `test:coverage`");
});

test("the coverage gate is what dev:check and CI run", () => {
  const rootScripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.equal(rootScripts["frontend:test:coverage"], "npm run test:coverage --workspaces --if-present");
  const workflow = readFileSync(path.join(root, ".github", "workflows", "dev-checks.yml"), "utf8");
  assert.match(workflow, /- run: npm run frontend:test:coverage\n/);
  assert.doesNotMatch(workflow, /- run: npm run frontend:test\n/, "the tests run once, with coverage");
});
