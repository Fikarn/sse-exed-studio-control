import { GroupChip } from "./GroupChip";
import styles from "./LightingRail.module.css";

export interface GroupRailEntry {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  level: number;
  drifted: boolean;
  levelDelta?: number;
}

export interface GroupRailProps {
  groups: readonly GroupRailEntry[];
  searchQuery?: string;
  onTogglePower: (id: string, on: boolean) => void;
}

export function GroupRail({ groups, searchQuery = "", onTogglePower }: GroupRailProps) {
  const needle = searchQuery.trim().toLowerCase();
  const filteredGroups = needle ? groups.filter((group) => group.name.toLowerCase().includes(needle)) : groups;

  if (groups.length === 0) {
    return <p className={styles.empty}>No groups defined. Select multiple fixtures and save as a group.</p>;
  }

  if (needle && filteredGroups.length === 0) {
    return <p className={styles.empty}>No groups match “{searchQuery}”.</p>;
  }

  return (
    <div className={styles.groupGrid} role="list" aria-label="Lighting groups">
      {filteredGroups.map((group) => (
        <div key={group.id} role="listitem">
          <GroupChip
            id={group.id}
            name={group.name}
            fixtureCount={group.fixtureCount}
            on={group.on}
            level={group.level}
            drifted={group.drifted}
            levelDelta={group.levelDelta}
            onTogglePower={onTogglePower}
          />
        </div>
      ))}
    </div>
  );
}
