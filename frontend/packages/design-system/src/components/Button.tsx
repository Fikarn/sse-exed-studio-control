import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "default" | "compact";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leadingVisual?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  /**
   * Renders a small spinner in the leadingVisual slot, disables interaction,
   * and sets aria-busy. Label text stays visible so the operator keeps
   * context for what the in-flight action was.
   */
  loading?: boolean;
}

function Spinner() {
  return (
    <svg className={styles.spinner} width={12} height={12} viewBox="0 0 24 24" role="presentation" aria-hidden="true">
      <circle cx={12} cy={12} r={9} stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} fill="none" />
      <path d="M12 3 a 9 9 0 0 1 9 9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" fill="none" />
    </svg>
  );
}

export const Button = ({
  children,
  className,
  leadingVisual,
  loading = false,
  size = "default",
  variant = "secondary",
  disabled,
  ...props
}: ButtonProps) => {
  const classes = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  const visual = loading ? <Spinner /> : leadingVisual;
  return (
    <button
      className={classes}
      type="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {visual ? <span className={styles.leading}>{visual}</span> : null}
      <span>{children}</span>
    </button>
  );
};
