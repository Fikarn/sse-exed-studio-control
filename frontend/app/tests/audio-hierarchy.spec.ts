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

test("output lane exposes inline Mute; the cluster owns Dim and Mono", async ({ page }) => {
  await openFixture(page, "audio-populated");

  // Mute is the only per-output toggle on the Output card. Dim and Mono are
  // room-monitor controls, in the cluster. Talkback is gone (D26).
  const mainOut = page.getByTestId("audio-output-audio-mix-main");
  await expect(mainOut).toBeVisible();
  const mute = mainOut.locator('[data-control="mute"]');
  await expect(mute).toBeVisible();
  await expect(mute).toHaveAttribute("aria-pressed", /true|false/);
  for (const removed of ["dim", "mono", "talk"] as const) {
    await expect(mainOut.locator(`[data-control="${removed}"]`)).toHaveCount(0);
  }

  const monitorBar = page.getByTestId("audio-monitor-bar");
  await expect(monitorBar).toBeVisible();
  for (const testid of ["audio-monitor-dim", "audio-monitor-mono"] as const) {
    const button = page.getByTestId(testid);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-pressed", /true|false/);
  }
  await expect(page.getByTestId("audio-monitor-talkback")).toHaveCount(0);
  await expect(monitorBar.locator('[data-control="talk"]')).toHaveCount(0);
});

// Found, to check (2026-09-28): DIM and MONO lit on screen for Phones 1 and
// Phones 2, and nothing was sent to the desk: TotalMix has neither for the
// phones. They are Main Out's alone (the owner's decision): the phones' strips
// show neither, and the cluster's Dim and Mono act on Main Out whichever
// output is the mix target, as the deck's DIM does.
test("Dim and Mono are Main Out's alone, whichever output is the mix target", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await expect(page.getByTestId("audio-lane-lamps-audio-mix-main")).toBeVisible();
  for (const phones of ["audio-mix-phones-a", "audio-mix-phones-b"]) {
    await expect(page.getByTestId(`audio-output-${phones}`)).toBeVisible();
    await expect(page.getByTestId(`audio-lane-lamps-${phones}`)).toHaveCount(0);
  }

  await page.getByTestId("audio-output-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-output-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  const dim = page.getByTestId("audio-monitor-dim");
  const before = await dim.getAttribute("aria-pressed");
  await dim.click();
  await expect(dim).not.toHaveAttribute("aria-pressed", before ?? "");
  const mainLamps = page.getByTestId("audio-lane-lamps-audio-mix-main");
  await expect(mainLamps).toContainText("dim");
  await expect(page.getByTestId("audio-lane-lamps-audio-mix-phones-a")).toHaveCount(0);
});

// New pages program, Slice SW (D22): the case "1920 fallback keeps the output
// lane Mute control tappable" went with the 1920 fallback. At 2560×1440 the case
// above finds Mute on the lane and Dim and Mono off it, and the UI
// contract holds every key to its 24 px floor.
