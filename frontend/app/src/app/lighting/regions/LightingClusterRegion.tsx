import { ShellRegion } from "@sse/design-system";
import { LightingCluster } from "../components/LightingCluster";
import { lightingArmedWords } from "../editor/useLightingArming";
import { buildGroupMenu, buildSceneMenu } from "../lightingMenus";
import type { LightingEditor } from "../useLightingEditor";

const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

/** `10:42`, the studio's clock, for the time the bridge went silent. */
function clockLabel(isoTime: string | null) {
  if (!isoTime) return null;
  const date = new Date(isoTime);
  return Number.isNaN(date.getTime()) ? null : clockFormat.format(date);
}

function sceneFacts(scene: { fixtureStates: ReadonlyArray<{ on: boolean; cct: number }> }) {
  const lit = scene.fixtureStates.filter((state) => state.on);
  if (lit.length === 0) return "all off";
  return `${lit.length} on · ${Math.round(lit.reduce((sum, state) => sum + state.cct, 0) / lit.length)} K`;
}

/** The shell's cluster region: the rig's state, its keys, and the scenes and groups. */
export function LightingClusterRegion({ editor }: { editor: LightingEditor }) {
  const { lightingDmxMonitorSnapshot, lightingSnapshot, store } = editor.props;
  const { arm } = editor;
  const {
    bridgeIp,
    bridgeReachable,
    bridgeAnswering,
    bridgeSilentSince,
    bridgeUniverse,
    fixtures,
    outputsHeld,
    previewMode,
    scenes,
    previewTargetSceneId,
  } = editor.rig;
  const {
    grandMasterDraft,
    railGroupEntries,
    handleGrandMasterChange,
    handleEmergencyCut,
    handleToggleAllPower,
    handleToggleGroupPower,
    handleReorderGroup,
    handleSetGroupColor,
    handleDeleteGroup,
    handleUndo,
  } = editor.rigControls;
  const { handleToggleHighlight, handleToggleSolo, stagePlotActiveScene } = editor.fixtureEditor;
  const {
    lastSavedLabel,
    previewDirty,
    recallFadeMs,
    effectiveSceneModified,
    stateScene,
    sceneState,
    recentToolbarScenes,
    handleRecallScene,
    handleDiscardPreview,
    setRecallFadeMs,
    handleResaveScene,
    handleDeleteScene,
    activeSceneId,
    handleSaveScene,
    handleTogglePreview,
    liveActiveSceneId,
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
    setDmxMonitorOpen,
    dmxStripOn,
    setDmxStripOn,
    setSearchQuery,
    handleTogglePatch,
    handleInspectGroup,
    setCreateGroupOpen,
    requestInlineRename,
    undoStack,
  } = editor.session;
  const patchMode = uiMode === "patch";
  const patchReason = patchMode ? "leave Patch first" : null;
  const highlightIds = new Set(lightingSnapshot?.highlightFixtureIds ?? []);
  const soloIds = new Set(lightingSnapshot?.soloFixtureIds ?? []);
  const nameOf = (ids: ReadonlySet<string>) =>
    (lightingSnapshot?.fixtures ?? []).filter((fixture) => ids.has(fixture.id)).map((fixture) => fixture.name);
  // The live scene's word on the rig, as the deck's RECALL says it.
  const liveWord = sceneState === "live" ? "on rig" : sceneState === "unsaved" ? "unsaved" : null;

  return (
    <ShellRegion region="cluster">
      <LightingCluster
        bridgeIp={bridgeIp}
        bridgeReachable={bridgeReachable}
        bridgeAnswering={bridgeAnswering}
        bridgeSilentLabel={clockLabel(bridgeSilentSince)}
        outputsHeld={outputsHeld}
        bridgeUniverse={bridgeUniverse}
        channelCount={lightingDmxMonitorSnapshot?.channels.length ?? 0}
        fixtureOnCount={fixtures.filter((fixture) => fixture.on).length}
        fixtureTotal={fixtures.length}
        grandMaster={grandMasterDraft}
        undoLabel={undoStack.nextLabel}
        undoBusy={busyActions.has("undo")}
        lastSavedLabel={lastSavedLabel ?? null}
        patchMode={patchMode}
        previewBusy={
          busyActions.has("preview-mode") || busyActions.has("preview-discard") || busyActions.has("scene-resave")
        }
        previewDirty={previewDirty}
        previewMode={previewMode}
        recallFadeMs={recallFadeMs}
        sceneModified={effectiveSceneModified}
        sceneName={stateScene?.name ?? null}
        arm={arm}
        armedWords={arm.armed ? lightingArmedWords(arm.armed, lightingSnapshot) : null}
        highlightNames={nameOf(highlightIds)}
        soloNames={nameOf(soloIds)}
        onToggleHighlight={() => void handleToggleHighlight()}
        onToggleSolo={() => void handleToggleSolo()}
        recentScenes={recentToolbarScenes}
        searchQuery={searchQuery}
        onRecallRecentScene={(sceneId) => void handleRecallScene(sceneId)}
        onAddFixture={requestAddFixture}
        onCreateGroup={() => setCreateGroupOpen(true)}
        onDiscardPreview={() => void handleDiscardPreview()}
        onEmergencyCut={() => void handleEmergencyCut()}
        onGrandMasterChange={handleGrandMasterChange}
        onUndo={() => void handleUndo()}
        onOpenDmxMonitor={() => setDmxMonitorOpen(true)}
        dmxStripOn={dmxStripOn}
        onToggleDmxStrip={() => setDmxStripOn((current) => !current)}
        onOpenSetup={() => void store.setWorkspace("setup")}
        onRecallFadeMsChange={setRecallFadeMs}
        onResaveScene={() => void handleResaveScene()}
        onRevertScene={liveActiveSceneId ? () => void handleRecallScene(liveActiveSceneId) : undefined}
        onSaveScene={() => void handleSaveScene()}
        onSearchChange={setSearchQuery}
        onToggleAllPower={(on) => void handleToggleAllPower(on)}
        onTogglePatch={handleTogglePatch}
        onTogglePreview={() => void handleTogglePreview()}
        sceneRailProps={{
          scenes,
          liveSceneId: liveActiveSceneId,
          liveWord,
          previewMode,
          previewSceneId: previewMode ? previewTargetSceneId : null,
          selectedSceneId: stagePlotActiveScene?.id ?? activeSceneId,
          searchQuery,
          onClearSearch: () => setSearchQuery(""),
          onRecall: (sceneId) => void handleRecallScene(sceneId),
          onReorderScene: (sceneId, beforeSceneId) => void handleReorderScene(sceneId, beforeSceneId),
          onRenameScene: handleRenameScene,
          renamingSceneIds,
          onSetSceneColor: (sceneId, colorIndex) => void handleSetSceneColor(sceneId, colorIndex),
          onHoverPreview: patchMode ? undefined : handleHoverPreview,
          onHoverPreviewClear: patchMode ? undefined : handleHoverPreviewClear,
          buildMenu: (scene, ask) => {
            const live = scene.id === liveActiveSceneId;
            const isPreviewScene = previewMode && scene.id === previewTargetSceneId;
            return buildSceneMenu({
              scene,
              detail: sceneFacts(scene),
              word: previewMode ? (isPreviewScene ? "preview" : null) : live ? liveWord : null,
              previewMode,
              lockedReason: patchReason,
              saveIntoReason: previewMode
                ? isPreviewScene
                  ? null
                  : "load it into the preview first"
                : !live
                  ? "recall it first"
                  : sceneState === "unsaved"
                    ? null
                    : "the rig holds it",
              onRecall: () => void handleRecallScene(scene.id),
              onSaveInto: () => void handleResaveScene(scene.id),
              onRename: ask.rename,
              onPin: (pinned) => void handlePinScene(scene.id, pinned),
              onColour: ask.colour,
              onDelete: () => void handleDeleteScene(scene.id),
              testIdPrefix: `lighting-scene-menu-${scene.id}`,
            });
          },
        }}
        groupRailProps={{
          groups: railGroupEntries,
          onTogglePower: handleToggleGroupPower,
          searchQuery,
          onClearSearch: () => setSearchQuery(""),
          onReorderGroup: patchMode ? undefined : handleReorderGroup,
          onSetGroupColor: (groupId, colorIndex) => void handleSetGroupColor(groupId, colorIndex),
          buildMenu: (group, ask) =>
            buildGroupMenu({
              group,
              detail: `${group.fixtureCount} fixture${group.fixtureCount === 1 ? "" : "s"}${group.on ? ` · ${group.level} %` : " · off"}`,
              lockedReason: patchReason,
              onTogglePower: () => handleToggleGroupPower(group.id, !group.on),
              onInspect: () => handleInspectGroup(group.id),
              onRename: () => {
                handleInspectGroup(group.id);
                requestInlineRename("group", group.id);
              },
              onColour: ask.colour,
              onDelete: () => void handleDeleteGroup(group.id, group.name),
              testIdPrefix: `lighting-group-menu-${group.id}`,
            }),
        }}
      />
    </ShellRegion>
  );
}
