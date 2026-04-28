import type { ReactNode } from "react";

import styles from "./LightingInspector.module.css";

export type InspectorTab = "scene" | "fixture" | "group" | "patch";

export interface LightingInspectorTabsProps {
  active: InspectorTab;
  onChange: (tab: InspectorTab) => void;
  visibleTabs: readonly InspectorTab[];
  hint?: ReactNode;
}

const TAB_LABEL: Record<InspectorTab, string> = {
  scene: "Scene",
  fixture: "Fixture",
  group: "Group",
  patch: "Patch",
};

export function LightingInspectorTabs({ active, onChange, visibleTabs, hint }: LightingInspectorTabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Inspector tabs">
      {visibleTabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === active}
          className={styles.tab}
          data-active={tab === active}
          onClick={() => onChange(tab)}
        >
          {TAB_LABEL[tab]}
        </button>
      ))}
      {hint ? <span className={styles.tabHint}>{hint}</span> : null}
    </div>
  );
}
