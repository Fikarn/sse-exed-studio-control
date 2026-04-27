import { useEffect, useId, useRef, type ReactNode } from "react";

import { Surface } from "./Surface";
import styles from "./Dialog.module.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface DialogProps {
  actions?: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  className?: string;
  labelledBy?: string;
  onClose?: () => void;
  title: ReactNode;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );
}

export function Dialog({ actions, body, children, className, labelledBy, onClose, title }: DialogProps) {
  const generatedTitleId = useId();
  const titleId = labelledBy ?? generatedTitleId;
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const focusables = getFocusableElements(dialog);
    (focusables[0] ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const nextFocusables = getFocusableElements(dialog);
      if (nextFocusables.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = nextFocusables[0]!;
      const last = nextFocusables[nextFocusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className={styles.overlay} role="presentation">
      <Surface
        aria-labelledby={titleId}
        aria-modal="true"
        className={className ? `${styles.dialog} ${className}` : styles.dialog}
        padding="lg"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        tone="raised"
      >
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        {body ? <p className={styles.body}>{body}</p> : null}
        {children}
        {actions ? <div className={styles.footer}>{actions}</div> : null}
      </Surface>
    </div>
  );
}
