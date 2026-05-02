import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { Button, ConfirmDialog, Dialog, type PaletteAction } from "@sse/design-system";
import type {
  LightingDmxMonitorSnapshot,
  LightingFixtureSnapshot,
  LightingPaletteKind,
  LightingSceneSnapshot,
  LightingSnapshot,
  ShellStore,
} from "@sse/engine-client";

import { usePalette } from "../shared/paletteContext";
import { useToast, type ToastApi } from "../shared/toastContext";

import {
  asRecord,
  getLightingDmxChannels,
  getLightingFixtures,
  getLightingScenes,
  getSceneThumbs,
  isEditableTarget,
  type SnapshotRecord,
} from "../shellData";
import { ColumnResizer } from "./components/ColumnResizer";
import { CreateFixtureDialog } from "./components/CreateFixtureDialog";
import { DMXMonitorDialog } from "./components/DMXMonitorDialog";
import { LightingBridgeBanner } from "./components/LightingBridgeBanner";
import { LightingHealthBar } from "./components/LightingHealthBar";
import { LightingInspector, deriveInspectorTab, type LightingUiMode } from "./components/LightingInspector";
import type { InspectorTab } from "./components/LightingInspectorTabs";
import { LightingRail } from "./components/LightingRail";
import { LightingToolbar } from "./components/LightingToolbar";
import { DMXCompactStrip } from "./components/DMXCompactStrip";
import { PreviewBanner } from "./components/PreviewBanner";
import { RenameDialog } from "./components/RenameDialog";
import { SelectionChipStrip } from "./components/SelectionChipStrip";
import { StagePlot } from "./components/StagePlot";
import { lightingColorTagHex } from "./lightingColorTags";
import { nextLightingFixtureName } from "./lightingHelpers";
import { renderSceneThumbnailDataUri, withSceneThumbRemoved, withSceneThumbUpserted } from "./sceneThumbnails";
import { useResizableColumns } from "./useResizableColumns";
import { useStagePlotViewport, type ViewBookmarkSlot } from "./useStagePlotViewport";
import { UndoRefusedError, useUndoStack, type UndoOutcome } from "./useUndoStack";
import { useUnsavedChangesGuard } from "./useUnsavedScenePrompt";
import styles from "./LightingWorkspace.module.css";

interface LightingWorkspaceSurfaceProps {
  appSnapshot: SnapshotRecord | null;
  lightingDmxMonitorSnapshot: LightingDmxMonitorSnapshot | null;
  lightingSnapshot: LightingSnapshot | null;
  store: ShellStore;
}

const RECALL_FADE_PRESETS_MS = [0, 1000, 2000, 5000] as const;

function formatRecallFade(ms: number): string {
  if (ms <= 0) return "snap";
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
}

/** Result-aware toast helper for surfacing UndoOutcome to the operator. The
 *  undo stack returns a tagged result; this maps every variant to a toast so
 *  rejections (UndoRefusedError) and errors don't silently disappear. */
function pushUndoOutcomeToast(toast: ToastApi, outcome: UndoOutcome): void {
  if (outcome.kind === "noop") return;
  if (outcome.kind === "ok") {
    toast.push({ tone: "info", message: `Undid: ${outcome.label}.` });
    return;
  }
  if (outcome.kind === "rejected") {
    toast.push({
      tone: "info",
      message: `Cannot undo "${outcome.label}" — ${outcome.reason}.`,
    });
    return;
  }
  toast.push({
    tone: "error",
    message: `Undo failed for "${outcome.label}". The operation is still applied.`,
  });
}

function fixtureStatesEqual(
  fixtures: ReadonlyArray<{ id: string; intensity: number; cct: number; on: boolean }>,
  sceneStates: ReadonlyArray<{ fixtureId: string; intensity: number; cct: number; on: boolean }>
): boolean {
  if (fixtures.length === 0 && sceneStates.length === 0) return true;
  const sceneById = new Map(sceneStates.map((state) => [state.fixtureId, state]));
  for (const fixture of fixtures) {
    const sceneState = sceneById.get(fixture.id);
    if (!sceneState) {
      // Fixture present but not in saved scene → drift if currently on.
      if (fixture.on && fixture.intensity > 0) return false;
      continue;
    }
    if (sceneState.on !== fixture.on) return false;
    if (sceneState.on && Math.abs(sceneState.intensity - fixture.intensity) > 0.5) return false;
    if (sceneState.on && Math.abs(sceneState.cct - fixture.cct) > 25) return false;
  }
  return true;
}

function snapshotWithFixtures(
  snapshot: LightingSnapshot | null,
  fixtures: readonly LightingFixtureSnapshot[]
): LightingSnapshot | null {
  return snapshot ? { ...snapshot, fixtures: [...fixtures] } : null;
}

