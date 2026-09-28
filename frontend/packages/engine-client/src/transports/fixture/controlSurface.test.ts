import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, RequestMethod } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";

// D5: the Stream Deck's pages are LIGHTS, AUDIO, CAMERAS and PROMPTER. The fixture double's
// deck is the hardware link's page model (`build_control_surface_snapshot` in
// `native/rust-engine/src/exports/snapshot.rs`), read from `deckPages.json`, which the hardware
// link's test `the_doubles_deck_pages_are_the_page_model` holds equal to it; the model is
// pinned by `control_surface_snapshot_matches_the_deck_page_model` and
// `the_page_model_says_what_the_new_pages_controls_do`. LIGHTS is page 1 with seven keys (its
// first place held `<< PROJ`), AUDIO page 2 with eight keys and four touch-strip cells (its
// seventh place, which held `TALK`, is the ring's page key), CAMERAS page 3 and PROMPTER page 4
// with six keys and four strip cells each, and every page four dials that are pressed and
// turned either way — 87 controls in all. The hardware link pins the same sentence
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
    expect(lights.buttons.map((control) => control.position)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(audio.buttons.map((control) => control.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(cameras.buttons.map((control) => control.position)).toEqual([1, 2, 3, 4, 5, 8, 9, 10, 11, 12]);
    expect(prompter.buttons.map((control) => control.position)).toEqual([1, 2, 3, 5, 6, 8, 9, 10, 11, 12]);
    for (const page of pages) {
      expect(page.dials).toHaveLength(12);
      expect(new Set(page.dials.map((control) => control.type))).toEqual(
        new Set(["dial-press", "dial-turn-left", "dial-turn-right"])
      );
      expect(page.buttons[0].id).toBe(`${page.id}-btn-${page.buttons[0].position}`);
    }
    const controls = pages.flatMap((page) => [...page.buttons, ...page.dials]);
    expect(controls).toHaveLength(87);
    expect(new Set(controls.map((control) => control.id)).size).toBe(87);
    expect(JSON.stringify(pages)).not.toMatch(/project|task/i);
  });

  it("carry the hardware link's own words, routes and page keys", async () => {
    const { request } = openDouble();
    const pages = (await request("controlSurface.snapshot")).pages as unknown as Page[];
    const words = (page: Page) => page.buttons.map((control) => control.label);

    expect(words(pages[0])).toEqual(["Toggle", "All On", "All Off", "Save", "Recall", "Del Scene", "AUDIO >>"]);
    expect(words(pages[1]).slice(0, 8)).toEqual(["MAIN", "PH 1", "PH 2", "BANK", "DIM", "GAIN", "CAMS >>", "SOLO CLR"]);
    expect(words(pages[2]).slice(0, 6)).toEqual(["CAM 1", "CAM 2", "CAM 3", "BANK", "REC", "PROMPTER >>"]);
    expect(words(pages[3]).slice(0, 6)).toEqual(["PLAY", "BACK", "TOP", "CUE <", "CUE >", "LIGHTS >>"]);

    // Each page posts to a route of its own; a page key and a strip cell post nothing.
    const routes = ["light", "audio", "camera", "prompter"].map((page) => `/api/deck/${page}-action`);
    for (const [index, page] of pages.entries()) {
      const posted = [...page.buttons, ...page.dials].flatMap((control) => (control.url ? [control.url] : []));
      expect(new Set(posted), page.label).toEqual(new Set([routes[index]]));
    }
    // A cell of the strip that only shows is a display; AUDIO's cells are tapped.
    expect(pages.map((page) => page.buttons.filter((control) => control.type === "display").length)).toEqual([
      0, 0, 4, 4,
    ]);
    // The page keys make a ring.
    expect(
      pages.map((page) => page.buttons.filter((control) => control.isPageNav).map((control) => control.pageNavTarget))
    ).toEqual([["AUDIO"], ["CAMERAS"], ["PROMPTER"], ["LIGHTS"]]);
    expect(pages[2].buttons[4]).toMatchObject({
      id: "cameras-btn-5",
      body: { action: "rec" },
      description: "Start recording on CAM 1. While it records: arm the stop, then stop.",
    });
  });

  it("are what the control-surface probe and the profile export count", async () => {
    const { request } = openDouble();

    const commissioning = await request("commissioning.check.run", { target: "control-surface" });
    const probe = (commissioning.checks as JsonObject[]).find((check) => check.id === "control-surface");
    expect(probe?.message).toBe("Control surface bridge exposes 87 mapped controls across 4 pages.");

    const exported = await request("exports.companion.export");
    expect(exported.pageCount).toBe(4);
  });
});
