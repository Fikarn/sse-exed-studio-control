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
  // Visual overhaul A, Slice 9 (system §5): the pill floats over the plot, so
  // it is a plate at the drawer's level, not glass — and its dot is a lit lamp.
  return (
    <div className={classes} data-material="plate" data-level="float">
      <span className={styles.dot} data-lit="" aria-hidden="true" />
      <span className={styles.body}>{children}</span>
    </div>
  );
};
