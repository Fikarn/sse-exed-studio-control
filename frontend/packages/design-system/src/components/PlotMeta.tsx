import type { ReactNode } from "react";

import styles from "./PlotMeta.module.css";

// LGS-02: the retired multi-hue blue is gone. The sole non-default tone marks the
// SELECTED plot subject and is colored with the themed green selection family
// (matching FixtureMarker's SELECTED_STROKE), so the chip agrees with the
// on-canvas selection ring instead of carrying an off-palette frozen blue.
export type PlotMetaTone = "default" | "selected";

export interface PlotMetaProps {
  label: ReactNode;
  value: ReactNode;
  tone?: PlotMetaTone;
  className?: string;
}

export const PlotMeta = ({ label, value, tone = "default", className }: PlotMetaProps) => {
  const classes = [styles.meta, tone === "selected" ? styles.selected : "", className].filter(Boolean).join(" ");
  // Visual overhaul A, Slice 9 (system §5): a plate at the drawer's level.
  return (
    <div className={classes} data-material="plate" data-level="float">
      <span>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
};
