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
}: LightingRailProps) {
  return (
    <aside className={styles.rail} aria-label="Lighting rail">
      <MasterCard
        grandMaster={grandMaster}
        enabled={masterEnabled}
        bridgeReachable={bridgeReachable}
        onGrandMasterChange={onGrandMasterChange}
        onEmergencyCut={onEmergencyCut}
      />

      <RailDivider />

      <RailHead
        label="Scenes"
        count={`${scenes.length} saved`}
        action={
          <button type="button" className={styles.headButton} onClick={onSaveScene}>
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
        count={groups.length > 0 ? `${groups.filter((group) => group.on).length} / ${groups.length} on` : undefined}
      />
      <GroupRail groups={groups} onTogglePower={onToggleGroupPower} />
    </aside>
  );
}
