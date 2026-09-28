// The boards the layout gate measures: every fixture in `fixtures.json` at the
// one surface that matters (2560×1440, D22), in the one theme (Studio, D25).
import { readFileSync } from "node:fs";

export const SURFACE = { width: 2560, height: 1440, label: "2560x1440" };
export const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

const fixtureMap = JSON.parse(
  readFileSync(new URL("../../../../packages/test-fixtures/src/fixtures.json", import.meta.url), "utf8")
);
export const FIXTURES = Object.keys(fixtureMap);

// Pre-ready families never hydrate the audio snapshot, so they skip the
// `html[data-audio-hydrated]` wait the operator surfaces need (the same rule as
// `visual-review.spec.ts`).
export function isPreReady(fixture) {
  return fixture.startsWith("protocol-") || fixture.startsWith("bootstrap-") || fixture.startsWith("startup");
}

// Visual overhaul A, Slice 9 (system §6): "nothing on an idle surface
// animates" is a rule about a surface at rest. A board that is still loading is
// not at rest — its skeleton sweep is the only thing telling the operator the
// app has not finished — so the idle-animation gate reads the ready boards.
export function isLoading(fixture) {
  return fixture.includes("loading") || fixture.startsWith("startup");
}

// New pages program, Slice 6b: a board a page reaches by a press, not by its
// data alone — the Teleprompter's editor is the bay's second view, chosen on
// the page. The fixture holds the data; these are the presses that bring the
// page to the board, and the mark that says it is there.
export const BOARD_STEPS = {
  "teleprompter-editing": {
    presses: ["teleprompter-bay-edit"],
    ready: "[data-testid=teleprompter-editor-text][contenteditable=true]",
  },
  "teleprompter-new-script": {
    presses: ["teleprompter-new-script"],
    ready: "[data-testid=teleprompter-editor-text][contenteditable=true]",
  },
};

/** Presses a fixture's board steps, if it has any, and waits for its mark. */
export async function stepToBoard(page, fixture) {
  const steps = BOARD_STEPS[fixture];
  if (!steps) return;
  for (const testId of steps.presses) await page.getByTestId(testId).click();
  await page.waitForSelector(steps.ready, { timeout: 10_000 });
}

export function fixtureUrl(fixture) {
  return `/?${new URLSearchParams({ fixture, transport: "fixture" }).toString()}`;
}

// The chrome budget of plan D4 at 2560×1440; a declared `[data-region]` must
// sit within ±2 px of its number.
export const D4_CHROME = {
  header: { h: 56 },
  footer: { h: 40 },
  cluster: { w: 424 },
  plate: { w: 416 },
  "state-display": { h: 180 },
};
export const CHROME_TOLERANCE_PX = 2;
// The state display must sit at the same x-band on every workspace (±8 px).
export const STATE_DISPLAY_X_TOLERANCE_PX = 8;

// The system's thresholds (docs/DESIGN.md, section 10).
export const TARGETS = {
  minFontSize: 12,
  maxFontSizes: 8,
  families: ["Inter", "JetBrains Mono"],
  minTarget: 24,
  minTake: 28,
};

// What every board holds. Until 2026-09-28 each board had numbers of its own
// in `ui-contract.ratchets.json`, seeded from what it measured and tightened
// by hand; across its boards thirteen of the sixteen numbers were these.
export const LIMITS = {
  /** No text under the type floor. */
  minFontSize: TARGETS.minFontSize,
  /** At most this many type sizes on one board. */
  sizeCount: TARGETS.maxFontSizes,
  /** Texts set in a family other than the two. */
  offFamilyText: 0,
  radiiOff: 0,
  smallTargets: 0,
  smallTake: 0,
  contrastFails: 0,
  shadowNegative: 0,
  blurOver8Unlit: 0,
  gradientsOff: 0,
  backdropBlur: 0,
  runningAnimations: 0,
  offViewport: 0,
  /** Words the operator never reads ("engine", "OSC ping"…), on the screen as drawn. */
  copyHits: 0,
  /** Header, cluster, state display, plate and footer. */
  regionsPresent: 5,
};

// The boards that differ, each with its reason. A number here is a limit like
// the others: the board may do better and may not do worse.
const FRAUNCES = "Fraunces, the display face of the design before A, still prints";
export const EXCEPTIONS = {
  // No workspace is on these screens: a header and a state display.
  "startup-loading": { regionsPresent: 2 },
  "bootstrap-failed": {
    regionsPresent: 2,
    offFamilyText: [3, `${FRAUNCES} the three check titles of the recovery screen`],
  },
  "protocol-mismatch": {
    regionsPresent: 2,
    offFamilyText: [3, `${FRAUNCES} the three check titles of the recovery screen`],
  },
  // The Console's loading surface stands in for its cluster, plate and display.
  "audio-loading": { regionsPresent: 2 },
  // Setup has no cluster: its runner takes the bay's whole width.
  "setup-required": { regionsPresent: 4 },
  "setup-ready": { regionsPresent: 4 },
  "setup-degraded": { regionsPresent: 4 },
  "lighting-empty": { offFamilyText: [1, `${FRAUNCES} the scene's name`] },
  "lighting-loading": { offFamilyText: [1, `${FRAUNCES} the scene's name`] },
  "lighting-populated": { offFamilyText: [4, `${FRAUNCES} the scenes' names and the plot's pill`] },
  "lighting-patch-overlap": { offFamilyText: [4, `${FRAUNCES} the scenes' names and the plot's pill`] },
  "lighting-dmx-unreachable": { offFamilyText: [4, `${FRAUNCES} the scenes' names and the plot's pill`] },
  "lighting-populated-noselect": {
    offFamilyText: [8, `${FRAUNCES} the scenes' names, the plot's pill and the scene's four figures`],
  },
};

/** The limits of one board: the common ones, with the board's own in their place. */
export function limitsOf(fixture) {
  const own = Object.fromEntries(
    Object.entries(EXCEPTIONS[fixture] ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );
  return { ...LIMITS, ...own };
}
