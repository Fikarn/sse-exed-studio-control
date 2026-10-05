import { useEffect, useRef } from "react";

import { Key } from "@sse/design-system";

import styles from "../OperatorShell.module.css";
import { useLiveCallback } from "./useLiveCallback";

// Mirrors the DS Dialog focus contract (Dialog.tsx): trap Tab inside the modal,
// close on Escape, and restore focus to the trigger on unmount. The visual
// overhaul's polish (2026-10-05): it is drawn as the design system's dialog
// (the floating layer over a flat scrim, a 20 px PT Sans title, the sentence
// in body type) with the design system's keys, and no backdrop blur. It keeps
// its own markup for the window listener below.
//
// New pages program, Slice 3 (D6): the shell's window key handler used to catch
// an Escape pressed after focus had left the dialog (a click on the backdrop, a
// window that lost focus). It is gone with the shortcuts, so the dialog listens
// on the window itself while it is up: Escape closes it wherever focus is, and
// Tab brings focus back inside. Escape is plain keyboard operation — it closes
// a dialog — and binds no function of its own.
//
// It listens in the capture phase, so it takes a key before anything beneath it
// that listens on the window. "Close Studio Control?" can open over a Console
// with an armed 48 V change or snapshot load, whose Esc listener was added first
// and so would run first in the bubble phase: the Esc that closes the dialog
// would cancel the arm too. Taken first and default-prevented, it closes only
// the dialog; the arm's listener passes over a prevented Esc.
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
  // The latest onCancel, read when a key arrives. The listener is set up once
  // per opening: re-running it whenever the caller passes a new callback (an
  // inline one changes on every render of the shell) would move focus back to
  // the first key mid-choice.
  const cancel = useLiveCallback(onCancel);

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
        cancel();
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
      const active = document.activeElement;
      if (!(active instanceof Node) || !dialog.contains(active)) {
        // Focus had left the modal: Tab brings it back in.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [cancel]);

  return (
    <div className={styles.overlay} role="presentation">
      <section
        aria-labelledby="shell-dialog-title"
        aria-modal="true"
        className={styles.dialog}
        data-level="float"
        data-material="plate"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className={styles.dialogTitle} id="shell-dialog-title">
          {title}
        </h2>
        <p className={styles.dialogBody}>{body}</p>
        <div className={styles.dialogActions}>
          <Key onClick={onCancel}>Cancel</Key>
          <Key mode="primary" onClick={onConfirm}>
            {confirmLabel}
          </Key>
        </div>
      </section>
    </div>
  );
}
