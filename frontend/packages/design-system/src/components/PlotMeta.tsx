import type { ReactNode } from "react";

import styles from "./PlotMeta.module.css";

export type PlotMetaTone = "default" | "blue";

export interface PlotMetaProps {
  label: ReactNode;
  value: ReactNode;
  tone?: PlotMetaTone;
  className?: string;
}

export const PlotMeta = ({ label, value, tone = "default", className }: PlotMetaProps) => {
  const classes = [styles.meta, tone === "blue" ? styles.blue : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <span>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
};
