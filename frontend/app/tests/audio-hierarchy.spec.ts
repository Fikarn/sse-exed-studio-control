import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page, fixtureId: string) {
  const params = new URLSearchParams({ fixture: fixtureId, transport: "fixture" });
  const response = await page.goto(`/?${params.toString()}`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
}

test("selected channel lane is visually distinct from its neighbours", async ({ page }) => {
  await openFixture(page, "audio-selected-channel");
  const strip = page.getByTestId("audio-strip-audio-playback-3-4");
  await expect(strip).toHaveAttribute("data-selected", "true");
  // 2026-05-27 redesign: the selected channel lane no longer uses a 14 px
  // box-shadow outer glow. `[data-selected="true"]` now lifts the lane with
  // border-color (var(--line-2)) + background-color (var(--strip-bg-selected)).
  // Compare those two properties against an unselected sibling lane.
  const neighbour = page.getByTestId("audio-strip-audio-playback-1-2");
  await expect(neighbour).toHaveAttribute("data-selected", "false");
  const readStyle = (locator: typeof strip) =>
    locator.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return { background: style.backgroundColor, border: style.borderColor };
    });
  const selectedStyle = await readStyle(strip);
  const neighbourStyle = await readStyle(neighbour);
  expect(selectedStyle.border).not.toBe(neighbourStyle.border);
  expect(selectedStyle.background).not.toBe(neighbourStyle.background);
});

test("output lane exposes inline Mute; monitor bar owns Dim / Mono / Talkback", async ({ page }) => {
  await openFixture(page, "audio-populated");

  // 2026-05-27 redesign: Mute is still the only per-output toggle on the
  // Output card. Dim / Mono / Talkback are room-monitor controls — now
  // single-sourced on the new AudioMonitorBar (the old rail is gone).
  const mainOut = page.getByTestId("audio-output-audio-mix-main");
  await expect(mainOut).toBeVisible();
  const mute = mainOut.locator('[data-control="mute"]');
  await expect(mute).toBeVisible();
  await expect(mute).toHaveAttribute("aria-pressed", /true|false/);
  for (const removed of ["dim", "mono", "talk"] as const) {
    await expect(mainOut.locator(`[data-control="${removed}"]`)).toHaveCount(0);
  }

  // The monitor bar now owns Dim / Mono / Talkback.
  const monitorBar = page.getByTestId("audio-monitor-bar");
  await expect(monitorBar).toBeVisible();
  for (const testid of ["audio-monitor-dim", "audio-monitor-mono", "audio-monitor-talkback"] as const) {
    const button = page.getByTestId(testid);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-pressed", /true|false/);
  }

  // 2026-09 audit Slice 6: Talkback is a hold, not a toggle — the caption says
  // so, and a plain click never leaves it engaged (the hold specs in
  // audio-talkback.spec.ts drive the press / release paths).
  // New pages program, Slice 3 (D7). Old: the caption read "Hold · T". New:
  // "Hold". Reason: the T key went, and its hint with it.
  const talkback = page.getByTestId("audio-monitor-talkback");
  await expect(talkback).toContainText("Hold");
  await expect(talkback).not.toContainText("· T");
  await talkback.click();
  await expect(talkback).toHaveAttribute("aria-pressed", "false");
});

// New pages program, Slice SW (D22): the case "1920 fallback keeps the output
// lane Mute control tappable" went with the 1920 fallback. At 2560×1440 the case
// above finds Mute on the lane and Dim / Mono / Talk off it, and the UI
// contract holds every key to its 24 px floor.
