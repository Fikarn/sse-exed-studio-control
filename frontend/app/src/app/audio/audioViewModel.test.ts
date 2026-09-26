import { beforeAll, describe, expect, it } from "vitest";

import { createFixtureTransport, type AudioSnapshot } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import {
  audioBankSizes,
  buildAudioViewModel,
  toggleChannelGroupSelection,
  type AudioChannelGroupSelections,
} from "./audioViewModel";

// 2026-09 audit remediation, Slice 9 (operator decision 6): the strip counts
// per bank are one explicit table per density. Before this the view model
// only knew "desktop" and a legacy "touch" branch, so the 1920×1080 fallback
// rendered the 2560 counts into a narrower surface and every tier scrolled.
describe("audioBankSizes", () => {
  it("shows 4 inputs, 6 playback pairs and 12 strips at desktop density", () => {
    expect(audioBankSizes("desktop", 12)).toEqual({
      hardwareInputBankSize: 4,
      softwarePlaybackBankSize: 6,
      visibleStripCount: 12,
    });
  });

  it("shows 4 inputs, 4 playback pairs and 8 strips at compact density", () => {
    expect(audioBankSizes("compact", 12)).toEqual({
      hardwareInputBankSize: 4,
      softwarePlaybackBankSize: 4,
      visibleStripCount: 8,
    });
  });

  it("keeps the legacy touch table", () => {
    expect(audioBankSizes("touch", 12)).toEqual({
      hardwareInputBankSize: 8,
      softwarePlaybackBankSize: 4,
      visibleStripCount: 8,
    });
  });

  it("lets the engine's fadersPerBank cap inputs and strips but not playback", () => {
    expect(audioBankSizes("desktop", 2)).toEqual({
      hardwareInputBankSize: 2,
      softwarePlaybackBankSize: 6,
      visibleStripCount: 2,
    });
    expect(audioBankSizes("compact", 3)).toEqual({
      hardwareInputBankSize: 3,
      softwarePlaybackBankSize: 4,
      visibleStripCount: 3,
    });
  });
});

// New pages program, Slice 3 (decision 10): a plain click switches a group
// chip on or off, and several chips can be lit at once. Before, a plain click
// lit one chip only and Shift+click added one — a key held while pointing, now
// gone with the other keys.
describe("toggleChannelGroupSelection", () => {
  const none: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": [] };
  const playbackChips = ["bed", "fx"] as const;

  it("lights a second chip beside the first", () => {
    const fx = toggleChannelGroupSelection(none, { group: "fx", tierId: "software-playback" }, playbackChips);
    expect(fx["software-playback"]).toEqual(["fx"]);
    const both = toggleChannelGroupSelection(fx, { group: "bed", tierId: "software-playback" }, playbackChips);
    expect(both["software-playback"]).toEqual(["bed", "fx"]);
  });

  it("turns a lit chip off with a second click, and none lit means every strip shows", () => {
    const both: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": ["bed", "fx"] };
    const bedOnly = toggleChannelGroupSelection(both, { group: "fx", tierId: "software-playback" }, playbackChips);
    expect(bedOnly["software-playback"]).toEqual(["bed"]);
    const cleared = toggleChannelGroupSelection(bedOnly, { group: "bed", tierId: "software-playback" }, playbackChips);
    expect(cleared["software-playback"]).toEqual([]);
  });

  it("keeps only the chips the bank offers and leaves the other row alone", () => {
    const current: AudioChannelGroupSelections = { "hardware-inputs": ["talent"], "software-playback": ["remote"] };
    const next = toggleChannelGroupSelection(current, { group: "fx", tierId: "software-playback" }, playbackChips);
    expect(next["software-playback"]).toEqual(["fx"]);
    expect(next["hardware-inputs"]).toEqual(["talent"]);
  });
});

// New pages program, Slice 3 (decision 3): the Inputs heading carries the bank
// keys and prints its bank readout on every bank. The readout used to count the
// Inputs bank's first channel, both rows' strip count and every channel, so the
// Inputs row said "ch 1-12 of 18" on bank 1 and "ch 5-16 of 18" on bank 2
// while it showed four inputs of twelve.
describe("a row's bank readout", () => {
  // The fixture double's whole Console (12 inputs, 6 playback pairs), as the
  // browser gets it; the scenario file holds only what it overrides.
  let audioSnapshot: AudioSnapshot;
  beforeAll(async () => {
    const transport = createFixtureTransport(getFixtureScenario("audio-populated"));
    audioSnapshot = (await transport.request("audio.snapshot")) as unknown as AudioSnapshot;
    await transport.dispose?.();
  });
  const noChips: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": [] };
  const viewModelOnBank = (bankIndex: number, activeChannelGroups: AudioChannelGroupSelections = noChips) =>
    buildAudioViewModel({ activeChannelGroups, appSnapshot: null, audioSnapshot, bankIndex, density: "desktop" });

  it("counts the Inputs row's own channels on every bank", () => {
    expect(viewModelOnBank(0).hardwareInputs.bankReadout).toBe("Bank 1 / 3 · ch 1-4 of 12");
    expect(viewModelOnBank(1).hardwareInputs.bankReadout).toBe("Bank 2 / 3 · ch 5-8 of 12");
    expect(viewModelOnBank(2).hardwareInputs.bankReadout).toBe("Bank 3 / 3 · ch 9-12 of 12");
  });

  it("counts the Playback row's own pairs", () => {
    expect(viewModelOnBank(0).softwarePlayback.bankReadout).toBe("Bank 1 / 3 · ch 1-6 of 6");
  });

  it("counts only what the lit chips let through", () => {
    const talentOnly = viewModelOnBank(0, { "hardware-inputs": ["talent"], "software-playback": [] });
    expect(talentOnly.hardwareInputs.channels).toHaveLength(4);
    expect(talentOnly.hardwareInputs.bankReadout).toBe("Bank 1 / 1 · ch 1-4 of 4");
  });
});
