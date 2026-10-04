import type { HTMLAttributes, ReactNode } from "react";

import styles from "./Well.module.css";

// The wells (the Atrium look): a black display one step down from the
// surface, a 1 px hairline edge, the one radius, flat. Field and Screen are
// wells; a Readout is the value itself in PT Sans, its unit at half size, a
// dashed yellow keyline round it in doubt. Slider, Groove and Meter live in
// their own files.

export interface WellProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Kept for the pages: every well takes the one radius now. */
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
  /** The printed value (`-3.8 dB`, or `-3.8` with `unit`); `—` when empty. */
  value?: ReactNode;
  /** The value's unit (`dB`, `%`), printed after it at half size in the quiet ink. */
  unit?: ReactNode;
  /** The desk has not confirmed this value: a dashed yellow keyline round it. */
  doubt?: boolean;
  /** No signal to print: the readout prints `—`. */
  empty?: boolean;
  /** 20 px word (default), the 28 px strip readout, the 40 px hero, or the 16 px value. */
  size?: "word" | "readout" | "hero" | "value";
  align?: "center" | "right";
  testId?: string;
}

export function Readout({
  value,
  unit,
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
        styles.readout,
        styles[size === "readout" ? "strip" : size],
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
      {empty ? (
        "—"
      ) : unit ? (
        <span>
          {value} <span className={styles.unit}>{unit}</span>
        </span>
      ) : (
        value
      )}
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
  /** A blue edge: editing offline (PREVIEW). */
  info?: boolean;
  testId?: string;
}

// The bay's picture: the plot, the step, the EQ.
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
