import type { PointerEvent as ReactPointerEvent } from "react";

import styles from "./ColumnResizer.module.css";

export interface ColumnResizerProps {
  ariaLabel: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function ColumnResizer({ ariaLabel, onPointerDown }: ColumnResizerProps) {
  return (
    <div
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
    >
      <span className={styles.grip} aria-hidden="true" />
    </div>
  );
}
