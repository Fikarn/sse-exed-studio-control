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
  onSaveSceneAs?: () => void;
  onRecallScene?: (sceneId: string) => void;
  onResaveScene?: () => void;
  onDeleteScene?: () => void;
  onDeleteFixture?: (fixtureId: string) => void;
  /** Inline-rename commit handlers. The second argument is the trimmed new
   *  name produced by the InlineRename primitive (NOT the current name). */
  onRenameScene?: (sceneId: string, newName: string) => void | Promise<void>;
  onRenameFixture?: (fixtureId: string, newName: string) => void | Promise<void>;
  onRenameGroup?: (groupId: string, newName: string) => void | Promise<void>;
  onAssignFixtureGroup?: (fixtureId: string, groupId: string | null) => void;
  /** Remove a fixture from its current group. Used by the I8 hover-revealed
   *  "×" affordance on group inspector member rows. */
  onRemoveFixtureFromGroup?: (fixtureId: string) => void | Promise<void>;
  onCreateGroup?: () => void;
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

  /** Set of in-flight mutation keys; check with `.has(key)` or
   *  `Array.from(set).some((k) => k.startsWith(prefix))` for prefix queries. */
  busyActions: ReadonlySet<string>;
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

function buildVisibleTabs(opts: {
  uiMode: LightingUiMode;
  selectedGroupId: string | null;
  activeTab: InspectorTab;
}): readonly InspectorTab[] {
  if (opts.uiMode === "patch") return ["patch"];
  // Group tab is only present when there's a group to inspect — the empty
  // "Select a group from the rail" state is unreachable from any UI path
  // (group chips toggle power, not select for inspection in this build),
  // so hiding the tab when no group is selected avoids a dead-end.
  const groupVisible = opts.selectedGroupId !== null || opts.activeTab === "group";
  return groupVisible ? (["scene", "fixture", "group"] as const) : (["scene", "fixture"] as const);
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
  onSaveSceneAs,
  onRecallScene,
  onResaveScene,
  onDeleteScene,
  onDeleteFixture,
  onRenameScene,
  onRenameFixture,
  onRenameGroup,
  onAssignFixtureGroup,
  onRemoveFixtureFromGroup,
  onCreateGroup,
  onSpatialCommit,
  selectedFixtures,
  onClearSelection,
  onBulkTogglePower,
  onBulkIntensityCommit,
  onBulkCctCommit,
  busyActions,
}: LightingInspectorProps) {
  const hasBusyPrefix = (prefix: string) => Array.from(busyActions).some((key) => key.startsWith(prefix));
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? null;

  const groupFixtures = useMemo(
    () => (selectedGroup ? fixtures.filter((fixture) => fixture.groupId === selectedGroup.id) : []),
    [fixtures, selectedGroup]
  );

  const patchOverlapMap = useMemo(() => buildLightingPatchOverlapMap([...fixtures]), [fixtures]);
  const patchOverlap = selectedFixture ? (patchOverlapMap.get(selectedFixture.id) ?? null) : null;

  const visibleTabs = buildVisibleTabs({ uiMode, selectedGroupId, activeTab });

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
            onSaveSceneAs={onSaveSceneAs}
            onRecallScene={onRecallScene}
            onResaveScene={onResaveScene}
            onDeleteScene={onDeleteScene}
            onRenameScene={onRenameScene}
            saveBusy={busyActions.has("scene-create")}
            recallBusy={hasBusyPrefix("scene:")}
            resaveBusy={busyActions.has("scene-resave")}
            deleteBusy={busyActions.has("scene-delete")}
            renameBusy={activeScene ? busyActions.has(`scene-rename:${activeScene.id}`) : false}
          />
        ) : null}

        {activeTab === "fixture" && selectedFixtures && selectedFixtures.length > 1 ? (
          <InspectorFixtureBulk
            fixtures={selectedFixtures}
            busy={hasBusyPrefix("fixture-bulk-")}
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
            groups={groups}
            bridgeReachable={bridgeReachable}
            onTogglePower={onTogglePower}
            onIntensityCommit={onIntensityCommit}
            onCctCommit={onCctCommit}
            onIdentifyBurst={onIdentifyBurst}
            onDeleteFixture={onDeleteFixture}
            onSpatialCommit={onSpatialCommit}
            onRenameFixture={onRenameFixture}
            onAssignFixtureGroup={onAssignFixtureGroup}
            onCreateGroup={onCreateGroup}
            busy={hasBusyPrefix("fixture-")}
            deleteBusy={busyActions.has(`fixture-delete:${selectedFixture.id}`)}
            renameBusy={busyActions.has(`fixture-rename:${selectedFixture.id}`)}
            assignGroupBusy={busyActions.has(`fixture-group:${selectedFixture.id}`)}
          />
        ) : null}

        {activeTab === "fixture" && !selectedFixture ? (
          <p className={styles.empty}>
            Choose a fixture on the stage plot to see its controls. Or use the toolbar search to find one by name.
          </p>
        ) : null}

        {activeTab === "group" && selectedGroup ? (
          <InspectorGroup
            groupId={selectedGroup.id}
            groupName={selectedGroup.name}
            fixtures={groupFixtures}
            onTogglePower={onToggleGroupPower}
            onSelectFixture={onSelectFixture}
            onRenameGroup={onRenameGroup}
            onRemoveFixtureFromGroup={onRemoveFixtureFromGroup}
            busy={busyActions.has(`group:${selectedGroup.id}`)}
            renameBusy={busyActions.has(`group-rename:${selectedGroup.id}`)}
            removingFixtureId={
              groupFixtures.find((fixture) => busyActions.has(`fixture-group:${fixture.id}`))?.id ?? null
            }
          />
        ) : null}

        {activeTab === "group" && !selectedGroup ? (
          <p className={styles.empty}>Choose a group from the rail (chevron icon) to see its members.</p>
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
            busy={selectedFixture ? busyActions.has(`fixture-patch:${selectedFixture.id}`) : false}
          />
        ) : null}
      </section>
    </aside>
  );
}
