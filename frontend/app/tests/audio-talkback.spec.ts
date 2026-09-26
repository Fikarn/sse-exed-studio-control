import { expect, test, type Page } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// 2026-09 audit remediation, Slice 6 (operator decision 4): talkback is a
// hold, never a latch. Before this slice the button was a toggle and the only
// coverage asserted that it existed with an aria-pressed attribute. These
// cases drive the real button and count the engine requests
// (`audio.talkback.hold`) the fixture transport receives. New pages program,
// Slice 3 (D7): the page-wide T key went, and with it the case that held T.

async function holdRequests(page: Page) {
  return page.evaluate(() => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["audio.talkback.hold"] ?? 0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
});

test("holding the Talkback button engages, heartbeats while held, and releases on pointer up", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const button = page.getByTestId("audio-monitor-talkback");
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  // New pages program, Slice 3 (D7). Old: the key read "Hold · T". New: "Hold".
  // Reason: the T key went, and its hint with it.
  await expect(button).toContainText("Hold");
  await expect(button).not.toContainText("· T");

  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(button).toHaveAttribute("data-holding", "true");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAttribute("data-active", "true");
  expect(await holdRequests(page)).toBe(1);

  // The hold is re-sent while held (engine watchdog allows 2 s).
  await expect.poll(() => holdRequests(page), { timeout: 3_000 }).toBeGreaterThanOrEqual(2);

  await page.mouse.up();
  await expect(button).not.toHaveAttribute("data-holding", "true");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveAttribute("data-active", "false");
  const afterRelease = await holdRequests(page);

  // Nothing is sent once released.
  await page.waitForTimeout(1_000);
  expect(await holdRequests(page)).toBe(afterRelease);
});

test("a click never latches talkback", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const button = page.getByTestId("audio-monitor-talkback");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveAttribute("data-active", "false");
  // One engage on pointer down, one release on pointer up — and no toggle.
  expect(await holdRequests(page)).toBe(2);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await holdRequests(page)).toBe(4);
});

// New pages program, Slice 3 (D7): "holding T talks; releasing T, or the window
// losing focus, stops" went with the T key.

test("talkback cannot be held while audio is not verified", async ({ page }) => {
  await openFixture(page, "audio-not-verified");
  const button = page.getByTestId("audio-monitor-talkback");
  await expect(button).toBeDisabled();
  // New pages program, Slice 3 (D7). Old: the case held T to try a hold. New:
  // it presses and releases the dimmed key itself. Reason: the T key went; the
  // key is what the operator would press.
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await holdRequests(page)).toBe(0);
});
