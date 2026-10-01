import { describe, expect, it } from "vitest";

import { parseAudioLoadReport } from "./audioLoadReport";

// 2026-10-01: a TotalMix snapshot load reports what the read-back brought, or,
// when the read-back failed after the load went out, the hardware link's own
// sentence (`audio.snapshot.load` in `native/protocol/v1.md`).
describe("parseAudioLoadReport", () => {
  it("names the slot and counts what the read-back brought", () => {
    expect(
      parseAudioLoadReport({
        loaded: true,
        slot: 2,
        name: "Interview",
        loadedAt: "2026-10-01T09:00:00Z",
        summary: "Pulled 120 values from TotalMix.",
        consoleStateConfidence: "aligned",
        pulledValues: 120,
        totalMixReported: true,
      })
    ).toEqual({ slot: 2, name: "Interview", readBack: true, line: "120 values read back from the desk." });
  });

  it("names a slot TotalMix saved no name for by its number", () => {
    expect(
      parseAudioLoadReport({ loaded: true, slot: 6, name: null, consoleStateConfidence: "aligned" })
    ).toMatchObject({ name: "Slot 6", line: "0 values read back from the desk." });
  });

  it("prints the hardware link's sentence when the simulated console read nothing back", () => {
    const summary = "Loaded Interview on the simulated console; nothing was sent (test mode).";
    expect(
      parseAudioLoadReport({
        loaded: true,
        slot: 2,
        name: "Interview",
        consoleStateConfidence: "aligned",
        pulledValues: 0,
        summary,
      })
    ).toMatchObject({ readBack: true, line: summary });
  });

  it("prints the hardware link's sentence when the load went out and the read-back failed", () => {
    const summary = "TotalMix did not answer the read-back. Press Sync from TotalMix to read the desk.";
    expect(
      parseAudioLoadReport({
        loaded: true,
        slot: 1,
        name: "Mix 1",
        summary,
        consoleStateConfidence: "unknown",
        pulledValues: 0,
      })
    ).toEqual({ slot: 1, name: "Mix 1", readBack: false, line: summary });
  });

  it("makes no report of a reply that is not a load", () => {
    expect(parseAudioLoadReport(null)).toBeNull();
    expect(parseAudioLoadReport({ synced: true })).toBeNull();
    expect(parseAudioLoadReport({ loaded: true })).toBeNull();
  });
});
