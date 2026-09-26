import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StagePlotControls, type StagePlotControlsProps } from "./StagePlotControls";

// New pages program, Slice 3 (decision 10): Shift+click, a Shift+drag box and
// Shift+Enter added fixtures to the selection. Keys held while pointing went
// with the shortcuts, and the plot toolbar has an Add to selection key instead:
// a toggle that says whether it is lit. The view slots lost their key hints.

afterEach(() => {
  cleanup();
});

function renderControls(overrides: Partial<StagePlotControlsProps> = {}) {
  const props: StagePlotControlsProps = {
    zoom: 1,
    zoomMode: "fitRoom",
    renderMode: "rig",
    onZoomIn: () => {},
    onZoomOut: () => {},
    onReset: () => {},
    onFitRoom: () => {},
    onFillDesk: () => {},
    onActualSize: () => {},
    onFitContent: () => {},
    onRenderModeChange: () => {},
    viewBookmarks: [{ zoom: 2, panX: 0, panY: 0, zoomMode: "actual" }, null, null],
    onSaveViewBookmark: () => {},
    onRecallViewBookmark: () => {},
    onClearViewBookmark: () => {},
    ...overrides,
  };
  return render(<StagePlotControls {...props} />);
}

describe("StagePlotControls", () => {
  it("offers Add to selection as a toggle that says whether it is lit", () => {
    const onAddToSelectionChange = vi.fn();
    const view = renderControls({ addToSelection: false, onAddToSelectionChange });
    const toggle = screen.getByRole("button", { name: "Add to selection" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(onAddToSelectionChange).toHaveBeenCalledWith(true);

    view.rerender(
      <StagePlotControls
        zoom={1}
        zoomMode="fitRoom"
        renderMode="rig"
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
        onFitRoom={() => {}}
        onFillDesk={() => {}}
        onActualSize={() => {}}
        onFitContent={() => {}}
        onRenderModeChange={() => {}}
        addToSelection
        onAddToSelectionChange={onAddToSelectionChange}
      />
    );
    expect(screen.getByRole("button", { name: "Add to selection" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add to selection" }));
    expect(onAddToSelectionChange).toHaveBeenLastCalledWith(false);
  });

  it("names the view slots without a key", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "Recall view 1. Right-click for options." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Empty slot 2. Right-click to save the current view." })).toBeTruthy();
  });
});
