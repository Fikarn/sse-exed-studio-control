// check-npm-audit.mjs — the npm half of the supply-chain gate (production
// readiness 2026-09, Slice 12 — finding F17).
//
//   node scripts/check-npm-audit.mjs [--scope=prod|all] [--report=FILE] [--allowlist=FILE]
//
// Every lockfile in the repository is audited, each scope with its own bar:
//
//   prod   `npm audit --omit=dev`       what ships inside the app     fails from moderate
//   all    `npm audit`                  what builds, lints and tests  fails from high
//   tools  `npm audit` in tools/sbom    the SBOM generator            fails from high
//
// The second scope exists because this repository's build tools run on the
// studio workstation and on the runner that builds the release bundles, and
// because every alert GitHub shows for it is in that tree: a gate that read
// the shipped tree alone would say "0" beside a high alert.
//
// An advisory at or above its scope's bar fails unless
// `scripts/npm-audit-allowlist.json` names it — by advisory id and package —
// with a reason and an expiry date (`scripts/supply-chain-expiry.mjs` holds the
// date rule). An expired or malformed entry fails by itself and allows nothing.
// A report that is not an npm audit report (offline, registry error) is a
// failure to run, exit 2 — never a pass.
//
// `--report` reads a recorded `npm audit --json` report instead of running npm;
// it needs `--scope`, and is how the tests stay off the network.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { MAX_EXCEPTION_DAYS, expiryProblem, utcToday } from "./supply-chain-expiry.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ALLOWLIST = path.join(REPO, "scripts", "npm-audit-allowlist.json");

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const ADVISORY_ID = /^(GHSA(-[0-9a-z]{4}){3}|npm:\d+)$/;
const MIN_REASON_LENGTH = 20;

export const SCOPES = {
  prod: {
    title: "what ships (npm audit --omit=dev)",
    npmArgs: ["audit", "--omit=dev", "--json"],
    failFrom: "moderate",
  },
  all: { title: "what builds and tests it (npm audit)", npmArgs: ["audit", "--json"], failFrom: "high" },
  tools: {
    title: "the SBOM generator (npm audit in tools/sbom)",
    npmArgs: ["audit", "--json"],
    cwd: "tools/sbom",
    failFrom: "high",
  },
};

export class AuditReportError extends Error {}

// A severity this script does not know is ranked above critical: a new word
// from the registry must not read as "below the bar".
function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  return rank === -1 ? SEVERITIES.length : rank;
}

// The GitHub advisory id from the advisory's URL; npm's own numeric id when the
// URL carries none.
function advisoryId(via) {
  const ghsa = /GHSA((?:-[0-9a-z]{4}){3})/i.exec(via.url ?? "");
  return ghsa ? `GHSA${ghsa[1].toLowerCase()}` : `npm:${via.source}`;
}

/**
 * The distinct advisories of an `npm audit --json` report (version 2). A `via`
 * that is a bare name points at another package's entry, which carries the
 * advisory itself, so only the object form is read.
 */
export function collectAdvisories(report) {
  if (
    !report ||
    report.auditReportVersion !== 2 ||
    typeof report.vulnerabilities !== "object" ||
    report.vulnerabilities === null
  ) {
    const detail = report?.error?.summary || report?.error?.code || report?.message;
    throw new AuditReportError(`not an npm audit report (auditReportVersion 2)${detail ? `: ${detail}` : ""}`);
  }

  const advisories = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    for (const via of entry?.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const advisory = {
        id: advisoryId(via),
        package: via.name ?? name,
        severity: via.severity ?? entry.severity ?? "unknown",
        title: via.title ?? "",
        url: via.url ?? "",
      };
      advisories.set(`${advisory.id}|${advisory.package}`, advisory);
    }
  }
  return [...advisories.values()].sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.package.localeCompare(b.package) ||
      a.id.localeCompare(b.id)
  );
}

/** What is wrong with the allowlist file on `today`; an empty list when nothing is. */
export function allowlistProblems(allowlist, today) {
  if (!allowlist || typeof allowlist !== "object" || !Array.isArray(allowlist.entries)) {
    return ['the allowlist must be an object with an "entries" array'];
  }

  const problems = [];
  const seen = new Set();
  allowlist.entries.forEach((entry, index) => {
    const label = `entry ${index + 1}${entry?.id ? ` (${entry.id} · ${entry.package})` : ""}`;
    const problem = entryProblem(entry, today);
    if (problem) {
      problems.push(`${label}: ${problem}`);
      return;
    }
    const key = `${entry.id}|${entry.package}`;
    if (seen.has(key)) {
      problems.push(`${label}: listed twice`);
    }
    seen.add(key);
  });
  return problems;
}

function entryProblem(entry, today) {
  if (!entry || typeof entry !== "object") {
    return "not an object";
  }
  if (typeof entry.id !== "string" || !ADVISORY_ID.test(entry.id)) {
    return `"id" must be a GHSA-xxxx-xxxx-xxxx advisory id (or npm:<number>), got ${JSON.stringify(entry.id)}`;
  }
  if (typeof entry.package !== "string" || entry.package.trim() === "") {
    return '"package" must name the package the advisory is on';
  }
  if (typeof entry.reason !== "string" || entry.reason.trim().length < MIN_REASON_LENGTH) {
    return `"reason" must say why the advisory is accepted (at least ${MIN_REASON_LENGTH} characters)`;
  }
  return expiryProblem(entry.expires, today);
}

