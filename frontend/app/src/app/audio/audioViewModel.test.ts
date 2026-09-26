import { beforeAll, describe, expect, it } from "vitest";

import { createFixtureTransport, type AudioSnapshot } from "@sse/engine-client";
import { getFixtureScenario } from "@sse/test-fixtures";

import {
  audioBankSizes,
  buildAudioViewModel,
  toggleChannelGroupSelection,
  type AudioChannelGroup,
  type AudioChannelGroupSelections,
  type AudioTierViewModel,
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

  it("lights a second chip beside the first", () => {
    const fx = toggleChannelGroupSelection(none, { group: "fx", tierId: "software-playback" });
    expect(fx["software-playback"]).toEqual(["fx"]);
    const both = toggleChannelGroupSelection(fx, { group: "bed", tierId: "software-playback" });
    expect(both["software-playback"]).toEqual(["bed", "fx"]);
  });

  it("turns a lit chip off with a second click, and none lit means every strip shows", () => {
    const both: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": ["bed", "fx"] };
    const bedOnly = toggleChannelGroupSelection(both, { group: "fx", tierId: "software-playback" });
    expect(bedOnly["software-playback"]).toEqual(["bed"]);
    const cleared = toggleChannelGroupSelection(bedOnly, { group: "bed", tierId: "software-playback" });
    expect(cleared["software-playback"]).toEqual([]);
  });

  // New pages program, Slice 3, on review. Old: "keeps only the chips the bank
  // offers and leaves the other row alone": the click was handed the current
  // bank's chips and kept only those, so the lit Remote went out when FX was
  // lit. New: only the clicked chip changes, and the lit chips keep the fixed
  // group order. Reason: at 2560 an Inputs bank holds one group, so with Talent
  // and Line lit, a click on Talent on bank 1 also switched off Line, whose
  // strips are on banks 2 and 3 (decision 10: a click switches that one chip).
  it("keeps the row's other lit chips, whichever bank their strips are on, and leaves the other row alone", () => {
    const current: AudioChannelGroupSelections = {
      "hardware-inputs": ["talent", "line"],
      "software-playback": ["remote"],
    };
    const lineOnly = toggleChannelGroupSelection(current, { group: "talent", tierId: "hardware-inputs" });
    expect(lineOnly["hardware-inputs"]).toEqual(["line"]);
    expect(lineOnly["software-playback"]).toEqual(["remote"]);
    const talentAgain = toggleChannelGroupSelection(lineOnly, { group: "talent", tierId: "hardware-inputs" });
    expect(talentAgain["hardware-inputs"]).toEqual(["talent", "line"]);
    const fxToo = toggleChannelGroupSelection(current, { group: "fx", tierId: "software-playback" });
    expect(fxToo["software-playback"]).toEqual(["fx", "remote"]);
    expect(fxToo["hardware-inputs"]).toEqual(["talent", "line"]);
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

// New pages program, Slice 3 (decision 10), on review. At 2560 an Inputs bank
// holds 4 strips, so on the fixture desk bank 1 is Talent (Host, Co-host, Guest
// 1, Guest 2), bank 2 is Line 1, Line 2, Remote A and Remote B, and bank 3 is
// Line 5-8. With Talent and Line both lit, the heading on bank 1 drew no Line
// chip and a click on Talent there switched Line off too; on bank 2 the same
// held for Talent. `click` is what the Console does with a click on a chip:
// it switches that chip, and the rows go back to bank 1.
describe("the Inputs chips across banks", () => {
  let audioSnapshot: AudioSnapshot;
  beforeAll(async () => {
    const transport = createFixtureTransport(getFixtureScenario("audio-populated"));
    audioSnapshot = (await transport.request("audio.snapshot")) as unknown as AudioSnapshot;
    await transport.dispose?.();
  });
  const none: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": [] };
  const inputsOnBank = (activeChannelGroups: AudioChannelGroupSelections, bankIndex: number) =>
    buildAudioViewModel({ activeChannelGroups, appSnapshot: null, audioSnapshot, bankIndex, density: "desktop" })
      .hardwareInputs;
  // The heading's chips in order; a lit one carries a star.
  const chipsOf = (tier: AudioTierViewModel) => tier.chips.map((chip) => (chip.active ? `${chip.id}*` : chip.id));
  const click = (current: AudioChannelGroupSelections, group: AudioChannelGroup) =>
    toggleChannelGroupSelection(current, { group, tierId: "hardware-inputs" });

  it("draws the lit Line chip on bank 1, where a click on Talent leaves Line lit", () => {
    // Bank 2 has Line and Remote strips; Remote has no chip until it is lit.
    expect(chipsOf(inputsOnBank(none, 1))).toEqual(["line"]);
    const line = click(none, "line");
    expect(chipsOf(inputsOnBank(line, 0))).toEqual(["talent", "line*"]);
    expect(inputsOnBank(line, 0).bankReadout).toBe("Bank 1 / 2 · ch 1-4 of 6");

    // Talent lights beside Line. Bank 1 holds no Line strip, and the lit Line
    // chip stays in its heading.
    const both = click(line, "talent");
    expect(both["hardware-inputs"]).toEqual(["talent", "line"]);
    expect(chipsOf(inputsOnBank(both, 0))).toEqual(["talent*", "line*"]);
    expect(inputsOnBank(both, 0).bankReadout).toBe("Bank 1 / 3 · ch 1-4 of 10");

    // A second click on Talent turns Talent off, and Line stays lit.
    const lineAgain = click(both, "talent");
    expect(lineAgain["hardware-inputs"]).toEqual(["line"]);
    expect(chipsOf(inputsOnBank(lineAgain, 0))).toEqual(["talent", "line*"]);
    expect(inputsOnBank(lineAgain, 0).bankReadout).toBe("Bank 1 / 2 · ch 1-4 of 6");
  });

  it("draws the lit Talent chip on bank 2, where a click on Line leaves Talent lit", () => {
    const both: AudioChannelGroupSelections = { "hardware-inputs": ["talent", "line"], "software-playback": [] };
    // Bank 2 of the ten lit strips is Line 1, Line 2, Line 5 and Line 6.
    expect(inputsOnBank(both, 1).bankReadout).toBe("Bank 2 / 3 · ch 5-8 of 10");
    expect(chipsOf(inputsOnBank(both, 1))).toEqual(["talent*", "line*"]);
    const talent = click(both, "line");
    expect(talent["hardware-inputs"]).toEqual(["talent"]);
    expect(inputsOnBank(talent, 0).bankReadout).toBe("Bank 1 / 1 · ch 1-4 of 4");
  });
});
