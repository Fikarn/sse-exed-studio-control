import { LightingPlatePanel } from "./LightingPlatePanel";
import styles from "../LightingWorkspace.module.css";
import { StagePlot } from "../components/StagePlot";
import { ColumnResizer } from "../components/ColumnResizer";
import { Button } from "@sse/design-system";
import type { LightingEditor } from "../useLightingEditor";

/** The bay: the plot, and the plate beside it (or in a drawer on a narrow layout). */
export function LightingBayRegion({ editor }: { editor: LightingEditor }) {
  const { lightingFixtureCatalogSnapshot } = editor.props;
  const {
    columns,
    operatorLayout,
    uiMode,
    stagePlotRenderMode,
    searchQuery,
    requestInlineRename,
    setConfirmDeleteFixture,
    requestAddFixture,
    setStagePlotRenderMode,
    inspectorDrawerOpen,
    setInspectorDrawerOpen,
  } = editor.session;
  const { previewMode, bridgeReachable, liveFixtures, selectedFixture, overlayFixtureIds } = editor.rig;
  const {
    stagePlotFixtures,
    studioLayout,
    selectedFixtureIds,
    stagePlotActiveScene,
    stagePlotSceneModified,
    identifyingIds,
    handleSelectFixture,
    handleFixtureSpatialCommit,
    handleIdentifyBurst,
    handleMarqueeSelect,
    handleTalentMarkPositionCommit,
    stagePlotViewport,
    chipHoverFixtureId,
  } = editor.fixtureEditor;
  const { previewDirty } = editor.sceneEditor;
  const inspectorPanel = <LightingPlatePanel editor={editor} />;
  return (
    <>
      <div
        className={`${styles.body} ${columns.isResizing ? styles.bodyResizing : ""}`}
        data-layout-mode={operatorLayout.layoutMode}
        data-testid="lighting-body"
        style={{
          ["--lighting-rail-width" as string]: `${columns.railWidth}px`,
          ["--lighting-inspector-width" as string]: `${columns.inspectorWidth}px`,
        }}
      >
        {/* Visual overhaul A, Slice 5 (system §7): the plot is the bay's screen —
            a backlit picture of the room at real scale, with the blue keyline
            while the operator is editing offline and the lock note on its head
            when the bridge is not answering. */}
        <main
          className={styles.stage}
          data-region="plot"
          data-material="screen"
          data-preview={previewMode ? "" : undefined}
          data-locked={bridgeReachable ? undefined : ""}
          data-testid="lighting-stage"
        >
          {bridgeReachable ? null : (
            <div className={styles.stageLockNote} data-testid="lighting-stage-lock-note">
              locked · the bridge is not answering · Open Setup
            </div>
          )}
          <StagePlot
            fixtures={stagePlotFixtures}
            catalog={lightingFixtureCatalogSnapshot}
            layout={studioLayout}
            liveFixtures={liveFixtures}
            selectedFixtureId={selectedFixture?.id ?? null}
            selectedFixtureIds={selectedFixtureIds}
            patchMode={uiMode === "patch"}
            previewMode={previewMode}
            activeSceneName={stagePlotActiveScene?.name}
            isSceneModified={previewMode ? previewDirty : stagePlotSceneModified}
            renderMode={stagePlotRenderMode}
            bridgeReachable={bridgeReachable}
            searchQuery={searchQuery}
            identifyingFixtureIds={identifyingIds}
            highlightOverlayFixtureIds={overlayFixtureIds}
            onSelectFixture={(id, options) => void handleSelectFixture(id, options ?? {})}
            onPositionCommit={
              previewMode
                ? undefined
                : (id, xMeters, yMeters) =>
                    void handleFixtureSpatialCommit(id, { spatialX: xMeters, spatialY: yMeters })
            }
            onRotationCommit={
              previewMode
                ? undefined
                : (id, rotationDegrees) => void handleFixtureSpatialCommit(id, { spatialRotation: rotationDegrees })
            }
            onRequestRenameFixture={(id) => {
              void handleSelectFixture(id, {});
              requestInlineRename("fixture", id);
            }}
            onIdentifyFixture={(id, name) => void handleIdentifyBurst(id, name)}
            onRequestDeleteFixture={(id, name) => setConfirmDeleteFixture({ id, name })}
            onMarqueeSelect={(ids, options) => void handleMarqueeSelect(ids, options)}
            onTalentMarkPositionCommit={(id, xMeters, yMeters) =>
              void handleTalentMarkPositionCommit(id, xMeters, yMeters)
            }
            onAddFixture={requestAddFixture}
            viewport={stagePlotViewport}
            chipHoverFixtureId={chipHoverFixtureId}
            onRenderModeChange={setStagePlotRenderMode}
          />
        </main>

        {!operatorLayout.isNarrow ? (
          <>
            <ColumnResizer ariaLabel="Resize inspector" onPointerDown={columns.startResize("inspector")} />
            {inspectorPanel}
          </>
        ) : null}
      </div>

      {operatorLayout.isNarrow && inspectorDrawerOpen ? (
        <div
          className={styles.inspectorDrawerBackdrop}
          role="presentation"
          onMouseDown={() => setInspectorDrawerOpen(false)}
          data-testid="lighting-inspector-drawer-backdrop"
        >
          <section
            className={styles.inspectorDrawer}
            role="dialog"
            aria-modal="true"
            aria-label="Lighting inspector drawer"
            onMouseDown={(event) => event.stopPropagation()}
            data-testid="lighting-inspector-drawer"
          >
            <div className={styles.inspectorDrawerHeader}>
              <span>Inspector</span>
              <Button size="compact" variant="ghost" onClick={() => setInspectorDrawerOpen(false)}>
                Close
              </Button>
            </div>
            {inspectorPanel}
          </section>
        </div>
      ) : null}
    </>
  );
}
