import { useMemo } from "react";

import type {
  LightingFixtureCatalogSnapshot,
  LightingFixtureSnapshot,
  LightingGroupSnapshot,
  LightingPaletteKind,
  LightingPaletteSnapshot,
  LightingSceneSnapshot,
} from "@sse/engine-client";

import type { LightingDmxChannelEntry } from "../../shellData";
import { buildLightingPatchOverlapMap } from "../lightingPatch";

import { InspectorFixture } from "./InspectorFixture";
import { InspectorFixtureBulk } from "./InspectorFixtureBulk";
import { InspectorGroup } from "./InspectorGroup";
import { InspectorPalettes } from "./InspectorPalettes";
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
type FixtureValuePreviewPhase = "editing" | "committing";

export interface LightingInspectorProps {
  uiMode: LightingUiMode;
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;

  fixtures: readonly LightingFixtureSnapshot[];
  catalog?: LightingFixtureCatalogSnapshot | null;
  groups: readonly LightingGroupSnapshot[];
  scenes: readonly LightingSceneSnapshot[];
  palettes: readonly LightingPaletteSnapshot[];
  dmxChannels: readonly LightingDmxChannelEntry[];
  dmxStale: boolean;
  universe: number;

  selectedFixtureId: string | null;
  selectedGroupId: string | null;
  activeSceneId: string | null;
  /** Wave 30b — when set, the scene tab displays this scene's contents
   *  instead of `activeSceneId`. Used for X1 hover preview so the inspector
   *  can show a peek without disturbing activeSceneId-driven UI (rail tile
   *  green border, drift detection, plot pill). When null, falls back to
   *  activeSceneId. */
  inspectorSceneId?: string | null;

  isSceneModified: boolean;
  bridgeReachable: boolean;
  previewMode?: boolean;
  previewDirty?: boolean;

  onTogglePower: (fixtureId: string, on: boolean) => void;
  onIntensityCommit: (fixtureId: string, intensity: number) => void;
  onIntensityPreview?: (fixtureId: string, intensity: number, phase: FixtureValuePreviewPhase) => void;
  onCctCommit: (fixtureId: string, cct: number) => void;
  onCctPreview?: (fixtureId: string, cct: number, phase: FixtureValuePreviewPhase) => void;
  onControlValuesCommit?: (fixtureId: string, controlValues: Record<string, number>) => void;
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
  /** Set scene color tag. `null` clears, `0..7` sets. */
  onSetSceneColor?: (sceneId: string, colorIndex: number | null) => void;
  /** Set group color tag. `null` clears, `0..7` sets. */
  onSetGroupColor?: (groupId: string, colorIndex: number | null) => void;
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
  /** Per-fixture bulk update (Wave 27 — replaces flatten-to-one handlers).
   *  Drag-shift preserves spread; delta-input parses per-value math. */
  onBulkIntensityValues?: (values: ReadonlyArray<{ fixtureId: string; value: number }>) => void;
  onBulkIntensityPreview?: (
    values: ReadonlyArray<{ fixtureId: string; value: number }>,
    phase: FixtureValuePreviewPhase
  ) => void;
  onBulkCctValues?: (values: ReadonlyArray<{ fixtureId: string; value: number }>) => void;
  onBulkCctPreview?: (
    values: ReadonlyArray<{ fixtureId: string; value: number }>,
    phase: FixtureValuePreviewPhase
  ) => void;
  onApplyPalette?: (paletteId: string, fixtureIds: readonly string[]) => void;
  onCreatePalette?: (request: {
    name: string;
    kind: LightingPaletteKind;
    value: number;
    colorIndex: number | null;
  }) => void;
  onUpdatePalette?: (request: {
    paletteId: string;
    name?: string;
    value?: number;
    colorIndex?: number | null;
    beforePaletteId?: string | null;
  }) => void;
  onDeletePalette?: (paletteId: string) => void;

  /** Set of in-flight mutation keys; check with `.has(key)` or
   *  `Array.from(set).some((k) => k.startsWith(prefix))` for prefix queries. */
  busyActions: ReadonlySet<string>;
  /** One-shot signal from chip / marker context menus to open the inspector's
   *  inline rename for the matching entity. Bumped nonce retriggers when the
   *  same id is requested twice. */
  pendingInlineRename?: { kind: "fixture" | "group"; id: string; nonce: number } | null;
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
  if (opts.uiMode === "patch") return ["patch", "palettes"];
  // Group tab is only present when there's a group to inspect — the empty
  // "Select a group from the rail" state is unreachable from any UI path
  // (group chips toggle power, not select for inspection in this build),
  // so hiding the tab when no group is selected avoids a dead-end.
  const groupVisible = opts.selectedGroupId !== null || opts.activeTab === "group";
  return groupVisible
    ? (["scene", "fixture", "group", "palettes"] as const)
    : (["scene", "fixture", "palettes"] as const);
}

