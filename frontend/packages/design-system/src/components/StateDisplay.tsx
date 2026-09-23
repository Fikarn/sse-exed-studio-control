import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

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
  /** 0..1 of the window left, drawn as the bar (a still bar). */
  progress?: number;
  /** The arm window: the bar runs its own countdown, so no ticking state. */
  timeoutMs?: number;
}

export interface StateDisplayProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
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
  ...rest
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
      {...rest}
    >
      <div className={styles.top}>
        <Lamp tone={tone} className={styles.lamp} />
        <span className={styles.word}>{word}</span>
      </div>
      {sentence || code ? (
        <div className={styles.sentence}>
          {sentence}
          {/* data-state-code: the one place a raw fault code is allowed to
              stand on its own — it is the code slot, never the first thing the
              sentence says. The operator-copy census keys on this marker. */}
          {code ? (
            <span className={styles.code} data-state-code="">
              {code}
            </span>
          ) : null}
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
            <i
              className={armed.timeoutMs ? styles.barCountdown : undefined}
              style={
                {
                  "--arm-progress": String(Math.max(0, Math.min(1, armed.progress ?? 1))),
                  "--arm-duration": armed.timeoutMs ? `${armed.timeoutMs}ms` : undefined,
                } as CSSProperties
              }
            />
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
