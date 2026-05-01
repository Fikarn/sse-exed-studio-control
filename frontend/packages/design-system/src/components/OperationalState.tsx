import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox } from "lucide-react";

import { Button, type ButtonVariant } from "./Button";
import styles from "./OperationalState.module.css";

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
    <div className={[styles.state, styles.empty, className].filter(Boolean).join(" ")} role="status" {...props}>
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
    <div className={[styles.state, styles.degraded, className].filter(Boolean).join(" ")} role="alert" {...props}>
      <Icon aria-hidden="true" className={styles.icon} strokeWidth={1.7} />
      <div className={styles.copy}>
        <strong className={styles.title}>{title}</strong>
        <span className={styles.message}>{message}</span>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
