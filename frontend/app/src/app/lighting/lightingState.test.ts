import { describe, expect, it } from "vitest";

import { deriveLightingState, type LightingStateInput } from "./lightingState";

const base: LightingStateInput = {
  bridgeIp: "10.1.0.1",
  bridgeReachable: true,
  channelCount: 12,
  fixtureOnCount: 3,
  fixtureTotal: 4,
  lastSavedLabel: null,
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
    expect(state.sentence).toBe("The bridge has not answered since 10:42. Check its power and cable.");
    expect(deriveLightingState({ ...base, bridgeAnswering: false }).sentence).toBe(
      "The bridge has not answered. Check its power and cable."
    );
    // It never sends the operator to Setup's probe: a probe that fails
    // mid-session locks the rig (the review of #260).
    expect(state.sentence).not.toMatch(/probe|Setup/);
  });

  // The review of #260: a silent bridge outranks a hold, so its sentence names
  // the hold, and nothing claims that what is pressed is sent. Open Setup, the
  // key beside it, is the way to arm.
  it("names the hold when the outputs are held too", () => {
    const state = deriveLightingState({
      ...base,
      bridgeAnswering: false,
      bridgeSilentLabel: "10:42",
      outputsHeld: true,
    });
    expect(state.word).toBe("NOT ANSWERING");
    expect(state.sentence).toBe("The bridge has not answered since 10:42, and the outputs are held.");
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

  it("armed and reachable is REACHABLE, and Preview's sentence says when the rig takes a saved edit", () => {
    expect(deriveLightingState(base).word).toBe("REACHABLE");
    expect(deriveLightingState({ ...base, previewMode: true, previewDirty: true }).sentence).toBe(
      "Editing offline: saved edits reach the rig when the scene is recalled."
    );
    expect(deriveLightingState({ ...base, previewMode: true }).sentence).toBe(
      "You are editing offline. The rig is unchanged."
    );
  });
});

// The visual overhaul (2026-10-04): UNREACHABLE is the probe's word. The
// hardware link refuses a recall then, and nothing else; until then the
// sentence said nothing pressed would reach the rig. The meta line names the
// scene, and no count another control prints.
describe("deriveLightingState's words", () => {
  it("UNREACHABLE says the probe has not passed and that recalls are refused", () => {
    const state = deriveLightingState({ ...base, bridgeReachable: false });
    expect(state.sentence).toBe("Bridge 10.1.0.1 has not passed its probe: recalls are refused.");
    expect(state.sentence).not.toMatch(/nothing you press/);
    expect(state.locked).toBe(true);
    expect(deriveLightingState({ ...base, bridgeReachable: false, bridgeIp: " " }).sentence).toBe(
      "The bridge has not passed its probe: recalls are refused."
    );
  });

  it("REACHABLE names the bridge by its address", () => {
    expect(deriveLightingState(base).sentence).toBe("Bridge 10.1.0.1 is answering and the rig is following it.");
  });

  // The visual overhaul's polish (2026-10-05): the meta line beside a way-out
  // key holds about 30 characters, so it names the scene alone; when it was
  // saved is the footer's (`saved · last 17:20`).
  it("the meta line names the scene alone", () => {
    expect(deriveLightingState(base).meta).toBe("Scene Warm wash");
    expect(deriveLightingState({ ...base, lastSavedLabel: "17:20" }).meta).toBe("Scene Warm wash");
    expect(deriveLightingState({ ...base, sceneName: null }).meta).toBe("No scene recalled");
  });

  // The owner's rule (2026-10-05): the sentence keeps at most two lines, about
  // 75 characters at the display's width, so every sentence holds 70 at most,
  // the longest bridge address and a silent time included.
  it("every sentence the page builds holds 70 characters at most", () => {
    const longest = { ...base, bridgeIp: "192.168.100.200", bridgeSilentLabel: "10:42" };
    const states = [
      deriveLightingState(longest),
      deriveLightingState({ ...longest, bridgeReachable: false }),
      deriveLightingState({ ...longest, previewMode: true }),
      deriveLightingState({ ...longest, previewMode: true, previewDirty: true }),
      deriveLightingState({ ...longest, bridgeAnswering: false }),
      deriveLightingState({ ...longest, bridgeAnswering: false, outputsHeld: true }),
      deriveLightingState({ ...longest, outputsHeld: true }),
      deriveLightingState({ ...longest, sceneModified: true, sceneName: null }),
    ];
    for (const state of states) expect(state.sentence.length, state.sentence).toBeLessThanOrEqual(70);
  });
});
