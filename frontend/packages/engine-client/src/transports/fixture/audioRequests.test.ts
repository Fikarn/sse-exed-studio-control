import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";

// 2026-10-01 (the owner's decision, after the studio walk): the Console's
// snapshots are TotalMix's eight and the channels take TotalMix's names. The
// double serves `audio.snapshot.load` as the hardware link's simulated console
// does (`native/rust-engine/src/audio/load.rs`) and refuses a channel rename as
// the hardware link does (`audio/parse.rs`).

async function verifiedConsole() {
  const transport = createFixtureTransport(getFixtureScenario("audio-populated"));
  await transport.request("commissioning.check.run", {
    target: "audio",
    sendHost: "127.0.0.1",
    sendPort: 7001,
    receivePort: 9001,
  });
  return transport;
}

async function audioSnapshot(transport: ReturnType<typeof createFixtureTransport>) {
  return (await transport.request("audio.snapshot", {})) as JsonObject & {
    consoleSnapshots: { slots: Array<{ slot: number; name: string | null; state: string }> };
  };
}

describe("the fixture double's TotalMix snapshots", () => {
  it("starts with TotalMix's eight slots, their names and the time TotalMix saved them", async () => {
    const transport = createFixtureTransport(getFixtureScenario("audio-populated"));
    const snapshot = await audioSnapshot(transport);
    expect(snapshot.consoleSnapshots).toEqual({
      slots: [
        { slot: 1, name: "Mix 1", state: "active" },
        { slot: 2, name: "Interview", state: "off" },
        { slot: 3, name: "Panel & Q&A", state: "off" },
        { slot: 4, name: null, state: "unknown" },
        { slot: 5, name: null, state: "unknown" },
        { slot: 6, name: null, state: "unknown" },
        { slot: 7, name: null, state: "unknown" },
        { slot: 8, name: null, state: "unknown" },
      ],
      namesSavedAt: "2026-09-21T08:17:36Z",
      namesNote: null,
    });
    expect(snapshot).not.toHaveProperty("snapshots");
    expect(snapshot).not.toHaveProperty("lastRecalledSnapshotId");
  });

  it("loads a slot on the simulated console: it becomes active, the slots TotalMix reported go off", async () => {
    const transport = await verifiedConsole();
    const reply = await transport.request("audio.snapshot.load", { slot: 2 });
    expect(reply).toMatchObject({
      loaded: true,
      slot: 2,
      name: "Interview",
      summary: "Loaded Interview on the simulated console; nothing was sent (test mode).",
      consoleStateConfidence: "aligned",
      pulledValues: 0,
      totalMixReported: false,
    });
    const snapshot = await audioSnapshot(transport);
    expect(snapshot.consoleSnapshots.slots.map((entry) => entry.state)).toEqual([
      "off",
      "active",
      "off",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(snapshot).toMatchObject({
      consoleStateConfidence: "aligned",
      lastConsoleSyncReason: "simulated-load",
      lastActionStatus: "succeeded",
      lastActionMessage: "Loaded Interview on the simulated console; nothing was sent (test mode).",
    });
  });

  it("names a slot TotalMix saved no name for by its number", async () => {
    const transport = await verifiedConsole();
    const reply = await transport.request("audio.snapshot.load", { slot: 6 });
    expect(reply).toMatchObject({
      slot: 6,
      name: null,
      summary: "Loaded slot 6 on the simulated console; nothing was sent (test mode).",
    });
    const support = (await transport.request("support.snapshot", {})) as JsonObject;
    expect((support.recentEvents as JsonObject[])[0]).toMatchObject({
      domain: "audio",
      action: "console-snapshot-loaded",
      target: "slot 6",
      detail: "Console mix loaded in TotalMix: slot 6",
    });
  });

  it("refuses a load before the audio probe passed, and a slot TotalMix does not have", async () => {
    const unverified = createFixtureTransport(getFixtureScenario("audio-not-verified"));
    await expect(unverified.request("audio.snapshot.load", { slot: 1 })).rejects.toThrow("Audio is not verified yet");
    const transport = await verifiedConsole();
    await expect(transport.request("audio.snapshot.load", { slot: 9 })).rejects.toMatchObject({
      code: "INVALID_PARAMS",
    });
    await expect(transport.request("audio.snapshot.load", {})).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("refuses a channel rename: the channels are named in TotalMix", async () => {
    const transport = await verifiedConsole();
    await expect(
      transport.request("audio.channel.update", { channelId: "audio-input-1", name: "Renamed" })
    ).rejects.toThrow("channels are named in TotalMix");
    const snapshot = await audioSnapshot(transport);
    const channel = (snapshot.channels as JsonObject[]).find((entry) => entry.id === "audio-input-1");
    expect(channel?.name).toBe("Line 1");
  });
});
