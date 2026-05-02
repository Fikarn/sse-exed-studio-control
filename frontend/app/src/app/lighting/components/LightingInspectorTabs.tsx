import { type KeyboardEvent, type ReactNode } from "react";

import styles from "./LightingInspector.module.css";

export type InspectorTab = "scene" | "fixture" | "group" | "palettes" | "patch";

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
  palettes: "Palettes",
  patch: "Patch",
};

export const LIGHTING_TAB_PANEL_ID: Record<InspectorTab, string> = {
  scene: "lighting-tabpanel-scene",
  fixture: "lighting-tabpanel-fixture",
  group: "lighting-tabpanel-group",
  palettes: "lighting-tabpanel-palettes",
  patch: "lighting-tabpanel-patch",
};

export const LIGHTING_TAB_BUTTON_ID: Record<InspectorTab, string> = {
  scene: "lighting-tab-scene",
  fixture: "lighting-tab-fixture",
  group: "lighting-tab-group",
  palettes: "lighting-tab-palettes",
  patch: "lighting-tab-patch",
};

export function LightingInspectorTabs({ active, onChange, visibleTabs, hint }: LightingInspectorTabsProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const idx = visibleTabs.indexOf(active);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextIdx = (idx - 1 + visibleTabs.length) % visibleTabs.length;
        break;
      case "ArrowRight":
        nextIdx = (idx + 1) % visibleTabs.length;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = visibleTabs.length - 1;
        break;
    }
    if (nextIdx === null) return;
    event.preventDefault();
    const nextTab = visibleTabs[nextIdx]!;
    onChange(nextTab);
    const nextEl = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
      `#${LIGHTING_TAB_BUTTON_ID[nextTab]}`
    );
    nextEl?.focus();
  };

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
          onKeyDown={handleKeyDown}
        >
          {TAB_LABEL[tab]}
        </button>
      ))}
      {hint ? <span className={styles.tabHint}>{hint}</span> : null}
    </div>
  );
}
