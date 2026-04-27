import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./ToggleButton.module.css";

export type ToggleButtonTone = "default" | "success" | "warning" | "danger";

export interface ToggleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  children: ReactNode;
  description?: string;
  pressed: boolean;
  tone?: ToggleButtonTone;
}

export function ToggleButton({
  children,
  className,
  description,
  pressed,
  tone = "default",
  type = "button",
  ...props
}: ToggleButtonProps) {
  return (
    <button
      aria-pressed={pressed}
      className={[styles.toggle, styles[tone], className].filter(Boolean).join(" ")}
      type={type}
      {...props}
    >
      <span className={styles.indicator} aria-hidden="true" />
      <span className={styles.content}>
        <span className={styles.label}>{children}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </span>
    </button>
  );
}
