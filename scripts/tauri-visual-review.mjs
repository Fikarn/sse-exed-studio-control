import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Thin wrapper that invokes the `visual-review.spec.ts` Playwright spec so
// `npm run tauri:visual:review` keeps working. The actual capture matrix
// (5 fixtures × 6 viewports + Studio Preview audio capture) plus responsive
// assertions live in `frontend/app/tests/visual-review.spec.ts`; baselines
// land under `frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/`
// and the PR diff gate runs in CI via `.github/workflows/dev-checks.yml`.

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const summaryDir = path.join(rootDir, "artifacts/visual/tauri-cutover");

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

run(npmCommand, ["run", "build", "--workspace", "frontend/app"]);
run(npmCommand, ["run", "playwright:test", "--workspace", "frontend/app", "--", "visual-review.spec.ts"]);

mkdirSync(summaryDir, { recursive: true });
writeFileSync(
  path.join(summaryDir, "fixture-viewport-summary.json"),
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      githubSha: resolveGitSha(),
      platform: process.platform,
      baselinesDir: "frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/",
      playwrightReport: "frontend/app/playwright-report/index.html",
      note: "Playwright `toHaveScreenshot` owns per-fixture diffs (see playwright-report/). The richer summary shape returns in plan PR 11 (workstream A3).",
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      baselinesDir: "frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/",
      playwrightReport: "frontend/app/playwright-report/index.html",
      summary: path.join(summaryDir, "fixture-viewport-summary.json"),
    },
    null,
    2
  )
);
