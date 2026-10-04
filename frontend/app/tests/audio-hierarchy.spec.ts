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
// The visual overhaul's Console pull request. Old: Main Out's strip in the bay
// carried "dim" and "mono" lamps, the phones' strips none. New: the outputs are
// rows in the cluster's outputs block under DIM and MONO; Main Out's menu has
// Dim and Mono, saying their value, the phones' menus have neither. Reason: the
// DIM and MONO keys are their one home (Atrium: the lamps repeated them).
test("Dim and Mono are Main Out's alone, whichever output is the mix target", async ({ page }) => {
  await openFixture(page, "audio-populated");

  await expect(page.getByTestId("audio-lane-lamps-audio-mix-main")).toHaveCount(0);
  for (const phones of ["audio-mix-phones-a", "audio-mix-phones-b"]) {
    await expect(page.getByTestId(`audio-output-${phones}`)).toBeVisible();
    await page.getByTestId(`audio-lane-menu-${phones}`).click();
    await expect(page.getByRole("menuitemcheckbox", { name: /^Dim/ })).toHaveCount(0);
    await expect(page.getByRole("menuitemcheckbox", { name: /^Mono/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  await page.getByTestId("audio-mix-target-audio-mix-phones-a").click();
  await expect(page.getByTestId("audio-output-audio-mix-phones-a")).toHaveAttribute("data-selected", "true");
  const dim = page.getByTestId("audio-monitor-dim");
  const before = await dim.getAttribute("aria-pressed");
  await dim.click();
  await expect(dim).not.toHaveAttribute("aria-pressed", before ?? "");
  await page.getByTestId("audio-lane-menu-audio-mix-main").click();
  await expect(page.getByRole("menuitemcheckbox", { name: /^Dim/ })).toHaveAttribute(
    "aria-checked",
    before === "true" ? "false" : "true"
  );
  await page.keyboard.press("Escape");
});

// New pages program, Slice SW (D22): the case "1920 fallback keeps the output
// lane Mute control tappable" went with the 1920 fallback. At 2560×1440 the case
// above finds Mute on the lane and Dim and Mono off it, and the UI
// contract holds every key to its 24 px floor.
