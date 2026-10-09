import { useMemo, useState, type ReactNode } from "react";

import { Crest } from "./Crest";
import { ShellColophonContext, ShellRegionsContext, type ShellRegionElements } from "./shellRegions";
import { Footer, type FooterProps } from "./Footer";
import { LampChip } from "./LampChip";
import { Tab } from "./Tab";
import { Tally } from "./Tally";
import type { SharedStatusTone } from "./statusTone";
import styles from "./AppShellFrame.module.css";

// Visual overhaul A, Slice 2 (plan D1, D4; system §2): the shell is one grid
// on every surface — header · cluster | bay | plate · footer. The cluster and
// the plate are slots a page fills, the bay holds its picture. Every region
// declares `data-region` so the UI contract can measure the chrome against
// section 2. Setup / Support and the screens before ready render inside the
// same frame with the tabs locked. Visual overhaul 2026-10 (Atrium): every
// region is the one flat base, parted by hairlines. The shell (overhaul 3):
// each tab carries its page's lamp and state word (the active one none: its
// page says it). The skylight (D48, 2026-10-09): the header and the footer are
// one raised layer, a step lighter than the page, each closed by a line. The
// SSE logotype stands alone at the top left, 40 px high with half its height
// clear on every side, then a rule; the pages on one platter; the system's own
// things (the lamps that have no page, the latches, then Setup / Support) on a
// second platter at the right; the REC tally on a platter of its own; the
// clock on the bar. The open page is the one Dark Green segment. The product's
// name left the header (beside the logotype it would read as a lockup) and
// ends every footer as its colophon.

export interface RailItem {
  id: string;
  label: string;
  /** The system's own page (Setup / Support): its tab stands on the system's
   *  platter at the right, not among the pages. */
  system?: boolean;
}

export interface MonitorItem {
  id?: string;
  label: string;
  detail?: string;
  /** A value after the word that changes, in PT Sans (`2:31 left`). */
  value?: string;
  /** `neutral` only before ready: a check never read (a hollow lamp). */
  status: SharedStatusTone;
  /** Where clicking the chip takes the operator; defaults to Setup / Support.
   *  Latched-state chips (GLO-09) point at their owning workspace instead. */
  target?: string;
  /** A latched state (Solo, Scene drift) rather than a subsystem lamp. */
  latch?: boolean;
  /** The workspace whose tab carries this lamp (`lighting`): the lamp is
   *  drawn in its tab, and not at all while that tab is the active one. */
  tab?: string;
  /** A state that is no longer read (the tally's `last known`). */
  doubt?: boolean;
}

export interface AppShellFrameProps {
  /** The product's name: every footer's colophon (D48). */
  productName?: string;
  clock?: ReactNode;
  monitorItems: readonly MonitorItem[];
  /** The REC tally: `null` at rest, an item while lit. Left out, there is no
   *  slot (a story of the frame alone). */
  recTally?: MonitorItem | null;
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
  /** The bay. The shell draws no margin in it: the page's picture decides
   *  its own. */
  children: ReactNode;
  /** `quiet`: no hairlines between the columns, for a page whose own rooms
   *  part them (the Overview, D47). The columns keep their widths. */
  columns?: "quiet";
  onMonitorItemClick?: (item: MonitorItem) => void;
  onWorkspaceChange?: (workspaceId: string) => void;
}

function testIdFor(item: MonitorItem): string | undefined {
  return item.id ? `shell-lamp-${item.id.replace(/[^a-z0-9]+/gi, "-")}` : undefined;
}

