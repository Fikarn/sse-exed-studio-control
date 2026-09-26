import { type SnapshotRecord, asRecord } from "../shellData";
import type {
  LightingFixtureCatalogSnapshot,
  LightingDmxMonitorSnapshot,
  LightingSnapshot,
  ShellStore,
  ShellTalentMark,
  LightingFixtureSnapshot,
  LightingSceneSnapshot,
} from "@sse/engine-client";
import { type StudioTalentMark, STUDIO_LAYOUT } from "./studioLayout";
import type { ToastApi } from "../shared/toastContext";
import type { UndoOutcome } from "./useUndoStack";

export interface LightingWorkspaceSurfaceProps {
  appSnapshot: SnapshotRecord | null;
  lightingFixtureCatalogSnapshot: LightingFixtureCatalogSnapshot | null;
  lightingDmxMonitorSnapshot: LightingDmxMonitorSnapshot | null;
  lightingSnapshot: LightingSnapshot | null;
  store: ShellStore;
}

export const RECENT_SCENE_LIMIT = 8;
export const FIXTURE_VALUE_PREVIEW_TIMEOUT_MS = 1800;

export type FixtureValuePreviewPhase = "editing" | "committing";
export type PreviewableFixtureValue = "intensity" | "cct";

export interface FixtureValuePreviewField {
  phase: FixtureValuePreviewPhase;
  value: number;
}

export type FixtureValuePreviewFields = Partial<Record<PreviewableFixtureValue, FixtureValuePreviewField>>;

