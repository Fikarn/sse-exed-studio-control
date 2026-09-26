import { expect, test, type Page } from "@playwright/test";

import { AUDIO_RECALL_PULSE_MS } from "../src/app/audio/audioConstants";
import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

const SETTLE_TIMEOUT_MS = 20_000;

async function getInspectorRenderCount(page: Page) {
  return page.evaluate(() => window.__SSE_TEST_RENDER_COUNTS__?.audioInspector ?? null);
}

// Production readiness S15. Old: both cases waited out the Console's start-up
// renders with a fixed 500 ms window after `audio-workspace` appeared, then took
// their baseline. New: they wait for what ends those renders. Reason: the
// Console renders three times as it starts — its mount, then the recall pulse
// on the snapshot key the fixture says was just recalled, then that pulse's end
// on a 1.5 s timer (AUDIO_RECALL_PULSE_MS) — and `audio-workspace` was also the
// id of the Console's loading surface (until 2026-09-23). On a loaded machine the baseline was
// read before the mount or before the pulse ended, and the rest of the burst
// was counted in the idle window; with the burst over, an idle Console renders
// nothing, on any machine. The pulse is recorded in the page as it happens, so
// no read from here can miss it.
async function openSettledConsole(page: Page, fixtureId: string) {
  await page.addInitScript(() => {
    window.__SSE_TEST_RENDER_COUNTS__ = {};
    const pulse = { started: false, ended: false };
    (window as unknown as { __SSE_TEST_RECALL_PULSE__: typeof pulse }).__SSE_TEST_RECALL_PULSE__ = pulse;
    new MutationObserver((records) => {
      for (const record of records) {
        if ((record.target as Element).getAttribute("data-flash") === "true") pulse.started = true;
        else if (pulse.started) pulse.ended = true;
      }
    }).observe(document, { attributeFilter: ["data-flash"], subtree: true });
  });
  await openFixture(page, fixtureId);
  // Nothing is measured yet, so these two waits can be as long as a slow
  // machine needs (the old `waitFor()` also waited out the test's own time).
  await expectWorkspaceMounted(page, "audio", { timeout: SETTLE_TIMEOUT_MS });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __SSE_TEST_RECALL_PULSE__?: { ended: boolean } }).__SSE_TEST_RECALL_PULSE__?.ended
        ),
      {
        message: `${fixtureId}: the recall pulse the Console starts at mount (the fixture double's snapshot was just recalled) should come and go`,
        timeout: AUDIO_RECALL_PULSE_MS + SETTLE_TIMEOUT_MS,
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
  // window; with the start-up renders waited out the measured Δ is 0.
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
  await openSettledConsole(page, "audio-selected-channel");

  const baseline = await getInspectorRenderCount(page);
  expect(baseline).not.toBeNull();

  for (const section of ["eq", "dynamics", "send", "preamp"] as const) {
    const target = page.locator(`[data-plate-section="${section}"]`);
    await target.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "auto" }));
    await expect(target).toBeInViewport();
  }

  const afterSections = await getInspectorRenderCount(page);
  expect(afterSections).not.toBeNull();
  expect(afterSections! - baseline!).toBeLessThanOrEqual(3);
});
