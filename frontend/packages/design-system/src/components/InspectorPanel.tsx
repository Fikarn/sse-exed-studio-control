import type { HTMLAttributes, ReactNode } from "react";

import styles from "./InspectorPanel.module.css";

export interface InspectorPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  status?: ReactNode;
  title: ReactNode;
}

export function InspectorPanel({
  actions,
  children,
  className,
  eyebrow,
  status,
  title,
  ...props
}: InspectorPanelProps) {
  return (
    <aside className={[styles.panel, className].filter(Boolean).join(" ")} {...props}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
          <h2 className={styles.title}>{title}</h2>
        </div>
        {status ? <div className={styles.status}>{status}</div> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}

export interface InspectorSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  children: ReactNode;
  title?: ReactNode;
}

export function InspectorSection({ children, className, title, ...props }: InspectorSectionProps) {
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} {...props}>
      {title ? <h3 className={styles.sectionTitle}>{title}</h3> : null}
      {children}
    </section>
  );
}
