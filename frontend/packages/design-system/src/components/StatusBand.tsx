import type { HTMLAttributes, ReactNode } from "react";

import styles from "./StatusBand.module.css";

export type StatusBandTone = "neutral" | "ready" | "degraded" | "warning" | "error";

export interface StatusBandProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  actions?: ReactNode;
  live?: "off" | "polite" | "assertive";
  summary?: ReactNode;
  title: ReactNode;
  tone?: StatusBandTone;
}

export function StatusBand({
  actions,
  className,
  live = "polite",
  summary,
  title,
  tone = "neutral",
  ...props
}: StatusBandProps) {
  return (
    <div
      aria-live={live}
      className={[styles.band, styles[tone], className].filter(Boolean).join(" ")}
      role={live === "off" ? undefined : "status"}
      {...props}
    >
      <span className={styles.signal} aria-hidden="true" />
      <div className={styles.content}>
        <strong className={styles.title}>{title}</strong>
        {summary ? <span className={styles.summary}>{summary}</span> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
