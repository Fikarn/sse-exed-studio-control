import type { LightingFixtureCatalogSnapshot, LightingSceneSnapshot, LightingSnapshot } from "@sse/engine-client";

import { getFixtureModeForFixture } from "./fixtureCatalog";

/** Structural shape both LightingFixtureSnapshot and the workspace's adapted
 *  fixture entries satisfy, so the comparison helpers serve the workspace
 *  guard AND the shell chrome without re-mapping. */
export type FixtureSceneComparisonSource = {
  cct: number;
  controlValues?: Record<string, number> | null;
  definitionId: string;
  id: string;
  intensity: number;
  kind: string;
  modeId: string;
  on: boolean;
  type: string;
};

export function fixtureHasCctControl(
  fixture: FixtureSceneComparisonSource,
  catalog: LightingFixtureCatalogSnapshot | null
): boolean {
  return (
    getFixtureModeForFixture(catalog, fixture)?.channels.some((channel) => channel.controlId === "cct") ??
    Object.prototype.hasOwnProperty.call(fixture.controlValues ?? {}, "cct")
  );
}

export function fixtureStatesEqual(
  fixtures: ReadonlyArray<{
    id: string;
    intensity: number;
    cct: number;
    on: boolean;
    hasCctControl: boolean;
    controlValues?: Record<string, number> | null;
  }>,
  sceneStates: ReadonlyArray<{
    fixtureId: string;
    intensity: number;
    cct: number;
    on: boolean;
    controlValues?: Record<string, number> | null;
  }>
): boolean {
  if (fixtures.length === 0 && sceneStates.length === 0) return true;
  const sceneById = new Map(sceneStates.map((state) => [state.fixtureId, state]));
  for (const fixture of fixtures) {
    const sceneState = sceneById.get(fixture.id);
    if (!sceneState) {
      // Fixture present but not in saved scene → drift if currently on.
      if (fixture.on && fixture.intensity > 0) return false;
      continue;
    }
    if (sceneState.on !== fixture.on) return false;
    if (sceneState.on && Math.abs(sceneState.intensity - fixture.intensity) > 0.5) return false;
    if (sceneState.on && fixture.hasCctControl && Math.abs(sceneState.cct - fixture.cct) > 25) {
      return false;
    }
    const keys = new Set([...Object.keys(fixture.controlValues ?? {}), ...Object.keys(sceneState.controlValues ?? {})]);
    for (const key of keys) {
      if (key === "intensity" || key === "cct") continue;
      if (Math.abs((fixture.controlValues?.[key] ?? 0) - (sceneState.controlValues?.[key] ?? 0)) > 0.5) {
        return false;
      }
    }
  }
  return true;
}

export function sceneMatchesFixtures(
  fixtures: readonly FixtureSceneComparisonSource[],
  scene: LightingSceneSnapshot,
  catalog: LightingFixtureCatalogSnapshot | null
): boolean {
  return fixtureStatesEqual(
    fixtures.map((fixture) => ({
      id: fixture.id,
      intensity: fixture.intensity,
      cct: fixture.cct,
      on: fixture.on,
      hasCctControl: fixtureHasCctControl(fixture, catalog),
      controlValues: fixture.controlValues,
    })),
    scene.fixtureStates.map((state) => ({
      fixtureId: state.fixtureId,
      intensity: state.intensity,
      cct: state.cct,
      on: state.on,
      controlValues: state.controlValues,
    }))
  );
}

/** Chrome-level live drift (GLO-09): a dirty preview session (engine-flagged)
 *  or the rig no longer holding the live scene. Since 2026-10-03 the hardware
 *  link decides the latter once, for the screen and the Stream Deck's RECALL
 *  alike (`lighting.snapshot`'s `sceneState`, `unsaved`); until then this
 *  page compared the fixtures itself. Deliberately ignores the lighting
 *  workspace's local inspector-selection state — the shell chip reports the
 *  operator-facing rig truth, while the workspace guard/title keep their
 *  richer selection-aware computation. The catalog is no longer read. */
export function computeLiveSceneDrift(
  lightingSnapshot: LightingSnapshot | null,
  _catalog?: LightingFixtureCatalogSnapshot | null
): boolean {
  if (!lightingSnapshot) return false;
  // The shell evaluates this on every snapshot state, including partial
  // hydration where a field may not exist yet — stay defensive.
  if (lightingSnapshot.previewMode) return lightingSnapshot.previewDirty === true;
  return lightingSnapshot.sceneState === "unsaved";
}
