import { type SnapshotRecord, type StatusToneLike, asRecord, getCommissioningChecks } from "../shellData";
import type { ShellStore, JsonValue } from "@sse/engine-client";

export const APP_VERSION = `v${__APP_VERSION__}`;

export type SetupMode = "runner" | "support";
export type RunnerStepId = "import" | "probe" | "map" | "verify" | "publish";

// The three engine commissioning probes. Fixture snapshots may carry extra
// label-only check entries; the publish gate (2026-09 audit Slice 8) counts
// only these, exactly as the engine does.
export const PROBE_CHECK_IDS = new Set(["control-surface", "lighting", "audio"]);

export function probeChecks<T extends { id: string }>(entries: T[]) {
  const known = entries.filter((entry) => PROBE_CHECK_IDS.has(entry.id));
  return known.length > 0 ? known : entries;
}
export type FeedbackTone = "error" | "info" | "ok";

export interface ControlSurfaceControl {
  body: { action?: string; value?: string } | null;
  description: string;
  id: string;
  label: string;
  position: number;
  type: string;
}

export interface ControlSurfacePage {
  buttons: ControlSurfaceControl[];
  dials: ControlSurfaceControl[];
  id: string;
  label: string;
}

export interface ActionFeedback {
  message: string;
  tone: FeedbackTone;
}

export interface SetupSupportPilotProps {
  appSnapshot: SnapshotRecord | null;
  commissioningSnapshot: SnapshotRecord | null;
  controlSurfaceSnapshot: SnapshotRecord | null;
  healthSnapshot: SnapshotRecord | null;
  /** Whether the light outputs are armed, from the lighting state; `null` until it is read. */
  lightOutputsArmed: boolean | null;
  liveTransportRequested: boolean;
  onRequestRestart: () => void;
  onShowShortcuts: () => void;
  store: ShellStore;
  supportSnapshot: SnapshotRecord | null;
}

export interface RunnerStep {
  hint: string;
  id: RunnerStepId;
  label: string;
  tone: StatusToneLike;
}

export const runnerStepOrder: RunnerStepId[] = ["import", "probe", "map", "verify", "publish"];

export function parseControlSurfacePages(snapshot: SnapshotRecord | null): ControlSurfacePage[] {
  const pages = snapshot?.pages;
  if (!Array.isArray(pages)) {
    return [];
  }

  return pages.flatMap((page) => {
    const record = asRecord(page);
    if (!record) {
      return [];
    }

    const parseControls = (controls: unknown) =>
      (Array.isArray(controls) ? controls : []).flatMap((control) => {
        const controlRecord = asRecord(control);
        if (!controlRecord) {
          return [];
        }

        const body = asRecord(controlRecord.body);
        return [
          {
            body: body
              ? {
                  action: typeof body.action === "string" ? body.action : undefined,
                  value: typeof body.value === "string" ? body.value : undefined,
                }
              : null,
            description: String(controlRecord.description ?? "Control mapped on the deck."),
            id: String(controlRecord.id ?? controlRecord.label ?? "control"),
            label: String(controlRecord.label ?? "Control"),
            position: typeof controlRecord.position === "number" ? controlRecord.position : 0,
            type: String(controlRecord.type ?? "button"),
          },
        ];
      });

    return [
      {
        buttons: parseControls(record.buttons),
        dials: parseControls(record.dials),
        id: String(record.id ?? record.label ?? "page"),
        label: String(record.label ?? "PAGE"),
      },
    ];
  });
}

/** A Stream Deck + page's keys: four to a row, in the order the deck numbers them. */
export const DECK_KEYS_PER_ROW = 4;

/**
 * A page's key cells, each holding the key at its place on the deck or
 * nothing, in whole rows. A page need not start at place 1: LIGHTS starts at
 * 2, the place `<< PROJ` held until Planning left the deck (new pages
 * program, Slice 2), so drawing the keys one after another put every LIGHTS
 * key one place early. Keys whose places are missing or repeated are drawn
 * one after another, as before.
 */
export function deckKeySlots(buttons: ControlSurfaceControl[]): (ControlSurfaceControl | null)[] {
  const places = buttons.map((button) => button.position);
  const placed =
    places.every((place) => Number.isInteger(place) && place >= 1) && new Set(places).size === places.length;
  if (!placed || buttons.length === 0) {
    return buttons;
  }

  const cells = Math.ceil(Math.max(...places) / DECK_KEYS_PER_ROW) * DECK_KEYS_PER_ROW;
  return Array.from({ length: cells }, (_, index) => buttons.find((button) => button.position === index + 1) ?? null);
}

export function normalizeSetupMode(appSnapshot: SnapshotRecord | null): SetupMode {
  const shell = asRecord(appSnapshot?.shell);
  const setup = asRecord(shell?.setup);
  return setup?.activeSection === "support" ? "support" : "runner";
}

export function normalizeRunnerStage(snapshot: SnapshotRecord | null): RunnerStepId | null {
  const runnerStage = snapshot?.runnerStage;
  if (
    runnerStage === "import" ||
    runnerStage === "probe" ||
    runnerStage === "map" ||
    runnerStage === "verify" ||
    runnerStage === "publish"
  ) {
    return runnerStage;
  }

  if (snapshot?.stage === "ready") {
    return "publish";
  }

  if (snapshot?.stage === "in-progress") {
    return "probe";
  }

  if (snapshot?.stage === "setup-required") {
    return "import";
  }

  return null;
}

export function deriveRecommendedStepId(snapshot: SnapshotRecord | null, pages: ControlSurfacePage[]): RunnerStepId {
  const persistedStage = normalizeRunnerStage(snapshot);
  if (persistedStage) {
    return persistedStage;
  }

  const checks = getCommissioningChecks(snapshot);
  const allChecksPassing = checks.length > 0 && checks.every((check) => check.status === "ok");
  const isReady = snapshot?.hasCompletedSetup === true;

  if (isReady) {
    return "publish";
  }

  if (!allChecksPassing) {
    return "probe";
  }

  if (pages.length > 0) {
    return "map";
  }

  return "import";
}

export function formatFileSize(sizeBytes: number) {
  if (sizeBytes <= 0) {
    return "fixture";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

export function feedbackStatus(feedback: ActionFeedback | null) {
  if (!feedback) {
    return null;
  }

  return feedback.tone === "ok" ? "ok" : feedback.tone === "error" ? "error" : "info";
}

export function nextControlId(controls: ControlSurfaceControl[], selectedControlId: string | null, direction: -1 | 1) {
  if (controls.length === 0) {
    return null;
  }

  const currentIndex = controls.findIndex((control) => control.id === selectedControlId);
  if (currentIndex === -1) {
    return controls[0]?.id ?? null;
  }

  const nextIndex = (currentIndex + direction + controls.length) % controls.length;
  return controls[nextIndex]?.id ?? null;
}

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}
