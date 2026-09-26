import type { ReactNode } from "react";

import { StatusDot } from "./StatusDot";
import type { StatusDotState } from "./StatusDot";
import styles from "./HealthBar.module.css";

export interface HealthBarItemData {
  label: string;
  value: ReactNode;
  dot?: StatusDotState;
  suffix?: string;
  /** Optional leading icon. Rendered before the dot/value in the `full`
   *  variant and before the label in the `caption` variant. Omit it and the
   *  item renders exactly as before (no node emitted). */
  icon?: ReactNode;
}

export type HealthBarVariant = "full" | "caption";

// New pages program, Slice 3 (D6): the retired bar keeps its items and its
// actions slot; the key hints it could print are gone with the keys.
export interface HealthBarProps {
  items: readonly HealthBarItemData[];
  /** Optional trailing slot for clickable controls (e.g. visibility toggles),
   *  at the bar's right edge. */
  actions?: ReactNode;
  className?: string;
  /** `full` (default) — the 64px rich-item status bar (Lighting, Setup).
   *  `caption` — the thin telemetry footer strip (Audio). The two share the
   *  `--hb-*` theming hooks; the caption variant renders a `<footer>`
   *  element. */
  variant?: HealthBarVariant;
  /** data-testid forwarded to the root element. */
  testId?: string;
  /** data-testid forwarded to the items/telemetry container. */
  itemsTestId?: string;
}

export const HealthBar = ({ items, actions, className, variant = "full", testId, itemsTestId }: HealthBarProps) => {
  if (variant === "caption") {
    const classes = [styles.caption, className].filter(Boolean).join(" ");
    return (
      // data-health-bar: inert presence marker — the app's toast stack keys
      // its bottom offset on whether ANY health bar is mounted (GLO-11).
      <footer className={classes} data-health-bar="" data-testid={testId}>
        <div className={styles.captionTelemetry} data-testid={itemsTestId}>
          {items.map((item, idx) => (
            <div key={`${item.label}:${idx}`} className={styles.captionItem}>
              {item.icon}
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </footer>
    );
  }

  const classes = [styles.bar, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status" aria-label="Workspace health" data-health-bar="" data-testid={testId}>
      {items.map((item, idx) => (
        <HealthItem
          key={`${item.label}:${idx}`}
          label={item.label}
          value={item.value}
          dot={item.dot}
          suffix={item.suffix}
          icon={item.icon}
          last={idx === items.length - 1}
        />
      ))}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
};

export interface HealthItemProps extends HealthBarItemData {
  last?: boolean;
  className?: string;
}

export const HealthItem = ({ label, value, dot, suffix, icon, last, className }: HealthItemProps) => {
  const classes = [styles.item, last ? styles.lastItem : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>
        {icon}
        {dot ? <StatusDot tone={dot} size="md" /> : null}
        <span className={styles.valueText}>{value}</span>
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </div>
  );
};
