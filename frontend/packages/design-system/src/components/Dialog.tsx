import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Dialog.module.css";
import { useModalFocus } from "./useModalFocus";

export interface DialogProps {
  actions?: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  className?: string;
  labelledBy?: string;
  onClose?: () => void;
  title: ReactNode;
}

// Visual overhaul A, Slice 3 (system §5, §9), restyled 2026-10 (Atrium): a
// dialog is the floating layer (`data-level="float"`: the raised surface, a
// key's edge, the float shadow) over a flat scrim, with a 20 px PT Sans
// title in sentence case, the sentence in body type and sentence-case verbs
// on keys at the right. Focus moves in on mount, stays inside on Tab, and
// returns on unmount; Escape closes (`useModalFocus`, shared with the Sheet).
export function Dialog({ actions, body, children, className, labelledBy, onClose, title }: DialogProps) {
  const generatedTitleId = useId();
  const titleId = labelledBy ?? generatedTitleId;
  const dialogRef = useRef<HTMLElement | null>(null);

  useModalFocus(dialogRef, { onClose });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.overlay} role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={className ? `${styles.dialog} ${className}` : styles.dialog}
        data-level="float"
        data-material="plate"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        {body ? <p className={styles.body}>{body}</p> : null}
        {children}
        {actions ? <div className={styles.footer}>{actions}</div> : null}
      </section>
    </div>,
    document.body
  );
}
