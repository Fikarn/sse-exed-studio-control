import { expect, test } from "@playwright/test";

import { AUDIO_ARM_MIN_DWELL_MS, AUDIO_ARM_TIMEOUT_MS } from "../src/app/audio/audioConstants";
import { openFixture } from "./helpers/openFixture";

async function recallRequests(page: import("@playwright/test").Page) {
  return page.evaluate(() => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["audio.snapshot.recall"] ?? 0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
});

test("snapshot recall arming renders a countdown bar that respects AUDIO_ARM_TIMEOUT_MS", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const recalledTile = page.getByTestId("audio-snapshot-snapshot-interview-block");
  await expect(recalledTile).toBeVisible();

  const recallSurface = recalledTile.getByTestId(/audio-snapshot-recall-/);
  await expect(recalledTile).toHaveAttribute("data-armed", "false");
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(0);

  // First click arms — second click would apply. The arm window must show a
  // countdown bar inside the tile until the timeout elapses.
  await recallSurface.click();
  await expect(recalledTile).toHaveAttribute("data-armed", "true");
  const countdown = recalledTile.getByTestId("audio-arm-countdown");
  await expect(countdown).toHaveCount(1);
  await expect(countdown).toHaveCSS("animation-duration", `${AUDIO_ARM_TIMEOUT_MS / 1000}s`);

  // After the arm window expires the tile must clear and the countdown bar
  // must unmount. plan PR 5 / workstream D8 flake sweep: this used to be a
  // hard `waitForTimeout(AUDIO_ARM_TIMEOUT_MS + 500)` which would have
  // false-passed on a slow runner that hadn't yet processed the timeout
  // tick. Polling on the attribute instead waits for the observable
  // change with a margin big enough to absorb scheduler jitter.
  await expect(recalledTile).toHaveAttribute("data-armed", "false", {
    timeout: AUDIO_ARM_TIMEOUT_MS + 2_000,
  });
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(0);
});

test("a second click inside the dwell keeps the arm; after the dwell it applies the recall", async ({ page }) => {
  // 2026-09 audit Slice 7. This spec used to click twice back to back and
  // expect the apply — that immediate double-fire was the defect.
  await openFixture(page, "audio-populated");
  const recalledTile = page.getByTestId("audio-snapshot-snapshot-interview-block");
  const recallSurface = recalledTile.getByTestId(/audio-snapshot-recall-/);
  await recallSurface.click();
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(1);

  // A double-click's second press: the arm stays, nothing is recalled.
  await recallSurface.click();
  await expect(recalledTile).toHaveAttribute("data-armed", "true");
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(1);
  expect(await recallRequests(page)).toBe(0);

  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);
  await recallSurface.click();
  // Apply collapses the arm and the countdown must come off the tile.
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(0);
  await expect(recalledTile).toHaveAttribute("data-current", "true");
  expect(await recallRequests(page)).toBe(1);
});

test("a held Shift+digit arms once and its key repeats never apply", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const tile = page.getByTestId("audio-snapshot-snapshot-interview-block");
  await page.getByTestId("audio-workspace").click({ position: { x: 4, y: 4 } });

  // Playwright marks a second keyboard.down of the same key as repeat=true,
  // which is what a held key produces.
  await page.keyboard.down("Shift");
  await page.keyboard.down("Digit3");
  await page.keyboard.down("Digit3");
  await page.keyboard.down("Digit3");
  await page.keyboard.up("Digit3");
  await page.keyboard.up("Shift");
  await expect(tile).toHaveAttribute("data-armed", "true");
  await page.waitForTimeout(AUDIO_ARM_MIN_DWELL_MS + 50);
  await expect(tile).toHaveAttribute("data-armed", "true");
  expect(await recallRequests(page)).toBe(0);

  // A deliberate second press after the dwell is the confirm.
  await page.keyboard.press("Shift+Digit3");
  await expect(tile).toHaveAttribute("data-current", "true");
  expect(await recallRequests(page)).toBe(1);
});
