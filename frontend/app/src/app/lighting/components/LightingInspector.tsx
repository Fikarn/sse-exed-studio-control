import { useMemo } from "react";

import { LampWord, Section, type MenuContent } from "@sse/design-system";
import type {
  LightingFixtureCatalogSnapshot,
  LightingFixtureSnapshot,
  LightingGroupSnapshot,
  LightingPaletteKind,
  LightingPaletteSnapshot,
  LightingSceneSnapshot,
} from "@sse/engine-client";

import type { LightingDmxChannelEntry } from "../../shellData";
import type { LightingMenu } from "../lightingMenus";
import { buildLightingPatchOverlapMap, lightingFixtureChannelCount } from "../lightingPatch";

import { InspectorFixture } from "./InspectorFixture";
import { InspectorFixtureBulk } from "./InspectorFixtureBulk";
import { InspectorGroup } from "./InspectorGroup";
import { InspectorPalettes, paletteStatus } from "./InspectorPalettes";
import { InspectorPatch } from "./InspectorPatch";
import { InspectorScene } from "./InspectorScene";
import { type InspectorTab } from "./LightingInspectorTabs";
import type { SceneRowWord } from "./SceneRow";

import styles from "./LightingInspector.module.css";

// The visual overhaul's Lighting page (2026-10-04): the plate. It shows what
// is selected (one fixture, several, a group, a scene, the patch while
// addressing), headed by its Dark Green title plate, every section at once,
// and the palettes under it, since they apply to whatever is selected. It
// fits the column without scrolling (DESIGN.md §1).

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
  /** The scene the plate shows: the one under the pointer, else the one chosen. */
  inspectorSceneId: string | null;
  /** The scene the rig holds (or the preview's), for the saved ticks. */
  referenceScene: LightingSceneSnapshot | null;
  /** The hardware link says the rig has left `referenceScene`. */
  drifting: boolean;
  /** The word of a scene on the rig (`on rig`, `unsaved`, `preview`), or null. */
  sceneWord: (sceneId: string) => SceneRowWord | null;
  isHoverPreview: boolean;
  bridgeReachable: boolean;
  previewMode?: boolean;
  previewDirty?: boolean;
  /** Why a recall is refused now, or null. */
  recallReason: string | null;

  /** The menus of the plate's object (shared with its object elsewhere) and the page's arm. */
  fixtureMenu: LightingMenu | null;
  sceneMenu: LightingMenu | null;
  groupMenu: LightingMenu | null;
  arm: MenuContent["arm"];
  sceneRenameRequest?: number;
  sceneColourRequest?: number;
  groupColourRequest?: number;
  onSetGroupColor?: (groupId: string, colorIndex: number | null) => void;

  onTogglePower: (fixtureId: string, on: boolean) => void;
  onIntensityCommit: (fixtureId: string, intensity: number) => void;
  onIntensityPreview?: (fixtureId: string, intensity: number, phase: FixtureValuePreviewPhase) => void;
  onCctCommit: (fixtureId: string, cct: number) => void;
  onCctPreview?: (fixtureId: string, cct: number, phase: FixtureValuePreviewPhase) => void;
  onControlValuesCommit?: (fixtureId: string, controlValues: Record<string, number>) => void;
  onControlValuesPreview?: (
    fixtureId: string,
    controlValues: Record<string, number>,
    phase: FixtureValuePreviewPhase
  ) => void;
  onIdentifyBurst: (fixtureId: string, fixtureName: string) => void;
  onPatchCommit: (fixtureId: string, nextStartAddress: number) => void;
  onToggleGroupPower: (groupId: string, on: boolean) => void;
  onSelectFixture: (fixtureId: string) => void;
  onRecallScene?: (sceneId: string) => void;
  onResaveScene?: (sceneId: string) => void;
  onRenameScene?: (sceneId: string, newName: string) => void | Promise<void>;
  onRenameFixture?: (fixtureId: string, newName: string) => void | Promise<void>;
  onRenameGroup?: (groupId: string, newName: string) => void | Promise<void>;
  onSetSceneColor?: (sceneId: string, colorIndex: number | null) => void;
  onRemoveFixtureFromGroup?: (fixtureId: string) => void | Promise<void>;
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

  selectedFixtures?: readonly LightingFixtureSnapshot[];
  onClearSelection?: () => void;
  onBulkTogglePower?: (fixtureIds: readonly string[], on: boolean) => void;
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

  busyActions: ReadonlySet<string>;
  pendingInlineRename?: { kind: "fixture" | "group"; id: string; nonce: number } | null;
  placementRequest?: { id: string; nonce: number } | null;
  onPlacementRequestHandled?: () => void;
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
  palettes: "Palettes",
  patch: "Patch",
};

