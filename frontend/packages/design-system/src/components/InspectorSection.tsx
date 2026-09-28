import type { HTMLAttributes, ReactNode } from "react";

import styles from "./InspectorSection.module.css";

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
