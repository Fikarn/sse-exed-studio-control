import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronRight, Palette, Pencil, Search, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { ColorPicker, ContextMenu, StatusDot, type ContextMenuItem } from "@sse/design-system";

import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex } from "../lightingColorTags";

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
  /** Operator-assigned color tag index (0..7) or null for no tag. */
  colorIndex?: number | null;
  /** Set color tag handler. When provided, the context menu surfaces a
   *  Color… item that opens a `<ColorPicker>` popover. */
  onSetColor?: (id: string, colorIndex: number | null) => void;
  /** When true, dnd-kit sortable hooks are wired in. The parent
   *  <SortableContext> still has to be present for sorting to actually
   *  work — this prop only controls whether THIS chip participates. */
  sortable?: boolean;
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
  colorIndex = null,
  onSetColor,
  sortable = false,
}: GroupChipProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number } | null>(null);
  const colorHex = lightingColorTagHex(colorIndex);
  const className = on ? `${styles.groupChip} ${styles.groupChipOn}` : styles.groupChip;
  const levelClass = drifted ? `${styles.groupChipLevel} ${styles.groupChipLevelDrifted}` : styles.groupChipLevel;
  const meaningfulDelta = drifted && Math.abs(levelDelta) >= 1;
  const TrendIcon = levelDelta > 0 ? TrendingUp : TrendingDown;
  const deltaText = meaningfulDelta ? `${levelDelta > 0 ? "+" : ""}${Math.round(levelDelta)}` : "";
  const fixtureLabel = `${fixtureCount} fixture${fixtureCount === 1 ? "" : "s"}`;
  const driftSuffix = drifted ? ", drifted" : "";
  const powerAriaLabel = `${name}, ${fixtureLabel}${on ? ` at ${level}%` : ""}${driftSuffix}, ${on ? "on" : "off"}. Toggle ${on ? "off" : "on"}.`;

  // dnd-kit sortable hook — same shape as SceneTile (Wave 23.B/C). When
  // `sortable` is false the hook still runs (rules-of-hooks) but we skip
  // wiring its outputs.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
  });

  const chipDragStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 2 : undefined,
    cursor: sortable ? (isDragging ? "grabbing" : "pointer") : "pointer",
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!onRequestRename && !onInspect && !onRequestDelete && !onSetColor) return;
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
  if (onSetColor) {
    menuItems.push({
      id: "color",
      label: "Color…",
      icon: Palette,
      onSelect: () => {
        if (menuPos) setColorPickerPos(menuPos);
      },
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Space inside dnd-kit's sortable enters keyboard-drag mode, so don't
    // intercept it here when sortable is enabled (matches SceneTile pattern).
    if (event.key === "Enter" || (event.key === " " && !sortable)) {
      event.preventDefault();
      event.stopPropagation();
      onTogglePower(id, !on);
    }
  };

  return (
    <div className={styles.groupChipRow} onContextMenu={handleContextMenu}>
      {/* Chip body — sortable wrapper. Switched from <button> to
          <div role="button"> per the SceneTile / Wave 23 pattern: dnd-kit's
          listeners include drag-start handlers that conflict with native
          button activation semantics, plus the WKWebView button-drop bug. */}
      <div
        ref={setNodeRef}
        className={className}
        style={chipDragStyle}
        onClick={() => onTogglePower(id, !on)}
        onKeyDown={handleKeyDown}
        aria-label={powerAriaLabel}
        data-dragging={isDragging || undefined}
        {...attributes}
        {...listeners}
        // dnd-kit's `attributes` provides role + tabIndex (and toggles
        // aria-pressed under sortable). Override after the spread so the
        // chip's button-toggle semantics win, but inherit sortable aria
        // from dnd-kit (matches SceneTile pattern).
        aria-pressed={on}
        role="button"
        tabIndex={0}
      >
        {colorHex ? (
          <span aria-hidden="true" className={styles.groupChipColorBar} style={{ background: colorHex }} />
        ) : null}
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
      </div>
      {onInspect ? (
        <button
          type="button"
          className={styles.groupChipInspect}
          onClick={(event) => {
            event.stopPropagation();
            onInspect(id);
          }}
          onPointerDown={(event) => {
            // Prevent the inspect button's pointerdown from initiating a
            // sortable drag on a sibling chip via event bubbling.
            event.stopPropagation();
          }}
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
      {colorPickerPos && onSetColor ? (
        <ColorPicker
          x={colorPickerPos.x}
          y={colorPickerPos.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={colorIndex}
          onSelect={(next) => onSetColor(id, next)}
          onClose={() => setColorPickerPos(null)}
          ariaLabel={`Pick a color tag for group ${name}`}
        />
      ) : null}
    </div>
  );
}
