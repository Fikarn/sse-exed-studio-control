import type { HTMLAttributes, ReactNode } from "react";

import styles from "./Plate.module.css";

// Visual overhaul A, Slice 3 (system §7): the plate's sections — every
// section visible at once, no tab row. PlateHead (title, sub, one key),
// Section (title, count, header keys), Fields (a 2-column grid of Field
// wells), Readouts (label · value rows), ControlRow (label, slider, value)
// and Danger (the one red command, at the bottom).

export interface PlateHeadProps {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  testId?: string;
}

export function PlateHead({ title, sub, action, testId }: PlateHeadProps) {
  return (
    <header className={styles.head} data-plate-head="" data-testid={testId}>
      <div className={styles.headText}>
        <h2 className={styles.title}>{title}</h2>
        {sub ? <p className={styles.sub}>{sub}</p> : null}
      </div>
      {action ? <div className={styles.headAction}>{action}</div> : null}
    </header>
  );
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  /** A count or a short reading after the title (`2 fixtures`, `as the desk reports it`). */
  detail?: ReactNode;
  /** Keys at the head's end. */
  actions?: ReactNode;
  children?: ReactNode;
  testId?: string;
}

export function Section({ title, detail, actions, children, className, testId, ...rest }: SectionProps) {
  return (
    <section
      className={[styles.section, className].filter(Boolean).join(" ")}
      data-section=""
      data-testid={testId}
      {...rest}
    >
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{title}</span>
        {detail ? <span className={styles.sectionDetail}>{detail}</span> : null}
        {actions ? <span className={styles.sectionActions}>{actions}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Fields({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.fields, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export interface ReadoutRow {
  id?: string;
  label: ReactNode;
  value: ReactNode;
  tone?: "ok" | "attention" | "error" | "info";
}

export interface ReadoutsProps extends HTMLAttributes<HTMLDListElement> {
  rows: readonly ReadoutRow[];
}

export function Readouts({ rows, className, ...rest }: ReadoutsProps) {
  return (
    <dl className={[styles.readouts, className].filter(Boolean).join(" ")} {...rest}>
      {rows.map((row, index) => (
        <div key={row.id ?? index} className={styles.readoutRow}>
          <dt className={styles.readoutLabel}>{row.label}</dt>
          <dd className={[styles.readoutValue, row.tone ? styles[row.tone] : ""].filter(Boolean).join(" ")}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface ControlRowProps {
  label: ReactNode;
  /** A reading beside the label (`unity`, `3200 K`). */
  detail?: ReactNode;
  /** The slider. */
  children: ReactNode;
  /** The printed value, mono, 20 px, right-aligned. */
  value?: ReactNode;
  testId?: string;
}

export function ControlRow({ label, detail, children, value, testId }: ControlRowProps) {
  return (
    <div className={styles.controlRow} data-testid={testId}>
      <div className={styles.controlLabel}>
        <b>{label}</b>
        {detail ? <span>{detail}</span> : null}
      </div>
      <div className={styles.control}>
        {children}
        {value !== undefined ? <span className={styles.controlValue}>{value}</span> : null}
      </div>
    </div>
  );
}

export function Danger({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.danger, className].filter(Boolean).join(" ")} data-danger="" {...rest}>
      {children}
    </div>
  );
}
