import { describe, expect, it } from "vitest";

import { findEchoControlId, parseControlSurfaceLastEvent, type EchoPage } from "./setupControlEcho";

const pages: EchoPage[] = [
  {
    id: "projects",
    buttons: [{ id: "proj-btn-1", body: { action: "setFilter", value: "all" } }],
    dials: [],
  },
  {
    id: "audio",
    buttons: [
      { id: "audio-btn-1", body: { action: "setMixTarget", value: "main" } },
      { id: "audio-btn-9", body: { action: "stripTap", value: "1" } },
    ],
    dials: [
      { id: "audio-dial-1-press", body: { action: "dialPress", value: "1" } },
      { id: "audio-dial-1-right", body: { action: "dialTurn", value: "1:up" } },
      { id: "audio-dial-1-left", body: { action: "dialTurn", value: "1:down" } },
    ],
  },
];

describe("parseControlSurfaceLastEvent", () => {
  it("parses a stamped bridge event and rejects malformed candidates", () => {
    expect(
      parseControlSurfaceLastEvent({
        route: "/api/deck/audio-action",
        action: "dialTurn",
        value: "1:up",
        at: 123,
      })
    ).toEqual({ route: "/api/deck/audio-action", action: "dialTurn", value: "1:up", at: 123 });
    expect(parseControlSurfaceLastEvent(null)).toBeNull();
    expect(parseControlSurfaceLastEvent({ action: "x" })).toBeNull();
  });
});

describe("findEchoControlId", () => {
  it("matches the exact control for a dial turn direction", () => {
    const event = { route: "/api/deck/audio-action", action: "dialTurn", value: "1:up", at: 1 };
    expect(findEchoControlId(pages, event, "audio")).toBe("audio-dial-1-right");
  });

  it("matches valueless actions only against valueless bodies", () => {
    const withValueless: EchoPage[] = [
      {
        id: "audio",
        buttons: [
          { id: "audio-btn-4", body: { action: "cycleBank" } },
          { id: "audio-btn-x", body: { action: "cycleBank", value: "ignored" } },
        ],
        dials: [],
      },
    ];
    const event = { route: "/api/deck/audio-action", action: "cycleBank", value: null, at: 2 };
    expect(findEchoControlId(withValueless, event, null)).toBe("audio-btn-4");
  });

  it("prefers the selected page, then the route's home page", () => {
    const ambiguous: EchoPage[] = [
      { id: "projects", buttons: [{ id: "proj-a", body: { action: "setFilter", value: "all" } }], dials: [] },
      { id: "tasks", buttons: [{ id: "tasks-a", body: { action: "setFilter", value: "all" } }], dials: [] },
    ];
    const event = { route: "/api/deck/action", action: "setFilter", value: "all", at: 3 };
    expect(findEchoControlId(ambiguous, event, "tasks")).toBe("tasks-a");
    expect(findEchoControlId(ambiguous, event, null)).toBe("proj-a");
  });

  it("returns null when nothing matches", () => {
    const event = { route: "/api/deck/audio-action", action: "unknown", value: null, at: 4 };
    expect(findEchoControlId(pages, event, "audio")).toBeNull();
  });
});
