// check-deny-ignores.mjs — the date on every advisory `native/deny.toml`
// ignores (production readiness 2026-09, Slice 12 — finding F17).
//
//   node scripts/check-deny-ignores.mjs [--config=native/deny.toml]
//
// cargo-deny lets an advisory be ignored with a reason but has no notion of
// when the decision should be looked at again, so an `ignore` is a permanent
// mute unless something else keeps time. This does: every entry of
// `[advisories] ignore` must be written on one line as
//
//   { id = "RUSTSEC-0000-0000", reason = "why it is acceptable here. review by YYYY-MM-DD" },
//
// and the date follows the same rule as the npm allowlist's
// (`scripts/supply-chain-expiry.mjs`). The reader is deliberately narrow: a
// line inside the array that it cannot read is a failure, never an entry
// silently skipped.
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { MAX_EXCEPTION_DAYS, expiryProblem, utcToday } from "./supply-chain-expiry.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = path.join(REPO, "native", "deny.toml");

const SECTION = /^\[([^\]]+)\]\s*(#.*)?$/;
const ENTRY = /^\{ (id|crate) = "([^"\\]+)", reason = "((?:[^"\\]|\\.)*)" \},?$/;
const REVIEW_BY = /^(.*\S)\s+review by (\S+?)\.?$/s;
const MIN_REASON_LENGTH = 20;

/**
 * The `[advisories] ignore` entries of a deny.toml, and what is wrong with how
 * they are written. Dates are not judged here.
 */
export function parseDenyIgnores(tomlText) {
  const entries = [];
  const problems = [];
  let section = "";
  let inIgnore = false;

  tomlText.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    const where = `line ${index + 1}`;
    if (inIgnore) {
      if (line === "" || line.startsWith("#")) return;
      if (line === "]") {
        inIgnore = false;
        return;
      }
      const match = ENTRY.exec(line);
      if (!match) {
        problems.push(`${where}: not readable as { id = "…", reason = "… review by YYYY-MM-DD" } on one line: ${line}`);
        return;
      }
      const [, kind, name, fullReason] = match;
      const review = REVIEW_BY.exec(fullReason);
      if (!review) {
        problems.push(`${where}: ${name}: the reason must end with "review by YYYY-MM-DD"`);
        return;
      }
      if (review[1].length < MIN_REASON_LENGTH) {
        problems.push(`${where}: ${name}: the reason must say why the advisory is acceptable here`);
        return;
      }
      entries.push({ kind, name, reason: review[1], reviewBy: review[2], line: index + 1 });
      return;
    }

    const header = SECTION.exec(line);
    if (header) {
      section = header[1];
      return;
    }
    if (section !== "advisories" || !/^ignore\s*=/.test(line)) return;
    const value = line.replace(/^ignore\s*=\s*/, "").replace(/\s+#.*$/, "");
    if (value === "[") {
      inIgnore = true;
    } else if (value !== "[]") {
      problems.push(`${where}: write the ignore list as "ignore = [" with one entry per line, or "ignore = []"`);
    }
  });

  if (inIgnore) problems.push("the ignore list is never closed");
  return { entries, problems };
}

/** Everything wrong with the ignore list on `today`; empty when nothing is. */
export function denyIgnoreProblems(tomlText, today) {
  const { entries, problems } = parseDenyIgnores(tomlText);
  for (const entry of entries) {
    const problem = expiryProblem(entry.reviewBy, today);
    if (problem) problems.push(`line ${entry.line}: ${entry.name}: ${problem}`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configFlag = process.argv.slice(2).find((arg) => arg.startsWith("--config="));
  const configPath = configFlag ? path.resolve(configFlag.slice("--config=".length)) : DEFAULT_CONFIG;
  let tomlText;
  try {
    tomlText = readFileSync(configPath, "utf8");
  } catch (error) {
    console.error(`cargo-deny ignore dates could not be checked: ${configPath}: ${error.message}`);
    process.exit(2);
  }

  const today = utcToday();
  const { entries } = parseDenyIgnores(tomlText);
  for (const entry of entries) console.log(`ignored  ${entry.name}  review by ${entry.reviewBy}`);
  if (entries.length === 0) console.log("no advisory is ignored");

  const problems = denyIgnoreProblems(tomlText, today);
  for (const problem of problems) console.error(`deny.toml ${problem}`);
  if (problems.length > 0) {
    console.error(
      `\ncargo-deny ignore dates failed (${today}). Look at the advisory again: take the upgrade if there is one now, otherwise restate the reason and move the date, at most ${MAX_EXCEPTION_DAYS} days out.`
    );
    process.exit(1);
  }
}
