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
  const shadow = await strip.evaluate((el) => window.getComputedStyle(el).boxShadow);
  // The selected lane must carry a non-empty box-shadow (inset stroke + outer
  // glow). The pre-Slice-2 treatment was a single 1 px inset which still
  // produced a box-shadow value, so we further assert the shadow contains a
  // 14 px outer-glow term that the Slice-2 treatment introduces.
  expect(shadow).not.toBe("none");
  expect(shadow).toMatch(/14px/);
});

test("output lane exposes inline Mute; rail owns Dim / Mono / Talk", async ({ page }) => {
  await openFixture(page, "audio-populated");

  // Slice 3 (Phase 3): Mute is the only per-output toggle on the Output card.
  // Dim / Mono / Talk are room-monitor controls — single-sourced on the rail.
  const mainOut = page.getByTestId("audio-output-audio-mix-main");
  await expect(mainOut).toBeVisible();
  const mute = mainOut.locator('[data-control="mute"]');
  await expect(mute).toBeVisible();
  await expect(mute).toHaveAttribute("aria-pressed", /true|false/);
  for (const removed of ["dim", "mono", "talk"] as const) {
    await expect(mainOut.locator(`[data-control="${removed}"]`)).toHaveCount(0);
  }

  // The rail's monitor button grid still owns Dim / Mono / Talk.
  const railMonitor = page.getByTestId("audio-rail-monitor-card");
  await expect(railMonitor).toBeVisible();
  for (const control of ["dim", "mono", "talk"] as const) {
    const button = railMonitor.locator(`[data-control="${control}"]`);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-pressed", /true|false/);
  }
});

test("each mixer tier renders a coloured identity rail", async ({ page }) => {
  await openFixture(page, "audio-populated");
  for (const tier of ["hardware-inputs", "software-playback", "hardware-outputs"] as const) {
    const tierEl = page.locator(`[data-tier="${tier}"]`).first();
    await expect(tierEl).toBeVisible();
    const railColor = await tierEl.evaluate((el) => {
      const before = window.getComputedStyle(el, "::before");
      return before.backgroundColor;
    });
    // The ::before identity rail must paint a visible colour, not be
    // transparent or unset. Any non-empty / non-transparent rgb value passes.
    expect(railColor).not.toBe("");
    expect(railColor).not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("1920 fallback keeps the output lane Mute control tappable", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "audio-1920-fallback");
  const mainOut = page.getByTestId("audio-output-audio-mix-main");
  await expect(mainOut).toBeVisible();
  const controls = mainOut.locator('[data-output-controls="true"]');
  await expect(controls).toBeVisible();
  // Slice 3 (Phase 3): Output card now exposes Mute only — Dim/Mono/Talk
  // moved to the rail. At 1920 fallback the surviving Mute must still
  // measure a tappable height (>= 18 px per the narrowest container-query
  // override).
  const buttons = await controls.evaluate((el) => {
    return Array.from(el.querySelectorAll("button[data-control]")).map((button) => ({
      control: button.getAttribute("data-control"),
      rect: button.getBoundingClientRect(),
    }));
  });
  expect(buttons.map((entry) => entry.control)).toEqual(["mute"]);
  for (const entry of buttons) {
    expect(entry.rect.width).toBeGreaterThan(0);
    expect(entry.rect.height).toBeGreaterThanOrEqual(18);
  }
});
