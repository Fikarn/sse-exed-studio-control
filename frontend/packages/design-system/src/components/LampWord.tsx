import type { ReactNode } from "react";

import { Lamp, type LampTone } from "./Lamp";
import styles from "./LampWord.module.css";

// Visual overhaul A, Slice 3 (system §4, §7): a lamp with its word within
// 8 px — colour never stands alone. Used in rows, tags and tier headers.
export interface LampWordProps {
  tone: LampTone;
  children: ReactNode;
  /** Mono uppercase (a state word) rather than a sentence-case label. */
  cap?: boolean;
  className?: string;
  testId?: string;
}

export function LampWord({ tone, children, cap = true, className, testId }: LampWordProps) {
  return (
    <span
      className={[styles.lampWord, styles[tone], cap ? styles.cap : "", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-testid={testId}
    >
      <Lamp tone={tone} />
      <span>{children}</span>
    </span>
  );
}

export interface LatchProps {
  /** Who latched (`1 solo`, `Scene`). */
  who: ReactNode;
  /** What it means (`on FX 3/4 · the mix you're hearing isn't the mix you're seeing`). */
  children?: ReactNode;
  /** The key that clears it, at the row's end. */
  action?: ReactNode;
  tone?: "attention" | "info";
  className?: string;
  testId?: string;
}

// A latched state the operator must see: an amber row in the cluster with
// the way to clear it at its end.
export function Latch({ who, children, action, tone = "attention", className, testId }: LatchProps) {
  return (
    <div
      className={[styles.latch, styles[`latch-${tone}`], className].filter(Boolean).join(" ")}
      data-latch=""
      data-tone={tone}
      data-testid={testId}
      role="status"
    >
      <Lamp tone={tone} />
      <b className={styles.who}>{who}</b>
      {children ? <span className={styles.text}>{children}</span> : null}
      {action ? <span className={styles.action}>{action}</span> : null}
    </div>
  );
}
