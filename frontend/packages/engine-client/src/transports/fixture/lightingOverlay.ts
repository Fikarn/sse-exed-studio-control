// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import { asArray, asBoolean, asNumber, asRecord, asString, cloneJson } from "./json";
import { clampNumber, lightingFixtures, lightingScenes } from "./lighting";
import { fixtureProfileForFixture, lightingFixtureCctRange } from "./lightingCatalog";

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

/**
 * Whether the rig holds the live scene (`E/lighting/scene_state.rs`): the
 * last recalled scene, else the selected one, against the stored fixtures.
 * `preview` while previewing, `none` with no scene, `chosen` when the live
 * scene is not the one last put on the rig, else `live` or `unsaved`. The
 * double recalls without a fade, so its stored rig is the fade's end.
 */
export function lightingSceneState(snapshot: JsonObject): string {
  if (asBoolean(snapshot.previewMode, false)) return "preview";
  const scenes = lightingScenes(snapshot);
  // A test scenario may mark the recalled scene by its flag alone, as the
  // hardware link's scenes carry it (`lastRecalled`).
  const lastRecalled =
    asString(scenes.find((entry) => asBoolean(entry.lastRecalled, false))?.id) ||
    asString(snapshot.lastRecalledSceneId);
  const scene =
    scenes.find((entry) => asString(entry.id) === lastRecalled && lastRecalled !== "") ??
    scenes.find((entry) => asString(entry.id) === asString(snapshot.selectedSceneId));
  if (!scene) return "none";
  if (asString(scene.id) !== lastRecalled) return "chosen";
  const saved = asArray(scene.fixtureStates)
    .map((state) => asRecord(state))
    .filter((state): state is JsonObject => state !== null);
  const holds = lightingFixtures(snapshot).every((fixture) => {
    const state = saved.find((entry) => asString(entry.fixtureId) === asString(fixture.id));
    const on = asBoolean(fixture.on, false);
    const intensity = asNumber(fixture.intensity, 0);
    if (!state) return !(on && intensity > 0);
    if (asBoolean(state.on, false) !== on) return false;
    const controls = asRecord(fixture.controlValues) ?? {};
    const savedControls = asRecord(state.controlValues) ?? {};
    const hasCct =
      fixtureProfileForFixture(fixture).channels.some((channel) => asString(channel.controlId) === "cct") ||
      Object.prototype.hasOwnProperty.call(controls, "cct");
    if (on && Math.abs(asNumber(state.intensity, 0) - intensity) > 0.5) return false;
    if (on && hasCct && Math.abs(asNumber(state.cct, 0) - asNumber(fixture.cct, 0)) > 25) return false;
    const keys = new Set([...Object.keys(controls), ...Object.keys(savedControls)]);
    return [...keys]
      .filter((key) => key !== "intensity" && key !== "cct")
      .every((key) => Math.abs(asNumber(controls[key], 0) - asNumber(savedControls[key], 0)) <= 0.5);
  });
  return holds ? "live" : "unsaved";
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

  // Decided on the stored rig, before the overrides, as the hardware link
  // decides it (2026-10-03).
  view.sceneState = lightingSceneState(snapshot);
  view.recallFadeMs = asNumber(snapshot.recallFadeMs, 0);

  const scenes = lightingScenes(view).map((scene) => ({ ...scene, pinned: asBoolean(scene.pinned, false) }));
  view.scenes = [...scenes.filter((scene) => scene.pinned), ...scenes.filter((scene) => !scene.pinned)];
  view.highlightFixtureIds = highlightIds;
  view.soloFixtureIds = soloIds;
  return view;
}
