import { defineConfig } from "@playwright/test";

if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
  delete process.env.NO_COLOR;
}

// A case that fails now and then has a cause: find it. There is no quarantine
// list.
//
// One retry. On this PC Windows now and then
// refuses Chromium a socket (`net::ERR_NO_BUFFER_SPACE`, about one request in
// ten thousand), and the page then draws without a stylesheet or a chunk. A
// case that passed on its retry is reported as flaky, by name: read why its
// first run failed, and if it was anything but that, find the cause.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 1,
  // Eight workers on the studio workstation (32 threads), at below-normal
  // priority (scripts/frontend/run-playwright.mjs).
  workers: 8,
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
  // Studio Control runs on Windows at 2560×1440 and nowhere else, so the
  // committed captures are the win32 ones (`{platform}` names them). See
  // frontend/app/tests/__visual__/README.md.
  snapshotPathTemplate: "{testDir}/__visual__/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  reporter: [["html", { outputFolder: "playwright-report" }]],
  webServer: [
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
      port: 4173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      // The Storybook static server, for storybook.spec.ts and the layout
      // measures of the primitives' pages. `npm run frontend:storybook:build`
      // makes `storybook-static/` (chained into `frontend:playwright:test`).
      command: "npm run storybook:serve-static",
      port: 6007,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
