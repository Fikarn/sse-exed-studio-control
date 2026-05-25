import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Thin wrapper that invokes the `visual-review.spec.ts` Playwright spec so
// `npm run tauri:visual:review` keeps working. The actual capture matrix
// (5 fixtures × 6 viewports + Scaled Studio Preview across the operator
// surfaces) plus responsive assertions live in
// `frontend/app/tests/visual-review.spec.ts`; baselines land under
// `frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/`, and the
// PR diff gate runs in CI via `.github/workflows/dev-checks.yml`.
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
// template inside the spec is either `<fixture>-<WxH>` for the main grid or
// `<fixture>-studio-preview-<WxH>` for Scaled Studio Preview, and the
// `playwright.config.ts` snapshotPathTemplate appends `-<platform>.png`.
function parseBaselineFilename(filename) {
  const match = filename.match(/^(.+?)-(darwin|linux|win32)\.png$/);
  if (!match) return null;
  const [, arg, platform] = match;
  const studioPreview = arg.match(/^(.+)-studio-preview-(\d+x\d+)$/);
  if (studioPreview) {
    return {
      arg,
      fixture: studioPreview[1],
      filename,
      platform,
      surface: "studioPreview",
      viewport: studioPreview[2],
    };
  }
  const main = arg.match(/^(.+)-(\d+x\d+)$/);
  if (!main) return null;
  return {
    arg,
    fixture: main[1],
    filename,
    platform,
    surface: "operator",
    viewport: main[2],
  };
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
  const studioPreviewFixtures = new Set();
  const totalBaselineSnapshots = {};
  for (const baseline of baselines) {
    fixtures.add(baseline.fixture);
    viewports.add(baseline.viewport);
    if (baseline.surface === "studioPreview") {
      studioPreviewFixtures.add(baseline.fixture);
    }
    totalBaselineSnapshots[baseline.platform] = (totalBaselineSnapshots[baseline.platform] ?? 0) + 1;
  }

  return {
    baselines,
    coverage: {
      fixtures: [...fixtures].sort(),
      studioPreviewFixtures: [...studioPreviewFixtures].sort(),
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
  note: "Playwright `toHaveScreenshot` owns per-fixture diffs. `coverage` + `baselines` reflect what is committed at this commit; per-PR diff status lives in the Playwright HTML report uploaded by the frontend-e2e CI job.",
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
