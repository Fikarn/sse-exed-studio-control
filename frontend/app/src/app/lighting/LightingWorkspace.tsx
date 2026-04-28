import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

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
import { LightingHealthBar } from "./components/LightingHealthBar";
import { LightingInspector, deriveInspectorTab, type LightingUiMode } from "./components/LightingInspector";
import type { InspectorTab } from "./components/LightingInspectorTabs";
import { LightingRail } from "./components/LightingRail";
import { LightingToolbar } from "./components/LightingToolbar";
import { StagePlot } from "./components/StagePlot";
import { renderSceneThumbnailDataUri, withSceneThumbRemoved, withSceneThumbUpserted } from "./sceneThumbnails";
import styles from "./LightingWorkspace.module.css";

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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [grandMaster, setGrandMaster] = useState(100);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Active scene = the most recently recalled scene (engine-tracked) falling
  // back to the persisted selectedSceneId. Kept lean — no persisted "active
  // cue" anywhere because the cue model is gone in Direction D.
  const activeSceneId = useMemo(() => {
    const recalled = sceneEntries.find((scene) => scene.lastRecalled);
    if (recalled) return recalled.id;
    if (persistedSelectedSceneId && sceneEntries.some((scene) => scene.id === persistedSelectedSceneId)) {
      return persistedSelectedSceneId;
    }
    return null;
  }, [sceneEntries, persistedSelectedSceneId]);

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
      return {
        id: group.id,
        name: group.name,
        fixtureCount: group.fixtureCount,
        on: allOn,
        level,
        drifted,
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

  const handleSelectFixture = useEffectEvent(async (fixtureId: string | null) => {
    setSelectedGroupId(null);
    setBusyAction("fixture-select");
    try {
      await store.updateLightingSettings({ selectedFixtureId: fixtureId });
    } catch (error) {
      reportError(error, "Lighting selection update failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleTogglePatch = useEffectEvent(() => {
    setUiMode((current) => (current === "patch" ? "recall" : "patch"));
  });

  const handleAddFixture = useEffectEvent(async () => {
    setBusyAction("fixture-create");
    try {
      const result = asRecord(
        await store.createLightingFixture({
          dmxStartAddress: 1,
          name: `Fixture ${fixtures.length + 1}`,
          type: "astra-bicolor",
        })
      );
      const createdFixture = asRecord(result?.fixture);
      const createdFixtureId = typeof createdFixture?.id === "string" ? createdFixture.id : null;
      if (createdFixtureId) {
        await store.updateLightingSettings({ selectedFixtureId: createdFixtureId });
      }
      setFeedback({ message: String(result?.summary ?? "Fixture added."), tone: "ok" });
    } catch (error) {
      reportError(error, "Lighting fixture create failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleGrandMasterChange = useCallback((value: number) => {
    setGrandMaster(Math.max(0, Math.min(100, Math.round(value))));
  }, []);

  const handleEmergencyCut = useEffectEvent(async () => {
    setBusyAction("lighting-blackout");
    try {
      await store.setLightingAllPower(false);
      setFeedback({ message: "All fixtures cut.", tone: "ok" });
    } catch (error) {
      reportError(error, "Lighting blackout failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleSaveScene = useEffectEvent(async () => {
    setBusyAction("scene-create");
    try {
      const name = `Scene ${scenes.length + 1}`;
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
      setBusyAction(null);
    }
  });

  const handleResaveScene = useEffectEvent(async () => {
    if (!activeScene) return;
    // Engine has no direct "update scene fixture states" IPC — the existing
    // create path is used: delete the old, recreate with the same name.
    setBusyAction("scene-resave");
    try {
      const previousId = activeScene.id;
      const previousName = activeScene.name;
      await store.deleteLightingScene(previousId);
      const result = asRecord(await store.createLightingScene({ name: previousName }));
      const created = asRecord(result?.scene);
      const createdId = typeof created?.id === "string" ? created.id : null;
      let nextThumbs = withSceneThumbRemoved(sceneThumbs, previousId);
      if (createdId) {
        const fixtureStatesRecord = Array.isArray(created?.fixtureStates) ? created!.fixtureStates : [];
        const dataUri = renderSceneThumbnailDataUri({
          fixtures,
          fixtureStates: fixtureStatesRecord as unknown as LightingSceneSnapshot["fixtureStates"],
        });
        nextThumbs = withSceneThumbUpserted(nextThumbs, createdId, dataUri);
      }
      await store.setLightingSceneThumbs(nextThumbs);
      setLastSavedAt(new Date());
      setFeedback({ message: `Scene '${previousName}' updated.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene re-save failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleDeleteScene = useEffectEvent(async () => {
    if (!activeScene) return;
    setBusyAction("scene-delete");
    try {
      await store.deleteLightingScene(activeScene.id);
      const next = withSceneThumbRemoved(sceneThumbs, activeScene.id);
      await store.setLightingSceneThumbs(next);
      setFeedback({ message: `Scene '${activeScene.name}' deleted.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Scene delete failed.");
    } finally {
      setBusyAction(null);
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
    setBusyAction(`scene:${sceneId}`);
    try {
      await store.recallLightingScene(sceneId, 0);
      setFeedback({ message: "Scene recalled.", tone: "ok" });
    } catch (error) {
      reportError(error, "Scene recall failed.");
    } finally {
      setBusyAction(null);
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
    setBusyAction(`group:${groupId}`);
    try {
      await store.setLightingGroupPower(groupId, on);
      setFeedback({ message: `Group ${on ? "on" : "off"}.`, tone: "ok" });
    } catch (error) {
      reportError(error, "Group power update failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleToggleFixturePower = useEffectEvent(async (fixtureId: string, on: boolean) => {
    setBusyAction(`fixture-power:${fixtureId}`);
    try {
      await store.updateLightingFixture({ fixtureId, on });
    } catch (error) {
      reportError(error, "Fixture power update failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleIntensityCommit = useEffectEvent(async (fixtureId: string, intensity: number) => {
    setBusyAction(`fixture-intensity:${fixtureId}`);
    try {
      await store.updateLightingFixture({ fixtureId, intensity });
    } catch (error) {
      reportError(error, "Intensity update failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleCctCommit = useEffectEvent(async (fixtureId: string, cct: number) => {
    setBusyAction(`fixture-cct:${fixtureId}`);
    try {
      await store.updateLightingFixture({ fixtureId, cct });
    } catch (error) {
      reportError(error, "CCT update failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handlePatchCommit = useEffectEvent(async (fixtureId: string, dmxStartAddress: number) => {
    setBusyAction(`fixture-patch:${fixtureId}`);
    try {
      await store.updateLightingFixture({ fixtureId, dmxStartAddress });
    } catch (error) {
      reportError(error, "Patch update failed.");
    } finally {
      setBusyAction(null);
    }
  });

  const handleIdentifyBurst = useEffectEvent((fixtureId: string, fixtureName: string) => {
    setFeedback({
      message: `Identify burst preview active for '${fixtureName}'.`,
      tone: "info",
    });
    // Identify burst is purely a visual preview at this layer. The IPC for a
    // real burst will land alongside PR 4 cue cleanup. For now we log
    // feedback and let IdentifyBurstButton manage its own visual timer.
    void fixtureId;
  });

  // ---------------- keyboard shortcuts ----------------

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() === "p") {
        setUiMode((current) => (current === "patch" ? "recall" : "patch"));
        event.preventDefault();
      } else if (event.key.toLowerCase() === "s") {
        void handleSaveScene();
        event.preventDefault();
      } else if (event.key === "Escape") {
        setSelectedGroupId(null);
        void handleSelectFixture(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveScene, handleSelectFixture]);

  const lastSavedLabel = lastSavedAt
    ? `${lastSavedAt.getUTCHours().toString().padStart(2, "0")}:${lastSavedAt
        .getUTCMinutes()
        .toString()
        .padStart(2, "0")} UTC`
    : undefined;

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
        onAddFixture={handleAddFixture}
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
            ×
          </button>
        </div>
      ) : null}

      <div className={styles.body}>
        <LightingRail
          grandMaster={grandMaster}
          masterEnabled={bridgeReachable}
          bridgeReachable={bridgeReachable}
          onGrandMasterChange={handleGrandMasterChange}
          onEmergencyCut={handleEmergencyCut}
          scenes={scenes}
          activeSceneId={activeSceneId}
          modifiedSceneId={modifiedSceneId}
          sceneThumbs={displayedSceneThumbs}
          onRecallScene={handleRecallScene}
          onSaveScene={handleSaveScene}
          groups={railGroupEntries}
          onToggleGroupPower={handleToggleGroupPower}
          patchMode={uiMode === "patch"}
          isSceneModified={isSceneModified}
          onResaveScene={handleResaveScene}
          onRevertScene={activeSceneId ? () => void handleRecallScene(activeSceneId) : undefined}
        />

        <main className={styles.stage}>
          <StagePlot
            fixtures={fixtures}
            selectedFixtureId={selectedFixture?.id ?? null}
            patchMode={uiMode === "patch"}
            onSelectFixture={(id) => void handleSelectFixture(id)}
          />
        </main>

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
          sceneThumb={activeSceneId ? displayedSceneThumbs[activeSceneId] : undefined}
          isSceneModified={isSceneModified}
          bridgeReachable={bridgeReachable}
          onTogglePower={handleToggleFixturePower}
          onIntensityCommit={handleIntensityCommit}
          onCctCommit={handleCctCommit}
          onIdentifyBurst={handleIdentifyBurst}
          onPatchCommit={handlePatchCommit}
          onToggleGroupPower={handleToggleGroupPower}
          onSelectFixture={(id) => void handleSelectFixture(id)}
          onSaveScene={handleSaveScene}
          onResaveScene={handleResaveScene}
          onDeleteScene={handleDeleteScene}
          busyAction={busyAction}
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
    </div>
  );
}
