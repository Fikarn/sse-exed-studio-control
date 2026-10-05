import { useState } from "react";

import { Menu, type MenuEntry } from "@sse/design-system";

import styles from "../LightingWorkspace.module.css";
import { DMXCompactStrip } from "../components/DMXCompactStrip";
import { StagePlot } from "../components/StagePlot";
import { StagePlotBar } from "../components/StagePlotBar";
import { buildFixtureMenu, type LightingMenu } from "../lightingMenus";
import type { StagePlotRenderMode } from "../fixtureVisuals";
import type { StagePlotFitTransform, ViewBookmarkSlot } from "../useStagePlotViewport";
import type { LightingEditor } from "../useLightingEditor";

const RENDER_MODES: ReadonlyArray<{ mode: StagePlotRenderMode; label: string }> = [
  { mode: "rig", label: "Rig" },
  { mode: "coverage", label: "Coverage" },
  { mode: "photometric", label: "Photometric" },
  { mode: "pixel", label: "Pixel" },
];

const SLOTS: readonly ViewBookmarkSlot[] = [0, 1, 2];

/** The bay: the plot's well and the bar under it. The plot's menu (the bar's
 *  ⋯, a right-click on its floor) and each fixture's menu (a right-click on
 *  it, the plate title's ⋯) are built here and in `lightingMenus.ts`. */
