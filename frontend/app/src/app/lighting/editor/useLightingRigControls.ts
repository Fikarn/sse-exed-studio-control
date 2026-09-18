import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { LightingPaletteSnapshot, LightingPaletteKind } from "@sse/engine-client";
import { useLiveCallback } from "../../shared/useLiveCallback";
import { asRecord } from "../../shellData";
import { lightingPaletteMatchesQuery, type LightingWorkspaceSurfaceProps } from "../lightingWorkspaceModel";
import type { LightingRig } from "./useLightingRig";
import type { LightingSession } from "./useLightingSession";
import type { LightingSceneEditor } from "./useLightingSceneEditor";
import type { LightingFixtureEditor } from "./useLightingFixtureEditor";

/** The rig-wide controls: groups, palettes (and the quick palette panel), the
 *  grand master, all power and the emergency cut. */
export function useLightingRigControls({
  props,
  rig,
  session,
  sceneEditor,
  fixtureEditor,
}: {
  props: LightingWorkspaceSurfaceProps;
  rig: LightingRig;
  session: LightingSession;
  sceneEditor: LightingSceneEditor;
  fixtureEditor: LightingFixtureEditor;
}) {
  const { lightingSnapshot, store } = props;
  const { groups, fixtureEntries, palettes, previewMode } = rig;
  const { palette, startBusy, toast, finishBusy, uiMode, selectedGroupId, setSelectedGroupId, reportError } = session;
  const { activeScene } = sceneEditor;
  const { selectedFixtureIds } = fixtureEditor;
  const [paletteQuickOpen, setPaletteQuickOpen] = useState(false);
  const [paletteQuickQuery, setPaletteQuickQuery] = useState("");

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

  const paletteQuickQueryNormalized = paletteQuickQuery.trim().toLowerCase();

  const paletteById = useMemo(() => new Map(palettes.map((entry) => [entry.id, entry])), [palettes]);
  const recentQuickPalettes = useMemo(
    () =>
      palette.recentActionIds
        .filter((id) => id.startsWith("lighting:palette:"))
        .map((id) => paletteById.get(id.slice("lighting:palette:".length)))
        .filter((entry): entry is LightingPaletteSnapshot => Boolean(entry))
        .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index)
        .filter((entry) => lightingPaletteMatchesQuery(entry, paletteQuickQueryNormalized))
        .slice(0, 6),
    [palette.recentActionIds, paletteById, paletteQuickQueryNormalized]
  );
  const filteredQuickPalettes = useMemo(
    () => palettes.filter((entry) => lightingPaletteMatchesQuery(entry, paletteQuickQueryNormalized)),
    [palettes, paletteQuickQueryNormalized]
  );
  const quickIntensityPalettes = useMemo(
    () => filteredQuickPalettes.filter((entry) => entry.kind === "intensity"),
    [filteredQuickPalettes]
  );
  const quickCctPalettes = useMemo(
    () => filteredQuickPalettes.filter((entry) => entry.kind === "cct"),
    [filteredQuickPalettes]
  );

  const handleCreateGroup = useLiveCallback(async (name: string) => {
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

  // Wave 30b — F5 group reorder. Mirrors handleReorderScene shape; the engine
  // owns the persisted `group_order` (Wave 30a / `9ca8e5c`) and the snapshot
  // emits groups in that order, so we just hand the contract through and trust
  // the next snapshot tick to refresh the rail.
  const handleReorderGroup = useLiveCallback(async (groupId: string, beforeGroupId: string | null) => {
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

  // Wave 30b — I4 set group color tag. Mirrors scene shape.
  const handleSetGroupColor = useLiveCallback(async (groupId: string, colorIndex: number | null) => {
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

  const handleApplyPalette = useLiveCallback(async (paletteId: string, fixtureIds: readonly string[]) => {
    if (fixtureIds.length === 0) {
      toast.push({ message: "Select a fixture before applying a palette.", tone: "attention" });
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

  const handleCreatePalette = useLiveCallback(
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

  const handleUpdatePalette = useLiveCallback(
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

  const handleDeletePalette = useLiveCallback(async (paletteId: string) => {
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

  const handleRenameGroup = useLiveCallback(async (groupId: string, name: string) => {
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

  const handleDeleteGroup = useLiveCallback(async (groupId: string, groupName: string) => {
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

  const commitGrandMaster = useLiveCallback(async (value: number) => {
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

  const handleEmergencyCut = useLiveCallback(async () => {
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

  const handleToggleAllPower = useLiveCallback(async (on: boolean) => {
    startBusy("lighting-master-toggle");
    try {
      await store.setLightingAllPower(on);
      toast.push({
        message: previewMode ? `Preview fixtures ${on ? "on" : "off"}.` : on ? "Lighting resumed." : "Lighting paused.",
        tone: "ok",
      });
    } catch (error) {
      reportError(error, "Could not switch the rig on or off. Press Lighting again.");
    } finally {
      finishBusy("lighting-master-toggle");
    }
  });

  const handleToggleGroupPower = useLiveCallback(async (groupId: string, on: boolean) => {
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

  const paletteQuickDisabled = uiMode === "patch" || selectedFixtureIds.size === 0;
  const paletteQuickStatus =
    uiMode === "patch"
      ? "Exit patch mode to apply"
      : selectedFixtureIds.size === 0
        ? "Select fixtures to apply"
        : `${selectedFixtureIds.size} selected`;
  return {
    paletteQuickOpen,
    setPaletteQuickOpen,
    paletteQuickQuery,
    setPaletteQuickQuery,
    grandMasterDraft,
    railGroupEntries,
    recentQuickPalettes,
    filteredQuickPalettes,
    quickIntensityPalettes,
    quickCctPalettes,
    handleCreateGroup,
    handleReorderGroup,
    handleSetGroupColor,
    handleApplyPalette,
    handleCreatePalette,
    handleUpdatePalette,
    handleDeletePalette,
    handleRenameGroup,
    handleDeleteGroup,
    handleGrandMasterChange,
    handleEmergencyCut,
    handleToggleAllPower,
    handleToggleGroupPower,
    paletteQuickDisabled,
    paletteQuickStatus,
  };
}

export type LightingRigControls = ReturnType<typeof useLightingRigControls>;
