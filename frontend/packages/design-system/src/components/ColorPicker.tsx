import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";

import styles from "./ColorPicker.module.css";

export interface ColorPickerSwatch {
  /** Stable index — what gets persisted. */
  index: number;
  /** Display name for screen readers + tooltip. */
  name: string;
  /** Render color (hex). */
  hex: string;
}

export interface ColorPickerProps {
  /** Anchor x in viewport (clientX) coordinates. */
  x: number;
  /** Anchor y in viewport (clientY) coordinates. */
  y: number;
  /** Palette of swatches. Order is the rendered order. */
  swatches: readonly ColorPickerSwatch[];
  /** Currently selected swatch index, or `null` for no color tag. */
  selectedIndex: number | null;
  /** Fires when the user picks a swatch (passes the swatch index) or clears
   *  (passes `null`). The picker auto-closes after a selection. */
  onSelect: (index: number | null) => void;
  /** Fires when the picker should close: outside click, Esc, or after a select. */
  onClose: () => void;
  /** Optional aria label. Default: "Pick a color". */
  ariaLabel?: string;
}

const VIEWPORT_PADDING = 8;

/**
 * Right-click style floating color picker. Renders an N-swatch grid plus a
 * "Clear" option. Mirrors `<ContextMenu>`'s mounting + positioning + outside-
 * click semantics so the two can be invoked from the same call sites without
 * surprising the user.
 *
 * Mount: portal to document.body so per-workspace overflow + transform
 * containers can't clip it. Position: clamps inside the viewport after
 * measuring (same as ContextMenu). Keyboard: Left / Right move the focused
 * swatch, Enter activates, Esc closes.
 */
export function ColorPicker({ x, y, swatches, selectedIndex, onSelect, onClose, ariaLabel }: ColorPickerProps) {
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y });
  // Focus index covers swatches first, then the Clear button at the end.
  // -1 means Clear, 0..N-1 means swatch[i].
  const initialFocus =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < swatches.length ? selectedIndex : 0;
  const [focusIndex, setFocusIndex] = useState<number>(initialFocus);

  useLayoutEffect(() => {
    const node = rootRef.current;
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
  }, [x, y, swatches.length]);

  useEffect(() => {
    const handlePointer = (event: PointerEvent | MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
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

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const stepFocus = useCallback(
    (delta: 1 | -1) => {
      setFocusIndex((current) => {
        const total = swatches.length + 1; // swatches + Clear
        const positions = Array.from({ length: total }, (_, i) => (i < swatches.length ? i : -1));
        const currentSlot = positions.indexOf(current);
        const nextSlot = (currentSlot + delta + total) % total;
        return positions[nextSlot]!;
      });
    },
    [swatches.length]
  );

  const activate = useCallback(
    (index: number | null) => {
      onClose();
      onSelect(index);
    },
    [onClose, onSelect]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        stepFocus(1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        stepFocus(-1);
        return;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        setFocusIndex(0);
        return;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        setFocusIndex(-1);
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
    <div
      ref={rootRef}
      id={dialogId}
      role="dialog"
      aria-label={ariaLabel ?? "Pick a color"}
      tabIndex={-1}
      className={styles.picker}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.swatches} role="group" aria-label="Color tag swatches">
        {swatches.map((swatch) => {
          const selected = selectedIndex === swatch.index;
          const focused = focusIndex === swatch.index;
          const className = [styles.swatch, selected ? styles.swatchSelected : "", focused ? styles.swatchFocused : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={swatch.index}
              type="button"
              className={className}
              style={{ background: swatch.hex }}
              aria-label={`${swatch.name}${selected ? " (current)" : ""}`}
              aria-pressed={selected}
              onMouseEnter={() => setFocusIndex(swatch.index)}
              onClick={(event) => {
                event.stopPropagation();
                activate(swatch.index);
              }}
            >
              {selected ? <Check aria-hidden="true" size={11} strokeWidth={3} className={styles.checkIcon} /> : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={[styles.clear, focusIndex === -1 ? styles.clearFocused : ""].filter(Boolean).join(" ")}
        onMouseEnter={() => setFocusIndex(-1)}
        onClick={(event) => {
          event.stopPropagation();
          activate(null);
        }}
        aria-pressed={selectedIndex === null}
      >
        <X aria-hidden="true" size={12} strokeWidth={1.75} />
        <span>Clear</span>
      </button>
    </div>,
    document.body
  );
}
