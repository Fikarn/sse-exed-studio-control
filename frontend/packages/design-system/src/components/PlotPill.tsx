import type { ReactNode } from "react";

import styles from "./PlotPill.module.css";

export type PlotPillState = "default" | "modified" | "patch";

export interface PlotPillProps {
  state?: PlotPillState;
  children: ReactNode;
  className?: string;
}

export const PlotPill = ({ state = "default", children, className }: PlotPillProps) => {
  const classes = [styles.pill, styles[state], className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.body}>{children}</span>
    </div>
  );
};
