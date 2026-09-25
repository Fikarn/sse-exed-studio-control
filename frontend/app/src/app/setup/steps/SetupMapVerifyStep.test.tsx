import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { deckKeySlots, type ControlSurfaceControl, type ControlSurfacePage } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";
import { SetupMapVerifyStep } from "./SetupMapVerifyStep";

// New pages program, Slice 2 (review): the Setup map draws each Stream Deck
// key where the deck has it. LIGHTS starts at place 2 — place 1 held
// `<< PROJ` until Planning left the deck — and drawing its keys one after
// another put every one of them a place early, "AUDIO >>" included.

function key(pageId: string, position: number, label: string): ControlSurfaceControl {
  return {
    body: null,
    description: `${label} is mapped.`,
    id: `${pageId}-btn-${position}`,
    label,
    position,
    type: "button",
  };
}

// The LIGHTS page as the hardware link's profile lays it out.
const lights: ControlSurfacePage = {
  buttons: [
    key("lights", 2, "Toggle"),
    key("lights", 3, "All On"),
    key("lights", 4, "All Off"),
    key("lights", 5, "Save"),
    key("lights", 6, "Recall"),
    key("lights", 7, "Del Scene"),
    key("lights", 8, "AUDIO >>"),
  ],
  dials: [],
  id: "lights",
  label: "LIGHTS",
};

function renderMap(page: ControlSurfacePage) {
  const editor = {
    chrome: { backKey: null, bayHead: null, primaryKey: null },
    props: { liveTransportRequested: false },
    state: {
      activeStepId: "map",
      echoControlId: null,
      pages: [page],
      selectedControl: page.buttons[0] ?? null,
      selectedPage: page,
      setSelectedControlId: () => {},
      setSelectedPageId: () => {},
      totalControlCount: page.buttons.length + page.dials.length,
    },
  } as unknown as SetupPilot;
  render(<SetupMapVerifyStep editor={editor} />);
  return [...screen.getByTestId("setup-deck-keys").children] as HTMLElement[];
}

afterEach(() => {
  cleanup();
});

describe("SetupMapVerifyStep's deck keys", () => {
  it("draws LIGHTS with its first key blank and AUDIO >> at row 2, column 4", () => {
    const cells = renderMap(lights);

    expect(cells).toHaveLength(8);
    expect(cells[0].hasAttribute("data-blank-key")).toBe(true);
    expect(cells[0].getAttribute("aria-hidden")).toBe("true");
    expect(cells[0].textContent).toBe("");
    // Place p is row ceil(p / 4), column ((p - 1) % 4) + 1 on a four-key row.
    expect(within(cells[1]).getByText("Toggle").tagName).toBe("SPAN");
    expect(within(cells[3]).getByText("All Off").tagName).toBe("SPAN");
    expect(within(cells[4]).getByText("Save").tagName).toBe("SPAN");
    expect(within(cells[7]).getByText("AUDIO >>").tagName).toBe("SPAN");
    expect(screen.getAllByRole("button", { name: /button$/ })).toHaveLength(7);
  });

  it("draws a page that fills every place without a blank", () => {
    const audio: ControlSurfacePage = {
      buttons: Array.from({ length: 12 }, (_, index) => key("audio", index + 1, `Channel ${index + 1}`)),
      dials: [],
      id: "audio",
      label: "AUDIO",
    };
    const cells = renderMap(audio);

    expect(cells).toHaveLength(12);
    expect(cells.filter((cell) => cell.hasAttribute("data-blank-key"))).toHaveLength(0);
    expect(within(cells[11]).getByText("Channel 12").tagName).toBe("SPAN");
  });
});

describe("deckKeySlots", () => {
  it("fills whole rows, with a blank wherever the page has no key", () => {
    const slots = deckKeySlots([key("p", 3, "Three"), key("p", 6, "Six")]);

    expect(slots.map((slot) => slot?.label ?? null)).toEqual([null, null, "Three", null, null, "Six", null, null]);
  });

  it("draws keys one after another when their places are missing or repeated", () => {
    const unplaced = [key("p", 0, "Zero"), key("p", 2, "Two")];
    const repeated = [key("p", 2, "First"), key("p", 2, "Second")];

    expect(deckKeySlots(unplaced)).toEqual(unplaced);
    expect(deckKeySlots(repeated)).toEqual(repeated);
    expect(deckKeySlots([])).toEqual([]);
  });
});
