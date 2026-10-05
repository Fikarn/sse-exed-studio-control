import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { Field, Lamp, LampWord, Screen, Section, Tooltip, type LampTone } from "@sse/design-system";

import styles from "./SetupStepScreen.module.css";

// A screen of Setup's bay (the visual overhaul, 2026-10-05): a step of the
// runner, Support or the cameras' setup, on the bay's well. On the left what
// the screen is (its sentence is the title's tooltip), the lines that must be
// read before a press, the fields and facts it works from, and the keys that
// do it; on the right what it records, as rows under hairlines. Nothing on it
// is a card, and it is never taller than the bay.
//
// The visual overhaul's polish (2026-10-05): the well fills the bay from the
// frame's top line to its foot, with no head over it (the cluster's Runner ·
// Support · Cameras switch names the view); the eyebrow and the title stand
// across both columns, so the left column and the record start on one line;
// the record is the design system's sections over rows drawn as its Readouts,
// and a lamp stands only beside its word.

export interface SetupStepScreenProps {
  /** `Step 5 of 5` on the runner's steps, with what the runner is as its
   *  tooltip; none on Support and the cameras' setup. */
  eyebrow?: ReactNode;
  title: string;
  /** What the screen does, in a sentence or two: the title's tooltip. */
  lead: string;
  /** Lines that stay on screen (a state, a lock, what a press changes); a line
   *  with a tone has its lamp, a plain line none. */
  rules?: readonly { id: string; text: ReactNode; tone?: LampTone; testId?: string }[];
  /** The fields and facts the screen works from. */
  facts?: ReactNode;
  /** The key that does the step, the way back. */
  actions?: ReactNode;
  /** A line under the keys that stays on screen: what the press changes. */
  note?: ReactNode;
  /** The right column: what the screen records, as `SetupRecordSection`s. */
  record?: ReactNode;
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
  wide = false,
  testId,
}: SetupStepScreenProps) {
  return (
    <Screen className={styles.frame} testId={testId}>
      <div className={styles.step} data-wide={wide ? "" : undefined}>
        <div className={styles.head}>
          {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
          <h1 className={styles.title}>
            <Tooltip content={lead} placement="bottom">
              <span>{title}</span>
            </Tooltip>
          </h1>
        </div>
        <div className={styles.column}>
          {rules.length > 0 ? (
            <div className={styles.rules}>
              {rules.map((rule) => (
                <p key={rule.id} className={styles.rule} data-testid={rule.testId}>
                  {/* A lamp only where the line says how something stands. */}
                  {rule.tone && rule.tone !== "off" ? <Lamp tone={rule.tone} className={styles.ruleLamp} /> : null}
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
  tone?: LampTone;
  testId?: string;
}

/** A fact the screen works from: what it is and what it says. */
export function SetupFactCard({ label, value, tone = "ok", testId }: SetupFactCardProps) {
  return (
    <div className={styles.card} data-tone={tone} data-testid={testId}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValue}>{value}</span>
    </div>
  );
}

export interface SetupRecordRowProps {
  label: ReactNode;
  value: ReactNode;
  /** How the value stands. Attention and error colour the value's own words;
   *  ok and off draw nothing, for a name, an address or a count is not a state. */
  tone?: LampTone;
  /** The value is a state word (`PASSED`, `LIVE`): drawn with its lamp, as the
   *  cluster draws a probe's. */
  word?: boolean;
  testId?: string;
}

/** One line of what the screen records: what it is in the quiet ink, its value
 *  in the ink, on a hairline, as the plate's Readouts draw a row. */
export function SetupRecordRow({ label, value, tone = "off", word = false, testId }: SetupRecordRowProps) {
  return (
    <div className={styles.row} data-tone={tone} data-testid={testId}>
      <span className={styles.rowLabel}>{label}</span>
      {word ? (
        <LampWord tone={tone} className={styles.rowWord}>
          {value}
        </LampWord>
      ) : (
        <span className={styles.rowValue}>{value}</span>
      )}
    </div>
  );
}

export interface SetupRecordSectionProps {
  title: ReactNode;
  /** A count after the title (`11 backups`). */
  detail?: ReactNode;
  children?: ReactNode;
  testId?: string;
}

/** A part of what the screen records: the design system's section head (an
 *  Adelia word over the heavy rule, a quiet count), then its rows. */
export function SetupRecordSection({ title, detail, children, testId }: SetupRecordSectionProps) {
  return (
    <Section title={title} detail={detail} testId={testId}>
      <div className={styles.rows}>{children}</div>
    </Section>
  );
}
