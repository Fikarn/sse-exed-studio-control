import type { Locator, Page } from "@playwright/test";

// Live, JS-driven surfaces that drift between captures (meter tracks redraw
// every engine tick, the overlay canvas accumulates sample history, the
// inspector signal canvas paints peaks). Mask these on audio captures so the
// baseline diff covers layout + chrome, not live values.
//
// One definition for `visual-review.spec.ts` and `storybook.spec.ts`
// (production readiness S13). They each had their own, and only the first was
// corrected when the meter overlay became a full-workspace layer: the Storybook
// copy went on masking `audio-meter-canvas`, so the two audio shell stories were
// captured as one solid mask colour and compared equal to it on every platform —
// found when the linux baselines were inspected for the S13 refresh. The mask is
// a no-op for stories and fixtures that render none of these elements.
export function liveAudioMasks(page: Page): Locator[] {
  // The meter overlay (`audio-meter-canvas`) is a full-workspace
  // position:absolute layer, so masking it blanked the entire audio surface and
  // left nothing pixel-tested. It paints live values only inside
  // [data-meter-component="stereo"] and [data-mini-meter-kind] slots, and the
  // only other per-tick values are the inspector/monitor dB numerals
  // ([data-meter-readout-mode] / the monitor master meter). Masking just those
  // keeps the static mixer / inspector / snapshot-deck / top + monitor bar
  // layout in the diff so it is actually regression-tested.
  return [
    page.locator('[data-meter-component="stereo"]'),
    page.locator("[data-mini-meter-kind]"),
    page.locator('[data-testid="audio-monitor-master-meter"]'),
    page.locator("[data-meter-readout-mode]"),
  ];
}
