import { useState, type MouseEvent } from "react";
import { ChevronRight, Pencil, Search, Trash2, TrendingDown, TrendingUp } from "lucide-react";

import { ContextMenu, StatusDot, type ContextMenuItem } from "@sse/design-system";

import styles from "./LightingRail.module.css";

export interface GroupChipProps {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  level: number;
  drifted: boolean;
  /** Signed delta vs. the active scene's saved level for this group (% points). */
  levelDelta?: number;
  onTogglePower: (id: string, on: boolean) => void;
  /** When provided, exposes a chevron button that selects the group for inspection. */
  onInspect?: (id: string) => void;
  /** Right-click "Rename" — selects the group for inspection and triggers the
   *  inspector's inline rename. Parent owns the signal plumbing. */
  onRequestRename?: (id: string) => void;
  /** Right-click "Delete" — parent shows the confirm dialog. */
  onRequestDelete?: (id: string, name: string) => void;
}

export function GroupChip({
  id,
  name,
  fixtureCount,
  on,
  level,
  drifted,
  levelDelta = 0,
  onTogglePower,
  onInspect,
  onRequestRename,
  onRequestDelete,
}: GroupChipProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const className = on ? `${styles.groupChip} ${styles.groupChipOn}` : styles.groupChip;
  const levelClass = drifted ? `${styles.groupChipLevel} ${styles.groupChipLevelDrifted}` : styles.groupChipLevel;
  const meaningfulDelta = drifted && Math.abs(levelDelta) >= 1;
  const TrendIcon = levelDelta > 0 ? TrendingUp : TrendingDown;
  const deltaText = meaningfulDelta ? `${levelDelta > 0 ? "+" : ""}${Math.round(levelDelta)}` : "";
  const fixtureLabel = `${fixtureCount} fixture${fixtureCount === 1 ? "" : "s"}`;
  const driftSuffix = drifted ? ", drifted" : "";
  const powerAriaLabel = `${name}, ${fixtureLabel}${on ? ` at ${level}%` : ""}${driftSuffix}, ${on ? "on" : "off"}. Toggle ${on ? "off" : "on"}.`;

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!onRequestRename && !onInspect && !onRequestDelete) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const menuItems: ContextMenuItem[] = [];
  if (onRequestRename) {
    menuItems.push({
      id: "rename",
      label: "Rename",
      icon: Pencil,
      onSelect: () => onRequestRename(id),
    });
  }
  if (onInspect) {
    menuItems.push({
      id: "inspect",
      label: "Inspect group",
      icon: Search,
      onSelect: () => onInspect(id),
    });
  }
  if (onRequestDelete) {
    menuItems.push({
      id: "delete",
      label: "Delete group…",
      icon: Trash2,
      tone: "danger",
      onSelect: () => onRequestDelete(id, name),
    });
  }

  return (
    <div className={styles.groupChipRow} onContextMenu={handleContextMenu}>
      <button
        type="button"
        className={className}
        onClick={() => onTogglePower(id, !on)}
        aria-pressed={on}
        aria-label={powerAriaLabel}
      >
        <StatusDot state={on ? "ok" : "info"} size="sm" glow={on} />
        <span className={styles.groupChipName}>{name}</span>
        <span className={styles.groupChipCount}>{fixtureCount}F</span>
        {on ? (
          <span className={levelClass}>
            {level}%
            {meaningfulDelta || drifted ? (
              <span className={styles.groupChipDelta} aria-hidden="true">
                <TrendIcon size={11} strokeWidth={2.5} />
                {deltaText ? <span>{deltaText}</span> : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      {onInspect ? (
        <button
          type="button"
          className={styles.groupChipInspect}
          onClick={() => onInspect(id)}
          aria-label={`Inspect ${name} group`}
        >
          <ChevronRight aria-hidden="true" size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      {menuPos && menuItems.length > 0 ? (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
          ariaLabel={`Group ${name} actions`}
        />
      ) : null}
    </div>
  );
}
