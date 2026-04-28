import styles from "./StatusDot.module.css";

export type StatusDotState = "ok" | "attn" | "err" | "info";
export type StatusDotSize = "sm" | "md";

export interface StatusDotProps {
  state: StatusDotState;
  size?: StatusDotSize;
  glow?: boolean;
  className?: string;
}

export const StatusDot = ({ state, size = "md", glow = true, className }: StatusDotProps) => {
  const classes = [styles.dot, styles[state], styles[size], glow ? styles.glow : "", className]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} aria-hidden="true" />;
};
