import type { ReactNode } from "react";

import styles from "./GroupedList.module.css";

// The Overview (D47; docs/design/overview-3.md §2): the one list. A grouped,
// inset list: one rounded face at 12 in the key's tone (the room's, inside a
// room) with the light edge, its rows on hairlines that start after the row's
// own 14 px margin. A row is a label in the second ink and its value bold at
// the right in the main ink, with a note after it; or, for a row that needs
// another shape (the studio's rows, the cues), whatever the page passes.
// The quiet ink never stands on a list: it misses 4.5:1 on the green and
// slate keys.
export interface GroupedListProps {
  /** Rows 42 high rather than 34 (the studio). */
  tall?: boolean;
  children?: ReactNode;
  testId?: string;
  className?: string;
}

export function GroupedList({ tall = false, children, testId, className }: GroupedListProps) {
  return (
    <div
      role="list"
      className={[styles.list, tall ? styles.tall : "", className].filter(Boolean).join(" ")}
      data-grouped-list=""
      data-tall={tall ? "" : undefined}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export interface GroupedListRowProps {
  /** At the left, in the second ink (`Take length`). */
  label?: ReactNode;
  /** At the right, bold, in the main ink (`04:12`). */
  value?: ReactNode;
  /** After the value, at 14 in the second ink (`counted here`). */
  note?: ReactNode;
  /** A value no longer read (system §4): yellow, with the dashed keyline
   *  2 px off it. In a free row, the element marked `data-row-value` takes it. */
  doubt?: boolean;
  /** A free row in place of the label, value and note. */
  children?: ReactNode;
  testId?: string;
  className?: string;
}

export function GroupedListRow({
  label,
  value,
  note,
  doubt = false,
  children,
  testId,
  className,
}: GroupedListRowProps) {
  const free = children !== undefined && children !== null;
  return (
    <div
      role="listitem"
      className={[styles.row, className].filter(Boolean).join(" ")}
      data-grouped-row=""
      data-doubt={doubt ? "" : undefined}
      data-testid={testId}
    >
      {free ? (
        children
      ) : (
        <>
          {label !== undefined ? <span className={styles.label}>{label}</span> : null}
          {value !== undefined || note !== undefined ? (
            <span className={styles.value}>
              {value !== undefined ? <span data-row-value="">{value}</span> : null}
              {note !== undefined ? <span className={styles.note}>{note}</span> : null}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