export function LightingWorkspaceSurface({
  appSnapshot,
  lightingDmxMonitorSnapshot,
  lightingSnapshot,
  store,
}: LightingWorkspaceSurfaceProps) {
  const liveFixtures = useMemo(() => lightingSnapshot?.fixtures ?? [], [lightingSnapshot]);
  const previewMode = lightingSnapshot?.previewMode === true;
  const previewSnapshotFixtures = useMemo(() => lightingSnapshot?.previewFixtures ?? [], [lightingSnapshot]);
  const previewTargetSceneId =
    typeof lightingSnapshot?.previewSceneId === "string" ? lightingSnapshot.previewSceneId : null;
  const fixtures = useMemo(
    () => (previewMode && previewSnapshotFixtures.length > 0 ? previewSnapshotFixtures : liveFixtures),
    [liveFixtures, previewMode, previewSnapshotFixtures]
  );
  const groups = useMemo(() => lightingSnapshot?.groups ?? [], [lightingSnapshot]);
  const scenes = useMemo(() => lightingSnapshot?.scenes ?? [], [lightingSnapshot]);
  const palettes = useMemo(() => lightingSnapshot?.palettes ?? [], [lightingSnapshot]);
  const dmxChannelsRaw = useMemo(
    () => getLightingDmxChannels(lightingDmxMonitorSnapshot),
    [lightingDmxMonitorSnapshot]
  );
  // Re-derive fixtures from shellData accessor for drift comparisons (snapshot
  // -> entry has the null-safe shape the helpers expect).
  const fixtureEntries = useMemo(
    () => getLightingFixtures(snapshotWithFixtures(lightingSnapshot, fixtures)),
    [fixtures, lightingSnapshot]
  );
  const liveFixtureEntries = useMemo(() => getLightingFixtures(lightingSnapshot), [lightingSnapshot]);
  // Surface group + scene entries via shellData for parity with rail props.
  const sceneEntries = useMemo(() => getLightingScenes(lightingSnapshot), [lightingSnapshot]);

  const sceneThumbs = useMemo(() => getSceneThumbs(appSnapshot), [appSnapshot]);

  const persistedSelectedFixtureId =
    typeof lightingSnapshot?.selectedFixtureId === "string" ? lightingSnapshot.selectedFixtureId : null;
  const persistedSelectedSceneId =
    typeof lightingSnapshot?.selectedSceneId === "string" ? lightingSnapshot.selectedSceneId : null;
  const persistedLightingSectionId = asRecord(asRecord(appSnapshot?.shell)?.lighting)?.currentSectionId;

  const [uiMode, setUiMode] = useState<LightingUiMode>(() => {
    const initialSectionId = asRecord(asRecord(appSnapshot?.shell)?.lighting)?.currentSectionId;
    return initialSectionId === "palettes-patch" ? "patch" : "recall";
  });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [activeTabOverride, setActiveTabOverride] = useState<InspectorTab | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [paletteQuickOpen, setPaletteQuickOpen] = useState(false);
  const [recallFadeMs, setRecallFadeMs] = useState(0);
  const toast = useToast();
  const palette = usePalette();
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
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // Frontend-only multi-select. The persisted single id (read from snapshot)
  // is the "primary" focus that's synced to the engine; the set tracks the
  // additional shift-click selections so the bulk inspector can edit them
  // together. Cleared on workspace switch / hot reload by being state.
  const [extraSelectedFixtureIds, setExtraSelectedFixtureIds] = useState<ReadonlySet<string>>(() => new Set());
  // Mirror identify-burst pulses on the plot marker. 1.2 s window matches
  // engine identify.rs default. Cleared by setTimeout in handleIdentifyBurst.
  const [identifyingIds, setIdentifyingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Wave 29 — Find sequence pulse timers. Each call to handleIdentifyFind
  // schedules 2N timers (start + stop per fixture); cleared on Esc /
  // workspace switch / new sequence start so prior runs don't leak through.
  const findSequenceTimersRef = useRef<number[]>([]);
  const clearFindSequenceTimers = useCallback(() => {
    for (const handle of findSequenceTimersRef.current) {
      window.clearTimeout(handle);
    }
    findSequenceTimersRef.current = [];
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
  // Frontend-only clicked scene id. Set immediately when a scene tile is
  // clicked so the inspector can show its details even if the engine recall
  // IPC was rejected (e.g. bridge unreachable in dev / pre-probe states).
  // Takes priority over snapshot-derived recalled / persisted selection so
  // the inspector tracks the user's intent rather than the engine's truth.
  const [inspectorSelectedSceneId, setInspectorSelectedSceneId] = useState<string | null>(null);

  // Wave 30b — X1 hover preview. Distinct from the clicked scene id because
  // hover should ONLY update the inspector's displayed scene, NOT the
  // workspace's active-scene semantics (drift detection, plot pill, tile
  // green-border treatment, group chip deltas). inspectorSelectedSceneId is for the
  // click-confirmed selection path and feeds activeSceneId; hover stays
  // strictly contained to the inspector. Mouseleave schedules a 200 ms
  // grace clear so a wandering cursor between tiles doesn't make the
  // inspector jump back to baseline; click cancels timers and clears
  // immediately via handleRecallScene below.
  const [hoverPreviewSceneId, setHoverPreviewSceneId] = useState<string | null>(null);
  const hoverActivateTimerRef = useRef<number | null>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (hoverActivateTimerRef.current !== null) window.clearTimeout(hoverActivateTimerRef.current);
      if (hoverClearTimerRef.current !== null) window.clearTimeout(hoverClearTimerRef.current);
    };
  }, []);
  const handleHoverPreview = useCallback((sceneId: string) => {
    if (hoverClearTimerRef.current !== null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    if (hoverActivateTimerRef.current !== null) {
      window.clearTimeout(hoverActivateTimerRef.current);
    }
    hoverActivateTimerRef.current = window.setTimeout(() => {
      setHoverPreviewSceneId(sceneId);
      hoverActivateTimerRef.current = null;
    }, 300);
  }, []);
  const handleHoverPreviewClear = useCallback(() => {
    if (hoverActivateTimerRef.current !== null) {
      window.clearTimeout(hoverActivateTimerRef.current);
      hoverActivateTimerRef.current = null;
    }
    if (hoverClearTimerRef.current !== null) {
      window.clearTimeout(hoverClearTimerRef.current);
    }
    hoverClearTimerRef.current = window.setTimeout(() => {
      setHoverPreviewSceneId(null);
      hoverClearTimerRef.current = null;
    }, 200);
  }, []);
  // Click → cancel hover preview synchronously. Called by handleRecallScene
  // below before the clicked scene flips, so the inspector goes straight to
  // the clicked scene without a 200 ms intermediate showing the previously-
  // hovered one.
  const cancelHoverPreviewSync = useCallback(() => {
    if (hoverActivateTimerRef.current !== null) {
      window.clearTimeout(hoverActivateTimerRef.current);
      hoverActivateTimerRef.current = null;
    }
    if (hoverClearTimerRef.current !== null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    setHoverPreviewSceneId(null);
  }, []);

  const snapshotGrandMaster = lightingSnapshot?.grandMaster ?? 100;
  const [grandMasterDraft, setGrandMasterDraft] = useState(snapshotGrandMaster);
  const grandMasterCommitRef = useRef<number | null>(null);

  // Sync the slider draft to the engine snapshot when no commit is pending.
  // While the user is dragging (timer armed) the draft wins; once the trailing
  // commit fires and the snapshot reflects the new value, this no-ops.
  useEffect(() => {
    if (grandMasterCommitRef.current !== null) return;
    setGrandMasterDraft(snapshotGrandMaster);
  }, [snapshotGrandMaster]);

  useEffect(() => {
    return () => {
      if (grandMasterCommitRef.current !== null) {
        window.clearTimeout(grandMasterCommitRef.current);
      }
    };
  }, []);

  const columns = useResizableColumns();
  const undoStack = useUndoStack();

  // Stable ref to the latest scenes list — undo entries close over this so
  // they can ref-count against the CURRENT scenes at undo time, not whatever
  // was visible when the entry was pushed.
  const scenesRef = useRef(scenes);
  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  // Live active scene = the most recently recalled scene (engine-tracked)
  // falling back to the persisted selectedSceneId. Kept separate from the
  // preview target so the rail can keep showing the live recalled scene while
  // the plot/inspector display the offline edit buffer.
  const liveActiveSceneId = useMemo(() => {
    const recalled = sceneEntries.find((scene) => scene.lastRecalled);
    if (recalled) return recalled.id;
    if (persistedSelectedSceneId && sceneEntries.some((scene) => scene.id === persistedSelectedSceneId)) {
      return persistedSelectedSceneId;
    }
    return null;
  }, [sceneEntries, persistedSelectedSceneId]);

  const activeSceneId = useMemo(() => {
    if (previewMode) {
      if (previewTargetSceneId && sceneEntries.some((scene) => scene.id === previewTargetSceneId)) {
        return previewTargetSceneId;
      }
      return liveActiveSceneId;
    }
    if (inspectorSelectedSceneId && sceneEntries.some((scene) => scene.id === inspectorSelectedSceneId)) {
      return inspectorSelectedSceneId;
    }
    return liveActiveSceneId;
  }, [inspectorSelectedSceneId, liveActiveSceneId, previewMode, previewTargetSceneId, sceneEntries]);

  const activeScene = useMemo(
    () => scenes.find((scene) => scene.id === activeSceneId) ?? null,
    [scenes, activeSceneId]
  );

  // Drift detection: compare fixture state against the active scene's saved
  // fixtureStates. Modified id is the active scene id when drift is detected.
  const isSceneModified = useMemo(() => {
    if (!activeScene) return false;
    return !fixtureStatesEqual(
      fixtureEntries.map((fixture) => ({
        id: fixture.id,
        intensity: fixture.intensity,
        cct: fixture.cct,
        on: fixture.on,
      })),
      activeScene.fixtureStates.map((state) => ({
        fixtureId: state.fixtureId,
        intensity: state.intensity,
        cct: state.cct,
        on: state.on,
      }))
    );
  }, [activeScene, fixtureEntries]);

  const previewDirty = previewMode && ((lightingSnapshot?.previewDirty ?? false) || isSceneModified);
  const effectiveSceneModified = previewMode ? previewDirty : isSceneModified;
  const modifiedSceneId = !previewMode && isSceneModified && activeSceneId ? activeSceneId : null;

  // Unsaved-changes guard. When the active scene is drifted, intercept any
  // workspace switch (including ⌘1-4, A, ⇧S keyboard shortcuts) with a
  // confirmation dialog. The guard fn returns a Promise resolved by the
  // user's click on the dialog.
  const pendingLeaveResolveRef = useRef<((allowed: boolean) => void) | null>(null);
  const [showLeavePrompt, setShowLeavePrompt] = useState(false);
  const promptForLeave = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      pendingLeaveResolveRef.current = resolve;
      setShowLeavePrompt(true);
    });
  }, []);
  useUnsavedChangesGuard(effectiveSceneModified ? promptForLeave : null);
  // Belt-and-braces: if the workspace unmounts while a prompt is open (e.g.
  // hot reload mid-prompt), resolve the awaiter so the navigation pipeline
  // doesn't deadlock.
  useEffect(() => {
    return () => {
      pendingLeaveResolveRef.current?.(false);
      pendingLeaveResolveRef.current = null;
    };
  }, []);

  // Title-bar drift indicator: append " · ●" while the active scene has
  // unsaved drift. Reset on cleanup so other workspaces / unmount restore
  // the plain product name. Tauri-only — gated on __TAURI_INTERNALS__ so
  // the same code is harmless when the frontend runs in a plain browser
  // (e.g. visual-review / Storybook contexts).
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    const baseTitle = "SSE ExEd Studio Control";
    let cancelled = false;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (cancelled) return;
      const win = getCurrentWindow();
      void win.setTitle(effectiveSceneModified ? `${baseTitle} · ●` : baseTitle);
    })();
    return () => {
      cancelled = true;
      void (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        void win.setTitle(baseTitle);
      })();
    };
  }, [effectiveSceneModified]);

  const selectedFixture = useMemo(
    () => fixtures.find((fixture) => fixture.id === persistedSelectedFixtureId) ?? null,
    [fixtures, persistedSelectedFixtureId]
  );

  const activeTab =
    activeTabOverride ??
    (persistedLightingSectionId === "palettes" || persistedLightingSectionId === "palettes-patch"
      ? "palettes"
      : deriveInspectorTab({
          uiMode,
          selectedFixtureId: selectedFixture?.id ?? null,
          selectedGroupId,
        }));

  // Reset tab override when uiMode flips so patch ↔ recall behaves naturally.
  useEffect(() => {
    setActiveTabOverride(null);
  }, [uiMode, persistedSelectedFixtureId, selectedGroupId]);

  // Group rail entries: GroupRailEntry needs id/name/fixtureCount/on/level/drifted.
  // - level: average intensity across the group's currently-on fixtures (0 when
  //   the group is fully off).
  // - drifted: any of the group's fixtures has live state diverging from the
  //   active scene's saved state (intensity/cct/on). Yellow signal in the chip.
  const railGroupEntries = useMemo(() => {
    const sceneStateById = new Map(activeScene?.fixtureStates.map((state) => [state.fixtureId, state]) ?? []);
    return groups.map((group) => {
      const groupFixtures = fixtureEntries.filter((fixture) => fixture.groupId === group.id);
      const onFixtures = groupFixtures.filter((fixture) => fixture.on === true);
      const allOn = groupFixtures.length > 0 && onFixtures.length === groupFixtures.length;
      const level =
        onFixtures.length > 0
          ? Math.round(onFixtures.reduce((sum, fixture) => sum + fixture.intensity, 0) / onFixtures.length)
          : 0;
      const drifted = activeScene
        ? groupFixtures.some((fixture) => {
            const sceneState = sceneStateById.get(fixture.id);
            if (!sceneState) return false;
            if (sceneState.on !== fixture.on) return true;
            if (sceneState.on && Math.abs(sceneState.intensity - fixture.intensity) > 0.5) return true;
            if (sceneState.on && Math.abs(sceneState.cct - fixture.cct) > 25) return true;
            return false;
          })
        : false;
      // Saved-scene reference level: average intensity across this group's
      // fixtures that are on in the active scene's saved state. Used to
      // surface the direction + magnitude of drift on the chip.
      const sceneOnIntensities = groupFixtures
        .map((fixture) => sceneStateById.get(fixture.id))
        .filter((state): state is NonNullable<typeof state> => Boolean(state?.on))
        .map((state) => state.intensity);
      const sceneLevel =
        sceneOnIntensities.length > 0
          ? Math.round(sceneOnIntensities.reduce((sum, n) => sum + n, 0) / sceneOnIntensities.length)
          : 0;
      const levelDelta = drifted ? level - sceneLevel : 0;
      return {
        id: group.id,
        name: group.name,
        fixtureCount: group.fixtureCount,
        on: allOn,
        level,
        drifted,
        levelDelta,
        colorIndex: group.colorIndex,
      };
    });
  }, [groups, fixtureEntries, activeScene]);

  const fixturesPatched = liveFixtureEntries.filter((fixture) => fixture.dmxStartAddress > 0).length;

  const bridgeReachable = lightingSnapshot?.reachable === true;
  const bridgeUniverse = lightingSnapshot?.universe ?? 1;
  const bridgeIp = String(lightingSnapshot?.bridgeIp ?? "");

  // ---------------- handlers ----------------

  const reportError = useEffectEvent((error: unknown, fallback: string) => {
    toast.push({
      message: error instanceof Error ? error.message : fallback,
      tone: "error",
    });
  });

  // F2 — marquee commit handler. `ids` is the full set inside the released
  // rectangle. With `additive: true` (Shift+marquee) the existing extras +
  // primary are preserved and the new ids merge in; otherwise the persisted
  // single-selection is replaced by the rectangle's first hit (or cleared if
  // empty) and extras carry the rest.
  const handleMarqueeSelect = useEffectEvent(async (ids: readonly string[], options: { additive: boolean }) => {
    if (options.additive) {
      if (ids.length === 0) return;
      setExtraSelectedFixtureIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (id !== persistedSelectedFixtureId) next.add(id);
        }
        return next;
      });
      return;
    }
    // Replace mode. Empty marquee clears all selections (single + extras).
    setSelectedGroupId(null);
    if (ids.length === 0) {
      setExtraSelectedFixtureIds(new Set());
      if (persistedSelectedFixtureId !== null) {
        await store.updateLightingSettings({ selectedFixtureId: null });
      }
      return;
    }
    const [first, ...rest] = ids;
    setExtraSelectedFixtureIds(new Set(rest));
    if (first && first !== persistedSelectedFixtureId) {
      await store.updateLightingSettings({ selectedFixtureId: first });
    }
  });

  const handleSelectFixture = useEffectEvent(async (fixtureId: string | null, options: { additive?: boolean } = {}) => {
    const { additive = false } = options;
    setSelectedGroupId(null);

    if (fixtureId === null) {
      setExtraSelectedFixtureIds(new Set());
    } else if (additive) {
      // Toggle the clicked id in the extras set. The persisted single id
      // stays as-is so the engine still knows which fixture is "focused";
      // the bulk inspector renders from persisted ∪ extras.
      setExtraSelectedFixtureIds((prev) => {
        const next = new Set(prev);
        if (next.has(fixtureId) && fixtureId !== persistedSelectedFixtureId) {
          next.delete(fixtureId);
        } else if (fixtureId !== persistedSelectedFixtureId) {
          next.add(fixtureId);
        }
        return next;
      });
      // Skip the engine sync — additive clicks shouldn't change which
      // fixture is "primary".
      return;
    } else {
      setExtraSelectedFixtureIds(new Set());
    }

    startBusy("fixture-select");
    try {
      await store.updateLightingSettings({ selectedFixtureId: fixtureId });
    } catch (error) {
      reportError(error, "Lighting selection update failed.");
    } finally {
      finishBusy("fixture-select");
    }
  });

  const selectedFixtureIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set(extraSelectedFixtureIds);
    if (persistedSelectedFixtureId) set.add(persistedSelectedFixtureId);
    return set;
  }, [extraSelectedFixtureIds, persistedSelectedFixtureId]);

  // Wave 29 — overlay-id sets read straight from the snapshot. The engine
  // is the source of truth so a page reload mid-overlay still surfaces the
  // active state in the toolbar. Empty sets when no overlay is active.
  const lightingHighlightFixtureIds = useMemo<ReadonlySet<string>>(
    () => new Set(lightingSnapshot?.highlightFixtureIds ?? []),
    [lightingSnapshot?.highlightFixtureIds]
  );
  const lightingSoloFixtureIds = useMemo<ReadonlySet<string>>(
    () => new Set(lightingSnapshot?.soloFixtureIds ?? []),
    [lightingSnapshot?.soloFixtureIds]
  );
  const overlayFixtureIds = useMemo<ReadonlySet<string>>(() => {
    const next = new Set(lightingHighlightFixtureIds);
    for (const id of lightingSoloFixtureIds) next.add(id);
    return next;
  }, [lightingHighlightFixtureIds, lightingSoloFixtureIds]);
  const highlightActive = lightingHighlightFixtureIds.size > 0;
  const soloActive = lightingSoloFixtureIds.size > 0;

  const selectedFixtureSnapshots = useMemo(
    () => fixtures.filter((fixture) => selectedFixtureIds.has(fixture.id)),
    [fixtures, selectedFixtureIds]
  );

  const [showPreviewExitPrompt, setShowPreviewExitPrompt] = useState(false);

  const disablePreviewMode = useEffectEvent(async () => {
    startBusy("preview-mode");
    try {
      await store.setLightingPreviewMode({ enabled: false });
      toast.push({ message: "Preview mode exited. Live rig stayed unchanged.", tone: "info" });
    } catch (error) {
      reportError(error, "Preview mode update failed.");
    } finally {
      finishBusy("preview-mode");
    }
  });

  const handleDiscardPreview = useEffectEvent(async () => {
    startBusy("preview-discard");
    try {
      await store.discardLightingPreview();
      setShowPreviewExitPrompt(false);
      toast.push({ message: "Preview edits discarded.", tone: "info" });
    } catch (error) {
      reportError(error, "Preview discard failed.");
    } finally {
      finishBusy("preview-discard");
    }
  });

  const requestExitPreview = useCallback(() => {
    if (previewDirty) {
      setShowPreviewExitPrompt(true);
      return;
    }
    void disablePreviewMode();
  }, [disablePreviewMode, previewDirty]);

  const handleTogglePreview = useEffectEvent(async () => {
    if (previewMode) {
      requestExitPreview();
      return;
    }
    if (uiMode === "patch") {
      toast.push({ message: "Exit patch mode before preview editing.", tone: "info" });
      return;
    }
    startBusy("preview-mode");
    try {
      await store.setLightingPreviewMode({ enabled: true, patchModeActive: false });
      toast.push({ message: "Preview mode enabled. Live rig is unchanged.", tone: "ok" });
    } catch (error) {
      reportError(error, "Preview mode update failed.");
    } finally {
      finishBusy("preview-mode");
    }
  });

  const handleTogglePatch = useEffectEvent(() => {
    if (previewMode) {
      toast.push({ message: "Exit preview before entering patch mode.", tone: "info" });
      return;
    }
    setUiMode((current) => (current === "patch" ? "recall" : "patch"));
  });

  // Wave 31 — stage plot viewport hook lifted to the workspace level so
  // keyboard shortcuts (Shift+1/2/3 recall, ⌘⇧1/2/3 save) and other
  // workspace-level affordances can reach the bookmark API. StagePlot
  // consumes the same instance via its `viewport` prop. handleSelectFixture
  // is `useEffectEvent`-stable so closing over it is safe.
  const stagePlotViewport = useStagePlotViewport({
    onBackgroundClick: () => void handleSelectFixture(null),
  });

  // Wave 31 — I9 chip-hover signal. SelectionChipStrip writes the hovered
  // fixture id here; StagePlot reads it to mark the matching FixtureMarker
  // for the soft pulse ring. Null when no chip is hovered or the strip
  // isn't mounted (selection empty).
  const [chipHoverFixtureId, setChipHoverFixtureId] = useState<string | null>(null);

  // Wave 31 — I9 remove-from-selection. Distinct from `handleSelectFixture`'s
  // additive-toggle path (which preserves the persisted primary by design
  // for the bulk inspector). Here the operator's intent is unambiguous: the
  // chip's × means "take this fixture out of the selection". When removing
  // the primary we promote the first extra so the inspector still has a
  // focused fixture; if no extras remain, primary clears to null.
  const handleRemoveFromSelection = useEffectEvent(async (fixtureId: string) => {
    if (fixtureId === persistedSelectedFixtureId) {
      const promoted = Array.from(extraSelectedFixtureIds).find((id) => id !== fixtureId) ?? null;
      if (promoted !== null) {
        setExtraSelectedFixtureIds((prev) => {
          const next = new Set(prev);
          next.delete(promoted);
          return next;
        });
      }
      try {
        await store.updateLightingSettings({ selectedFixtureId: promoted });
      } catch (error) {
        reportError(error, "Selection update failed.");
      }
      return;
    }
    setExtraSelectedFixtureIds((prev) => {
      const next = new Set(prev);
      next.delete(fixtureId);
      return next;
    });
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
      toast.push({ message: "Exit preview before adding fixtures.", tone: "info" });
      return;
    }
    setCreateFixtureOpen(true);
  }, [previewMode, toast]);

  const handleAddFixture = useEffectEvent(
    async (fixtureSpec: { name: string; type: string; dmxStartAddress: number }) => {
      startBusy("fixture-create");
      try {
        const result = asRecord(await store.createLightingFixture(fixtureSpec));
        const createdFixture = asRecord(result?.fixture);
        const createdFixtureId = typeof createdFixture?.id === "string" ? createdFixture.id : null;
        if (createdFixtureId) {
          await store.updateLightingSettings({ selectedFixtureId: createdFixtureId });

          // Push undo: deleting the just-created fixture. Refuses if any
          // scene saved AFTER this push references the fixture (the engine
          // captures fixture id on save), since deletion would orphan that
          // saved-state entry.
          let currentId = createdFixtureId;
          undoStack.push({
            label: `Add fixture ${fixtureSpec.name}`,
            undo: async () => {
              const refs = scenesRef.current.reduce(
                (sum, scene) => sum + scene.fixtureStates.filter((state) => state.fixtureId === currentId).length,
                0
              );
              if (refs > 0) {
                throw new UndoRefusedError(
                  `fixture is referenced by ${refs} scene${refs === 1 ? "" : "s"} saved after it was added`
                );
              }
              await store.deleteLightingFixture(currentId);
            },
            redo: async () => {
              const redoResult = asRecord(await store.createLightingFixture(fixtureSpec));
              const redoCreated = asRecord(redoResult?.fixture);
              const newId = typeof redoCreated?.id === "string" ? redoCreated.id : null;
              if (newId) currentId = newId;
            },
          });
        }
        toast.push({ message: String(result?.summary ?? "Fixture added."), tone: "ok" });
      } catch (error) {
        reportError(error, "Lighting fixture create failed.");
      } finally {
        finishBusy("fixture-create");
      }
    }
  );

  const handleCreateGroup = useEffectEvent(async (name: string) => {
    startBusy("group-create");
    try {
      const result = asRecord(await store.createLightingGroup(name));
      toast.push({ message: String(result?.summary ?? `Group '${name}' created.`), tone: "ok" });
    } catch (error) {
      reportError(error, "Lighting group create failed.");
    } finally {
      finishBusy("group-create");
    }
  });

  const handleRenameScene = useEffectEvent(async (sceneId: string, name: string) => {
    const busyKey = `scene-rename:${sceneId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingScene({ sceneId, name });
      toast.push({ message: `Scene renamed to '${name}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene rename failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleRenameFixture = useEffectEvent(async (fixtureId: string, name: string) => {
    const busyKey = `fixture-rename:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, name });
      toast.push({ message: `Fixture renamed to '${name}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Fixture rename failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  // Wave 30b — F5 group reorder. Mirrors handleReorderScene shape; the engine
  // owns the persisted `group_order` (Wave 30a / `9ca8e5c`) and the snapshot
  // emits groups in that order, so we just hand the contract through and trust
  // the next snapshot tick to refresh the rail.
  const handleReorderGroup = useEffectEvent(async (groupId: string, beforeGroupId: string | null) => {
    const busyKey = `group-reorder:${groupId}`;
    startBusy(busyKey);
    try {
      await store.reorderLightingGroup(groupId, beforeGroupId);
    } catch (error) {
      reportError(error, "Group reorder failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  // Wave 30b — I4 set scene color tag. `null` clears, `0..7` sets. The IPC
  // contract from Wave 30a treats omit / null / index distinctly; we always
  // send the field so the engine knows the operator's intent.
  const handleSetSceneColor = useEffectEvent(async (sceneId: string, colorIndex: number | null) => {
    const busyKey = `scene-color:${sceneId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingScene({ sceneId, colorIndex });
    } catch (error) {
      reportError(error, "Scene color update failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  // Wave 30b — I4 set group color tag. Mirrors scene shape.
  const handleSetGroupColor = useEffectEvent(async (groupId: string, colorIndex: number | null) => {
    const busyKey = `group-color:${groupId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingGroup({ groupId, colorIndex });
    } catch (error) {
      reportError(error, "Group color update failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleApplyPalette = useEffectEvent(async (paletteId: string, fixtureIds: readonly string[]) => {
    if (fixtureIds.length === 0) {
      toast.push({ message: "Select a fixture before applying a palette.", tone: "info" });
      return;
    }
    const busyKey = `palette-apply:${paletteId}`;
    startBusy(busyKey);
    try {
      const result = asRecord(
        await store.applyLightingPalette({
          paletteId,
          fixtureIds,
          patchModeActive: uiMode === "patch",
        })
      );
      palette.pushRecent(`lighting:palette:${paletteId}`);
      toast.push({ message: String(result?.summary ?? "Palette applied."), tone: "ok" });
    } catch (error) {
      reportError(error, "Palette apply failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleCreatePalette = useEffectEvent(
    async (request: { name: string; kind: LightingPaletteKind; value: number; colorIndex: number | null }) => {
      const busyKey = `palette-create:${request.kind}`;
      startBusy(busyKey);
      try {
        const result = asRecord(await store.createLightingPalette(request));
        toast.push({ message: String(result?.summary ?? "Palette created."), tone: "ok" });
      } catch (error) {
        reportError(error, "Palette create failed.");
      } finally {
        finishBusy(busyKey);
      }
    }
  );

  const handleUpdatePalette = useEffectEvent(
    async (request: {
      paletteId: string;
      name?: string;
      value?: number;
      colorIndex?: number | null;
      beforePaletteId?: string | null;
    }) => {
      const busyKey = `palette-update:${request.paletteId}`;
      startBusy(busyKey);
      try {
        const result = asRecord(await store.updateLightingPalette(request));
        if (result?.summary) toast.push({ message: String(result.summary), tone: "ok" });
      } catch (error) {
        reportError(error, "Palette update failed.");
      } finally {
        finishBusy(busyKey);
      }
    }
  );

  const handleDeletePalette = useEffectEvent(async (paletteId: string) => {
    const busyKey = `palette-delete:${paletteId}`;
    startBusy(busyKey);
    try {
      const result = asRecord(await store.deleteLightingPalette(paletteId));
      toast.push({ message: String(result?.summary ?? "Palette deleted."), tone: "ok" });
    } catch (error) {
      reportError(error, "Palette delete failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleRenameGroup = useEffectEvent(async (groupId: string, name: string) => {
    const busyKey = `group-rename:${groupId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingGroup({ groupId, name });
      toast.push({ message: `Group renamed to '${name}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Group rename failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleDeleteGroup = useEffectEvent(async (groupId: string, groupName: string) => {
    const busyKey = `group-delete:${groupId}`;
    startBusy(busyKey);
    try {
      await store.deleteLightingGroup(groupId);
      // If the user was inspecting this group, clear the selection so the
      // inspector falls back to the scene tab instead of "Choose a group from
      // the rail".
      if (selectedGroupId === groupId) {
        setSelectedGroupId(null);
      }
      toast.push({ message: `Group '${groupName}' deleted.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Group delete failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const commitGrandMaster = useEffectEvent(async (value: number) => {
    grandMasterCommitRef.current = null;
    try {
      await store.updateLightingSettings({ grandMaster: value });
    } catch (error) {
      reportError(error, "Grand master update failed.");
    }
  });

  const handleGrandMasterChange = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(value)));
      setGrandMasterDraft(clamped);
      if (grandMasterCommitRef.current !== null) {
        window.clearTimeout(grandMasterCommitRef.current);
      }
      grandMasterCommitRef.current = window.setTimeout(() => {
        void commitGrandMaster(clamped);
      }, 200);
    },
    [commitGrandMaster]
  );

  const handleEmergencyCut = useEffectEvent(async () => {
    startBusy("lighting-blackout");
    try {
      await store.setLightingAllPower(false);
      toast.push({ message: previewMode ? "Preview fixtures cut." : "All fixtures cut.", tone: "ok" });
    } catch (error) {
      reportError(error, "Lighting blackout failed.");
    } finally {
      finishBusy("lighting-blackout");
    }
  });

  const requestEmergencyCut = useCallback(() => {
    setConfirmCutAllOpen(true);
  }, []);

  const handleToggleAllPower = useEffectEvent(async (on: boolean) => {
    startBusy("lighting-master-toggle");
    try {
      await store.setLightingAllPower(on);
      toast.push({
        message: previewMode ? `Preview fixtures ${on ? "on" : "off"}.` : on ? "Lighting resumed." : "Lighting paused.",
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Lighting master toggle failed.");
    } finally {
      finishBusy("lighting-master-toggle");
    }
  });

  const handleSaveScene = useEffectEvent(async (overrideName?: string) => {
    startBusy("scene-create");
    try {
      // The button onClick paths (scene-rail head, "+ New scene" tile,
      // inspector save) wire this handler directly, so React passes a
      // SyntheticEvent as the first arg. Treat anything non-string as "no
      // override" instead of calling .trim() on the event and crashing.
      const trimmed = typeof overrideName === "string" ? overrideName.trim() : "";
      const name = trimmed || `Scene ${scenes.length + 1}`;
      const result = asRecord(await store.createLightingScene({ name }));
      const created = asRecord(result?.scene);
      const createdId = typeof created?.id === "string" ? created.id : null;
      if (createdId) {
        // I6 — push the newly-saved scene into the palette recents ring so
        // it surfaces at the top of the empty-query palette immediately.
        palette.pushRecent(`lighting:recall:${createdId}`);
        // Pull the fresh scene from the result so we render its true saved
        // state (the snapshot may not have updated yet).
        const fixtureStatesRecord = Array.isArray(created?.fixtureStates) ? created!.fixtureStates : [];
        const dataUri = renderSceneThumbnailDataUri({
          fixtures,
          fixtureStates: fixtureStatesRecord as unknown as LightingSceneSnapshot["fixtureStates"],
        });
        const next = withSceneThumbUpserted(sceneThumbs, createdId, dataUri);
        await store.setLightingSceneThumbs(next);
        setLastSavedAt(new Date());
        // Push undo: deleting the just-created scene. Engine has no API to
        // recreate a scene with an explicit fixtureStates snapshot, so this
        // entry is single-use — once undone it disappears (no redo path).
        let currentSceneId = createdId;
        const sceneName = name;
        const cachedDataUri = dataUri;
        undoStack.push({
          label: `Save scene ${sceneName}`,
          undo: async () => {
            await store.deleteLightingScene(currentSceneId);
            const cleared = withSceneThumbRemoved(sceneThumbs, currentSceneId);
            await store.setLightingSceneThumbs(cleared);
          },
          redo: async () => {
            const redoResult = asRecord(await store.createLightingScene({ name: sceneName }));
            const redoCreated = asRecord(redoResult?.scene);
            const newId = typeof redoCreated?.id === "string" ? redoCreated.id : null;
            if (newId) {
              currentSceneId = newId;
              const refreshed = withSceneThumbUpserted(sceneThumbs, newId, cachedDataUri);
              await store.setLightingSceneThumbs(refreshed);
            }
          },
        });
      }
      toast.push({
        tone: "ok",
        message: String(result?.summary ?? `Scene '${name}' saved.`),
        action: createdId
          ? {
              label: "Undo",
              onClick: () => void undoStack.undo().then((outcome) => pushUndoOutcomeToast(toast, outcome)),
            }
          : undefined,
      });
    } catch (error) {
      reportError(error, "Scene save failed.");
    } finally {
      finishBusy("scene-create");
    }
  });

  const handleResaveScene = useEffectEvent(async () => {
    if (!activeScene) return;
    startBusy("scene-resave");
    try {
      const sceneId = activeScene.id;
      const sceneName = activeScene.name;
      // Use the new lighting.scene.update IPC with captureCurrentState — no
      // more delete+recreate dance, scene id stays stable so any persisted
      // references (sceneThumbs cache, lastRecalled flag) keep working.
      await store.updateLightingScene({ sceneId, captureCurrentState: true });
      // Refresh the cached thumbnail with the freshly captured state.
      const liveStates = fixtures.map((fixture) => ({
        fixtureId: fixture.id,
        intensity: fixture.intensity,
        cct: fixture.cct,
        on: fixture.on,
      })) as unknown as LightingSceneSnapshot["fixtureStates"];
      const dataUri = renderSceneThumbnailDataUri({
        fixtures,
        fixtureStates: liveStates,
      });
      const nextThumbs = withSceneThumbUpserted(sceneThumbs, sceneId, dataUri);
      await store.setLightingSceneThumbs(nextThumbs);
      setLastSavedAt(new Date());
      toast.push({ message: `Scene '${sceneName}' updated.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene re-save failed.");
    } finally {
      finishBusy("scene-resave");
    }
  });

  const handleDeleteScene = useEffectEvent(async (overrideSceneId?: string) => {
    // Default to the active scene (Inspector → Delete path); right-click
    // delete from a non-active tile passes the tile's id explicitly.
    const sceneId = overrideSceneId ?? activeScene?.id ?? null;
    if (!sceneId) return;
    const target = scenes.find((scene) => scene.id === sceneId) ?? null;
    const sceneName = target?.name ?? "Scene";
    startBusy("scene-delete");
    try {
      await store.deleteLightingScene(sceneId);
      const next = withSceneThumbRemoved(sceneThumbs, sceneId);
      await store.setLightingSceneThumbs(next);
      toast.push({ message: `Scene '${sceneName}' deleted.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene delete failed.");
    } finally {
      finishBusy("scene-delete");
    }
  });

  const handleReorderScene = useEffectEvent(async (sceneId: string, beforeSceneId: string | null) => {
    const busyKey = `scene-reorder:${sceneId}`;
    startBusy(busyKey);
    try {
      await store.reorderLightingScene(sceneId, beforeSceneId);
    } catch (error) {
      reportError(error, "Scene reorder failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handlePinScene = useEffectEvent(async (sceneId: string, pinned: boolean) => {
    const busyKey = `scene-pin:${sceneId}`;
    startBusy(busyKey);
    try {
      await store.pinLightingScene(sceneId, pinned);
      toast.push({ message: pinned ? "Scene pinned." : "Scene unpinned.", tone: "ok" });
    } catch (error) {
      reportError(error, pinned ? "Scene pin failed." : "Scene unpin failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleRecallScene = useEffectEvent(async (sceneId: string) => {
    if (uiMode === "patch") {
      toast.push({
        message: "Patch mode is active. Exit patch mode before recalling a scene.",
        tone: "info",
      });
      return;
    }
    // Wave 28a / I6 — push the scene into the cross-workspace ⌘K recents
    // ring so the palette's empty-query view surfaces recent recalls. Done
    // here (not only when invoked via palette) so rail-driven recalls also
    // populate recents.
    palette.pushRecent(`lighting:recall:${sceneId}`);
    // Wave 30b — click is the user's commitment to a scene; cancel any
    // hover preview synchronously so the inspector doesn't show a stale
    // hovered scene during the 200 ms mouseleave grace window after the
    // recall flips activeSceneId.
    cancelHoverPreviewSync();
    // Show the scene in the inspector immediately — even if the recall IPC
    // is rejected by the engine (e.g. pre-probe state), the operator still
    // sees what the scene contains. The recall IPC drives the actual rig.
    setInspectorSelectedSceneId(sceneId);
    if (!bridgeReachable && !previewMode) {
      // Skip the IPC entirely when the bridge is unreachable — the engine
      // would just reject it. Surface a single non-error toast so the
      // operator knows recall is preview-only and not a failed action.
      toast.push({
        message: "Bridge unreachable — showing scene contents only.",
        tone: "info",
      });
      return;
    }
    const busyKey = `scene:${sceneId}`;
    startBusy(busyKey);
    try {
      await store.recallLightingScene(sceneId, previewMode ? 0 : recallFadeMs);
      toast.push({
        message: previewMode
          ? "Scene loaded into preview."
          : recallFadeMs > 0
            ? `Scene recalled with ${formatRecallFade(recallFadeMs)} fade.`
            : "Scene recalled.",
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Scene recall failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  // Per plan §3.3: prefer the cached thumb; fall back to a live render for
  // scenes without an entry yet. The fallback runs on render — write-backs
  // only happen on user-initiated save / re-save / delete to avoid an
  // infinite snapshot ↔ effect loop when the transport doesn't echo the
  // upserted blob back into the next snapshot.
  const displayedSceneThumbs = useMemo(() => {
    if (scenes.length === 0) return sceneThumbs;
    const result: Record<string, string> = { ...sceneThumbs };
    for (const scene of scenes) {
      if (result[scene.id]) continue;
      result[scene.id] = renderSceneThumbnailDataUri({
        fixtures: liveFixtures,
        fixtureStates: scene.fixtureStates,
      });
    }
    return result;
  }, [scenes, sceneThumbs, liveFixtures]);

  // Per-id rename-busy set surfaced to the rail so each scene tile shows the
  // InlineRename busy treatment only for its own in-flight commit (parallel
  // renames don't dim every tile).
  const renamingSceneIds = useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>();
    for (const scene of scenes) {
      if (busyActions.has(`scene-rename:${scene.id}`)) ids.add(scene.id);
    }
    return ids;
  }, [busyActions, scenes]);

  // Wave 28a — register lighting actions on the cross-workspace ⌘K palette.
  // Re-registers when the scene list / mode-relevant flags change so per-scene
  // recall actions stay current and the `when` predicates capture fresh state.
  // Handlers are useEffectEvent and intentionally not in the dep array.
  useEffect(() => {
    const inPatchMode = uiMode === "patch";
    return palette.register([
      {
        id: "lighting:toggle-patch",
        label: inPatchMode ? "Exit patch mode" : "Enter patch mode",
        group: "Lighting",
        keywords: ["patch", "dmx", "address"],
        shortcut: "P",
        action: () => handleTogglePatch(),
        when: () => !previewMode,
      },
      {
        id: "lighting:toggle-preview",
        label: previewMode ? (previewDirty ? "Exit preview mode..." : "Exit preview mode") : "Enter preview mode",
        group: "Lighting",
        keywords: ["preview", "blind", "offline", "edit"],
        shortcut: "B",
        action: () => void handleTogglePreview(),
        when: () => !inPatchMode,
      },
      {
        id: "lighting:save-changes",
        label: "Save changes to active scene",
        group: "Scene",
        keywords: ["save", "update", "commit"],
        shortcut: "S",
        action: () => void handleResaveScene(),
        when: () => effectiveSceneModified && !inPatchMode,
      },
      {
        id: "lighting:save-as-new",
        label: "Save as new scene…",
        group: "Scene",
        keywords: ["save", "new", "duplicate"],
        shortcut: "⇧S",
        action: () => setSaveSceneAsOpen(true),
        when: () => !inPatchMode,
      },
      {
        id: "lighting:add-fixture",
        label: "Add fixture…",
        group: "Lighting",
        keywords: ["add", "fixture", "create", "new"],
        action: () => requestAddFixture(),
        when: () => !previewMode,
      },
      {
        id: "lighting:open-dmx-monitor",
        label: "Open full DMX monitor",
        group: "Lighting",
        keywords: ["dmx", "monitor", "channels"],
        shortcut: "⌘⇧M",
        action: () => setDmxMonitorOpen(true),
      },
      {
        id: "lighting:cut-all",
        label: "Cut all fixtures (blackout)",
        group: "Lighting",
        keywords: ["cut", "blackout", "off", "kill"],
        action: () => requestEmergencyCut(),
        when: () => bridgeReachable,
      },
      ...palettes.map<PaletteAction>((entry) => ({
        id: `lighting:palette:${entry.id}`,
        label: `Apply palette: ${entry.name}`,
        group: "Palettes",
        keywords: [entry.kind, "palette", entry.name],
        action: () => void handleApplyPalette(entry.id, Array.from(selectedFixtureIds)),
        when: () => !inPatchMode && selectedFixtureIds.size > 0,
      })),
      ...scenes.map<PaletteAction>((scene) => ({
        id: `lighting:recall:${scene.id}`,
        label: `Recall scene: ${scene.name}`,
        group: "Scene",
        keywords: ["recall", "scene"],
        action: () => void handleRecallScene(scene.id),
        when: () => !inPatchMode,
      })),
    ]);
  }, [
    palette,
    scenes,
    palettes,
    selectedFixtureIds,
    uiMode,
    effectiveSceneModified,
    bridgeReachable,
    handleTogglePatch,
    handleTogglePreview,
    handleResaveScene,
    requestAddFixture,
    requestEmergencyCut,
    handleRecallScene,
    handleApplyPalette,
    previewDirty,
    previewMode,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteQuickOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setPaletteQuickOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleToggleGroupPower = useEffectEvent(async (groupId: string, on: boolean) => {
    const busyKey = `group:${groupId}`;
    startBusy(busyKey);
    try {
      await store.setLightingGroupPower(groupId, on);
      toast.push({ message: `Group ${on ? "on" : "off"}.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Group power update failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleToggleFixturePower = useEffectEvent(async (fixtureId: string, on: boolean) => {
    const busyKey = `fixture-power:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, on });
    } catch (error) {
      reportError(error, "Fixture power update failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleIntensityCommit = useEffectEvent(async (fixtureId: string, intensity: number) => {
    const busyKey = `fixture-intensity:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, intensity });
    } catch (error) {
      reportError(error, "Intensity update failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleCctCommit = useEffectEvent(async (fixtureId: string, cct: number) => {
    const busyKey = `fixture-cct:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, cct });
    } catch (error) {
      reportError(error, "CCT update failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handlePatchCommit = useEffectEvent(async (fixtureId: string, dmxStartAddress: number) => {
    const busyKey = `fixture-patch:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, dmxStartAddress });
      // Auto-advance to the next unpaired fixture (dmxStartAddress < 1).
      // Excludes the just-patched id since the snapshot may not have caught
      // up. If none remain, exit patch mode.
      const remaining = fixtures.filter((candidate) => candidate.id !== fixtureId && candidate.dmxStartAddress < 1);
      if (remaining.length > 0) {
        const next = remaining[0]!;
        try {
          await store.updateLightingSettings({ selectedFixtureId: next.id });
          setExtraSelectedFixtureIds(new Set());
          toast.push({ message: `Patched. Now patching ‘${next.name}’.`, tone: "ok" });
        } catch (error) {
          reportError(error, "Auto-advance to next fixture failed.");
        }
      } else {
        setUiMode("recall");
        toast.push({ message: "All fixtures patched.", tone: "ok" });
      }
    } catch (error) {
      reportError(error, "Patch update failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleIdentifyBurst = useEffectEvent(async (fixtureId: string, fixtureName: string) => {
    // Mirror the engine burst on the plot marker: 1.2 s window matches the
    // identify.rs default duration_ms.
    setIdentifyingIds((prev) => {
      const next = new Set(prev);
      next.add(fixtureId);
      return next;
    });
    window.setTimeout(() => {
      setIdentifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(fixtureId);
        return next;
      });
    }, 1200);
    const busyKey = `fixture-identify:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.identifyLightingFixture(fixtureId);
      toast.push({ message: `Identify burst sent to '${fixtureName}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Identify burst failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  // Wave 29 — Highlight toggle. Selection-driven; pre-clears any active
  // Solo so the engine's mutual-exclusion guard doesn't reject the request.
  // Operator press while highlight is active = clear (toggle).
  const handleToggleHighlight = useEffectEvent(async () => {
    if (previewMode) {
      toast.push({ message: "Exit preview to use live Highlight.", tone: "info" });
      return;
    }
    if (highlightActive) {
      startBusy("highlight");
      try {
        await store.highlightLightingFixtures([], "off");
      } catch (error) {
        reportError(error, "Failed to clear highlight.");
      } finally {
        finishBusy("highlight");
      }
      return;
    }
    if (selectedFixtureIds.size === 0) {
      toast.push({ message: "Select fixtures to enable Highlight.", tone: "info" });
      return;
    }
    startBusy("highlight");
    try {
      if (soloActive) {
        await store.highlightLightingFixtures([], "off");
      }
      const ids = Array.from(selectedFixtureIds);
      await store.highlightLightingFixtures(ids, "highlight");
      toast.push({
        message: `Highlight on ${ids.length} fixture${ids.length === 1 ? "" : "s"}.`,
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Highlight failed.");
    } finally {
      finishBusy("highlight");
    }
  });

  // Wave 29 — Solo toggle. Symmetric to Highlight.
  const handleToggleSolo = useEffectEvent(async () => {
    if (previewMode) {
      toast.push({ message: "Exit preview to use live Solo.", tone: "info" });
      return;
    }
    if (soloActive) {
      startBusy("solo");
      try {
        await store.highlightLightingFixtures([], "off");
      } catch (error) {
        reportError(error, "Failed to clear solo.");
      } finally {
        finishBusy("solo");
      }
      return;
    }
    if (selectedFixtureIds.size === 0) {
      toast.push({ message: "Select fixtures to enable Solo.", tone: "info" });
      return;
    }
    startBusy("solo");
    try {
      if (highlightActive) {
        await store.highlightLightingFixtures([], "off");
      }
      const ids = Array.from(selectedFixtureIds);
      await store.highlightLightingFixtures(ids, "solo");
      toast.push({
        message: `Solo on ${ids.length} fixture${ids.length === 1 ? "" : "s"}.`,
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Solo failed.");
    } finally {
      finishBusy("solo");
    }
  });

  // Wave 29 — Find sequence. Engine pre-schedules N staggered bursts; the
  // frontend mirrors each slot on the plot marker pulse-ring at the same
  // offset so the operator's eye tracks the active fixture. Step / duration
  // chosen to clear in <2 s for a typical 3-fixture key triangle.
  const handleIdentifyFind = useEffectEvent(async () => {
    if (previewMode) {
      toast.push({ message: "Exit preview to use live Find.", tone: "info" });
      return;
    }
    if (selectedFixtureIds.size === 0) {
      toast.push({ message: "Select fixtures to enable Find.", tone: "info" });
      return;
    }
    const ids = Array.from(selectedFixtureIds);
    const stepMs = 500;
    const durationMs = 400;
    clearFindSequenceTimers();
    startBusy("identify-find");
    try {
      await store.startLightingIdentifySequence(ids, stepMs, durationMs);
      toast.push({
        message: `Finding ${ids.length} fixture${ids.length === 1 ? "" : "s"}…`,
        tone: "ok",
      });
      ids.forEach((id, idx) => {
        const startHandle = window.setTimeout(() => {
          setIdentifyingIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }, idx * stepMs);
        const stopHandle = window.setTimeout(
          () => {
            setIdentifyingIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
          idx * stepMs + durationMs
        );
        findSequenceTimersRef.current.push(startHandle, stopHandle);
      });
    } catch (error) {
      reportError(error, "Identify sequence failed.");
    } finally {
      finishBusy("identify-find");
    }
  });

  // Wave 29 — Esc / workspace-switch cleanup. Clears highlight + solo
  // overlays in the engine and cancels any in-flight Find sequence pulse
  // timers. Each IPC is gated on whether there's anything to clear so
  // a quiet Esc doesn't burn round-trips. useEffectEvent semantics keep
  // the gate readings fresh.
  const clearOverlaysAndSequence = useEffectEvent(async () => {
    const hadTimers = findSequenceTimersRef.current.length > 0;
    clearFindSequenceTimers();
    if (identifyingIds.size > 0) {
      setIdentifyingIds(() => new Set());
    }
    if (highlightActive || soloActive) {
      try {
        await store.highlightLightingFixtures([], "off");
      } catch (error) {
        reportError(error, "Failed to clear overlay.");
      }
    }
    if (hadTimers) {
      try {
        await store.clearLightingIdentifyBursts();
      } catch (error) {
        reportError(error, "Failed to clear identify bursts.");
      }
    }
  });

  // Workspace unmount = the operator switched workspaces. Fire-and-forget
  // overlay clear so the engine doesn't carry highlight / solo / find
  // state into the next session.
  useEffect(() => {
    return () => {
      void clearOverlaysAndSequence();
    };
  }, []);

  const handleDeleteFixture = useEffectEvent(async (fixtureId: string) => {
    // Snapshot the live fixture before deletion so undo can recreate it.
    // groupId / spatial / beam-angle are restored via a follow-up update IPC
    // because createLightingFixture only takes the create-time fields.
    const target = fixtures.find((fixture) => fixture.id === fixtureId);
    const busyKey = `fixture-delete:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.deleteLightingFixture(fixtureId);
      // Clear the selection if we just deleted the selected fixture so the
      // inspector falls back to the scene tab.
      if (persistedSelectedFixtureId === fixtureId) {
        await store.updateLightingSettings({ selectedFixtureId: null });
      }
      if (target) {
        const snapshot = { ...target };
        let currentId = fixtureId;
        undoStack.push({
          label: `Delete fixture ${snapshot.name}`,
          undo: async () => {
            const result = asRecord(
              await store.createLightingFixture({
                name: snapshot.name,
                type: snapshot.type,
                dmxStartAddress: snapshot.dmxStartAddress > 0 ? snapshot.dmxStartAddress : 1,
                groupId: snapshot.groupId ?? undefined,
              })
            );
            const created = asRecord(result?.fixture);
            const newId = typeof created?.id === "string" ? created.id : null;
            if (newId) {
              currentId = newId;
              // spatialRotation isn't yet on LightingFixtureUpdateRequest in
              // the TS types (Wave 9 will add it); seeded fixtures all have
              // rotation 0 today so the omission doesn't lose data.
              await store.updateLightingFixture({
                fixtureId: newId,
                intensity: snapshot.intensity,
                cct: snapshot.cct,
                on: snapshot.on,
                spatialX: snapshot.spatialX ?? null,
                spatialY: snapshot.spatialY ?? null,
                rigZ: snapshot.rigZ ?? null,
                beamAngleDegrees: snapshot.beamAngleDegrees ?? null,
              });
            }
          },
          redo: async () => {
            await store.deleteLightingFixture(currentId);
          },
        });
      }
      toast.push({
        message: target ? `Fixture '${target.name}' deleted.` : "Fixture deleted.",
        tone: "ok",
        action: target
          ? {
              label: "Undo",
              onClick: () => void undoStack.undo().then((outcome) => pushUndoOutcomeToast(toast, outcome)),
            }
          : undefined,
      });
    } catch (error) {
      reportError(error, "Fixture delete failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleBulkTogglePower = useEffectEvent(async (fixtureIds: readonly string[], on: boolean) => {
    startBusy("fixture-bulk-power");
    try {
      await Promise.all(fixtureIds.map((fixtureId) => store.updateLightingFixture({ fixtureId, on })));
      toast.push({
        message: `Set ${fixtureIds.length} fixtures ${on ? "on" : "off"}.`,
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Bulk power update failed.");
    } finally {
      finishBusy("fixture-bulk-power");
    }
  });

  // Wave 27 — bulk slider drag-shift + delta-input both produce per-fixture
  // value arrays. The legacy "flatten to one value" handler is gone; callers
  // map their target value through the array shape.
  const handleBulkIntensityValues = useEffectEvent(
    async (values: ReadonlyArray<{ fixtureId: string; value: number }>) => {
      startBusy("fixture-bulk-intensity");
      try {
        await Promise.all(
          values.map(({ fixtureId, value }) => store.updateLightingFixture({ fixtureId, intensity: value }))
        );
      } catch (error) {
        reportError(error, "Bulk intensity update failed.");
      } finally {
        finishBusy("fixture-bulk-intensity");
      }
    }
  );

  const handleBulkCctValues = useEffectEvent(async (values: ReadonlyArray<{ fixtureId: string; value: number }>) => {
    startBusy("fixture-bulk-cct");
    try {
      await Promise.all(values.map(({ fixtureId, value }) => store.updateLightingFixture({ fixtureId, cct: value })));
    } catch (error) {
      reportError(error, "Bulk CCT update failed.");
    } finally {
      finishBusy("fixture-bulk-cct");
    }
  });

  const handleFixtureSpatialCommit = useEffectEvent(
    async (
      fixtureId: string,
      partial: {
        spatialX?: number | null;
        spatialY?: number | null;
        rigZ?: number | null;
        beamAngleDegrees?: number | null;
        spatialRotation?: number;
      }
    ) => {
      const busyKey = `fixture-spatial:${fixtureId}`;
      startBusy(busyKey);
      try {
        await store.updateLightingFixture({ fixtureId, ...partial });
      } catch (error) {
        reportError(error, "Fixture spatial update failed.");
      } finally {
        finishBusy(busyKey);
      }
    }
  );

  const handleAssignFixtureGroup = useEffectEvent(async (fixtureId: string, groupId: string | null) => {
    const busyKey = `fixture-group:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, groupId });
      toast.push({
        message: groupId ? "Fixture moved to group." : "Fixture removed from group.",
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Fixture group assignment failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleInspectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setActiveTabOverride("group");
  }, []);

  const handleFixtureNudge = useEffectEvent(async (deltaXMeters: number, deltaYMeters: number) => {
    if (previewMode) {
      toast.push({ message: "Exit preview to move fixtures on the plot.", tone: "info" });
      return;
    }
    const fixture = persistedSelectedFixtureId
      ? fixtures.find((candidate) => candidate.id === persistedSelectedFixtureId)
      : null;
    if (!fixture) return;
    const baseX = fixture.spatialX ?? 0;
    const baseY = fixture.spatialY ?? 0;
    // Round to 0.05 m so float drift doesn't accumulate across many nudges.
    const nextX = Math.round((baseX + deltaXMeters) * 20) / 20;
    const nextY = Math.round((baseY + deltaYMeters) * 20) / 20;
    void handleFixtureSpatialCommit(fixture.id, { spatialX: nextX, spatialY: nextY });
  });

  const reportUndoOutcome = useEffectEvent((outcome: UndoOutcome, kind: "Undo" | "Redo") => {
    switch (outcome.kind) {
      case "ok":
        toast.push({
          message: `${kind === "Undo" ? "Undid" : "Redid"} ‘${outcome.label}’ · ${kind === "Undo" ? "⌘⇧Z to redo" : "⌘Z to undo"}`,
          tone: "ok",
        });
        break;
      case "rejected":
        toast.push({
          message: `Cannot ${kind.toLowerCase()} ‘${outcome.label}’: ${outcome.reason}.`,
          tone: "info",
        });
        break;
      case "error":
        reportError(outcome.error, `${kind} of ‘${outcome.label}’ failed.`);
        break;
      case "noop":
        // Nothing to undo / redo — silent.
        break;
    }
  });

  const triggerUndo = useEffectEvent(async () => {
    startBusy("undo");
    try {
      const outcome = await undoStack.undo();
      reportUndoOutcome(outcome, "Undo");
    } finally {
      finishBusy("undo");
    }
  });

  const triggerRedo = useEffectEvent(async () => {
    startBusy("redo");
    try {
      const outcome = await undoStack.redo();
      reportUndoOutcome(outcome, "Redo");
    } finally {
      finishBusy("redo");
    }
  });

  // ---------------- keyboard shortcuts ----------------

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;

      // Undo / redo first because they require the modifier keys we filter
      // out for the un-modified shortcuts below.
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.altKey && event.key.toLowerCase() === "z") {
        if (event.shiftKey) {
          void triggerRedo();
        } else {
          void triggerUndo();
        }
        event.preventDefault();
        return;
      }

      // ⌘⇧M / Ctrl+Shift+M opens the full DMX monitor. Plain ⌘M is
      // reserved by macOS / Tauri for window minimise so the modal uses the
      // shifted variant.
      if (modifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m") {
        setDmxMonitorOpen(true);
        event.preventDefault();
        return;
      }

      // Wave 31 — I7 view bookmarks. ⌘⇧1/2/3 saves the current viewport to
      // the matching slot; Shift+1/2/3 recalls. Use `event.code` instead of
      // `event.key` because Shift+digit produces "!@#" on standard layouts.
      // Modifier+Shift+digit lands here BEFORE ⌘+digit-only collisions
      // because we explicitly require Shift on the save path.
      if (modifier && event.shiftKey && !event.altKey) {
        const slot = event.code === "Digit1" ? 0 : event.code === "Digit2" ? 1 : event.code === "Digit3" ? 2 : null;
        if (slot !== null) {
          stagePlotViewport.saveViewBookmark(slot as ViewBookmarkSlot);
          toast.push({ message: `Saved view ${slot + 1}.`, tone: "ok" });
          event.preventDefault();
          return;
        }
      }

      // Arrow-key nudge: requires a selected fixture; default ±0.1 m, hold
      // Shift for ±0.5 m (matching the snap grid). Modifier-free arrows are
      // commonly used by browsers/forms — gating on a fixture being selected
      // keeps it scoped.
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        persistedSelectedFixtureId &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        const step = event.shiftKey ? 0.5 : 0.1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (dx !== 0 || dy !== 0) {
          void handleFixtureNudge(dx, dy);
          event.preventDefault();
        }
        return;
      }

      // ⌘A / Ctrl+A → select every fixture (multi-select). isEditableTarget
      // gate above keeps native text-selection in inputs intact.
      if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const all = new Set(fixtures.map((fixture) => fixture.id));
        setExtraSelectedFixtureIds(all);
        if (!persistedSelectedFixtureId && fixtures.length > 0) {
          void store.updateLightingSettings({ selectedFixtureId: fixtures[0]!.id });
        }
        return;
      }

      // ⌘F / Ctrl+F → focus the toolbar search field. Shifted variant left
      // alone so the OS Find Bar binding still resolves elsewhere.
      if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        return;
      }

      // ⌘S / Ctrl+S → save changes when drift exists, otherwise no-op with
      // feedback. ⌘⇧S → always opens the "Save as new" dialog with rename.
      if (modifier && !event.altKey && event.key.toLowerCase() === "s") {
        if (event.shiftKey) {
          setSaveSceneAsOpen(true);
        } else if (effectiveSceneModified && activeScene) {
          void handleResaveScene();
        } else {
          toast.push({
            message: activeScene ? "Already saved." : "No active scene to save changes to.",
            tone: "info",
          });
        }
        event.preventDefault();
        return;
      }

      // Wave 29 — Shift+H toggles Solo, Shift+I starts the Find sequence.
      // Wave 31 — Shift+1/2/3 recalls the matching view bookmark (silently
      // no-ops on empty slots). Use `event.code` for digits because Shift
      // produces "!@#" with the default key.
      // These need to run before the modifier-shortcircuit below since they
      // depend on the Shift modifier.
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey) {
        if (event.key.toLowerCase() === "h") {
          event.preventDefault();
          void handleToggleSolo();
          return;
        }
        if (event.key.toLowerCase() === "i") {
          event.preventDefault();
          void handleIdentifyFind();
          return;
        }
        const bookmarkSlot =
          event.code === "Digit1" ? 0 : event.code === "Digit2" ? 1 : event.code === "Digit3" ? 2 : null;
        if (bookmarkSlot !== null) {
          stagePlotViewport.recallViewBookmark(bookmarkSlot as ViewBookmarkSlot);
          event.preventDefault();
          return;
        }
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === "p") {
        handleTogglePatch();
        event.preventDefault();
      } else if (event.key.toLowerCase() === "b") {
        void handleTogglePreview();
        event.preventDefault();
      } else if (event.key.toLowerCase() === "t") {
        setRecallFadeMs((current) => {
          const next = RECALL_FADE_PRESETS_MS.find((preset) => preset > current) ?? RECALL_FADE_PRESETS_MS[0];
          const previewSceneName = hoverPreviewSceneId
            ? (scenes.find((scene) => scene.id === hoverPreviewSceneId)?.name ?? null)
            : null;
          toast.push({
            message: previewSceneName
              ? `Recall fade ${formatRecallFade(next)} for ${previewSceneName}.`
              : `Recall fade ${formatRecallFade(next)}.`,
            tone: "info",
          });
          return next;
        });
        event.preventDefault();
      } else if (event.key.toLowerCase() === "h") {
        // Wave 29 — H toggles Highlight on the current selection.
        event.preventDefault();
        void handleToggleHighlight();
      } else if (event.key.toLowerCase() === "s") {
        // Smart S: when drift exists on the active scene, save changes.
        // Otherwise create a new scene with the autoname for fast capture.
        if (effectiveSceneModified && activeScene) {
          void handleResaveScene();
        } else {
          void handleSaveScene();
        }
        event.preventDefault();
      } else if (/^[1-9]$/.test(event.key)) {
        // Quick scene recall — number key matches the rail's positional
        // index. Falls through silently when fewer than N scenes exist.
        const idx = Number.parseInt(event.key, 10) - 1;
        if (idx < scenes.length) {
          event.preventDefault();
          void handleRecallScene(scenes[idx]!.id);
        }
      } else if (event.key === "Escape") {
        setSelectedGroupId(null);
        void handleSelectFixture(null);
        // Wave 29 — Esc also clears any active Highlight / Solo overlay
        // and cancels an in-flight Find sequence. The cleanup function
        // reads latest overlay state via useEffectEvent semantics so
        // calling it unconditionally avoids stale-closure traps; the
        // engine no-ops when there's nothing to clear.
        void clearOverlaysAndSequence();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeScene,
    fixtures,
    handleFixtureNudge,
    handleTogglePatch,
    handleTogglePreview,
    handleRecallScene,
    handleResaveScene,
    handleSaveScene,
    handleSelectFixture,
    hoverPreviewSceneId,
    effectiveSceneModified,
    persistedSelectedFixtureId,
    scenes,
    stagePlotViewport,
    store,
    triggerRedo,
    triggerUndo,
  ]);

  const lastSavedLabel = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : undefined;

  if (!lightingSnapshot) {
    return (
      <div className={styles.shell}>
        <div className={styles.connectingState} role="status" aria-live="polite">
          <p className={styles.connectingTitle}>Connecting to lighting engine…</p>
          <p className={styles.connectingHint}>
            Loading the rust engine snapshot. This usually takes a fraction of a second.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <LightingToolbar
        bridgeUniverse={bridgeUniverse}
        bridgeIp={bridgeIp}
        bridgeReachable={bridgeReachable}
        fixtureCount={fixtures.length}
        fixtureOnCount={fixtures.filter((fixture) => fixture.on).length}
        groupCount={groups.length}
        sceneCount={scenes.length}
        recallFadeMs={recallFadeMs}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRecallFadeMsChange={setRecallFadeMs}
        patchMode={uiMode === "patch"}
        onTogglePatch={handleTogglePatch}
        previewMode={previewMode}
        previewDirty={previewDirty}
        onTogglePreview={() => void handleTogglePreview()}
        onAddFixture={requestAddFixture}
        hasSelection={selectedFixtureIds.size > 0}
        highlightActive={highlightActive}
        soloActive={soloActive}
        onToggleHighlight={() => void handleToggleHighlight()}
        onToggleSolo={() => void handleToggleSolo()}
        onIdentifyFind={() => void handleIdentifyFind()}
      />

      <LightingBridgeBanner reachable={bridgeReachable} bridgeIp={bridgeIp} universe={bridgeUniverse} />

      {previewMode ? (
        <PreviewBanner
          dirty={previewDirty}
          targetSceneName={activeScene?.name ?? null}
          busy={
            busyActions.has("preview-mode") || busyActions.has("preview-discard") || busyActions.has("scene-resave")
          }
          onSave={() => void handleResaveScene()}
          onDiscard={() => void handleDiscardPreview()}
          onExit={requestExitPreview}
        />
      ) : null}

      <div
        className={`${styles.body} ${columns.isResizing ? styles.bodyResizing : ""}`}
        style={{
          ["--lighting-rail-width" as string]: `${columns.railWidth}px`,
          ["--lighting-inspector-width" as string]: `${columns.inspectorWidth}px`,
        }}
      >
        <LightingRail
          grandMaster={grandMasterDraft}
          masterEnabled={bridgeReachable}
          bridgeReachable={bridgeReachable}
          fixtureOnCount={fixtures.filter((fixture) => fixture.on).length}
          fixtureTotal={fixtures.length}
          onGrandMasterChange={handleGrandMasterChange}
          onEmergencyCut={requestEmergencyCut}
          onToggleAllPower={handleToggleAllPower}
          scenes={scenes}
          activeSceneId={liveActiveSceneId}
          modifiedSceneId={modifiedSceneId}
          previewSceneId={previewMode ? previewTargetSceneId : null}
          previewMode={previewMode}
          sceneThumbs={displayedSceneThumbs}
          onRecallScene={handleRecallScene}
          onSaveScene={handleSaveScene}
          onReorderScene={handleReorderScene}
          onPinScene={handlePinScene}
          onRenameScene={handleRenameScene}
          renamingSceneIds={renamingSceneIds}
          onRequestDeleteScene={(id, name) => setConfirmDeleteScene({ id, name })}
          onSetSceneColor={(sceneId, colorIndex) => void handleSetSceneColor(sceneId, colorIndex)}
          onHoverPreviewScene={handleHoverPreview}
          onHoverPreviewSceneClear={handleHoverPreviewClear}
          groups={railGroupEntries}
          onToggleGroupPower={handleToggleGroupPower}
          onReorderGroup={handleReorderGroup}
          onSetGroupColor={(groupId, colorIndex) => void handleSetGroupColor(groupId, colorIndex)}
          searchQuery={searchQuery}
          patchMode={uiMode === "patch"}
          isSceneModified={!previewMode && isSceneModified}
          onResaveScene={handleResaveScene}
          onRevertScene={activeSceneId ? () => void handleRecallScene(activeSceneId) : undefined}
          onClearSearch={() => setSearchQuery("")}
          onCreateGroup={() => setCreateGroupOpen(true)}
          onInspectGroup={handleInspectGroup}
          onRequestRenameGroup={(groupId) => {
            handleInspectGroup(groupId);
            requestInlineRename("group", groupId);
          }}
          onRequestDeleteGroup={(groupId, groupName) => setConfirmDeleteGroup({ id: groupId, name: groupName })}
        />

        <ColumnResizer ariaLabel="Resize scene rail" onPointerDown={columns.startResize("rail")} />

        <main className={styles.stage}>
          <StagePlot
            fixtures={fixtures}
            liveFixtures={liveFixtures}
            selectedFixtureId={selectedFixture?.id ?? null}
            selectedFixtureIds={selectedFixtureIds}
            patchMode={uiMode === "patch"}
            previewMode={previewMode}
            activeSceneName={activeScene?.name}
            isSceneModified={effectiveSceneModified}
            bridgeReachable={bridgeReachable}
            searchQuery={searchQuery}
            identifyingFixtureIds={identifyingIds}
            highlightOverlayFixtureIds={overlayFixtureIds}
            onSelectFixture={(id, options) => void handleSelectFixture(id, options ?? {})}
            onPositionCommit={
              previewMode
                ? undefined
                : (id, xMeters, yMeters) =>
                    void handleFixtureSpatialCommit(id, { spatialX: xMeters, spatialY: yMeters })
            }
            onRequestRenameFixture={(id) => {
              void handleSelectFixture(id, {});
              requestInlineRename("fixture", id);
            }}
            onIdentifyFixture={(id, name) => void handleIdentifyBurst(id, name)}
            onRequestDeleteFixture={(id, name) => setConfirmDeleteFixture({ id, name })}
            onMarqueeSelect={(ids, options) => void handleMarqueeSelect(ids, options)}
            onAddFixture={requestAddFixture}
            viewport={stagePlotViewport}
            chipHoverFixtureId={chipHoverFixtureId}
          />
        </main>

        <ColumnResizer ariaLabel="Resize inspector" onPointerDown={columns.startResize("inspector")} />

        <LightingInspector
          uiMode={uiMode}
          activeTab={activeTab}
          onTabChange={setActiveTabOverride}
          fixtures={fixtures}
          groups={groups}
          scenes={scenes}
          palettes={palettes}
          dmxChannels={dmxChannelsRaw}
          dmxStale={!bridgeReachable}
          universe={bridgeUniverse}
          selectedFixtureId={selectedFixture?.id ?? null}
          selectedGroupId={selectedGroupId}
          activeSceneId={activeSceneId}
          inspectorSceneId={hoverPreviewSceneId}
          isSceneModified={effectiveSceneModified}
          bridgeReachable={bridgeReachable}
          previewMode={previewMode}
          previewDirty={previewDirty}
          onTogglePower={handleToggleFixturePower}
          onIntensityCommit={handleIntensityCommit}
          onCctCommit={handleCctCommit}
          onIdentifyBurst={handleIdentifyBurst}
          onPatchCommit={handlePatchCommit}
          onToggleGroupPower={handleToggleGroupPower}
          onSelectFixture={(id, options) => void handleSelectFixture(id, options)}
          onSaveScene={handleSaveScene}
          onSaveSceneAs={() => setSaveSceneAsOpen(true)}
          onRecallScene={handleRecallScene}
          onResaveScene={handleResaveScene}
          onDeleteScene={handleDeleteScene}
          onDeleteFixture={(id) => void handleDeleteFixture(id)}
          onSpatialCommit={previewMode ? undefined : (id, partial) => void handleFixtureSpatialCommit(id, partial)}
          onRenameScene={handleRenameScene}
          onRenameFixture={handleRenameFixture}
          onRenameGroup={handleRenameGroup}
          onSetSceneColor={(sceneId, colorIndex) => void handleSetSceneColor(sceneId, colorIndex)}
          onSetGroupColor={(groupId, colorIndex) => void handleSetGroupColor(groupId, colorIndex)}
          onAssignFixtureGroup={(fixtureId, groupId) => void handleAssignFixtureGroup(fixtureId, groupId)}
          onRemoveFixtureFromGroup={(fixtureId) => void handleAssignFixtureGroup(fixtureId, null)}
          onCreateGroup={() => setCreateGroupOpen(true)}
          selectedFixtures={selectedFixtureSnapshots}
          onClearSelection={() => void handleSelectFixture(null)}
          onBulkTogglePower={(ids, on) => void handleBulkTogglePower(ids, on)}
          onBulkIntensityValues={(values) => void handleBulkIntensityValues(values)}
          onBulkCctValues={(values) => void handleBulkCctValues(values)}
          onApplyPalette={(paletteId, ids) => void handleApplyPalette(paletteId, ids)}
          onCreatePalette={(request) => void handleCreatePalette(request)}
          onUpdatePalette={(request) => void handleUpdatePalette(request)}
          onDeletePalette={(paletteId) => void handleDeletePalette(paletteId)}
          busyActions={busyActions}
          pendingInlineRename={pendingInlineRename}
        />
      </div>

      {paletteQuickOpen ? (
        <div className={styles.paletteQuickOverlay} role="presentation" onMouseDown={() => setPaletteQuickOpen(false)}>
          <div
            className={styles.paletteQuickPanel}
            role="dialog"
            aria-modal="true"
            aria-label="Lighting palettes"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.paletteQuickHeader}>
              <strong>Palettes</strong>
              <span>{selectedFixtureIds.size} selected</span>
            </div>
            <div className={styles.paletteQuickGrid}>
              {palettes.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.paletteQuickTile}
                  disabled={
                    uiMode === "patch" || selectedFixtureIds.size === 0 || busyActions.has(`palette-apply:${entry.id}`)
                  }
                  onClick={() => {
                    setPaletteQuickOpen(false);
                    void handleApplyPalette(entry.id, Array.from(selectedFixtureIds));
                  }}
                >
                  <span
                    className={styles.paletteQuickAccent}
                    style={{ background: lightingColorTagHex(entry.colorIndex) ?? "transparent" }}
                    aria-hidden="true"
                  />
                  <span>{entry.name}</span>
                  <small>
                    {entry.kind === "intensity" ? `${Math.round(entry.value)}%` : `${Math.round(entry.value)}K`}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.bottomStripStack}>
        <SelectionChipStrip
          selectedFixtures={selectedFixtureSnapshots}
          onRemoveFromSelection={(fixtureId) => void handleRemoveFromSelection(fixtureId)}
          onClearAll={() => void handleSelectFixture(null)}
          onChipHover={setChipHoverFixtureId}
        />
        <div
          className={`${styles.dmxStripWrapper} ${dmxStripOn ? styles.dmxStripWrapperOpen : ""}`}
          aria-hidden={!dmxStripOn}
        >
          {renderDmxStrip ? (
            <DMXCompactStrip
              snapshot={lightingDmxMonitorSnapshot}
              fixtures={liveFixtures}
              bridgeReachable={bridgeReachable}
              universe={bridgeUniverse}
              onOpenMonitor={() => setDmxMonitorOpen(true)}
              onClose={() => setDmxStripOn(false)}
            />
          ) : null}
        </div>
      </div>

      <LightingHealthBar
        lightingSnapshot={lightingSnapshot}
        lightingDmxMonitorSnapshot={lightingDmxMonitorSnapshot}
        fixturesPatched={fixturesPatched}
        fixturesTotal={liveFixtureEntries.length}
        driftDetected={effectiveSceneModified}
        previewMode={previewMode}
        lastSavedLabel={lastSavedLabel}
        dmxStripOn={dmxStripOn}
        onToggleDmxStrip={() => setDmxStripOn((current) => !current)}
        bridgeReachable={bridgeReachable}
        bridgeUniverse={bridgeUniverse}
      />

      {dmxMonitorOpen ? (
        <DMXMonitorDialog
          universe={bridgeUniverse}
          snapshot={lightingDmxMonitorSnapshot}
          reachable={bridgeReachable}
          onClose={() => setDmxMonitorOpen(false)}
        />
      ) : null}

      {showLeavePrompt ? (
        <ConfirmDialog
          title="Leave with unsaved changes?"
          body={
            previewMode && activeScene ? (
              <>
                Preview scene <strong>{activeScene.name}</strong> has offline edits. Save or discard the preview before
                switching workspaces; the live rig is unchanged.
              </>
            ) : activeScene ? (
              <>
                Scene <strong>{activeScene.name}</strong> has live changes that aren't saved. You can save them with{" "}
                <strong>Save changes</strong> in the rail, or come back later — the live rig state stays as it is either
                way.
              </>
            ) : (
              <>The active scene has unsaved changes that won't be discarded — the live rig state stays as it is.</>
            )
          }
          confirmLabel="Leave anyway"
          cancelLabel="Stay"
          danger
          onConfirm={() => {
            setShowLeavePrompt(false);
            pendingLeaveResolveRef.current?.(true);
            pendingLeaveResolveRef.current = null;
          }}
          onCancel={() => {
            setShowLeavePrompt(false);
            pendingLeaveResolveRef.current?.(false);
            pendingLeaveResolveRef.current = null;
          }}
        />
      ) : null}

      {showPreviewExitPrompt ? (
        <Dialog
          title="Exit preview with offline edits?"
          body={
            activeScene ? (
              <>
                Preview scene <strong>{activeScene.name}</strong> has edits that are not committed. Save writes the
                preview buffer to the scene and leaves live output unchanged.
              </>
            ) : (
              <>The preview buffer has edits that are not committed. Save as new or discard before exiting preview.</>
            )
          }
          onClose={() => setShowPreviewExitPrompt(false)}
          actions={
            <>
              <Button
                size="compact"
                variant="ghost"
                disabled={busyActions.has("preview-discard") || busyActions.has("scene-resave")}
                onClick={() => setShowPreviewExitPrompt(false)}
              >
                Cancel
              </Button>
              <Button
                size="compact"
                variant="secondary"
                disabled={busyActions.has("preview-discard") || busyActions.has("scene-resave")}
                onClick={() => void handleDiscardPreview()}
              >
                Discard
              </Button>
              <Button
                size="compact"
                variant="primary"
                disabled={!activeScene || busyActions.has("preview-discard") || busyActions.has("scene-resave")}
                onClick={() => {
                  setShowPreviewExitPrompt(false);
                  void handleResaveScene();
                }}
              >
                Save
              </Button>
            </>
          }
        />
      ) : null}

      {confirmCutAllOpen ? (
        <ConfirmDialog
          title="Cut all fixtures?"
          body={
            <>
              This sends every fixture to <strong>off</strong> immediately. Saved scenes are unaffected — recall any
              scene to restore the rig.
            </>
          }
          confirmLabel="Cut all"
          cancelLabel="Cancel"
          danger
          busy={busyActions.has("lighting-blackout")}
          onConfirm={() => {
            setConfirmCutAllOpen(false);
            void handleEmergencyCut();
          }}
          onCancel={() => setConfirmCutAllOpen(false)}
        />
      ) : null}

      {confirmDeleteScene ? (
        <ConfirmDialog
          title="Delete scene?"
          body={
            <>
              This permanently removes <strong>{confirmDeleteScene.name}</strong>. Other scenes are unaffected and the
              live rig state stays as it is.
            </>
          }
          confirmLabel="Delete scene"
          danger
          busy={busyActions.has("scene-delete")}
          onConfirm={() => {
            const target = confirmDeleteScene;
            setConfirmDeleteScene(null);
            void handleDeleteScene(target.id);
          }}
          onCancel={() => setConfirmDeleteScene(null)}
        />
      ) : null}

      {confirmDeleteGroup ? (
        <ConfirmDialog
          title="Delete group?"
          body={
            <>
              This removes <strong>{confirmDeleteGroup.name}</strong>. Member fixtures stay in the rig — only the group
              is deleted.
            </>
          }
          confirmLabel="Delete group"
          danger
          busy={busyActions.has(`group-delete:${confirmDeleteGroup.id}`)}
          onConfirm={() => {
            const target = confirmDeleteGroup;
            setConfirmDeleteGroup(null);
            void handleDeleteGroup(target.id, target.name);
          }}
          onCancel={() => setConfirmDeleteGroup(null)}
        />
      ) : null}

      {confirmDeleteFixture ? (
        <ConfirmDialog
          title="Delete fixture?"
          body={
            <>
              This permanently removes <strong>{confirmDeleteFixture.name}</strong> from the rig. Saved scenes that
              referenced it lose this fixture's saved state.
            </>
          }
          confirmLabel="Delete fixture"
          danger
          busy={busyActions.has(`fixture-delete:${confirmDeleteFixture.id}`)}
          onConfirm={() => {
            const target = confirmDeleteFixture;
            setConfirmDeleteFixture(null);
            void handleDeleteFixture(target.id);
          }}
          onCancel={() => setConfirmDeleteFixture(null)}
        />
      ) : null}

      {createFixtureOpen ? (
        <CreateFixtureDialog
          fixtures={fixtures}
          defaultName={nextLightingFixtureName(fixtures)}
          busy={busyActions.has("fixture-create")}
          onConfirm={(spec) => {
            setCreateFixtureOpen(false);
            void handleAddFixture(spec);
          }}
          onCancel={() => setCreateFixtureOpen(false)}
        />
      ) : null}

      {createGroupOpen ? (
        <RenameDialog
          title="New lighting group"
          fieldLabel="Group name"
          initialValue=""
          placeholder="e.g. Key, Fill, Back"
          confirmLabel="Create group"
          busy={busyActions.has("group-create")}
          onConfirm={(name) => {
            setCreateGroupOpen(false);
            void handleCreateGroup(name);
          }}
          onCancel={() => setCreateGroupOpen(false)}
        />
      ) : null}

      {saveSceneAsOpen ? (
        <RenameDialog
          title={previewMode ? "Save preview as new scene" : "Save as new scene"}
          fieldLabel="Scene name"
          initialValue={`Scene ${scenes.length + 1}`}
          placeholder="e.g. Talking head, Wide, Backlit"
          confirmLabel="Save scene"
          busy={busyActions.has("scene-create")}
          onConfirm={(name) => {
            setSaveSceneAsOpen(false);
            void handleSaveScene(name);
          }}
          onCancel={() => setSaveSceneAsOpen(false)}
        />
      ) : null}
    </div>
  );
}
