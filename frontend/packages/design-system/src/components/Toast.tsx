import { X } from "lucide-react";

import styles from "./Toast.module.css";

export type ToastTone = "ok" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  tone: ToastTone;
  /** Body copy. Required. */
  message: string;
  /** Optional one-line headline above the message. */
  title?: string;
  /** Optional primary action — usually "Undo". Renders as a low-affordance
   *  inline button to the right of the message. */
  action?: ToastAction;
  /** Dismiss button click. Always rendered. */
  onDismiss: () => void;
}

/**
 * Single toast bubble. Tones: ok (success / non-error confirmation),
 * info (neutral status), error (sticky failures). Stacks are rendered by
 * the consumer via a portal — this primitive is one tile.
 */
export function Toast({ tone, message, title, action, onDismiss }: ToastProps) {
  return (
    <div className={styles.toast} data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <div className={styles.body}>
        {title ? <div className={styles.title}>{title}</div> : null}
        <div className={styles.message}>{message}</div>
      </div>
      {action ? (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss">
        <X aria-hidden="true" size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
