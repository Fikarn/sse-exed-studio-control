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
import { SAMPLES_CONTRAST, checkRatchet, measureBoard, openBoard } from "./helpers/ui-contract/measure.mjs";
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
//
// New pages program, Slice SW (D22): the contrast is sampled on Windows only
// (`SAMPLES_CONTRAST` in measure.mjs). On CI's Linux runner every other measure
// is checked and the contrast is not.

const RATCHETS = JSON.parse(readFileSync(new URL("./ui-contract.ratchets.json", import.meta.url), "utf8")) as Record<
  string,
  Record<string, number | boolean | null>
>;

interface ContrastFail {
  ratio: number;
  size: number;
  text: string;
  el: string;
  color: string;
  bg: string;
}

/** The worst sampled contrast for a failure report, or why there is none. */
function worstContrast(contrast: { fails: ContrastFail[] } | null, count: number, separator: string) {
  if (contrast === null) return "not sampled off Windows";
  return contrast.fails
    .slice(0, count)
    .map((f) => `${f.ratio}:1 ${f.size}px "${f.text}" ${f.el} ${f.color} on ${f.bg}`)
    .join(separator);
}

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
          ? `\n${JSON.stringify(measures, null, 1)}\nworst contrast: ${worstContrast(contrast, 8, "\n")}`
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
  // A loading board is the one kind of board allowed to move at rest, so it is
  // the honest board to prove the setting on: with reduced motion asked for,
  // nothing on it runs. New pages program, Slice 1: the board is the Console's
  // loading skeleton. Old: Planning's, whose sweep left with Planning — and it
  // was the only animation running at rest on any board, so the case now adds
  // a probe that would run forever: it must run without the setting (the
  // control), and stop with it, which only the app-wide rule in global.css can
  // do.
  test("prefers-reduced-motion stops everything, the loading skeleton included", async ({ page }) => {
    const addProbe = () =>
      page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent =
          "@keyframes reducedMotionProbe { to { opacity: 0.5; } } " +
          "#reduced-motion-probe { animation: reducedMotionProbe 1s linear infinite; }";
        document.head.appendChild(style);
        const probe = document.createElement("div");
        probe.id = "reduced-motion-probe";
        document.body.appendChild(probe);
      });
    const running = () =>
      page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length);

    await openBoard(page, "audio-loading", "studio");
    await addProbe();
    expect(await running(), "the probe must run while motion is allowed").toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBoard(page, "audio-loading", "studio");
    await addProbe();
    await expect.poll(running, { message: "reduced motion left something running" }).toBe(0);
  });

  // The state display sits at the same x-band on every workspace (system §2);
  // measured once the regions are declared (Slice 2).
  test("the state display keeps one x-band across the workspaces", async ({ page }) => {
    const xs: Array<{ fixture: string; x: number }> = [];
    for (const fixture of ["audio-populated", "lighting-populated", "setup-ready", "teleprompter-ready"]) {
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

  // 2026-09 production readiness, Slice 11: held light outputs are a state no
  // fixture board shows — a board of its own would be three more boards, three
  // more baselines per platform and a re-seed, for one amber readout and one
  // lit key. It is measured here instead: the Setup board, the Held key
  // pressed, and the same census against the same board's ratchet, in every
  // theme. What the state adds — the amber `nothing is sent to the rig`, the
  // engaged Held key, the new Recent actions row — may not move a measure the
  // wrong way.
  //
  // The pilot's feedback band is on screen here (every plate action shows it)
  // and on no board. Until readiness Slice 14 it carried a pre-A gradient and
  // this case allowed it by name and count; it is on system A's material now
  // and is measured like everything else.
  for (const theme of THEMES) {
    test(`setup-ready @ ${theme} holds its ratchet with the light outputs held`, async ({ page }) => {
      const ratchet = RATCHETS[boardName("setup-ready", theme)];
      expect(ratchet, "no ratchet seeded for setup-ready").toBeTruthy();
      await openBoard(page, "setup-ready", theme);
      await page.getByTestId("support-outputs-held").click();
      await expect(page.getByTestId("support-outputs-held")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("setup-feedback")).toContainText("nothing is sent to the rig");
      await expect(page.getByTestId("support-recent-action").first()).toContainText("Light outputs held");
      // The band's enter transition and the key's press have to be at rest.
      await page.waitForTimeout(1000);
      const { census, measures, contrast } = await measureBoard(page);
      const offPolicy: string[] = census.light.gradientsOffEls;
      const problems = checkRatchet(measures, ratchet!);
      const detail = problems.length
        ? `\n${JSON.stringify(measures, null, 1)}\noff-policy gradients: ${offPolicy.join(", ")}\nworst contrast: ${worstContrast(contrast, 8, "\n")}`
        : "";
      expect(problems, `setup-ready @ ${theme}, held, moved the wrong way:${detail}`).toEqual([]);
    });
  }
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
    test(`${story.name} passes the light, target, radius and type checks, and contrast on Windows`, async ({
      page,
    }) => {
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
      // Slice SW (D22): the contrast is judged where it is sampled, on Windows.
      if (SAMPLES_CONTRAST && measures.contrastFails !== 0)
        problems.push(`${measures.contrastFails} contrast failures: ${worstContrast(contrast, 6, " · ")}`);
      expect(problems, `${story.name}: ${JSON.stringify(measures)}`).toEqual([]);
    });
  }
});

