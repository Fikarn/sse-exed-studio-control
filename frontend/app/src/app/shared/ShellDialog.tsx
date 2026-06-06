import { useEffect, useRef } from "react";

import { Button, Surface } from "@sse/design-system";

import styles from "../OperatorShell.module.css";

// Mirrors the DS Dialog focus contract (Dialog.tsx): trap Tab inside the modal,
// close on Escape, and restore focus to the trigger on unmount. ShellDialog
// keeps its hand-built Surface rendering (Slice 2 decision: augment, not
// replace) so this adds the missing focus management without a visual change.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );
}

export function ShellDialog({
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
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
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
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
  }, [onCancel]);

  return (
    <div className={styles.overlay} role="presentation">
      <Surface
        aria-labelledby="shell-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        padding="lg"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        tone="raised"
      >
        <div className={styles.dialogTitle} id="shell-dialog-title">
          {title}
        </div>
        <p className={styles.dialogBody}>{body}</p>
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Surface>
    </div>
  );
}
