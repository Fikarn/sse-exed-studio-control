import type { StateDisplayTone } from "@sse/design-system";

// Visual overhaul A, Slice 5 (plan D1, console-a-states §Lighting): what the
// rig is, in one word, one sentence and one way out — derived from what the
// engine reports (the bridge's reachability), the scene-drift detector and
// preview mode. The front end never invents a state the engine does not report.

export type LightingStateWord = "UNREACHABLE" | "PREVIEW" | "NOT ANSWERING" | "HELD" | "UNSAVED" | "REACHABLE";

export interface LightingStateInput {
  bridgeIp: string;
  bridgeReachable: boolean;
  /** The bridge watch's word during the session: `false` once the bridge has
   *  stopped answering; `null` or absent when the watch has no word. */
  bridgeAnswering?: boolean | null;
  /** When the silence began, as the studio's clock reads it (`10:42`). */
  bridgeSilentLabel?: string | null;
  channelCount: number;
  fixtureOnCount: number;
  fixtureTotal: number;
  /** When the page last saved a scene, on the studio's clock. The footer says
   *  it (`saved · last 17:20`); the display no longer does. */
  lastSavedLabel: string | null;
  /** The light outputs are held: the hardware link sends the rig nothing. */
  outputsHeld?: boolean;
  previewDirty: boolean;
  previewMode: boolean;
  sceneModified: boolean;
  sceneName: string | null;
  /** The bridge's universe. The footer says it (`Universe 1`); the display no longer does. */
  universe: number;
}

export interface LightingState {
  word: LightingStateWord;
  tone: StateDisplayTone;
  /** The sentence under the word: what is true, in the operator's words. */
  sentence: string;
  /** The line under the sentence: the scene. */
  meta: string;
  /** True while the rig refuses writes: every rig control is outlined. */
  locked: boolean;
}

// The visual overhaul's polish (2026-10-05, the owner's rule): the state
// display's sentence keeps at most two lines, so every sentence here holds at
// most 70 characters (a 15-character bridge address included), says what
// happened and what to do, and leaves the action to the way-out key beside it.
// The meta line beside that key holds about 30 characters: it names the scene
// alone. The universe and when the scene was saved are the footer's.
export function deriveLightingState({
  bridgeIp,
  bridgeReachable,
  bridgeAnswering = null,
  bridgeSilentLabel = null,
  outputsHeld = false,
  previewDirty,
  previewMode,
  sceneModified,
  sceneName,
}: LightingStateInput): LightingState {
  const address = bridgeIp.trim();
  const bridge = address ? `Bridge ${address}` : "The bridge";
  const meta = sceneName ? `Scene ${sceneName}` : "No scene recalled";

  // UNREACHABLE is the probe's word: the bridge has not passed Setup's probe
  // (or its address changed since). The hardware link refuses a recall then,
  // and the page locks LIGHTING, the grand master and the Save row with it;
  // the rest still reaches the rig, CUT ALL first. Until 2026-10-04 the
  // sentence said nothing pressed would reach the rig, which was not so.
  if (!bridgeReachable) {
    return {
      word: "UNREACHABLE",
      tone: "error",
      sentence: `${bridge} has not passed its probe: recalls are refused.`,
      meta,
      locked: true,
    };
  }

  if (previewMode) {
    return {
      word: "PREVIEW",
      tone: "info",
      // Saving puts the preview into the scene, never onto the rig: the rig
      // takes it when the scene is recalled (until 2026-09-28 this sentence
      // said the save would reach the rig). The scene is the meta line's.
      sentence:
        previewDirty && sceneName
          ? "Editing offline: saved edits reach the rig when the scene is recalled."
          : "You are editing offline. The rig is unchanged.",
      meta,
      locked: false,
    };
  }

  // Found, to check (2026-09-28): nothing looked at the bridge during a
  // session. The hardware link's watch says when it stops answering, and the
  // owner's decision (2026-09-29) is to say it and lock nothing: the sACN
  // stream never needed the port the watch knocks on. It ranks below PREVIEW,
  // whose keys are the only way out of it, and above HELD: a bridge that went
  // is news whether the outputs are held or not, and the sentence then names
  // the hold too (the review of #260). It points at the bridge, never at
  // Setup's probe: a probe that fails mid-session locks the rig, which is what
  // the owner ruled out, and the word clears by itself. Held as well, Open
  // Setup is the way to arm, so the sentence names the hold and leaves the
  // way to the key.
  if (bridgeAnswering === false) {
    const since = bridgeSilentLabel ? ` since ${bridgeSilentLabel}` : "";
    return {
      word: "NOT ANSWERING",
      tone: "attention",
      sentence: outputsHeld
        ? `The bridge has not answered${since}, and the outputs are held.`
        : `The bridge has not answered${since}. Check its power and cable.`,
      meta,
      locked: false,
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
      sentence: "The light outputs are held: nothing is sent to the rig until armed.",
      meta,
      locked: false,
    };
  }

  // The two ways back are the keys beside it: Save changes, Recall it again.
  if (sceneModified) {
    return {
      word: "UNSAVED",
      tone: "attention",
      sentence: sceneName ? `The rig no longer matches ${sceneName}.` : "The rig no longer matches any saved scene.",
      meta,
      locked: false,
    };
  }

  return {
    word: "REACHABLE",
    tone: "ok",
    sentence: `${bridge} is answering and the rig is following it.`,
    meta,
    locked: false,
  };
}
