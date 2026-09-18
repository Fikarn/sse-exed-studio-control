// check-playwright-quarantine.mjs — the Playwright quarantine list keeps its
// promises (production readiness 2026-09, Slice 13 — findings F25, F03).
//
//   node scripts/check-playwright-quarantine.mjs [--list=FILE] [--tests=DIR] [--no-date]
//
// `frontend/app/tests/quarantine.json` is the membership of Playwright's
// `quarantine` project: `playwright.config.ts` builds that project's `grep`
// (and the `default` project's `grepInvert`) from it, and the `frontend-e2e`
// CI job fails on `default` alone. A case on the list has therefore stopped
// blocking anything, so the list is held to four rules:
//
// - every entry says why the case is there and where it was seen, and names
//   exactly one test that exists — an entry that matches nothing is stale, and
//   one that matches two has widened by accident;
// - the visual and contract gates can never be listed (GATE_SPECS), and the
//   list can never grow past MAX_QUARANTINED_CASES: quarantine is for a handful
//   of wall-clock measurements, not a place to park a red suite;
// - the list has one exit date, a real calendar day at most MAX_EXCEPTION_DAYS
//   out (`scripts/supply-chain-expiry.mjs`, the rule the supply-chain
//   exceptions follow);
// - once that day has passed the check fails until the cases are back in the
//   default project or deleted, or the date is moved with the reasons restated.
//
// The date is judged against today, so — like the supply-chain gates — it is
// judged on CI only. `scripts:test` and `dev:check` run everything else through
// `quarantineProblems(..., { today: null })` and cannot change their answer
// overnight.
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { MAX_EXCEPTION_DAYS, expiryProblem, utcToday } from "./supply-chain-expiry.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TESTS_DIR = path.join(REPO, "frontend", "app", "tests");
const DEFAULT_LIST = path.join(DEFAULT_TESTS_DIR, "quarantine.json");

export const MAX_QUARANTINED_CASES = 6;
/** Specs that are gates in themselves: a listed case here would mute the gate. */
export const GATE_SPECS = ["visual-review.spec.ts", "storybook.spec.ts", "ui-contract.spec.ts"];

const SPEC_FILE = /^[A-Za-z0-9._-]+\.spec\.ts$/;
const MIN_REASON_LENGTH = 40;
const MIN_SEEN_LENGTH = 20;

const isText = (value, minLength) => typeof value === "string" && value.trim().length >= minLength;

/**
 * How many tests in `source` carry exactly this title. A title is written as
 * the first argument of `test(` in one of the three quote styles; a title built
 * at run time cannot be listed, which is deliberate.
 */
export function countTitle(source, title) {
  let count = 0;
  for (const quote of ['"', "'", "`"]) {
    if (title.includes(quote) || title.includes("\\")) continue;
    const needle = `test(${quote}${title}${quote}`;
    let at = source.indexOf(needle);
    while (at !== -1) {
      // `test(` must start the call: not `mytest(` and not `test.skip(`.
      const before = at === 0 ? "" : source[at - 1];
      if (!/[A-Za-z0-9_.$]/.test(before)) count += 1;
      at = source.indexOf(needle, at + needle.length);
    }
  }
  return count;
}

/**
 * Everything wrong with the list. `readSpec(file)` returns a spec's source or
 * null when there is no such spec. `today` is a YYYY-MM-DD day, or null to
 * leave the exit date's distance from today unjudged (its form is still read).
 */
