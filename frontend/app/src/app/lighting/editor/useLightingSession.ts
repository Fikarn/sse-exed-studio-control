import { useState, useCallback, useRef, useEffect } from "react";
import { type LightingUiMode, deriveInspectorTab } from "../components/LightingInspector";
import { asRecord } from "../../shellData";
import type { StagePlotRenderMode } from "../fixtureVisuals";
import type { InspectorTab } from "../components/LightingInspectorTabs";
import { useToast } from "../../shared/toastContext";
import { usePalette } from "../../shared/paletteContext";
import { useOperatorLayout } from "../../OperatorLayoutProvider";
import { useResizableColumns } from "../useResizableColumns";
import { useUndoStack } from "../useUndoStack";
import { useLiveCallback } from "../../shared/useLiveCallback";
import type { LightingWorkspaceSurfaceProps } from "../lightingWorkspaceModel";
import type { LightingRig } from "./useLightingRig";

/** What this sitting at the Lighting workspace has open: recall or patch mode,
 *  the search, which dialog is up, which delete is waiting for a yes, what is
 *  busy, the column widths, the DMX strip, and the undo history. Nothing in it
 *  reaches the rig. */
export function useLightingSession({ props, rig }: { props: LightingWorkspaceSurfaceProps; rig: LightingRig }) {
  const { appSnapshot } = props;
  const { scenes, persistedLightingSectionId, selectedFixture, persistedSelectedFixtureId, previewMode } = rig;
  const [uiMode, setUiMode] = useState<LightingUiMode>(() => {
    const initialSectionId = asRecord(asRecord(appSnapshot?.shell)?.lighting)?.currentSectionId;
    return initialSectionId === "palettes-patch" ? "patch" : "recall";
  });
  const [stagePlotRenderMode, setStagePlotRenderMode] = useState<StagePlotRenderMode>("rig");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [activeTabOverride, setActiveTabOverride] = useState<InspectorTab | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const toast = useToast();
  const palette = usePalette();
  const operatorLayout = useOperatorLayout();
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  // Set-based busy tracking so parallel mutations (e.g. renaming Scene B
  // while saving Scene A) don't stomp each other. Each handler scopes its
  // own key; the inspector reads via `busyActions.has(key)` /
  // `busyHasPrefix(busyActions, prefix)`.
  const [busyActions, setBusyActions] = useState<ReadonlySet<string>>(() => new Set());
  const startBusy = useCallback((key: string) => {
    setBusyActions((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  const finishBusy = useCallback((key: string) => {
    setBusyActions((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const [dmxMonitorOpen, setDmxMonitorOpen] = useState(false);
  const [confirmCutAllOpen, setConfirmCutAllOpen] = useState(false);
  const [createFixtureOpen, setCreateFixtureOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [saveSceneAsOpen, setSaveSceneAsOpen] = useState(false);
  // Right-click "Delete" confirm dialogs raised from the SceneTile / GroupChip
  // / FixtureMarker context menus. Each surface owns its own slot so opening
  // a fixture confirm doesn't blow away an in-flight scene confirm. The
  // Inspector "Danger zone" delete buttons keep their own local dialogs.
  const [confirmDeleteScene, setConfirmDeleteScene] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteFixture, setConfirmDeleteFixture] = useState<{ id: string; name: string } | null>(null);
  // One-shot signal: when a chip / marker context menu's "Rename" fires for
  // an entity whose InlineRename lives in the inspector (group, fixture), we
  // (a) select the entity for inspection and (b) bump this nonce so the
  // inspector's effect triggers `renameRef.current?.beginEdit()` on mount.
  // The nonce ensures repeat requests for the same id retrigger.
  const [pendingInlineRename, setPendingInlineRename] = useState<{
    kind: "fixture" | "group";
    id: string;
    nonce: number;
  } | null>(null);
  const requestInlineRename = useCallback((kind: "fixture" | "group", id: string) => {
    setPendingInlineRename((prev) => ({ kind, id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const columns = useResizableColumns(operatorLayout.layoutMode);
  const undoStack = useUndoStack();

  // Stable ref to the latest scenes list — undo entries close over this so
  // they can ref-count against the CURRENT scenes at undo time, not whatever
  // was visible when the entry was pushed.
  const scenesRef = useRef(scenes);
  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  const activeTab =
    activeTabOverride ??
    (persistedLightingSectionId === "palettes" || persistedLightingSectionId === "palettes-patch"
      ? "palettes"
      : deriveInspectorTab({
          uiMode,
          selectedFixtureId: selectedFixture?.id ?? null,
          selectedGroupId,
        }));

  // Visual overhaul A, Slice 5b: with no tab row the plate shows what was last
  // asked for. Inspecting a group asks for the group, so the override survives
  // that selection; picking a fixture on the plot, or flipping patch mode,
  // hands the plate back to the fixture (or the patch) it belongs to.
  useEffect(() => {
    setActiveTabOverride(null);
  }, [uiMode, persistedSelectedFixtureId]);

  useEffect(() => {
    if (!operatorLayout.isNarrow) {
      setInspectorDrawerOpen(false);
    }
  }, [operatorLayout.isNarrow]);

  // ---------------- handlers ----------------

  const reportError = useLiveCallback((error: unknown, fallback: string) => {
    toast.push({
      message: error instanceof Error ? error.message : fallback,
      tone: "error",
    });
  });

  const handleTogglePatch = useLiveCallback(() => {
    if (previewMode) {
      toast.push({ message: "Exit preview before entering patch mode.", tone: "attention" });
      return;
    }
    setUiMode((current) => (current === "patch" ? "recall" : "patch"));
  });

  // Wave 31 — P4 persistent compact DMX strip toggle. Default OFF (operator
  // opts in) with persistence to localStorage so the choice survives
  // reloads. The strip overlays the bottom of the body when on (does NOT
  // push body height — the workspace keeps its full vertical extent and
  // the strip floats just above the health bar via .bottomOverlays).
  const [dmxStripOn, setDmxStripOn] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("app.lighting.dmxStripOn") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("app.lighting.dmxStripOn", String(dmxStripOn));
    } catch {
      // best-effort; in-session toggle still works
    }
  }, [dmxStripOn]);

  // Wave 31 — delayed unmount for the DMX strip's close animation. Keep the
  // strip mounted for the full 180 ms slide-out before tearing down its
  // canvas + rAF loop. Mount happens immediately on toggle-on so the open
  // animation starts on the next frame.
  const [renderDmxStrip, setRenderDmxStrip] = useState(dmxStripOn);
  useEffect(() => {
    if (dmxStripOn) {
      setRenderDmxStrip(true);
      return;
    }
    const timer = window.setTimeout(() => setRenderDmxStrip(false), 180);
    return () => window.clearTimeout(timer);
  }, [dmxStripOn]);

  const requestAddFixture = useCallback(() => {
    if (previewMode) {
      toast.push({ message: "Exit preview before adding fixtures.", tone: "attention" });
      return;
    }
    setCreateFixtureOpen(true);
  }, [previewMode, toast]);

  const requestEmergencyCut = useCallback(() => {
    setConfirmCutAllOpen(true);
  }, []);

  const handleInspectGroup = useCallback(
    (groupId: string) => {
      setSelectedGroupId(groupId);
      setActiveTabOverride("group");
      if (operatorLayout.isNarrow) setInspectorDrawerOpen(true);
    },
    [operatorLayout.isNarrow]
  );
  return {
    uiMode,
    setUiMode,
    stagePlotRenderMode,
    setStagePlotRenderMode,
    selectedGroupId,
    setSelectedGroupId,
    setActiveTabOverride,
    searchQuery,
    setSearchQuery,
    toast,
    palette,
    operatorLayout,
    inspectorDrawerOpen,
    setInspectorDrawerOpen,
    busyActions,
    startBusy,
    finishBusy,
    dmxMonitorOpen,
    setDmxMonitorOpen,
    confirmCutAllOpen,
    setConfirmCutAllOpen,
    createFixtureOpen,
    setCreateFixtureOpen,
    createGroupOpen,
    setCreateGroupOpen,
    saveSceneAsOpen,
    setSaveSceneAsOpen,
    confirmDeleteScene,
    setConfirmDeleteScene,
    confirmDeleteGroup,
    setConfirmDeleteGroup,
    confirmDeleteFixture,
    setConfirmDeleteFixture,
    pendingInlineRename,
    requestInlineRename,
    columns,
    undoStack,
    scenesRef,
    activeTab,
    reportError,
    handleTogglePatch,
    dmxStripOn,
    setDmxStripOn,
    renderDmxStrip,
    requestAddFixture,
    requestEmergencyCut,
    handleInspectGroup,
  };
}

export type LightingSession = ReturnType<typeof useLightingSession>;