export function clampStudioMeters(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

export function normalizeTalentMarkCoordinate(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clampStudioMeters(value, max) : fallback;
}

export function resolveTalentMarks(appSnapshot: SnapshotRecord | null): readonly StudioTalentMark[] {
  const shellLighting = asRecord(asRecord(appSnapshot?.shell)?.lighting);
  const storedMarks = Array.isArray(shellLighting?.talentMarks) ? shellLighting.talentMarks : [];
  const storedById = new Map(
    storedMarks
      .map((entry) => asRecord(entry))
      .filter((entry): entry is SnapshotRecord => entry !== null)
      .map((entry) => [String(entry.id ?? ""), entry] as const)
      .filter(([id]) => id.trim().length > 0)
  );

  return STUDIO_LAYOUT.talentMarks.map((fallback) => {
    const stored = storedById.get(fallback.id);
    return {
      id: fallback.id,
      label: typeof stored?.label === "string" && stored.label.trim() ? stored.label.trim() : fallback.label,
      xMeters: normalizeTalentMarkCoordinate(stored?.xMeters, fallback.xMeters, STUDIO_LAYOUT.roomWidthMeters),
      yMeters: normalizeTalentMarkCoordinate(stored?.yMeters, fallback.yMeters, STUDIO_LAYOUT.roomDepthMeters),
    };
  });
}

export function toShellTalentMarks(marks: readonly StudioTalentMark[]): readonly ShellTalentMark[] {
  return marks.map((mark) => ({
    id: mark.id,
    label: mark.label,
    xMeters: Math.round(clampStudioMeters(mark.xMeters, STUDIO_LAYOUT.roomWidthMeters) * 100) / 100,
    yMeters: Math.round(clampStudioMeters(mark.yMeters, STUDIO_LAYOUT.roomDepthMeters) * 100) / 100,
  }));
}

export function formatRecallFade(ms: number): string {
  if (ms <= 0) return "0 s";
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
}

export function fixturesWithSceneState(
  fixtures: readonly LightingFixtureSnapshot[],
  scene: LightingSceneSnapshot
): LightingFixtureSnapshot[] {
  const sceneStateByFixtureId = new Map(scene.fixtureStates.map((state) => [state.fixtureId, state]));
  return fixtures.map((fixture) => {
    const state = sceneStateByFixtureId.get(fixture.id);
    if (!state) {
      return { ...fixture, intensity: 0, on: false };
    }
    return {
      ...fixture,
      intensity: state.intensity,
      cct: state.cct,
      on: state.on,
      controlValues: state.controlValues ?? fixture.controlValues,
    };
  });
}

export function fixtureValuePreviewMatches(
  fixture: LightingFixtureSnapshot,
  field: PreviewableFixtureValue,
  value: number
): boolean {
  switch (field) {
    case "intensity":
      return Math.abs(fixture.intensity - value) <= 0.5;
    case "cct":
      return Math.abs(fixture.cct - value) <= 25;
  }
}

/** A fixture as it was when it was added: what the hardware link put into every
 *  scene for it. */
export interface AddedFixtureState {
  intensity: number;
  cct: number;
  on: boolean;
  controlValues: Readonly<Record<string, number>>;
}

/** How many scenes hold an added fixture as a save put it there. The Undo of
 *  "Add fixture" deletes the fixture again, and a delete takes it out of every
 *  scene. When a fixture is added the hardware link puts it into every scene
 *  there is, as it was added (`append_fixture_to_scenes`); that is not a save,
 *  and it does not stop the undo. A scene saved after the fixture was added, or
 *  saved again with the fixture changed, does: the delete would take the
 *  fixture out of that saved state. (New pages program, Slice 3: before this,
 *  every scene counted, so the undo was refused whenever a scene existed.)
 *
 *  `added` is the add's reply, and the hardware link shapes it unlike the
 *  scene states it reads back: the reply's control values carry `intensity`
 *  and, for a fixture with colour temperature, `cct`, and its cct is 0 for a
 *  fixture without one; a scene state carries neither key in its control
 *  values (`normalize_fixture_control_values`) and holds a cct clamped to
 *  2000–10000. So intensity and cct are compared by their own fields, cct only
 *  for a fixture with colour temperature, as the drift check does
 *  (`lightingDrift.ts`). (Slice 3 review, finding 15: the undo was refused on
 *  the link whenever a scene existed.) */
export function scenesSavedWithAddedFixture(
  scenes: readonly LightingSceneSnapshot[],
  fixtureId: string,
  sceneIdsAtAdd: ReadonlySet<string>,
  added: AddedFixtureState
): number {
  const hasCct = Object.prototype.hasOwnProperty.call(added.controlValues, "cct");
  const changed = (state: LightingSceneSnapshot["fixtureStates"][number]) => {
    if (state.on !== added.on) return true;
    if (Math.abs(state.intensity - added.intensity) > 0.5) return true;
    if (hasCct && Math.abs(state.cct - added.cct) > 25) return true;
    const keys = new Set([...Object.keys(state.controlValues ?? {}), ...Object.keys(added.controlValues)]);
    for (const key of keys) {
      if (key === "intensity" || key === "cct") continue;
      if (Math.abs((state.controlValues?.[key] ?? 0) - (added.controlValues[key] ?? 0)) > 0.5) return true;
    }
    return false;
  };
  return scenes.filter((scene) =>
    scene.fixtureStates.some(
      (state) => state.fixtureId === fixtureId && (!sceneIdsAtAdd.has(scene.id) || changed(state))
    )
  ).length;
}

/** Result-aware toast helper for surfacing UndoOutcome to the operator. The
 *  undo stack returns a tagged result; this maps every variant to a toast so
 *  rejections (UndoRefusedError) and errors don't silently disappear. The Undo
 *  key and the Undo on a step's own message both report through it. */
export function pushUndoOutcomeToast(toast: ToastApi, outcome: UndoOutcome): void {
  if (outcome.kind === "noop") return;
  if (outcome.kind === "ok") {
    toast.push({ tone: "ok", message: `Undid ‘${outcome.label}’.` });
    return;
  }
  if (outcome.kind === "rejected") {
    toast.push({
      tone: "attention",
      message: `Cannot undo ‘${outcome.label}’: ${outcome.reason}.`,
    });
    return;
  }
  toast.push({
    tone: "error",
    message: `Undo failed for ‘${outcome.label}’. The step is still in place.`,
  });
}

export function snapshotWithFixtures(
  snapshot: LightingSnapshot | null,
  fixtures: readonly LightingFixtureSnapshot[]
): LightingSnapshot | null {
  return snapshot ? { ...snapshot, fixtures: [...fixtures] } : null;
}
