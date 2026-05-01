import { Plus } from "lucide-react";
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { EmptyState } from "@sse/design-system";

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
  /** Operator-assigned color tag index (0..7) or null for no tag. */
  colorIndex?: number | null;
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
  /** Drag-to-reorder handler. When omitted, chips aren't sortable. */
  onReorderGroup?: (groupId: string, beforeGroupId: string | null) => void;
  /** Set color tag handler — both `null` (clear) and `0..7` (set). */
  onSetGroupColor?: (groupId: string, colorIndex: number | null) => void;
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
  onReorderGroup,
  onSetGroupColor,
}: GroupRailProps) {
  const needle = searchQuery.trim().toLowerCase();
  const filteredGroups = needle ? groups.filter((group) => group.name.toLowerCase().includes(needle)) : groups;

  // dnd-kit sensors mirror SceneRail (Wave 23.B/C):
  // - PointerSensor with 8 px activation so a plain click still toggles power.
  // - KeyboardSensor for accessibility (Tab → Space pickup → arrows → Space drop).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortable = Boolean(onReorderGroup) && !needle;
  const sortableIds = filteredGroups.map((group) => group.id);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!onReorderGroup) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = sortableIds.indexOf(String(active.id));
    const toIndex = sortableIds.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    // Same "reorder before id" translation as SceneRail — the dragged group
    // is inserted such that the next group (if any) becomes the anchor.
    const newOrder = arrayMove(sortableIds, fromIndex, toIndex);
    const draggedNewIdx = newOrder.indexOf(String(active.id));
    const beforeId = draggedNewIdx + 1 < newOrder.length ? newOrder[draggedNewIdx + 1]! : null;
    onReorderGroup(String(active.id), beforeId);
  };

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
    // F10 — empty state CTA. Use EmptyState's structured `action` prop so the
    // primary "Create first group" affordance is consistent across rails.
    // The legacy "+ New group" button is kept below as a secondary affordance
    // for parity with the populated-state footer.
    return (
      <div className={styles.groupGrid}>
        {onCreateGroup ? (
          <EmptyState
            icon={Plus}
            title="No groups yet"
            message="Create your first group to organize fixtures and toggle them together."
            action={{ label: "Create group", onClick: onCreateGroup, icon: Plus }}
          />
        ) : (
          <p className={styles.empty}>No groups yet. Add fixtures to groups via the inspector.</p>
        )}
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

  const railBody = (
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
            colorIndex={group.colorIndex ?? null}
            sortable={sortable}
            onTogglePower={onTogglePower}
            onInspect={onInspectGroup}
            onRequestRename={onRequestRenameGroup}
            onRequestDelete={onRequestDeleteGroup}
            onSetColor={onSetGroupColor}
          />
        </div>
      ))}
      {!needle && createButton ? <div role="listitem">{createButton}</div> : null}
    </div>
  );

  if (!sortable) return railBody;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        {railBody}
      </SortableContext>
    </DndContext>
  );
}
