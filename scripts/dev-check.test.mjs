import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { DEV_CHECK_STEPS, devCheckSteps, failureReport, runSteps, toolCacheKey } from "./dev-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;

function recorder(outcomes = {}) {
  const events = [];
  let running = 0;
  let most = 0;
  const runStep = async (step) => {
    running += 1;
    most = Math.max(most, running);
    events.push(`start ${step.id}`);
    await delay(10);
    running -= 1;
    events.push(`end ${step.id}`);
    return outcomes[step.id] ?? true;
  };
  return { events, runStep, most: () => most };
}

test("independent steps run side by side, and a step starts after the steps it names", async () => {
  const { events, runStep, most } = recorder();
  const status = await runSteps(
    [{ id: "a" }, { id: "b", after: ["a"] }, { id: "c", after: ["b"] }, { id: "x" }, { id: "y" }],
    runStep
  );
  assert.deepEqual([...status.values()], ["passed", "passed", "passed", "passed", "passed"]);
  assert.ok(most() >= 3, `at most ${most()} at once`);
  assert.ok(events.indexOf("end a") < events.indexOf("start b"));
  assert.ok(events.indexOf("end b") < events.indexOf("start c"));
});

test("a failure stops nothing: the steps after it still run, so one run shows every failure", async () => {
  const { events, runStep } = recorder({ a: false, x: false });
  const status = await runSteps(
    [{ id: "a" }, { id: "b", after: ["a"] }, { id: "c", after: ["b"] }, { id: "x" }],
    runStep
  );
  assert.deepEqual(Object.fromEntries(status), { a: "failed", b: "passed", c: "passed", x: "failed" });
  assert.ok(events.indexOf("end a") < events.indexOf("start b"), "b still waits for a to finish");
});

test("a prerequisite that is not a step is refused before anything runs", async () => {
  const { events, runStep } = recorder();
  await assert.rejects(runSteps([{ id: "a", after: ["missing"] }], runStep), /waits for missing/);
  assert.deepEqual(events, []);
});

test("the gate's steps are npm scripts, the same set dev:check:serial runs one after another", () => {
  for (const step of DEV_CHECK_STEPS) {
    assert.ok(scripts[step.id], `${step.id} is an npm script`);
  }
  assert.equal(scripts["dev:check"], "node scripts/dev-check-cli.mjs");
  const serial = scripts["dev:check:serial"].split(" && ").map((part) => part.replace(/^npm run /, ""));
  assert.deepEqual([...serial].sort(), DEV_CHECK_STEPS.map((step) => step.id).sort());
  for (const step of DEV_CHECK_STEPS) {
    for (const prerequisite of step.after ?? []) {
      assert.ok(serial.indexOf(prerequisite) < serial.indexOf(step.id), `${prerequisite} before ${step.id}`);
    }
  }
});

test("the cargo steps form one chain, and what reads protocol:check's staging folder starts after it", () => {
  const byId = Object.fromEntries(DEV_CHECK_STEPS.map((step) => [step.id, step]));
  assert.deepEqual(byId["rust:clippy"].after, ["protocol:check"]);
  assert.deepEqual(byId["native:test"].after, ["rust:clippy"]);
  for (const reader of ["format:check", "frontend:typecheck"]) {
    assert.ok(byId[reader].after.includes("protocol:check"), reader);
  }
});

test("the local caches have their own places, keyed on the lockfile and the tools' configuration", () => {
  const files = { "package-lock.json": "lock-1", "eslint.config.mjs": "config" };
  const key = toolCacheKey((name) => files[name] ?? null);
  assert.match(key, /^[0-9a-f]{16}$/);
  assert.notEqual(
    toolCacheKey((name) => ({ ...files, "package-lock.json": "lock-2" })[name] ?? null),
    key
  );
  assert.notEqual(
    toolCacheKey((name) => ({ ...files, ".prettierignore": "x" })[name] ?? null),
    key
  );
  assert.equal(
    toolCacheKey((name) => files[name] ?? null),
    key,
    "the same files, the same key"
  );

  const byId = Object.fromEntries(devCheckSteps("abc").map((step) => [step.id, step]));
  const location = (step) => step.args[step.args.indexOf("--cache-location") + 1];
  assert.equal(location(byId["format:check"]), "node_modules/.cache/dev-check/prettier-abc");
  assert.equal(location(byId.lint), "node_modules/.cache/dev-check/eslint-abc/");
});

test("a failed step's log is printed whole when short, else its failure lines and its end", () => {
  assert.equal(failureReport("one\ntwo"), "one\ntwo");
  const long = [
    ...Array.from({ length: 300 }, (_, index) => `line ${index}`),
    " FAIL  src/app/App.test.tsx > renders",
    ...Array.from({ length: 100 }, (_, index) => `after ${index}`),
  ].join("\n");
  const report = failureReport(long, { tailLines: 5 });
  assert.match(report, /FAIL {2}src\/app\/App\.test\.tsx/, "an app failure far from the end is kept");
  assert.match(report, /after 99$/);
  assert.doesNotMatch(report, /line 10\n/);
});

test("the command line always runs: --list prints every step", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "dev-check-cli.mjs"), "--list"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const listed = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(" ")[0]);
  assert.deepEqual(
    listed,
    DEV_CHECK_STEPS.map((step) => step.id)
  );
});
