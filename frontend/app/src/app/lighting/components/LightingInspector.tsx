import { useMemo } from "react";

import type { LightingFixtureSnapshot, LightingGroupSnapshot, LightingSceneSnapshot } from "@sse/engine-client";

import type { LightingDmxChannelEntry } from "../../shellData";
import { buildLightingPatchOverlapMap } from "../lightingPatch";

import { InspectorFixture } from "./InspectorFixture";
import { InspectorFixtureBulk } from "./InspectorFixtureBulk";
import { InspectorGroup } from "./InspectorGroup";
import { InspectorPatch } from "./InspectorPatch";
import { InspectorScene } from "./InspectorScene";
import {
  LIGHTING_TAB_BUTTON_ID,
  LIGHTING_TAB_PANEL_ID,
  LightingInspectorTabs,
  type InspectorTab,
} from "./LightingInspectorTabs";

import styles from "./LightingInspector.module.css";

export type LightingUiMode = "recall" | "patch";

export interface LightingInspectorProps {
  uiMode: LightingUiMode;
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;

  fixtures: readonly LightingFixtureSnapshot[];
  groups: readonly LightingGroupSnapshot[];
  scenes: readonly LightingSceneSnapshot[];
  dmxChannels: readonly LightingDmxChannelEntry[];
  dmxStale: boolean;
  universe: number;

  selectedFixtureId: string | null;
  selectedGroupId: string | null;
  activeSceneId: string | null;

  isSceneModified: boolean;
  bridgeReachable: boolean;

  onTogglePower: (fixtureId: string, on: boolean) => void;
  onIntensityCommit: (fixtureId: string, intensity: number) => void;
  onCctCommit: (fixtureId: string, cct: number) => void;
  onIdentifyBurst: (fixtureId: string, fixtureName: string) => void;
  onPatchCommit: (fixtureId: string, nextStartAddress: number) => void;
  onToggleGroupPower: (groupId: string, on: boolean) => void;
  onSelectFixture: (fixtureId: string, options?: { additive?: boolean }) => void;
  onSaveScene?: () => void;
  onRecallScene?: (sceneId: string) => void;
  onResaveScene?: () => void;
  onDeleteScene?: () => void;
  onDeleteFixture?: (fixtureId: string) => void;
  onSpatialCommit?: (
    fixtureId: string,
    partial: {
      spatialX?: number | null;
      spatialY?: number | null;
      rigZ?: number | null;
      beamAngleDegrees?: number | null;
      spatialRotation?: number;
    }
  ) => void;

  /** Multi-fixture selection (size > 1 surfaces the bulk inspector). */
  selectedFixtures?: readonly LightingFixtureSnapshot[];
  onClearSelection?: () => void;
  onBulkTogglePower?: (fixtureIds: readonly string[], on: boolean) => void;
  onBulkIntensityCommit?: (fixtureIds: readonly string[], intensity: number) => void;
  onBulkCctCommit?: (fixtureIds: readonly string[], cct: number) => void;

  busyAction: string | null;
}

export function deriveInspectorTab(opts: {
  uiMode: LightingUiMode;
  selectedFixtureId: string | null;
  selectedGroupId: string | null;
}): InspectorTab {
  if (opts.uiMode === "patch") return "patch";
  if (opts.selectedFixtureId) return "fixture";
  if (opts.selectedGroupId) return "group";
  return "scene";
}

const TAB_TITLE: Record<InspectorTab, string> = {
  scene: "Scene",
  fixture: "Fixture",
  group: "Group",
  patch: "Patch",
};

