import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, RequestMethod } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";

// D5: the Stream Deck's pages are LIGHTS, AUDIO, CAMERAS and PROMPTER. The fixture double's
// deck is the hardware link's page model (`build_control_surface_snapshot` in
// `native/rust-engine/src/exports/snapshot.rs`), read from `deckPages.json`, which the hardware
// link's test `the_doubles_deck_pages_are_the_page_model` holds equal to it; the model is
// pinned by `control_surface_snapshot_matches_the_deck_page_model` and
// `the_page_model_says_what_each_control_does`. The approved layout (2026-10-03): REC top left
// and PLAY under it on every page, the page key top right; LIGHTS (page 1), CAMERAS (page 3)
// and PROMPTER (page 4) have seven keys, a dark one being no control, AUDIO (page 2) eight; every
// page four cells of the touch strip that only show, and four dials that are pressed and turned
// either way — 93 controls in all. The hardware link pins the same sentence
// (`the_control_surface_probe_counts_the_decks_controls` in `commissioning.rs`).

type Control = {
  id: string;
  position: number;
  type: string;
  label: string;
  description: string;
  url?: string;
  body?: { action: string; value?: string };
  isPageNav?: boolean;
  pageNavTarget?: string;
};
type Page = { id: string; label: string; buttons: Control[]; dials: Control[] };

function openDouble() {
  const transport = createFixtureTransport(getFixtureScenario("setup-required"));
  const request = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;
  return { request };
}

describe("the fixture double's Stream Deck pages", () => {
  it("are LIGHTS, AUDIO, CAMERAS and PROMPTER, with the hardware link's controls", async () => {
    const { request } = openDouble();
    const pages = (await request("controlSurface.snapshot")).pages as unknown as Page[];

    expect(pages.map((page) => [page.id, page.label])).toEqual([
      ["lights", "LIGHTS"],
      ["audio", "AUDIO"],
      ["cameras", "CAMERAS"],
      ["prompter", "PROMPTER"],
    ]);
    const [lights, audio, cameras, prompter] = pages;
    expect(lights.buttons.map((control) => control.position)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    expect(audio.buttons.map((control) => control.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(cameras.buttons.map((control) => control.position)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(prompter.buttons.map((control) => control.position)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    for (const page of pages) {
      expect(page.dials).toHaveLength(12);
      expect(new Set(page.dials.map((control) => control.type))).toEqual(
        new Set(["dial-press", "dial-turn-left", "dial-turn-right"])
      );
      expect(page.buttons[0].id).toBe(`${page.id}-btn-${page.buttons[0].position}`);
    }
    const controls = pages.flatMap((page) => [...page.buttons, ...page.dials]);
    expect(controls).toHaveLength(93);
    expect(new Set(controls.map((control) => control.id)).size).toBe(93);
    expect(JSON.stringify(pages)).not.toMatch(/project|task/i);
  });

  it("carry the hardware link's own words, routes and page keys", async () => {
    const { request } = openDouble();
    const pages = (await request("controlSurface.snapshot")).pages as unknown as Page[];
    const words = (page: Page) => page.buttons.map((control) => control.label);

    expect(words(pages[0]).slice(0, 7)).toEqual(["REC", "ALL ON", "SAVE", "AUDIO \u203a", "PLAY", "ALL OFF", "RECALL"]);
    expect(words(pages[1]).slice(0, 8)).toEqual([
      "REC",
      "MAIN OUT",
      "PHONES",
      "CAMERAS \u203a",
      "PLAY",
      "BANK",
      "DIM",
      "SOLO",
    ]);
    expect(words(pages[2]).slice(0, 7)).toEqual(["REC", "BANK", "PROMPTER \u203a", "PLAY", "CAM 1", "CAM 2", "CAM 3"]);
    expect(words(pages[3]).slice(0, 7)).toEqual([
      "REC",
      "\u25c2 CUE",
      "CUE \u25b8",
      "LIGHTS \u203a",
      "PLAY",
      "BACK",
      "TOP",
    ]);

    // Each page posts to a route of its own, and REC and PLAY to the cameras' and the prompter's
    // on every page; a page key and a strip cell post nothing.
    const routes = ["light", "audio", "camera", "prompter"].map((page) => `/api/deck/${page}-action`);
    for (const [index, page] of pages.entries()) {
      const posted = [...page.buttons, ...page.dials].flatMap((control) => (control.url ? [control.url] : []));
      expect(new Set(posted), page.label).toEqual(new Set([routes[index], routes[2], routes[3]]));
      const at = (position: number) => page.buttons.find((control) => control.position === position);
      expect(at(1)).toMatchObject({ label: "REC", body: { action: "rec" } });
      expect(at(5)).toMatchObject({ label: "PLAY", body: { action: "playPause" } });
    }
    // The cells of the strip only show, on every page (2026-10-03: AUDIO's were tapped).
    expect(pages.map((page) => page.buttons.filter((control) => control.type === "display").length)).toEqual([
      4, 4, 4, 4,
    ]);
    // The page keys make a ring.
    expect(
      pages.map((page) => page.buttons.filter((control) => control.isPageNav).map((control) => control.pageNavTarget))
    ).toEqual([["AUDIO"], ["CAMERAS"], ["PROMPTER"], ["LIGHTS"]]);
    expect(pages[2].buttons[0]).toMatchObject({
      id: "cameras-btn-1",
      body: { action: "rec" },
      description: "Start recording on CAM 1. While it records: arm the stop, then stop.",
    });
  });

  it("are what the control-surface probe and the profile export count", async () => {
    const { request } = openDouble();

    const commissioning = await request("commissioning.check.run", { target: "control-surface" });
    const probe = (commissioning.checks as JsonObject[]).find((check) => check.id === "control-surface");
    expect(probe?.message).toBe(
      "Companion asked the deck's bridge 1 s ago. The deck's bridge serves 93 controls on 4 pages."
    );

    const exported = await request("exports.companion.export");
    expect(exported.pageCount).toBe(4);
  });
});
