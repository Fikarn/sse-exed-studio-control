import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

import { Lamp } from "./Lamp";
import styles from "./Key.module.css";

// Visual overhaul A, Slice 3 (system §5, §7; plan D2, D5, D6, D7); Atrium:
// one primitive for every pressable thing. A key is a flat face one step up
// from the surface with a 1 px edge; hover brightens the edge and nothing
// moves. Modes name the meaning; `engaged` (yellow) and `live` (green) are the
// lit fills with black ink; `locked` is a dashed outline at 55 % with
// `aria-disabled` and the reason within reach, never opacity alone;
// `selected` is the Beige 2 px keyline; `cap` prints the deck's word in SSE
// Adelia capitals, `children` a sentence-case PT Sans label.
export type KeyMode = "command" | "primary" | "danger" | "toggle" | "momentary" | "arm" | "hazard" | "segmented";

export interface KeyProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  "data-armed"?: "true" | "false";
  mode?: KeyMode;
  /** The deck's word, printed in SSE Adelia capitals (DIM, MONO, → MAIN).
   *  Never a value or a name that keeps its case. */
  cap?: ReactNode;
  /** A sentence-case label; used when there is no cap, or under one. */
  children?: ReactNode;
  /** A hint under the cap (`engaged`, `live · for the hold`, `press twice`). */
  hint?: ReactNode;
  /** The lit yellow fill: an active mix target, solo, dim, mono, lighting on. */
  engaged?: boolean;
  /** The lit green fill: something running (the prompter, a Find sequence). */
  live?: boolean;
  /** Refused by the engine: dashed outline at 55 %, aria-disabled. */
  locked?: boolean;
  /** Why it is locked; printed as the title and exposed to assistive tech. */
  reason?: string;
  /** A hazard lamp on the key (48 V on): a coral lamp and word, not a fill. */
  lit?: boolean;
  /** The chosen object: the Beige 2 px keyline, marked `data-selected`. */
  selected?: boolean;
  /** A take-time control (≥ 28 px; measured by the UI contract). */
  take?: boolean;
  /** Layout: `row` (default) or `stack` (cap over hint, a tall key). */
  layout?: "row" | "stack";
  /** Height: `small` 28, `default` 36, `large` 48, `tall` 64. */
  size?: "default" | "large" | "tall" | "small";
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
  selected = false,
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
    mode === "hazard" && lit ? styles.hazardOn : "",
    locked ? styles.locked : "",
    selected ? styles.selected : "",
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
      data-selected={selected ? "" : undefined}
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
  /** The key is armed: the Burgundy fill, the armed tag, the countdown bar. */
  armed: boolean;
  /** The arm window, for the countdown bar's animation. */
  timeoutMs: number;
  /** Seconds left, printed on the tag when given (`3.9 s`). */
  secondsLeft?: number;
  /** The tag's words; default `ARMED · press again`. Esc still cancels an arm
   *  (`useArm`); the tag no longer says so (new pages program, Slice 3 — D6). */
  armedWord?: string;
  /** Test id of the countdown bar; the Console's is `audio-arm-countdown`. */
  countdownTestId?: string;
  /**
   * At rest the key is a hazard, a coral lamp and the word (`REC` while the
   * camera records); armed, it is an armed key like any other. It stays the
   * same key, so the focus stays on it between the two presses.
   */
  hazard?: boolean;
}

// The arm-then-apply key: arming renders on the key itself, the one armed
// form (the Burgundy fill with Beige ink, the tag, the countdown bar), and
// nothing else moves (finding C1). The bar's CSS animation runs only while
// armed, so an idle surface stays still.
export function ArmKey({
  armed,
  timeoutMs,
  secondsLeft,
  armedWord = "ARMED · press again",
  countdownTestId = "audio-arm-countdown",
  hazard = false,
  cap,
  children,
  hint,
  className,
  ...rest
}: ArmKeyProps) {
  return (
    <Key
      mode={hazard && !armed ? "hazard" : "arm"}
      lit={hazard && !armed}
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

// One outlined row of flat segmented keys split by hairline rules; the lit
// (yellow) one is the choice. `data-well` stays for the pages and tests that
// find the group by it; the group is not drawn as a well.
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
