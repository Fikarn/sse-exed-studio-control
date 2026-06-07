import type { ReactNode } from "react";

import { Crest } from "@sse/design-system";

import styles from "./PreReadyFrame.module.css";

/**
 * Slice 4 — the shared chrome frame for the pre-ready surfaces (startup,
 * recovery, setup/commissioning). Before this, those surfaces bypassed the shell
 * entirely and rendered as a centered `min(1400px)` gutter column with no crest
 * (CHROME-01 / GLO-01). PreReadyFrame gives them the product crest + a full-bleed
 * main area + the operator gradient, WITHOUT the workspace tabs / monitor bar
 * (there are no workspaces to navigate to pre-ready) and without a second header
 * (each surface keeps its own). It fills the viewport at fixed height so the main
 * area is the no-scroll region the surface lays out into.
 */
export function PreReadyFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.frame} data-pre-ready-frame="true">
      <header className={styles.header}>
        <div className={styles.brand}>
          <Crest size="md" />
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.productName}>Studio Control</span>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
