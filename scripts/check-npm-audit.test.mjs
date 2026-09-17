import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AuditReportError, SCOPES, allowlistProblems, collectAdvisories, evaluateAudit } from "./check-npm-audit.mjs";
import { MAX_EXCEPTION_DAYS, expiryProblem, utcToday } from "./supply-chain-expiry.mjs";

// Production readiness 2026-09, Slice 12 (finding F17) — the npm audit gate.
// Nothing here reaches the registry: the reports are the two `npm audit --json`
// outputs recorded on the workstation on 2026-09-17, before the slice took any
// fix — the full tree with its nine findings (two high, both in the lint
// chain) and the shipped tree, which was clean.

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(scriptsDir, "check-npm-audit.mjs");
const fixture = (name) => path.join(scriptsDir, "fixtures", "npm-audit", name);
const recordedAll = JSON.parse(readFileSync(fixture("recorded-2026-09-17-all.json"), "utf8"));
const recordedProd = JSON.parse(readFileSync(fixture("recorded-2026-09-17-prod.json"), "utf8"));

const TODAY = "2026-09-17";
const entry = (overrides = {}) => ({
  id: "GHSA-mh99-v99m-4gvg",
  package: "brace-expansion",
  reason: "Lint chain only: eslint expands its own glob patterns, never outside input.",
  expires: "2026-10-31",
  ...overrides,
});
const BRACE_IDS = ["GHSA-mh99-v99m-4gvg", "GHSA-rgw5-rvv9-x895"];
const BROWSERSLIST_IDS = ["GHSA-73wf-gq98-2v4g", "GHSA-c83g-rgw3-j3cx"];
const allHighsAllowed = {
  entries: [
    ...BRACE_IDS.map((id) => entry({ id })),
    ...BROWSERSLIST_IDS.map((id) => entry({ id, package: "browserslist" })),
  ],
};

test("reads the distinct advisories out of a recorded report, worst first", () => {
  const advisories = collectAdvisories(recordedAll);
  // Nine vulnerable packages, but `vitest` and `@vitest/coverage-v8` only
  // point at each other and at the one advisory `@vitest/mocker` and `vitest`
  // carry, so the advisories are counted, not the packages.
  assert.equal(advisories.length, 11);
  assert.deepEqual(
    advisories
      .filter((advisory) => advisory.severity === "high")
      .map((advisory) => `${advisory.package} ${advisory.id}`),
    [
      "brace-expansion GHSA-mh99-v99m-4gvg",
      "brace-expansion GHSA-rgw5-rvv9-x895",
      "browserslist GHSA-73wf-gq98-2v4g",
      "browserslist GHSA-c83g-rgw3-j3cx",
    ]
  );
  assert.equal(advisories[0].severity, "high");
  assert.equal(advisories.at(-1).severity, "low");
  assert.deepEqual(collectAdvisories(recordedProd), []);
});

test("an unlisted high fails the full tree; the same report passes once every high is listed", () => {
  const bare = evaluateAudit(recordedAll, { entries: [] }, { failFrom: SCOPES.all.failFrom, today: TODAY });
  assert.equal(bare.ok, false);
  assert.equal(bare.failures.length, 4);
  assert.equal(bare.belowBar.length, 7);

  const listed = evaluateAudit(recordedAll, allHighsAllowed, { failFrom: SCOPES.all.failFrom, today: TODAY });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.failures, []);
  assert.equal(listed.allowed.length, 4);
  assert.equal(listed.allowed[0].expires, "2026-10-31");

  // One of the four left out is enough to fail, and it is named.
  const oneMissing = { entries: allHighsAllowed.entries.slice(1) };
  const partial = evaluateAudit(recordedAll, oneMissing, { failFrom: "high", today: TODAY });
  assert.equal(partial.ok, false);
  assert.deepEqual(
    partial.failures.map((advisory) => advisory.id),
    ["GHSA-mh99-v99m-4gvg"]
  );
});

test("the shipped tree fails from moderate, the full tree from high", () => {
  assert.equal(SCOPES.prod.failFrom, "moderate");
  assert.equal(SCOPES.all.failFrom, "high");
  assert.ok(SCOPES.prod.npmArgs.includes("--omit=dev"));
  assert.ok(!SCOPES.all.npmArgs.includes("--omit=dev"));
  // Every lockfile in the repository has a scope: the root's two, and the SBOM generator's own.
  assert.deepEqual(Object.keys(SCOPES), ["prod", "all", "tools"]);
  assert.equal(SCOPES.tools.cwd, "tools/sbom");
  assert.equal(SCOPES.tools.failFrom, "high");
  assert.ok(existsSync(path.join(scriptsDir, "..", SCOPES.tools.cwd, "package-lock.json")));

  // The recorded full report judged at the shipped tree's bar: the five
  // moderates fail too.
  const strict = evaluateAudit(recordedAll, allHighsAllowed, { failFrom: "moderate", today: TODAY });
  assert.equal(strict.ok, false);
  assert.equal(strict.failures.length, 5);
  assert.ok(strict.failures.every((advisory) => advisory.severity === "moderate"));
  assert.equal(strict.belowBar.length, 2);

  assert.equal(evaluateAudit(recordedProd, { entries: [] }, { failFrom: "moderate", today: TODAY }).ok, true);
});

