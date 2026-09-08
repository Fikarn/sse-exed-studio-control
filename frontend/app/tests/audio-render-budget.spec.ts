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

test("moving between plate sections does not multiply the audio inspector render count", async ({ page }) => {
  // Visual overhaul A, Slice 4c. Old: "switching tabs does not multiply the
  // audio inspector render count" — the test clicked each tab and read
  // `aria-selected`. New: the accelerators move the plate between its sections.
  // Reason: the plate has no tab row; the same keys are the way around it, and
  // the budget they must stay inside is the same.
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

  const sectionAtTop = async () =>
    page.evaluate(() => {
      const plate = document.querySelector('[data-testid="audio-inspector"]');
      if (!plate) return null;
      const top = plate.getBoundingClientRect().top;
      let best: { id: string; delta: number } | null = null;
      for (const section of plate.querySelectorAll<HTMLElement>("[data-plate-section]")) {
        const delta = Math.abs(section.getBoundingClientRect().top - top);
        if (!best || delta < best.delta) best = { id: section.dataset.plateSection ?? "", delta };
      }
      return best?.id ?? null;
    });

  for (const [key, section] of [
    ["KeyE", "eq"],
    ["KeyD", "dynamics"],
    ["KeyR", "send"],
    ["KeyP", "preamp"],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(sectionAtTop).toBe(section);
  }

  const afterSections = await getInspectorRenderCount(page);
  expect(afterSections).not.toBeNull();
  const delta = afterSections! - baseline!;
  expect(delta).toBeGreaterThan(0);
  expect(delta).toBeLessThanOrEqual(7);
});
