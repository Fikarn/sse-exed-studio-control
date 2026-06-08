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

export interface HealthBarHint {
  kbd: string;
  label: string;
  /** Render the `kbd` chip *after* the label instead of before (used by the
   *  caption variant for paired shortcuts like "Bank next ]"). */
  kbdAfter?: boolean;
}

export type HealthBarVariant = "full" | "caption";

export interface HealthBarProps {
  items: readonly HealthBarItemData[];
  /** One or more keyboard-shortcut discoverability hints rendered after the
   *  health items. Multiple hints separate with thin spacing. */
  hints?: readonly HealthBarHint[];
  /** Backward-compat single-hint alias; folded into `hints` if both are
   *  provided. Prefer `hints` for new call sites. */
  hint?: HealthBarHint;
  /** Optional trailing slot for clickable controls (e.g. visibility toggles).
   *  Hints are read-only by design; use `actions` when an interactive control
   *  belongs in the bar. Renders right of the hint group. */
  actions?: ReactNode;
  className?: string;
  /** `full` (default) — the 64px rich-item status bar (Lighting, Setup).
   *  `caption` — the thin telemetry+shortcut footer strip (Audio). The two
   *  share the `--hb-*` theming hooks; the caption variant renders a
   *  `<footer>` element. */
  variant?: HealthBarVariant;
  /** data-testid forwarded to the root element. */
  testId?: string;
  /** data-testid forwarded to the items/telemetry container. */
  itemsTestId?: string;
  /** data-testid forwarded to the hints/shortcuts container. */
  hintsTestId?: string;
}

export const HealthBar = ({
  items,
  hints,
  hint,
  actions,
  className,
  variant = "full",
  testId,
  itemsTestId,
  hintsTestId,
}: HealthBarProps) => {
  const allHints: readonly HealthBarHint[] = hints ?? (hint ? [hint] : []);

  if (variant === "caption") {
    const classes = [styles.caption, className].filter(Boolean).join(" ");
    return (
      <footer className={classes} data-testid={testId}>
        <div className={styles.captionTelemetry} data-testid={itemsTestId}>
          {items.map((item, idx) => (
            <div key={`${item.label}:${idx}`} className={styles.captionItem}>
              {item.icon}
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        {allHints.length > 0 ? (
          <div className={styles.captionShortcuts} data-testid={hintsTestId}>
            {allHints.map((entry, idx) => (
              <span key={`${entry.kbd}:${idx}`} className={styles.captionShortcut}>
                {entry.kbdAfter ? (
                  <>
                    {entry.label}
                    <kbd>{entry.kbd}</kbd>
                  </>
                ) : (
                  <>
                    <kbd>{entry.kbd}</kbd>
                    {entry.label}
                  </>
                )}
              </span>
            ))}
          </div>
        ) : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </footer>
    );
  }

  const classes = [styles.bar, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status" aria-label="Workspace health" data-testid={testId}>
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
      {allHints.length > 0 ? (
        <div className={styles.hintGroup} data-testid={hintsTestId}>
          {allHints.map((entry, idx) => (
            <div key={`${entry.kbd}:${idx}`} className={styles.hint}>
              <kbd className={styles.kbd}>{entry.kbd}</kbd>
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
      ) : null}
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
