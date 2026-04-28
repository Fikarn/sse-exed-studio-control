import type { ReactNode } from "react";

import { StatusDot } from "./StatusDot";
import type { StatusDotState } from "./StatusDot";
import styles from "./HealthBar.module.css";

export interface HealthBarItemData {
  label: string;
  value: ReactNode;
  dot?: StatusDotState;
  suffix?: string;
}

export interface HealthBarHint {
  kbd: string;
  label: string;
}

export interface HealthBarProps {
  items: readonly HealthBarItemData[];
  hint?: HealthBarHint;
  className?: string;
}

export const HealthBar = ({ items, hint, className }: HealthBarProps) => {
  const classes = [styles.bar, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status" aria-label="Workspace health">
      {items.map((item, idx) => (
        <HealthItem
          key={`${item.label}:${idx}`}
          label={item.label}
          value={item.value}
          dot={item.dot}
          suffix={item.suffix}
          last={idx === items.length - 1}
        />
      ))}
      {hint ? (
        <div className={styles.hint}>
          <kbd className={styles.kbd}>{hint.kbd}</kbd>
          <span>{hint.label}</span>
        </div>
      ) : null}
    </div>
  );
};

export interface HealthItemProps extends HealthBarItemData {
  last?: boolean;
  className?: string;
}

export const HealthItem = ({ label, value, dot, suffix, last, className }: HealthItemProps) => {
  const classes = [styles.item, last ? styles.lastItem : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>
        {dot ? <StatusDot state={dot} size="md" /> : null}
        <span className={styles.valueText}>{value}</span>
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </div>
  );
};
