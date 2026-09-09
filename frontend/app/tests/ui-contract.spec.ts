import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURES,
  SURFACE,
  STATE_DISPLAY_X_TOLERANCE_PX,
  THEMES,
  boardName,
  isLoading,
} from "./helpers/ui-contract/boards.mjs";
import { checkRatchet, measureBoard, openBoard } from "./helpers/ui-contract/measure.mjs";
import { TARGETS } from "./helpers/ui-contract/boards.mjs";

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

  // Visual overhaul A, Slice 9 (system §6): "Nothing on an idle surface
  // animates." The ratchet lets a count fall; this says the floor for a ready
  // board is zero, so a new pulse cannot be seeded in. A loading board is not
  // idle — its skeleton sweep is what says the app has not finished — so the
  // loading families are excluded by name, not by ratchet.
  for (const fixture of FIXTURES.filter((name) => !isLoading(name))) {
    test(`${fixture} animates nothing at rest`, async ({ page }) => {
      await openBoard(page, fixture, "studio");
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running")
          .map((animation) => {
            const target = animation.effect && "target" in animation.effect ? animation.effect.target : null;
            const name =
              ("animationName" in animation ? (animation as { animationName?: string }).animationName : null) ??
              ("transitionProperty" in animation
                ? `transition:${(animation as { transitionProperty?: string }).transitionProperty}`
                : "animation");
            const el = target instanceof Element ? `${target.tagName.toLowerCase()}.${target.className}` : "?";
            return `${el} ${name}`;
          })
      );
      expect(running, `${fixture} is still moving at rest`).toEqual([]);
    });
  }

  // Slice 9 (system §6): "prefers-reduced-motion removes enter, exit and move."
  // The loading skeleton is the one thing the app animates on purpose, so it is
  // the honest board to prove the setting on: with reduced motion asked for,
  // even it stops.
  test("prefers-reduced-motion stops everything, the loading skeleton included", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBoard(page, "planning-loading-board", "studio");
    const running = await page.evaluate(
      () => document.getAnimations().filter((animation) => animation.playState === "running").length
    );
    expect(running, "reduced motion left something running").toBe(0);
  });

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

// Visual overhaul A, Slice 3: the primitives' Storybook pages pass the
// system's light, target, radius, type and contrast checks outright — no
// ratchet, since they are new. The stories live under
// "Design System/A primitives" and are served by the Storybook static server
// (built by `npm run frontend:storybook:build`, chained into
// `frontend:playwright:test`); the lane skips when no build is present.
const STORYBOOK_INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../storybook-static/index.json");
const A_STORIES: Array<{ id: string; name: string }> = existsSync(STORYBOOK_INDEX)
  ? Object.values(
      (
        JSON.parse(readFileSync(STORYBOOK_INDEX, "utf8")) as {
          entries: Record<string, { id: string; name: string; title: string }>;
        }
      ).entries
    )
      .filter((entry) => entry.title === "Design System/A primitives")
      .map((entry) => ({ id: entry.id, name: entry.name }))
  : [];

test.describe("UI contract — the A primitives on their Storybook pages", () => {
  test.skip(A_STORIES.length === 0, "storybook-static is not built; run npm run frontend:storybook:build");
  test.use({ viewport: { width: SURFACE.width, height: SURFACE.height } });

  for (const story of A_STORIES) {
    test(`${story.name} passes the light, target, radius, type and contrast checks`, async ({ page }) => {
      await page.goto(`http://127.0.0.1:6007/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, {
        waitUntil: "networkidle",
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const { measures, contrast } = await measureBoard(page);
      const problems: string[] = [];
      if (measures.minFontSize !== null && measures.minFontSize < TARGETS.minFontSize)
        problems.push(`type floor ${measures.minFontSize} < ${TARGETS.minFontSize}`);
      if (measures.offFamilyText > 0)
        problems.push(`${measures.offFamilyText} text nodes outside Inter / JetBrains Mono`);
      if (measures.radiiOff > 0) problems.push(`${measures.radiiOff} elements with a radius outside {4, 8, 12, pill}`);
      if (measures.smallTargets > 0) problems.push(`${measures.smallTargets} targets under ${TARGETS.minTarget} px`);
      if (measures.smallTake > 0) problems.push(`${measures.smallTake} take-time targets under ${TARGETS.minTake} px`);
      if (measures.shadowNegative > 0) problems.push(`${measures.shadowNegative} shadows with a negative offset`);
      if (measures.blurOver8Unlit > 0) problems.push(`${measures.blurOver8Unlit} blurs over 8 px on unlit elements`);
      if (measures.gradientsOff > 0) problems.push(`${measures.gradientsOff} gradients off policy`);
      if (measures.contrastFails > 0)
        problems.push(
          `${measures.contrastFails} contrast failures: ` +
            contrast.fails
              .slice(0, 6)
              .map((f) => `${f.ratio}:1 ${f.size}px "${f.text}" ${f.el} ${f.color} on ${f.bg}`)
              .join(" · ")
        );
      expect(problems, `${story.name}: ${JSON.stringify(measures)}`).toEqual([]);
    });
  }
});
