// One board, measured: the in-page census plus the pixel-sampled contrast of
// the same render. Shared by `tests/ui-contract.spec.ts` (the gate) and
// `scripts/ui-census.mjs` (the human-readable census and the ratchet seeds),
// so the numbers the gate asserts are the numbers the census prints.
import { censusInPage } from "./census.mjs";
import { sampleContrast } from "./contrast.mjs";
import { decodePng } from "./png.mjs";
import { CHROME_TOLERANCE_PX, D4_CHROME, FIXTURE_NOW, SURFACE, TARGETS, fixtureUrl, isPreReady } from "./boards.mjs";

/**
 * Navigate a page to a fixture board and let it settle: hydration, the theme
 * attribute, fonts, then one second for transitions to end so the idle
 * animation count is honest.
 * @param {import("@playwright/test").Page} page
 */
export async function openBoard(page, fixture, theme) {
  await page.clock.setFixedTime(FIXTURE_NOW);
  const response = await page.goto(fixtureUrl(fixture, theme), { waitUntil: "networkidle" });
  if (!response || response.status() >= 400) throw new Error(`fixture ${fixture} did not load`);
  if (!isPreReady(fixture)) {
    // A loading fixture (audio-loading) never hydrates; measure it as it is.
    await page
      .waitForSelector("html[data-audio-hydrated]", { state: "attached", timeout: 10_000 })
      .catch(() => undefined);
  }
  if (theme !== "studio") {
    await page.waitForSelector(`html[data-theme="${theme}"]`, { state: "attached" });
  }
  await page.evaluate(() => document.fonts.ready);
  // Let every finite animation (enter transitions, banner fades) finish before
  // measuring, so the idle count and the sampled pixels are the board at rest;
  // infinite animations (an idle pulse) are what the idle census must catch.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => {
            const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
            return t !== null && Number.isFinite(t.iterations) && t.duration !== Infinity;
          })
          .map((a) => a.finished.catch(() => undefined))
      ),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ])
  );
  await page.waitForTimeout(1000);
}

/**
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ census: ReturnType<typeof censusInPage>, measures: object, png: Buffer }>}
 */
export async function measureBoard(page) {
  const census = await page.evaluate(censusInPage);
  const png = await page.screenshot({ type: "png", fullPage: false, animations: "allow" });
  const decoded = decodePng(png);
  const contrast = sampleContrast(decoded, census.texts);
  return { census, contrast, png, measures: summarize(census, contrast) };
}

/** The numbers the gate ratchets and the census prints, from one census. */
export function summarize(c, contrast) {
  const enabled = c.targets.filter((t) => !t.disabled);
  const take = enabled.filter((t) => t.take);
  const smallTargets = enabled.filter((t) => t.minSide < TARGETS.minTarget);
  const smallTake = take.filter((t) => t.minSide < TARGETS.minTake);
  const offFamily = c.families.filter(([f]) => !TARGETS.families.includes(f)).reduce((n, [, k]) => n + k, 0);
  const regionsOff = [];
  const regionsPresent = [];
  for (const r of c.regions) {
    const want = D4_CHROME[r.name];
    if (!want) continue;
    regionsPresent.push(r.name);
    if (want.h !== undefined && Math.abs(r.h - want.h) > CHROME_TOLERANCE_PX) regionsOff.push(`${r.name} h=${r.h}`);
    if (want.w !== undefined && Math.abs(r.w - want.w) > CHROME_TOLERANCE_PX) regionsOff.push(`${r.name} w=${r.w}`);
  }
  const stateDisplay = c.regions.find((r) => r.name === "state-display");
  return {
    text: c.textCount,
    minFontSize: c.minFontSize,
    fontSizes: c.fontSizes.map(([s, n]) => `${s}:${n}`).join(" "),
    sizeCount: c.fontSizes.length,
    families: c.families.map(([f, n]) => `${f}:${n}`).join(" "),
    offFamilyText: offFamily,
    uppercase: c.uppercase,
    bold: c.weights.filter(([w]) => parseInt(w, 10) >= 700).reduce((a, [, n]) => a + n, 0),
    targets: c.targets.length,
    smallTargets: smallTargets.length,
    minTarget: enabled.reduce((m, t) => Math.min(m, t.minSide), 999),
    take: take.length,
    smallTake: smallTake.length,
    minTake: take.reduce((m, t) => Math.min(m, t.minSide), 999),
    radii: c.radii.map(([r, n]) => `${r}:${n}`).join(" "),
    radiiOff: c.radiiOff,
    contrastMeasured: contrast.measured,
    contrastFails: contrast.fails.length,
    shadows: c.light.shadows,
    shadowNegative: c.light.outerNegativeOffset,
    blurOver8: c.light.outerBlurOver8,
    blurOver8Unlit: c.light.outerBlurOver8Unlit,
    gradients: c.light.gradients,
    gradientsOff: c.light.gradientsOffPolicy,
    backdropBlur: c.light.backdropBlur,
    runningAnimations: c.motion.runningAnimations,
    cssAnimated: c.motion.cssAnimated,
    transitions: c.motion.transitions,
    textColours: c.textColorCount,
    bgColours: c.bgColorCount,
    scrolls: c.scroll.docW > SURFACE.width + 1 || c.scroll.docH > SURFACE.height + 1,
    scroll: `${c.scroll.docW}x${c.scroll.docH}`,
    offViewport: c.offViewport,
    regionsPresent: regionsPresent.length,
    regionsOff,
    stateDisplayX: stateDisplay ? stateDisplay.x : null,
    copyHits: c.copy.length,
  };
}

// The ratchet a board must satisfy: counts may only fall, floors only rise.
// Returns the list of violations (empty when the board holds its ratchet).
export function checkRatchet(measures, ratchet) {
  const problems = [];
  const atMost = (key) => {
    if (ratchet[key] === undefined) return;
    if (measures[key] > ratchet[key]) problems.push(`${key}: ${measures[key]} > ratchet ${ratchet[key]}`);
  };
  const atLeast = (key) => {
    if (ratchet[key] === undefined || ratchet[key] === null) return;
    if (measures[key] === null || measures[key] < ratchet[key])
      problems.push(`${key}: ${measures[key]} < ratchet ${ratchet[key]}`);
  };
  atLeast("minFontSize");
  atMost("sizeCount");
  atMost("offFamilyText");
  atMost("radiiOff");
  atMost("smallTargets");
  atMost("smallTake");
  atMost("contrastFails");
  atMost("shadowNegative");
  atMost("blurOver8Unlit");
  atMost("gradientsOff");
  atMost("backdropBlur");
  atMost("runningAnimations");
  atMost("offViewport");
  atMost("copyHits");
  atLeast("regionsPresent");
  if (ratchet.scrolls === false && measures.scrolls) problems.push(`page scrolls (${measures.scroll})`);
  if (measures.regionsOff.length) problems.push(`chrome off D4: ${measures.regionsOff.join(", ")}`);
  return problems;
}

// What the ratchet file stores per board: the ratcheted keys only, so a
// re-seed diff reads as "the numbers that moved".
export const RATCHET_KEYS = [
  "minFontSize",
  "sizeCount",
  "offFamilyText",
  "radiiOff",
  "smallTargets",
  "smallTake",
  "contrastFails",
  "shadowNegative",
  "blurOver8Unlit",
  "gradientsOff",
  "backdropBlur",
  "runningAnimations",
  "offViewport",
  "copyHits",
  "regionsPresent",
  "scrolls",
];

export function ratchetFrom(measures) {
  const out = {};
  for (const key of RATCHET_KEYS) out[key] = measures[key];
  return out;
}
