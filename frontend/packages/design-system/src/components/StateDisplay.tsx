import type { CSSProperties, ReactNode } from "react";

import { Lamp } from "./Lamp";
import styles from "./StateDisplay.module.css";

// Visual overhaul A, Slice 3 (plan D1; system §2, §8): the first element of
// every cluster — a black display of fixed height carrying the lamp and the
// state word, the engine's sentence verbatim, the raw code small beneath,
// the meta line, and the way-out keys. Nothing below it ever moves; arming
// renders as a row inside it (finding C1).
export type StateDisplayTone = "ok" | "attention" | "error" | "info";

export interface StateDisplayArmed {
  /** The armed word, mono (`ARMED`). */
  word?: string;
  /** What is armed and how to apply (`Recall Interview block · press again to apply · Esc cancels`). */
  text: ReactNode;
  /** Seconds left, printed mono (`3.9 s`). */
  secondsLeft?: number;
  /** 0..1 of the window left, drawn as the bar. */
  progress: number;
}

export interface StateDisplayProps {
  tone: StateDisplayTone;
  /** The engine's word: VERIFIED, NOT VERIFIED, OFFLINE, REACHABLE, READY … */
  word: string;
  /** The engine's sentence, verbatim. */
  sentence?: ReactNode;
  /** The raw code, printed small and never first. */
  code?: ReactNode;
  /** The meta line: counts, last sync. */
  meta?: ReactNode;
  /** The way-out keys. */
  actions?: ReactNode;
  armed?: StateDisplayArmed | null;
  /** `<workspace>-state-display`. */
  testId?: string;
  className?: string;
}

export function StateDisplay({
  tone,
  word,
  sentence,
  code,
  meta,
  actions,
  armed,
  testId,
  className,
}: StateDisplayProps) {
  return (
    <section
      className={[styles.display, styles[tone], className].filter(Boolean).join(" ")}
      data-region="state-display"
      data-material="well"
      data-well=""
      data-tone={tone}
      data-testid={testId}
      aria-live="polite"
    >
      <div className={styles.top}>
        <Lamp tone={tone} className={styles.lamp} />
        <span className={styles.word}>{word}</span>
      </div>
      {sentence || code ? (
        <div className={styles.sentence}>
          {sentence}
          {code ? <span className={styles.code}>{code}</span> : null}
        </div>
      ) : null}
      {armed ? (
        <div className={styles.armedRow} data-armed-row="">
          <span className={styles.armedWord}>{armed.word ?? "ARMED"}</span>
          <span className={styles.armedText}>{armed.text}</span>
          {armed.secondsLeft !== undefined ? (
            <span className={styles.armedSeconds}>{armed.secondsLeft.toFixed(1)} s</span>
          ) : (
            <span />
          )}
          <span className={styles.bar} aria-hidden="true">
            <i style={{ "--arm-progress": String(Math.max(0, Math.min(1, armed.progress))) } as CSSProperties} />
          </span>
        </div>
      ) : meta ? (
        <div className={styles.meta}>{meta}</div>
      ) : (
        <div />
      )}
      {actions ? <div className={styles.actions}>{actions}</div> : <div />}
    </section>
  );
}
