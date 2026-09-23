import type { HTMLAttributes, ReactNode } from "react";

import styles from "./Well.module.css";

// Visual overhaul A, Slice 3 (system §5, §7): a well is a black backlit
// display in every theme — whatever is printed on it uses the display inks
// (the `.well, [data-well]` scope in themes.css). Readout, Field and Screen
// are wells; Slider, Groove and Meter live in their own files.

export interface WellProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** 12 px radius for the state display, screens and plots; 8 px otherwise. */
  radius?: "key" | "screen";
}

export function Well({ children, className, radius = "key", ...rest }: WellProps) {
  return (
    <div className={[styles.well, styles[radius], className].filter(Boolean).join(" ")} data-well="" {...rest}>
      {children}
    </div>
  );
}

export interface ReadoutProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The printed value with sign and unit (`-3.8 dB`); `—` when empty. */
  value?: ReactNode;
  /** The desk has not confirmed this value: a dashed amber keyline. */
  doubt?: boolean;
  /** No signal to print: the readout prints `—`. */
  empty?: boolean;
  /** 20 px word (default) or the 44 px hero. */
  size?: "word" | "hero" | "value";
  align?: "center" | "right";
  testId?: string;
}

export function Readout({
  value,
  doubt = false,
  empty = false,
  size = "word",
  align = "center",
  className,
  testId,
  ...rest
}: ReadoutProps) {
  return (
    <div
      className={[
        styles.well,
        styles.key,
        styles.readout,
        styles[size],
        styles[align],
        doubt ? styles.doubt : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-well=""
      data-doubt={doubt ? "" : undefined}
      data-empty={empty ? "" : undefined}
      data-testid={testId}
      {...rest}
    >
      {empty ? "—" : value}
    </div>
  );
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: ReactNode;
  value: ReactNode;
  testId?: string;
}

export function Field({ label, value, className, testId, ...rest }: FieldProps) {
  return (
    <div
      className={[styles.well, styles.key, styles.field, className].filter(Boolean).join(" ")}
      data-well=""
      data-testid={testId}
      {...rest}
    >
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  );
}

export interface ScreenProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** The screen's header row (title, sub, keys), above the picture. */
  head?: ReactNode;
  /** A blue keyline: editing offline (PREVIEW). */
  info?: boolean;
  testId?: string;
}

// The bay's picture: the plot, the timeline, the step, the EQ.
export function Screen({ children, head, info = false, className, testId, ...rest }: ScreenProps) {
  return (
    <div
      className={[styles.screenFrame, className].filter(Boolean).join(" ")}
      data-screen=""
      data-testid={testId}
      {...rest}
    >
      {head ? <div className={styles.screenHead}>{head}</div> : null}
      <div className={[styles.well, styles.screen, info ? styles.info : ""].filter(Boolean).join(" ")} data-well="">
        {children}
      </div>
    </div>
  );
}
