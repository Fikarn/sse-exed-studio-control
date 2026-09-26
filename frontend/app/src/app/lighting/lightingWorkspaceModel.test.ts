import type { LightingSceneSnapshot } from "@sse/engine-client";
import { describe, expect, it, vi } from "vitest";

import type { ToastApi } from "../shared/toastContext";
import { pushUndoOutcomeToast, scenesSavedWithAddedFixture } from "./lightingWorkspaceModel";

// New pages program, Slice 3 (decision 5): the Undo key and the Undo on a
// step's own message report through one helper. After an undo the message
// reads "Undid ‘X’." — no key hint (it used to add "· Ctrl+Shift+Z to redo",
// and the message's own Undo said "Undid: X.").

function toastSpy() {
  const push = vi.fn();
  return { toast: { push } as unknown as ToastApi, push };
}

describe("pushUndoOutcomeToast", () => {
  it("names the undone step and nothing else", () => {
    const { toast, push } = toastSpy();
    pushUndoOutcomeToast(toast, { kind: "ok", label: "Delete scene Interview" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ tone: "ok", message: "Undid ‘Delete scene Interview’." });
  });

  it("says why a step cannot be undone, and that a failed undo left it in place", () => {
    const { toast, push } = toastSpy();
    pushUndoOutcomeToast(toast, { kind: "rejected", label: "Add fixture Stand 4", reason: "it is in a scene" });
    pushUndoOutcomeToast(toast, { kind: "error", label: "Save scene Wide", error: new Error("no answer") });
    pushUndoOutcomeToast(toast, { kind: "noop" });
    expect(push.mock.calls.map(([entry]) => entry)).toEqual([
      { tone: "attention", message: "Cannot undo ‘Add fixture Stand 4’: it is in a scene." },
      { tone: "error", message: "Undo failed for ‘Save scene Wide’. The step is still in place." },
    ]);
  });
});

// Decision 5 also puts an Undo on "Fixture added.". Adding a fixture puts it,
// off, into every scene there is (the hardware link's `append_fixture_to_scenes`,
// and the fixture double's create), and the undo was refused whenever any scene
// held the fixture — so whenever a scene existed at all. Only a scene that saved
// the fixture after it was added stops the undo now.
describe("scenesSavedWithAddedFixture", () => {
  const added = { intensity: 100, cct: 3200, on: false, controlValues: { fan: 0 } };
  const holding = (
    id: string,
    state: Partial<LightingSceneSnapshot["fixtureStates"][number]> = {}
  ): LightingSceneSnapshot => ({
    id,
    name: id,
    fixtureCount: 2,
    fixtureStates: [
      { fixtureId: "fixture-key", intensity: 76, cct: 3200, on: true, controlValues: {} },
      { fixtureId: "fixture-new", intensity: 100, cct: 3200, on: false, controlValues: { fan: 0 }, ...state },
    ],
    lastRecalled: false,
    lastRecalledAt: null,
    fadeProgress: null,
    fadeDurationMs: null,
    pinned: false,
    colorIndex: null,
  });
  const atAdd = new Set(["scene-wide", "scene-interview", "scene-close"]);

  it("does not count the fixture the add put into every scene", () => {
    const scenes = [holding("scene-wide"), holding("scene-interview"), holding("scene-close")];
    expect(scenesSavedWithAddedFixture(scenes, "fixture-new", atAdd, added)).toBe(0);
  });

  it("counts a scene saved after the add, or saved again with the fixture changed", () => {
    const scenes = [
      holding("scene-wide"),
      holding("scene-interview", { on: true, intensity: 40 }),
      holding("scene-close", { controlValues: { fan: 60 } }),
      holding("scene-new"),
    ];
    expect(scenesSavedWithAddedFixture(scenes, "fixture-new", atAdd, added)).toBe(3);
  });
});
