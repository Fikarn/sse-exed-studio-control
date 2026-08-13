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
    previewMode: false,
    previewDirty: false,
    previewSceneId: null,
    previewFixtures: [],
    ...overrides,
  } as unknown as LightingSnapshot;
}

describe("computeLiveSceneDrift", () => {
  it("is false without a snapshot or a recalled scene", () => {
    expect(computeLiveSceneDrift(null, null)).toBe(false);
    expect(computeLiveSceneDrift(snapshot({ lastRecalledSceneId: null }), null)).toBe(false);
  });

  it("is false when the rig matches the recalled scene", () => {
    expect(computeLiveSceneDrift(snapshot({}), null)).toBe(false);
  });

  it("latches when a fixture drifts from the recalled scene", () => {
    const drifted = snapshot({});
    (drifted.fixtures[0] as { intensity: number }).intensity = 40;
    expect(computeLiveSceneDrift(drifted, null)).toBe(true);
  });

  it("follows the engine's dirty flag in preview mode", () => {
    expect(computeLiveSceneDrift(snapshot({ previewMode: true, previewDirty: false }), null)).toBe(false);
    expect(computeLiveSceneDrift(snapshot({ previewMode: true, previewDirty: true }), null)).toBe(true);
  });
});
