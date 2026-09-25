import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
  delete process.env.NO_COLOR;
}

// Production readiness S13 (findings F25, F03). Two projects share this suite:
//
// - `default` is everything except the quarantine list. It is what the
//   `frontend-e2e` CI job fails on (`npm run frontend:playwright:test:blocking`).
// - `quarantine` is the cases named in `tests/quarantine.json`: assertions that
//   are wall-clock measurements, which a loaded runner can fail with no defect
//   behind the failure. They run one at a time with two retries, and on CI in a
//   step of their own that reports and never fails the job.
//
// The list is the membership — there is no tag to add in a spec — and every
// entry carries its reason, where it was seen and the list's one exit date,
// which `scripts/check-playwright-quarantine.mjs` enforces on CI. A case that
// fails for a reason that can be found is fixed, not listed.
// `npm run frontend:playwright:test` runs both projects, as the workstation
// lane always has. See docs/DEVELOPMENT.md, "Quarantined Playwright cases".
interface QuarantinedCase {
  file: string;
  title: string;
}

// Production readiness S15: `SSE_PLAYWRIGHT_QUARANTINE_LIST` reads another list,
// so scripts/check-playwright-quarantine.test.mjs can list the two projects an
// empty list and a one-case list make.
const quarantined = (
  JSON.parse(
    readFileSync(
      process.env.SSE_PLAYWRIGHT_QUARANTINE_LIST ?? new URL("./tests/quarantine.json", import.meta.url),
      "utf-8"
    )
  ) as {
    cases: QuarantinedCase[];
  }
).cases;

function escapeForRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Playwright matches `grep` against "<project> <file> <describe titles> <title> <tags>".
// An empty list quarantines nothing (S15 emptied it): `new RegExp("")` matches
// every title, which would leave `default` with no case at all and run the
// whole suite as advisory, so the empty list is `(?!)`, which matches nothing.
const QUARANTINE =
  quarantined.length === 0
    ? /(?!)/
    : new RegExp(
        quarantined
          .map((entry) => `(?:^| )${escapeForRegExp(entry.file)} (?:.+ )?${escapeForRegExp(entry.title)}(?: |$)`)
          .join("|")
      );

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Faster checks, 2026-09-25: eight on the studio workstation (32 threads;
  // the full lane 188 s -> about 94 s), at below-normal priority
  // (scripts/frontend/run-playwright.mjs); CI's four-core runner keeps 3.
  workers: process.env.CI ? 3 : 8,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 2560, height: 1440 },
    timezoneId: "Europe/Stockholm",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 100,
      threshold: 0.01,
    },
  },
  // Chromium font + AA rendering differs between macOS (local dev) and Linux
  // (CI), so each platform gets its own committed baseline file. See
  // docs/plans/* "plan PR 1" + frontend/app/tests/__visual__/README.md.
  snapshotPathTemplate: "{testDir}/__visual__/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  reporter: [["html", { outputFolder: "playwright-report" }]],
  projects: [
    { name: "default", grepInvert: QUARANTINE },
    {
      name: "quarantine",
      grep: QUARANTINE,
      workers: 1,
      retries: 2,
      // Its own folder, so the advisory CI step leaves the blocking step's
      // traces and snapshot diffs in `test-results/` for the artifact upload.
      outputDir: "test-results-quarantine",
    },
  ],
  webServer: [
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // plan PR 5 / workstream D5: Storybook static server for the
      // storybook.spec.ts visual lane. The `storybook-static/` build is
      // produced by `npm run frontend:storybook:build` (chained into
      // `frontend:playwright:test`).
      command: "npm run storybook:serve-static",
      port: 6007,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
