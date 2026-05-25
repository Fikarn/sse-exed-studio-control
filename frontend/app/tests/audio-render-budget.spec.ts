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
  // plan PR 5 / D8 flake sweep: this `waitForTimeout` is load-bearing —
  // it's measuring the *initial render burst* that completes within a
  // fixed wall-clock window. Replacing with a deterministic predicate
  // would either over-count (poll-driven re-renders) or under-count
  // (settle before the burst is finished). 500ms covers the documented
  // 1-render baseline plus jitter.
  await page.waitForTimeout(500);

  const baseline = await getInspectorRenderCount(page);
  expect(baseline, "audioInspector counter should be initialised by the inspector mount").not.toBeNull();
  expect(baseline!).toBeGreaterThan(0);

  // Idle: no clicks, no keyboard, no fixture change. The simulated meter loop
  // keeps producing meter frames via the engine client. After Slice 5B's
  // split, the inspector subtree must remain isolated from meter-only ticks —
  // canvas painting is direct DOM work, not React state.
  // plan PR 5 / D8: load-bearing wait — asserting *absence* of re-renders
  // over a 1.5 s window. A `expect.poll` would invert the assertion.
  await page.waitForTimeout(1500);
  const afterIdle = await getInspectorRenderCount(page);
  expect(afterIdle, "audioInspector counter should still be defined after idle").not.toBeNull();

  const delta = afterIdle! - baseline!;
  // Tolerance: ≤ +2 over the post-Slice-5C baseline. Measured Δ over
  // 3 runs after the keyboard + palette hook extraction: 1, 1, 1.
  // Headroom of +2 catches a real regression (a meter-frame-driven
  // re-render storm bumps the counter by 100+ in 1.5 s) while keeping
  // the budget tight enough to flag subtle drift the previous ≤ 10
  // budget would have hidden.
  expect(delta).toBeLessThanOrEqual(3);
});

test("switching tabs does not multiply the audio inspector render count", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_RENDER_COUNTS__ = {};
  });
  await openFixture(page, "audio-selected-channel");
  await page.getByTestId("audio-workspace").waitFor();
  // plan PR 5 / D8: load-bearing initial-burst settle (see twin comment
  // in the test above).
  await page.waitForTimeout(500);

  const baseline = await getInspectorRenderCount(page);
  expect(baseline).not.toBeNull();

  // Click through every tab. The inspector re-renders on each tab change
  // (active-tab state lives in the workspace, but the inspector consumes
  // it). Post-Slice-5C the measured Δ across the 4 tabs is 4 or 5 over
  // 3 runs; a +2 headroom catches a real regression while flagging subtle
  // drift the previous ≤ 24 budget would have hidden.
  // plan PR 5 / D8 flake sweep: replaced per-tab `waitForTimeout(120)`
  // with a deterministic `aria-selected` assertion — the tab is observably
  // active before we move to the next one, no fixed wall-clock wait
  // needed.
  for (const tabName of ["EQ", "Dynamics", "Sends", "Overview"]) {
    const tab = page.getByRole("tab", { name: tabName });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }

  const afterTabs = await getInspectorRenderCount(page);
  expect(afterTabs).not.toBeNull();
  const delta = afterTabs! - baseline!;
  expect(delta).toBeGreaterThan(0);
  expect(delta).toBeLessThanOrEqual(7);
});
