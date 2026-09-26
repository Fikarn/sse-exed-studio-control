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

// Slice 3 review, finding 15: the cases above use one shape on both sides, as
// the fixture double does. The hardware link does not. Its reply to the add
// (`lighting_fixture_snapshot_from_state`) carries the fixture's control values
// with `intensity` in them and, for a fixture with colour temperature, `cct`
// (`effective_fixture_control_values`), and a cct of 0 for a fixture without
// one (`fixture_default_cct`). The scene states it reads back
// (`normalize_lighting_editor_state`) carry neither key in their control values
// and hold a cct clamped to 2000–10000. Before the fix every scene at the add
// counted on the link, so the undo was refused whenever a scene existed.
describe("scenesSavedWithAddedFixture with the hardware link's shapes", () => {
  const atAdd = new Set(["scene-wide", "scene-interview", "scene-close"]);
  type SceneState = LightingSceneSnapshot["fixtureStates"][number];
  const scene = (id: string, state: SceneState): LightingSceneSnapshot => ({
    id,
    name: id,
    fixtureCount: 2,
    fixtureStates: [{ fixtureId: "fixture-key", intensity: 76, cct: 3200, on: true, controlValues: {} }, state],
    lastRecalled: false,
    lastRecalledAt: null,
    fadeProgress: null,
    fadeDurationMs: null,
    pinned: false,
    colorIndex: null,
  });
  // The hook keeps these four fields of the reply's `fixture`.
  const addedFrom = (fixture: {
    intensity: number;
    cct: number;
    on: boolean;
    controlValues: Record<string, number>;
  }) => ({
    intensity: fixture.intensity,
    cct: fixture.cct,
    on: fixture.on,
    controlValues: fixture.controlValues,
  });

  it("an Astra Bi-Color: no scene counts until one is saved with it changed, or after the add", () => {
    // `lighting.fixture.create`'s reply: the Astra's default cct is 4400.
    const reply = {
      id: "fixture-custom-1",
      name: "Stand 4",
      type: "astra-bicolor",
      definitionId: "litepanels-astra-bicolor",
      modeId: "default",
      universe: 1,
      dmxStartAddress: 81,
      kind: "profile",
      groupId: null,
      spatialX: null,
      spatialY: null,
      spatialRotation: 0,
      rigZ: null,
      beamAngleDegrees: null,
      on: false,
      intensity: 100,
      cct: 4400,
      controlValues: { intensity: 100, cct: 4400 },
      effect: null,
    };
    // `append_fixture_to_scenes`, as `lighting.snapshot` reads it back.
    const asRead: SceneState = { fixtureId: reply.id, intensity: 100, cct: 4400, on: false, controlValues: {} };
    const scenes = [scene("scene-wide", asRead), scene("scene-interview", asRead), scene("scene-close", asRead)];
    expect(scenesSavedWithAddedFixture(scenes, reply.id, atAdd, addedFrom(reply))).toBe(0);

    // Its cct still counts: saved again at 5000 K, and a scene saved after the add.
    const later = [
      ...scenes.slice(0, 2),
      scene("scene-close", { ...asRead, cct: 5000 }),
      scene("scene-custom-1", asRead),
    ];
    expect(scenesSavedWithAddedFixture(later, reply.id, atAdd, addedFrom(reply))).toBe(2);
  });

  it("an INFINIBAR PB12 in its RGB pixel mode, which has no colour temperature: the same", () => {
    // No cct control, so the reply's cct is 0 and its control values have no `cct`.
    const reply = {
      id: "fixture-custom-2",
      name: "Bar 2",
      type: "infinibar-pb12",
      definitionId: "aputure-infinibar-pb12",
      modeId: "pixel-rgb-48",
      universe: 1,
      dmxStartAddress: 101,
      kind: "practical",
      groupId: null,
      spatialX: null,
      spatialY: null,
      spatialRotation: 0,
      rigZ: null,
      beamAngleDegrees: null,
      on: false,
      intensity: 100,
      cct: 0,
      controlValues: { red: 0, green: 0, blue: 0, intensity: 100 },
      effect: null,
    };
    const asRead: SceneState = {
      fixtureId: reply.id,
      intensity: 100,
      cct: 2000,
      on: false,
      controlValues: { red: 0, green: 0, blue: 0 },
    };
    // Saved again with the fixture as it was: the link has given the fixture its
    // type's default cct (5600) once it read it back, and the scene takes that.
    const resaved: SceneState = { ...asRead, cct: 5600 };
    const scenes = [scene("scene-wide", asRead), scene("scene-interview", asRead), scene("scene-close", resaved)];
    expect(scenesSavedWithAddedFixture(scenes, reply.id, atAdd, addedFrom(reply))).toBe(0);

    // Its other controls still count: saved again with red at 200.
    const later = [
      ...scenes.slice(0, 2),
      scene("scene-close", { ...resaved, controlValues: { red: 200, green: 0, blue: 0 } }),
    ];
    expect(scenesSavedWithAddedFixture(later, reply.id, atAdd, addedFrom(reply))).toBe(1);
  });
});
