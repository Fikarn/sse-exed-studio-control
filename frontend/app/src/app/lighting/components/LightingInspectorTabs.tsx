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

export const LIGHTING_TAB_PANEL_ID: Record<InspectorTab, string> = {
  scene: "lighting-tabpanel-scene",
  fixture: "lighting-tabpanel-fixture",
  group: "lighting-tabpanel-group",
  patch: "lighting-tabpanel-patch",
};

export const LIGHTING_TAB_BUTTON_ID: Record<InspectorTab, string> = {
  scene: "lighting-tab-scene",
  fixture: "lighting-tab-fixture",
  group: "lighting-tab-group",
  patch: "lighting-tab-patch",
};

export function LightingInspectorTabs({ active, onChange, visibleTabs, hint }: LightingInspectorTabsProps) {
  return (
    <div className={styles.tabs} role="tablist" aria-label="Inspector tabs">
      {visibleTabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={LIGHTING_TAB_BUTTON_ID[tab]}
          aria-selected={tab === active}
          aria-controls={LIGHTING_TAB_PANEL_ID[tab]}
          tabIndex={tab === active ? 0 : -1}
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
