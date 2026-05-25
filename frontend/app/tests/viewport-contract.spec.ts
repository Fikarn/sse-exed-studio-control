import { expect, test } from "@playwright/test";

import { openFixture } from "./helpers/openFixture";

// plan PR 9 / workstream F1.
//
// Pins the hardware-viewport contract from
// `docs/HARDWARE_PROFILE.md` ("Primary target resolution: 2560×1440
// logical pixels on the fixed studio monitor. Minimum supported
// live-use resolution: 1920×1080.") against the breakpoints in
// `src/app/operatorLayout.ts::OPERATOR_LAYOUT_MINIMUMS`. If a future
// change tightens or loosens those numbers — or swaps the mode names —
// this spec fails, surfacing the contract break before a release.
//
// Cases cover:
//   - the primary target (2560×1440 → studioFull),
//   - the minimum live-use threshold (1920×1080 → studioFull),
//   - 1px below the studioFull threshold (1919×1080 → desktopCompact),
//   - 1px below the primary target (2559×1440 → studioFull;
//     proves the layout doesn't accidentally key off the documented
//     primary-target width).

interface ViewportCase {
  readonly width: number;
  readonly height: number;
  readonly expectedMode: "studioFull" | "desktopCompact" | "narrowUtility" | "constrained";
  readonly note: string;
}

const CASES: readonly ViewportCase[] = [
  {
    width: 2560,
    height: 1440,
    expectedMode: "studioFull",
    note: "primary target resolution",
  },
  {
    width: 1920,
    height: 1080,
    expectedMode: "studioFull",
    note: "minimum supported live-use resolution (at the studioFull threshold)",
  },
  {
    width: 1919,
    height: 1080,
    expectedMode: "desktopCompact",
    note: "1px below the studioFull threshold should drop to desktopCompact",
  },
  {
    width: 2559,
    height: 1440,
    expectedMode: "studioFull",
    note: "1px below the primary target must still be studioFull (layout keys off the studioFull threshold, not the primary target)",
  },
];

for (const { width, height, expectedMode, note } of CASES) {
  test(`${width}x${height} → ${expectedMode} (${note})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openFixture(page, "lighting-populated");

    const layoutMode = await page.locator("[data-operator-layout-root]").getAttribute("data-layout-mode");
    expect(layoutMode, `${width}x${height} should resolve to ${expectedMode}`).toBe(expectedMode);
  });
}
