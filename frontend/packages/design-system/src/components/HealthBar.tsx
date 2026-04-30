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
  /** One or more keyboard-shortcut discoverability hints rendered after the
   *  health items. Multiple hints separate with thin spacing. */
  hints?: readonly HealthBarHint[];
  /** Backward-compat single-hint alias; folded into `hints` if both are
   *  provided. Prefer `hints` for new call sites. */
  hint?: HealthBarHint;
  className?: string;
}

export const HealthBar = ({ items, hints, hint, className }: HealthBarProps) => {
  const classes = [styles.bar, className].filter(Boolean).join(" ");
  const allHints: readonly HealthBarHint[] = hints ?? (hint ? [hint] : []);
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
      {allHints.length > 0 ? (
        <div className={styles.hintGroup}>
          {allHints.map((entry, idx) => (
            <div key={`${entry.kbd}:${idx}`} className={styles.hint}>
              <kbd className={styles.kbd}>{entry.kbd}</kbd>
              <span>{entry.label}</span>
            </div>
          ))}
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
