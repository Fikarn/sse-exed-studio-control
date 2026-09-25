import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, RequestMethod } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";

// New pages program, Slice 2 (D5): the Stream Deck's PROJECTS and TASKS pages left with
// Planning. The fixture double's deck mirrors the hardware link's page model
// (`build_control_surface_snapshot` in `native/rust-engine/src/exports.rs`, pinned there by
// `control_surface_snapshot_matches_the_deck_page_model`): LIGHTS is page 1 with seven keys
// (its first place held `<< PROJ`), AUDIO page 2 with eight keys and four touch-strip cells,
// and each page four dials that are pressed and turned either way — 43 controls in all.

type Control = { id: string; position: number; type: string; label: string };
type Page = { id: string; label: string; buttons: Control[]; dials: Control[] };

function openDouble() {
  const transport = createFixtureTransport(getFixtureScenario("setup-required"));
  const request = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;
  return { request };
}

describe("the fixture double's Stream Deck pages", () => {
  it("are LIGHTS and AUDIO, with the hardware link's controls", async () => {
    const { request } = openDouble();
    const pages = (await request("controlSurface.snapshot")).pages as unknown as Page[];

    expect(pages.map((page) => [page.id, page.label])).toEqual([
      ["lights", "LIGHTS"],
      ["audio", "AUDIO"],
    ]);
    const [lights, audio] = pages;
    expect(lights.buttons.map((control) => control.position)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(audio.buttons.map((control) => control.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const page of pages) {
      expect(page.dials).toHaveLength(12);
      expect(new Set(page.dials.map((control) => control.type))).toEqual(
        new Set(["dial-press", "dial-turn-left", "dial-turn-right"])
      );
      expect(page.buttons[0].id).toBe(`${page.id}-btn-${page.buttons[0].position}`);
    }
    const controls = pages.flatMap((page) => [...page.buttons, ...page.dials]);
    expect(controls).toHaveLength(43);
    expect(new Set(controls.map((control) => control.id)).size).toBe(43);
    expect(JSON.stringify(pages)).not.toMatch(/project|task/i);
  });

  it("are what the control-surface probe and the profile export count", async () => {
    const { request } = openDouble();

    const commissioning = await request("commissioning.check.run", { target: "control-surface" });
    const probe = (commissioning.checks as JsonObject[]).find((check) => check.id === "control-surface");
    expect(probe?.message).toBe("Control surface bridge exposes 43 mapped controls across 2 pages.");

    const exported = await request("exports.companion.export");
    expect(exported.pageCount).toBe(2);
  });
});
