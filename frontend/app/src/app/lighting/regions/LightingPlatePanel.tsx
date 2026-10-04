import { useState } from "react";

import { LightingInspector } from "../components/LightingInspector";
import type { SceneRowWord } from "../components/SceneRow";
import { buildFixtureMenu, buildGroupMenu, buildSceneMenu } from "../lightingMenus";
import type { LightingEditor } from "../useLightingEditor";

function sceneFacts(scene: { fixtureStates: ReadonlyArray<{ on: boolean; cct: number }> }) {
  const lit = scene.fixtureStates.filter((state) => state.on);
  if (lit.length === 0) return "all off";
  return `${lit.length} on · ${Math.round(lit.reduce((sum, state) => sum + state.cct, 0) / lit.length)} K`;
}

/** The plate: whatever is selected (fixture, selection, group, scene, palettes
 *  or patch), with the same menu on its title as on its object. */
export function LightingPlatePanel({ editor }: { editor: LightingEditor }) {
  const { lightingFixtureCatalogSnapshot } = editor.props;
  const { arm } = editor;
  const {
    uiMode,
    activeTab,
    setActiveTabOverride,
    selectedGroupId,
    setCreateGroupOpen,
    busyActions,
    pendingInlineRename,
    requestInlineRename,
    placementRequest,
    requestPlacement,
    handleInspectGroup,
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
    previewTargetSceneId,
  } = editor.rig;
  const {
    activeSceneId,
    liveActiveSceneId,
    hoverPreviewSceneId,
    stateScene,
    sceneState,
    effectiveSceneModified,
    previewDirty,
    handleRecallScene,
    handleResaveScene,
    handleDeleteScene,
    handleRenameScene,
    handlePinScene,
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
    handleDeleteGroup,
    handleSetGroupColor,
    handleApplyPalette,
    handleCreatePalette,
    handleUpdatePalette,
    handleDeletePalette,
    railGroupEntries,
  } = editor.rigControls;
  const [sceneRenameRequest, setSceneRenameRequest] = useState(0);
  const [sceneColourRequest, setSceneColourRequest] = useState(0);
  const [groupColourRequest, setGroupColourRequest] = useState(0);

  const patchMode = uiMode === "patch";
  const recallReason = patchMode
    ? "Leave Patch to recall a scene."
    : !bridgeReachable && !previewMode
      ? "The bridge has not passed its probe, so a recall is refused."
      : null;
  const liveWord: SceneRowWord | null = sceneState === "live" ? "on rig" : sceneState === "unsaved" ? "unsaved" : null;
  const sceneWord = (sceneId: string): SceneRowWord | null =>
    previewMode
      ? sceneId === previewTargetSceneId
        ? "preview"
        : null
      : sceneId === liveActiveSceneId
        ? liveWord
        : null;
  const inspectorSceneId = hoverPreviewSceneId ?? activeSceneId;
  const inspectorScene = scenes.find((scene) => scene.id === inspectorSceneId) ?? null;

  const fixtureMenu = selectedFixture
    ? buildFixtureMenu({
        fixture: selectedFixture,
        detail: selectedFixture.on
          ? `${Math.round(selectedFixture.intensity)} % · ${Math.round(selectedFixture.cct)} K`
          : "off",
        groups,
        identifyReason: bridgeReachable ? null : "the bridge has not passed its probe",
        editReason: previewMode ? "leave preview to edit the rig" : null,
        onTogglePower: () => void handleToggleFixturePower(selectedFixture.id, !selectedFixture.on),
        onIdentify: () => void handleIdentifyBurst(selectedFixture.id, selectedFixture.name),
        onAssignGroup: (groupId) => void handleAssignFixtureGroup(selectedFixture.id, groupId),
        onCreateGroup: () => setCreateGroupOpen(true),
        onEditPlacement: () => requestPlacement(selectedFixture.id),
        onResetRotation: () => void handleFixtureSpatialCommit(selectedFixture.id, { spatialRotation: 0 }),
        onRename: () => requestInlineRename("fixture", selectedFixture.id),
        onDelete: () => void handleDeleteFixture(selectedFixture.id),
        testIdPrefix: "lighting-plate-menu",
      })
    : null;

  const sceneMenu = inspectorScene
    ? (() => {
        const word = sceneWord(inspectorScene.id);
        const live = inspectorScene.id === liveActiveSceneId;
        const isPreviewScene = previewMode && inspectorScene.id === previewTargetSceneId;
        return buildSceneMenu({
          scene: inspectorScene,
          detail: sceneFacts(inspectorScene),
          word,
          previewMode,
          lockedReason: patchMode ? "leave Patch first" : null,
          saveIntoReason: previewMode
            ? isPreviewScene
              ? null
              : "load it into the preview first"
            : !live
              ? "recall it first"
              : sceneState === "unsaved"
                ? null
                : "the rig holds it",
          onRecall: () => void handleRecallScene(inspectorScene.id),
          onSaveInto: () => void handleResaveScene(inspectorScene.id),
          onRename: () => setSceneRenameRequest((n) => n + 1),
          onPin: (pinned) => void handlePinScene(inspectorScene.id, pinned),
          onColour: () => setSceneColourRequest((n) => n + 1),
          onDelete: () => void handleDeleteScene(inspectorScene.id),
          testIdPrefix: "lighting-plate-menu",
        });
      })()
    : null;

  const selectedGroupEntry = railGroupEntries.find((group) => group.id === selectedGroupId) ?? null;
  const groupMenu = selectedGroupEntry
    ? buildGroupMenu({
        group: selectedGroupEntry,
        detail: `${selectedGroupEntry.fixtureCount} fixture${selectedGroupEntry.fixtureCount === 1 ? "" : "s"}`,
        lockedReason: patchMode ? "leave Patch first" : null,
        onTogglePower: () => handleToggleGroupPower(selectedGroupEntry.id, !selectedGroupEntry.on),
        onInspect: () => handleInspectGroup(selectedGroupEntry.id),
        onRename: () => requestInlineRename("group", selectedGroupEntry.id),
        onColour: () => setGroupColourRequest((n) => n + 1),
        onDelete: () => void handleDeleteGroup(selectedGroupEntry.id, selectedGroupEntry.name),
        testIdPrefix: "lighting-plate-menu",
      })
    : null;

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
      inspectorSceneId={inspectorSceneId}
      referenceScene={stateScene}
      drifting={effectiveSceneModified}
      sceneWord={sceneWord}
      isHoverPreview={hoverPreviewSceneId !== null && hoverPreviewSceneId !== activeSceneId}
      bridgeReachable={bridgeReachable}
      previewMode={previewMode}
      previewDirty={previewDirty}
      recallReason={recallReason}
      fixtureMenu={fixtureMenu}
      sceneMenu={sceneMenu}
      groupMenu={groupMenu}
      arm={arm}
      sceneRenameRequest={sceneRenameRequest}
      sceneColourRequest={sceneColourRequest}
      groupColourRequest={groupColourRequest}
      onSetGroupColor={(groupId, colorIndex) => void handleSetGroupColor(groupId, colorIndex)}
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
      onSelectFixture={(id) => void handleSelectFixture(id)}
      onRecallScene={(sceneId) => void handleRecallScene(sceneId)}
      onResaveScene={(sceneId) => void handleResaveScene(sceneId)}
      onSpatialCommit={previewMode ? undefined : (id, partial) => void handleFixtureSpatialCommit(id, partial)}
      onRenameScene={handleRenameScene}
      onRenameFixture={handleRenameFixture}
      onRenameGroup={handleRenameGroup}
      onSetSceneColor={(sceneId, colorIndex) => void handleSetSceneColor(sceneId, colorIndex)}
      onRemoveFixtureFromGroup={(fixtureId) => void handleAssignFixtureGroup(fixtureId, null)}
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
      placementRequest={placementRequest}
    />
  );
}
