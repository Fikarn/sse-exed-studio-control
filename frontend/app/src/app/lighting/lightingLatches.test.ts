import { describe, expect, it } from "vitest";

import { type LightingSnapshot } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { latchNames, lightingLatches } from "./lightingLatches";
import { deriveLightingState, lightingStateInputOf, liveSceneOf } from "./lightingState";

// Lighting's latches and state, read from the snapshot alone, as the
// Overview reads them (D47).
async function snapshotOf(fixtureId: string) {
  const transport = createFixtureTransport(getFixtureScenario(fixtureId));
  const snapshot = (await transport.request("lighting.snapshot")) as unknown as LightingSnapshot;
  await transport.dispose?.();
  return snapshot;
}

describe("latchNames", () => {
  it("names two, then says how many more", () => {
    expect(latchNames(["Key"])).toBe("Key");
    expect(latchNames(["Key", "Fill"])).toBe("Key, Fill");
    expect(latchNames(["Key", "Fill", "Back", "Hair"])).toBe("Key, Fill and 2 more");
  });
});

describe("lightingLatches", () => {
  it("holds nothing while no overlay is on", async () => {
    expect(lightingLatches(await snapshotOf("lighting-populated"))).toEqual([]);
    expect(lightingLatches(null)).toEqual([]);
  });

  it("latches a highlight, then a solo, by the fixtures' names", async () => {
    const snapshot = await snapshotOf("lighting-populated");
    const [first, second, third] = snapshot.fixtures;
    const latches = lightingLatches({
      ...snapshot,
      highlightFixtureIds: [first!.id],
      soloFixtureIds: [second!.id, third!.id],
    });
    expect(latches).toEqual([
      { id: "highlight", who: "Highlight", text: first!.name, names: [first!.name] },
      {
        id: "solo",
        who: "Solo",
        text: `${second!.name}, ${third!.name}`,
        names: [second!.name, third!.name],
      },
    ]);
  });
});

describe("lightingStateInputOf", () => {
  it("reads the rig as the Lighting page reads it", async () => {
    const snapshot = await snapshotOf("lighting-populated");
    const input = lightingStateInputOf(snapshot);
    expect(input).toMatchObject({
      bridgeIp: snapshot.bridgeIp,
      bridgeReachable: snapshot.reachable === true,
      outputsHeld: snapshot.outputArmed === false,
      fixtureOnCount: snapshot.fixtures.filter((fixture) => fixture.on).length,
      fixtureTotal: snapshot.fixtures.length,
      previewMode: false,
      sceneName: liveSceneOf(snapshot)?.name ?? null,
    });
    expect(deriveLightingState(input).word).toBeTruthy();
  });

  it("says UNSAVED when the rig has left its scene, and HELD when the outputs are held", async () => {
    const snapshot = await snapshotOf("lighting-populated");
    const reachable = { ...snapshot, reachable: true, bridgeAnswering: true, outputArmed: true };
    expect(deriveLightingState(lightingStateInputOf({ ...reachable, sceneState: "unsaved" })).word).toBe("UNSAVED");
    expect(deriveLightingState(lightingStateInputOf({ ...reachable, outputArmed: false })).word).toBe("HELD");
    expect(deriveLightingState(lightingStateInputOf({ ...reachable, sceneState: "live" })).word).toBe("REACHABLE");
  });

  it("names the scene being edited in preview", async () => {
    const snapshot = await snapshotOf("lighting-populated");
    const edited = snapshot.scenes[snapshot.scenes.length - 1]!;
    const input = lightingStateInputOf({
      ...snapshot,
      previewMode: true,
      previewDirty: true,
      previewSceneId: edited.id,
    });
    expect(input).toMatchObject({ previewMode: true, previewDirty: true, sceneModified: true, sceneName: edited.name });
  });
});
