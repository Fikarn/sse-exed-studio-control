import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { type StudioTalentMark, STUDIO_LAYOUT } from "../studioLayout";
import { sceneMatchesFixtures } from "../lightingDrift";
import { useLiveCallback } from "../../shared/useLiveCallback";
import { useStagePlotViewport } from "../useStagePlotViewport";
import { asRecord } from "../../shellData";
import { UndoRefusedError } from "../useUndoStack";
import { lightingFixtureChannelCount } from "../lightingPatch";
import {
  type FixtureValuePreviewFields,
  resolveTalentMarks,
  type PreviewableFixtureValue,
  type FixtureValuePreviewPhase,
  fixtureValuePreviewMatches,
  FIXTURE_VALUE_PREVIEW_TIMEOUT_MS,
  fixturesWithSceneState,
  clampStudioMeters,
  toShellTalentMarks,
  pushUndoOutcomeToast,
  scenesSavedWithAddedFixture,
  type AddedFixtureState,
  type LightingWorkspaceSurfaceProps,
} from "../lightingWorkspaceModel";
import type { LightingRig } from "./useLightingRig";
import type { LightingSession } from "./useLightingSession";
import type { LightingSceneEditor } from "./useLightingSceneEditor";

/** Fixtures and the plot: the selection, values shown while a slider is held,
 *  talent marks, the plot's viewport, and every fixture edit - add, rename,
 *  delete, power, intensity, CCT, patch, position, group, identify, highlight,
 *  solo and find. */
