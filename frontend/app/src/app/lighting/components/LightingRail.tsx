import type { LightingSceneSnapshot } from "@sse/engine-client";

import { GroupRail, type GroupRailEntry } from "./GroupRail";
import { MasterCard } from "./MasterCard";
import { RailDivider } from "./RailDivider";
import { RailHead } from "./RailHead";
import { SceneRail } from "./SceneRail";
import styles from "./LightingRail.module.css";

function filteredCount<T>(items: readonly T[], field: (item: T) => string, q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return items.length;
  return items.filter((item) => field(item).toLowerCase().includes(needle)).length;
}

export interface LightingRailProps {
  grandMaster: number;
  masterEnabled: boolean;
  bridgeReachable: boolean;
  fixtureOnCount: number;
  fixtureTotal: number;
  onGrandMasterChange: (value: number) => void;
  onEmergencyCut: () => void;
  onToggleAllPower?: (on: boolean) => void;

  scenes: readonly LightingSceneSnapshot[];
  activeSceneId: string | null;
  selectedSceneId?: string | null;
  modifiedSceneId: string | null;
  previewSceneId?: string | null;
  previewMode?: boolean;
  sceneThumbs: Record<string, string>;
  onRecallScene: (sceneId: string) => void;
  onSaveScene: () => void;
  onReorderScene?: (sceneId: string, beforeSceneId: string | null) => void;
  onPinScene?: (sceneId: string, pinned: boolean) => void;
  onRenameScene?: (sceneId: string, newName: string) => void | Promise<void>;
  renamingSceneIds?: ReadonlySet<string>;
  onRequestDeleteScene?: (sceneId: string, sceneName: string) => void;
  onSetSceneColor?: (sceneId: string, colorIndex: number | null) => void;
  onHoverPreviewScene?: (sceneId: string) => void;
  onHoverPreviewSceneClear?: (sceneId: string) => void;

  groups: readonly GroupRailEntry[];
  onToggleGroupPower: (groupId: string, on: boolean) => void;
  onReorderGroup?: (groupId: string, beforeGroupId: string | null) => void;
  onSetGroupColor?: (groupId: string, colorIndex: number | null) => void;

  searchQuery?: string;
  patchMode?: boolean;
  isSceneModified?: boolean;
  onResaveScene?: () => void;
  onRevertScene?: () => void;
  onClearSearch?: () => void;
  onCreateGroup?: () => void;
  onInspectGroup?: (groupId: string) => void;
  onRequestRenameGroup?: (groupId: string) => void;
  onRequestDeleteGroup?: (groupId: string, groupName: string) => void;
}

export function LightingRail({
  grandMaster,
  masterEnabled,
  bridgeReachable,
  fixtureOnCount,
  fixtureTotal,
  onGrandMasterChange,
  onEmergencyCut,
  onToggleAllPower,
  scenes,
  activeSceneId,
  selectedSceneId = null,
  modifiedSceneId,
  previewSceneId = null,
  previewMode = false,
  sceneThumbs,
  onRecallScene,
  onSaveScene,
  onReorderScene,
  onPinScene,
  onRenameScene,
  renamingSceneIds,
  onRequestDeleteScene,
  onSetSceneColor,
  onHoverPreviewScene,
  onHoverPreviewSceneClear,
  groups,
  onToggleGroupPower,
  onReorderGroup,
  onSetGroupColor,
  searchQuery = "",
  patchMode = false,
  isSceneModified = false,
  onResaveScene,
  onRevertScene,
  onClearSearch,
  onCreateGroup,
  onInspectGroup,
  onRequestRenameGroup,
  onRequestDeleteGroup,
}: LightingRailProps) {
  const railClass = patchMode ? `${styles.rail} ${styles.railPaused}` : styles.rail;
  return (
    <aside
      className={railClass}
      aria-label="Lighting rail"
      data-paused={patchMode || undefined}
      aria-disabled={patchMode || undefined}
    >
      <MasterCard
        grandMaster={grandMaster}
        enabled={masterEnabled && !patchMode}
        bridgeReachable={bridgeReachable}
        fixtureOnCount={fixtureOnCount}
        fixtureTotal={fixtureTotal}
        onGrandMasterChange={onGrandMasterChange}
        onEmergencyCut={onEmergencyCut}
        onToggleAllPower={patchMode ? undefined : onToggleAllPower}
        eyebrow={patchMode ? "Master · paused · patch mode" : undefined}
      />

      <RailDivider />

      <RailHead
        label="Scenes"
        count={
          patchMode
            ? "paused"
            : searchQuery
              ? `${filteredCount(scenes, (s) => s.name, searchQuery)} of ${scenes.length}`
              : `${scenes.length} saved`
        }
        action={
          patchMode ? null : (
            <button type="button" className={styles.headButton} onClick={onSaveScene}>
              Save <kbd className={styles.headButtonKbd}>S</kbd>
            </button>
          )
        }
      />
      <SceneRail
        scenes={scenes}
        activeSceneId={activeSceneId}
        selectedSceneId={selectedSceneId}
        modifiedSceneId={modifiedSceneId}
        previewSceneId={previewSceneId}
        previewMode={previewMode}
        sceneThumbs={sceneThumbs}
        searchQuery={searchQuery}
        bridgeReachable={bridgeReachable}
        onRecall={onRecallScene}
        onAddScene={patchMode ? undefined : onSaveScene}
        onClearSearch={onClearSearch}
        onReorderScene={patchMode ? undefined : onReorderScene}
        onPinScene={patchMode ? undefined : onPinScene}
        onRenameScene={patchMode ? undefined : onRenameScene}
        renamingSceneIds={renamingSceneIds}
        onRequestDeleteScene={patchMode ? undefined : onRequestDeleteScene}
        onSetSceneColor={patchMode ? undefined : onSetSceneColor}
        onHoverPreview={patchMode ? undefined : onHoverPreviewScene}
        onHoverPreviewClear={patchMode ? undefined : onHoverPreviewSceneClear}
      />

      <RailDivider />

      <RailHead
        label="Groups"
        count={
          patchMode
            ? "paused"
            : searchQuery
              ? `${filteredCount(groups, (g) => g.name, searchQuery)} of ${groups.length}`
              : groups.length > 0
                ? `${groups.filter((group) => group.on).length} / ${groups.length} on`
                : undefined
        }
      />
      <GroupRail
        groups={groups}
        onTogglePower={onToggleGroupPower}
        searchQuery={searchQuery}
        onClearSearch={onClearSearch}
        onInspectGroup={patchMode ? undefined : onInspectGroup}
        onCreateGroup={patchMode ? undefined : onCreateGroup}
        onRequestRenameGroup={patchMode ? undefined : onRequestRenameGroup}
        onRequestDeleteGroup={patchMode ? undefined : onRequestDeleteGroup}
        onReorderGroup={patchMode ? undefined : onReorderGroup}
        onSetGroupColor={patchMode ? undefined : onSetGroupColor}
      />

      {!patchMode && isSceneModified ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.action} ${styles.actionYellow}`}
            onClick={onResaveScene}
            disabled={!onResaveScene}
          >
            Save changes
          </button>
          <button
            type="button"
            className={`${styles.action} ${styles.actionYellow} ${styles.actionAlt}`}
            onClick={onRevertScene}
            disabled={!onRevertScene}
          >
            Revert
          </button>
        </div>
      ) : null}
    </aside>
  );
}
