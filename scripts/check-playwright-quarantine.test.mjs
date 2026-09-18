import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GATE_SPECS, MAX_QUARANTINED_CASES, countTitle, quarantineProblems } from "./check-playwright-quarantine.mjs";

// Production readiness 2026-09, Slice 13 (findings F25, F03) — a quarantined
// Playwright case blocks nothing, so the list that names them is held short,
// explained and dated. No case here judges a date against the real today.

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptsDir, "check-playwright-quarantine.mjs");
const testsDir = path.join(scriptsDir, "..", "frontend", "app", "tests");
const TODAY = "2026-09-18";

const SPECS = {
  "audio.spec.ts": [
    'test("meters move under simulation", async ({ page }) => {});',
    'test("meters move under simulation and stop on mute", async ({ page }) => {});',
    "test('single quoted title', async () => {});",
    'test.skip("a skipped title", async () => {});',
  ].join("\n"),
  "visual-review.spec.ts": 'test("setup-ready", async () => {});',
};
const readSpec = (file) => SPECS[file] ?? null;

const entry = (overrides = {}) => ({
  file: "audio.spec.ts",
  title: "meters move under simulation",
  reason: "Waits 5 s of real time for the simulated meters to read as more than one level.",
  seen: "CI run 34514042594, first attempt, on an overloaded runner.",
  ...overrides,
});
const list = (cases, overrides = {}) =>
  JSON.stringify({
    exit: "2026-10-31",
    rule: "A case belongs here only when what it asserts is a wall-clock measurement.",
    cases,
    ...overrides,
  });
const problemsOf = (text, today = TODAY) => quarantineProblems(text, readSpec, { today });

test("a short, explained, dated list passes", () => {
  assert.deepEqual(problemsOf(list([entry()])), []);
});

test("a title is counted as the first argument of test( in any quote style, and only whole", () => {
  const source = SPECS["audio.spec.ts"];
  assert.equal(countTitle(source, "meters move under simulation"), 1);
  assert.equal(countTitle(source, "single quoted title"), 1);
  assert.equal(countTitle(source, "meters move"), 0);
  assert.equal(countTitle(source, "a skipped title"), 0);
  assert.equal(countTitle('mytest("meters move under simulation")', "meters move under simulation"), 0);
});

test("an entry that names no test, or two, fails", () => {
  assert.match(problemsOf(list([entry({ title: "a title that was renamed" })]))[0], /names 0 tests/);
  const twice = 'test("same", () => {});\ntest("same", () => {});';
  const problems = quarantineProblems(list([entry({ file: "twice.spec.ts", title: "same" })]), () => twice, {
    today: TODAY,
  });
  assert.match(problems[0], /names 2 tests/);
});

test("an entry for a spec that does not exist fails", () => {
  assert.match(problemsOf(list([entry({ file: "gone.spec.ts" })]))[0], /no such spec/);
});

test("a gate can never be quarantined", () => {
  assert.ok(GATE_SPECS.includes("visual-review.spec.ts"));
  const problems = problemsOf(list([entry({ file: "visual-review.spec.ts", title: "setup-ready" })]));
  assert.match(problems[0], /is a gate and can never be quarantined/);
});

test("the list cannot grow into a parking place", () => {
  const many = Array.from({ length: MAX_QUARANTINED_CASES + 1 }, () => entry());
  assert.match(problemsOf(list(many))[0], /holds at most/);
});

test("an entry without a reason, or without where it was seen, fails", () => {
  assert.match(problemsOf(list([entry({ reason: "flaky" })]))[0], /"reason" must say why/);
  assert.match(problemsOf(list([entry({ seen: "" })]))[0], /"seen" must say where/);
});

test("the same case listed twice fails", () => {
  assert.ok(problemsOf(list([entry(), entry()])).some((problem) => /listed twice/.test(problem)));
});

test("a path, or a file that is not a spec, is refused as a file name", () => {
  assert.match(problemsOf(list([entry({ file: "../audio.spec.ts" })]))[0], /"file" must be a spec file name/);
  assert.match(problemsOf(list([entry({ file: "quarantine.json" })]))[0], /"file" must be a spec file name/);
});

test("the exit date fails from the day after it, and may not be set far out", () => {
  assert.deepEqual(problemsOf(list([entry()]), "2026-10-31"), []);
  assert.match(problemsOf(list([entry()]), "2026-11-01")[0], /"exit": expired on 2026-10-31/);
  assert.match(problemsOf(list([entry()], { exit: "2027-06-01" }))[0], /at most 90 days ahead/);
  assert.match(problemsOf(list([entry()], { exit: "soon" }))[0], /not a YYYY-MM-DD calendar day/);
});

test("without a today the date's form is still read, its distance is not", () => {
  const unjudged = (text) => quarantineProblems(text, readSpec, { today: null });
  assert.deepEqual(unjudged(list([entry()], { exit: "2020-01-01" })), []);
  assert.match(unjudged(list([entry()], { exit: "2026-02-31" }))[0], /not a YYYY-MM-DD calendar day/);
});

test("an empty list needs no date", () => {
  assert.deepEqual(problemsOf(list([], { exit: null })), []);
});

test("a list that is not the expected shape fails as a whole", () => {
  assert.match(problemsOf("{ not json")[0], /not readable as JSON/);
  assert.match(problemsOf(JSON.stringify({ cases: "all of them" }))[0], /must be an object/);
  assert.match(problemsOf(list([entry()], { rule: "" }))[0], /"rule" must say/);
});

test("the repository's own list names real tests (date not judged here)", () => {
  const text = readFileSync(path.join(testsDir, "quarantine.json"), "utf8");
  const readRealSpec = (file) => {
    try {
      return readFileSync(path.join(testsDir, file), "utf8");
    } catch {
      return null;
    }
  };
  assert.deepEqual(quarantineProblems(text, readRealSpec, { today: null }), []);
});

test("the command: exit 0 on a good list, 1 on a bad one, 2 when there is no list or an unknown option", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sse-quarantine-"));
  const tests = path.join(root, "tests");
  mkdirSync(tests);
  writeFileSync(path.join(tests, "audio.spec.ts"), SPECS["audio.spec.ts"]);
  const good = path.join(root, "good.json");
  const bad = path.join(root, "bad.json");
  writeFileSync(good, list([entry()], { exit: "2020-01-01" }));
  writeFileSync(bad, list([entry({ title: "renamed away" })]));
  const run = (...args) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });

  const passed = run(`--list=${good}`, `--tests=${tests}`, "--no-date");
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /quarantined {2}audio\.spec\.ts › meters move under simulation/);
  assert.match(passed.stdout, /date not judged/);

  // The same list with its date judged: 2020 has passed whatever today is.
  const expired = run(`--list=${good}`, `--tests=${tests}`);
  assert.equal(expired.status, 1);
  assert.match(expired.stderr, /"exit": expired on 2020-01-01/);

  const failed = run(`--list=${bad}`, `--tests=${tests}`, "--no-date");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /names 0 tests/);

  assert.equal(run(`--list=${path.join(root, "absent.json")}`).status, 2);
  assert.equal(run("--today=2020-01-01").status, 2);
});