export function LightingInspector(props: LightingInspectorProps) {
  const {
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
    inspectorSceneId,
    referenceScene,
    drifting,
    sceneWord,
    isHoverPreview,
    bridgeReachable,
    previewMode = false,
    previewDirty = false,
    recallReason,
    fixtureMenu,
    sceneMenu,
    groupMenu,
    arm,
    selectedFixtures,
    busyActions,
    pendingInlineRename,
    placementRequest,
    onPlacementRequestHandled,
  } = props;
  const hasBusyPrefix = (prefix: string) => Array.from(busyActions).some((key) => key.startsWith(prefix));
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const inspectorScene = scenes.find((scene) => scene.id === inspectorSceneId) ?? null;
  const groupFixtures = useMemo(
    () => (selectedGroup ? fixtures.filter((fixture) => fixture.groupId === selectedGroup.id) : []),
    [fixtures, selectedGroup]
  );
  const patchOverlapMap = useMemo(() => buildLightingPatchOverlapMap([...fixtures], catalog), [catalog, fixtures]);
  const patchOverlap = selectedFixture ? (patchOverlapMap.get(selectedFixture.id) ?? null) : null;
  const bulk = selectedFixtures && selectedFixtures.length > 1;
  const paletteFixtureIds =
    selectedFixtures && selectedFixtures.length > 0
      ? selectedFixtures.map((fixture) => fixture.id)
      : selectedFixture
        ? [selectedFixture.id]
        : [];
  const fixtureGroup = selectedFixture ? (groups.find((group) => group.id === selectedFixture.groupId) ?? null) : null;

  const patchRange = (fixture: LightingFixtureSnapshot) => {
    if (fixture.dmxStartAddress < 1) return "unpatched";
    const count = lightingFixtureChannelCount(fixture, catalog);
    const first = String(fixture.dmxStartAddress).padStart(3, "0");
    return count > 1 ? `${first}–${String(fixture.dmxStartAddress + count - 1).padStart(3, "0")}` : first;
  };

  return (
    <aside
      className={styles.inspector}
      aria-label={`Lighting inspector — ${TAB_TITLE[activeTab]}`}
      data-testid="lighting-plate"
      data-plate-view={activeTab}
    >
      {previewMode && activeTab !== "patch" ? (
        <div className={styles.previewLine} data-testid="lighting-plate-preview">
          <LampWord tone="info">Preview</LampWord>
          <span>Preview values · {previewDirty ? "offline edits are waiting" : "no offline edits yet"}</span>
        </div>
      ) : null}

      {activeTab === "scene" ? (
        <InspectorScene
          scene={inspectorScene}
          fixtures={fixtures}
          word={inspectorScene ? sceneWord(inspectorScene.id) : null}
          isHoverPreview={isHoverPreview}
          isPreviewMode={previewMode}
          recallReason={recallReason}
          menu={sceneMenu}
          arm={arm}
          onRecallScene={props.onRecallScene}
          onResaveScene={props.onResaveScene}
          onRenameScene={props.onRenameScene}
          onSetSceneColor={props.onSetSceneColor}
          onSelectFixture={(fixtureId) => {
            props.onSelectFixture(fixtureId);
            onTabChange("fixture");
          }}
          recallBusy={hasBusyPrefix("scene:")}
          resaveBusy={busyActions.has("scene-resave")}
          renameBusy={inspectorScene ? busyActions.has(`scene-rename:${inspectorScene.id}`) : false}
          renameRequest={props.sceneRenameRequest}
          colourRequest={props.sceneColourRequest}
        />
      ) : null}

      {activeTab === "fixture" && bulk ? (
        <InspectorFixtureBulk
          fixtures={selectedFixtures}
          onClearSelection={props.onClearSelection ?? (() => undefined)}
          onBulkTogglePower={props.onBulkTogglePower ?? (() => undefined)}
          onBulkIntensityValues={props.onBulkIntensityValues ?? (() => undefined)}
          onBulkIntensityPreview={props.onBulkIntensityPreview}
          onBulkCctValues={props.onBulkCctValues ?? (() => undefined)}
          onBulkCctPreview={props.onBulkCctPreview}
          onSelectFixture={props.onSelectFixture}
        />
      ) : null}

      {activeTab === "fixture" && selectedFixture && !bulk && fixtureMenu ? (
        <InspectorFixture
          fixture={selectedFixture}
          catalog={catalog}
          groupName={fixtureGroup?.name}
          bridgeReachable={bridgeReachable}
          scene={referenceScene}
          drifting={drifting}
          patchRange={patchRange(selectedFixture)}
          overlapNote={patchOverlap ? `with ${patchOverlap.conflictingFixtureNames.join(", ")}` : null}
          menu={fixtureMenu}
          arm={arm}
          onTogglePower={props.onTogglePower}
          onIntensityCommit={props.onIntensityCommit}
          onIntensityPreview={props.onIntensityPreview}
          onCctCommit={props.onCctCommit}
          onCctPreview={props.onCctPreview}
          onControlValuesCommit={props.onControlValuesCommit}
          onControlValuesPreview={props.onControlValuesPreview}
          onIdentifyBurst={props.onIdentifyBurst}
          onSpatialCommit={props.onSpatialCommit}
          onRenameFixture={props.onRenameFixture}
          powerBusy={busyActions.has(`fixture-power:${selectedFixture.id}`)}
          renameBusy={busyActions.has(`fixture-rename:${selectedFixture.id}`)}
          pendingInlineRenameNonce={
            pendingInlineRename?.kind === "fixture" && pendingInlineRename.id === selectedFixture.id
              ? pendingInlineRename.nonce
              : null
          }
          placementRequestNonce={placementRequest?.id === selectedFixture.id ? placementRequest.nonce : null}
          onPlacementRequestHandled={onPlacementRequestHandled}
        />
      ) : null}

      {activeTab === "group" && selectedGroup && groupMenu ? (
        <InspectorGroup
          groupId={selectedGroup.id}
          groupName={selectedGroup.name}
          colorIndex={selectedGroup.colorIndex}
          fixtures={groupFixtures}
          colourRequest={props.groupColourRequest}
          onSetGroupColor={props.onSetGroupColor}
          menu={groupMenu}
          arm={arm}
          onTogglePower={props.onToggleGroupPower}
          onSelectFixture={props.onSelectFixture}
          onIdentifyFixture={props.onIdentifyBurst}
          onRenameGroup={props.onRenameGroup}
          onRemoveFixtureFromGroup={props.onRemoveFixtureFromGroup}
          busy={busyActions.has(`group:${selectedGroup.id}`)}
          renameBusy={busyActions.has(`group-rename:${selectedGroup.id}`)}
          pendingInlineRenameNonce={
            pendingInlineRename?.kind === "group" && pendingInlineRename.id === selectedGroup.id
              ? pendingInlineRename.nonce
              : null
          }
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
          onPatchCommit={props.onPatchCommit}
          onIdentifyBurst={props.onIdentifyBurst}
          busy={selectedFixture ? busyActions.has(`fixture-patch:${selectedFixture.id}`) : false}
        />
      ) : null}

      {/* The palettes are a tool for whatever is selected, so they sit under
          it, except while addressing fixtures, where they are refused and the
          patch's tools are what the operator is using. */}
      {activeTab !== "patch" && activeTab !== "group" ? (
        <Section
          title="Palettes"
          detail={paletteStatus(paletteFixtureIds.length, uiMode === "patch", previewMode)}
          data-plate-section="palettes"
          testId="lighting-plate-palettes"
          className={styles.palettesSection}
        >
          <InspectorPalettes
            palettes={palettes}
            selectedFixtureIds={paletteFixtureIds}
            patchMode={uiMode === "patch"}
            previewMode={previewMode}
            busyActions={busyActions}
            arm={arm}
            onApplyPalette={(paletteId) => props.onApplyPalette?.(paletteId, paletteFixtureIds)}
            onCreatePalette={props.onCreatePalette ?? (() => undefined)}
            onUpdatePalette={props.onUpdatePalette ?? (() => undefined)}
            onDeletePalette={props.onDeletePalette ?? (() => undefined)}
          />
        </Section>
      ) : null}
    </aside>
  );
}