export function LightingInspector({
  uiMode,
  activeTab,
  onTabChange,
  fixtures,
  groups,
  scenes,
  dmxChannels,
  dmxStale,
  universe,
  selectedFixtureId,
  selectedGroupId,
  activeSceneId,
  isSceneModified,
  bridgeReachable,
  onTogglePower,
  onIntensityCommit,
  onCctCommit,
  onIdentifyBurst,
  onPatchCommit,
  onToggleGroupPower,
  onSelectFixture,
  onSaveScene,
  onRecallScene,
  onResaveScene,
  onDeleteScene,
  onDeleteFixture,
  onSpatialCommit,
  selectedFixtures,
  onClearSelection,
  onBulkTogglePower,
  onBulkIntensityCommit,
  onBulkCctCommit,
  busyAction,
}: LightingInspectorProps) {
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? null;

  const groupFixtures = useMemo(
    () => (selectedGroup ? fixtures.filter((fixture) => fixture.groupId === selectedGroup.id) : []),
    [fixtures, selectedGroup]
  );

  const patchOverlapMap = useMemo(() => buildLightingPatchOverlapMap([...fixtures]), [fixtures]);
  const patchOverlap = selectedFixture ? (patchOverlapMap.get(selectedFixture.id) ?? null) : null;

  const visibleTabs: readonly InspectorTab[] =
    uiMode === "patch" ? ["patch"] : (["scene", "fixture", "group"] as const);

  const fixtureGroup = selectedFixture ? (groups.find((group) => group.id === selectedFixture.groupId) ?? null) : null;

  return (
    <aside className={styles.inspector} aria-label={`Lighting inspector — ${TAB_TITLE[activeTab]}`}>
      <LightingInspectorTabs active={activeTab} onChange={onTabChange} visibleTabs={visibleTabs} />

      <section
        role="tabpanel"
        id={LIGHTING_TAB_PANEL_ID[activeTab]}
        aria-labelledby={LIGHTING_TAB_BUTTON_ID[activeTab]}
        className={styles.tabPanel}
      >
        {activeTab === "scene" ? (
          <InspectorScene
            scene={activeScene}
            fixtures={fixtures}
            groups={groups}
            isModified={isSceneModified}
            bridgeReachable={bridgeReachable}
            onSaveScene={onSaveScene}
            onRecallScene={onRecallScene}
            onResaveScene={onResaveScene}
            onDeleteScene={onDeleteScene}
            saveBusy={busyAction === "scene-create"}
            recallBusy={busyAction?.startsWith("scene:") ?? false}
            resaveBusy={busyAction === "scene-resave"}
            deleteBusy={busyAction === "scene-delete"}
          />
        ) : null}

        {activeTab === "fixture" && selectedFixtures && selectedFixtures.length > 1 ? (
          <InspectorFixtureBulk
            fixtures={selectedFixtures}
            busy={busyAction?.startsWith("fixture-bulk-") ?? false}
            onClearSelection={onClearSelection ?? (() => undefined)}
            onBulkTogglePower={onBulkTogglePower ?? (() => undefined)}
            onBulkIntensityCommit={onBulkIntensityCommit ?? (() => undefined)}
            onBulkCctCommit={onBulkCctCommit ?? (() => undefined)}
            onSelectFixture={onSelectFixture}
          />
        ) : null}

        {activeTab === "fixture" && selectedFixture && (!selectedFixtures || selectedFixtures.length <= 1) ? (
          <InspectorFixture
            fixture={selectedFixture}
            groupName={fixtureGroup?.name}
            bridgeReachable={bridgeReachable}
            onTogglePower={onTogglePower}
            onIntensityCommit={onIntensityCommit}
            onCctCommit={onCctCommit}
            onIdentifyBurst={onIdentifyBurst}
            onDeleteFixture={onDeleteFixture}
            onSpatialCommit={onSpatialCommit}
            busy={busyAction?.startsWith(`fixture-`) ?? false}
            deleteBusy={busyAction === `fixture-delete:${selectedFixture.id}`}
          />
        ) : null}

        {activeTab === "fixture" && !selectedFixture ? (
          <p className={styles.empty}>Select a fixture on the stage plot to see its controls.</p>
        ) : null}

        {activeTab === "group" && selectedGroup ? (
          <InspectorGroup
            groupId={selectedGroup.id}
            groupName={selectedGroup.name}
            fixtures={groupFixtures}
            onTogglePower={onToggleGroupPower}
            onSelectFixture={onSelectFixture}
            busy={busyAction === `group:${selectedGroup.id}`}
          />
        ) : null}

        {activeTab === "group" && !selectedGroup ? (
          <p className={styles.empty}>Select a group from the rail to inspect its members.</p>
        ) : null}

        {activeTab === "patch" ? (
          <InspectorPatch
            fixture={selectedFixture}
            universe={universe}
            dmxChannels={dmxChannels}
            dmxStale={dmxStale}
            bridgeReachable={bridgeReachable}
            patchOverlap={patchOverlap}
            onPatchCommit={onPatchCommit}
            onIdentifyBurst={onIdentifyBurst}
            busy={selectedFixture ? busyAction === `fixture-patch:${selectedFixture.id}` : false}
          />
        ) : null}
      </section>
    </aside>
  );
}