// New pages program, the workstation catch-up: the census measures a text where
// it is on screen. The Teleprompter's editor opens scrolled to the reading line,
// and in Bone the lines scrolled out of its dark field lay over the light header
// and footer, where the sampler read them as white on white — four failures no
// operator could see. A field scrolled over a light page holds the rule, and the
// cases around it hold what may clip a text and what may not (the catch-up's
// review): a positioned text escaping a clipping box, a containing block made
// by a transform, one axis clipped, and boxes `overflow` does not apply to.
test.describe("UI contract — the census", () => {
  test("measures a scrolled field's text only where the field shows it", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const dark = "color:rgb(20,20,20)";
    const lines = Array.from({ length: 10 }, (_, i) => `<p style="margin:0;height:60px">Line ${i + 1}</p>`).join("");
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:rgb(242,242,238);font:20px/1.5 sans-serif">` +
        `<div style="height:100px"></div>` +
        `<div id="field" style="height:200px;overflow:auto;background:rgb(16,16,18);color:rgb(244,244,245)">${lines}` +
        // Fixed, with no containing block but the viewport: the field does not clip it.
        `<span style="position:fixed;left:500px;top:20px;${dark}">Fixed note</span></div>` +
        // Absolute: it escapes the static box that clips, to the positioned box around it.
        `<div style="position:relative;height:60px"><div style="overflow:hidden;width:100px;height:20px">` +
        `<span style="position:absolute;left:400px;top:20px;${dark}">Absolute note</span></div></div>` +
        // One axis: a box that clips across only, with the text below it.
        `<div style="overflow-x:clip;overflow-y:visible;width:300px;height:10px">` +
        `<p style="margin:0;display:inline-block;position:relative;top:10px;white-space:nowrap;${dark}">` +
        `Below the clip box, and cut at its right edge</p></div>` +
        `<div style="height:40px;margin-top:50px;${dark}"><span style="overflow:hidden"><b>Inline bold</b> tail</span></div>` +
        `<svg width="300" height="40" style="display:block"><svg width="300" height="40">` +
        `<text x="0" y="28" font-size="20" fill="rgb(20,20,20)">Inner svg text</text></svg></svg>` +
        // A transform makes the containing block of a fixed text, and clips it.
        `<div style="transform:translateZ(0);overflow:hidden;width:200px;height:30px">` +
        `<p style="position:fixed;left:0;top:60px;margin:0;${dark}">Fixed in a transform</p></div>` +
        `</body></html>`
    );
    // The field shows its content from 150 to 350: lines 3 and 6 in part, 4 and 5 whole.
    await page.evaluate(() => {
      document.getElementById("field")!.scrollTop = 150;
    });
    const { census, contrast } = await measureBoard(page);
    const texts = census.texts as Array<{
      text: string;
      clippedOut: boolean;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
    const find = (text: string) => texts.find((t) => t.text === text);
    const line = (n: number) => find(`Line ${n}`);
    for (const n of [1, 2, 7, 8, 9, 10]) expect(line(n)?.clippedOut, `Line ${n}`).toBe(true);
    for (const n of [3, 4, 5, 6]) expect(line(n)?.clippedOut, `Line ${n}`).toBe(false);
    expect([line(3)?.y, line(3)?.h]).toEqual([100, 30]);
    expect([line(4)?.y, line(4)?.h]).toEqual([130, 60]);
    expect([line(6)?.y, line(6)?.h]).toEqual([250, 50]);
    for (const shown of ["Fixed note", "Absolute note", "Inline bold", "Inner svg text"])
      expect(find(shown)?.clippedOut, shown).toBe(false);
    const below = find("Below the clip box, and cut at its right edge");
    expect([below?.clippedOut, below?.x, below?.w]).toEqual([false, 0, 300]);
    expect(find("Fixed in a transform")?.clippedOut, "Fixed in a transform").toBe(true);
    expect(census.clippedOutTexts).toBe(7);
    // On Windows the sampler reads every text on screen, the four lines against
    // the dark field and the rest against the page, and none of those out of sight.
    if (SAMPLES_CONTRAST) {
      expect(contrast?.measured).toBe(texts.length - 7);
      expect(worstContrast(contrast, 6, " · ")).toBe("");
    }
  });
});
