import { useEffect } from "react";
import { formatShortcut } from "../../shared/shortcutGlyphs";
import type { PaletteAction } from "@sse/design-system";
import { isEditableTarget } from "../../shellData";
import { useLiveCallback } from "../../shared/useLiveCallback";
import type { UndoOutcome } from "../useUndoStack";
import type { ViewBookmarkSlot } from "../useStagePlotViewport";
import {
  RECALL_FADE_PRESETS_MS,
  formatRecallFade,
  type LightingWorkspaceSurfaceProps,
} from "../lightingWorkspaceModel";
import type { LightingRig } from "./useLightingRig";
import type { LightingSession } from "./useLightingSession";
import type { LightingSceneEditor } from "./useLightingSceneEditor";
import type { LightingFixtureEditor } from "./useLightingFixtureEditor";
import type { LightingRigControls } from "./useLightingRigControls";

/** The two ways in that are not a pointer: the Lighting actions on the command
 *  palette, and the workspace's keyboard shortcuts (with undo and redo). The
 *  quick-palette key listener is registered before the shortcut listener, as
 *  it always was: its Escape must win. */
export function useLightingCommands({
  props,
  rig,
  session,
  sceneEditor,
  fixtureEditor,
  rigControls,
}: {
  props: LightingWorkspaceSurfaceProps;
  rig: LightingRig;
  session: LightingSession;
  sceneEditor: LightingSceneEditor;
  fixtureEditor: LightingFixtureEditor;
  rigControls: LightingRigControls;
}) {
  const { store } = props;
  const { previewMode, bridgeReachable, palettes, scenes, persistedSelectedFixtureId, fixtures } = rig;
  const {
    uiMode,
    palette,
    handleTogglePatch,
    setSaveSceneAsOpen,
    requestAddFixture,
    setDmxMonitorOpen,
    requestEmergencyCut,
    toast,
    startBusy,
    undoStack,
    finishBusy,
    setSelectedGroupId,
    reportError,
  } = session;
  const {
    previewDirty,
    handleTogglePreview,
    handleResaveScene,
    effectiveSceneModified,
    handleRecallScene,
    activeScene,
    setRecallFadeMs,
    hoverPreviewSceneId,
    handleSaveScene,
  } = sceneEditor;
  const {
    selectedFixtureIds,
    stagePlotViewport,
    handleFixtureNudge,
    setExtraSelectedFixtureIds,
    handleToggleSolo,
    handleIdentifyFind,
    handleToggleHighlight,
    handleSelectFixture,
    clearOverlaysAndSequence,
  } = fixtureEditor;
  const { handleApplyPalette, paletteQuickOpen, setPaletteQuickOpen, setPaletteQuickQuery } = rigControls;
  // Wave 28a — register lighting actions on the cross-workspace ⌘K palette.
  // Re-registers when the scene list / mode-relevant flags change so per-scene
  // recall actions stay current and the `when` predicates capture fresh state.
  // Handlers are useLiveCallback and intentionally not in the dep array.
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
        label: previewMode ? (previewDirty ? "Exit preview mode…" : "Exit preview mode") : "Enter preview mode",
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
        shortcut: formatShortcut(["shift", "S"]),
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
        shortcut: formatShortcut(["mod", "shift", "M"]),
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
    setDmxMonitorOpen,
    setSaveSceneAsOpen,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && paletteQuickOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPaletteQuickOpen(false);
        return;
      }
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteQuickOpen(true);
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paletteQuickOpen, setPaletteQuickOpen]);

  useEffect(() => {
    if (!paletteQuickOpen) setPaletteQuickQuery("");
  }, [paletteQuickOpen, setPaletteQuickQuery]);

  const reportUndoOutcome = useLiveCallback((outcome: UndoOutcome, kind: "Undo" | "Redo") => {
    switch (outcome.kind) {
      case "ok":
        toast.push({
          message: `${kind === "Undo" ? "Undid" : "Redid"} ‘${outcome.label}’ · ${kind === "Undo" ? `${formatShortcut(["mod", "shift", "Z"])} to redo` : `${formatShortcut(["mod", "Z"])} to undo`}`,
          tone: "ok",
        });
        break;
      case "rejected":
        toast.push({
          message: `Cannot ${kind.toLowerCase()} ‘${outcome.label}’: ${outcome.reason}.`,
          tone: "attention",
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

  const triggerUndo = useLiveCallback(async () => {
    startBusy("undo");
    try {
      const outcome = await undoStack.undo();
      reportUndoOutcome(outcome, "Undo");
    } finally {
      finishBusy("undo");
    }
  });

  const triggerRedo = useLiveCallback(async () => {
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
          toast.push({ message: `Saved view ${slot + 1}. Shift+${slot + 1} recalls it.`, tone: "ok" });
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
            message: activeScene ? "Already saved." : "No scene is active. Press ⇧S to save the rig as a new scene.",
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
        // reads latest overlay state via useLiveCallback semantics so
        // calling it unconditionally avoids stale-closure traps; the
        // engine no-ops when there's nothing to clear.
        void clearOverlaysAndSequence();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeScene,
    clearOverlaysAndSequence,
    fixtures,
    handleFixtureNudge,
    handleIdentifyFind,
    handleTogglePatch,
    handleToggleHighlight,
    handleTogglePreview,
    handleToggleSolo,
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
    toast,
    triggerRedo,
    triggerUndo,
    setDmxMonitorOpen,
    setExtraSelectedFixtureIds,
    setRecallFadeMs,
    setSaveSceneAsOpen,
    setSelectedGroupId,
  ]);
}
