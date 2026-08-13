import type { CSSProperties, ReactNode } from "react";

import { Crest } from "./Crest";
import { NavItem } from "./NavItem";
import styles from "./AppShellFrame.module.css";

export interface RailItem {
  id: string;
  label: string;
  meta?: string;
  icon?: ReactNode;
}

export interface MonitorItem {
  id?: string;
  label: string;
  detail?: string;
  status: "ok" | "attention" | "error" | "info";
  /** Where clicking the chip takes the operator; defaults to Setup / Support.
   *  Latched-state chips (GLO-09) point at their owning workspace instead. */
  target?: string;
}

export interface ContextItem {
  items: ContextRailEntry[];
  title: string;
}

export interface ContextRailEntry {
  id: string;
  label: string;
}

export interface AppShellFrameProps {
  /** Main-header trio: only rendered when `hideMainHeader` is false. The live
   *  operator shell never renders the header (GLO-07); these stay for future
   *  header-bearing hosts. */
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  productName?: string;
  clock?: ReactNode;
  monitorItems: readonly MonitorItem[];
  workspaces: readonly RailItem[];
  activeWorkspace: string;
  contextSections?: readonly ContextItem[];
  children: ReactNode;
  hideMainHeader?: boolean;
  onMonitorItemClick?: (item: MonitorItem) => void;
  onWorkspaceChange?: (workspaceId: string) => void;
}

const toneByStatus = {
  ok: "var(--color-primary-500)",
  attention: "var(--color-warning-500)",
  error: "var(--color-danger-500)",
  info: "var(--color-info-500)",
} as const;

export function AppShellFrame({
  title,
  subtitle,
  eyebrow,
  productName = "Studio Control",
  clock,
  monitorItems,
  workspaces,
  activeWorkspace,
  contextSections = [],
  children,
  hideMainHeader = true,
  onMonitorItemClick,
  onWorkspaceChange,
}: AppShellFrameProps) {
  const showContextRail = contextSections.length > 0;
  return (
    <div className={styles.shell} data-context-visible={showContextRail}>
      <header className={styles.shellHeader}>
        <div className={styles.brand}>
          <Crest size="md" />
          <span className={styles.brandDivider} aria-hidden="true" />
          <span className={styles.productName}>{productName}</span>
          <nav className={styles.workspaceNav} aria-label="Workspace navigation">
            {workspaces.map((workspace) => (
              <NavItem
                key={workspace.id}
                id={workspace.id}
                label={workspace.label}
                icon={workspace.icon}
                active={workspace.id === activeWorkspace}
                onClick={() => onWorkspaceChange?.(workspace.id)}
              />
            ))}
          </nav>
        </div>
        <div className={styles.shellMeta}>
          {monitorItems.map((item, index) => {
            const key = item.id ?? `${item.status}:${item.label}:${index}`;
            const statusDetail = item.detail ?? item.status;
            const targetLabel = item.target ?? "Setup";
            const targetDescription = item.target ?? "Setup / Support";
            const monitorContent = (
              <>
                <span className={styles.monitorDot} aria-hidden="true" />
                <span className={styles.monitorText}>
                  <span className={styles.monitorLabel}>{item.label}</span>
                  <span className={styles.monitorDetail}>{statusDetail}</span>
                </span>
                {onMonitorItemClick ? <span className={styles.monitorTarget}>{targetLabel}</span> : null}
              </>
            );
            const monitorStyle = { "--monitor-tone": toneByStatus[item.status] } as CSSProperties;

            return onMonitorItemClick ? (
              <button
                key={key}
                type="button"
                className={styles.monitorAction}
                data-status={item.status}
                onClick={() => onMonitorItemClick(item)}
                style={monitorStyle}
                title={`Open ${targetDescription} for ${item.label}: ${statusDetail}`}
                aria-label={`Open ${targetDescription} for ${item.label}. Current status: ${statusDetail}.`}
              >
                {monitorContent}
              </button>
            ) : (
              <div
                key={key}
                className={styles.monitorAction}
                data-status={item.status}
                style={monitorStyle}
                title={`${item.label}: ${statusDetail}`}
              >
                {monitorContent}
              </div>
            );
          })}
          {clock ? <span className={styles.clock}>{clock}</span> : null}
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.mainSurface}>
          {!hideMainHeader ? (
            <div className={styles.mainHeader}>
              <div className={styles.titleBlock}>
                <div className={styles.eyebrow}>{eyebrow}</div>
                <h1 className={styles.title}>{title}</h1>
                <p className={styles.subtitle}>{subtitle}</p>
              </div>
            </div>
          ) : null}
          <div className={styles.mainBody}>{children}</div>
        </section>
      </main>

      {showContextRail ? (
        <aside className={styles.contextRail}>
          {contextSections.map((section) => (
            <section key={section.title} className={styles.contextSection}>
              <h2 className={styles.contextHeading}>{section.title}</h2>
              <ul className={styles.list}>
                {section.items.map((item) => (
                  <li key={item.id}>{item.label}</li>
                ))}
              </ul>
            </section>
          ))}
        </aside>
      ) : null}
    </div>
  );
}