/**
 * Judge one report against the allowlist. `failFrom` is the lowest severity
 * that fails. Entries that have a problem allow nothing, so an expired entry
 * shows up twice: as a problem, and as the advisory it no longer covers.
 */
export function evaluateAudit(report, allowlist, { failFrom, today }) {
  if (!SEVERITIES.includes(failFrom)) {
    throw new Error(`failFrom must be one of ${SEVERITIES.join(", ")}`);
  }
  const bar = severityRank(failFrom);
  const problems = allowlistProblems(allowlist, today);
  const validEntries = Array.isArray(allowlist?.entries)
    ? allowlist.entries.filter((entry) => entryProblem(entry, today) === null)
    : [];

  const failures = [];
  const allowed = [];
  const belowBar = [];
  for (const advisory of collectAdvisories(report)) {
    if (severityRank(advisory.severity) < bar) {
      belowBar.push(advisory);
      continue;
    }
    const entry = validEntries.find(
      (candidate) => candidate.id === advisory.id && candidate.package === advisory.package
    );
    if (entry) {
      allowed.push({ ...advisory, reason: entry.reason, expires: entry.expires });
    } else {
      failures.push(advisory);
    }
  }

  return { failures, allowed, belowBar, problems, ok: failures.length === 0 && problems.length === 0 };
}

function runNpmAudit(scope) {
  const { npmArgs: args, cwd: scopeDir = "." } = SCOPES[scope];
  const cwd = path.join(REPO, scopeDir);
  // Windows: npm is npm.cmd, which Node refuses to spawn without a shell
  // (CVE-2024-27980 hardening). The arguments are the fixed literals above.
  const result =
    process.platform === "win32"
      ? spawnSync(`npm ${args.join(" ")}`, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true })
      : spawnSync("npm", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    throw new AuditReportError(`npm could not be started: ${result.error.message}`);
  }
  // `npm audit` exits 1 whenever it found anything; the report decides, not the exit code.
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AuditReportError(
      `npm audit printed no JSON report: ${(result.stderr || result.stdout || "").trim().slice(0, 400)}`
    );
  }
}

function readJson(file, what) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new AuditReportError(`${what} ${file} could not be read: ${error.message}`, { cause: error });
  }
}

function countBySeverity(advisories) {
  const counts = {};
  for (const advisory of advisories) counts[advisory.severity] = (counts[advisory.severity] ?? 0) + 1;
  return SEVERITIES.toReversed()
    .filter((severity) => counts[severity])
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");
}

function describe(advisory) {
  return `${advisory.severity.padEnd(8)} ${advisory.package}  ${advisory.id}  ${advisory.title}`;
}

function main(argv) {
  const flags = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [name, ...rest] = arg.slice(2).split("=");
        return [name, rest.join("=")];
      })
  );
  if (flags.scope !== undefined && !Object.hasOwn(SCOPES, flags.scope)) {
    throw new AuditReportError(`--scope must be one of ${Object.keys(SCOPES).join(", ")}`);
  }
  if (flags.report !== undefined && flags.scope === undefined) {
    throw new AuditReportError("--report needs --scope: a recorded report belongs to one scope");
  }

  const today = utcToday();
  const allowlistPath = flags.allowlist ? path.resolve(flags.allowlist) : DEFAULT_ALLOWLIST;
  const allowlist = readJson(allowlistPath, "the allowlist");
  const scopes = flags.scope ? [flags.scope] : Object.keys(SCOPES);

  let ok = true;
  const used = new Set();
  let problems = [];
  for (const scope of scopes) {
    const { title, failFrom } = SCOPES[scope];
    const report = flags.report ? readJson(path.resolve(flags.report), "the recorded report") : runNpmAudit(scope);
    const result = evaluateAudit(report, allowlist, { failFrom, today });
    ok &&= result.ok;
    problems = result.problems;

    console.log(`\nnpm audit · ${title} · fails from ${failFrom}`);
    for (const advisory of result.failures) console.log(`  FAIL     ${describe(advisory)}\n           ${advisory.url}`);
    for (const advisory of result.allowed) {
      used.add(`${advisory.id}|${advisory.package}`);
      console.log(`  allowed  ${describe(advisory)}\n           until ${advisory.expires}: ${advisory.reason}`);
    }
    if (result.belowBar.length > 0) console.log(`  below the bar, not gating: ${countBySeverity(result.belowBar)}`);
    if (result.failures.length + result.allowed.length + result.belowBar.length === 0) console.log("  no advisories");
  }

  for (const problem of problems) console.log(`\nallowlist: ${problem}`);
  if (scopes.length === Object.keys(SCOPES).length && problems.length === 0) {
    for (const entry of allowlist.entries) {
      if (!used.has(`${entry.id}|${entry.package}`)) {
        console.log(`\nallowlist: ${entry.id} · ${entry.package} allows nothing any more — remove the entry`);
      }
    }
  }

  if (!ok) {
    console.error(
      `\nnpm audit gate failed (${today}). Take the fix (npm update <package>, or bump what depends on it); only when there is none, add an entry to ${path.relative(REPO, allowlistPath).split(path.sep).join("/")} with a reason and an expiry date at most ${MAX_EXCEPTION_DAYS} days out.`
    );
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof AuditReportError)) throw error;
    console.error(`npm audit gate could not run: ${error.message}`);
    process.exit(2);
  }
}
