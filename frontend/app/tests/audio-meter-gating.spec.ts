import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page, fixtureId: string) {
  const params = new URLSearchParams({ fixture: fixtureId, transport: "fixture" });
  const response = await page.goto(`/?${params.toString()}`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
}

async function readCanvasChecksum(page: Page) {
  return page.getByTestId("audio-meter-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) {
      return { checksum: 0, sequence: canvas.dataset.meterSequence ?? "" };
    }
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let checksum = 0;
    for (let index = 0; index < data.length; index += 17) {
      checksum = (checksum + data[index] * (index + 1)) % 1_000_000_007;
    }
    return { checksum, sequence: canvas.dataset.meterSequence ?? "" };
  });
}

const GATED_FIXTURES = ["audio-osc-disabled", "audio-not-verified", "audio-offline", "audio-action-failed"] as const;

for (const fixtureId of GATED_FIXTURES) {
  test(`${fixtureId}: meter canvas is gated and stops simulated ticks`, async ({ page }) => {
    await openFixture(page, fixtureId);
    const workspace = page.getByTestId("audio-workspace");
    await expect(workspace).toBeVisible();
    await expect(workspace).toHaveAttribute("data-canvas-metering", "false");
    await expect(workspace).toHaveAttribute("data-meter-simulation-state", "gated");

    const canvas = page.getByTestId("audio-meter-canvas");
    await expect(canvas).toBeVisible();
    // The paint loop must mark itself gated so a future reader knows the
    // canvas is intentionally empty rather than uninitialised.
    await expect(canvas).toHaveAttribute("data-meter-ballistics", "gated");

    // Sample twice with enough delay for the simulated tick to advance if it
    // were running. The checksum must stay identical (empty rects only) even
    // though the meter sequence advances each animation frame.
    const first = await readCanvasChecksum(page);
    await page.waitForTimeout(800);
    const second = await readCanvasChecksum(page);
    expect(second.checksum).toBe(first.checksum);
  });
}

test("audio-populated meter canvas remains live and ticks", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const workspace = page.getByTestId("audio-workspace");
  await expect(workspace).toHaveAttribute("data-canvas-metering", "true");
  // audio-populated runs the fixture simulator, so the state is "simulated"
  // (truthful) — not "live", not "gated".
  await expect(workspace).toHaveAttribute("data-meter-simulation-state", "simulated");
  const canvas = page.getByTestId("audio-meter-canvas");
  await expect(canvas).toHaveAttribute("data-meter-ballistics", "display");
});
