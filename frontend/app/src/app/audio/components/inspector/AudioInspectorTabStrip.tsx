/**
 * Tab strip rendered above the Inspector body. Two shapes:
 *   - When only a mix target is selected (`outputSelectionOnly`), the strip
 *     shows a single inert "Output" tab so the inspector reads as
 *     output-specific without surfacing disabled EQ/Dynamics/Sends tabs.
 *   - Otherwise, the four inspector tabs (Overview, EQ, Dynamics, Sends)
 *     render as a live tablist.
 *
 * Extracted from `AudioInspector.tsx` to keep the router thin (Slice 5B).
 */
import styles from "../AudioInspector.module.css";
import { INSPECTOR_TABS, type InspectorTab } from "./audioInspectorHelpers";

interface AudioInspectorTabStripProps {
  activeTab: InspectorTab;
  onActiveTabChange: (tab: InspectorTab) => void;
  outputSelectionOnly: boolean;
}

export function AudioInspectorTabStrip({
  activeTab,
  onActiveTabChange,
  outputSelectionOnly,
}: AudioInspectorTabStripProps) {
  if (outputSelectionOnly) {
    return (
      <div
        className={`${styles.inspectorTabs} ${styles.inspectorOutputTabs}`}
        aria-label="Audio output inspector"
        role="tablist"
      >
        <button
          aria-controls="audio-inspector-output-panel"
          aria-selected="true"
          data-active="true"
          id="audio-inspector-output-tab"
          role="tab"
          type="button"
        >
          Output
        </button>
      </div>
    );
  }

  return (
    <div className={styles.inspectorTabs} aria-label="Audio inspector tabs" role="tablist">
      {INSPECTOR_TABS.map((tab) => (
        <button
          aria-controls={`${tab.testId}-panel`}
          aria-selected={tab.id === activeTab}
          data-active={tab.id === activeTab}
          id={`${tab.testId}-tab`}
          key={tab.id}
          onClick={() => onActiveTabChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
