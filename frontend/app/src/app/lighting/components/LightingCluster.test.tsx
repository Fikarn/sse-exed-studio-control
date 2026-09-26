import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LightingCluster, type LightingClusterProps } from "./LightingCluster";

// New pages program, Slice 3. Two keys took over what keyboard shortcuts did:
// - decision 6: the page-wide Esc stopped a running Find, and nothing on screen
//   did. While a Find runs, the Find key reads "Stop" and pressing it stops it.
// - decision 5: Ctrl+Z undid the newest of the last 25 steps, and only a step's
//   own message offered an Undo, for 3.5 s. The Rig section has an Undo key
//   whose small print names the step it will undo; with nothing to undo it
//   cannot be pressed.

afterEach(() => {
  cleanup();
});

function renderCluster(overrides: Partial<LightingClusterProps> = {}) {
  const handlers = {
    onIdentifyFind: vi.fn(),
    onStopFind: vi.fn(),
    onUndo: vi.fn(),
  };
  const props: LightingClusterProps = {
    bridgeIp: "192.168.1.80",
    bridgeReachable: true,
    bridgeUniverse: 1,
    channelCount: 12,
    fixtureOnCount: 3,
    fixtureTotal: 4,
    grandMaster: 100,
    groups: [],
    lastRecalledLabel: null,
    previewDirty: false,
    previewMode: false,
    patchMode: false,
    recallFadeMs: 0,
    sceneModified: false,
    sceneName: "Warm wash",
    scenes: [],
    sceneRailProps: { activeSceneId: null, modifiedSceneId: null, sceneThumbs: {}, onRecall: () => {} },
    groupRailProps: { onTogglePower: () => {} },
    onAddFixture: () => {},
    onDiscardPreview: () => {},
    onEmergencyCut: () => {},
    onGrandMasterChange: () => {},
    hasSelection: true,
    highlightActive: false,
    soloActive: false,
    recentScenes: [],
    searchQuery: "",
    onSearchChange: () => {},
    onToggleHighlight: () => {},
    onToggleSolo: () => {},
    onOpenDmxMonitor: () => {},
    onRecallFadeMsChange: () => {},
    onResaveScene: () => {},
    onOpenSetup: () => {},
    onSaveScene: () => {},
    onToggleAllPower: () => {},
    onTogglePatch: () => {},
    onTogglePreview: () => {},
    ...handlers,
    ...overrides,
  };
  render(<LightingCluster {...props} />);
  return handlers;
}

describe("LightingCluster", () => {
  it("the Find key reads Stop while a Find runs, and stops it", () => {
    const idle = renderCluster({ findRunning: false });
    const find = screen.getByTestId("lighting-identify-find");
    expect(find.textContent).toBe("Find");
    fireEvent.click(find);
    expect(idle.onIdentifyFind).toHaveBeenCalledTimes(1);
    expect(idle.onStopFind).not.toHaveBeenCalled();
    cleanup();

    // Running, and still pressable after the selection was cleared mid-run.
    const running = renderCluster({ findRunning: true, hasSelection: false });
    const stop = screen.getByTestId("lighting-identify-find");
    expect(stop.textContent).toBe("Stop");
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stop);
    expect(running.onStopFind).toHaveBeenCalledTimes(1);
    expect(running.onIdentifyFind).not.toHaveBeenCalled();
  });

  it("the Undo key names the step it will undo, and cannot be pressed with nothing to undo", () => {
    const nothing = renderCluster({ undoLabel: null });
    const empty = screen.getByTestId("lighting-undo") as HTMLButtonElement;
    // Decision 5: dimmed with nothing to undo — the system's locked form, which
    // keeps the key reachable so its reason can be read.
    expect(empty.getAttribute("aria-disabled")).toBe("true");
    expect(empty.hasAttribute("data-locked")).toBe(true);
    expect(empty.title).toMatch(/^Nothing to undo\./);
    expect(empty.textContent).toBe("Undonothing to undo");
    fireEvent.click(empty);
    expect(nothing.onUndo).not.toHaveBeenCalled();
    cleanup();

    const something = renderCluster({ undoLabel: "Delete scene Interview" });
    const undo = screen.getByRole("button", { name: "Undo Delete scene Interview" }) as HTMLButtonElement;
    expect(undo.dataset.testid).toBe("lighting-undo");
    expect(undo.disabled).toBe(false);
    expect(undo.textContent).toBe("UndoDelete scene Interview");
    fireEvent.click(undo);
    expect(something.onUndo).toHaveBeenCalledTimes(1);
    cleanup();

    // A long name is cut in the small print; the key's name keeps all of it.
    const longName = "Delete fixture Backlight over the interview table, stage left";
    renderCluster({ undoLabel: longName });
    const long = screen.getByRole("button", { name: `Undo ${longName}` });
    expect(long.textContent).toBe(`Undo${longName.slice(0, 39)}…`);
  });

  // Slice 3 review, finding 16: the page-wide Esc cleared Highlight and Solo in
  // any mode; its twin is the lit key. In Preview both keys were disabled, lit
  // or not, so nothing on the page could switch a live Highlight or Solo off.
  it("a lit Highlight or Solo key can be pressed in Preview, with or without a selection; unlit, both wait", () => {
    for (const hasSelection of [true, false]) {
      const onToggleHighlight = vi.fn();
      renderCluster({ previewMode: true, highlightActive: true, hasSelection, onToggleHighlight });
      const highlight = screen.getByTestId("lighting-highlight-toggle") as HTMLButtonElement;
      expect(highlight.getAttribute("aria-pressed")).toBe("true");
      expect(highlight.disabled).toBe(false);
      fireEvent.click(highlight);
      expect(onToggleHighlight).toHaveBeenCalledTimes(1);
      cleanup();

      const onToggleSolo = vi.fn();
      renderCluster({ previewMode: true, soloActive: true, hasSelection, onToggleSolo });
      const solo = screen.getByTestId("lighting-solo-toggle") as HTMLButtonElement;
      expect(solo.getAttribute("aria-pressed")).toBe("true");
      expect(solo.disabled).toBe(false);
      fireEvent.click(solo);
      expect(onToggleSolo).toHaveBeenCalledTimes(1);
      cleanup();
    }

    const onToggleHighlight = vi.fn();
    const onToggleSolo = vi.fn();
    renderCluster({ previewMode: true, hasSelection: true, onToggleHighlight, onToggleSolo });
    for (const testId of ["lighting-highlight-toggle", "lighting-solo-toggle"]) {
      const key = screen.getByTestId(testId) as HTMLButtonElement;
      expect(key.disabled).toBe(true);
      fireEvent.click(key);
    }
    expect(onToggleHighlight).not.toHaveBeenCalled();
    expect(onToggleSolo).not.toHaveBeenCalled();
  });

  it("says Press Patch, not a key, while patch mode holds the rig", () => {
    renderCluster({ patchMode: true });
    expect(screen.getByTestId("lighting-power-toggle").getAttribute("title")).toBe(
      "Patch mode is on: the rig's levels are paused while you address fixtures. Press Patch to leave it."
    );
  });
});
