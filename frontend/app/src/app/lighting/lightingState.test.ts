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

  it("armed and reachable is REACHABLE, and Preview's sentence names the scene", () => {
    expect(deriveLightingState(base).word).toBe("REACHABLE");
    expect(deriveLightingState({ ...base, previewMode: true, previewDirty: true }).sentence).toContain(
      "Save puts the edits into Warm wash"
    );
  });
});
