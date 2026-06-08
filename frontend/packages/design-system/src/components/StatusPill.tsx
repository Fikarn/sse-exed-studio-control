import type { CSSProperties } from "react";

import styles from "./StatusPill.module.css";

const toneByStatus = {
  ok: "var(--color-primary-500)",
  attention: "var(--color-warning-500)",
  error: "var(--color-danger-500)",
  info: "var(--color-info-500)",
} as const;

export interface StatusPillProps {
  label: string;
  /** DES-07: aligned to the shared `tone` prop name used by every status
   *  primitive (was `status`). */
  tone?: keyof typeof toneByStatus;
}

export function StatusPill({ label, tone = "info" }: StatusPillProps) {
  return (
    <div className={styles.pill} style={{ "--tone": toneByStatus[tone] } as CSSProperties} title={label}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
