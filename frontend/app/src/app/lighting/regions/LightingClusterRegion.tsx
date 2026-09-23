import { ShellRegion } from "@sse/design-system";
import { LightingCluster } from "../components/LightingCluster";
import type { LightingEditor } from "../useLightingEditor";

/** The shell's cluster region: the rig's state, its keys, and the scene and group rails. */
export function LightingClusterRegion({ editor }: { editor: LightingEditor }) {
  const { lightingDmxMonitorSnapshot, store } = editor.props;
  const {
    bridgeIp,
    bridgeReachable,
    bridgeUniverse,
    fixtures,
    highlightActive,
    previewMode,
    scenes,
    soloActive,
    previewTargetSceneId,
  } = editor.rig;
  const {
    grandMasterDraft,
    railGroupEntries,
    handleGrandMasterChange,
    handleToggleAllPower,
    handleToggleGroupPower,
    handleReorderGroup,
    handleSetGroupColor,
  } = editor.rigControls;
  const { selectedFixtureIds, handleIdentifyFind, handleToggleHighlight, handleToggleSolo, stagePlotActiveScene } =
    editor.fixtureEditor;
  const {
    lastSavedLabel,
    previewDirty,
    recallFadeMs,
    effectiveSceneModified,
    activeScene,
    recentToolbarScenes,
    handleRecallScene,
    handleDiscardPreview,
    setRecallFadeMs,
    handleResaveScene,
    activeSceneId,
    handleSaveScene,
    handleTogglePreview,
    liveActiveSceneId,
    modifiedSceneId,
    displayedSceneThumbs,
    handleReorderScene,
    handlePinScene,
    handleRenameScene,
    renamingSceneIds,
    handleSetSceneColor,
    handleHoverPreview,
    handleHoverPreviewClear,
  } = editor.sceneEditor;
  const {
    uiMode,
    busyActions,
    searchQuery,
    requestAddFixture,
    requestEmergencyCut,
    setDmxMonitorOpen,
    operatorLayout,
    setInspectorDrawerOpen,
    setSearchQuery,
    handleTogglePatch,
    setConfirmDeleteScene,
    handleInspectGroup,
    setCreateGroupOpen,
    requestInlineRename,
    setConfirmDeleteGroup,
  } = editor.session;
  return (
    <ShellRegion region="cluster">
      <LightingCluster
        bridgeIp={bridgeIp}
        bridgeReachable={bridgeReachable}
        bridgeUniverse={bridgeUniverse}
        channelCount={lightingDmxMonitorSnapshot?.channels.length ?? 0}
        fixtureOnCount={fixtures.filter((fixture) => fixture.on).length}
        fixtureTotal={fixtures.length}
        grandMaster={grandMasterDraft}
        groups={railGroupEntries}
        hasSelection={selectedFixtureIds.size > 0}
        highlightActive={highlightActive}
        lastRecalledLabel={lastSavedLabel ?? null}
        patchMode={uiMode === "patch"}
        previewBusy={
          busyActions.has("preview-mode") || busyActions.has("preview-discard") || busyActions.has("scene-resave")
        }
        previewDirty={previewDirty}
        previewMode={previewMode}
        recallFadeMs={recallFadeMs}
        sceneModified={effectiveSceneModified}
        sceneName={activeScene?.name ?? null}
        scenes={scenes}
        recentScenes={recentToolbarScenes}
        searchQuery={searchQuery}
        soloActive={soloActive}
        onRecallRecentScene={(sceneId) => void handleRecallScene(sceneId)}
        onAddFixture={requestAddFixture}
        onDiscardPreview={() => void handleDiscardPreview()}
        onEmergencyCut={requestEmergencyCut}
        onGrandMasterChange={handleGrandMasterChange}
        onIdentifyFind={() => void handleIdentifyFind()}
        onOpenDmxMonitor={() => setDmxMonitorOpen(true)}
        onOpenInspector={operatorLayout.isNarrow ? () => setInspectorDrawerOpen(true) : undefined}
        onOpenSetup={() => void store.setWorkspace("setup")}
        onRecallFadeMsChange={setRecallFadeMs}
        onResaveScene={() => void handleResaveScene()}
        onRevertScene={activeSceneId ? () => void handleRecallScene(activeSceneId) : undefined}
        onSaveScene={handleSaveScene}
        onSearchChange={setSearchQuery}
        onToggleAllPower={(on) => void handleToggleAllPower(on)}
        onTogglePatch={handleTogglePatch}
        onTogglePreview={() => void handleTogglePreview()}
        onToggleHighlight={() => void handleToggleHighlight()}
        onToggleSolo={() => void handleToggleSolo()}
        sceneRailProps={{
          activeSceneId: liveActiveSceneId,
          selectedSceneId: stagePlotActiveScene?.id ?? activeSceneId,
          modifiedSceneId,
          previewSceneId: previewMode ? previewTargetSceneId : null,
          previewMode,
          sceneThumbs: displayedSceneThumbs,
          searchQuery,
          onRecall: handleRecallScene,
          onAddScene: uiMode === "patch" ? undefined : handleSaveScene,
          onClearSearch: () => setSearchQuery(""),
          onReorderScene: uiMode === "patch" ? undefined : handleReorderScene,
          onPinScene: uiMode === "patch" ? undefined : handlePinScene,
          onRenameScene: uiMode === "patch" ? undefined : handleRenameScene,
          renamingSceneIds,
          onRequestDeleteScene:
            uiMode === "patch" ? undefined : (id: string, name: string) => setConfirmDeleteScene({ id, name }),
          onSetSceneColor:
            uiMode === "patch"
              ? undefined
              : (sceneId: string, colorIndex: number | null) => void handleSetSceneColor(sceneId, colorIndex),
          onHoverPreview: uiMode === "patch" ? undefined : handleHoverPreview,
          onHoverPreviewClear: uiMode === "patch" ? undefined : handleHoverPreviewClear,
        }}
        groupRailProps={{
          onTogglePower: handleToggleGroupPower,
          searchQuery,
          onClearSearch: () => setSearchQuery(""),
          onInspectGroup: uiMode === "patch" ? undefined : handleInspectGroup,
          onCreateGroup: uiMode === "patch" ? undefined : () => setCreateGroupOpen(true),
          onRequestRenameGroup:
            uiMode === "patch"
              ? undefined
              : (groupId: string) => {
                  handleInspectGroup(groupId);
                  requestInlineRename("group", groupId);
                },
          onRequestDeleteGroup:
            uiMode === "patch"
              ? undefined
              : (groupId: string, groupName: string) => setConfirmDeleteGroup({ id: groupId, name: groupName }),
          onReorderGroup: uiMode === "patch" ? undefined : handleReorderGroup,
          onSetGroupColor:
            uiMode === "patch"
              ? undefined
              : (groupId: string, colorIndex: number | null) => void handleSetGroupColor(groupId, colorIndex),
        }}
      />
    </ShellRegion>
  );
}
