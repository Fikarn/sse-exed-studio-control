// The boards the UI contract measures: every fixture in `fixtures.json` at
// the one surface that matters (2560×1440, operator ruling 2026-09-07, plan
// D4) in the three themes.
import { readFileSync } from "node:fs";

export const SURFACE = { width: 2560, height: 1440, label: "2560x1440" };
export const THEMES = ["studio", "graphite", "bone"];
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

export function boardName(fixture, theme) {
  return `${fixture}__${theme}`;
}

export function fixtureUrl(fixture, theme) {
  const params = new URLSearchParams({ fixture, transport: "fixture" });
  if (theme !== "studio") params.set("theme", theme);
  return `/?${params.toString()}`;
}

// The chrome budget of plan D4 at 2560×1440; a declared `[data-region]` must
// sit within ±2 px of its number. Regions are declared by Slice 2; until then
// the census reports how many of the five are present.
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

// The system's thresholds (system §10) — what every ratchet tightens towards.
export const TARGETS = {
  minFontSize: 12,
  maxFontSizes: 8,
  families: ["Inter", "JetBrains Mono"],
  minTarget: 24,
  minTake: 28,
};
