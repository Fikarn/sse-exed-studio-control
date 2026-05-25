import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// plan PR 9 / workstream F2: rescope-protocol nudge.
//
// Lint-staged calls this with a list of staged `docs/plans/**.md` files.
// If a `## Slice N — …` title line is being changed (added, removed, or
// edited) in any of them, the file must contain at least one
// `**Rescope:**` paragraph somewhere — that's the AGENTS.md rescope
// protocol's audit trail.
//
// This is INTENTIONALLY soft: it doesn't validate the content of the
// Rescope paragraph, only its presence. The protocol still relies on the
// author writing something meaningful — this script just makes the silent
// substitution that the Phase 3 Slice 4 / Slice 6 case study warned about
// HARDER to do accidentally.

const args = process.argv.slice(2);
if (args.length === 0) {
  process.exit(0);
}

const planFiles = args
  .map((arg) => path.resolve(arg))
  .filter((absolute) => {
    if (!absolute.includes(`${path.sep}docs${path.sep}plans${path.sep}`)) {
      return false;
    }
    if (!absolute.endsWith(".md")) {
      return false;
    }
    return existsSync(absolute);
  });

if (planFiles.length === 0) {
  process.exit(0);
}

const SLICE_TITLE_REGEX = /^##\s+Slice\s+\d/;
const RESCOPE_REGEX = /\*\*Rescope:\*\*/;

const failures = [];

for (const file of planFiles) {
  const relative = path.relative(process.cwd(), file);
  const diff = spawnSync("git", ["diff", "--cached", "--unified=0", "--", file], {
    encoding: "utf8",
  });
  if (diff.status !== 0) {
    // Not staged or git not available — nothing to nudge against.
    continue;
  }
  const diffOutput = diff.stdout ?? "";
  const changedSliceTitles = diffOutput
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .filter((line) => !line.startsWith("+++") && !line.startsWith("---"))
    .map((line) => line.slice(1))
    .filter((line) => SLICE_TITLE_REGEX.test(line));

  if (changedSliceTitles.length === 0) {
    continue;
  }

  const contents = readFileSync(file, "utf8");
  if (!RESCOPE_REGEX.test(contents)) {
    failures.push({ relative, changedSliceTitles });
  }
}

if (failures.length === 0) {
  process.exit(0);
}

for (const failure of failures) {
  console.error(`\n${failure.relative}`);
  console.error("  changed slice title(s):");
  for (const line of failure.changedSliceTitles) {
    console.error(`    ${line.trim()}`);
  }
  console.error(
    "  → No `**Rescope:**` paragraph found in this file. Per AGENTS.md's rescope protocol, when a slice's premise changes you must record the rescope reason in the plan doc rather than silently substituting different work under the same slice name. Add a `**Rescope:** <reason>` paragraph (anywhere in the file) before committing."
  );
}

process.exit(1);
