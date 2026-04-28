import type { LightingSceneSnapshot } from "@sse/engine-client";

import { GroupRail, type GroupRailEntry } from "./GroupRail";
import { MasterCard } from "./MasterCard";
import { RailDivider } from "./RailDivider";
import { RailHead } from "./RailHead";
import { SceneRail } from "./SceneRail";
import styles from "./LightingRail.module.css";

export interface LightingRailProps {
  grandMaster: number;
  masterEnabled: boolean;
  bridgeReachable: boolean;
  onGrandMasterChange: (value: number) => void;
  onEmergencyCut: () => void;

  scenes: readonly LightingSceneSnapshot[];
  activeSceneId: string | null;
  modifiedSceneId: string | null;
  sceneThumbs: Record<string, string>;
  onRecallScene: (sceneId: string) => void;
  onSaveScene: () => void;
  lastRecalledLabel?: (scene: LightingSceneSnapshot) => string | undefined;

  groups: readonly GroupRailEntry[];
  onToggleGroupPower: (groupId: string, on: boolean) => void;

  patchMode?: boolean;
  isSceneModified?: boolean;
  onResaveScene?: () => void;
  onRevertScene?: () => void;
}

export function LightingRail({
  grandMaster,
  masterEnabled,
  bridgeReachable,
  onGrandMasterChange,
  onEmergencyCut,
  scenes,
  activeSceneId,
  modifiedSceneId,
  sceneThumbs,
  onRecallScene,
  onSaveScene,
  lastRecalledLabel,
  groups,
  onToggleGroupPower,
  patchMode = false,
  isSceneModified = false,
  onResaveScene,
  onRevertScene,
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
        onGrandMasterChange={onGrandMasterChange}
        onEmergencyCut={onEmergencyCut}
        eyebrow={patchMode ? "Master · paused · patch mode" : undefined}
      />

      <RailDivider />

      <RailHead
        label="Scenes"
        count={patchMode ? "paused" : `${scenes.length} saved`}
        action={
          <button type="button" className={styles.headButton} onClick={onSaveScene} disabled={patchMode}>
            Save (S)
          </button>
        }
      />
      <SceneRail
        scenes={scenes}
        activeSceneId={activeSceneId}
        modifiedSceneId={modifiedSceneId}
        sceneThumbs={sceneThumbs}
        lastRecalledLabel={lastRecalledLabel}
        onRecall={onRecallScene}
        onAddScene={onSaveScene}
      />

      <RailDivider />

      <RailHead
        label="Groups"
        count={
          patchMode
            ? "paused"
            : groups.length > 0
              ? `${groups.filter((group) => group.on).length} / ${groups.length} on`
              : undefined
        }
      />
      <GroupRail groups={groups} onTogglePower={onToggleGroupPower} />

      {!patchMode ? (
        <div className={styles.actions}>
          {isSceneModified ? (
            <>
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
            </>
          ) : (
            <>
              <span className={`${styles.action} ${styles.actionDeferred}`} aria-disabled="true">
                Reorder
              </span>
              <span className={`${styles.action} ${styles.actionDeferred}`} aria-disabled="true">
                Manage
              </span>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}
