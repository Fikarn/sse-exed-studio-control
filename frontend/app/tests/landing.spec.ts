import { expect, test, type Page } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// D47, which amends D1 (2026-10-09): the app opens on the Overview at every
// start of the app, whatever page was saved, unless the setup is not done.
// The store writes the page once, before the shell is ready, so the deck's
// word follows it (D49) and the saved page never shows first; a restart of
// the hardware link keeps the page the operator is on (the store's unit
// tests). The double opens on each fixture's saved page unless the address
// asks for the landing (`openFixture(…, { landing: true })`), so every other
// spec opens where its fixture was saved.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
});

/** The page writes (`settings.update`) the double has answered since the page opened. */
const pageWrites = (page: Page) =>
  page.evaluate(() => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["settings.update"] ?? 0);

const tab = (page: Page, id: string) => page.locator(`[data-region="header"] [data-nav-id="${id}"]`);

test("a start opens the Overview, though the Console was the page saved", async ({ page }) => {
  await openFixture(page, "audio-populated", { landing: true });
  await expectWorkspaceMounted(page, "overview");
  await expect(tab(page, "overview")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("audio-workspace")).toHaveCount(0);
  expect(await pageWrites(page), "the landing is one write").toBe(1);
});

test("a start opens the Overview, though Setup / Support was the page saved", async ({ page }) => {
  await openFixture(page, "setup-ready", { landing: true });
  await expectWorkspaceMounted(page, "overview");
  await expect(tab(page, "overview")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("setup-workspace")).toHaveCount(0);
  expect(await pageWrites(page), "the landing is one write").toBe(1);
});

test("a start while the setup is not done opens Setup, and writes no page", async ({ page }) => {
  await openFixture(page, "setup-required", { landing: true });
  await expectWorkspaceMounted(page, "setup");
  await expect(tab(page, "setup")).toHaveAttribute("aria-current", "page");
  // The Overview is locked with the other pages until the setup is published.
  await expect(tab(page, "overview")).toHaveAttribute("aria-disabled", "true");
  expect(await pageWrites(page)).toBe(0);
});

// The landing is a write at the start, not a rule of the page on screen: a
// rule would send every tab press back to the Overview at the next read.
test("after the landing a tab opens its page, and the page stays", async ({ page }) => {
  await openFixture(page, "audio-populated", { landing: true });
  await expectWorkspaceMounted(page, "overview");

  await page.locator('[data-region="header"]').getByRole("button", { name: "Audio", exact: true }).click();
  await expectWorkspaceMounted(page, "audio");
  await expect(tab(page, "audio")).toHaveAttribute("aria-current", "page");
  await expect.poll(() => pageWrites(page)).toBe(2);

  // What would undo the press comes after it (the read the write asks for,
  // the double's `settings.changed`), so the check is that nothing does,
  // over a while.
  await page.waitForTimeout(800);
  await expect(tab(page, "audio")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("overview-workspace")).toHaveCount(0);
  expect(await pageWrites(page), "the landing is not written again").toBe(2);
});
