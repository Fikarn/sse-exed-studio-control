import type { SharedStatusTone } from "./statusTone";
import styles from "./StatusBadge.module.css";

// Visual overhaul A, Slice 3 (system §8): the badge is a keyline that encloses
// a word, and its tones are the shared state vocabulary — ok · attention ·
// error · info · neutral. Slice 11: the pre-A names (healthy, ready, connected,
// degraded, warning, idle) were aliases for those five and are gone, along with
// the map that folded them in; every caller speaks the vocabulary directly.
export type StatusTone = SharedStatusTone;

export function canonicalBadgeTone(tone: StatusTone): SharedStatusTone {
  return tone;
}

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

export const StatusBadge = ({ label, tone }: StatusBadgeProps) => {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} data-tone={tone}>
      {label}
    </span>
  );
};
