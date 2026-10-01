import { describe, expect, it } from "vitest";

import { SnapshotShapeError, snapshotProblem } from "./snapshotGuards";

// 2026-09 production readiness, Slice 9 (finding F32): the guards look at the
// top of each shape — the lists a workspace maps over, the ids it keys by —
// and at nothing deeper.
describe("snapshotProblem", () => {
  it("accepts an absent typed snapshot and refuses an absent loose one", () => {
    for (const domain of ["lighting", "lightingFixtureCatalog", "lightingDmxMonitor", "audio"] as const) {
      expect(snapshotProblem(domain, null), domain).toBeNull();
    }
    for (const domain of ["health", "app", "commissioning", "support", "controlSurface"] as const) {
      expect(snapshotProblem(domain, null), domain).toBe("the reply is empty");
      expect(snapshotProblem(domain, {}), domain).toBeNull();
    }
  });

  it("refuses a reply that is not an object", () => {
    expect(snapshotProblem("lighting", [])).toBe("the reply is not an object");
    expect(snapshotProblem("app", "ok")).toBe("the reply is not an object");
  });

  it("names the list that is missing and the row that has no id", () => {
    expect(snapshotProblem("lighting", { fixtures: [], groups: [] })).toBe("scenes is not a list");
    expect(snapshotProblem("lighting", { fixtures: [], groups: [], scenes: [], palettes: {} })).toBe(
      "palettes is not a list"
    );
    expect(snapshotProblem("audio", { channels: [{ id: "audio-input-1" }, { id: "" }], mixTargets: [] })).toBe(
      "channels[1] has no id"
    );
    expect(snapshotProblem("lighting", { fixtures: [], groups: [null], scenes: [] })).toBe("groups[0] has no id");
    expect(snapshotProblem("lightingFixtureCatalog", { definitions: [{ id: "astra" }] })).toBeNull();
    // DMX channels are numbered, not keyed.
    expect(snapshotProblem("lightingDmxMonitor", { channels: [{ channel: 1, value: 0 }] })).toBeNull();
    expect(snapshotProblem("lightingDmxMonitor", {})).toBe("channels is not a list");
  });

  it("checks the cameras' lists and the dials, and takes a Recent list that could not be read", () => {
    const dials = { bank: "exposure", sets: ["iso", "shutter", "iris", "nd"] };
    expect(snapshotProblem("cameras", { selected: 1, dials, cameras: [], recent: [] })).toBeNull();
    expect(snapshotProblem("cameras", { selected: 1, dials, cameras: [], recent: null })).toBeNull();
    expect(snapshotProblem("cameras", { selected: 1, dials, recent: [] })).toBe("cameras is not a list");
    expect(snapshotProblem("cameras", { selected: 1, dials, cameras: [] })).toBe("recent is not a list");
    expect(snapshotProblem("cameras", { selected: 1, dials, cameras: [], recent: "none" })).toBe(
      "recent is not a list"
    );
    // The dials the page's bank keys read (the deck's CAMERAS page).
    expect(snapshotProblem("cameras", { selected: 1, cameras: [], recent: [] })).toBe("dials is not an object");
    expect(snapshotProblem("cameras", { selected: 1, dials: { bank: "focus" }, cameras: [], recent: [] })).toBe(
      "sets is not a list"
    );
    expect(snapshotProblem("cameras", null)).toBeNull();
  });

  it("checks the Teleprompter's objects the page reads, not only its lists (new pages S6a)", () => {
    const prompter = { scripts: [], removed: [], look: {}, screen: {}, glass: null };
    expect(snapshotProblem("prompter", prompter)).toBeNull();
    expect(snapshotProblem("prompter", { ...prompter, glass: { cues: [] } })).toBeNull();
    expect(snapshotProblem("prompter", { ...prompter, look: null })).toBe("look is not an object");
    expect(snapshotProblem("prompter", { scripts: [], removed: [], look: {}, glass: null })).toBe(
      "screen is not an object"
    );
    expect(snapshotProblem("prompter", { ...prompter, glass: "on" })).toBe("glass is not an object");
    expect(snapshotProblem("prompter", { ...prompter, glass: {} })).toBe("cues is not a list");
    expect(snapshotProblem("prompterGlass", { paragraphs: [], look: {} })).toBeNull();
    expect(snapshotProblem("prompterGlass", { paragraphs: [] })).toBe("look is not an object");
  });

  it("checks TotalMix's snapshot slots the Console maps over (2026-10-01)", () => {
    const consoleSnapshots = {
      slots: [{ slot: 1, name: "Mix 1", state: "active" }],
      namesSavedAt: null,
      namesNote: null,
    };
    expect(snapshotProblem("audio", { channels: [], mixTargets: [], consoleSnapshots })).toBeNull();
    expect(snapshotProblem("audio", { channels: [], mixTargets: [] })).toBe("consoleSnapshots is not an object");
    expect(snapshotProblem("audio", { channels: [], mixTargets: [], consoleSnapshots: {} })).toBe(
      "slots is not a list"
    );
  });

  it("leaves optional lists optional", () => {
    expect(snapshotProblem("lighting", { fixtures: [], groups: [], scenes: [] })).toBeNull();
  });
});

describe("SnapshotShapeError", () => {
  it("names the request and the field", () => {
    const error = new SnapshotShapeError("lighting", "fixtures is not a list");
    expect(error.message).toBe("lighting.snapshot: fixtures is not a list");
    expect(error.domain).toBe("lighting");
    expect(error).toBeInstanceOf(Error);
  });
});
