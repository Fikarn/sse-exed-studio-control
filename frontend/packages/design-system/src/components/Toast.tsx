import { X } from "lucide-react";

import { Lamp, type LampTone } from "./Lamp";
import styles from "./Toast.module.css";

export type ToastTone = "ok" | "attention" | "error" | "info";

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
  /** Optional primary action — usually "Undo". Renders as a key at the
   *  toast's end. */
  action?: ToastAction;
  /** Dismiss button click. Always rendered. */
  onDismiss: () => void;
}

/**
 * Single toast bubble — a floating plate (level +3) with a lamp and its word
 * (visual overhaul A, Slice 3). Tones: ok, attention (amber), info, error
 * (sticky failures, announced assertively). Stacks are rendered by the
 * consumer via a portal — this primitive is one tile.
 */
export function Toast({ tone, message, title, action, onDismiss }: ToastProps) {
  return (
    <div
      className={styles.toast}
      data-tone={tone}
      data-level="float"
      data-material="plate"
      role={tone === "error" ? "alert" : "status"}
    >
      <Lamp tone={tone as LampTone} className={styles.lamp} />
      <div className={styles.body}>
        {title ? <div className={styles.title}>{title}</div> : null}
        <div className={styles.message}>{message}</div>
      </div>
      {action ? (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss message">
        <X aria-hidden="true" size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
