import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject } from "../../generated/protocol";
import type { FixtureScenario } from "../../types";
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

  // The walk of 2026-10-07, finding 3 (2026-10-08): Setup's list of the strips
  // TotalMix hides, as the hardware link takes it (`audio/settings.rs`,
  // `audio/channels.rs`): the whole list, the strips read hidden, a change to
  // one is refused, Clear all leaves a hidden solo, and the row says the list.
  it("lists the strips TotalMix hides, locks them, and leaves a hidden solo at Clear all", async () => {
    const transport = await verifiedConsole();
    await transport.request("audio.channel.update", { channelId: "audio-playback-9-10", solo: true });
    await transport.request("audio.channel.update", { channelId: "audio-playback-3-4", solo: true });
    await transport.request("audio.settings.update", { hiddenChannelIds: ["audio-playback-9-10", "audio-input-1"] });
    let snapshot = await audioSnapshot(transport);
    const hidden = (snapshot.channels as JsonObject[])
      .filter((entry) => entry.hidden === true)
      .map((entry) => entry.id);
    expect(hidden).toEqual(["audio-input-1", "audio-playback-9-10"]);
    await expect(
      transport.request("audio.channel.update", { channelId: "audio-playback-9-10", mute: true })
    ).rejects.toMatchObject({ code: "AUDIO_CHANNEL_HIDDEN" });
    await expect(
      transport.request("audio.settings.update", { hiddenChannelIds: ["audio-input-99"] })
    ).rejects.toMatchObject({ code: "AUDIO_CHANNEL_NOT_FOUND" });
    const support = (await transport.request("support.snapshot", {})) as JsonObject;
    expect((support.recentEvents as JsonObject[])[0]).toMatchObject({
      domain: "audio",
      action: "console-hidden-strips-set",
      target: "TotalMix",
      detail: "Strips TotalMix hides: Line 1, Playback 9/10",
    });
    await transport.request("audio.solo.clearAll", {});
    snapshot = await audioSnapshot(transport);
    const solo = (id: string) => (snapshot.channels as JsonObject[]).find((entry) => entry.id === id)?.solo;
    expect(solo("audio-playback-3-4")).toBe(false);
    expect(solo("audio-playback-9-10")).toBe(true);
    await transport.request("audio.settings.update", { hiddenChannelIds: [] });
    snapshot = await audioSnapshot(transport);
    expect((snapshot.channels as JsonObject[]).every((entry) => entry.hidden === false)).toBe(true);
  });
});

describe("the fixture double's console seed", () => {
  // The Overview's fixtures (D47): a scenario names the soloed strips as it names the
  // clipped ones; the list replaces the default console's solo (FX 3/4), and `[]` clears it.
  it("starts with the solos a scenario names, in place of the default console's", async () => {
    const soloed = async (soloChannelIds?: string[]) => {
      const scenario: FixtureScenario = getFixtureScenario("audio-populated");
      const transport = createFixtureTransport({
        ...scenario,
        audioSnapshot: { ...scenario.audioSnapshot, ...(soloChannelIds ? { soloChannelIds } : {}) },
      });
      const snapshot = await audioSnapshot(transport);
      expect(snapshot, "the seed's key is not the console's").not.toHaveProperty("soloChannelIds");
      return (snapshot.channels as JsonObject[]).filter((entry) => entry.solo === true).map((entry) => entry.id);
    };
    expect(await soloed()).toEqual(["audio-playback-3-4"]);
    expect(await soloed(["audio-input-12", "audio-input-9"])).toEqual(["audio-input-9", "audio-input-12"]);
    expect(await soloed([])).toEqual([]);
  });
});
