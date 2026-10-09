import { describe, expect, it } from "vitest";

import { type AudioSnapshot } from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { audioDeskLockReason, audioLatches, audioWayOut } from "./audioLatches";
import { buildAudioViewModel, type AudioChannelGroupSelections } from "./audioViewModel";

// The Console's latches and way out, which the Overview shows too (D47).
const noChips: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": [] };

async function viewModelOf(fixtureId: string) {
  const transport = createFixtureTransport(getFixtureScenario(fixtureId));
  const audioSnapshot = (await transport.request("audio.snapshot")) as unknown as AudioSnapshot;
  await transport.dispose?.();
  return buildAudioViewModel({ activeChannelGroups: noChips, appSnapshot: null, audioSnapshot, bankIndex: 0 });
}

describe("audioWayOut", () => {
  it("sends a probe for a desk it cannot trust, a sync for one it has not read, Setup when OSC is off", () => {
    for (const word of ["NOT VERIFIED", "STALE", "OFFLINE", "DISCONNECTED"]) expect(audioWayOut(word)).toBe("probe");
    expect(audioWayOut("ASSUMED")).toBe("sync");
    expect(audioWayOut("SYNC NEEDED")).toBe("sync");
    expect(audioWayOut("ACTION FAILED")).toBe("failed");
    expect(audioWayOut("DISABLED")).toBe("setup");
    expect(audioWayOut("VERIFIED")).toBeNull();
    expect(audioWayOut("SIMULATED")).toBeNull();
  });
});

describe("audioLatches", () => {
  it("latches the default console's solo on FX 3/4, with Clear all", async () => {
    const viewModel = await viewModelOf("audio-populated");
    const latches = audioLatches(viewModel);
    expect(latches.map((latch) => latch.id)).toEqual(["solo"]);
    expect(latches[0]).toMatchObject({
      who: "Solo",
      names: ["FX 3/4"],
      text: "1 on FX 3/4",
      clear: { label: "Clear all", ariaLabel: "Clear all solo", locked: !viewModel.actionsAllowed },
    });
    expect(latches[0]!.clear.reason).toBe(audioDeskLockReason(viewModel.status));
  });

  it("latches a held clip after the solo, naming the strip", async () => {
    const latches = audioLatches(await viewModelOf("audio-clipped"));
    expect(latches.map((latch) => latch.id)).toEqual(["solo", "clip"]);
    expect(latches[1]).toMatchObject({
      who: "Clip",
      names: ["Guest 1"],
      text: "1 over 0 dBFS",
      clear: { label: "Clear", ariaLabel: "Clear clips", reason: "OSC control is off" },
    });
  });
});
