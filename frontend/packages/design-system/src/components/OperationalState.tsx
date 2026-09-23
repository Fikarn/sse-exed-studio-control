import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox } from "lucide-react";

import { Button, type ButtonVariant } from "./Button";
import { Lamp } from "./Lamp";
import styles from "./OperationalState.module.css";

// Visual overhaul A, Slice 3 (findings H5, H6): EmptyState and DegradedState
// are keylined plates that read as one row and stack to one column when the
// host is narrower than 320 px (a container query, so a narrow rail never
// wraps one word per line). LoadingState is a skeleton drawn at the host's
// geometry, with no animation — an idle surface stays still.

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
  /** Optional leading icon (Lucide component reference). */
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Single primary CTA. Renders as a compact `<Button>` and is the F10
   *  empty-state pattern — prefer this over the `actions` slot for the
   *  common "single CTA" case. Stacks before any nodes passed via `actions`. */
  action?: EmptyStateAction;
  /** Free-form actions slot for advanced compositions (multiple buttons,
   *  custom JSX). Most consumers should use `action` instead. */
  actions?: ReactNode;
  icon?: LucideIcon;
  message?: ReactNode;
  title: ReactNode;
}

export function EmptyState({
  action,
  actions,
  className,
  icon: Icon = Inbox,
  message,
  title,
  ...props
}: EmptyStateProps) {
  const renderAction = action ? (
    <Button
      onClick={action.onClick}
      disabled={action.disabled}
      variant={action.variant ?? "primary"}
      size="compact"
      leadingVisual={action.icon ? <action.icon aria-hidden="true" size={13} strokeWidth={1.75} /> : undefined}
    >
      {action.label}
    </Button>
  ) : null;
  const showActionsBlock = Boolean(renderAction) || Boolean(actions);
  return (
    <div className={styles.host}>
      <div
        className={[styles.state, styles.empty, className].filter(Boolean).join(" ")}
        data-material="plate"
        role="status"
        {...props}
      >
        <Icon aria-hidden="true" className={styles.icon} strokeWidth={1.7} />
        <div className={styles.copy}>
          <strong className={styles.title}>{title}</strong>
          {message ? <span className={styles.message}>{message}</span> : null}
        </div>
        {showActionsBlock ? (
          <div className={styles.actions}>
            {renderAction}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface DegradedStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  actions?: ReactNode;
  icon?: LucideIcon;
  message: ReactNode;
  title: ReactNode;
}

export function DegradedState({
  actions,
  className,
  icon: Icon = AlertTriangle,
  message,
  title,
  ...props
}: DegradedStateProps) {
  return (
    <div className={styles.host}>
      <div
        className={[styles.state, styles.degraded, className].filter(Boolean).join(" ")}
        data-material="plate"
        role="alert"
        {...props}
      >
        <span className={styles.lampSlot}>
          <Lamp tone="attention" />
          <Icon aria-hidden="true" className={styles.icon} strokeWidth={1.7} />
        </span>
        <div className={styles.copy}>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.message}>{message}</span>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  /** What is loading, for assistive tech and the visible line
   *  (`Loading the console…`). */
  label: string;
  /** Skeleton rows drawn under the label, at the host's geometry. */
  rows?: number;
  /** Height of each row in px (default 40). */
  rowHeight?: number;
  /** Fill the host's height rather than the rows' sum. */
  fill?: boolean;
}

export function LoadingState({
  label,
  rows = 3,
  rowHeight = 40,
  fill = false,
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div
      className={[styles.loading, fill ? styles.fill : "", className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-loading=""
      {...props}
    >
      <span className={styles.loadingLabel}>{label}</span>
      <div className={styles.skeleton} aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <span key={index} className={styles.bone} style={{ "--row-height": `${rowHeight}px` } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
