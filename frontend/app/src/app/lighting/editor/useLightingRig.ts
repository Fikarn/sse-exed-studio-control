import { useMemo } from "react";
import { getLightingDmxChannels, getLightingFixtures, getLightingScenes, asRecord } from "../../shellData";
import { snapshotWithFixtures, type LightingWorkspaceSurfaceProps } from "../lightingWorkspaceModel";

/** What the snapshots say about the rig: the fixtures shown (live, or the
 *  preview buffer while previewing), groups, scenes, palettes, DMX levels, the
 *  selection the hardware link holds, the bridge and the identify overlays.
 *  Derivations only - nothing here is state of the screen. */
export function useLightingRig({ props }: { props: LightingWorkspaceSurfaceProps }) {
  const { lightingSnapshot, lightingDmxMonitorSnapshot, appSnapshot } = props;
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

  const persistedSelectedFixtureId =
    typeof lightingSnapshot?.selectedFixtureId === "string" ? lightingSnapshot.selectedFixtureId : null;
  const persistedSelectedSceneId =
    typeof lightingSnapshot?.selectedSceneId === "string" ? lightingSnapshot.selectedSceneId : null;
  const persistedLightingSectionId = asRecord(asRecord(appSnapshot?.shell)?.lighting)?.currentSectionId;

  const selectedFixture = useMemo(
    () => fixtures.find((fixture) => fixture.id === persistedSelectedFixtureId) ?? null,
    [fixtures, persistedSelectedFixtureId]
  );

  const fixturesPatched = liveFixtureEntries.filter((fixture) => fixture.dmxStartAddress > 0).length;

  const bridgeReachable = lightingSnapshot?.reachable === true;
  const bridgeUniverse = lightingSnapshot?.universe ?? 1;
  const bridgeIp = String(lightingSnapshot?.bridgeIp ?? "");

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
  return {
    liveFixtures,
    previewMode,
    previewTargetSceneId,
    fixtures,
    groups,
    scenes,
    palettes,
    dmxChannelsRaw,
    fixtureEntries,
    liveFixtureEntries,
    sceneEntries,
    persistedSelectedFixtureId,
    persistedSelectedSceneId,
    persistedLightingSectionId,
    selectedFixture,
    fixturesPatched,
    bridgeReachable,
    bridgeUniverse,
    bridgeIp,
    overlayFixtureIds,
    highlightActive,
    soloActive,
  };
}

export type LightingRig = ReturnType<typeof useLightingRig>;
