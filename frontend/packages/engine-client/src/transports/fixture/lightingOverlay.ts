// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import { asArray, asBoolean, asString, cloneJson } from "./json";
import { clampNumber, lightingFixtures, lightingScenes } from "./lighting";
import { lightingFixtureCctRange } from "./lightingCatalog";

/** One identify flash, as `E/lighting/identify.rs` keeps it: when it starts and
 *  how long it lasts. A Find sequence schedules its flashes ahead. */
export interface IdentifyBurst {
  startedAtMs: number;
  durationMs: number;
}

/** The flashes by fixture id — the hardware link's `identify bursts` map. */
export type IdentifyBursts = Record<string, IdentifyBurst>;

/** The "open white" a highlighted fixture shows (`NEUTRAL_HIGHLIGHT_CCT`). */
export const NEUTRAL_HIGHLIGHT_CCT = 4500;

/** The hardware link's identify limits (`E/lighting/identify.rs`). */
export const IDENTIFY_DEFAULT_DURATION_MS = 1200;
export const IDENTIFY_MIN_MS = 100;
export const IDENTIFY_MAX_MS = 5000;
export const IDENTIFY_SEQUENCE_MAX_FIXTURES = 64;

/** A flash is lit from its start until its duration has passed; a scheduled one waits. */
export function identifyBurstActive(burst: IdentifyBurst, nowMs: number): boolean {
  return burst.startedAtMs <= nowMs && nowMs - burst.startedAtMs < burst.durationMs;
}

/** A stored id list (`highlightFixtureIds`, `soloFixtureIds`), sorted and without repeats. */
export function lightingIdList(value: unknown): string[] {
  return [...new Set(asArray(value).map((entry) => asString(entry)))].filter(Boolean).sort();
}

/**
 * The lighting snapshot as the hardware link reads it (`E/lighting/snapshot.rs`):
 * the stored state with the output overrides applied — an identify flash above
 * a highlight above the solo mask, so a light is never in two at once — and the
 * scenes pinned first, each cluster in the stored order. The stored fixtures are
 * never changed by an override, so a light comes back as it was when the
 * override ends.
 */
export function lightingSnapshotView(snapshot: JsonObject, bursts: IdentifyBursts, nowMs: number): JsonObject {
  const view = cloneJson(snapshot);
  const highlightIds = lightingIdList(view.highlightFixtureIds);
  const soloIds = lightingIdList(view.soloFixtureIds);
  const highlighted = new Set(highlightIds);
  const soloed = new Set(soloIds);
  const flashing = new Set(
    Object.entries(bursts)
      .filter(([, burst]) => identifyBurstActive(burst, nowMs))
      .map(([fixtureId]) => fixtureId)
  );

  view.fixtures = lightingFixtures(view).map((fixture) => {
    const fixtureId = asString(fixture.id);
    const cctRange = lightingFixtureCctRange(fixture);
    if (flashing.has(fixtureId)) {
      return { ...fixture, intensity: 100, on: true, cct: cctRange.max };
    }
    if (highlighted.has(fixtureId)) {
      return {
        ...fixture,
        intensity: 100,
        on: true,
        cct: clampNumber(NEUTRAL_HIGHLIGHT_CCT, cctRange.min, cctRange.max),
      };
    }
    if (soloed.size > 0 && !soloed.has(fixtureId)) {
      return { ...fixture, intensity: 0, on: false };
    }
    return fixture;
  });

  const scenes = lightingScenes(view).map((scene) => ({ ...scene, pinned: asBoolean(scene.pinned, false) }));
  view.scenes = [...scenes.filter((scene) => scene.pinned), ...scenes.filter((scene) => !scene.pinned)];
  view.highlightFixtureIds = highlightIds;
  view.soloFixtureIds = soloIds;
  return view;
}
