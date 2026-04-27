import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

import styles from "./IconButton.module.css";

export type IconButtonTone = "default" | "primary" | "danger" | "ghost";
export type IconButtonSize = "sm" | "md";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  badge?: string;
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  size?: IconButtonSize;
  tone?: IconButtonTone;
}

export function IconButton({
  badge,
  className,
  icon: Icon,
  label,
  pressed,
  size = "md",
  tone = "default",
  type = "button",
  ...props
}: IconButtonProps) {
  const classes = [styles.button, styles[tone], styles[size], className].filter(Boolean).join(" ");

  return (
    <button
      aria-label={label}
      aria-pressed={typeof pressed === "boolean" ? pressed : undefined}
      className={classes}
      title={label}
      type={type}
      {...props}
    >
      <Icon aria-hidden="true" className={styles.icon} strokeWidth={1.8} />
      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </button>
  );
}
