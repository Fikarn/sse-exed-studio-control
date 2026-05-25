import { defineConfig } from "@playwright/test";

if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
  delete process.env.NO_COLOR;
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 3,
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
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
