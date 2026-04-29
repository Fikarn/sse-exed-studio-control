import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { X } from "lucide-react";

import { ConfirmDialog } from "@sse/design-system";
import type {
  LightingDmxMonitorSnapshot,
  LightingSceneSnapshot,
  LightingSnapshot,
  ShellStore,
} from "@sse/engine-client";

import {
  asRecord,
  getLightingDmxChannels,
  getLightingFixtures,
  getLightingGroups,
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
import { RenameDialog } from "./components/RenameDialog";
import { StagePlot } from "./components/StagePlot";
import { nextLightingFixtureName } from "./lightingHelpers";
import { renderSceneThumbnailDataUri, withSceneThumbRemoved, withSceneThumbUpserted } from "./sceneThumbnails";
import { useResizableColumns } from "./useResizableColumns";
import { UndoRefusedError, useUndoStack, type UndoOutcome } from "./useUndoStack";
import { useUnsavedChangesGuard } from "./useUnsavedScenePrompt";
import styles from "./LightingWorkspace.module.css";

type RenameTarget =
  | { kind: "scene"; sceneId: string; currentName: string }
  | { kind: "fixture"; fixtureId: string; currentName: string }
  | { kind: "group"; groupId: string; currentName: string };

interface LightingWorkspaceSurfaceProps {
  appSnapshot: SnapshotRecord | null;
  lightingDmxMonitorSnapshot: LightingDmxMonitorSnapshot | null;
  lightingSnapshot: LightingSnapshot | null;
  store: ShellStore;
}

interface ActionFeedback {
  message: string;
  tone: "ok" | "error" | "info";
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

export function LightingWorkspaceSurface({
  appSnapshot,
  lightingDmxMonitorSnapshot,
  lightingSnapshot,
  store,
}: LightingWorkspaceSurfaceProps) {
  const fixtures = useMemo(() => lightingSnapshot?.fixtures ?? [], [lightingSnapshot]);
  const groups = useMemo(() => lightingSnapshot?.groups ?? [], [lightingSnapshot]);
  const scenes = useMemo(() => lightingSnapshot?.scenes ?? [], [lightingSnapshot]);
  const dmxChannelsRaw = useMemo(
    () => getLightingDmxChannels(lightingDmxMonitorSnapshot),
    [lightingDmxMonitorSnapshot]
  );
  // Re-derive fixtures from shellData accessor for drift comparisons (snapshot
  // -> entry has the null-safe shape the helpers expect).
  const fixtureEntries = useMemo(() => getLightingFixtures(lightingSnapshot), [lightingSnapshot]);
  // Surface group + scene entries via shellData for parity with rail props.
  const groupEntries = useMemo(() => getLightingGroups(lightingSnapshot), [lightingSnapshot]);
  const sceneEntries = useMemo(() => getLightingScenes(lightingSnapshot), [lightingSnapshot]);

  const sceneThumbs = useMemo(() => getSceneThumbs(appSnapshot), [appSnapshot]);

  const persistedSelectedFixtureId =
    typeof lightingSnapshot?.selectedFixtureId === "string" ? lightingSnapshot.selectedFixtureId : null;
  const persistedSelectedSceneId =
    typeof lightingSnapshot?.selectedSceneId === "string" ? lightingSnapshot.selectedSceneId : null;

  const [uiMode, setUiMode] = useState<LightingUiMode>("recall");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [activeTabOverride, setActiveTabOverride] = useState<InspectorTab | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  useEffect(() => {
    if (!feedback) return;
    if (feedback.tone === "error") return; // errors are sticky until manual dismiss
    const timer = window.setTimeout(() => setFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);
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
  const [dmxMonitorOpen, setDmxMonitorOpen] = useState(false);
  const [confirmCutAllOpen, setConfirmCutAllOpen] = useState(false);
  const [createFixtureOpen, setCreateFixtureOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [saveSceneAsOpen, setSaveSceneAsOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  // Frontend-only "previewed" scene id. Set immediately when a scene tile is
  // clicked so the inspector can show its details even if the engine recall
  // IPC was rejected (e.g. bridge unreachable in dev / pre-probe states).
  // Takes priority over snapshot-derived recalled / persisted selection so
  // the inspector tracks the user's intent rather than the engine's truth.
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);

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

  // Active scene = the most recently recalled scene (engine-tracked) falling
  // back to the persisted selectedSceneId. Kept lean — no persisted "active
  // cue" anywhere because the cue model is gone in Direction D.
  const activeSceneId = useMemo(() => {
    if (previewSceneId && sceneEntries.some((scene) => scene.id === previewSceneId)) {
      return previewSceneId;
    }
    const recalled = sceneEntries.find((scene) => scene.lastRecalled);
    if (recalled) return recalled.id;
    if (persistedSelectedSceneId && sceneEntries.some((scene) => scene.id === persistedSelectedSceneId)) {
      return persistedSelectedSceneId;
    }
    return null;
  }, [previewSceneId, sceneEntries, persistedSelectedSceneId]);

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

  const modifiedSceneId = isSceneModified && activeSceneId ? activeSceneId : null;

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
  useUnsavedChangesGuard(isSceneModified ? promptForLeave : null);
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
      void win.setTitle(isSceneModified ? `${baseTitle} · ●` : baseTitle);
    })();
    return () => {
      cancelled = true;
      void (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        void win.setTitle(baseTitle);
      })();
    };
  }, [isSceneModified]);

  const selectedFixture = useMemo(
    () => fixtures.find((fixture) => fixture.id === persistedSelectedFixtureId) ?? null,
    [fixtures, persistedSelectedFixtureId]
  );

  const activeTab =
    activeTabOverride ??
    deriveInspectorTab({
      uiMode,
      selectedFixtureId: selectedFixture?.id ?? null,
      selectedGroupId,
    });

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
    return groupEntries.map((group) => {
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
      };
    });
  }, [groupEntries, fixtureEntries, activeScene]);

  const fixturesPatched = fixtureEntries.filter((fixture) => fixture.dmxStartAddress > 0).length;

  const bridgeReachable = lightingSnapshot?.reachable === true;
  const bridgeUniverse = lightingSnapshot?.universe ?? 1;
  const bridgeIp = String(lightingSnapshot?.bridgeIp ?? "");

  // ---------------- handlers ----------------

  const reportError = useEffectEvent((error: unknown, fallback: string) => {
    setFeedback({
      message: error instanceof Error ? error.message : fallback,
      tone: "error",
    });
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

  const selectedFixtureSnapshots = useMemo(
    () => fixtures.filter((fixture) => selectedFixtureIds.has(fixture.id)),
    [fixtures, selectedFixtureIds]
  );

  const handleTogglePatch = useEffectEvent(() => {
    setUiMode((current) => (current === "patch" ? "recall" : "patch"));
  });

  const requestAddFixture = useCallback(() => {
    setCreateFixtureOpen(true);
  }, []);

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
        setFeedback({ message: String(result?.summary ?? "Fixture added."), tone: "ok" });
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
      setFeedback({ message: String(result?.summary ?? `Group '${name}' created.`), tone: "ok" });
    } catch (error) {
      reportError(error, "Lighting group create failed.");
    } finally {
      finishBusy("group-create");
    }
  });

  const handleRenameScene = useEffectEvent(async (sceneId: string, name: string) => {
    startBusy("scene-rename");
    try {
      await store.updateLightingScene({ sceneId, name });
      setFeedback({ message: `Scene renamed to '${name}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene rename failed.");
    } finally {
      finishBusy("scene-rename");
    }
  });

  const handleRenameFixture = useEffectEvent(async (fixtureId: string, name: string) => {
    const busyKey = `fixture-rename:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, name });
      setFeedback({ message: `Fixture renamed to '${name}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Fixture rename failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleRenameGroup = useEffectEvent(async (groupId: string, name: string) => {
    const busyKey = `group-rename:${groupId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingGroup({ groupId, name });
      setFeedback({ message: `Group renamed to '${name}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Group rename failed.");
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
      setFeedback({ message: "All fixtures cut.", tone: "ok" });
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
      setFeedback({ message: on ? "Lighting resumed." : "Lighting paused.", tone: "ok" });
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
      }
      setFeedback({ message: String(result?.summary ?? `Scene '${name}' saved.`), tone: "ok" });
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
      setFeedback({ message: `Scene '${sceneName}' updated.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene re-save failed.");
    } finally {
      finishBusy("scene-resave");
    }
  });

  const handleDeleteScene = useEffectEvent(async () => {
    if (!activeScene) return;
    startBusy("scene-delete");
    try {
      await store.deleteLightingScene(activeScene.id);
      const next = withSceneThumbRemoved(sceneThumbs, activeScene.id);
      await store.setLightingSceneThumbs(next);
      setFeedback({ message: `Scene '${activeScene.name}' deleted.`, tone: "ok" });
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
      setFeedback({ message: pinned ? "Scene pinned." : "Scene unpinned.", tone: "ok" });
    } catch (error) {
      reportError(error, pinned ? "Scene pin failed." : "Scene unpin failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

  const handleRecallScene = useEffectEvent(async (sceneId: string) => {
    if (uiMode === "patch") {
      setFeedback({
        message: "Patch mode is active. Exit patch mode before recalling a scene.",
        tone: "info",
      });
      return;
    }
    // Show the scene in the inspector immediately — even if the recall IPC
    // is rejected by the engine (e.g. pre-probe state), the operator still
    // sees what the scene contains. The recall IPC drives the actual rig.
    setPreviewSceneId(sceneId);
    if (!bridgeReachable) {
      // Skip the IPC entirely when the bridge is unreachable — the engine
      // would just reject it. Surface a single non-error toast so the
      // operator knows recall is preview-only and not a failed action.
      setFeedback({
        message: "Bridge unreachable — showing scene contents only.",
        tone: "info",
      });
      return;
    }
    const busyKey = `scene:${sceneId}`;
    startBusy(busyKey);
    try {
      await store.recallLightingScene(sceneId, 0);
      setFeedback({ message: "Scene recalled.", tone: "ok" });
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
        fixtures,
        fixtureStates: scene.fixtureStates,
      });
    }
    return result;
  }, [scenes, sceneThumbs, fixtures]);

  const handleToggleGroupPower = useEffectEvent(async (groupId: string, on: boolean) => {
    const busyKey = `group:${groupId}`;
    startBusy(busyKey);
    try {
      await store.setLightingGroupPower(groupId, on);
      setFeedback({ message: `Group ${on ? "on" : "off"}.`, tone: "ok" });
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
          setFeedback({ message: `Patched. Now patching ‘${next.name}’.`, tone: "ok" });
        } catch (error) {
          reportError(error, "Auto-advance to next fixture failed.");
        }
      } else {
        setUiMode("recall");
        setFeedback({ message: "All fixtures patched.", tone: "ok" });
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
      setFeedback({ message: `Identify burst sent to '${fixtureName}'.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Identify burst failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

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
      setFeedback({
        message: target ? `Fixture '${target.name}' deleted.` : "Fixture deleted.",
        tone: "ok",
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
      setFeedback({
        message: `Set ${fixtureIds.length} fixtures ${on ? "on" : "off"}.`,
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Bulk power update failed.");
    } finally {
      finishBusy("fixture-bulk-power");
    }
  });

  const handleBulkIntensityCommit = useEffectEvent(async (fixtureIds: readonly string[], intensity: number) => {
    startBusy("fixture-bulk-intensity");
    try {
      await Promise.all(fixtureIds.map((fixtureId) => store.updateLightingFixture({ fixtureId, intensity })));
    } catch (error) {
      reportError(error, "Bulk intensity update failed.");
    } finally {
      finishBusy("fixture-bulk-intensity");
    }
  });

  const handleBulkCctCommit = useEffectEvent(async (fixtureIds: readonly string[], cct: number) => {
    startBusy("fixture-bulk-cct");
    try {
      await Promise.all(fixtureIds.map((fixtureId) => store.updateLightingFixture({ fixtureId, cct })));
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
      setFeedback({
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
        setFeedback({
          message: `${kind === "Undo" ? "Undid" : "Redid"} ‘${outcome.label}’ · ${kind === "Undo" ? "⌘⇧Z to redo" : "⌘Z to undo"}`,
          tone: "ok",
        });
        break;
      case "rejected":
        setFeedback({
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
        } else if (isSceneModified && activeScene) {
          void handleResaveScene();
        } else {
          setFeedback({
            message: activeScene ? "Already saved." : "No active scene to save changes to.",
            tone: "info",
          });
        }
        event.preventDefault();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === "p") {
        setUiMode((current) => (current === "patch" ? "recall" : "patch"));
        event.preventDefault();
      } else if (event.key.toLowerCase() === "s") {
        // Smart S: when drift exists on the active scene, save changes.
        // Otherwise create a new scene with the autoname for fast capture.
        if (isSceneModified && activeScene) {
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
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeScene,
    fixtures,
    handleFixtureNudge,
    handleRecallScene,
    handleResaveScene,
    handleSaveScene,
    handleSelectFixture,
    isSceneModified,
    persistedSelectedFixtureId,
    scenes,
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
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        patchMode={uiMode === "patch"}
        onTogglePatch={handleTogglePatch}
        onAddFixture={requestAddFixture}
      />

      {feedback ? (
        <div className={styles.feedback} role="status" data-tone={feedback.tone}>
          <span>{feedback.message}</span>
          <button
            type="button"
            className={styles.feedbackDismiss}
            onClick={() => setFeedback(null)}
            aria-label="Dismiss"
          >
            <X aria-hidden="true" size={12} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      <LightingBridgeBanner reachable={bridgeReachable} bridgeIp={bridgeIp} universe={bridgeUniverse} />

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
          activeSceneId={activeSceneId}
          modifiedSceneId={modifiedSceneId}
          sceneThumbs={displayedSceneThumbs}
          onRecallScene={handleRecallScene}
          onSaveScene={handleSaveScene}
          onReorderScene={handleReorderScene}
          onPinScene={handlePinScene}
          groups={railGroupEntries}
          onToggleGroupPower={handleToggleGroupPower}
          searchQuery={searchQuery}
          patchMode={uiMode === "patch"}
          isSceneModified={isSceneModified}
          onResaveScene={handleResaveScene}
          onRevertScene={activeSceneId ? () => void handleRecallScene(activeSceneId) : undefined}
          onClearSearch={() => setSearchQuery("")}
          onCreateGroup={() => setCreateGroupOpen(true)}
          onInspectGroup={handleInspectGroup}
        />

        <ColumnResizer ariaLabel="Resize scene rail" onPointerDown={columns.startResize("rail")} />

        <main className={styles.stage}>
          <StagePlot
            fixtures={fixtures}
            selectedFixtureId={selectedFixture?.id ?? null}
            selectedFixtureIds={selectedFixtureIds}
            patchMode={uiMode === "patch"}
            activeSceneName={activeScene?.name}
            isSceneModified={isSceneModified}
            bridgeReachable={bridgeReachable}
            searchQuery={searchQuery}
            identifyingFixtureIds={identifyingIds}
            onSelectFixture={(id, options) => void handleSelectFixture(id, options ?? {})}
            onPositionCommit={(id, xMeters, yMeters) =>
              void handleFixtureSpatialCommit(id, { spatialX: xMeters, spatialY: yMeters })
            }
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
          dmxChannels={dmxChannelsRaw}
          dmxStale={!bridgeReachable}
          universe={bridgeUniverse}
          selectedFixtureId={selectedFixture?.id ?? null}
          selectedGroupId={selectedGroupId}
          activeSceneId={activeSceneId}
          isSceneModified={isSceneModified}
          bridgeReachable={bridgeReachable}
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
          onSpatialCommit={(id, partial) => void handleFixtureSpatialCommit(id, partial)}
          onRenameScene={(sceneId, currentName) => setRenameTarget({ kind: "scene", sceneId, currentName })}
          onRenameFixture={(fixtureId, currentName) => setRenameTarget({ kind: "fixture", fixtureId, currentName })}
          onRenameGroup={(groupId, currentName) => setRenameTarget({ kind: "group", groupId, currentName })}
          onAssignFixtureGroup={(fixtureId, groupId) => void handleAssignFixtureGroup(fixtureId, groupId)}
          onCreateGroup={() => setCreateGroupOpen(true)}
          selectedFixtures={selectedFixtureSnapshots}
          onClearSelection={() => void handleSelectFixture(null)}
          onBulkTogglePower={(ids, on) => void handleBulkTogglePower(ids, on)}
          onBulkIntensityCommit={(ids, intensity) => void handleBulkIntensityCommit(ids, intensity)}
          onBulkCctCommit={(ids, cct) => void handleBulkCctCommit(ids, cct)}
          busyActions={busyActions}
        />
      </div>

      <LightingHealthBar
        lightingSnapshot={lightingSnapshot}
        lightingDmxMonitorSnapshot={lightingDmxMonitorSnapshot}
        fixturesPatched={fixturesPatched}
        fixturesTotal={fixtureEntries.length}
        driftDetected={isSceneModified}
        lastSavedLabel={lastSavedLabel}
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
            activeScene ? (
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
          title="Save as new scene"
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

      {renameTarget ? (
        <RenameDialog
          title={
            renameTarget.kind === "scene"
              ? "Rename scene"
              : renameTarget.kind === "fixture"
                ? "Rename fixture"
                : "Rename group"
          }
          fieldLabel="Name"
          initialValue={renameTarget.currentName}
          busy={
            renameTarget.kind === "scene"
              ? busyActions.has("scene-rename")
              : renameTarget.kind === "fixture"
                ? busyActions.has(`fixture-rename:${renameTarget.fixtureId}`)
                : busyActions.has(`group-rename:${renameTarget.groupId}`)
          }
          onConfirm={(name) => {
            const target = renameTarget;
            setRenameTarget(null);
            if (target.kind === "scene") void handleRenameScene(target.sceneId, name);
            else if (target.kind === "fixture") void handleRenameFixture(target.fixtureId, name);
            else void handleRenameGroup(target.groupId, name);
          }}
          onCancel={() => setRenameTarget(null)}
        />
      ) : null}
    </div>
  );
}
