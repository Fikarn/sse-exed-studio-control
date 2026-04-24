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
  status?: keyof typeof toneByStatus;
}

export function StatusPill({ label, status = "info" }: StatusPillProps) {
  return (
    <div className={styles.pill} style={{ "--tone": toneByStatus[status] } as CSSProperties}>
      <span className={styles.dot} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
