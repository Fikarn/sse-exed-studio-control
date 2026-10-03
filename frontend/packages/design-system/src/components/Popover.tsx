import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { Placement } from "./anchoredPosition";
import styles from "./Popover.module.css";
import { useDismissOnOutside, useFloatingPosition, useReturnFocus, type FloatingAnchor } from "./useFloatingLayer";

// Visual overhaul B (DESIGN.md §5, §9): a small floating panel beside the key
// that opened it — a band's values, a camera's list of values, a look's
// settings. It is not a dialog: nothing behind it is blocked, it never takes
// `role="dialog"` (over the cameras' pictures a dialog hides every picture),
// and a press outside, or Esc, closes it and gives the focus back to its key.
// It flips to the other side when its side has no room and slides along its
// side to stay on the screen, so the key that opened it stays visible.

export type PopoverCloseReason = "escape" | "outside" | "scroll";

export interface PopoverProps {
  open: boolean;
  /** The key the popover belongs to; it keeps `aria-expanded` and `aria-controls`. */
  anchor: FloatingAnchor;
  onClose: (reason: PopoverCloseReason) => void;
  children: ReactNode;
  /** The popover's accessible name ("Band 2"), or a heading's id in `labelledBy`. */
  label?: string;
  labelledBy?: string;
  /** A title printed at the top, in the section head's voice. */
  title?: string;
  placement?: Placement;
  /**
   * The role of the panel. `group` by default; a list of values passes
   * `listbox` on its own list instead. Never `dialog`.
   */
  role?: "group" | "region" | "listbox";
  /** Elements whose presses do not count as outside (the key that toggles it). */
  ignoreOutside?: ReadonlyArray<RefObject<HTMLElement | null>>;
  returnFocusTo?: HTMLElement | null;
  /** Where the focus goes on open: the first control inside, or the panel. */
  initialFocus?: "first" | "panel";
  id?: string;
  testId?: string;
  className?: string;
  width?: number;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Popover({
  open,
  anchor,
  onClose,
  children,
  label,
  labelledBy,
  title,
  placement = "bottom-start",
  role = "group",
  ignoreOutside,
  returnFocusTo,
  initialFocus = "first",
  id,
  testId,
  className,
  width,
}: PopoverProps) {
  const autoId = useId();
  const panelId = id ?? `popover-${autoId}`;
  const titleId = `${panelId}-title`;
  const panelRef = useRef<HTMLDivElement | null>(null);

  const position = useFloatingPosition(panelRef, anchor, placement, { open, deps: [width] });
  useReturnFocus(panelRef, open, returnFocusTo);
  useDismissOnOutside(panelRef, (reason) => onClose(reason), { open, ignore: ignoreOutside });

  useEffect(() => {
    if (!open || !position.ready) return;
    const panel = panelRef.current;
    if (!panel) return;
    // An element marked `data-autofocus` (the chosen value) takes the focus first.
    const first =
      initialFocus === "first"
        ? (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel.querySelector<HTMLElement>(FOCUSABLE))
        : null;
    (first ?? panel).focus({ preventScroll: true });
    // Only when the popover opens and is placed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position.ready]);

  if (!open || typeof document === "undefined") return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    // The popover keeps its Esc: an armed key or a dialog under it is left
    // for the Esc after.
    event.preventDefault();
    event.stopPropagation();
    onClose("escape");
  };

  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role={role}
      aria-label={labelledBy || title ? undefined : label}
      aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
      tabIndex={-1}
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-level="float"
      data-popover=""
      data-placement={position.placement}
      data-testid={testId}
      style={{ ...position.style, width }}
      onKeyDown={onKeyDown}
      // Drawn in a portal, its events still pass up the page's tree: a press in
      // it is not a press on what opened it.
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {title ? (
        <div className={styles.title} id={titleId}>
          {title}
        </div>
      ) : null}
      {children}
    </div>,
    document.body
  );
}
