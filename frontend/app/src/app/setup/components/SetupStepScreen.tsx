import type { ReactNode } from "react";

import { Lamp, Screen, type LampTone } from "@sse/design-system";

import styles from "./SetupStepScreen.module.css";

// Visual overhaul A, Slice 7 (A-setup.html's screen): a commissioning step is a
// backlit screen at the height the step needs — never a scrolling panel. On the
// left what the step is, the rules that govern it, the facts it works from and
// the key that does it; on the right what the step records and what it depends
// on, so the operator can see the consequence before pressing anything.

export interface SetupStepScreenProps {
  /** `Step 5 of 5`. */
  eyebrow: string;
  title: string;
  /** One or two sentences on what the step does. */
  lead: ReactNode;
  /** The rules that govern the step, each with a lamp. */
  rules?: readonly { id: string; text: ReactNode; tone?: LampTone }[];
  /** The fact cards or fields the step works from. */
  facts?: ReactNode;
  /** The key that does the step, the way back, and the note under them. */
  actions?: ReactNode;
  note?: ReactNode;
  /** The right column: what the step records. */
  record?: ReactNode;
  /** The screen's own header: what the runner is and where it is. */
  head?: ReactNode;
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
  testId,
}: SetupStepScreenProps) {
  return (
    <Screen head={head} className={styles.frame} testId={testId}>
      <div className={styles.step}>
        <div className={styles.column}>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.lead}>{lead}</div>
          {rules.length > 0 ? (
            <div className={styles.rules}>
              {rules.map((rule) => (
                <div key={rule.id} className={styles.rule}>
                  <Lamp tone={rule.tone ?? "ok"} />
                  <span>{rule.text}</span>
                </div>
              ))}
            </div>
          ) : null}
          {facts ? <div className={styles.facts}>{facts}</div> : null}
          {actions || note ? (
            <div className={styles.go}>
              {actions}
              {note ? <span className={styles.note}>{note}</span> : null}
            </div>
          ) : null}
        </div>
        {record ? <div className={styles.record}>{record}</div> : null}
      </div>
    </Screen>
  );
}

export interface SetupFactCardProps {
  label: string;
  value: ReactNode;
  standing?: ReactNode;
  tone?: LampTone;
  testId?: string;
}

/** A fact the step works from: what it is, what it says, and how it stands. */
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

/** One line of what the step records: a lamp, what it is, and its value. */
export function SetupRecordRow({ label, value, tone = "ok", testId }: SetupRecordRowProps) {
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