test("an expired entry fails by itself and no longer covers its advisory", () => {
  const expired = {
    entries: allHighsAllowed.entries.map((item, index) => (index === 0 ? { ...item, expires: "2026-09-16" } : item)),
  };
  const result = evaluateAudit(recordedAll, expired, { failFrom: "high", today: TODAY });
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /GHSA-mh99-v99m-4gvg.*expired on 2026-09-16/);
  assert.deepEqual(
    result.failures.map((advisory) => advisory.id),
    ["GHSA-mh99-v99m-4gvg"]
  );

  // Expired with nothing left to cover is still a failure: the list is kept clean.
  const stale = evaluateAudit(
    recordedProd,
    { entries: [entry({ expires: "2026-09-16" })] },
    { failFrom: "moderate", today: TODAY }
  );
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.failures, []);

  // The expiry day itself still counts.
  assert.equal(
    evaluateAudit(recordedProd, { entries: [entry({ expires: TODAY })] }, { failFrom: "moderate", today: TODAY }).ok,
    true
  );
});

test("the date rule: a real day, not passed, and not further out than the cap", () => {
  assert.equal(MAX_EXCEPTION_DAYS, 90);
  assert.equal(expiryProblem("2026-12-16", TODAY), null); // day 90
  assert.match(expiryProblem("2026-12-17", TODAY), /91 days out.*at most 90/);
  assert.match(expiryProblem("2099-01-01", TODAY), /at most 90/);
  assert.match(expiryProblem("2026-09-16", TODAY), /expired on 2026-09-16/);
  for (const notADay of ["2026-02-31", "2026-13-01", "soon", "2026-9-17", "", undefined, null, 20260917]) {
    assert.match(expiryProblem(notADay, TODAY), /not a YYYY-MM-DD calendar day/, String(notADay));
  }
  assert.throws(() => expiryProblem("2026-10-01", "today"), /today must be/);
  assert.equal(utcToday(new Date("2026-09-17T23:30:00+02:00")), "2026-09-17");
  assert.equal(utcToday(new Date("2026-09-18T01:30:00+02:00")), "2026-09-17");
});

test("an entry needs an advisory id, a package, a reason worth reading and a date", () => {
  assert.deepEqual(allowlistProblems({ entries: [entry()] }, TODAY), []);
  assert.deepEqual(allowlistProblems({ entries: [] }, TODAY), []);

  const broken = [
    [entry({ id: "brace-expansion" }), /"id" must be a GHSA/],
    [entry({ id: undefined }), /"id" must be a GHSA/],
    [entry({ package: " " }), /"package" must name/],
    [entry({ reason: "tmp" }), /"reason" must say why/],
    [entry({ reason: undefined }), /"reason" must say why/],
    [entry({ expires: undefined }), /not a YYYY-MM-DD calendar day/],
    ["GHSA-mh99-v99m-4gvg", /not an object/],
  ];
  for (const [item, expected] of broken) {
    const problems = allowlistProblems({ entries: [item] }, TODAY);
    assert.equal(problems.length, 1, JSON.stringify(item));
    assert.match(problems[0], expected);
    // …and a broken entry allows nothing.
    assert.equal(
      evaluateAudit(recordedAll, { entries: [item] }, { failFrom: "high", today: TODAY }).failures.length,
      4
    );
  }

  assert.match(allowlistProblems({ entries: [entry(), entry()] }, TODAY)[0], /listed twice/);
  assert.equal(allowlistProblems({ entries: [entry({ id: "npm:1130591" })] }, TODAY).length, 0);
  for (const notAList of [null, [], {}, { entries: "none" }]) {
    assert.match(allowlistProblems(notAList, TODAY)[0], /"entries" array/);
  }
});

test("an entry covers its own package only", () => {
  const wrongPackage = { entries: BRACE_IDS.map((id) => entry({ id, package: "minimatch" })) };
  const result = evaluateAudit(recordedAll, wrongPackage, { failFrom: "high", today: TODAY });
  assert.equal(result.failures.length, 4);
  assert.deepEqual(result.allowed, []);
});

