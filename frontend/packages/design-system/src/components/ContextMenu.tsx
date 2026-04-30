import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

import styles from "./ContextMenu.module.css";

export type ContextMenuItemTone = "default" | "danger";

export interface ContextMenuItem {
  /** Stable id for React key + keyboard navigation. */
  id: string;
  label: string;
  /** Lucide icon component (passed as the component reference, not JSX). */
  icon?: LucideIcon;
  /** Click / Enter activation handler. The menu auto-closes after running. */
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

const VIEWPORT_PADDING = 8;

/**
 * Right-click style floating menu. Positioned at (x, y); after mount it
 * measures itself and clamps to the viewport (flips above when the bottom
 * would clip; flips left when the right would clip). Keyboard navigation:
 * Up / Down moves the focused item, Enter activates, Esc closes. Outside
 * pointer events close the menu.
 *
 * Mounted via portal to document.body so per-workspace overflow + transform
 * containers can't clip it. Use one menu at a time per consumer — opening
 * a second menu (e.g. by right-clicking a different surface) implicitly
 * closes the previous via the outside-click handler.
 */
export function ContextMenu({ x, y, items, onClose, ariaLabel }: ContextMenuProps) {
  const menuId = useId();
  const menuRef = useRef<HTMLUListElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y });
  // Default-focus the first non-disabled item so Enter activates without an
  // additional Tab. Index is into `items`, not the rendered DOM order.
  const initialFocusIndex = items.findIndex((item) => !item.disabled);
  const [focusIndex, setFocusIndex] = useState<number>(Math.max(0, initialFocusIndex));

  // Clamp the menu inside the viewport after measuring. useLayoutEffect runs
  // before paint so the user never sees the un-clamped position.
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width + VIEWPORT_PADDING > vw) {
      left = Math.max(VIEWPORT_PADDING, vw - rect.width - VIEWPORT_PADDING);
    }
    if (top + rect.height + VIEWPORT_PADDING > vh) {
      top = Math.max(VIEWPORT_PADDING, vh - rect.height - VIEWPORT_PADDING);
    }
    setPosition({ left, top });
  }, [x, y, items.length]);

  // Outside-pointer / contextmenu / scroll / resize all close. We bind on
  // mousedown (not click) so the menu disappears before the new target gets
  // its own click — important when right-clicking from one surface to
  // another, where the second contextmenu must land cleanly.
  useEffect(() => {
    const handlePointer = (event: PointerEvent | MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("contextmenu", handlePointer);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("contextmenu", handlePointer);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [onClose]);

  // Focus the menu on mount so keyboard nav works without a Tab.
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const stepFocus = useCallback(
    (delta: 1 | -1) => {
      if (items.length === 0) return;
      let next = focusIndex;
      for (let i = 0; i < items.length; i += 1) {
        next = (next + delta + items.length) % items.length;
        if (!items[next]?.disabled) {
          setFocusIndex(next);
          return;
        }
      }
    },
    [focusIndex, items]
  );

  const activate = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || item.disabled) return;
      onClose();
      item.onSelect();
    },
    [items, onClose]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        stepFocus(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        stepFocus(-1);
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        setFocusIndex(items.findIndex((item) => !item.disabled));
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (!items[i]?.disabled) {
            setFocusIndex(i);
            return;
          }
        }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        activate(focusIndex);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      default:
        return;
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <ul
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={ariaLabel ?? "Context menu"}
      tabIndex={-1}
      className={styles.menu}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const itemClass = [
          styles.item,
          item.tone === "danger" ? styles.itemDanger : "",
          index === focusIndex ? styles.itemFocused : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={item.id} role="none">
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              tabIndex={-1}
              disabled={item.disabled}
              onMouseEnter={() => {
                if (!item.disabled) setFocusIndex(index);
              }}
              onClick={(event) => {
                event.stopPropagation();
                activate(index);
              }}
            >
              {Icon ? <Icon aria-hidden="true" size={13} strokeWidth={1.75} className={styles.icon} /> : null}
              <span className={styles.label}>{item.label}</span>
            </button>
          </li>
        );
      })}
    </ul>,
    document.body
  );
}
