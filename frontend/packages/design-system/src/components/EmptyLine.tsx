import type { ReactNode } from "react";

import { Lamp } from "./Lamp";
import { Tooltip } from "./Tooltip";
import styles from "./EmptyLine.module.css";

// The visual overhaul's polish (2026-10-05): the one form of an empty list or
// section, on every page. One quiet line in PT Sans body (never a box, an
// icon, a bold title or a sentence): the words, the explanation as their
// tooltip (DESIGN.md §9, hints are tooltips), and at most one key at the end.
// `lamp` sets the latch slot's hollow lamp before the words, so "Nothing on the
// prompter" reads like "Nothing latched". Without a tip the line's text is
// exactly its words: the lamp carries none.

export interface EmptyLineProps {
  /** The words, short and without a full stop (`No scenes saved yet`). */
  children: ReactNode;
  /** The explanation, shown as the words' tooltip (`Set the rig, then save it as a new scene.`). */
  tip?: string;
  /** The latch slot's hollow lamp before the words. */
  lamp?: boolean;
  /** One key at the line's end (a small `Key`). */
  action?: ReactNode;
  testId?: string;
  className?: string;
}

export function EmptyLine({ children, tip, lamp = false, action, testId, className }: EmptyLineProps) {
  const words = <span className={styles.words}>{children}</span>;
  return (
    <p className={[styles.emptyLine, className].filter(Boolean).join(" ")} data-empty-line="" data-testid={testId}>
      {lamp ? <Lamp tone="off" className={styles.lamp} /> : null}
      {tip ? (
        <span className={styles.tip}>
          <Tooltip content={tip}>{words}</Tooltip>
        </span>
      ) : (
        words
      )}
      {action ? <span className={styles.action}>{action}</span> : null}
    </p>
  );
}
