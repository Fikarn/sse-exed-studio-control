import type { ReactNode } from "react";

import styles from "./LightingRail.module.css";

export interface RailHeadProps {
  label: string;
  action?: ReactNode;
}

export function RailHead({ label, action }: RailHeadProps) {
  return (
    <header className={styles.head}>
      <span className={styles.headLabel}>{label}</span>
      {action ? <span className={styles.headAction}>{action}</span> : null}
    </header>
  );
}
