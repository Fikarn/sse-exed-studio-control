import type { SharedStatusTone } from "./statusTone";
import styles from "./StatusBadge.module.css";

// Visual overhaul A, Slice 3 (system §8): the badge is a keyline that
// encloses a word — its tones are the shared state vocabulary
// (ok · attention · error · info · neutral). The pre-A names stay as
// aliases until Slice 11.
export type StatusBadgeLegacyTone = "healthy" | "ready" | "connected" | "degraded" | "warning" | "idle";
export type StatusTone = SharedStatusTone | StatusBadgeLegacyTone;

const CANONICAL: Record<StatusTone, SharedStatusTone> = {
  ok: "ok",
  attention: "attention",
  error: "error",
  info: "info",
  neutral: "neutral",
  healthy: "ok",
  ready: "ok",
  connected: "ok",
  degraded: "attention",
  warning: "attention",
  idle: "neutral",
};

export function canonicalBadgeTone(tone: StatusTone): SharedStatusTone {
  return CANONICAL[tone] ?? "neutral";
}

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

export const StatusBadge = ({ label, tone }: StatusBadgeProps) => {
  const canonical = canonicalBadgeTone(tone);
  return (
    <span className={`${styles.badge} ${styles[canonical]} ${styles[tone]}`} data-tone={canonical}>
      {label}
    </span>
  );
};
