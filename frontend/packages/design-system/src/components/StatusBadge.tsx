import styles from "./StatusBadge.module.css";

export type StatusTone = "healthy" | "ready" | "connected" | "degraded" | "warning" | "idle" | "error";

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

export const StatusBadge = ({ label, tone }: StatusBadgeProps) => {
  return <span className={`${styles.badge} ${styles[tone]}`}>{label}</span>;
};
