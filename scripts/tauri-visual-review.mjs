import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Thin wrapper that invokes the `visual-review.spec.ts` Playwright spec so
// `npm run tauri:visual:review` keeps working. The captures (the operator
// surfaces at 2560×1440, in the three themes, and the designed states) and
// their layout checks live in `frontend/app/tests/visual-review.spec.ts`;
// baselines land under
// `frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/`. New pages
// program, Slice SW (D22): they are the win32 captures at 2560×1440 and are
// compared on the Windows workstation only; CI compares none.
//
// plan PR 11 / workstream A3: this wrapper also emits the richer summary
// shape that the release manifest's `visualReview.summaryPath` (see
// `scripts/release/write-release-manifest.mjs`) points at, so a future
// auditor can reconstruct what was covered by visual review for any tagged
// release without needing to re-run Playwright.

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const summaryDir = path.join(rootDir, "artifacts/visual/tauri-cutover");
const baselinesAbs = path.join(rootDir, "frontend/app/tests/__visual__/visual-review.spec.ts-snapshots");
const baselinesRelative = "frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    shell: process.platform === "win32" && /\.(bat|cmd)$/i.test(command),
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

function resolveGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Parse a committed baseline filename into structured coverage info. The arg
// template inside the spec is `<fixture>-<WxH>` (a themed capture's fixture
// carries its theme: `<fixture>-<theme>`), and the `playwright.config.ts`
// snapshotPathTemplate appends `-<platform>.png`. Since Slice SW (D22) the
// platform is win32 and nothing else; any other name is not a baseline.
function parseBaselineFilename(filename) {
  const match = filename.match(/^((.+)-(\d+x\d+))-win32\.png$/);
  if (!match) return null;
  const [, arg, fixture, viewport] = match;
  return { arg, fixture, filename, platform: "win32", viewport };
}

function readBaselineCoverage() {
  let entries;
  try {
    entries = readdirSync(baselinesAbs);
  } catch {
    return { baselines: [], coverage: { fixtures: [], totalBaselineSnapshots: {}, viewports: [] } };
  }
  const baselines = [];
  for (const entry of entries) {
    if (!entry.endsWith(".png")) continue;
    const parsed = parseBaselineFilename(entry);
    if (!parsed) continue;
    baselines.push(parsed);
  }
  baselines.sort((left, right) => left.filename.localeCompare(right.filename));

  const fixtures = new Set();
  const viewports = new Set();
  const totalBaselineSnapshots = {};
  for (const baseline of baselines) {
    fixtures.add(baseline.fixture);
    viewports.add(baseline.viewport);
    totalBaselineSnapshots[baseline.platform] = (totalBaselineSnapshots[baseline.platform] ?? 0) + 1;
  }

  return {
    baselines,
    coverage: {
      fixtures: [...fixtures].sort(),
      totalBaselineSnapshots,
      viewports: [...viewports].sort(),
    },
  };
}

function readReportTimestamp(playwrightReportDir) {
  try {
    const stat = statSync(playwrightReportDir);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

function main() {
  run(npmCommand, ["run", "build", "--workspace", "frontend/app"]);
  run(npmCommand, ["run", "playwright:test", "--workspace", "frontend/app", "--", "visual-review.spec.ts"]);

  mkdirSync(summaryDir, { recursive: true });

  const { baselines, coverage } = readBaselineCoverage();
  const playwrightReport = "frontend/app/playwright-report/index.html";

  const summary = {
    capturedAt: new Date().toISOString(),
    githubSha: resolveGitSha(),
    platform: process.platform,
    playwrightReport,
    playwrightReportGeneratedAt: readReportTimestamp(path.join(rootDir, "frontend/app/playwright-report")),
    baselinesDir: baselinesRelative,
    coverage,
    baselines,
    note: "Playwright `toHaveScreenshot` owns per-fixture diffs. `coverage` + `baselines` reflect what is committed at this commit: the win32 captures at 2560x1440, compared on the Windows workstation only (CI compares none since Slice SW, D22); this run's diff status is in the Playwright HTML report it wrote.",
  };

  const summaryPath = path.join(summaryDir, "fixture-viewport-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        baselineSnapshotCount: baselines.length,
        baselinesDir: baselinesRelative,
        playwrightReport,
        summary: summaryPath,
      },
      null,
      2
    )
  );
}

// Runs only as `node scripts/tauri-visual-review.mjs`: an import does nothing
// (2026-09-26; the run builds the front end, starts the Playwright visual
// review and writes its summary under artifacts/). The two paths are compared
// as real paths — through a directory junction or a short 8.3 name,
// `process.argv[1]` and `import.meta.url` spell the same file differently, and
// a plain comparison would skip the run without a word
// (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  let same = false;
  try {
    same = realpathSync.native(started) === realpathSync.native(self);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  if (!same && path.basename(started) === path.basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  main();
}
