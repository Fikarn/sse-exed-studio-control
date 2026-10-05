import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";

import styles from "./ColorPicker.module.css";
import { Popover } from "./Popover";

// Visual overhaul B (DESIGN.md §5, §9): the colour-tag picker, a popover at
// the pointer or under the key that opened it. The swatches are keys of the
// tag's own colour (data, not the page's palette); the chosen one carries the
// Beige keyline and a mark; "Clear colour" is the last key. The arrows,
// Home and End move over the keys, Enter or Space picks one; it closes on a
// press outside or Esc and gives the focus back. The visual overhaul's polish
// (2026-10-05): the words say "colour", as the menus do, and with no tag
// chosen the focus starts on Clear colour, the current choice, so the first
// swatch never reads as chosen.

export interface ColorPickerSwatch {
  /** Stable index — what gets persisted. */
  index: number;
  /** Display name for screen readers + tooltip. */
  name: string;
  /** Render colour: a hex or a tag token (`var(--tag-0)`). */
  hex: string;
}

export interface ColorPickerProps {
  /** Anchor x in viewport (clientX) coordinates. */
  x: number;
  /** Anchor y in viewport (clientY) coordinates. */
  y: number;
  /** Palette of swatches. Order is the rendered order. */
  swatches: readonly ColorPickerSwatch[];
  /** Currently selected swatch index, or `null` for no colour tag. */
  selectedIndex: number | null;
  /** Fires when the user picks a swatch (passes the swatch index) or clears
   *  (passes `null`). The picker closes before it runs. */
  onSelect: (index: number | null) => void;
  /** Fires when the picker should close: outside click, Esc, or after a select. */
  onClose: () => void;
  /** Optional aria label. Default: "Pick a colour". */
  ariaLabel?: string;
}

/** The Clear key's place in the roving order, after the swatches. */
const CLEAR = -1;

export function ColorPicker({ x, y, swatches, selectedIndex, onSelect, onClose, ariaLabel }: ColorPickerProps) {
  const anchor = useMemo(() => ({ x, y }), [x, y]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const order = useMemo(() => [...swatches.map((swatch) => swatch.index), CLEAR], [swatches]);
  const chosen = selectedIndex !== null && order.includes(selectedIndex) ? selectedIndex : CLEAR;
  const [focusIndex, setFocusIndex] = useState<number>(chosen);

  const focusSlot = useCallback((index: number) => {
    setFocusIndex(index);
    gridRef.current?.querySelector<HTMLElement>(`[data-slot="${index}"]`)?.focus();
  }, []);

  useEffect(() => {
    setFocusIndex(chosen);
  }, [chosen]);

  const activate = useCallback(
    (index: number | null) => {
      onClose();
      onSelect(index);
    },
    [onClose, onSelect]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = order.indexOf(focusIndex);
    const go = (slot: number) => {
      event.preventDefault();
      event.stopPropagation();
      focusSlot(order[(slot + order.length) % order.length]!);
    };
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        go(at + 1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        go(at - 1);
        return;
      case "Home":
        go(0);
        return;
      case "End":
        go(order.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        activate(focusIndex === CLEAR ? null : focusIndex);
        return;
      default:
        // Esc goes on to the popover, which closes.
        return;
    }
  };

  return (
    <Popover
      open
      anchor={anchor}
      onClose={() => onClose()}
      label={ariaLabel ?? "Pick a colour"}
      placement="bottom-start"
    >
      <div ref={gridRef} className={styles.picker} onKeyDown={onKeyDown}>
        <div className={styles.swatches} role="group" aria-label="Colour swatches">
          {swatches.map((swatch) => {
            const selected = selectedIndex === swatch.index;
            return (
              <button
                key={swatch.index}
                type="button"
                className={styles.swatch}
                data-slot={swatch.index}
                data-selected={selected ? "" : undefined}
                data-autofocus={swatch.index === chosen ? "" : undefined}
                tabIndex={focusIndex === swatch.index ? 0 : -1}
                style={{ background: swatch.hex }}
                aria-label={`${swatch.name}${selected ? " (current)" : ""}`}
                aria-pressed={selected}
                onPointerEnter={() => focusSlot(swatch.index)}
                onClick={() => activate(swatch.index)}
              >
                {selected ? <Check aria-hidden="true" size={16} strokeWidth={3} className={styles.checkIcon} /> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={styles.clear}
          data-slot={CLEAR}
          data-autofocus={chosen === CLEAR ? "" : undefined}
          tabIndex={focusIndex === CLEAR ? 0 : -1}
          aria-pressed={selectedIndex === null}
          onPointerEnter={() => focusSlot(CLEAR)}
          onClick={() => activate(null)}
        >
          Clear colour
        </button>
      </div>
    </Popover>
  );
}
