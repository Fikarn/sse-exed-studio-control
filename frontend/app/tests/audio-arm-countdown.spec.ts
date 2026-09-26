import { expect, test } from "@playwright/test";

import { AUDIO_ARM_MIN_DWELL_MS, AUDIO_ARM_TIMEOUT_MS } from "../src/app/audio/audioConstants";
import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

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
  // Production readiness S13. Old: the second click followed the first in real
  // time and was expected inside the 350 ms dwell. New: the page's clock is
  // stopped for the two presses and moved past the dwell for the third.
  // Reason: two Playwright clicks are over a second apart on a CI runner, so
  // the press landed outside the dwell and applied — the case failed on every
  // run (helpers/pageClock.ts). What is checked is unchanged.
  await page.clock.install();
  await openFixture(page, "audio-populated");
  const recalledTile = page.getByTestId("audio-snapshot-snapshot-interview-block");
  const recallSurface = recalledTile.getByTestId(/audio-snapshot-recall-/);
  await expect(recalledTile).toBeVisible();
  await pausePageClock(page);
  await recallSurface.click();
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(1);

  // A double-click's second press: the arm stays, nothing is recalled.
  await recallSurface.click();
  await expect(recalledTile).toHaveAttribute("data-armed", "true");
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(1);
  expect(await recallRequests(page)).toBe(0);

  await page.clock.fastForward(AUDIO_ARM_MIN_DWELL_MS + 50);
  await page.clock.resume();
  await recallSurface.click();
  // Apply collapses the arm and the countdown must come off the tile.
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(0);
  await expect(recalledTile).toHaveAttribute("data-current", "true");
  expect(await recallRequests(page)).toBe(1);
});

// New pages program, Slice 3 (D6): "a held Shift+digit arms once and its key
// repeats never apply" went with the Shift+digit snapshot keys. A held key can
// still reach an arm key: Enter presses the focused key, and the slice's review
// found that a held Enter pressed it again on every auto-repeat, past the dwell,
// so it armed and then applied. While something is armed the Console cancels a
// held Enter's repeats (useAudioArming). The two cases below hold Enter on a
// focused arm key. Playwright sends a second keyboard.down of a key that is
// already down as a repeat, which is what a held key's auto-repeat is. Each
// repeat is checked on its own: without the fix the first one applies, and a
// second one could arm again and hide that.

test("a held Enter on the focused snapshot key arms the recall once, and its repeats never apply it", async ({
  page,
}) => {
  await page.clock.install();
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");
  const recalledTile = page.getByTestId("audio-snapshot-snapshot-interview-block");
  const recallKey = page.getByTestId("audio-snapshot-recall-snapshot-interview-block");
  await expect(recalledTile).toHaveAttribute("data-armed", "false");
  await expect(recalledTile).toHaveAttribute("data-current", "false");
  // The page's clock stands still from the first press to past the dwell
  // (helpers/pageClock.ts), so "past the dwell" holds on any runner.
  await pausePageClock(page);
  await recallKey.focus();

  // Enter goes down: the focused key is pressed once, and the recall arms.
  await page.keyboard.down("Enter");
  await expect(recalledTile).toHaveAttribute("data-armed", "true");
  expect(await recallRequests(page)).toBe(0);

  // Enter is still held past the dwell: its repeats press nothing.
  await page.clock.fastForward(AUDIO_ARM_MIN_DWELL_MS + 50);
  await page.keyboard.down("Enter");
  await expect(recalledTile).toHaveAttribute("data-armed", "true");
  await page.keyboard.down("Enter");
  await expect(recalledTile).toHaveAttribute("data-armed", "true");
  await expect(recalledTile).toHaveAttribute("data-current", "false");
  expect(await recallRequests(page)).toBe(0);
  await page.keyboard.up("Enter");

  // A fresh press after the dwell is the confirm.
  await page.clock.resume();
  await page.keyboard.press("Enter");
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(0);
  await expect(recalledTile).toHaveAttribute("data-current", "true");
  expect(await recallRequests(page)).toBe(1);
});

test("a held Enter on a focused 48 V key arms once, and its repeats never switch 48 V", async ({ page }) => {
  await page.clock.install();
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");
  // Host's 48 V is on in the fixture, so its key arms switching it off.
  const hostPhantom = page.getByTestId("audio-lane-phantom-audio-input-9");
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "true");
  await expect(hostPhantom).toHaveAttribute("data-armed", "false");
  await pausePageClock(page);
  await hostPhantom.focus();

  await page.keyboard.down("Enter");
  await expect(hostPhantom).toHaveAttribute("data-armed", "true");

  await page.clock.fastForward(AUDIO_ARM_MIN_DWELL_MS + 50);
  await page.keyboard.down("Enter");
  await expect(hostPhantom).toHaveAttribute("data-armed", "true");
  await page.keyboard.down("Enter");
  await expect(hostPhantom).toHaveAttribute("data-armed", "true");
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("Enter");

  // A fresh press after the dwell switches 48 V off.
  await page.clock.resume();
  await page.keyboard.press("Enter");
  await expect(hostPhantom).toHaveAttribute("aria-pressed", "false");
});