test("something that is not an audit report is an error, never a pass", () => {
  const registryDown = { error: { code: "ENOTFOUND", summary: "request to https://registry.npmjs.org failed" } };
  assert.throws(
    () => collectAdvisories(registryDown),
    (error) => error instanceof AuditReportError && /ENOTFOUND|registry/.test(error.message)
  );
  for (const notAReport of [
    null,
    {},
    { auditReportVersion: 1, advisories: {} },
    { auditReportVersion: 2 },
    { auditReportVersion: 2, vulnerabilities: null },
  ]) {
    assert.throws(
      () => evaluateAudit(notAReport, { entries: [] }, { failFrom: "high", today: TODAY }),
      AuditReportError
    );
  }
  assert.throws(
    () => evaluateAudit(recordedProd, { entries: [] }, { failFrom: "severe", today: TODAY }),
    /failFrom must be one of/
  );
});

test("a severity the script does not know fails at every bar", () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      leftpad: {
        severity: "catastrophic",
        via: [{ source: 1, name: "leftpad", severity: "catastrophic", title: "new word", url: "" }],
      },
    },
  };
  const result = evaluateAudit(report, { entries: [] }, { failFrom: "critical", today: TODAY });
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].id, "npm:1");
});

// The command line, on recorded reports only (`--report` keeps npm out of it).
function runGate(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
}

function writeAllowlist(entries) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "sse-npm-audit-")), "allowlist.json");
  writeFileSync(file, JSON.stringify({ entries }), "utf8");
  return file;
}

test("exit 0 on a clean recorded report, exit 1 naming the advisory on an unlisted high", () => {
  const clean = runGate(
    "--scope=prod",
    `--report=${fixture("recorded-2026-09-17-prod.json")}`,
    `--allowlist=${writeAllowlist([])}`
  );
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /what ships .*fails from moderate/);
  assert.match(clean.stdout, /no advisories/);

  const red = runGate(
    "--scope=all",
    `--report=${fixture("recorded-2026-09-17-all.json")}`,
    `--allowlist=${writeAllowlist([])}`
  );
  assert.equal(red.status, 1);
  assert.match(red.stdout, /FAIL\s+high\s+brace-expansion\s+GHSA-mh99-v99m-4gvg/);
  assert.match(red.stdout, /FAIL\s+high\s+browserslist\s+GHSA-73wf-gq98-2v4g/);
  assert.match(red.stdout, /below the bar, not gating: 5 moderate, 2 low/);
  assert.match(red.stderr, /Take the fix .*at most 90 days out/);
});

test("exit 1 on an entry that expired years ago, even with nothing to cover", () => {
  const result = runGate(
    "--scope=prod",
    `--report=${fixture("recorded-2026-09-17-prod.json")}`,
    `--allowlist=${writeAllowlist([entry({ expires: "2020-01-01" })])}`
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /allowlist: entry 1 \(GHSA-mh99-v99m-4gvg · brace-expansion\): expired on 2020-01-01/);
});

test("exit 2 when the gate cannot run: a report that is not one, a missing allowlist, a bad flag", () => {
  const notAReport = path.join(mkdtempSync(path.join(tmpdir(), "sse-npm-audit-")), "report.json");
  writeFileSync(notAReport, JSON.stringify({ error: { code: "ENOTFOUND", summary: "registry unreachable" } }), "utf8");
  const offline = runGate("--scope=all", `--report=${notAReport}`, `--allowlist=${writeAllowlist([])}`);
  assert.equal(offline.status, 2);
  assert.match(offline.stderr, /could not run: not an npm audit report.*registry unreachable/);

  const missing = runGate(
    "--scope=prod",
    `--report=${fixture("recorded-2026-09-17-prod.json")}`,
    "--allowlist=does-not-exist.json"
  );
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /the allowlist .*could not be read/);

  assert.equal(runGate("--scope=everything").status, 2);
  const reportWithoutScope = runGate(`--report=${fixture("recorded-2026-09-17-prod.json")}`);
  assert.equal(reportWithoutScope.status, 2);
  assert.match(reportWithoutScope.stderr, /--report needs --scope/);
});

test("the committed allowlist is valid today", () => {
  const committed = JSON.parse(readFileSync(path.join(scriptsDir, "npm-audit-allowlist.json"), "utf8"));
  assert.ok(Array.isArray(committed.entries));
  // Shape only. Whether an entry has expired is the gate's to say, in the
  // `supply-chain` job — a date must not turn `scripts:test` red by itself.
  for (const item of committed.entries) {
    assert.deepEqual(
      allowlistProblems({ entries: [{ ...item, expires: utcToday() }] }, utcToday()),
      [],
      JSON.stringify(item)
    );
  }
});
