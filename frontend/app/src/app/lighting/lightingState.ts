import type { StateDisplayTone } from "@sse/design-system";

// Visual overhaul A, Slice 5 (plan D1, console-a-states §Lighting): what the
// rig is, in one word, one sentence and one way out — derived from what the
// engine reports (the bridge's reachability), the scene-drift detector and
// preview mode. The front end never invents a state the engine does not report.

export type LightingStateWord = "UNREACHABLE" | "PREVIEW" | "HELD" | "UNSAVED" | "REACHABLE";

export interface LightingStateInput {
  bridgeIp: string;
  bridgeReachable: boolean;
  channelCount: number;
  fixtureOnCount: number;
  fixtureTotal: number;
  lastRecalledLabel: string | null;
  /** The light outputs are held: the hardware link sends the rig nothing. */
  outputsHeld?: boolean;
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
  outputsHeld = false,
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
      // Saving puts the preview into the scene, never onto the rig: the rig
      // takes it when the scene is recalled (until 2026-09-28 this sentence
      // said the save would reach the rig).
      sentence:
        previewDirty && sceneName
          ? `You are editing offline. Save puts the edits into ${sceneName}; the rig takes them when it is recalled.`
          : "You are editing offline. The rig is unchanged.",
      meta,
      locked: false,
      lockNote: null,
    };
  }

  // Found, to check (2026-09-28): the display read REACHABLE, "the rig is
  // following it", while the outputs were held; only the header's lamp said
  // held. HELD ranks as the lamp does, above an unsaved scene: nothing
  // reaches the rig at all. Preview's sentence stays true while held, and its
  // keys are the only way out of it, so PREVIEW ranks above HELD.
  if (outputsHeld) {
    return {
      word: "HELD",
      tone: "attention",
      sentence: "The light outputs are held: nothing is sent to the rig until they are armed in Setup / Support.",
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
