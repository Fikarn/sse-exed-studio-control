import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { FIXTURES, SURFACE, STATE_DISPLAY_X_TOLERANCE_PX, THEMES, boardName } from "./helpers/ui-contract/boards.mjs";
import { checkRatchet, measureBoard, openBoard } from "./helpers/ui-contract/measure.mjs";

// Visual overhaul A, Slice 0 — the UI contract lanes (system §10 as tests).
//
// Every fixture × 2560×1440 × {studio, graphite, bone} is rendered and
// measured by the same census and pixel sampler that measured the A mocks
// (`gold-standard-evidence-2026-09/probe/`): page scroll, the type census
// (floor, distinct sizes, families), radii, pointer targets (`data-take` marks
// take-time controls), pixel-sampled text contrast from the screenshot, the
// light census (shadow direction and blur, gradients, backdrop blur), idle
// animations, the chrome regions against plan D4, targets off the viewport and
// the operator-copy scan.
//
// The numbers are ratchets seeded at the current program's values
// (`ui-contract.ratchets.json`, written by `node scripts/ui-census.mjs
// --write-ratchets`) and tightened per slice towards the system's thresholds:
// a count may only fall, a floor may only rise, and a board that scrolls today
// may not start scrolling. Re-seed only at a slice close, after inspecting the
// diff — the diff is the "numbers that moved" report.

const RATCHETS = JSON.parse(readFileSync(new URL("./ui-contract.ratchets.json", import.meta.url), "utf8")) as Record<
  string,
  Record<string, number | boolean | null>
>;

test.describe("UI contract", () => {
  test.use({ viewport: { width: SURFACE.width, height: SURFACE.height } });
  // One retry absorbs antialiasing jitter under parallel load (a board that
  // measured one node either side of its seed on one run in three); a real
  // regression fails both runs.
  test.describe.configure({ retries: 1 });

  for (const theme of THEMES) {
    for (const fixture of FIXTURES) {
      const name = boardName(fixture, theme);
      test(`${fixture} @ ${theme} holds its ratchet`, async ({ page }) => {
        const ratchet = RATCHETS[name];
        expect(ratchet, `no ratchet seeded for ${name}; run node scripts/ui-census.mjs --write-ratchets`).toBeTruthy();
        await openBoard(page, fixture, theme);
        const { measures, contrast } = await measureBoard(page);
        const problems = checkRatchet(measures, ratchet!);
        const detail = problems.length
          ? `\n${JSON.stringify(measures, null, 1)}\nworst contrast: ${contrast.fails
              .slice(0, 8)
              .map((f) => `${f.ratio}:1 ${f.size}px "${f.text}" ${f.el} ${f.color} on ${f.bg}`)
              .join("\n")}`
          : "";
        expect(problems, `${name} moved the wrong way:${detail}`).toEqual([]);
      });
    }
  }

  // The state display sits at the same x-band on every workspace (system §2);
  // measured once the regions are declared (Slice 2).
  test("the state display keeps one x-band across the workspaces", async ({ page }) => {
    const xs: Array<{ fixture: string; x: number }> = [];
    for (const fixture of ["audio-populated", "lighting-populated", "planning-populated", "setup-ready"]) {
      await openBoard(page, fixture, "studio");
      const { measures } = await measureBoard(page);
      if (measures.stateDisplayX !== null) xs.push({ fixture, x: measures.stateDisplayX });
    }
    test.info().annotations.push({ type: "state-display-x", description: JSON.stringify(xs) });
    if (xs.length < 2) return;
    const min = Math.min(...xs.map((v) => v.x));
    const max = Math.max(...xs.map((v) => v.x));
    expect(max - min, `state display x-band drifts: ${JSON.stringify(xs)}`).toBeLessThanOrEqual(
      STATE_DISPLAY_X_TOLERANCE_PX
    );
  });
});
