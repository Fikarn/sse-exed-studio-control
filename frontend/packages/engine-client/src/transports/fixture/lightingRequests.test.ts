import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";
import { lightingFixtureCctRange } from "./lightingCatalog";

// The fixture double answers the rig's eight actions the way the hardware link
// does (`native/rust-engine/src/lighting/`: `identify.rs`, `fixtures.rs`,
// `scenes.rs`, `groups.rs`, the result structs in `types.rs`, the checks in
// `parse.rs`): the same reply fields, one `lighting.changed` with the
// dispatcher's reason (`app.rs`), and the change in what `lighting.snapshot`
// shows. Until 2026-09-22 all eight answered `{}` and changed nothing.

const START = Date.parse("2026-09-22T12:00:00.000Z");

function openDouble() {
  const transport = createFixtureTransport(getFixtureScenario("lighting-populated"));
  const reasons: unknown[] = [];
  transport.subscribe((event) => {
    if (event.event === "lighting.changed") reasons.push((event.payload as JsonObject).reason);
  });
  const request = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;
  const snapshot = () => request("lighting.snapshot");
  const fixture = async (fixtureId: string) =>
    ((await snapshot()).fixtures as JsonObject[]).find((entry) => entry.id === fixtureId);
  const ids = (entries: JsonValue | undefined) => (entries as JsonObject[]).map((entry) => entry.id);
  return { transport, reasons, request, snapshot, fixture, ids };
}

