import type { ReactNode } from "react";

import styles from "./LightingRail.module.css";

export interface RailHeadProps {
  label: string;
  count?: ReactNode;
  action?: ReactNode;
}

export function RailHead({ label, count, action }: RailHeadProps) {
  return (
    <header className={styles.head}>
      <span className={styles.headLabel}>{label}</span>
      {count !== undefined && count !== null ? <span className={styles.headCount}>{count}</span> : null}
      {action ? <span className={styles.headAction}>{action}</span> : null}
    </header>
  );
}
