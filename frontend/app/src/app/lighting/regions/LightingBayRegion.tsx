import styles from "../LightingWorkspace.module.css";
import { StagePlot } from "../components/StagePlot";
import type { LightingEditor } from "../useLightingEditor";

/** The bay: the plot. The shell (overhaul 3): the plate is the shell's, so
 *  the plot takes the bay, and the plate keeps the shell's fixed width (the
 *  resizer went with it). */
export function LightingBayRegion({ editor }: { editor: LightingEditor }) {
  const { lightingFixtureCatalogSnapshot } = editor.props;
  const {
    uiMode,
    stagePlotRenderMode,
    searchQuery,
    requestInlineRename,
    setConfirmDeleteFixture,
    requestAddFixture,
    setStagePlotRenderMode,
  } = editor.session;
  const { previewMode, bridgeReachable, liveFixtures, selectedFixture, overlayFixtureIds } = editor.rig;
  const {
    stagePlotFixtures,
    studioLayout,
    selectedFixtureIds,
    stagePlotActiveScene,
    stagePlotSceneModified,
    identifyingIds,
    addToSelection,
    setAddToSelection,
    handleSelectFixture,
    handleFixtureSpatialCommit,
    handleIdentifyBurst,
    handleMarqueeSelect,
    handleTalentMarkPositionCommit,
    stagePlotViewport,
    chipHoverFixtureId,
  } = editor.fixtureEditor;
  const { previewDirty } = editor.sceneEditor;
  return (
    <div className={styles.body} data-testid="lighting-body">
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
          addToSelection={addToSelection}
          onAddToSelectionChange={setAddToSelection}
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
    </div>
  );
}
