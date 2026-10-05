import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { Field, Lamp, Screen, Tooltip, type LampTone } from "@sse/design-system";

import styles from "./SetupStepScreen.module.css";

// A screen of Setup's bay (the visual overhaul, 2026-10-05): a step of the
// runner, Support or the cameras' setup, on the bay's well. On the left what
// the screen is (its sentence is the title's tooltip), the lines that must be
// read before a press, the fields and facts it works from, and the keys that
// do it; on the right what it records, as rows under hairlines. Nothing on it
// is a card, and it is never taller than the bay.

export interface SetupStepScreenProps {
  /** `Step 5 of 5`. */
  eyebrow: string;
  title: string;
  /** What the screen does, in a sentence or two: the title's tooltip. */
  lead: string;
  /** Lines that stay on screen (a state, a lock, what a press changes), each with a lamp. */
  rules?: readonly { id: string; text: ReactNode; tone?: LampTone; testId?: string }[];
  /** The fields and facts the screen works from. */
  facts?: ReactNode;
  /** The key that does the step, the way back. */
  actions?: ReactNode;
  /** A line under the keys that stays on screen: what the press changes. */
  note?: ReactNode;
  /** The right column: what the screen records. */
  record?: ReactNode;
  /** The screen's own header: what the bay shows. */
  head?: ReactNode;
  /** One wide column and no record (the cameras' setup). */
  wide?: boolean;
  testId?: string;
}

export function SetupStepScreen({
  eyebrow,
  title,
  lead,
  rules = [],
  facts,
  actions,
  note,
  record,
  head,
  wide = false,
  testId,
}: SetupStepScreenProps) {
  return (
    <Screen head={head} className={styles.frame} testId={testId}>
      <div className={styles.step} data-wide={wide ? "" : undefined}>
        <div className={styles.column}>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <h1 className={styles.title}>
            <Tooltip content={lead} placement="bottom">
              <span>{title}</span>
            </Tooltip>
          </h1>
          {rules.length > 0 ? (
            <div className={styles.rules}>
              {rules.map((rule) => (
                <p key={rule.id} className={styles.rule} data-testid={rule.testId}>
                  <Lamp tone={rule.tone ?? "off"} />
                  <span>{rule.text}</span>
                </p>
              ))}
            </div>
          ) : null}
          {facts ? <div className={styles.facts}>{facts}</div> : null}
          {actions ? <div className={styles.go}>{actions}</div> : null}
          {note ? <p className={styles.note}>{note}</p> : null}
        </div>
        {record ? <div className={styles.record}>{record}</div> : null}
      </div>
    </Screen>
  );
}

export interface SetupFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  label: string;
  /** Across the facts' two columns. */
  wide?: boolean;
  testId?: string;
}

/** A field of the screen: the design system's field, its label over the input. */
export function SetupField({ label, wide = false, testId, ...input }: SetupFieldProps) {
  const id = useId();
  return (
    <Field
      className={[styles.field, wide ? styles.wide : ""].filter(Boolean).join(" ")}
      label={<label htmlFor={id}>{label}</label>}
      value={<input id={id} className={styles.input} autoComplete="off" data-testid={testId} {...input} />}
    />
  );
}

export interface SetupFactCardProps {
  label: string;
  value: ReactNode;
  standing?: ReactNode;
  tone?: LampTone;
  testId?: string;
}

/** A fact the screen works from: what it is, what it says, and how it stands. */
export function SetupFactCard({ label, value, standing, tone = "ok", testId }: SetupFactCardProps) {
  return (
    <div className={styles.card} data-tone={tone} data-testid={testId}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValue}>{value}</span>
      {standing ? (
        <span className={styles.cardStanding}>
          <Lamp tone={tone} />
          {standing}
        </span>
      ) : null}
    </div>
  );
}

export interface SetupRecordRowProps {
  label: ReactNode;
  value: ReactNode;
  tone?: LampTone;
  testId?: string;
}

/** One line of what the screen records: a lamp, what it is, and its value. */
export function SetupRecordRow({ label, value, tone = "off", testId }: SetupRecordRowProps) {
  return (
    <div className={styles.row} data-testid={testId}>
      <span className={styles.rowLabel}>
        <Lamp tone={tone} />
        {label}
      </span>
      <b className={styles.rowValue}>{value}</b>
    </div>
  );
}

export function SetupRecordHeading({ children }: { children: ReactNode }) {
  return <div className={styles.recordHeading}>{children}</div>;
}
