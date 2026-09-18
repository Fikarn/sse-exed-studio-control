import { LightingInspector } from "../components/LightingInspector";
import type { LightingEditor } from "../useLightingEditor";

/** The plate: the inspector for whatever is selected - fixture, selection, group, scene, palettes or patch. */
export function LightingPlatePanel({ editor }: { editor: LightingEditor }) {
  const { lightingFixtureCatalogSnapshot } = editor.props;
  const {
    uiMode,
    activeTab,
    setActiveTabOverride,
    selectedGroupId,
    setSaveSceneAsOpen,
    setCreateGroupOpen,
    busyActions,
    pendingInlineRename,
  } = editor.session;
  const {
    fixtures,
    groups,
    scenes,
    palettes,
    dmxChannelsRaw,
    bridgeReachable,
    bridgeUniverse,
    selectedFixture,
    previewMode,
  } = editor.rig;
  const {
    activeSceneId,
    hoverPreviewSceneId,
    effectiveSceneModified,
    previewDirty,
    handleSaveScene,
    handleRecallScene,
    handleResaveScene,
    handleDeleteScene,
    handleRenameScene,
    handleSetSceneColor,
  } = editor.sceneEditor;
  const {
    handleToggleFixturePower,
    handleIntensityCommit,
    setFixtureValuePreview,
    handleCctCommit,
    handleControlValuesCommit,
    handleIdentifyBurst,
    handlePatchCommit,
    handleSelectFixture,
    handleDeleteFixture,
    handleFixtureSpatialCommit,
    handleRenameFixture,
    handleAssignFixtureGroup,
    selectedFixtureSnapshots,
    handleBulkTogglePower,
    handleBulkIntensityValues,
    setBulkFixtureValuePreview,
    handleBulkCctValues,
  } = editor.fixtureEditor;
  const {
    handleToggleGroupPower,
    handleRenameGroup,
    handleSetGroupColor,
    handleApplyPalette,
    handleCreatePalette,
    handleUpdatePalette,
    handleDeletePalette,
  } = editor.rigControls;
  return (
    <LightingInspector
      uiMode={uiMode}
      activeTab={activeTab}
      onTabChange={setActiveTabOverride}
      fixtures={fixtures}
      groups={groups}
      scenes={scenes}
      palettes={palettes}
      dmxChannels={dmxChannelsRaw}
      dmxStale={!bridgeReachable}
      universe={bridgeUniverse}
      catalog={lightingFixtureCatalogSnapshot}
      selectedFixtureId={selectedFixture?.id ?? null}
      selectedGroupId={selectedGroupId}
      activeSceneId={activeSceneId}
      inspectorSceneId={hoverPreviewSceneId}
      isSceneModified={effectiveSceneModified}
      bridgeReachable={bridgeReachable}
      previewMode={previewMode}
      previewDirty={previewDirty}
      onTogglePower={handleToggleFixturePower}
      onIntensityCommit={handleIntensityCommit}
      onIntensityPreview={(fixtureId, intensity, phase) =>
        setFixtureValuePreview(fixtureId, "intensity", intensity, phase)
      }
      onCctCommit={handleCctCommit}
      onCctPreview={(fixtureId, cct, phase) => setFixtureValuePreview(fixtureId, "cct", cct, phase)}
      onControlValuesCommit={handleControlValuesCommit}
      onIdentifyBurst={handleIdentifyBurst}
      onPatchCommit={handlePatchCommit}
      onToggleGroupPower={handleToggleGroupPower}
      onSelectFixture={(id, options) => void handleSelectFixture(id, options)}
      onSaveScene={handleSaveScene}
      onSaveSceneAs={() => setSaveSceneAsOpen(true)}
      onRecallScene={handleRecallScene}
      onResaveScene={handleResaveScene}
      onDeleteScene={handleDeleteScene}
      onDeleteFixture={(id) => void handleDeleteFixture(id)}
      onSpatialCommit={previewMode ? undefined : (id, partial) => void handleFixtureSpatialCommit(id, partial)}
      onRenameScene={handleRenameScene}
      onRenameFixture={handleRenameFixture}
      onRenameGroup={handleRenameGroup}
      onSetSceneColor={(sceneId, colorIndex) => void handleSetSceneColor(sceneId, colorIndex)}
      onSetGroupColor={(groupId, colorIndex) => void handleSetGroupColor(groupId, colorIndex)}
      onAssignFixtureGroup={(fixtureId, groupId) => void handleAssignFixtureGroup(fixtureId, groupId)}
      onRemoveFixtureFromGroup={(fixtureId) => void handleAssignFixtureGroup(fixtureId, null)}
      onCreateGroup={() => setCreateGroupOpen(true)}
      selectedFixtures={selectedFixtureSnapshots}
      onClearSelection={() => void handleSelectFixture(null)}
      onBulkTogglePower={(ids, on) => void handleBulkTogglePower(ids, on)}
      onBulkIntensityValues={(values) => void handleBulkIntensityValues(values)}
      onBulkIntensityPreview={(values, phase) => setBulkFixtureValuePreview(values, "intensity", phase)}
      onBulkCctValues={(values) => void handleBulkCctValues(values)}
      onBulkCctPreview={(values, phase) => setBulkFixtureValuePreview(values, "cct", phase)}
      onApplyPalette={(paletteId, ids) => void handleApplyPalette(paletteId, ids)}
      onCreatePalette={(request) => void handleCreatePalette(request)}
      onUpdatePalette={(request) => void handleUpdatePalette(request)}
      onDeletePalette={(paletteId) => void handleDeletePalette(paletteId)}
      busyActions={busyActions}
      pendingInlineRename={pendingInlineRename}
    />
  );
}
