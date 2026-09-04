import { expect, test, type Page } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// 2026-09 audit remediation, Slice 6 (operator decision 4): talkback is a
// hold, never a latch. Before this slice the button was a toggle and the only
// coverage asserted that it existed with an aria-pressed attribute. These
// cases drive the real button and key paths and count the engine requests
// (`audio.talkback.hold`) the fixture transport receives.

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
  await expect(button).toContainText("Hold · T");

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

test("holding T talks; releasing T, or the window losing focus, stops", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const button = page.getByTestId("audio-monitor-talkback");
  await page.getByTestId("audio-workspace").click({ position: { x: 4, y: 4 } });

  await page.keyboard.down("t");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAttribute("data-holding", "true");
  expect(await holdRequests(page)).toBe(1);
  await page.keyboard.up("t");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await holdRequests(page)).toBe(2);

  // Losing the window mid-hold releases; the late key-up sends nothing more.
  await page.keyboard.down("t");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await holdRequests(page)).toBe(4);
  await page.keyboard.up("t");
  await page.waitForTimeout(200);
  expect(await holdRequests(page)).toBe(4);

  // Typing a t into a text field is text, not talkback.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "talkback-spec-input";
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.down("t");
  await page.keyboard.up("t");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await holdRequests(page)).toBe(4);
});

test("talkback cannot be held while audio is not verified", async ({ page }) => {
  await openFixture(page, "audio-not-verified");
  const button = page.getByTestId("audio-monitor-talkback");
  await expect(button).toBeDisabled();
  await page.keyboard.down("t");
  await page.keyboard.up("t");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await holdRequests(page)).toBe(0);
});
