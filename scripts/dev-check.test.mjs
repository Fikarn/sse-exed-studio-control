import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { DEV_CHECK_STEPS, runSteps } from "./dev-check.mjs";

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

test("independent steps run side by side, and a step waits for the steps it names", async () => {
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

test("a failure skips what waits for it, and every other step still runs", async () => {
  const { events, runStep } = recorder({ a: false });
  const status = await runSteps(
    [{ id: "a" }, { id: "b", after: ["a"] }, { id: "c", after: ["b"] }, { id: "x" }],
    runStep
  );
  assert.deepEqual(Object.fromEntries(status), { a: "failed", b: "skipped", c: "skipped", x: "passed" });
  assert.ok(!events.includes("start b") && !events.includes("start c"));
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
  assert.equal(scripts["dev:check"], "node scripts/dev-check.mjs");
  const serial = scripts["dev:check:serial"].split(" && ").map((part) => part.replace(/^npm run /, ""));
  assert.deepEqual([...serial].sort(), DEV_CHECK_STEPS.map((step) => step.id).sort());
  // The serial order honours every `after`.
  for (const step of DEV_CHECK_STEPS) {
    for (const prerequisite of step.after ?? []) {
      assert.ok(serial.indexOf(prerequisite) < serial.indexOf(step.id), `${prerequisite} before ${step.id}`);
    }
  }
});

test("the cargo steps form one chain: protocol:check, clippy, the tests", () => {
  const byId = Object.fromEntries(DEV_CHECK_STEPS.map((step) => [step.id, step]));
  assert.deepEqual(byId["rust:clippy"].after, ["protocol:check"]);
  assert.deepEqual(byId["native:test"].after, ["rust:clippy"]);
  for (const reader of ["format:check", "frontend:typecheck"]) {
    assert.ok(byId[reader].after.includes("protocol:check"), `${reader} waits for protocol:check's staging folder`);
  }
});
