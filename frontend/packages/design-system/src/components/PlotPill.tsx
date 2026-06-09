import type { ReactNode } from "react";

import styles from "./PlotPill.module.css";

// LGS-02: the third state is the PREVIEW pill (offline scene editing), not a DMX
// "patch" — renamed off the misnomer and recolored to the sanctioned amber preview
// tone (matches the preview StatusDot / banner), retiring the multi-hue blue.
export type PlotPillState = "default" | "modified" | "preview";

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
