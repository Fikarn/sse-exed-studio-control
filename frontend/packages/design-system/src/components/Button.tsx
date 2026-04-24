import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "default" | "compact";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leadingVisual?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = ({
  children,
  className,
  leadingVisual,
  size = "default",
  variant = "secondary",
  ...props
}: ButtonProps) => {
  const classes = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");

  return (
    <button className={classes} type="button" {...props}>
      {leadingVisual ? <span className={styles.leading}>{leadingVisual}</span> : null}
      <span>{children}</span>
    </button>
  );
};
