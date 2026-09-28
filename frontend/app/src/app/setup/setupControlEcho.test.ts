import { describe, expect, it } from "vitest";

import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import type { SnapshotRecord } from "../shellData";
import { findEcho, findEchoControlId, parseControlSurfaceLastEvent, type EchoPage } from "./setupControlEcho";
import { parseControlSurfacePages } from "./setupPilotModel";

// D5: the deck's pages are LIGHTS, AUDIO, CAMERAS and PROMPTER, and each posts to a route of
// its own. The pages here are cut from the page model; the last group reads the model itself.
const LIGHTS = "/api/deck/light-action";
const AUDIO = "/api/deck/audio-action";
const CAMERAS = "/api/deck/camera-action";

const pages: EchoPage[] = [
  {
    id: "lights",
    buttons: [{ id: "lights-btn-2", url: LIGHTS, body: { action: "toggleLight" } }],
    dials: [],
  },
  {
    id: "audio",
    buttons: [
      { id: "audio-btn-1", url: AUDIO, body: { action: "setMixTarget", value: "main" } },
      { id: "audio-btn-9", url: AUDIO, body: { action: "stripTap", value: "1" } },
    ],
    dials: [
      { id: "audio-dial-1-press", url: AUDIO, body: { action: "dialPress", value: "1" } },
      { id: "audio-dial-1-right", url: AUDIO, body: { action: "dialTurn", value: "1:up" } },
      { id: "audio-dial-1-left", url: AUDIO, body: { action: "dialTurn", value: "1:down" } },
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
    const event = { route: AUDIO, action: "dialTurn", value: "1:up", at: 1 };
    expect(findEchoControlId(pages, event, "audio")).toBe("audio-dial-1-right");
  });

  it("matches valueless actions only against valueless bodies", () => {
    const withValueless: EchoPage[] = [
      {
        id: "audio",
        buttons: [
          { id: "audio-btn-4", url: AUDIO, body: { action: "cycleBank" } },
          { id: "audio-btn-x", url: AUDIO, body: { action: "cycleBank", value: "ignored" } },
        ],
        dials: [],
      },
    ];
    const event = { route: AUDIO, action: "cycleBank", value: null, at: 2 };
    expect(findEchoControlId(withValueless, event, null)).toBe("audio-btn-4");
  });

  it("takes a press for the control of its own route, whatever page is shown", () => {
    // Two pages with a key that sends the same, each to its own route.
    const twoBanks: EchoPage[] = [
      { id: "audio", buttons: [{ id: "audio-bank", url: AUDIO, body: { action: "bank" } }], dials: [] },
      { id: "cameras", buttons: [{ id: "cameras-bank", url: CAMERAS, body: { action: "bank" } }], dials: [] },
    ];
    const event = { route: CAMERAS, action: "bank", value: null, at: 3 };
    expect(findEcho(twoBanks, event, "audio")).toEqual({ controlId: "cameras-bank", pageId: "cameras" });
    expect(findEcho(twoBanks, event, null)).toEqual({ controlId: "cameras-bank", pageId: "cameras" });
    expect(findEcho(twoBanks, { ...event, route: AUDIO }, "cameras")).toEqual({
      controlId: "audio-bank",
      pageId: "audio",
    });
  });

  it("reads a route with an address before it as the route", () => {
    const addressed: EchoPage[] = [
      {
        id: "cameras",
        buttons: [{ id: "cameras-bank", url: `http://127.0.0.1:38201${CAMERAS}`, body: { action: "bank" } }],
        dials: [],
      },
    ];
    expect(findEchoControlId(addressed, { route: CAMERAS, action: "bank", value: null, at: 4 }, null)).toBe(
      "cameras-bank"
    );
    expect(findEchoControlId(addressed, { route: AUDIO, action: "bank", value: null, at: 4 }, null)).toBeNull();
  });

  it("matches by what is sent alone where a control or a press does not say its route", () => {
    const bare: EchoPage[] = [
      { id: "audio", buttons: [{ id: "audio-a", body: { action: "toggleLight" } }], dials: [] },
      { id: "lights", buttons: [{ id: "lights-a", body: { action: "toggleLight" } }], dials: [] },
    ];
    const event = { route: LIGHTS, action: "toggleLight", value: null, at: 5 };
    // The page Setup shows first, then the first page that has the control.
    expect(findEchoControlId(bare, event, "lights")).toBe("lights-a");
    expect(findEchoControlId(bare, event, null)).toBe("audio-a");
    expect(findEchoControlId(pages, { ...event, route: "" }, null)).toBe("lights-btn-2");
  });

  it("returns null when nothing matches", () => {
    const event = { route: AUDIO, action: "unknown", value: null, at: 6 };
    expect(findEchoControlId(pages, event, "audio")).toBeNull();
    expect(findEcho(pages, null, "audio")).toBeNull();
  });
});

describe("a press of every control of the deck's page model", () => {
  it("is found on the page it is on, from any page Setup shows", async () => {
    const double = createFixtureTransport(getFixtureScenario("setup-ready"));
    const model = parseControlSurfacePages((await double.request("controlSurface.snapshot")) as SnapshotRecord);
    expect(model.map((page) => page.id)).toEqual(["lights", "audio", "cameras", "prompter"]);

    // Where two controls of a page send the same, the press is the first's: a key before a dial.
    const first = new Map<string, { controlId: string; pageId: string }>();
    let sending = 0;
    for (const page of model) {
      for (const control of [...page.buttons, ...page.dials]) {
        if (!control.body?.action || !control.url) continue;
        sending += 1;
        const sent = `${control.url} ${control.body.action} ${control.body.value ?? ""}`;
        if (!first.has(sent)) first.set(sent, { controlId: control.id, pageId: page.id });
        const event = {
          route: control.url,
          action: control.body.action,
          value: control.body.value ?? null,
          at: 1,
        };
        for (const shown of [...model.map((entry) => entry.id), null]) {
          expect(findEcho(model, event, shown), `${control.id} while ${shown ?? "no page"} is shown`).toEqual(
            first.get(sent)
          );
        }
      }
    }
    // 87 controls: four page keys, eight strip cells and two dials' pushes send nothing.
    expect(sending).toBe(73);
    // `Toggle` and the light dial's push, `Recall` and the scene dial's push, `PLAY` and the speed dial's push.
    expect(sending - first.size).toBe(3);
  });
});
