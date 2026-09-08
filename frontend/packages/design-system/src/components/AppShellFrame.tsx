import { useMemo, useState, type ReactNode } from "react";

import { Crest } from "./Crest";
import { ShellRegionsContext, type ShellRegionElements } from "./shellRegions";
import { Footer, type FooterProps } from "./Footer";
import { LampChip } from "./LampChip";
import { Tab } from "./Tab";
import type { SharedStatusTone } from "./statusTone";
import styles from "./AppShellFrame.module.css";

// Visual overhaul A, Slice 2 (plan D1, D4; system §2): the shell is one grid
// on every surface — header · cluster | bay | plate · footer. The header
// carries the crest, the product with its owner's eyebrow, the four tabs,
// the subsystem lamps, the latches and the clock; the cluster and the plate
// are slots a workspace fills (Slices 4–7), the bay is the recessed floor its
// picture sits on. Every region declares `data-region` so the UI contract
// can measure the chrome against D4. Setup / Support and the pre-ready
// surfaces render inside the same frame with the tabs locked.

export interface RailItem {
  id: string;
  label: string;
  meta?: string;
  icon?: ReactNode;
  /** Keyboard hint printed on the tab (aria-hidden), e.g. "Ctrl+2". */
  hint?: string;
}

export interface MonitorItem {
  id?: string;
  label: string;
  detail?: string;
  status: Exclude<SharedStatusTone, "neutral">;
  /** Where clicking the chip takes the operator; defaults to Setup / Support.
   *  Latched-state chips (GLO-09) point at their owning workspace instead. */
  target?: string;
  /** A latched state (Solo, Scene drift) rather than a subsystem lamp. */
  latch?: boolean;
}

export interface AppShellFrameProps {
  productName?: string;
  /** The owner's name under the product, 12 px: "SSE Executive Education". */
  eyebrow?: string;
  clock?: ReactNode;
  monitorItems: readonly MonitorItem[];
  workspaces: readonly RailItem[];
  activeWorkspace: string;
  /** Every tab locked: startup and recovery, where there is nowhere to go. */
  tabsDisabled?: boolean;
  /** Specific tabs locked, e.g. the operator workspaces before commissioning
   *  is published. */
  disabledWorkspaces?: readonly string[];
  /** The left plate: the workspace's state display, take-time keys, lists.
   *  `"slot"` renders the region empty and lets the workspace fill it with
   *  `<ShellRegion region="cluster">`. */
  cluster?: ReactNode | "slot";
  /** The right plate: the selection, or Support. `"slot"` as above. */
  plate?: ReactNode | "slot";
  /** The footer: `FooterProps` for the shell's own, `"slot"` for the
   *  workspace's own `<Footer>` through `<ShellRegion region="footer">`. */
  footer?: FooterProps | "slot";
  /** The bay. */
  children: ReactNode;
  onMonitorItemClick?: (item: MonitorItem) => void;
  onWorkspaceChange?: (workspaceId: string) => void;
}

export function AppShellFrame({
  productName = "Studio Control",
  eyebrow = "SSE Executive Education",
  clock,
  monitorItems,
  workspaces,
  activeWorkspace,
  tabsDisabled = false,
  disabledWorkspaces = [],
  cluster,
  plate,
  footer,
  children,
  onMonitorItemClick,
  onWorkspaceChange,
}: AppShellFrameProps) {
  const [clusterElement, setClusterElement] = useState<HTMLElement | null>(null);
  const [plateElement, setPlateElement] = useState<HTMLElement | null>(null);
  const [footerElement, setFooterElement] = useState<HTMLElement | null>(null);
  const regions = useMemo<ShellRegionElements>(
    () => ({ cluster: clusterElement, plate: plateElement, footer: footerElement }),
    [clusterElement, plateElement, footerElement]
  );
  return (
    <ShellRegionsContext.Provider value={regions}>
      <div
        className={styles.shell}
        data-shell-frame=""
        data-cluster={cluster ? "" : undefined}
        data-plate={plate ? "" : undefined}
      >
        <header className={styles.header} data-region="header" data-material="plate">
          <Crest variant="mark" />
          <div className={styles.wordmark}>
            <span className={styles.product}>{productName}</span>
            {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
          </div>
          <nav className={styles.tabs} aria-label="Workspace navigation">
            {workspaces.map((workspace) => (
              <Tab
                key={workspace.id}
                id={workspace.id}
                label={workspace.label}
                hint={workspace.hint}
                active={workspace.id === activeWorkspace}
                disabled={tabsDisabled || disabledWorkspaces.includes(workspace.id)}
                onClick={() => onWorkspaceChange?.(workspace.id)}
              />
            ))}
          </nav>
          <div className={styles.health}>
            {monitorItems.map((item, index) => {
              const key = item.id ?? `${item.status}:${item.label}:${index}`;
              const statusDetail = item.detail ?? item.status;
              const targetDescription = item.target ?? "Setup / Support";
              const latch = item.latch ?? item.id?.startsWith("latched:") ?? false;
              const testId = item.id ? `shell-lamp-${item.id.replace(/[^a-z0-9]+/gi, "-")}` : undefined;
              return (
                <LampChip
                  key={key}
                  label={item.label}
                  word={statusDetail}
                  tone={item.status}
                  latch={latch}
                  testId={testId}
                  title={
                    onMonitorItemClick
                      ? `Open ${targetDescription} for ${item.label}: ${statusDetail}`
                      : `${item.label}: ${statusDetail}`
                  }
                  ariaLabel={
                    onMonitorItemClick
                      ? `Open ${targetDescription} for ${item.label}. Current status: ${statusDetail}.`
                      : undefined
                  }
                  onClick={onMonitorItemClick ? () => onMonitorItemClick(item) : undefined}
                />
              );
            })}
            {clock ? (
              <span className={styles.clock} data-testid="shell-clock">
                {clock}
              </span>
            ) : null}
          </div>
        </header>

        <div className={styles.body}>
          {cluster ? (
            <aside
              className={styles.cluster}
              data-region="cluster"
              data-material="plate"
              ref={cluster === "slot" ? setClusterElement : undefined}
            >
              {cluster === "slot" ? null : cluster}
            </aside>
          ) : null}
          <main className={styles.bay} data-region="bay">
            {children}
          </main>
          {plate ? (
            <aside
              className={styles.plate}
              data-region="plate"
              data-material="plate"
              ref={plate === "slot" ? setPlateElement : undefined}
            >
              {plate === "slot" ? null : plate}
            </aside>
          ) : null}
        </div>

        {footer === "slot" ? (
          <div className={styles.footerSlot} ref={setFooterElement} />
        ) : footer ? (
          <Footer {...footer} />
        ) : null}
      </div>
    </ShellRegionsContext.Provider>
  );
}
