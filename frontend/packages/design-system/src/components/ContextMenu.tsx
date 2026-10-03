import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";

import { Menu, type MenuEntry } from "./Menu";

// Visual overhaul B (DESIGN.md §9): the right-click menus of before, drawn
// by the one menu at the pointer. The API stays, so the pages move to `Menu`
// and a visible ⋯ (`MenuButton`) one at a time: a disabled item is drawn
// disabled and the arrows pass over it; a `danger` item is coral and, when it
// is the last, stands after a divider; it still opens its own confirmation, as
// before. The icons are no longer drawn: the menu's rows are words.

export type ContextMenuItemTone = "default" | "danger";

export interface ContextMenuItem {
  /** Stable id for React key + keyboard navigation. */
  id: string;
  label: string;
  /** Kept for the callers of before; the menu draws no icons. */
  icon?: LucideIcon;
  /** Click / Enter activation handler. The menu closes before it runs. */
  onSelect: () => void;
  disabled?: boolean;
  tone?: ContextMenuItemTone;
}

export interface ContextMenuProps {
  /** Anchor x in viewport (clientX) coordinates. */
  x: number;
  /** Anchor y in viewport (clientY) coordinates. */
  y: number;
  items: readonly ContextMenuItem[];
  /** Fires when the menu wants to close: outside click, Esc, or after an item runs. */
  onClose: () => void;
  /** Optional aria label for the menu. */
  ariaLabel?: string;
}

/**
 * The menu at the pointer of a right-click. It flips and slides to stay on
 * the screen, puts the focus on its first enabled item, closes on a press
 * outside, Esc or a scroll, and gives the focus back when it closes.
 */
export function ContextMenu({ x, y, items, onClose, ariaLabel }: ContextMenuProps) {
  const entries = useMemo<MenuEntry[]>(() => {
    const list: MenuEntry[] = [];
    items.forEach((item, index) => {
      const last = index === items.length - 1;
      if (last && item.tone === "danger" && index > 0) list.push({ kind: "divider", id: `${item.id}-divider` });
      list.push({
        id: item.id,
        label: item.label,
        onSelect: item.onSelect,
        disabledReason: item.disabled ? "" : undefined,
        tone: item.tone === "danger" ? "danger" : undefined,
      });
    });
    return list;
  }, [items]);
  const anchor = useMemo(() => ({ x, y }), [x, y]);

  return (
    <Menu
      open
      anchor={anchor}
      onClose={() => onClose()}
      items={entries}
      label={ariaLabel ?? "Context menu"}
      initialFocus="first"
    />
  );
}
