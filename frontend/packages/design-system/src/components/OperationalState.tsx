import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox } from "lucide-react";

import styles from "./OperationalState.module.css";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  actions?: ReactNode;
  icon?: LucideIcon;
  message?: ReactNode;
  title: ReactNode;
}

export function EmptyState({ actions, className, icon: Icon = Inbox, message, title, ...props }: EmptyStateProps) {
  return (
    <div className={[styles.state, styles.empty, className].filter(Boolean).join(" ")} role="status" {...props}>
      <Icon aria-hidden="true" className={styles.icon} strokeWidth={1.7} />
      <div className={styles.copy}>
        <strong className={styles.title}>{title}</strong>
        {message ? <span className={styles.message}>{message}</span> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
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