export function AppShellFrame({
  productName = "Studio Control",
  clock,
  monitorItems,
  recTally,
  workspaces,
  activeWorkspace,
  tabsDisabled = false,
  disabledWorkspaces = [],
  cluster,
  plate,
  footer,
  children,
  columns,
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
  const renderTab = (workspace: RailItem) => {
    const active = workspace.id === activeWorkspace;
    // The open tab shows no word (its page's state display says it) but keeps
    // the word's room, so no tab moves with the page.
    const pageLamp = monitorItems.find((item) => item.tab === workspace.id);
    const lamp = active ? undefined : pageLamp;
    return (
      <Tab
        key={workspace.id}
        id={workspace.id}
        label={workspace.label}
        active={active}
        disabled={tabsDisabled || disabledWorkspaces.includes(workspace.id)}
        word={lamp ? (lamp.detail ?? lamp.status) : undefined}
        value={lamp?.value}
        tone={lamp?.status}
        wordTestId={lamp ? testIdFor(lamp) : undefined}
        reserve={active && pageLamp ? { word: pageLamp.detail ?? pageLamp.status, value: pageLamp.value } : undefined}
        onClick={() => onWorkspaceChange?.(workspace.id)}
      />
    );
  };
  const systemTabs = workspaces.filter((workspace) => workspace.system);
  const chips = monitorItems
    .filter((item) => !item.tab)
    .map((item, index) => {
      const key = item.id ?? `${item.status}:${item.label}:${index}`;
      const statusDetail = item.detail ?? item.status;
      const spoken = item.value ? `${statusDetail}, ${item.value}` : statusDetail;
      const targetDescription = item.target ?? "Setup / Support";
      const latch = item.latch ?? item.id?.startsWith("latched:") ?? false;
      return (
        <LampChip
          key={key}
          label={latch ? "" : item.label}
          word={latch ? item.label : statusDetail}
          value={item.value}
          tone={item.status}
          latch={latch}
          testId={testIdFor(item)}
          title={
            onMonitorItemClick ? `Open ${targetDescription} for ${item.label}: ${spoken}` : `${item.label}: ${spoken}`
          }
          ariaLabel={
            onMonitorItemClick ? `Open ${targetDescription} for ${item.label}. Current status: ${spoken}.` : undefined
          }
          onClick={onMonitorItemClick ? () => onMonitorItemClick(item) : undefined}
        />
      );
    });
  return (
    <ShellRegionsContext.Provider value={regions}>
      <ShellColophonContext.Provider value={productName}>
        <div
          className={styles.shell}
          data-shell-frame=""
          data-cluster={cluster ? "" : undefined}
          data-plate={plate ? "" : undefined}
          data-columns={columns}
        >
          <header className={styles.header} data-region="header" data-material="bar">
            <Crest size="header" className={styles.logo} />
            <span className={styles.rule} aria-hidden="true" />
            <nav className={styles.platter} data-platter="pages" aria-label="Workspace navigation">
              {workspaces.filter((workspace) => !workspace.system).map(renderTab)}
            </nav>
            <span className={styles.spacer} aria-hidden="true" />
            {systemTabs.length > 0 || chips.length > 0 ? (
              <div className={styles.platter} data-platter="system">
                {chips}
                {systemTabs.map(renderTab)}
              </div>
            ) : null}
            {recTally !== undefined ? (
              <Tally
                name="REC"
                testId="shell-rec-slot"
                litTestId={recTally ? testIdFor(recTally) : undefined}
                state={
                  recTally && (recTally.status === "error" || recTally.status === "attention")
                    ? { detail: recTally.detail ?? "", tone: recTally.status, doubt: recTally.doubt }
                    : null
                }
                title={recTally ? `Open ${recTally.target ?? "Cameras"} for REC: ${recTally.detail ?? ""}` : undefined}
                ariaLabel={
                  recTally
                    ? `Open ${recTally.target ?? "Cameras"} for REC. Current status: ${recTally.detail ?? ""}.`
                    : undefined
                }
                onClick={recTally && onMonitorItemClick ? () => onMonitorItemClick(recTally) : undefined}
              />
            ) : null}
            {clock ? (
              <span className={styles.clock} data-testid="shell-clock">
                {clock}
              </span>
            ) : null}
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
      </ShellColophonContext.Provider>
    </ShellRegionsContext.Provider>
  );
}
