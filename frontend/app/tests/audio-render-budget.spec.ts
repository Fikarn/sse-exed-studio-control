import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page, fixtureId: string) {
  const params = new URLSearchParams({ fixture: fixtureId, transport: "fixture" });
  const response = await page.goto(`/?${params.toString()}`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
}

async function getInspectorRenderCount(page: Page) {
  return page.evaluate(() => window.__SSE_TEST_RENDER_COUNTS__?.audioInspector ?? null);
}

test("idle meter ticks do not bump the audio inspector render counter", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_RENDER_COUNTS__ = {};
  });
  await openFixture(page, "audio-populated");
  await page.getByTestId("audio-workspace").waitFor();
  // Settle the initial render burst — the inspector typically re-renders a
  // handful of times as the snapshot, view model, and draft store wire up.
  await page.waitForTimeout(500);

  const baseline = await getInspectorRenderCount(page);
  expect(baseline, "audioInspector counter should be initialised by the inspector mount").not.toBeNull();
  expect(baseline!).toBeGreaterThan(0);

  // Idle: no clicks, no keyboard, no fixture change. The simulated meter loop
  // keeps producing meter frames via the engine client. After Slice 5B's
  // split, the inspector subtree must remain isolated from meter-only ticks —
  // canvas painting is direct DOM work, not React state.
  await page.waitForTimeout(1500);
  const afterIdle = await getInspectorRenderCount(page);
  expect(afterIdle, "audioInspector counter should still be defined after idle").not.toBeNull();

  const delta = afterIdle! - baseline!;
  // Tolerance: a small handful of view-model recomputations is acceptable
  // (sync-timestamp formatting, optimistic shadow expiry, etc.) but a
  // meter-frame-driven re-render storm would bump the counter by 100+ in
  // 1.5 s. 10 is comfortably above the legitimate floor and well below a
  // regression.
  expect(delta).toBeLessThanOrEqual(10);
});

test("switching tabs does not multiply the audio inspector render count", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_RENDER_COUNTS__ = {};
  });
  await openFixture(page, "audio-selected-channel");
  await page.getByTestId("audio-workspace").waitFor();
  await page.waitForTimeout(500);

  const baseline = await getInspectorRenderCount(page);
  expect(baseline).not.toBeNull();

  // Click through every tab; each click should re-render the inspector at
  // most a few times. Pre-split this used to be 1–2 renders per tab; the
  // split's wider prop surface might add another. We allow ≤ 6 renders per
  // tab transition.
  for (const tabName of ["EQ", "Dynamics", "Sends", "Overview"]) {
    await page.getByRole("tab", { name: tabName }).click();
    await page.waitForTimeout(120);
  }

  const afterTabs = await getInspectorRenderCount(page);
  expect(afterTabs).not.toBeNull();
  const delta = afterTabs! - baseline!;
  expect(delta).toBeGreaterThan(0);
  expect(delta).toBeLessThanOrEqual(24); // 4 tabs × ≤ 6 renders each.
});
