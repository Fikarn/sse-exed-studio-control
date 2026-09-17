import { describe, expect, it } from "vitest";

import type { CommissioningCheck } from "../shellData";
import { deriveSetupState } from "./setupState";

// 2026-09 production readiness, Slice 8 (finding F14): the hardware link's
// health status moves on its own now — `attention` when a port could not be
// bound — and this is where it lands on the Setup / Support surface: the
// cluster's word, its tone and the engine's own health sentence. The pilot
// renders the word through the shell's cluster region, so the mapping is
// pinned here, on the function that derives it.

const green: CommissioningCheck[] = [
  { detail: "OSC sync healthy.", id: "audio", label: "Audio console", status: "ok" },
  { detail: "Bridge answered.", id: "lighting", label: "Lighting bridge", status: "ok" },
  { detail: "Deck answered.", id: "control-surface", label: "Control surface", status: "ok" },
];

const deckNotGreen: CommissioningCheck[] = [
  green[0],
  green[1],
  { detail: "Bridge port taken.", id: "control-surface", label: "Control surface", status: "attention" },
];

const base = {
  commissioningSummary: "Commissioning complete and operator mode unlocked.",
  lastBackupLabel: null,
  published: true,
  stepLabel: "Publish",
  stepNumber: 4,
  stepTotal: 4,
};

describe("deriveSetupState with the hardware link's health", () => {
  it("attention with a probe not green reads DEGRADED with the health sentence", () => {
    const state = deriveSetupState({
      ...base,
      checks: deckNotGreen,
      healthSummary:
        "Health 'attention'. Control surface Native control-surface bridge is unavailable because the listener could not bind.",
      healthTone: "attention",
    });
    expect(state.word).toBe("DEGRADED");
    expect(state.tone).toBe("attention");
    expect(state.sentence).toContain("could not bind");
    expect(state.wayOut).toBe("run-probes");
  });

  it("error keeps the DEGRADED word with the error tone", () => {
    const state = deriveSetupState({
      ...base,
      checks: deckNotGreen,
      healthSummary: "Health 'error'. Storage failed its check.",
      healthTone: "error",
    });
    expect(state.word).toBe("DEGRADED");
    expect(state.tone).toBe("error");
  });

  it("ok with every probe green reads READY", () => {
    const state = deriveSetupState({ ...base, checks: green, healthSummary: null, healthTone: "ok" });
    expect(state.word).toBe("READY");
    expect(state.tone).toBe("ok");
    expect(state.sentence).toBe("Commissioning complete and operator mode unlocked.");
  });

  // 2026-09 production readiness, Slice 11 (F31): held light outputs are a
  // state the operator chose. The hardware link keeps its health `ok` while
  // held (`health::tests::held_light_outputs_are_not_a_fault` holds that side)
  // and says so only in the light-output entry's sentence, so the Setup word
  // stays READY — the header's Lighting lamp and the switch are where a hold
  // shows, never the fault posture.
  it("held light outputs leave a green runtime READY", () => {
    const state = deriveSetupState({
      ...base,
      checks: green,
      healthSummary:
        "Health 'ok'. Lighting ready. Light outputs held: nothing is sent to the rig until they are armed in Setup / Support.",
      healthTone: "ok",
    });
    expect(state.word).toBe("READY");
    expect(state.tone).toBe("ok");
    expect(state.sentence).toBe("Commissioning complete and operator mode unlocked.");
  });

  it("an unpublished runtime reads SETUP REQUIRED whatever the health says", () => {
    const state = deriveSetupState({
      ...base,
      checks: [],
      healthSummary: "Health 'attention'.",
      healthTone: "attention",
      published: false,
    });
    expect(state.word).toBe("SETUP REQUIRED");
    expect(state.wayOut).toBe("start-runner");
  });
});
