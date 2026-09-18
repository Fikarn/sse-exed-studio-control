import type { Page } from "@playwright/test";

// Production readiness S13. The arm-then-confirm dwell (AUDIO_ARM_MIN_DWELL_MS,
// 350 ms) is measured on the page's `performance.now()`. Two Playwright clicks
// are not 350 ms apart on a CI runner — each waits for actionability and a
// software-rendered 2560×1440 frame, and the trace of run 35327014360 has them
// 1.8 s apart — so a case that says "a second click inside the dwell" with real
// time was never inside it there: `audio-arm-countdown.spec.ts:45` failed on
// every one of the branch's first thirty runs and `audio.spec.ts:1054` on
// nineteen. With the page's clock stopped the second press lands at the arm's
// own instant, and the confirm follows after the clock is moved past the dwell:
// inside and outside are true by construction, whatever the runner's speed.

/** How far `pauseAt` jumps. It refuses a time in the past, so the lead only has
 * to outlast the round trip between reading the page's time and pausing it. */
const PAUSE_LEAD_MS = 60_000;

/**
 * Stops the page's clock — `Date`, `performance.now()` and every timer — until
 * `page.clock.resume()`. `page.clock.install()` must run before the page opens.
 * Timers that fall due inside the lead fire once on the way, as they would have.
 */
export async function pausePageClock(page: Page) {
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + PAUSE_LEAD_MS);
}