export function useLightingFixtureEditor({
  props,
  rig,
  session,
  sceneEditor,
}: {
  props: LightingWorkspaceSurfaceProps;
  rig: LightingRig;
  session: LightingSession;
  sceneEditor: LightingSceneEditor;
}) {
  const { appSnapshot, lightingFixtureCatalogSnapshot, store } = props;
  const { fixtures, persistedSelectedFixtureId, previewMode, highlightActive, soloActive } = rig;
  const {
    setSelectedGroupId,
    operatorLayout,
    setInspectorDrawerOpen,
    startBusy,
    finishBusy,
    undoStack,
    scenesRef,
    toast,
    setUiMode,
    reportError,
  } = session;
  const { sceneRenderPreview, activeScene } = sceneEditor;
  const [fixtureValuePreviews, setFixtureValuePreviews] = useState<ReadonlyMap<string, FixtureValuePreviewFields>>(
    () => new Map()
  );

  const persistedTalentMarks = useMemo(() => resolveTalentMarks(appSnapshot), [appSnapshot]);
  const [optimisticTalentMarks, setOptimisticTalentMarks] = useState<readonly StudioTalentMark[] | null>(null);
  useEffect(() => {
    setOptimisticTalentMarks(null);
  }, [appSnapshot]);
  const displayedTalentMarks = optimisticTalentMarks ?? persistedTalentMarks;
  const studioLayout = useMemo(
    () => ({
      ...STUDIO_LAYOUT,
      talentMarks: displayedTalentMarks,
    }),
    [displayedTalentMarks]
  );

  // Frontend-only multi-select. The persisted single id (read from snapshot)
  // is the "primary" focus that's synced to the engine; the set tracks the
  // fixtures added to the selection alongside it (Add to selection, or a box
  // drag) so the bulk inspector can edit them together. Cleared on workspace
  // switch / hot reload by being state.
  const [extraSelectedFixtureIds, setExtraSelectedFixtureIds] = useState<ReadonlySet<string>>(() => new Set());
  // New pages program, Slice 3 (decision 10): the plot toolbar's Add to
  // selection key. While it is lit, a click (or Enter / Space) on a marker adds
  // that fixture to the selection or takes it out, and a box drag adds to the
  // selection; while it is off, a click selects only that fixture and a box
  // replaces the selection. It replaces the keys held while pointing.
  const [addToSelection, setAddToSelection] = useState(false);
  // Mirror identify-burst pulses on the plot marker. 1.2 s window matches
  // engine identify.rs default. Cleared by setTimeout in handleIdentifyBurst.
  const [identifyingIds, setIdentifyingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Wave 29 — Find sequence pulse timers. Each call to handleIdentifyFind
  // schedules 2N timers (start + stop per fixture); cleared on Stop /
  // workspace switch / new sequence start so prior runs don't leak through.
  const findSequenceTimersRef = useRef<number[]>([]);
  const clearFindSequenceTimers = useCallback(() => {
    for (const handle of findSequenceTimersRef.current) {
      window.clearTimeout(handle);
    }
    findSequenceTimersRef.current = [];
  }, []);
  // New pages program, Slice 3 (decision 6): while a Find runs, the Find key
  // reads "Stop". It runs from the hardware link's reply until the last flash
  // ends, a timer mirroring the flashes the link scheduled.
  const [findRunning, setFindRunning] = useState(false);
  const findEndTimerRef = useRef<number | null>(null);
  const clearFindEndTimer = useCallback(() => {
    if (findEndTimerRef.current !== null) {
      window.clearTimeout(findEndTimerRef.current);
      findEndTimerRef.current = null;
    }
  }, []);

  const setFixtureValuePreview = useCallback(
    (fixtureId: string, field: PreviewableFixtureValue, value: number, phase: FixtureValuePreviewPhase) => {
      setFixtureValuePreviews((current) => {
        const next = new Map(current);
        next.set(fixtureId, {
          ...(next.get(fixtureId) ?? {}),
          [field]: { phase, value },
        });
        return next;
      });
    },
    []
  );

  const setBulkFixtureValuePreview = useCallback(
    (
      values: ReadonlyArray<{ fixtureId: string; value: number }>,
      field: PreviewableFixtureValue,
      phase: FixtureValuePreviewPhase
    ) => {
      setFixtureValuePreviews((current) => {
        const next = new Map(current);
        for (const entry of values) {
          next.set(entry.fixtureId, {
            ...(next.get(entry.fixtureId) ?? {}),
            [field]: { phase, value: entry.value },
          });
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (fixtureValuePreviews.size === 0) return undefined;
    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

    setFixtureValuePreviews((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [fixtureId, fields] of current) {
        const fixture = fixtureById.get(fixtureId);
        if (!fixture) {
          next.delete(fixtureId);
          changed = true;
          continue;
        }

        const nextFields: FixtureValuePreviewFields = { ...fields };
        for (const field of ["intensity", "cct"] as const) {
          const preview = fields[field];
          if (preview?.phase === "committing" && fixtureValuePreviewMatches(fixture, field, preview.value)) {
            delete nextFields[field];
            changed = true;
          }
        }

        if (Object.keys(nextFields).length === 0) {
          next.delete(fixtureId);
        } else {
          next.set(fixtureId, nextFields);
        }
      }
      return changed ? next : current;
    });

    const timeoutId = window.setTimeout(() => {
      setFixtureValuePreviews((current) => {
        let changed = false;
        const next = new Map(current);
        for (const [fixtureId, fields] of current) {
          const nextFields: FixtureValuePreviewFields = { ...fields };
          for (const field of ["intensity", "cct"] as const) {
            if (fields[field]?.phase === "committing") {
              delete nextFields[field];
              changed = true;
            }
          }
          if (Object.keys(nextFields).length === 0) {
            next.delete(fixtureId);
          } else {
            next.set(fixtureId, nextFields);
          }
        }
        return changed ? next : current;
      });
    }, FIXTURE_VALUE_PREVIEW_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [fixtures, fixtureValuePreviews]);

  const stagePlotFixtures = useMemo(() => {
    const baseFixtures = sceneRenderPreview ? fixturesWithSceneState(fixtures, sceneRenderPreview) : fixtures;
    if (fixtureValuePreviews.size === 0) return baseFixtures;
    return baseFixtures.map((fixture) => {
      const preview = fixtureValuePreviews.get(fixture.id);
      if (!preview) return fixture;
      return {
        ...fixture,
        intensity: preview.intensity?.value ?? fixture.intensity,
        cct: preview.cct?.value ?? fixture.cct,
      };
    });
  }, [fixtures, fixtureValuePreviews, sceneRenderPreview]);

  const stagePlotActiveScene = sceneRenderPreview ?? activeScene;
  const stagePlotSceneModified = useMemo(() => {
    if (!stagePlotActiveScene) return false;
    return !sceneMatchesFixtures(stagePlotFixtures, stagePlotActiveScene, lightingFixtureCatalogSnapshot);
  }, [lightingFixtureCatalogSnapshot, stagePlotActiveScene, stagePlotFixtures]);

  const handleTalentMarkPositionCommit = useLiveCallback(async (id: string, xMeters: number, yMeters: number) => {
    const nextMarks = displayedTalentMarks.map((mark) =>
      mark.id === id
        ? {
            ...mark,
            xMeters: Math.round(clampStudioMeters(xMeters, STUDIO_LAYOUT.roomWidthMeters) * 100) / 100,
            yMeters: Math.round(clampStudioMeters(yMeters, STUDIO_LAYOUT.roomDepthMeters) * 100) / 100,
          }
        : mark
    );
    setOptimisticTalentMarks(nextMarks);
    try {
      await store.setLightingTalentMarks(toShellTalentMarks(nextMarks));
    } catch (error) {
      setOptimisticTalentMarks(null);
      reportError(error, "Talent mark move failed.");
    }
  });

  // F2 — marquee commit handler. `ids` is the full set inside the released
  // rectangle. With `additive: true` (Add to selection lit) the existing
  // extras + primary are preserved and the new ids merge in — the first of
  // them becoming the primary when nothing is focused yet, so the plate shows
  // the selection; otherwise the persisted single-selection is replaced by the
  // rectangle's first hit (or cleared if empty) and extras carry the rest.
  const handleMarqueeSelect = useLiveCallback(async (ids: readonly string[], options: { additive: boolean }) => {
    if (options.additive) {
      const incoming = ids.filter((id) => id !== persistedSelectedFixtureId);
      if (incoming.length === 0) return;
      setSelectedGroupId(null);
      const promoted = persistedSelectedFixtureId === null ? incoming[0]! : null;
      setExtraSelectedFixtureIds((prev) => {
        const next = new Set(prev);
        for (const id of incoming) {
          if (id !== promoted) next.add(id);
        }
        if (promoted !== null) next.delete(promoted);
        return next;
      });
      if (promoted !== null) {
        await store.updateLightingSettings({ selectedFixtureId: promoted });
      }
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

  // Wave 31 — I9 remove-from-selection. The chip's × means "take this fixture
  // out of the selection", and so does a click on a selected marker while Add
  // to selection is lit. When removing the primary we promote the first extra
  // so the inspector still has a focused fixture; if no extras remain,
  // primary clears to null.
  const handleRemoveFromSelection = useLiveCallback(async (fixtureId: string) => {
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

  const handleSelectFixture = useLiveCallback(
    async (fixtureId: string | null, options: { additive?: boolean } = {}) => {
      const { additive = false } = options;
      setSelectedGroupId(null);

      if (fixtureId === null) {
        setExtraSelectedFixtureIds(new Set());
        if (operatorLayout.isNarrow) setInspectorDrawerOpen(false);
      } else if (additive) {
        // Add to selection (decision 10): a fixture already in the selection
        // comes out of it, the focused one included; any other joins it. The
        // focused fixture stays focused, so the engine is not asked to change
        // it — unless nothing is focused yet, when the fixture that joins
        // becomes the focused one and the plate shows the selection.
        if (operatorLayout.isNarrow) setInspectorDrawerOpen(true);
        if (fixtureId === persistedSelectedFixtureId || extraSelectedFixtureIds.has(fixtureId)) {
          await handleRemoveFromSelection(fixtureId);
          return;
        }
        if (persistedSelectedFixtureId !== null) {
          setExtraSelectedFixtureIds((prev) => new Set(prev).add(fixtureId));
          return;
        }
      } else {
        setExtraSelectedFixtureIds(new Set());
        if (operatorLayout.isNarrow) setInspectorDrawerOpen(true);
      }

      startBusy("fixture-select");
      try {
        await store.updateLightingSettings({ selectedFixtureId: fixtureId });
      } catch (error) {
        reportError(error, "Could not change the selection. Click the fixture again.");
      } finally {
        finishBusy("fixture-select");
      }
    }
  );

  const selectedFixtureIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set(extraSelectedFixtureIds);
    if (persistedSelectedFixtureId) set.add(persistedSelectedFixtureId);
    return set;
  }, [extraSelectedFixtureIds, persistedSelectedFixtureId]);

  const selectedFixtureSnapshots = useMemo(
    () => fixtures.filter((fixture) => selectedFixtureIds.has(fixture.id)),
    [fixtures, selectedFixtureIds]
  );

  // Wave 31 — stage plot viewport hook lifted to the workspace level; StagePlot
  // consumes the same instance via its `viewport` prop (the view slots' keys
  // on the plot toolbar reach the bookmark API through it). handleSelectFixture
  // is `useLiveCallback`-stable so closing over it is safe.
  const stagePlotViewport = useStagePlotViewport({
    // DENSITY-04 — the full-bleed studioFull view now rests on the content frame
    // (the populated rig fills the canvas instead of stretching the empty room);
    // compact/utility panes keep the full-room fit for spatial proportion.
    defaultZoomMode: operatorLayout.layoutMode === "studioFull" ? "fitContent" : "fitRoom",
    onBackgroundClick: () => void handleSelectFixture(null),
    storageScope: operatorLayout.layoutMode,
  });

  // Wave 31 — I9 chip-hover signal. SelectionChipStrip writes the hovered
  // fixture id here; StagePlot reads it to mark the matching FixtureMarker
  // for the soft pulse ring. Null when no chip is hovered or the strip
  // isn't mounted (selection empty).
  const [chipHoverFixtureId, setChipHoverFixtureId] = useState<string | null>(null);

  const handleAddFixture = useLiveCallback(
    async (fixtureSpec: {
      name: string;
      type: string;
      definitionId: string;
      modeId: string;
      universe: number;
      dmxStartAddress: number;
    }) => {
      startBusy("fixture-create");
      try {
        const result = asRecord(await store.createLightingFixture(fixtureSpec));
        const createdFixture = asRecord(result?.fixture);
        const createdFixtureId = typeof createdFixture?.id === "string" ? createdFixture.id : null;
        if (createdFixtureId) {
          await store.updateLightingSettings({ selectedFixtureId: createdFixtureId });

          // Push undo: deleting the just-created fixture. Refuses if a scene
          // saved after the add holds the fixture (`scenesSavedWithAddedFixture`:
          // the fixture the hardware link put into every scene on the add does
          // not count), since the delete would take it out of that saved state.
          const sceneIdsAtAdd = new Set(scenesRef.current.map((scene) => scene.id));
          const addedControlValues = asRecord(createdFixture?.controlValues) ?? {};
          const added: AddedFixtureState = {
            intensity: Number(createdFixture?.intensity),
            cct: Number(createdFixture?.cct),
            on: createdFixture?.on === true,
            controlValues: Object.fromEntries(
              Object.entries(addedControlValues).filter(
                (entry): entry is [string, number] => typeof entry[1] === "number"
              )
            ),
          };
          undoStack.push({
            label: `Add fixture ${fixtureSpec.name}`,
            undo: async () => {
              const refs = scenesSavedWithAddedFixture(scenesRef.current, createdFixtureId, sceneIdsAtAdd, added);
              if (refs > 0) {
                throw new UndoRefusedError(
                  `fixture is referenced by ${refs} scene${refs === 1 ? "" : "s"} saved after it was added`
                );
              }
              await store.deleteLightingFixture(createdFixtureId);
            },
          });
        }
        // New pages program, Slice 3 (decision 5): "Fixture added." carries an
        // Undo like the messages of the other three steps.
        toast.push({
          message: String(result?.summary ?? "Fixture added."),
          tone: "ok",
          action: createdFixtureId
            ? {
                label: "Undo",
                onClick: () => void undoStack.undo().then((outcome) => pushUndoOutcomeToast(toast, outcome)),
              }
            : undefined,
        });
      } catch (error) {
        reportError(error, "Lighting fixture create failed.");
      } finally {
        finishBusy("fixture-create");
      }
    }
  );

  const handleRenameFixture = useLiveCallback(async (fixtureId: string, name: string) => {
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

  const handleToggleFixturePower = useLiveCallback(async (fixtureId: string, on: boolean) => {
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

  const handleIntensityCommit = useLiveCallback(async (fixtureId: string, intensity: number) => {
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

  const handleCctCommit = useLiveCallback(async (fixtureId: string, cct: number) => {
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

  const handleControlValuesCommit = useLiveCallback(
    async (fixtureId: string, controlValues: Record<string, number>) => {
      const busyKey = `fixture-controls:${fixtureId}`;
      startBusy(busyKey);
      try {
        await store.updateLightingFixture({ fixtureId, controlValues });
      } catch (error) {
        reportError(error, "Fixture control update failed.");
      } finally {
        finishBusy(busyKey);
      }
    }
  );

  const handlePatchCommit = useLiveCallback(async (fixtureId: string, dmxStartAddress: number) => {
    const busyKey = `fixture-patch:${fixtureId}`;
    startBusy(busyKey);
    try {
      await store.updateLightingFixture({ fixtureId, dmxStartAddress });
      // Auto-advance to the next unpaired fixture (dmxStartAddress < 1).
      // Excludes the just-patched id since the snapshot may not have caught
      // up. If none remain, exit patch mode.
      const remaining = fixtures.filter(
        (candidate) =>
          candidate.id !== fixtureId &&
          candidate.dmxStartAddress < 1 &&
          lightingFixtureChannelCount(candidate, lightingFixtureCatalogSnapshot) > 0
      );
      if (remaining.length > 0) {
        const next = remaining[0]!;
        try {
          await store.updateLightingSettings({ selectedFixtureId: next.id });
          setExtraSelectedFixtureIds(new Set());
          toast.push({ message: `Patched. Now patching ‘${next.name}’.`, tone: "ok" });
        } catch (error) {
          reportError(error, "Patched. Could not move on to the next fixture — pick one on the plot.");
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

  const handleIdentifyBurst = useLiveCallback(async (fixtureId: string, fixtureName: string) => {
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
  const handleToggleHighlight = useLiveCallback(async () => {
    if (previewMode) {
      toast.push({ message: "Exit preview to use live Highlight.", tone: "attention" });
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
      toast.push({ message: "Select fixtures to enable Highlight.", tone: "attention" });
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
  const handleToggleSolo = useLiveCallback(async () => {
    if (previewMode) {
      toast.push({ message: "Exit preview to use live Solo.", tone: "attention" });
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
      toast.push({ message: "Select fixtures to enable Solo.", tone: "attention" });
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
  const handleIdentifyFind = useLiveCallback(async () => {
    if (previewMode) {
      toast.push({ message: "Exit preview to use live Find.", tone: "attention" });
      return;
    }
    if (selectedFixtureIds.size === 0) {
      toast.push({ message: "Select fixtures to enable Find.", tone: "attention" });
      return;
    }
    const ids = Array.from(selectedFixtureIds);
    const stepMs = 500;
    const durationMs = 400;
    clearFindSequenceTimers();
    clearFindEndTimer();
    startBusy("identify-find");
    try {
      await store.startLightingIdentifySequence(ids, stepMs, durationMs);
      toast.push({
        message: `Finding ${ids.length} fixture${ids.length === 1 ? "" : "s"}…`,
        tone: "ok",
      });
      // The Find key reads "Stop" until the last flash ends.
      setFindRunning(true);
      findEndTimerRef.current = window.setTimeout(
        () => {
          findEndTimerRef.current = null;
          setFindRunning(false);
        },
        (ids.length - 1) * stepMs + durationMs
      );
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

  // New pages program, Slice 3 (decision 6): the Find key reads "Stop" while a
  // Find runs, and pressing it stops the sequence, the flashes still waiting
  // included (the page-wide Esc that did this is gone). The pulse rings and the
  // key go back only once the hardware link has stopped the flashes; if it
  // could not, the key still reads "Stop" and says to press it again.
  const handleStopFind = useLiveCallback(async () => {
    startBusy("identify-find-stop");
    try {
      await store.clearLightingIdentifyBursts();
      clearFindSequenceTimers();
      clearFindEndTimer();
      setIdentifyingIds(() => new Set());
      setFindRunning(false);
    } catch (error) {
      reportError(error, "Could not stop the Find sequence. Press Stop again.");
    } finally {
      finishBusy("identify-find-stop");
    }
  });

  // Workspace-switch cleanup. Clears highlight + solo overlays in the engine
  // and stops a running Find, its pulse timers included. Each IPC is gated on
  // whether there's anything to clear so a quiet switch doesn't burn
  // round-trips. useLiveCallback semantics keep the gate readings fresh.
  const clearOverlaysAndSequence = useLiveCallback(async () => {
    const findWasRunning = findSequenceTimersRef.current.length > 0 || findEndTimerRef.current !== null;
    clearFindSequenceTimers();
    clearFindEndTimer();
    if (identifyingIds.size > 0) {
      setIdentifyingIds(() => new Set());
    }
    if (highlightActive || soloActive) {
      try {
        await store.highlightLightingFixtures([], "off");
      } catch (error) {
        reportError(error, "Could not clear Highlight and Solo. Press the lit key again.");
      }
    }
    if (findWasRunning) {
      try {
        await store.clearLightingIdentifyBursts();
      } catch (error) {
        // The Lighting page is gone, and with it the Stop key; the flashes the
        // hardware link scheduled end by themselves.
        reportError(error, "Could not stop the Find sequence. It ends by itself.");
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
  }, [clearOverlaysAndSequence]);

  const handleDeleteFixture = useLiveCallback(async (fixtureId: string) => {
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
        undoStack.push({
          label: `Delete fixture ${snapshot.name}`,
          undo: async () => {
            const result = asRecord(
              await store.createLightingFixture({
                name: snapshot.name,
                type: snapshot.type,
                definitionId: snapshot.definitionId,
                modeId: snapshot.modeId,
                universe: snapshot.universe,
                dmxStartAddress: snapshot.dmxStartAddress > 0 ? snapshot.dmxStartAddress : 1,
                groupId: snapshot.groupId ?? undefined,
              })
            );
            const created = asRecord(result?.fixture);
            const newId = typeof created?.id === "string" ? created.id : null;
            if (newId) {
              await store.updateLightingFixture({
                fixtureId: newId,
                intensity: snapshot.intensity,
                cct: snapshot.cct,
                on: snapshot.on,
                spatialX: snapshot.spatialX ?? null,
                spatialY: snapshot.spatialY ?? null,
                spatialRotation: snapshot.spatialRotation,
                rigZ: snapshot.rigZ ?? null,
                beamAngleDegrees: snapshot.beamAngleDegrees ?? null,
              });
            }
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

  const handleBulkTogglePower = useLiveCallback(async (fixtureIds: readonly string[], on: boolean) => {
    startBusy("fixture-bulk-power");
    try {
      await Promise.all(fixtureIds.map((fixtureId) => store.updateLightingFixture({ fixtureId, on })));
      toast.push({
        message: `Set ${fixtureIds.length} fixture${fixtureIds.length === 1 ? "" : "s"} ${on ? "on" : "off"}.`,
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
  const handleBulkIntensityValues = useLiveCallback(
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

  const handleBulkCctValues = useLiveCallback(async (values: ReadonlyArray<{ fixtureId: string; value: number }>) => {
    startBusy("fixture-bulk-cct");
    try {
      await Promise.all(values.map(({ fixtureId, value }) => store.updateLightingFixture({ fixtureId, cct: value })));
    } catch (error) {
      reportError(error, "Bulk CCT update failed.");
    } finally {
      finishBusy("fixture-bulk-cct");
    }
  });

  const handleFixtureSpatialCommit = useLiveCallback(
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
      const nextPartial = { ...partial };
      if (typeof nextPartial.spatialX === "number") {
        nextPartial.spatialX = clampStudioMeters(nextPartial.spatialX, STUDIO_LAYOUT.roomWidthMeters);
      }
      if (typeof nextPartial.spatialY === "number") {
        nextPartial.spatialY = clampStudioMeters(nextPartial.spatialY, STUDIO_LAYOUT.roomDepthMeters);
      }
      startBusy(busyKey);
      try {
        await store.updateLightingFixture({ fixtureId, ...nextPartial });
      } catch (error) {
        reportError(error, "Could not move the fixture on the plot. Try the drag again.");
      } finally {
        finishBusy(busyKey);
      }
    }
  );

  const handleAssignFixtureGroup = useLiveCallback(async (fixtureId: string, groupId: string | null) => {
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

  return {
    studioLayout,
    addToSelection,
    setAddToSelection,
    identifyingIds,
    setFixtureValuePreview,
    setBulkFixtureValuePreview,
    stagePlotFixtures,
    stagePlotActiveScene,
    stagePlotSceneModified,
    handleTalentMarkPositionCommit,
    handleMarqueeSelect,
    handleSelectFixture,
    selectedFixtureIds,
    selectedFixtureSnapshots,
    stagePlotViewport,
    chipHoverFixtureId,
    setChipHoverFixtureId,
    handleRemoveFromSelection,
    handleAddFixture,
    handleRenameFixture,
    handleToggleFixturePower,
    handleIntensityCommit,
    handleCctCommit,
    handleControlValuesCommit,
    handlePatchCommit,
    handleIdentifyBurst,
    handleToggleHighlight,
    handleToggleSolo,
    handleIdentifyFind,
    findRunning,
    handleStopFind,
    handleDeleteFixture,
    handleBulkTogglePower,
    handleBulkIntensityValues,
    handleBulkCctValues,
    handleFixtureSpatialCommit,
    handleAssignFixtureGroup,
  };
}

export type LightingFixtureEditor = ReturnType<typeof useLightingFixtureEditor>;
