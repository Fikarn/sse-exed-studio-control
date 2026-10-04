import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ARM_DWELL_MS, useArm } from "@sse/design-system";

import { LightingCluster, type LightingClusterProps } from "./LightingCluster";

// The cluster of the visual overhaul's Lighting page (2026-10-04): Undo names
// the step it will undo; CUT ALL arms as the deck's ALL OFF does and is never
// locked while there is a rig; the grand master waits in Preview (it acts on
// the rig itself); a Highlight or a Solo on the rig latches with its Off key.

afterEach(() => {
  cleanup();
});

let clock = 0;

function Harness(props: Omit<LightingClusterProps, "arm" | "armedWords">) {
  const arm = useArm({ now: () => clock });
  return <LightingCluster {...props} arm={arm} armedWords={arm.armed?.label ?? null} />;
}

function renderCluster(overrides: Partial<Omit<LightingClusterProps, "arm" | "armedWords">> = {}) {
  const handlers = {
    onUndo: vi.fn(),
    onEmergencyCut: vi.fn(),
    onToggleHighlight: vi.fn(),
    onToggleSolo: vi.fn(),
    onTogglePatch: vi.fn(),
  };
  const props: Omit<LightingClusterProps, "arm" | "armedWords"> = {
    bridgeIp: "192.168.1.80",
    bridgeReachable: true,
    bridgeUniverse: 1,
    channelCount: 12,
    fixtureOnCount: 3,
    fixtureTotal: 4,
    grandMaster: 100,
    lastSavedLabel: null,
    previewDirty: false,
    previewMode: false,
    patchMode: false,
    recallFadeMs: 0,
    sceneModified: false,
    sceneName: "Warm wash",
    sceneRailProps: {
      scenes: [],
      liveSceneId: null,
      liveWord: null,
      onRecall: () => {},
      buildMenu: (scene) => ({ head: { title: scene.name }, items: [] }),
    },
    groupRailProps: {
      groups: [],
      onTogglePower: () => {},
      buildMenu: (group) => ({ head: { title: group.name }, items: [] }),
    },
    highlightNames: [],
    soloNames: [],
    onAddFixture: () => {},
    onCreateGroup: () => {},
    onDiscardPreview: () => {},
    onGrandMasterChange: () => {},
    recentScenes: [],
    searchQuery: "",
    onSearchChange: () => {},
    onOpenDmxMonitor: () => {},
    dmxStripOn: false,
    onToggleDmxStrip: () => {},
    onRecallFadeMsChange: () => {},
    onResaveScene: () => {},
    onOpenSetup: () => {},
    onSaveScene: () => {},
    onToggleAllPower: () => {},
    onTogglePreview: () => {},
    ...handlers,
    ...overrides,
  };
  render(<Harness {...props} />);
  return handlers;
}

describe("LightingCluster", () => {
  it("the Undo key names the step it will undo, and cannot be pressed with nothing to undo", () => {
    const nothing = renderCluster({ undoLabel: null });
    const empty = screen.getByTestId("lighting-undo") as HTMLButtonElement;
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
    expect(undo.textContent).toBe("UndoDelete scene Interview");
    fireEvent.click(undo);
    expect(something.onUndo).toHaveBeenCalledTimes(1);
    cleanup();

    const longName = "Delete fixture Backlight over the interview table, stage left";
    renderCluster({ undoLabel: longName });
    const long = screen.getByRole("button", { name: `Undo ${longName}` });
    expect(long.textContent).toBe(`Undo${longName.slice(0, 39)}…`);
  });

  it("CUT ALL arms at the first press and cuts at the second, as the deck's ALL OFF does", () => {
    clock = 0;
    const handlers = renderCluster();
    const cut = screen.getByTestId("lighting-emergency-cut");
    fireEvent.click(cut);
    expect(cut.getAttribute("data-armed")).toBe("true");
    expect(handlers.onEmergencyCut).not.toHaveBeenCalled();
    expect(screen.getByTestId("lighting-state-display").textContent).toContain("Cut all fixtures · press again");
    clock = ARM_DWELL_MS + 50;
    fireEvent.click(cut);
    expect(handlers.onEmergencyCut).toHaveBeenCalledTimes(1);
    expect(cut.getAttribute("data-armed")).toBe("false");
  });

  it("CUT ALL stays live while the bridge has not passed its probe; LIGHTING and the grand master lock", () => {
    renderCluster({ bridgeReachable: false });
    expect(screen.getByTestId("lighting-emergency-cut").getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByTestId("lighting-power-toggle").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("lighting-grand-master").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("lighting-state-display").textContent).toContain("has not passed its probe");
  });

  it("the grand master waits in Preview: it acts on the rig itself", () => {
    renderCluster({ previewMode: true });
    const master = screen.getByTestId("lighting-grand-master");
    expect(master.getAttribute("aria-disabled")).toBe("true");
    expect(master.parentElement?.getAttribute("title")).toMatch(/acts on the rig itself/);
  });

  it("a Highlight and a Solo on the rig latch with the key that ends them; Patch with Leave", () => {
    const handlers = renderCluster({ highlightNames: ["Key", "Fill"], patchMode: true });
    expect(screen.getByTestId("lighting-latch-highlight").textContent).toContain("Key, Fill");
    act(() => fireEvent.click(screen.getByTestId("lighting-latch-highlight-off")));
    expect(handlers.onToggleHighlight).toHaveBeenCalledTimes(1);
    act(() => fireEvent.click(screen.getByTestId("lighting-latch-patch-leave")));
    expect(handlers.onTogglePatch).toHaveBeenCalledTimes(1);
    cleanup();

    renderCluster({ soloNames: ["Key"] });
    expect(screen.getByTestId("lighting-latch-solo").textContent).toContain("Key");
    expect(screen.queryByTestId("lighting-latch-highlight")).toBeNull();
  });

  it("says how to leave Patch, never a key, while patch mode holds the rig", () => {
    renderCluster({ patchMode: true });
    expect(screen.getByTestId("lighting-power-toggle").getAttribute("title")).toBe(
      "Patch mode is on: leave it to switch the rig and save scenes."
    );
  });
});
