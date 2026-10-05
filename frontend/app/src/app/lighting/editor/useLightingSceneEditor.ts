import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { asRecord } from "../../shellData";
import { sceneMatchesFixtures } from "../lightingDrift";
import { useUnsavedChangesGuard } from "../useUnsavedScenePrompt";
import type { LightingSceneSnapshot, LightingSceneFixtureSnapshot } from "@sse/engine-client";
import { formatLightingRelativeTime } from "../lightingHelpers";
import { useLiveCallback } from "../../shared/useLiveCallback";
import { UndoRefusedError } from "../useUndoStack";
import { rigNow } from "../undoTargets";
import {
  RECENT_SCENE_LIMIT,
  pushUndoOutcomeToast,
  formatRecallFade,
  type LightingWorkspaceSurfaceProps,
} from "../lightingWorkspaceModel";
import type { LightingRig } from "./useLightingRig";
import type { LightingSession } from "./useLightingSession";

/** Scenes: which one is active, whether the rig has drifted from it (the
 *  hardware link's word), the unsaved-changes guard, preview mode, the hover
 *  preview, and save / re-save / delete / reorder / pin / recall. */
export function useLightingSceneEditor({
  props,
  rig,
  session,
}: {
  props: LightingWorkspaceSurfaceProps;
  rig: LightingRig;
  session: LightingSession;
}) {
  const { store, lightingFixtureCatalogSnapshot, lightingSnapshot } = props;
  const {
    sceneEntries,
    persistedSelectedSceneId,
    previewMode,
    previewTargetSceneId,
    scenes,
    fixtures,
    bridgeReachable,
  } = rig;
  const { startBusy, toast, finishBusy, uiMode, undoStack, undoTargets, busyActions, reportError } = session;
  const [sceneRenderPreviewId, setSceneRenderPreviewId] = useState<string | null>(null);

  // The Fade is the hardware link's, saved (2026-10-03): the Stream Deck's
  // RECALL fades with it too, so the page shows and sets the one value.
  const recallFadeMs = lightingSnapshot?.recallFadeMs ?? 0;
  const setRecallFadeMs = useCallback(
    (fadeMs: number) => {
      void store.updateLightingSettings({ recallFadeMs: fadeMs }).catch((error: unknown) => {
        reportError(error, "The Fade could not be saved.");
      });
    },
    [reportError, store]
  );
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
  const liveScene = useMemo(
    () => scenes.find((scene) => scene.id === liveActiveSceneId) ?? null,
    [scenes, liveActiveSceneId]
  );

  // The visual overhaul's Lighting page (2026-10-04): whether the rig has left
  // its scene is the hardware link's word (`sceneState`, decided once for the
  // screen and the deck's RECALL): the rig as a running fade will leave it,
  // without the highlight, solo and identify overlays, against the scene last
  // put on the rig. Until then the page compared the fixtures itself, overlays
  // and a fade's middle included, against the scene last clicked, so it could
  // say UNSAVED where the deck said ON RIG. In preview the word is the
  // hardware link's `previewDirty`: edits made in the preview.
  const sceneState = lightingSnapshot?.sceneState ?? "none";
  const rigLeftScene = !previewMode && sceneState === "unsaved";
  const previewDirty = previewMode && lightingSnapshot?.previewDirty === true;
  const effectiveSceneModified = previewMode ? previewDirty : rigLeftScene;
  const modifiedSceneId = rigLeftScene ? liveActiveSceneId : null;
  /** The scene the state display speaks of: the preview's, else the rig's. */
  const stateScene = previewMode ? activeScene : liveScene;

  // Unsaved-changes guard. When the active scene is drifted, intercept any
  // workspace switch (the header's tabs, Setup's keys) with a confirmation
  // dialog. The guard fn returns a Promise resolved by the user's click on
  // the dialog.
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
        const sceneTarget = undoTargets.created("scene", createdId);
        // I6 — the newly-saved scene heads the search field's Recent list.
        pushRecentScene(createdId);
        setLastSavedAt(new Date());
        // Push undo: deleting the just-created scene. Once undone the entry
        // is gone; there is no redo (new pages program, Slice 3, decision 5).
        // It deletes the scene under the id it has now, and is refused once
        // the scene is gone (Slice 3 review, finding 17), or no longer has the
        // name it was saved under: the deck can delete it and save another
        // under its id while the page is closed (the review of #263).
        const savedName = typeof created?.name === "string" ? created.name : name;
        undoStack.push({
          label: `Save scene ${name}`,
          undo: async () => {
            const sceneId = sceneTarget.id;
            const scene = sceneId === null ? undefined : rigNow(store).scenes.find((entry) => entry.id === sceneId);
            if (sceneId === null || !scene) {
              throw new UndoRefusedError("the scene has been deleted");
            }
            if (scene.name !== savedName) {
              throw new UndoRefusedError(`the scene is ${scene.name} now, not ${savedName}`);
            }
            await store.deleteLightingScene(sceneId);
            undoTargets.deleted(sceneTarget);
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

  // "Save changes" writes the rig into the scene the rig holds (the hardware
  // link's live scene), or the preview into the preview's scene: until
  // 2026-10-04 it wrote into the scene last clicked, which a refused recall
  // could leave as some other scene than the one on the rig.
  const handleResaveScene = useLiveCallback(async (overrideSceneId?: string) => {
    const target =
      (typeof overrideSceneId === "string" ? scenes.find((scene) => scene.id === overrideSceneId) : null) ?? stateScene;
    if (!target) return;
    startBusy("scene-resave");
    try {
      const sceneId = target.id;
      const sceneName = target.name;
      await store.updateLightingScene({ sceneId, captureCurrentState: true });
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
        }
      : null;
    // The scene and the fixtures its states name, followed through the ids an
    // undo gives them (Slice 3 review, finding 17).
    const sceneTarget = undoTargets.of("scene", sceneId);
    const fixtureTargets = (targetSnapshot?.fixtureStates ?? []).map((state) =>
      undoTargets.of("fixture", state.fixtureId)
    );
    startBusy("scene-delete");
    try {
      await store.deleteLightingScene(sceneId);
      undoTargets.deleted(sceneTarget);
      if (targetSnapshot) {
        undoStack.push({
          label: `Delete scene ${targetSnapshot.name}`,
          undo: async () => {
            // A fixture brought back since is named by its new id; one deleted
            // since leaves the scene, which the hardware link would otherwise
            // refuse whole. With none of them left there is nothing to restore.
            const onRig = new Set(rigNow(store).fixtures.map((fixture) => fixture.id));
            const fixtureStates = targetSnapshot.fixtureStates.flatMap((state, index) => {
              const fixtureId = fixtureTargets[index]?.id ?? null;
              return fixtureId !== null && onRig.has(fixtureId) ? [{ ...state, fixtureId }] : [];
            });
            if (fixtureStates.length === 0) {
              throw new UndoRefusedError("every fixture it held has been deleted");
            }
            const result = asRecord(
              await store.createLightingScene({
                name: targetSnapshot.name,
                fixtureStates,
                colorIndex: targetSnapshot.colorIndex,
              })
            );
            const created = asRecord(result?.scene);
            const restoredId = typeof created?.id === "string" ? created.id : null;
            if (restoredId) {
              undoTargets.restored(sceneTarget, restoredId);
              if (targetSnapshot.pinned) {
                await store.pinLightingScene(restoredId, true);
              }
            }
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
        message: "Patch mode is on. Press Patch to leave it, then recall the scene.",
        tone: "attention",
      });
      return;
    }
    // I6 — every recall heads the search field's Recent list.
    pushRecentScene(sceneId);
    // Wave 30b — click is the user's commitment to a scene; cancel any
    // hover preview synchronously so the inspector doesn't show a stale
    // hovered scene during the 200 ms mouseleave grace window after the
    // recall flips activeSceneId.
    cancelHoverPreviewSync();
    // Show the scene on the plate at once, even when the recall is refused
    // (the bridge has not passed its probe): the operator still sees what the
    // scene holds. The plot draws the scene's look only once its recall went
    // out (2026-10-04): a refused recall leaves the rig, and the plot, as they
    // were.
    setInspectorSelectedSceneId(sceneId);
    if (!bridgeReachable && !previewMode) {
      // Skip the IPC entirely when the bridge is unreachable — the engine
      // would just reject it. Surface a single non-error toast so the
      // operator knows recall is preview-only and not a failed action. The
      // visual overhaul's polish (2026-10-05): in UNREACHABLE's words; it said
      // "not answering", which is another state's word.
      toast.push({
        message:
          "The bridge has not passed its probe, so this only shows what the scene holds. Open Setup to check the bridge.",
        tone: "attention",
      });
      return;
    }
    const busyKey = `scene:${sceneId}`;
    startBusy(busyKey);
    setSceneRenderPreviewId(sceneId);
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
      setSceneRenderPreviewId(null);
      reportError(error, "Scene recall failed.");
    } finally {
      finishBusy(busyKey);
    }
  });

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

  // 24 h, as the clock (the visual overhaul, 2026-10-05).
  const lastSavedLabel = lastSavedAt
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(lastSavedAt)
    : undefined;
  return {
    recallFadeMs,
    setRecallFadeMs,
    hoverPreviewSceneId,
    handleHoverPreview,
    handleHoverPreviewClear,
    liveActiveSceneId,
    liveScene,
    sceneState,
    stateScene,
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
    renamingSceneIds,
    lastSavedLabel,
  };
}

export type LightingSceneEditor = ReturnType<typeof useLightingSceneEditor>;
