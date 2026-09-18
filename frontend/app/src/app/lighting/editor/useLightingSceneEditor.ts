import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { getSceneThumbs, asRecord } from "../../shellData";
import { fixtureStatesEqual, fixtureHasCctControl, sceneMatchesFixtures } from "../lightingDrift";
import { useUnsavedChangesGuard } from "../useUnsavedScenePrompt";
import type { LightingSceneSnapshot, LightingSceneFixtureSnapshot } from "@sse/engine-client";
import { formatLightingRelativeTime } from "../lightingHelpers";
import { useLiveCallback } from "../../shared/useLiveCallback";
import { renderSceneThumbnailDataUri, withSceneThumbUpserted, withSceneThumbRemoved } from "../sceneThumbnails";
import {
  RECENT_SCENE_LIMIT,
  pushUndoOutcomeToast,
  formatRecallFade,
  type LightingWorkspaceSurfaceProps,
} from "../lightingWorkspaceModel";
import type { LightingRig } from "./useLightingRig";
import type { LightingSession } from "./useLightingSession";

/** Scenes: which one is active, whether the rig has drifted from it, the
 *  unsaved-changes guard, preview mode, thumbnails, the hover preview, and
 *  save / re-save / delete / reorder / pin / recall. */
export function useLightingSceneEditor({
  props,
  rig,
  session,
}: {
  props: LightingWorkspaceSurfaceProps;
  rig: LightingRig;
  session: LightingSession;
}) {
  const { appSnapshot, store, lightingFixtureCatalogSnapshot, lightingSnapshot } = props;
  const {
    sceneEntries,
    persistedSelectedSceneId,
    previewMode,
    previewTargetSceneId,
    scenes,
    fixtureEntries,
    fixtures,
    liveFixtures,
    bridgeReachable,
  } = rig;
  const {
    startBusy,
    toast,
    finishBusy,
    uiMode,
    palette,
    undoStack,
    operatorLayout,
    setInspectorDrawerOpen,
    busyActions,
    reportError,
  } = session;
  const [sceneRenderPreviewId, setSceneRenderPreviewId] = useState<string | null>(null);

  const sceneThumbs = useMemo(() => getSceneThumbs(appSnapshot), [appSnapshot]);

  const sceneThumbsRef = useRef(sceneThumbs);
  useEffect(() => {
    sceneThumbsRef.current = sceneThumbs;
  }, [sceneThumbs]);
  const persistSceneThumbs = useCallback(
    async (next: Record<string, string>) => {
      sceneThumbsRef.current = next;
      await store.setLightingSceneThumbs(next);
    },
    [store]
  );

  const [recallFadeMs, setRecallFadeMs] = useState(0);
  const [recentSceneIds, setRecentSceneIds] = useState<readonly string[]>([]);

  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

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
        hasCctControl: fixtureHasCctControl(fixture, lightingFixtureCatalogSnapshot),
        controlValues: fixture.controlValues,
      })),
      activeScene.fixtureStates.map((state) => ({
        fixtureId: state.fixtureId,
        intensity: state.intensity,
        cct: state.cct,
        on: state.on,
        controlValues: state.controlValues,
      }))
    );
  }, [activeScene, fixtureEntries, lightingFixtureCatalogSnapshot]);

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

  const sceneRenderPreview = useMemo(
    () => (sceneRenderPreviewId ? (scenes.find((scene) => scene.id === sceneRenderPreviewId) ?? null) : null),
    [scenes, sceneRenderPreviewId]
  );

  useEffect(() => {
    if (!sceneRenderPreviewId) return;
    if (!sceneRenderPreview) {
      setSceneRenderPreviewId(null);
      return;
    }
    if (activeSceneId !== sceneRenderPreviewId) return;
    if (sceneMatchesFixtures(fixtures, sceneRenderPreview, lightingFixtureCatalogSnapshot)) {
      setSceneRenderPreviewId(null);
    }
  }, [activeSceneId, fixtures, lightingFixtureCatalogSnapshot, sceneRenderPreview, sceneRenderPreviewId]);

  const pushRecentScene = useCallback((sceneId: string) => {
    setRecentSceneIds((prev) => {
      const filtered = prev.filter((id) => id !== sceneId);
      return [sceneId, ...filtered].slice(0, RECENT_SCENE_LIMIT);
    });
  }, []);

  const sceneById = useMemo(() => new Map(scenes.map((entry) => [entry.id, entry])), [scenes]);
  const recentToolbarScenes = useMemo(
    () =>
      recentSceneIds
        .map((id) => sceneById.get(id))
        .filter((entry): entry is LightingSceneSnapshot => Boolean(entry))
        .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
        .slice(0, RECENT_SCENE_LIMIT)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          lastRecalledLabel: entry.lastRecalledAt ? formatLightingRelativeTime(entry.lastRecalledAt) : undefined,
        })),
    [recentSceneIds, sceneById]
  );

  const [showPreviewExitPrompt, setShowPreviewExitPrompt] = useState(false);

  const disablePreviewMode = useLiveCallback(async () => {
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

  const handleDiscardPreview = useLiveCallback(async () => {
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

  const handleTogglePreview = useLiveCallback(async () => {
    if (previewMode) {
      requestExitPreview();
      return;
    }
    if (uiMode === "patch") {
      toast.push({ message: "Exit patch mode before preview editing.", tone: "attention" });
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

  const handleRenameScene = useLiveCallback(async (sceneId: string, name: string) => {
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

  // Wave 30b — I4 set scene color tag. `null` clears, `0..7` sets. The IPC
  // contract from Wave 30a treats omit / null / index distinctly; we always
  // send the field so the engine knows the operator's intent.
  const handleSetSceneColor = useLiveCallback(async (sceneId: string, colorIndex: number | null) => {
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

  const handleSaveScene = useLiveCallback(async (overrideName?: string) => {
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
        pushRecentScene(createdId);
        // Pull the fresh scene from the result so we render its true saved
        // state (the snapshot may not have updated yet).
        const fixtureStatesRecord = Array.isArray(created?.fixtureStates) ? created!.fixtureStates : [];
        const dataUri = renderSceneThumbnailDataUri({
          fixtures,
          fixtureStates: fixtureStatesRecord as unknown as LightingSceneSnapshot["fixtureStates"],
        });
        const next = withSceneThumbUpserted(sceneThumbsRef.current, createdId, dataUri);
        await persistSceneThumbs(next);
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
            const cleared = withSceneThumbRemoved(sceneThumbsRef.current, currentSceneId);
            await persistSceneThumbs(cleared);
          },
          redo: async () => {
            const redoResult = asRecord(await store.createLightingScene({ name: sceneName }));
            const redoCreated = asRecord(redoResult?.scene);
            const newId = typeof redoCreated?.id === "string" ? redoCreated.id : null;
            if (newId) {
              currentSceneId = newId;
              const refreshed = withSceneThumbUpserted(sceneThumbsRef.current, newId, cachedDataUri);
              await persistSceneThumbs(refreshed);
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

  const handleResaveScene = useLiveCallback(async () => {
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
      const nextThumbs = withSceneThumbUpserted(sceneThumbsRef.current, sceneId, dataUri);
      await persistSceneThumbs(nextThumbs);
      setLastSavedAt(new Date());
      toast.push({ message: `Scene '${sceneName}' updated.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene re-save failed.");
    } finally {
      finishBusy("scene-resave");
    }
  });

  const handleDeleteScene = useLiveCallback(async (overrideSceneId?: string) => {
    // Default to the active scene (Inspector → Delete path); right-click
    // delete from a non-active tile passes the tile's id explicitly.
    const sceneId = overrideSceneId ?? activeScene?.id ?? null;
    if (!sceneId) return;
    const target = scenes.find((scene) => scene.id === sceneId) ?? null;
    const sceneName = target?.name ?? "Scene";
    const targetSnapshot = target
      ? {
          name: target.name,
          fixtureStates: target.fixtureStates.map((state) => ({
            fixtureId: state.fixtureId,
            intensity: state.intensity,
            cct: state.cct,
            on: state.on,
            controlValues: state.controlValues,
          })) satisfies LightingSceneFixtureSnapshot[],
          colorIndex: target.colorIndex ?? null,
          pinned: target.pinned,
          thumbDataUri:
            sceneThumbs[sceneId] ??
            renderSceneThumbnailDataUri({
              fixtures: liveFixtures,
              fixtureStates: target.fixtureStates,
            }),
        }
      : null;
    startBusy("scene-delete");
    try {
      await store.deleteLightingScene(sceneId);
      const next = withSceneThumbRemoved(sceneThumbsRef.current, sceneId);
      await persistSceneThumbs(next);
      if (targetSnapshot) {
        let currentSceneId = sceneId;
        undoStack.push({
          label: `Delete scene ${targetSnapshot.name}`,
          undo: async () => {
            const result = asRecord(
              await store.createLightingScene({
                name: targetSnapshot.name,
                fixtureStates: targetSnapshot.fixtureStates,
                colorIndex: targetSnapshot.colorIndex,
              })
            );
            const created = asRecord(result?.scene);
            const restoredId = typeof created?.id === "string" ? created.id : null;
            if (restoredId) {
              currentSceneId = restoredId;
              if (targetSnapshot.pinned) {
                await store.pinLightingScene(restoredId, true);
              }
              const withoutDeletedThumb = withSceneThumbRemoved(sceneThumbsRef.current, sceneId);
              const restoredThumbs = withSceneThumbUpserted(
                withoutDeletedThumb,
                restoredId,
                targetSnapshot.thumbDataUri
              );
              await persistSceneThumbs(restoredThumbs);
            }
          },
          redo: async () => {
            await store.deleteLightingScene(currentSceneId);
            const cleared = withSceneThumbRemoved(sceneThumbsRef.current, currentSceneId);
            await persistSceneThumbs(cleared);
          },
        });
      }
      toast.push({
        message: `Scene '${sceneName}' deleted.`,
        tone: "ok",
        action: targetSnapshot
          ? {
              label: "Undo",
              onClick: () => void undoStack.undo().then((outcome) => pushUndoOutcomeToast(toast, outcome)),
            }
          : undefined,
      });
    } catch (error) {
      reportError(error, "Scene delete failed.");
    } finally {
      finishBusy("scene-delete");
    }
  });

  const handleReorderScene = useLiveCallback(async (sceneId: string, beforeSceneId: string | null) => {
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

  const handlePinScene = useLiveCallback(async (sceneId: string, pinned: boolean) => {
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

  const handleRecallScene = useLiveCallback(async (sceneId: string) => {
    if (uiMode === "patch") {
      toast.push({
        message: "Patch mode is on. Press P to leave it, then recall the scene.",
        tone: "attention",
      });
      return;
    }
    // Wave 28a / I6 — push the scene into the cross-workspace ⌘K recents
    // ring so the palette's empty-query view surfaces recent recalls. Done
    // here (not only when invoked via palette) so rail-driven recalls also
    // populate recents.
    palette.pushRecent(`lighting:recall:${sceneId}`);
    pushRecentScene(sceneId);
    // Wave 30b — click is the user's commitment to a scene; cancel any
    // hover preview synchronously so the inspector doesn't show a stale
    // hovered scene during the 200 ms mouseleave grace window after the
    // recall flips activeSceneId.
    cancelHoverPreviewSync();
    // Show the scene in the inspector immediately — even if the recall IPC
    // is rejected by the engine (e.g. pre-probe state), the operator still
    // sees what the scene contains. The recall IPC drives the actual rig.
    setSceneRenderPreviewId(sceneId);
    setInspectorSelectedSceneId(sceneId);
    if (operatorLayout.isNarrow) setInspectorDrawerOpen(true);
    if (!bridgeReachable && !previewMode) {
      // Skip the IPC entirely when the bridge is unreachable — the engine
      // would just reject it. Surface a single non-error toast so the
      // operator knows recall is preview-only and not a failed action.
      toast.push({
        message:
          "The bridge is not answering, so this only shows what the scene holds. Open Setup to check the bridge.",
        tone: "attention",
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

  const lastSavedLabel = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : undefined;
  return {
    recallFadeMs,
    setRecallFadeMs,
    hoverPreviewSceneId,
    handleHoverPreview,
    handleHoverPreviewClear,
    liveActiveSceneId,
    activeSceneId,
    activeScene,
    previewDirty,
    effectiveSceneModified,
    modifiedSceneId,
    pendingLeaveResolveRef,
    showLeavePrompt,
    setShowLeavePrompt,
    sceneRenderPreview,
    recentToolbarScenes,
    showPreviewExitPrompt,
    setShowPreviewExitPrompt,
    handleDiscardPreview,
    handleTogglePreview,
    handleRenameScene,
    handleSetSceneColor,
    handleSaveScene,
    handleResaveScene,
    handleDeleteScene,
    handleReorderScene,
    handlePinScene,
    handleRecallScene,
    displayedSceneThumbs,
    renamingSceneIds,
    lastSavedLabel,
  };
}

export type LightingSceneEditor = ReturnType<typeof useLightingSceneEditor>;
