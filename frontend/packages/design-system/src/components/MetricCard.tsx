import styles from "./MetricCard.module.css";
import { StatusBadge, type StatusTone } from "./StatusBadge";

export interface MetricCardProps {
  caption: string;
  tone?: StatusTone;
  value: string;
}

export const MetricCard = ({
  caption,
  tone = "idle",
  value
}: MetricCardProps) => {
  return (
    <div className={styles.card}>
      <span className={styles.caption}>{caption}</span>
      <div className={styles.row}>
        <strong className={styles.value}>{value}</strong>
        <StatusBadge label={tone} tone={tone} />
      </div>
    </div>
  );
};
