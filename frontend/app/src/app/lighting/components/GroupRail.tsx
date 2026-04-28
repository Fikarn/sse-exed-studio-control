import { GroupChip } from "./GroupChip";
import styles from "./LightingRail.module.css";

export interface GroupRailEntry {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  level: number;
  drifted: boolean;
}

export interface GroupRailProps {
  groups: readonly GroupRailEntry[];
  onTogglePower: (id: string, on: boolean) => void;
}

export function GroupRail({ groups, onTogglePower }: GroupRailProps) {
  if (groups.length === 0) {
    return <p className={styles.empty}>No groups defined. Select multiple fixtures and save as a group.</p>;
  }

  return (
    <div className={styles.groupGrid} role="list" aria-label="Lighting groups">
      {groups.map((group) => (
        <div key={group.id} role="listitem">
          <GroupChip
            id={group.id}
            name={group.name}
            fixtureCount={group.fixtureCount}
            on={group.on}
            level={group.level}
            drifted={group.drifted}
            onTogglePower={onTogglePower}
          />
        </div>
      ))}
    </div>
  );
}
