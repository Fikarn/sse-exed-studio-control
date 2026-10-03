import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Drawer.module.css";

// Visual overhaul A, Slice 3 (system §5), restyled 2026-10 (Atrium): the
// floating layer (`data-level="float"`) docked over the bay at the right,
// with a 20 px PT Sans title and a small Close key. Escape closes it, focus
// moves in on open and back on close; it is not modal, so the operator can
// keep riding the console beside it.
export interface DrawerProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Keys in the drawer's head. */
  actions?: ReactNode;
  width?: number;
  testId?: string;
}

export function Drawer({ open, title, children, onClose, actions, width = 360, testId }: DrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // An Esc a layer above took (a menu or popover opened in the drawer)
      // closes that layer only.
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <aside
      ref={panelRef}
      className={styles.drawer}
      data-level="float"
      data-material="plate"
      data-testid={testId}
      role="dialog"
      aria-modal="false"
      aria-label={typeof title === "string" ? title : undefined}
      tabIndex={-1}
      style={{ width }}
    >
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.actions}>
          {actions}
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </aside>,
    document.body
  );
}
