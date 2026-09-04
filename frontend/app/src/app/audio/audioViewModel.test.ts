import { describe, expect, it } from "vitest";

import { audioBankSizes } from "./audioViewModel";

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