export function quarantineProblems(listText, readSpec, { today }) {
  let list;
  try {
    list = JSON.parse(listText);
  } catch (error) {
    return [`not readable as JSON: ${error.message}`];
  }
  if (list === null || typeof list !== "object" || Array.isArray(list) || !Array.isArray(list.cases)) {
    return ['the list must be an object with "exit", "rule" and a "cases" array'];
  }

  const problems = [];
  if (!isText(list.rule, MIN_REASON_LENGTH)) problems.push('"rule" must say what belongs on the list');
  if (list.cases.length > MAX_QUARANTINED_CASES) {
    problems.push(
      `${list.cases.length} cases are listed; the quarantine holds at most ${MAX_QUARANTINED_CASES}. Fix the cases — a red suite is not a quarantine.`
    );
  }

  const seen = new Set();
  list.cases.forEach((entry, index) => {
    const where = `cases[${index}]`;
    if (entry === null || typeof entry !== "object") {
      problems.push(`${where}: must be an object with "file", "title", "reason" and "seen"`);
      return;
    }
    const { file, title, reason, seen: seenAt } = entry;
    if (typeof file !== "string" || !SPEC_FILE.test(file)) {
      problems.push(`${where}: "file" must be a spec file name in the tests folder, got ${JSON.stringify(file)}`);
      return;
    }
    if (!isText(title, 1)) {
      problems.push(`${where}: ${file}: "title" is missing`);
      return;
    }
    const name = `${file} › ${title}`;
    if (GATE_SPECS.includes(file)) problems.push(`${name}: ${file} is a gate and can never be quarantined`);
    if (!isText(reason, MIN_REASON_LENGTH)) {
      problems.push(`${name}: "reason" must say why the assertion depends on the runner's speed`);
    }
    if (!isText(seenAt, MIN_SEEN_LENGTH)) problems.push(`${name}: "seen" must say where the failure was observed`);
    if (seen.has(name)) problems.push(`${name}: listed twice`);
    seen.add(name);

    const source = readSpec(file);
    if (source === null) {
      problems.push(`${name}: there is no such spec`);
      return;
    }
    const matches = countTitle(source, title);
    if (matches !== 1) {
      problems.push(`${name}: the title names ${matches} tests in ${file}; an entry must name exactly one`);
    }
  });

  if (list.cases.length === 0) return problems;
  // A far-away "today" reads the date's form without judging its distance.
  const exitProblem =
    today === null ? expiryProblem(list.exit, "0001-01-01", Number.POSITIVE_INFINITY) : expiryProblem(list.exit, today);
  if (exitProblem) problems.push(`"exit": ${exitProblem}`);
  return problems;
}

function flagValue(args, name) {
  const flag = args.find((arg) => arg.startsWith(`--${name}=`));
  return flag ? path.resolve(flag.slice(name.length + 3)) : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--no-date" && !/^--(list|tests)=/.test(arg));
  if (unknown.length > 0) {
    console.error(`unknown option ${unknown.join(" ")}; see the head of this script`);
    process.exit(2);
  }
  const listPath = flagValue(args, "list") ?? DEFAULT_LIST;
  const testsDir = flagValue(args, "tests") ?? DEFAULT_TESTS_DIR;
  let listText;
  try {
    listText = readFileSync(listPath, "utf8");
  } catch (error) {
    // No list is not an empty list: the config reads the same file.
    console.error(`the Playwright quarantine could not be checked: ${listPath}: ${error.message}`);
    process.exit(2);
  }
  const readSpec = (file) => {
    try {
      return readFileSync(path.join(testsDir, file), "utf8");
    } catch {
      return null;
    }
  };

  const today = args.includes("--no-date") ? null : utcToday();
  const problems = quarantineProblems(listText, readSpec, { today });
  if (problems.length === 0) {
    const list = JSON.parse(listText);
    for (const entry of list.cases) console.log(`quarantined  ${entry.file} › ${entry.title}`);
    console.log(
      list.cases.length === 0
        ? "no Playwright case is quarantined"
        : `${list.cases.length} of at most ${MAX_QUARANTINED_CASES}; exit ${list.exit}${today === null ? " (date not judged)" : ""}`
    );
  } else {
    for (const problem of problems) console.error(`quarantine.json ${problem}`);
    console.error(
      `\nthe Playwright quarantine failed its check (${today ?? "date not judged"}). A listed case blocks nothing, so the list has to stay short, explained and dated: make the case independent of the runner's speed and take it off the list, or delete it with the reason written down. Moving the exit date (at most ${MAX_EXCEPTION_DAYS} days out) means restating every reason.`
    );
    process.exit(1);
  }
}
