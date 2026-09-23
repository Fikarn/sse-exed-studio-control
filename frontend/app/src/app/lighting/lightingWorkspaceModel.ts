import { type SnapshotRecord, asRecord } from "../shellData";
import type {
  LightingFixtureCatalogSnapshot,
  LightingDmxMonitorSnapshot,
  LightingSnapshot,
  ShellStore,
  ShellTalentMark,
  LightingPaletteSnapshot,
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

export const RECALL_FADE_PRESETS_MS = [0, 1000, 2000, 5000] as const;
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

export function formatLightingPaletteQuickValue(palette: LightingPaletteSnapshot): string {
  return palette.kind === "intensity" ? `${Math.round(palette.value)} %` : `${Math.round(palette.value)} K`;
}

export function lightingPaletteMatchesQuery(palette: LightingPaletteSnapshot, query: string): boolean {
  if (!query) return true;
  return `${palette.name} ${palette.kind} ${formatLightingPaletteQuickValue(palette)}`.toLowerCase().includes(query);
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

/** Result-aware toast helper for surfacing UndoOutcome to the operator. The
 *  undo stack returns a tagged result; this maps every variant to a toast so
 *  rejections (UndoRefusedError) and errors don't silently disappear. */
export function pushUndoOutcomeToast(toast: ToastApi, outcome: UndoOutcome): void {
  if (outcome.kind === "noop") return;
  if (outcome.kind === "ok") {
    toast.push({ tone: "info", message: `Undid: ${outcome.label}.` });
    return;
  }
  if (outcome.kind === "rejected") {
    toast.push({
      tone: "attention",
      message: `Cannot undo "${outcome.label}" — ${outcome.reason}.`,
    });
    return;
  }
  toast.push({
    tone: "error",
    message: `Undo failed for "${outcome.label}". The operation is still applied.`,
  });
}

export function snapshotWithFixtures(
  snapshot: LightingSnapshot | null,
  fixtures: readonly LightingFixtureSnapshot[]
): LightingSnapshot | null {
  return snapshot ? { ...snapshot, fixtures: [...fixtures] } : null;
}