export function LightingBayRegion({ editor }: { editor: LightingEditor }) {
  const { lightingFixtureCatalogSnapshot, lightingDmxMonitorSnapshot } = editor.props;
  const { arm } = editor;
  const {
    uiMode,
    stagePlotRenderMode,
    setStagePlotRenderMode,
    searchQuery,
    requestInlineRename,
    requestAddFixture,
    requestPlacement,
    setCreateGroupOpen,
    showSymbolKey,
    setShowSymbolKey,
    dmxStripOn,
    setDmxStripOn,
    setDmxMonitorOpen,
  } = editor.session;
  const {
    previewMode,
    bridgeReachable,
    bridgeUniverse,
    fixtures,
    liveFixtures,
    selectedFixture,
    overlayFixtureIds,
    groups,
    highlightActive,
    soloActive,
  } = editor.rig;
  const {
    stagePlotFixtures,
    studioLayout,
    selectedFixtureIds,
    selectedFixtureSnapshots,
    identifyingIds,
    addToSelection,
    setAddToSelection,
    handleSelectFixture,
    handleRemoveFromSelection,
    handleFixtureSpatialCommit,
    handleIdentifyBurst,
    handleMarqueeSelect,
    handleTalentMarkPositionCommit,
    handleToggleFixturePower,
    handleAssignFixtureGroup,
    handleDeleteFixture,
    handleToggleHighlight,
    handleToggleSolo,
    handleIdentifyFind,
    handleStopFind,
    findRunning,
    stagePlotViewport: viewport,
    chipHoverFixtureId,
    setChipHoverFixtureId,
  } = editor.fixtureEditor;
  const [fitTarget, setFitTarget] = useState<StagePlotFitTransform | null>(null);
  const [plotMenuAt, setPlotMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [fixtureMenu, setFixtureMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);

  const frameTheRig = () => (fitTarget ? viewport.fitContent(fitTarget) : viewport.fitRoom());
  const plotMenuItems: MenuEntry[] = [
    { kind: "label", id: "frame-label", label: "Frame" },
    {
      kind: "radio",
      id: "frame-rig",
      label: "Frame the rig",
      checked: viewport.zoomMode === "fitContent",
      onSelect: frameTheRig,
      testId: "lighting-plot-frame-rig",
    },
    {
      kind: "radio",
      id: "frame-room",
      label: "Fit the room",
      checked: viewport.zoomMode === "fitRoom",
      onSelect: viewport.fitRoom,
      testId: "lighting-plot-fit-room",
    },
    {
      id: "reset",
      label: "Reset view",
      onSelect: () => (viewport.zoomMode === "fitContent" ? frameTheRig() : viewport.reset()),
      testId: "lighting-plot-reset",
    },
    { kind: "label", id: "show-label", label: "Show" },
    ...RENDER_MODES.map(({ mode, label }): MenuEntry => ({
      kind: "radio",
      id: `show-${mode}`,
      label,
      checked: stagePlotRenderMode === mode,
      onSelect: () => setStagePlotRenderMode(mode),
      testId: `lighting-plot-show-${mode}`,
    })),
    {
      kind: "check",
      id: "symbol-key",
      label: "Symbol key",
      checked: showSymbolKey,
      onCheckedChange: (next) => setShowSymbolKey(next),
      onWord: "shown",
      offWord: "hidden",
      testId: "lighting-plot-symbol-key",
    },
    { kind: "label", id: "views-label", label: "Views" },
    ...SLOTS.map((slot): MenuEntry => ({
      id: `save-view-${slot}`,
      label: `Save the view to ${slot + 1}`,
      value: viewport.viewBookmarks[slot] ? "saved" : "empty",
      onSelect: () => viewport.saveViewBookmark(slot),
      testId: `lighting-plot-save-view-${slot + 1}`,
    })),
    ...SLOTS.map((slot): MenuEntry => ({
      id: `clear-view-${slot}`,
      label: `Clear view ${slot + 1}`,
      onSelect: () => viewport.clearViewBookmark(slot),
      disabledReason: viewport.viewBookmarks[slot] ? null : "empty",
      testId: `lighting-plot-clear-view-${slot + 1}`,
    })),
    { kind: "divider", id: "rig" },
    {
      id: "add-fixture",
      label: "Add fixture…",
      onSelect: requestAddFixture,
      disabledReason: previewMode ? "leave preview to add fixtures" : null,
      testId: "lighting-plot-add-fixture",
    },
    {
      id: "clear-selection",
      label: "Clear the selection",
      onSelect: () => void handleSelectFixture(null),
      disabledReason: selectedFixtureIds.size === 0 ? "nothing selected" : null,
      testId: "lighting-plot-clear-selection",
    },
  ];
  const plotMenu: LightingMenu = {
    head: {
      title: "Stage plot",
      detail: `${studioLayout.roomWidthMeters} m × ${studioLayout.roomDepthMeters} m · grid 0.5 m`,
    },
    items: plotMenuItems,
  };

  // The fixtures the plot draws and the plate shows: in Preview, the
  // preview's, so the menu says and switches what the plot shows.
  const menuFixture = fixtureMenu ? (fixtures.find((fixture) => fixture.id === fixtureMenu.id) ?? null) : null;
  const fixtureMenuContent = menuFixture
    ? buildFixtureMenu({
        fixture: menuFixture,
        detail: menuFixture.on ? `${Math.round(menuFixture.intensity)} % · ${Math.round(menuFixture.cct)} K` : "off",
        groups,
        identifyReason: bridgeReachable ? null : "the bridge has not passed its probe",
        editReason: previewMode ? "leave preview to edit the rig" : null,
        onTogglePower: () => void handleToggleFixturePower(menuFixture.id, !menuFixture.on),
        onIdentify: () => void handleIdentifyBurst(menuFixture.id, menuFixture.name),
        onAssignGroup: (groupId) => void handleAssignFixtureGroup(menuFixture.id, groupId),
        onCreateGroup: () => setCreateGroupOpen(true),
        onEditPlacement: () => {
          void handleSelectFixture(menuFixture.id, {});
          requestPlacement(menuFixture.id);
        },
        onResetRotation: () => void handleFixtureSpatialCommit(menuFixture.id, { spatialRotation: 0 }),
        onRename: () => {
          void handleSelectFixture(menuFixture.id, {});
          requestInlineRename("fixture", menuFixture.id);
        },
        onDelete: () => void handleDeleteFixture(menuFixture.id),
        testIdPrefix: `lighting-fixture-menu-${menuFixture.id}`,
      })
    : null;

  return (
    <>
      <main
        className={styles.stage}
        data-region="plot"
        data-material="screen"
        data-preview={previewMode ? "" : undefined}
        data-locked={bridgeReachable ? undefined : ""}
        data-testid="lighting-stage"
      >
        <StagePlot
          fixtures={stagePlotFixtures}
          catalog={lightingFixtureCatalogSnapshot}
          layout={studioLayout}
          liveFixtures={liveFixtures}
          selectedFixtureId={selectedFixture?.id ?? null}
          selectedFixtureIds={selectedFixtureIds}
          patchMode={uiMode === "patch"}
          previewMode={previewMode}
          renderMode={stagePlotRenderMode}
          showSymbolKey={showSymbolKey}
          searchQuery={searchQuery}
          identifyingFixtureIds={identifyingIds}
          highlightOverlayFixtureIds={overlayFixtureIds}
          addToSelection={addToSelection}
          onSelectFixture={(id, options) => void handleSelectFixture(id, options ?? {})}
          onPositionCommit={
            previewMode
              ? undefined
              : (id, xMeters, yMeters) => void handleFixtureSpatialCommit(id, { spatialX: xMeters, spatialY: yMeters })
          }
          onRotationCommit={
            previewMode
              ? undefined
              : (id, rotationDegrees) => void handleFixtureSpatialCommit(id, { spatialRotation: rotationDegrees })
          }
          onOpenFixtureMenu={(id, at) => setFixtureMenu({ id, at })}
          onOpenPlotMenu={(at) => setPlotMenuAt(at)}
          onMarqueeSelect={(ids, options) => void handleMarqueeSelect(ids, options)}
          onTalentMarkPositionCommit={(id, xMeters, yMeters) =>
            void handleTalentMarkPositionCommit(id, xMeters, yMeters)
          }
          onAddFixture={previewMode ? undefined : requestAddFixture}
          onFitTargetChange={setFitTarget}
          viewport={viewport}
          chipHoverFixtureId={chipHoverFixtureId}
        />
        {/* The visual overhaul's polish (2026-10-05): the plot's "locked" note
            went. The plot is not locked while the bridge has not passed its
            probe: a drag, a turn, a fixture's power and the plate's levels all
            reach the rig. The state display says what is refused. */}
        {dmxStripOn ? (
          <div className={styles.dmxStrip}>
            <DMXCompactStrip
              snapshot={lightingDmxMonitorSnapshot}
              fixtures={liveFixtures}
              catalog={lightingFixtureCatalogSnapshot}
              bridgeReachable={bridgeReachable}
              universe={bridgeUniverse}
              onOpenMonitor={() => setDmxMonitorOpen(true)}
              onClose={() => setDmxStripOn(false)}
            />
          </div>
        ) : null}
      </main>

      <StagePlotBar
        selectedFixtures={selectedFixtureSnapshots}
        onRemoveFromSelection={(fixtureId) => void handleRemoveFromSelection(fixtureId)}
        onClearSelection={() => void handleSelectFixture(null)}
        onChipHover={setChipHoverFixtureId}
        addToSelection={addToSelection}
        onAddToSelectionChange={setAddToSelection}
        previewMode={previewMode}
        highlightActive={highlightActive}
        soloActive={soloActive}
        findRunning={findRunning}
        onToggleHighlight={() => void handleToggleHighlight()}
        onToggleSolo={() => void handleToggleSolo()}
        onIdentifyFind={() => void handleIdentifyFind()}
        onStopFind={() => void handleStopFind()}
        zoom={viewport.zoom}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        viewBookmarks={viewport.viewBookmarks}
        onRecallView={viewport.recallViewBookmark}
        plotMenu={plotMenu}
        arm={arm}
      />

      <Menu
        open={plotMenuAt !== null}
        anchor={plotMenuAt}
        onClose={() => setPlotMenuAt(null)}
        {...plotMenu}
        arm={arm}
        testId="lighting-plot-context-menu"
      />
      {fixtureMenuContent ? (
        <Menu
          open={fixtureMenu !== null}
          anchor={fixtureMenu?.at ?? null}
          onClose={() => setFixtureMenu(null)}
          {...fixtureMenuContent}
          arm={arm}
          testId="lighting-fixture-context-menu"
        />
      ) : null}
    </>
  );
}
