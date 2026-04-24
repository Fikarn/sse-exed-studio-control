import type { ReactNode } from "react";

import { StatusPill } from "./StatusPill";
import styles from "./AppShellFrame.module.css";

export interface RailItem {
  id: string;
  label: string;
  meta?: string;
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
  monitorItems,
  workspaces,
  activeWorkspace,
  contextSections,
  children,
  hideMainHeader = false,
  onWorkspaceChange,
}: AppShellFrameProps) {
  const showContextRail = contextSections.length > 0;
  return (
    <div className={styles.shell} data-context-visible={showContextRail}>
      <header className={styles.monitorRail}>
        <div className={styles.monitorGroup}>
          <div className={styles.brand}>SSE ExEd Studio Control</div>
          {monitorItems.map((item, index) => (
            <StatusPill key={`${item.status}:${item.label}:${index}`} label={item.label} status={item.status} />
          ))}
        </div>
        <div className={styles.heroMetric}>Mission-critical operator shell</div>
      </header>

      <aside className={styles.workspaceRail}>
        <div className={styles.workspaceNav} aria-label="Workspace command rail">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              className={styles.workspaceButton}
              data-active={workspace.id === activeWorkspace}
              onClick={() => onWorkspaceChange?.(workspace.id)}
              type="button"
            >
              <span>{workspace.label}</span>
              {workspace.meta ? <span className={styles.workspaceMeta}>{workspace.meta}</span> : null}
            </button>
          ))}
        </div>
      </aside>

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
