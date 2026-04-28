import type { ReactNode } from "react";

import { Crest } from "./Crest";
import { NavItem } from "./NavItem";
import { StatusPill } from "./StatusPill";
import styles from "./AppShellFrame.module.css";

export interface RailItem {
  id: string;
  label: string;
  meta?: string;
  icon?: ReactNode;
}

export interface MonitorItem {
  label: string;
  status: "ok" | "attention" | "error" | "info";
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
  title: string;
  subtitle: string;
  eyebrow: string;
  productName?: string;
  clock?: ReactNode;
  monitorItems: readonly MonitorItem[];
  workspaces: readonly RailItem[];
  activeWorkspace: string;
  contextSections: readonly ContextItem[];
  children: ReactNode;
  hideMainHeader?: boolean;
  onWorkspaceChange?: (workspaceId: string) => void;
}

export function AppShellFrame({
  title,
  subtitle,
  eyebrow,
  productName = "Studio Control",
  clock,
  monitorItems,
  workspaces,
  activeWorkspace,
  contextSections,
  children,
  hideMainHeader = true,
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
          {monitorItems.map((item, index) => (
            <StatusPill key={`${item.status}:${item.label}:${index}`} label={item.label} status={item.status} />
          ))}
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