describe("the fixture double's rig actions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lighting.fixture.identify lights the fixture for its burst and leaves the stored rig alone", async () => {
    const { request, fixture, reasons } = openDouble();
    const back = await fixture("fixture-back");
    expect(back).toMatchObject({ on: false, intensity: 0 });

    const reply = await request("lighting.fixture.identify", { fixtureId: "fixture-back" });
    expect(Object.keys(reply).sort()).toEqual(["durationMs", "fixtureId", "summary"]);
    expect(reply).toEqual({
      fixtureId: "fixture-back",
      durationMs: 1200,
      summary: "Identify burst for Back (1200 ms on universe 1)",
    });
    expect(reasons).toEqual(["fixture-identified"]);
    expect(await fixture("fixture-back")).toMatchObject({
      on: true,
      intensity: 100,
      cct: lightingFixtureCctRange(back!).max,
    });

    vi.setSystemTime(START + 1_199);
    expect(await fixture("fixture-back")).toMatchObject({ on: true, intensity: 100 });
    vi.setSystemTime(START + 1_200);
    expect(await fixture("fixture-back")).toEqual(back);

    expect((await request("lighting.fixture.identify", { fixtureId: "fixture-key", durationMs: 50 })).durationMs).toBe(
      100
    );
    expect(
      (await request("lighting.fixture.identify", { fixtureId: "fixture-key", durationMs: 9_000 })).durationMs
    ).toBe(5000);
    await expect(request("lighting.fixture.identify", { fixtureId: "fixture-key", durationMs: 1.5 })).rejects.toThrow(
      "durationMs must be a number"
    );
    await expect(request("lighting.fixture.identify", {})).rejects.toThrow("fixtureId is required");
    await expect(request("lighting.fixture.identify", { fixtureId: "fixture-gone" })).rejects.toThrow(
      "Lighting fixture 'fixture-gone' is not exposed by the native editor state."
    );
  });

  it("lighting.fixture.highlight holds Highlight or Solo, never both, and Off clears them", async () => {
    const { request, snapshot, fixture, reasons } = openDouble();
    const fill = await fixture("fixture-fill");

    const reply = await request("lighting.fixture.highlight", {
      fixtureIds: ["fixture-key", "fixture-back"],
      mode: "highlight",
    });
    expect(Object.keys(reply).sort()).toEqual(["fixtureCount", "mode", "summary"]);
    expect(reply).toEqual({ mode: "highlight", fixtureCount: 2, summary: "Highlight on 2 fixture(s)" });
    expect(reasons).toEqual(["fixture-highlighted"]);
    const highlighted = await snapshot();
    expect(highlighted.highlightFixtureIds).toEqual(["fixture-back", "fixture-key"]);
    expect(highlighted.soloFixtureIds).toEqual([]);
    expect(await fixture("fixture-back")).toMatchObject({ on: true, intensity: 100, cct: 4500 });
    expect(await fixture("fixture-fill")).toEqual(fill);

    await expect(request("lighting.fixture.highlight", { fixtureIds: ["fixture-key"], mode: "solo" })).rejects.toThrow(
      "Highlight is active; clear highlight before activating solo."
    );
    expect(await request("lighting.fixture.highlight", { fixtureIds: [], mode: "off" })).toEqual({
      mode: "off",
      fixtureCount: 0,
      summary: "Cleared highlight + solo overlays",
    });
    expect((await snapshot()).highlightFixtureIds).toEqual([]);

    await request("lighting.fixture.highlight", { fixtureIds: ["fixture-key"], mode: "solo" });
    expect((await snapshot()).soloFixtureIds).toEqual(["fixture-key"]);
    expect(await fixture("fixture-fill")).toMatchObject({ on: false, intensity: 0, cct: fill!.cct });
    expect((await fixture("fixture-key"))?.intensity).toBe(76);
    await expect(
      request("lighting.fixture.highlight", { fixtureIds: ["fixture-key"], mode: "highlight" })
    ).rejects.toThrow("Solo is active; clear solo before activating highlight.");

    await expect(request("lighting.fixture.highlight", { fixtureIds: [] })).rejects.toThrow("mode is required");
    await expect(request("lighting.fixture.highlight", { fixtureIds: [], mode: "spot" })).rejects.toThrow(
      'mode must be one of "highlight", "solo", or "off"'
    );
    await expect(request("lighting.fixture.highlight", { mode: "off" })).rejects.toThrow(
      "fixtureIds must be an array of strings"
    );
  });

  it("lighting.fixture.identifySequence flashes each light a step after the one before", async () => {
    const { request, fixture, reasons } = openDouble();
    const reply = await request("lighting.fixture.identifySequence", {
      fixtureIds: ["fixture-back", "fixture-fill"],
      stepMs: 500,
      durationMs: 400,
    });
    expect(Object.keys(reply).sort()).toEqual(["durationMs", "fixtureCount", "stepMs", "summary", "totalDurationMs"]);
    expect(reply).toEqual({
      fixtureCount: 2,
      stepMs: 500,
      durationMs: 400,
      totalDurationMs: 900,
      summary: "Identify sequence on 2 fixture(s) (step 500 ms, 400 ms each)",
    });
    expect(reasons).toEqual(["identify-sequence-started"]);
    expect(await fixture("fixture-back")).toMatchObject({ on: true, intensity: 100 });
    expect((await fixture("fixture-fill"))?.intensity).toBe(58);

    vi.setSystemTime(START + 500);
    expect(await fixture("fixture-back")).toMatchObject({ on: false, intensity: 0 });
    expect(await fixture("fixture-fill")).toMatchObject({ on: true, intensity: 100 });

    await expect(
      request("lighting.fixture.identifySequence", { fixtureIds: [], stepMs: 500, durationMs: 400 })
    ).rejects.toThrow("fixtureIds must contain at least one id");
    await expect(
      request("lighting.fixture.identifySequence", { fixtureIds: ["fixture-key"], durationMs: 400 })
    ).rejects.toThrow("stepMs is required");
  });

  it("lighting.fixture.identify.clearAll ends a Find sequence, the flashes still waiting included", async () => {
    const { request, fixture, reasons } = openDouble();
    await request("lighting.fixture.identifySequence", {
      fixtureIds: ["fixture-back", "fixture-fill"],
      stepMs: 500,
      durationMs: 400,
    });
    const reply = await request("lighting.fixture.identify.clearAll");
    expect(Object.keys(reply).sort()).toEqual(["clearedCount", "summary"]);
    expect(reply).toEqual({ clearedCount: 2, summary: "Cleared 2 identify burst(s)" });
    expect(reasons).toEqual(["identify-sequence-started", "identify-cleared"]);
    expect(await fixture("fixture-back")).toMatchObject({ on: false, intensity: 0 });
    vi.setSystemTime(START + 500);
    expect((await fixture("fixture-fill"))?.intensity).toBe(58);
  });

  it("lighting.fixture.delete takes the light out of the rig, its group and every scene", async () => {
    const { request, snapshot, ids, reasons } = openDouble();
    const reply = await request("lighting.fixture.delete", { fixtureId: "fixture-key" });
    expect(Object.keys(reply).sort()).toEqual(["deleted", "fixtureId", "summary"]);
    expect(reply).toEqual({ deleted: true, fixtureId: "fixture-key", summary: "Lighting fixture 'Key' was deleted." });
    expect(reasons).toEqual(["fixture-deleted"]);

    const after = await snapshot();
    expect(ids(after.fixtures)).toEqual(["fixture-fill", "fixture-back", "fixture-kicker"]);
    expect(after.selectedFixtureId).toBeNull();
    expect((after.groups as JsonObject[]).find((group) => group.id === "group-front")?.fixtureCount).toBe(1);
    for (const scene of after.scenes as JsonObject[]) {
      expect((scene.fixtureStates as JsonObject[]).map((state) => state.fixtureId)).not.toContain("fixture-key");
    }
    await expect(request("lighting.fixture.delete", { fixtureId: "fixture-key" })).rejects.toThrow(
      "Lighting fixture 'fixture-key' is not exposed by the native editor state."
    );
  });

  it("lighting.scene.pin shows a pinned scene first and puts it back when unpinned", async () => {
    const { request, snapshot, ids, reasons } = openDouble();
    expect(ids((await snapshot()).scenes)).toEqual(["scene-warm-wash", "scene-interview"]);

    const reply = await request("lighting.scene.pin", { sceneId: "scene-interview", pinned: true });
    expect(Object.keys(reply).sort()).toEqual(["scene", "summary"]);
    expect(reply.summary).toBe("Lighting scene 'Interview' was pinned.");
    expect(reply.scene).toMatchObject({ id: "scene-interview", name: "Interview", pinned: true });
    expect(reasons).toEqual(["scene-pinned"]);
    const pinned = await snapshot();
    expect(ids(pinned.scenes)).toEqual(["scene-interview", "scene-warm-wash"]);
    expect((pinned.scenes as JsonObject[]).map((scene) => scene.pinned)).toEqual([true, false]);

    expect((await request("lighting.scene.pin", { sceneId: "scene-interview", pinned: false })).summary).toBe(
      "Lighting scene 'Interview' was unpinned."
    );
    expect(ids((await snapshot()).scenes)).toEqual(["scene-warm-wash", "scene-interview"]);
    await expect(request("lighting.scene.pin", { sceneId: "scene-interview" })).rejects.toThrow(
      "pinned must be a boolean"
    );
  });

  it("lighting.scene.reorder moves a scene before its anchor, or last", async () => {
    const { request, snapshot, ids, reasons } = openDouble();
    const reply = await request("lighting.scene.reorder", {
      sceneId: "scene-interview",
      beforeSceneId: "scene-warm-wash",
    });
    expect(reply).toEqual({
      sceneId: "scene-interview",
      summary: "Lighting scene 'scene-interview' was reordered in the rail.",
    });
    expect(reasons).toEqual(["scene-reordered"]);
    expect(ids((await snapshot()).scenes)).toEqual(["scene-interview", "scene-warm-wash"]);

    await request("lighting.scene.reorder", { sceneId: "scene-interview", beforeSceneId: null });
    expect(ids((await snapshot()).scenes)).toEqual(["scene-warm-wash", "scene-interview"]);
    await expect(
      request("lighting.scene.reorder", { sceneId: "scene-interview", beforeSceneId: "scene-interview" })
    ).rejects.toThrow("beforeSceneId must differ from sceneId");
    await expect(
      request("lighting.scene.reorder", { sceneId: "scene-interview", beforeSceneId: "scene-gone" })
    ).rejects.toThrow("Reorder anchor scene 'scene-gone' is not exposed by the native editor state.");
  });

  it("lighting.group.reorder moves a group before its anchor, or last", async () => {
    const { request, snapshot, ids, reasons } = openDouble();
    const reply = await request("lighting.group.reorder", { groupId: "group-back", beforeGroupId: "group-front" });
    expect(reply).toEqual({ groupId: "group-back", summary: "Lighting group 'group-back' was reordered in the rail." });
    expect(reasons).toEqual(["group-reordered"]);
    expect(ids((await snapshot()).groups)).toEqual(["group-back", "group-front"]);

    await request("lighting.group.reorder", { groupId: "group-back" });
    expect(ids((await snapshot()).groups)).toEqual(["group-front", "group-back"]);
    await expect(request("lighting.group.reorder", { groupId: "group-back", beforeGroupId: 3 })).rejects.toThrow(
      "beforeGroupId must be a string or null"
    );
    await expect(request("lighting.group.reorder", { groupId: "group-gone" })).rejects.toThrow(
      "Lighting group 'group-gone' is not exposed by the native editor state."
    );
  });
});
