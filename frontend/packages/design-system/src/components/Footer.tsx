import type { ReactNode } from "react";

import styles from "./Footer.module.css";

// Visual overhaul A, Slice 2 (system §2, §7): the 40 px footer — telemetry as
// `Label value` items and one action slot at the right edge. The workspaces
// move their footers onto it in Slices 4–7. New pages program, Slice 3 (D6):
// the footer prints no key hints; the slot that held them is gone.
export interface FooterItem {
  id?: string;
  label: string;
  value: ReactNode;
}

export interface FooterProps {
  items: readonly FooterItem[];
  action?: ReactNode;
  testId?: string;
  itemsTestId?: string;
}

export const Footer = ({ items, action, testId, itemsTestId }: FooterProps) => (
  // data-health-bar: the same inert presence marker the retired HealthBar
  // carried. The app's toast stack keys its bottom offset on
  // `html:not(:has([data-health-bar]))`, so a workspace that swaps its health
  // bar for this footer keeps its toasts clear of the footer.
  <footer className={styles.footer} data-health-bar="" data-region="footer" data-material="plate" data-testid={testId}>
    <div className={styles.items} data-testid={itemsTestId}>
      {items.map((item, index) => (
        <span key={item.id ?? `${item.label}:${index}`} className={styles.item}>
          <span className={styles.label}>{item.label}</span> <b className={styles.value}>{item.value}</b>
        </span>
      ))}
    </div>
    {action ? <div className={styles.action}>{action}</div> : null}
  </footer>
);