const TAB_TITLE: Record<InspectorTab, string> = {
  scene: "Scene",
  fixture: "Fixture",
  group: "Group",
  palettes: "Palettes",
  patch: "Patch",
};

export function LightingInspector({
  uiMode,
  activeTab,
  onTabChange,
  fixtures,
  catalog = null,
  groups,
  scenes,
  palettes,
  dmxChannels,
  dmxStale,
  universe,
  selectedFixtureId,
  selectedGroupId,
  activeSceneId,
  inspectorSceneId,
  isSceneModified,
  bridgeReachable,
  previewMode = false,
  previewDirty = false,
  onTogglePower,
  onIntensityCommit,
  onIntensityPreview,
  onCctCommit,
  onCctPreview,
  onControlValuesCommit,
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
  onSetSceneColor,
  onSetGroupColor,
  onAssignFixtureGroup,
  onRemoveFixtureFromGroup,
  onCreateGroup,
  onSpatialCommit,
  selectedFixtures,
  onClearSelection,
  onBulkTogglePower,
  onBulkIntensityValues,
  onBulkIntensityPreview,
  onBulkCctValues,
  onBulkCctPreview,
  onApplyPalette,
  onCreatePalette,
  onUpdatePalette,
  onDeletePalette,
  busyActions,
  pendingInlineRename,
}: LightingInspectorProps) {
  const hasBusyPrefix = (prefix: string) => Array.from(busyActions).some((key) => key.startsWith(prefix));
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  // Wave 30b — inspector picks up the hover-preview scene id when set so
  // the tab content tracks the operator's hover. Falls back to the active
  // scene id (the engine's recalled / persisted truth) otherwise. The
  // displayed-scene id is only equal to activeSceneId when not previewing,
  // which lets us suppress the modified treatment in preview mode (drift
  // is computed against activeSceneId, not the previewed one).
  const displayedSceneId =
    inspectorSceneId !== null && inspectorSceneId !== undefined ? inspectorSceneId : activeSceneId;
  const inspectorScene = scenes.find((scene) => scene.id === displayedSceneId) ?? null;
  const isHoverPreview = inspectorScene !== null && inspectorScene.id !== activeSceneId;

  const groupFixtures = useMemo(
    () => (selectedGroup ? fixtures.filter((fixture) => fixture.groupId === selectedGroup.id) : []),
    [fixtures, selectedGroup]
  );

  const patchOverlapMap = useMemo(() => buildLightingPatchOverlapMap([...fixtures], catalog), [catalog, fixtures]);
  const patchOverlap = selectedFixture ? (patchOverlapMap.get(selectedFixture.id) ?? null) : null;
  const paletteFixtureIds =
    selectedFixtures && selectedFixtures.length > 0
      ? selectedFixtures.map((fixture) => fixture.id)
      : selectedFixture
        ? [selectedFixture.id]
        : [];

  const visibleTabs = buildVisibleTabs({ uiMode, selectedGroupId, activeTab });

  const fixtureGroup = selectedFixture ? (groups.find((group) => group.id === selectedFixture.groupId) ?? null) : null;

  return (
    <aside className={styles.inspector} aria-label={`Lighting inspector — ${TAB_TITLE[activeTab]}`}>
      <LightingInspectorTabs active={activeTab} onChange={onTabChange} visibleTabs={visibleTabs} />
      {previewMode && activeTab !== "patch" ? (
        <div className={styles.previewSource}>
          <span className={styles.previewSourceEyebrow}>Preview values</span>
          <span>{previewDirty ? "Offline edits are pending." : "Editing buffer is clean."}</span>
        </div>
      ) : null}

      <section
        role="tabpanel"
        id={LIGHTING_TAB_PANEL_ID[activeTab]}
        aria-labelledby={LIGHTING_TAB_BUTTON_ID[activeTab]}
        className={styles.tabPanel}
      >
        {activeTab === "scene" ? (
          <InspectorScene
            scene={inspectorScene}
            fixtures={fixtures}
            groups={groups}
            isModified={isHoverPreview ? false : isSceneModified}
            isHoverPreview={isHoverPreview}
            isPreviewMode={previewMode}
            bridgeReachable={bridgeReachable}
            onSaveScene={onSaveScene}
            onSaveSceneAs={onSaveSceneAs}
            onRecallScene={onRecallScene}
            onResaveScene={onResaveScene}
            onDeleteScene={onDeleteScene}
            onRenameScene={onRenameScene}
            onSetSceneColor={onSetSceneColor}
            saveBusy={busyActions.has("scene-create")}
            recallBusy={hasBusyPrefix("scene:")}
            resaveBusy={busyActions.has("scene-resave")}
            deleteBusy={busyActions.has("scene-delete")}
            renameBusy={inspectorScene ? busyActions.has(`scene-rename:${inspectorScene.id}`) : false}
            colorBusy={inspectorScene ? busyActions.has(`scene-color:${inspectorScene.id}`) : false}
          />
        ) : null}

        {activeTab === "fixture" && selectedFixtures && selectedFixtures.length > 1 ? (
          <InspectorFixtureBulk
            fixtures={selectedFixtures}
            onClearSelection={onClearSelection ?? (() => undefined)}
            onBulkTogglePower={onBulkTogglePower ?? (() => undefined)}
            onBulkIntensityValues={onBulkIntensityValues ?? (() => undefined)}
            onBulkIntensityPreview={onBulkIntensityPreview}
            onBulkCctValues={onBulkCctValues ?? (() => undefined)}
            onBulkCctPreview={onBulkCctPreview}
            onSelectFixture={onSelectFixture}
          />
        ) : null}

        {activeTab === "fixture" && selectedFixture && (!selectedFixtures || selectedFixtures.length <= 1) ? (
          <InspectorFixture
            fixture={selectedFixture}
            catalog={catalog}
            groupName={fixtureGroup?.name}
            groups={groups}
            bridgeReachable={bridgeReachable}
            onTogglePower={onTogglePower}
            onIntensityCommit={onIntensityCommit}
            onIntensityPreview={onIntensityPreview}
            onCctCommit={onCctCommit}
            onCctPreview={onCctPreview}
            onControlValuesCommit={onControlValuesCommit}
            onIdentifyBurst={onIdentifyBurst}
            onDeleteFixture={onDeleteFixture}
            onSpatialCommit={onSpatialCommit}
            onRenameFixture={onRenameFixture}
            onAssignFixtureGroup={onAssignFixtureGroup}
            onCreateGroup={onCreateGroup}
            powerBusy={busyActions.has(`fixture-power:${selectedFixture.id}`)}
            deleteBusy={busyActions.has(`fixture-delete:${selectedFixture.id}`)}
            renameBusy={busyActions.has(`fixture-rename:${selectedFixture.id}`)}
            assignGroupBusy={busyActions.has(`fixture-group:${selectedFixture.id}`)}
            pendingInlineRenameNonce={
              pendingInlineRename?.kind === "fixture" && pendingInlineRename.id === selectedFixture.id
                ? pendingInlineRename.nonce
                : null
            }
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
            colorIndex={selectedGroup.colorIndex}
            fixtures={groupFixtures}
            onTogglePower={onToggleGroupPower}
            onSelectFixture={onSelectFixture}
            onRenameGroup={onRenameGroup}
            onSetGroupColor={onSetGroupColor}
            onRemoveFixtureFromGroup={onRemoveFixtureFromGroup}
            busy={busyActions.has(`group:${selectedGroup.id}`)}
            renameBusy={busyActions.has(`group-rename:${selectedGroup.id}`)}
            colorBusy={busyActions.has(`group-color:${selectedGroup.id}`)}
            removingFixtureId={
              groupFixtures.find((fixture) => busyActions.has(`fixture-group:${fixture.id}`))?.id ?? null
            }
            pendingInlineRenameNonce={
              pendingInlineRename?.kind === "group" && pendingInlineRename.id === selectedGroup.id
                ? pendingInlineRename.nonce
                : null
            }
          />
        ) : null}

        {activeTab === "group" && !selectedGroup ? (
          <p className={styles.empty}>Choose a group from the rail (chevron icon) to see its members.</p>
        ) : null}

        {activeTab === "palettes" ? (
          <InspectorPalettes
            palettes={palettes}
            selectedFixtureIds={paletteFixtureIds}
            patchMode={uiMode === "patch"}
            previewMode={previewMode}
            busyActions={busyActions}
            onApplyPalette={(paletteId) => onApplyPalette?.(paletteId, paletteFixtureIds)}
            onCreatePalette={onCreatePalette ?? (() => undefined)}
            onUpdatePalette={onUpdatePalette ?? (() => undefined)}
            onDeletePalette={onDeletePalette ?? (() => undefined)}
          />
        ) : null}

        {activeTab === "patch" ? (
          <InspectorPatch
            fixture={selectedFixture}
            universe={universe}
            catalog={catalog}
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
