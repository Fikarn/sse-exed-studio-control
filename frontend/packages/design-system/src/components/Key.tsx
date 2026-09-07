import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

import { Lamp } from "./Lamp";
import styles from "./Key.module.css";

// Visual overhaul A, Slice 3 (system §5, §7; plan D2, D5, D6, D7): one
// primitive for every pressable thing. Modes name the meaning; `engaged`
// (amber) and `live` (green) are the lit fills; `locked` is a dashed outline
// at 55 % with `aria-disabled` and the reason within reach, never opacity
// alone; `cap` prints the deck's word in mono uppercase, `children` a
// sentence-case label. Keys do not travel: a press is a 100 ms edge change.
export type KeyMode = "command" | "primary" | "danger" | "toggle" | "momentary" | "arm" | "hazard" | "segmented";

export interface KeyProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  "data-armed"?: "true" | "false";
  mode?: KeyMode;
  /** The deck's word, printed mono uppercase (TALKBACK, DIM, → MAIN, 48 V). */
  cap?: ReactNode;
  /** A sentence-case label; used when there is no cap, or under one. */
  children?: ReactNode;
  /** A hint under the cap (`engaged`, `live · for the hold`, `press twice`). */
  hint?: ReactNode;
  /** The lit amber fill: an active mix target, solo, dim, mono, lighting on. */
  engaged?: boolean;
  /** The lit green fill: a held talkback, a running timer. */
  live?: boolean;
  /** Refused by the engine: dashed outline at 55 %, aria-disabled. */
  locked?: boolean;
  /** Why it is locked; printed as the title and exposed to assistive tech. */
  reason?: string;
  /** A hazard lamp on the key (48 V on): a red lamp and word, not a red fill. */
  lit?: boolean;
  /** A take-time control (≥ 28 px; measured by the UI contract). */
  take?: boolean;
  /** Layout: `row` (default) or `stack` (cap over hint, the tall talk key). */
  layout?: "row" | "stack";
  size?: "default" | "tall" | "small";
  testId?: string;
}

export function Key({
  mode = "command",
  cap,
  children,
  hint,
  engaged = false,
  live = false,
  locked = false,
  reason,
  lit = false,
  take = false,
  layout = "row",
  size = "default",
  testId,
  className,
  onClick,
  title,
  disabled,
  ...rest
}: KeyProps) {
  const isLit = (engaged || live) && !locked;
  const classes = [
    styles.key,
    styles[mode],
    styles[size],
    layout === "stack" ? styles.stack : "",
    engaged && !locked ? styles.engaged : "",
    live && !locked ? styles.live : "",
    locked ? styles.locked : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-key-mode={mode}
      data-material={mode === "segmented" && !isLit ? undefined : "key"}
      data-lit={isLit || rest["data-armed"] === "true" ? "" : undefined}
      data-engaged={engaged ? "" : undefined}
      data-live={live ? "" : undefined}
      data-locked={locked ? "" : undefined}
      data-take={take ? "" : undefined}
      data-testid={testId}
      aria-disabled={locked ? "true" : undefined}
      aria-pressed={mode === "toggle" ? engaged : undefined}
      disabled={disabled}
      title={locked && reason ? reason : title}
      aria-description={locked && reason ? reason : undefined}
      onClick={locked ? undefined : onClick}
      {...rest}
    >
      {mode === "hazard" ? <Lamp tone={lit ? "error" : "off"} className={styles.hazardLamp} /> : null}
      {cap ? <span className={styles.cap}>{cap}</span> : null}
      {children ? <span className={styles.label}>{children}</span> : null}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </button>
  );
}

export interface ArmKeyProps extends Omit<KeyProps, "mode"> {
  /** The key is armed: amber keyline, the armed tag, the countdown bar. */
  armed: boolean;
  /** The arm window, for the countdown bar's animation. */
  timeoutMs: number;
  /** Seconds left, printed on the tag when given (`3.9 s`). */
  secondsLeft?: number;
  /** The tag's words; default `ARMED · press again`. */
  armedWord?: string;
  /** Test id of the countdown bar; the Console's is `audio-arm-countdown`. */
  countdownTestId?: string;
}

// The arm-then-apply key: arming renders on the key itself (the tag, the
// keyline, the countdown bar) and nothing else moves (finding C1). The bar's
// CSS animation runs only while armed, so an idle surface stays still.
export function ArmKey({
  armed,
  timeoutMs,
  secondsLeft,
  armedWord = "ARMED · press again",
  countdownTestId = "audio-arm-countdown",
  cap,
  children,
  hint,
  className,
  ...rest
}: ArmKeyProps) {
  return (
    <Key
      mode="arm"
      cap={cap}
      hint={armed ? undefined : hint}
      className={[armed ? styles.armed : "", className].filter(Boolean).join(" ")}
      data-armed={armed ? "true" : "false"}
      {...rest}
    >
      {armed ? (
        <>
          <span className={styles.armedTag}>
            {armedWord}
            {secondsLeft !== undefined ? ` · ${secondsLeft.toFixed(1)} s` : ""}
          </span>
          {children ? <span className={styles.armedLabel}>{children}</span> : null}
          <i
            aria-hidden="true"
            className={styles.countdown}
            data-testid={countdownTestId}
            style={{ "--arm-duration": `${timeoutMs}ms` } as CSSProperties}
          />
        </>
      ) : (
        children
      )}
    </Key>
  );
}

export interface SegmentedProps {
  children: ReactNode;
  /** Accessible name of the group (`Mix target`). */
  label: string;
  className?: string;
  testId?: string;
}

// A well holding segmented keys; the lit one is the choice.
export function Segmented({ children, label, className, testId }: SegmentedProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={[styles.segmented, className].filter(Boolean).join(" ")}
      data-well=""
      data-testid={testId}
    >
      {children}
    </div>
  );
}
