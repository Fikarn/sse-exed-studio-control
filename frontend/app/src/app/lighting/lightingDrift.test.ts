import { describe, expect, it } from "vitest";

import type { LightingSnapshot } from "@sse/engine-client";

import { computeLiveSceneDrift } from "./lightingDrift";

function snapshot(overrides: Partial<LightingSnapshot>): LightingSnapshot {
  const fixture = {
    id: "fx-1",
    name: "Key",
    type: "panel",
    kind: "panel",
    definitionId: "def-1",
    modeId: "mode-1",
    intensity: 80,
    cct: 3200,
    on: true,
    controlValues: {},
  };
  return {
    fixtures: [fixture],
    scenes: [
      {
        id: "scene-1",
        name: "Warm wash",
        lastRecalled: true,
        lastRecalledAt: "2026-04-22T11:42:00.000Z",
        fixtureCount: 1,
        fixtureStates: [{ fixtureId: "fx-1", intensity: 80, cct: 3200, on: true, controlValues: {} }],
      },
    ],
    lastRecalledSceneId: "scene-1",
    sceneState: "live",
    previewMode: false,
    previewDirty: false,
    previewSceneId: null,
    previewFixtures: [],
    ...overrides,
  } as unknown as LightingSnapshot;
}

// 2026-10-03: the hardware link decides whether the rig holds the live scene
// (`sceneState`), for the screen and the deck alike; the page reads it.
describe("computeLiveSceneDrift", () => {
  it("is false without a snapshot or a scene on the rig", () => {
    expect(computeLiveSceneDrift(null, null)).toBe(false);
    expect(computeLiveSceneDrift(snapshot({ lastRecalledSceneId: null, sceneState: "chosen" }), null)).toBe(false);
    expect(computeLiveSceneDrift(snapshot({ sceneState: "none" }), null)).toBe(false);
  });

  it("is false while the rig holds the live scene", () => {
    expect(computeLiveSceneDrift(snapshot({ sceneState: "live" }), null)).toBe(false);
  });

  it("latches when the hardware link says the rig changed since", () => {
    expect(computeLiveSceneDrift(snapshot({ sceneState: "unsaved" }), null)).toBe(true);
  });

  it("reads the hardware link's answer, not the fixtures", () => {
    const drifted = snapshot({ sceneState: "live" });
    (drifted.fixtures[0] as { intensity: number }).intensity = 40;
    expect(computeLiveSceneDrift(drifted)).toBe(false);
  });

  it("follows the engine's dirty flag in preview mode", () => {
    expect(computeLiveSceneDrift(snapshot({ previewMode: true, previewDirty: false }), null)).toBe(false);
    expect(computeLiveSceneDrift(snapshot({ previewMode: true, previewDirty: true }), null)).toBe(true);
  });
});
