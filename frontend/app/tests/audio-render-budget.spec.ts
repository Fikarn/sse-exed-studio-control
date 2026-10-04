import { expect, test, type Page } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

const SETTLE_TIMEOUT_MS = 20_000;
// How long the Console's render count must hold still to count as settled.
const SETTLED_QUIET_MS = 250;

async function getInspectorRenderCount(page: Page) {
  return page.evaluate(() => window.__SSE_TEST_RENDER_COUNTS__?.audioInspector ?? null);
}

async function getWorkspaceRenderCount(page: Page) {
  return page.evaluate(() => window.__SSE_TEST_RENDER_COUNTS__?.audioWorkspace ?? null);
}

// Production readiness S15. Old: both cases waited out the Console's start-up
// renders with a fixed 500 ms window after `audio-workspace` appeared, then took
// their baseline. New: they wait for what ends those renders. Reason: the
// Console renders more than once as it starts, and `audio-workspace` was also
// the id of the Console's loading surface (until 2026-09-23). On a loaded
// machine the baseline was read before the mount or before the burst ended, and
// the rest of the burst was counted in the idle window; with the burst over, an
// idle Console renders nothing, on any machine.
// 2026-10-01: the burst used to end with the recall pulse on the snapshot key
// the fixture said was just recalled (a 1.5 s timer). The pulse went with the
// app's own snapshots, so nothing times the start any more: the Console is
// settled once its render count holds still for SETTLED_QUIET_MS.
async function openSettledConsole(page: Page, fixtureId: string) {
  await page.addInitScript(() => {
    window.__SSE_TEST_RENDER_COUNTS__ = {};
  });
  await openFixture(page, fixtureId);
  // Nothing is measured yet, so these two waits can be as long as a slow
  // machine needs (the old `waitFor()` also waited out the test's own time).
  await expectWorkspaceMounted(page, "audio", { timeout: SETTLE_TIMEOUT_MS });
  await expect
    .poll(
      async () => {
        const before = await getWorkspaceRenderCount(page);
        // Load-bearing: the settle is the absence of renders over a window.
        await page.waitForTimeout(SETTLED_QUIET_MS);
        return before !== null && (await getWorkspaceRenderCount(page)) === before;
      },
      {
        message: `${fixtureId}: the Console's start-up renders should come to an end`,
        timeout: SETTLE_TIMEOUT_MS,
      }
    )
    .toBe(true);
}

test("idle meter ticks do not bump the audio inspector render counter", async ({ page }) => {
  await openSettledConsole(page, "audio-populated");

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
  // Production readiness S15: that 1 was the recall pulse ending inside the
  // window; with the start-up renders waited out the measured Δ is 0 (and the
  // pulse itself went on 2026-10-01).
  expect(delta).toBeLessThanOrEqual(3);
});

test("scrolling the plate between its sections does not re-render the audio inspector", async ({ page }) => {
  // Visual overhaul A, Slice 4c. Old: "switching tabs does not multiply the
  // audio inspector render count" — the test clicked each tab and read
  // `aria-selected`. Then: the accelerators moved the plate between its
  // sections.
  // New pages program, Slice 3 (decision 4). Old name: "moving between plate
  // sections does not multiply the audio inspector render count"; E / D / R /
  // P brought each section to the plate's top, a state change that rendered
  // the plate (Δ > 0, ≤ 7). New: the plate is scrolled to each section, and a
  // scroll must render nothing (the idle budget, ≤ 3). Reason: the section keys
  // went with no replacement — the plate shows every section and scrolls — so
  // what is left to guard is that moving around the plate costs no renders.
  // The visual overhaul's Console pull request. Old: the plate was scrolled to
  // each section in turn. New: every section is in view at once, the plate
  // does not scroll, and reading each costs no render. Reason: the plate fits
  // its 1320 px (FX 3/4 is a playback pair: it has no preamp section).
  await openSettledConsole(page, "audio-selected-channel");

  const baseline = await getInspectorRenderCount(page);
  expect(baseline).not.toBeNull();

  for (const section of ["send", "eq", "dynamics", "meter"] as const) {
    const target = page.locator(`[data-plate-section="${section}"]`);
    await target.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "auto" }));
    await expect(target).toBeInViewport({ ratio: 1 });
  }
  expect(
    await page.getByTestId("audio-inspector").evaluate((plate) => plate.scrollTop),
    "the plate never scrolled"
  ).toBe(0);

  const afterSections = await getInspectorRenderCount(page);
  expect(afterSections).not.toBeNull();
  expect(afterSections! - baseline!).toBeLessThanOrEqual(3);
});
