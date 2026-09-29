import { describe, expect, it } from "vitest";

import { deriveLightingState, type LightingStateInput } from "./lightingState";

const base: LightingStateInput = {
  bridgeIp: "10.1.0.1",
  bridgeReachable: true,
  channelCount: 12,
  fixtureOnCount: 3,
  fixtureTotal: 4,
  lastRecalledLabel: null,
  outputsHeld: false,
  previewDirty: false,
  previewMode: false,
  sceneModified: false,
  sceneName: "Warm wash",
  universe: 1,
};

// Found, to check (2026-09-28): the display read REACHABLE, "the rig is
// following it", while the light outputs were held; only the header's lamp
// said held. HELD ranks as the lamp does.
describe("deriveLightingState and held light outputs", () => {
  it("reads HELD, amber, while the outputs are held", () => {
    const state = deriveLightingState({ ...base, outputsHeld: true });
    expect(state.word).toBe("HELD");
    expect(state.tone).toBe("attention");
    expect(state.sentence).toContain("nothing is sent to the rig");
    expect(state.locked).toBe(false);
  });

  it("an unreachable bridge and Preview outrank a hold; a hold outranks an unsaved scene", () => {
    expect(deriveLightingState({ ...base, outputsHeld: true, bridgeReachable: false }).word).toBe("UNREACHABLE");
    expect(deriveLightingState({ ...base, outputsHeld: true, previewMode: true }).word).toBe("PREVIEW");
    expect(deriveLightingState({ ...base, outputsHeld: true, sceneModified: true }).word).toBe("HELD");
  });

  // Found, to check (2026-09-28): nothing looked at the bridge during a
  // session. The watch's word locks nothing (the owner, 2026-09-29).
  it("reads NOT ANSWERING, amber and unlocked, when the watch says the bridge went silent", () => {
    const state = deriveLightingState({ ...base, bridgeAnswering: false, bridgeSilentLabel: "10:42" });
    expect(state.word).toBe("NOT ANSWERING");
    expect(state.tone).toBe("attention");
    expect(state.locked).toBe(false);
    expect(state.lockNote).toBeNull();
    expect(state.sentence).toBe(
      "The bridge at 10.1.0.1 · universe 1 has not answered since 10:42. Nothing is locked; this clears when it answers. Check its power and cable."
    );
    expect(deriveLightingState({ ...base, bridgeAnswering: false }).sentence).toContain("has not answered. Nothing");
    // It never sends the operator to Setup's probe: a probe that fails
    // mid-session locks the rig (the review of #260).
    expect(state.sentence).not.toMatch(/probe|Setup/);
  });

  // The review of #260: a silent bridge outranks a hold, so its sentence names
  // the hold, and nothing claims that what is pressed is sent.
  it("names the hold when the outputs are held too", () => {
    const state = deriveLightingState({
      ...base,
      bridgeAnswering: false,
      bridgeSilentLabel: "10:42",
      outputsHeld: true,
    });
    expect(state.word).toBe("NOT ANSWERING");
    expect(state.sentence).toBe(
      "The bridge at 10.1.0.1 · universe 1 has not answered since 10:42, and the outputs are held until armed in Setup / Support. Check its power and cable."
    );
  });

  it("a failed probe and Preview outrank a silent bridge; a silent bridge outranks a hold", () => {
    const silent = { ...base, bridgeAnswering: false };
    expect(deriveLightingState({ ...silent, bridgeReachable: false }).word).toBe("UNREACHABLE");
    expect(deriveLightingState({ ...silent, previewMode: true }).word).toBe("PREVIEW");
    expect(deriveLightingState({ ...silent, outputsHeld: true }).word).toBe("NOT ANSWERING");
    expect(deriveLightingState({ ...silent, sceneModified: true }).word).toBe("NOT ANSWERING");
    expect(deriveLightingState({ ...base, bridgeAnswering: true }).word).toBe("REACHABLE");
    expect(deriveLightingState({ ...base, bridgeAnswering: null }).word).toBe("REACHABLE");
  });

  it("armed and reachable is REACHABLE, and Preview's sentence names the scene", () => {
    expect(deriveLightingState(base).word).toBe("REACHABLE");
    expect(deriveLightingState({ ...base, previewMode: true, previewDirty: true }).sentence).toContain(
      "Save puts the edits into Warm wash"
    );
  });
});
