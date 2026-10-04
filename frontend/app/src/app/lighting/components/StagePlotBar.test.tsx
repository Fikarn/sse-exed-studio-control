import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { StagePlotBar, type StagePlotBarProps } from "./StagePlotBar";

// The bar under the plot (the visual overhaul's Lighting page, 2026-10-04):
// Highlight, Solo and Find live here, take-time keys in one place that never
// moves. Find reads Stop while it runs; a lit Highlight or Solo can always be
// switched off, in Preview too; unlit, they wait for a selection, saying why.

afterEach(() => {
  cleanup();
});

const KEY = { id: "fixture-key", name: "Key", on: true, intensity: 76, cct: 3200 } as LightingFixtureSnapshot;

function renderBar(overrides: Partial<StagePlotBarProps> = {}) {
  const handlers = {
    onToggleHighlight: vi.fn(),
    onToggleSolo: vi.fn(),
    onIdentifyFind: vi.fn(),
    onStopFind: vi.fn(),
    onAddToSelectionChange: vi.fn(),
    onRecallView: vi.fn(),
  };
  const props: StagePlotBarProps = {
    selectedFixtures: [KEY],
    onRemoveFromSelection: () => {},
    onClearSelection: () => {},
    addToSelection: false,
    previewMode: false,
    highlightActive: false,
    soloActive: false,
    findRunning: false,
    zoom: 1,
    onZoomIn: () => {},
    onZoomOut: () => {},
    viewBookmarks: [{ zoom: 1, panX: 0, panY: 0, zoomMode: "fitRoom" }, null, null],
    plotMenu: { head: { title: "Stage plot" }, items: [] },
    arm: undefined,
    ...handlers,
    ...overrides,
  };
  render(<StagePlotBar {...props} />);
  return handlers;
}

describe("StagePlotBar", () => {
  it("the Find key reads Stop while a Find runs, and stops it, with or without a selection", () => {
    const idle = renderBar();
    const find = screen.getByTestId("lighting-identify-find");
    expect(find.textContent).toBe("Find");
    expect(find.hasAttribute("data-take")).toBe(true);
    fireEvent.click(find);
    expect(idle.onIdentifyFind).toHaveBeenCalledTimes(1);
    cleanup();

    const running = renderBar({ findRunning: true, selectedFixtures: [] });
    const stop = screen.getByTestId("lighting-identify-find");
    expect(stop.textContent).toBe("Stop");
    expect(stop.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(stop);
    expect(running.onStopFind).toHaveBeenCalledTimes(1);
    expect(running.onIdentifyFind).not.toHaveBeenCalled();
  });

  it("a lit Highlight or Solo key can be pressed in Preview, with or without a selection; unlit, both wait", () => {
    for (const selectedFixtures of [[KEY], []]) {
      const lit = renderBar({ previewMode: true, highlightActive: true, soloActive: true, selectedFixtures });
      for (const testId of ["lighting-highlight-toggle", "lighting-solo-toggle"]) {
        const key = screen.getByTestId(testId);
        expect(key.getAttribute("aria-pressed")).toBe("true");
        expect(key.getAttribute("aria-disabled")).toBeNull();
        fireEvent.click(key);
      }
      expect(lit.onToggleHighlight).toHaveBeenCalledTimes(1);
      expect(lit.onToggleSolo).toHaveBeenCalledTimes(1);
      cleanup();
    }

    const unlit = renderBar({ previewMode: true });
    for (const testId of ["lighting-highlight-toggle", "lighting-solo-toggle"]) {
      const key = screen.getByTestId(testId);
      expect(key.getAttribute("aria-disabled")).toBe("true");
      expect(key.getAttribute("title")).toMatch(/Leave preview/);
      fireEvent.click(key);
    }
    expect(unlit.onToggleHighlight).not.toHaveBeenCalled();
    expect(unlit.onToggleSolo).not.toHaveBeenCalled();
  });

  it("Add to selection is a toggle, and a saved view recalls at a press; an empty one says so", () => {
    const handlers = renderBar();
    const add = screen.getByTestId("lighting-add-to-selection");
    expect(add.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(add);
    expect(handlers.onAddToSelectionChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Recall view 1" }));
    expect(handlers.onRecallView).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "View 2 is empty" }));
    expect(handlers.onRecallView).toHaveBeenCalledTimes(1);
  });
});
