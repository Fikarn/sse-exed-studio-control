import styles from "./StatusDot.module.css";

export type StatusDotState = "ok" | "attn" | "err" | "info";
export type StatusDotSize = "sm" | "md";

export interface StatusDotProps {
  /** DES-07: aligned to the shared `tone` prop name used by every status
   *  primitive (was `state`). */
  tone: StatusDotState;
  size?: StatusDotSize;
  glow?: boolean;
  className?: string;
}

export const StatusDot = ({ tone, size = "md", glow = true, className }: StatusDotProps) => {
  const classes = [styles.dot, styles[tone], styles[size], glow ? styles.glow : "", className]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} aria-hidden="true" />;
};
