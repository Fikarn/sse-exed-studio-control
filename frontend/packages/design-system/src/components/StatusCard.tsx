import { Children, type ReactNode } from "react";

import styles from "./StatusCard.module.css";

// The Overview (D47; docs/design/overview-3.md §2): the state and the latches
// in one card at 12. The state display stands at its top-left with exactly
// the box it has on every page (180 high, the card's width), so the contract's
// "same place on every page" holds; the latch slot is the card's lower row,
// 72 high under a hairline, tinted yellow while something is latched. The
// card is the black well: the display and the latches drop their own edges,
// and an error draws the coral keyline round the whole card instead of round
// the display, so nothing inside moves. The display and the slot are the
// existing primitives, styled here through their data hooks.
export interface StatusCardProps {
  /** The display's tone is error: the coral keyline round the card. */
  error?: boolean;
  /** Something is latched: the latch row's tint and its yellow line. */
  latched?: boolean;
  /** The `StateDisplay`, then the `LatchSlot`. */
  children?: ReactNode;
  testId?: string;
}

export function StatusCard({ error = false, latched = false, children, testId }: StatusCardProps) {
  const [state, ...latches] = Children.toArray(children);
  return (
    <div
      className={styles.card}
      data-status-card=""
      data-tone={error ? "error" : undefined}
      data-latched={latched ? "" : undefined}
      data-testid={testId}
    >
      {state}
      <div className={styles.latchRow} data-status-latch-row="">
        {latches}
      </div>
    </div>
  );
}
