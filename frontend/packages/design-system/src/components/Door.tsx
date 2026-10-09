import type { MouseEventHandler } from "react";

import styles from "./Door.module.css";

// The Overview (D47): a room's door, the small key at the right of its name
// band that opens the room's own page, with the page's name and SSE Adelia's
// arrow. A raised face at 8 with the light edge, so it reads as a key in the
// room's tone; the name in the second ink, the main ink under the pointer,
// and nothing moves.
export interface DoorProps {
  /** The page it opens, by its tab's name (`Cameras`). */
  page: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  testId?: string;
  disabled?: boolean;
}

export function Door({ page, onClick, testId, disabled }: DoorProps) {
  return (
    <button
      type="button"
      className={styles.door}
      data-door=""
      data-testid={testId}
      aria-label={`Open ${page}`}
      title={`Open the ${page} page`}
      disabled={disabled}
      onClick={onClick}
    >
      <span>{page}</span>
      <span className={styles.arrow} aria-hidden="true">
        →
      </span>
    </button>
  );
}
