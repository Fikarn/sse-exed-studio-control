import { expect, test, type Page } from "@playwright/test";

import { AUDIO_ARM_TIMEOUT_MS } from "../src/app/audio/audioConstants";

async function openFixture(page: Page, fixtureId: string) {
  const params = new URLSearchParams({ fixture: fixtureId, transport: "fixture" });
  const response = await page.goto(`/?${params.toString()}`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
}

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
  // must unmount. Allow a small buffer to cover scheduler jitter.
  await page.waitForTimeout(AUDIO_ARM_TIMEOUT_MS + 500);
  await expect(recalledTile).toHaveAttribute("data-armed", "false");
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(0);
});

test("a second click on the same tile applies the recall and clears the countdown", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const recalledTile = page.getByTestId("audio-snapshot-snapshot-interview-block");
  const recallSurface = recalledTile.getByTestId(/audio-snapshot-recall-/);
  await recallSurface.click();
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(1);
  await recallSurface.click();
  // Apply collapses the arm and the countdown must come off the tile.
  await expect(recalledTile.getByTestId("audio-arm-countdown")).toHaveCount(0);
  await expect(recalledTile).toHaveAttribute("data-current", "true");
});
