import { Children, type ReactNode } from "react";

import { Lamp, type LampTone } from "./Lamp";
import styles from "./LampWord.module.css";

// Visual overhaul A, Slice 3 (system §4, §7); Atrium: a lamp with its word
// within 8 px — colour never stands alone. Used in rows, tags and tier headers.
export interface LampWordProps {
  tone: LampTone;
  children: ReactNode;
  /** A state word: SSE Adelia in capitals, in the tone's colour, rather than a
   *  sentence-case PT Sans label in the quiet ink. */
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
  /** Who latched (`Solo`, `Scene`): SSE Adelia in capitals, so a word, not a count. */
  who: ReactNode;
  /** What it means (`on FX 3/4 · the mix you're hearing isn't the mix you're seeing`). */
  children?: ReactNode;
  /** The key that clears it, at the row's end. */
  action?: ReactNode;
  tone?: "attention" | "info";
  className?: string;
  testId?: string;
}

// A latched state the operator must see: a 56 px row keylined in its tone
// (yellow, or blue for information) with the way to clear it at its end. It
// lives in the LatchSlot under the state display.
export function Latch({ who, children, action, tone = "attention", className, testId }: LatchProps) {
  return (
    <div
      className={[styles.latch, styles[`latch-${tone}`], className].filter(Boolean).join(" ")}
      data-latch=""
      data-tone={tone}
      data-testid={testId}
      role="status"
    >
      <Lamp tone={tone} className={styles.latchLamp} />
      <b className={styles.who}>{who}</b>
      {children ? <span className={styles.text}>{children}</span> : null}
      {action ? <span className={styles.action}>{action}</span> : null}
    </div>
  );
}

export interface LatchSlotProps {
  /** The latches (`Latch`), none, one or two. */
  children?: ReactNode;
  /** The resting form's words when nothing is latched. */
  emptyLabel?: ReactNode;
  className?: string;
  testId?: string;
}

// The reserved home for latches under the state display, the same 56 px on
// every page, so the take-time keys below it never move. With nothing latched
// it shows its resting form: a hairline, a hollow lamp and `Nothing latched`.
// Two latches share the row; each keeps its word and its key, and its text
// gives way.
export function LatchSlot({ children, emptyLabel = "Nothing latched", className, testId }: LatchSlotProps) {
  const count = Children.toArray(children).length;
  return (
    <div
      className={[styles.latchSlot, count === 0 ? styles.resting : "", count > 1 ? styles.crowded : "", className]
        .filter(Boolean)
        .join(" ")}
      data-latch-slot=""
      data-count={count}
      data-testid={testId}
    >
      {count === 0 ? (
        <>
          <Lamp tone="off" className={styles.latchLamp} />
          <span className={styles.emptyLabel}>{emptyLabel}</span>
        </>
      ) : (
        children
      )}
    </div>
  );
}
