import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { ColorPicker, MenuButton, type MenuContent } from "@sse/design-system";

import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex } from "../lightingColorTags";
import type { LightingMenu } from "../lightingMenus";
import styles from "./GroupRail.module.css";

// The visual overhaul's Lighting page (2026-10-04): a group is a key, 48 px,
// lit green while every fixture in it is on (DESIGN.md §4: on is green), its
// level at the right, `unsaved` beside it while its fixtures have left the
// scene on the rig. A press switches it; the ⋯ beside it, and a right-click on
// it, open its menu (the chevron that showed it on the plate is in the menu).

export interface GroupKeyProps {
  id: string;
  name: string;
  fixtureCount: number;
  on: boolean;
  /** How many of its fixtures are on: a partly lit group says so. */
  onCount?: number;
  level: number;
  drifted: boolean;
  colorIndex?: number | null;
  sortable?: boolean;
  onTogglePower: (id: string, on: boolean) => void;
  menu: LightingMenu;
  arm: MenuContent["arm"];
  colourRequest?: number;
  onSetColor?: (id: string, colorIndex: number | null) => void;
}

export function GroupKey({
  id,
  name,
  fixtureCount,
  on,
  onCount = on ? fixtureCount : 0,
  level,
  drifted,
  colorIndex = null,
  sortable = false,
  onTogglePower,
  menu,
  arm,
  colourRequest = 0,
  onSetColor,
}: GroupKeyProps) {
  const cellRef = useRef<HTMLDivElement | null>(null);
  const [colourAt, setColourAt] = useState<{ x: number; y: number } | null>(null);
  const seenColour = useRef(colourRequest);
  useEffect(() => {
    if (colourRequest === seenColour.current) return;
    seenColour.current = colourRequest;
    const box = cellRef.current?.getBoundingClientRect();
    if (box) setColourAt({ x: box.left, y: box.bottom });
  }, [colourRequest]);

  const colourHex = lightingColorTagHex(colorIndex);
  const fixtures = `${fixtureCount} fixture${fixtureCount === 1 ? "" : "s"}`;
  // Lit when every fixture is on; a press then turns them off, and turns
  // them all on otherwise. A partly lit group says how many are on.
  const partly = !on && onCount > 0;
  const word = on ? `${level} %` : partly ? `${onCount} of ${fixtureCount}` : "off";
  const stateWords = on ? "on" : partly ? `${onCount} of ${fixtureCount} on` : "off";
  const ariaLabel = `${name}, ${fixtures}${on ? ` at ${level} %` : ""}${drifted ? ", drifted" : ""}, ${stateWords}. Toggle ${on ? "off" : "on"}.`;

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 2 : undefined,
  };

  // Enter switches the group, as a press does; Space too unless it is
  // sortable, when it picks the key up. Only keys pressed on the key at rest.
  const { onKeyDown: sortableKeyDown, ...sortableListeners } = listeners ?? {};
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || isDragging) return;
    if (event.key === "Enter" || (event.key === " " && !sortable)) {
      event.preventDefault();
      onTogglePower(id, !on);
    }
    if (!event.defaultPrevented) sortableKeyDown?.(event);
  };

  return (
    <div
      ref={(node) => {
        cellRef.current = node;
        setNodeRef(node);
      }}
      className={styles.cell}
      style={style}
      data-dragging={isDragging || undefined}
    >
      <div
        ref={setActivatorNodeRef}
        className={styles.key}
        data-on={on ? "true" : "false"}
        data-drifted={drifted ? "true" : undefined}
        data-dragging={isDragging || undefined}
        data-take=""
        aria-label={ariaLabel}
        onClick={() => onTogglePower(id, !on)}
        onKeyDown={handleKeyDown}
        {...attributes}
        {...sortableListeners}
        aria-pressed={on}
        role="button"
        tabIndex={0}
      >
        <span
          aria-hidden="true"
          className={styles.colour}
          style={colourHex ? ({ "--group-colour": colourHex } as CSSProperties) : undefined}
        />
        <span className={styles.name}>{name}</span>
        <span className={styles.level}>
          {word}
          {drifted ? <span className={styles.drift}> · unsaved</span> : null}
        </span>
      </div>
      <MenuButton
        buttonLabel={`${name} group menu`}
        buttonTestId={`lighting-group-menu-${id}`}
        contextTarget={cellRef}
        size="sm"
        menu={{ ...menu, arm }}
      />
      {colourAt && onSetColor ? (
        <ColorPicker
          x={colourAt.x}
          y={colourAt.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={colorIndex}
          onSelect={(next) => onSetColor(id, next)}
          onClose={() => setColourAt(null)}
          ariaLabel={`Pick a colour for group ${name}`}
        />
      ) : null}
    </div>
  );
}
