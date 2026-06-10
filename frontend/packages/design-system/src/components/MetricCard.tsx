import styles from "./MetricCard.module.css";
import { StatusBadge, type StatusTone } from "./StatusBadge";

export interface MetricCardProps {
  caption: string;
  /** Human-readable badge label. Defaults to the raw `tone` token for
   *  backward compatibility; pass an explicit label so the badge doesn't
   *  echo the machine enum (COPY-04). */
  label?: string;
  /** Render the status badge beside the value. Defaults to `true`; pass
   *  `false` for a bare caption+value metric (e.g. a stat chip whose severity
   *  is carried by its own surrounding chrome). */
  showBadge?: boolean;
  tone?: StatusTone;
  value: string;
}

export const MetricCard = ({ caption, label, showBadge = true, tone = "idle", value }: MetricCardProps) => {
  return (
    <div className={styles.card}>
      <span className={styles.caption}>{caption}</span>
      <div className={styles.row}>
        <strong className={styles.value}>{value}</strong>
        {showBadge ? <StatusBadge label={label ?? tone} tone={tone} /> : null}
      </div>
    </div>
  );
};
