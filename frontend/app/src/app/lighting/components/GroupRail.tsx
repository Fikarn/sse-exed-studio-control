import { Plus } from "lucide-react";

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
  onClearSearch?: () => void;
  onInspectGroup?: (groupId: string) => void;
  onCreateGroup?: () => void;
  onRequestRenameGroup?: (groupId: string) => void;
  onRequestDeleteGroup?: (groupId: string, groupName: string) => void;
}

export function GroupRail({
  groups,
  searchQuery = "",
  onTogglePower,
  onClearSearch,
  onInspectGroup,
  onCreateGroup,
  onRequestRenameGroup,
  onRequestDeleteGroup,
}: GroupRailProps) {
  const needle = searchQuery.trim().toLowerCase();
  const filteredGroups = needle ? groups.filter((group) => group.name.toLowerCase().includes(needle)) : groups;

  const createButton = onCreateGroup ? (
    <button
      type="button"
      className={styles.groupChipAdd}
      onClick={onCreateGroup}
      aria-label="Create a new lighting group"
    >
      <Plus aria-hidden="true" size={13} strokeWidth={1.75} />
      <span>New group</span>
    </button>
  ) : null;

  if (groups.length === 0) {
    return (
      <div className={styles.groupGrid}>
        <p className={styles.empty}>
          No groups yet.
          {onCreateGroup ? " Use + New group below to add one." : " Add fixtures to groups via the inspector."}
        </p>
        {createButton}
      </div>
    );
  }

  if (needle && filteredGroups.length === 0) {
    return (
      <p className={styles.empty}>
        No groups match “{searchQuery}”.
        {onClearSearch ? (
          <>
            {" "}
            <button type="button" className={styles.emptyAction} onClick={onClearSearch}>
              Clear search
            </button>
          </>
        ) : null}
      </p>
    );
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
            onInspect={onInspectGroup}
            onRequestRename={onRequestRenameGroup}
            onRequestDelete={onRequestDeleteGroup}
          />
        </div>
      ))}
      {!needle && createButton ? <div role="listitem">{createButton}</div> : null}
    </div>
  );
}
