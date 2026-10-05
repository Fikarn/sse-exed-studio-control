import { useState } from "react";
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { EmptyLine, Key, type MenuContent } from "@sse/design-system";

import type { LightingMenu } from "../lightingMenus";
import { GroupKey } from "./GroupKey";
import styles from "./GroupRail.module.css";

// The visual overhaul's Lighting page (2026-10-04): the groups as keys, two
// to a row, eight at a time; more come in pages, so the column never scrolls.
// A new group is the ＋ in the section's head.

const PER_PAGE = 8;

export interface GroupRailEntry {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  /** How many of its fixtures are on. */
  onCount?: number;
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
  /** Drag-to-reorder handler. When omitted, the keys aren't sortable. */
  onReorderGroup?: (groupId: string, beforeGroupId: string | null) => void;
  onSetGroupColor?: (groupId: string, colorIndex: number | null) => void;
  /** Each key's menu; `colour` asks the key for its swatches. */
  buildMenu: (group: GroupRailEntry, ask: { colour: () => void }) => LightingMenu;
  arm: MenuContent["arm"];
}

export function GroupRail({
  groups,
  searchQuery = "",
  onTogglePower,
  onClearSearch,
  onReorderGroup,
  onSetGroupColor,
  buildMenu,
  arm,
}: GroupRailProps) {
  const needle = searchQuery.trim().toLowerCase();
  const filtered = needle ? groups.filter((group) => group.name.toLowerCase().includes(needle)) : groups;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const [page, setPage] = useState(0);
  const shownPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(shownPage * PER_PAGE, shownPage * PER_PAGE + PER_PAGE);
  const [colourRequests, setColourRequests] = useState<Record<string, number>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const sortable = Boolean(onReorderGroup) && !needle;
  const allIds = filtered.map((group) => group.id);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!onReorderGroup) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = allIds.indexOf(String(active.id));
    const toIndex = allIds.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    // "Insert before id", as for the scenes.
    const order = arrayMove(allIds, fromIndex, toIndex);
    const at = order.indexOf(String(active.id));
    onReorderGroup(String(active.id), at + 1 < order.length ? order[at + 1]! : null);
  };

  // The visual overhaul's polish (2026-10-05): the design system's empty line,
  // one line, its hint the words' tooltip (DESIGN.md §9).
  if (groups.length === 0) {
    return (
      <EmptyLine tip="A group switches its fixtures together." className={styles.emptyLine}>
        No groups yet
      </EmptyLine>
    );
  }

  if (needle && filtered.length === 0) {
    return (
      <p className={styles.empty}>
        No groups match “{searchQuery}”.
        {onClearSearch ? (
          <Key size="small" onClick={onClearSearch}>
            Clear search
          </Key>
        ) : null}
      </p>
    );
  }

  const grid = (
    <div className={styles.grid} role="list" aria-label="Lighting groups">
      {shown.map((group) => (
        <div key={group.id} role="listitem" className={styles.item}>
          <GroupKey
            id={group.id}
            name={group.name}
            fixtureCount={group.fixtureCount}
            on={group.on}
            onCount={group.onCount ?? (group.on ? group.fixtureCount : 0)}
            level={group.level}
            drifted={group.drifted}
            colorIndex={group.colorIndex ?? null}
            sortable={sortable}
            onTogglePower={onTogglePower}
            menu={buildMenu(group, {
              colour: () => setColourRequests((current) => ({ ...current, [group.id]: (current[group.id] ?? 0) + 1 })),
            })}
            arm={arm}
            colourRequest={colourRequests[group.id] ?? 0}
            onSetColor={onSetGroupColor}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.rail}>
      {sortable ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={shown.map((group) => group.id)} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : (
        grid
      )}
      {pageCount > 1 ? (
        <div className={styles.pager}>
          <Key
            size="small"
            aria-label="Previous page of groups"
            disabled={shownPage === 0}
            onClick={() => setPage(Math.max(0, shownPage - 1))}
          >
            ‹
          </Key>
          <span className={styles.pageWord}>
            {shownPage + 1} / {pageCount}
          </span>
          <Key
            size="small"
            aria-label="Next page of groups"
            disabled={shownPage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, shownPage + 1))}
          >
            ›
          </Key>
        </div>
      ) : null}
    </div>
  );
}
