import type { StateDisplayTone } from "@sse/design-system";

// Visual overhaul A, Slice 5 (plan D1, console-a-states §Lighting): what the
// rig is, in one word, one sentence and one way out — derived from what the
// engine reports (the bridge's reachability), the scene-drift detector and
// preview mode. The front end never invents a state the engine does not report.

export type LightingStateWord = "UNREACHABLE" | "PREVIEW" | "UNSAVED" | "REACHABLE";

export interface LightingStateInput {
  bridgeIp: string;
  bridgeReachable: boolean;
  channelCount: number;
  fixtureOnCount: number;
  fixtureTotal: number;
  lastRecalledLabel: string | null;
  previewDirty: boolean;
  previewMode: boolean;
  sceneModified: boolean;
  sceneName: string | null;
  universe: number;
}

export interface LightingState {
  word: LightingStateWord;
  tone: StateDisplayTone;
  /** The sentence under the word: what is true, in the operator's words. */
  sentence: string;
  /** The line under the sentence: the scene, the rig, the counts. */
  meta: string;
  /** True while the rig refuses writes: every rig control is outlined. */
  locked: boolean;
  /** The short phrase a locked surface prints where the hand is. */
  lockNote: string | null;
}

export function deriveLightingState({
  bridgeIp,
  bridgeReachable,
  channelCount,
  fixtureOnCount,
  fixtureTotal,
  lastRecalledLabel,
  previewDirty,
  previewMode,
  sceneModified,
  sceneName,
  universe,
}: LightingStateInput): LightingState {
  const target = bridgeIp.trim() ? `${bridgeIp} · universe ${universe}` : `universe ${universe}`;
  const rig = `${fixtureOnCount} of ${fixtureTotal} fixtures on`;
  const scene = sceneName
    ? `Scene ${sceneName}${lastRecalledLabel ? ` · recalled ${lastRecalledLabel}` : ""}`
    : "No scene recalled";
  const meta = `${scene} · ${rig} · ${channelCount} channels`;

  if (!bridgeReachable) {
    return {
      word: "UNREACHABLE",
      tone: "error",
      sentence: `The bridge at ${target} is not answering, so nothing you press will reach the rig.`,
      meta,
      locked: true,
      lockNote: "locked · bridge unreachable",
    };
  }

  if (previewMode) {
    return {
      word: "PREVIEW",
      tone: "info",
      sentence: previewDirty
        ? "You are editing offline. The rig is unchanged until you save this to it."
        : "You are editing offline. The rig is unchanged.",
      meta,
      locked: false,
      lockNote: null,
    };
  }

  if (sceneModified) {
    return {
      word: "UNSAVED",
      tone: "attention",
      sentence: sceneName
        ? `The rig no longer matches ${sceneName}. Save the changes into it, or recall it again to put them back.`
        : "The rig no longer matches any saved scene.",
      meta,
      locked: false,
      lockNote: null,
    };
  }

  return {
    word: "REACHABLE",
    tone: "ok",
    sentence: `The bridge at ${target} is answering and the rig is following it.`,
    meta,
    locked: false,
    lockNote: null,
  };
}
