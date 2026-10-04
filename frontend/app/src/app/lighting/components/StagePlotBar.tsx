import { useRef, useState } from "react";

import { Key, Menu, MenuButton, type MenuContent, type MenuEntry } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { lightingFixtureColorHex } from "../lightingHelpers";
import type { LightingMenu } from "../lightingMenus";
import type { ViewBookmarks, ViewBookmarkSlot } from "../useStagePlotViewport";
import styles from "./StagePlotBar.module.css";

// The visual overhaul's Lighting page (2026-10-04): one fixed bar under the
// plot, so the plot never changes height and the keys a take reaches for
// (Highlight, Solo, Find) have one home that never moves. Left to right: the
// selection (its chips, Add to selection, Clear), Highlight · Solo · Find, the
// zoom, the three saved views, and the plot's ⋯ (the same menu as a
// right-click on the plot's floor). A view's Save and Clear are in that menu.

const CHIPS_SHOWN = 5;

export interface StagePlotBarProps {
  selectedFixtures: readonly LightingFixtureSnapshot[];
  onRemoveFromSelection: (fixtureId: string) => void;
  onClearSelection: () => void;
  onChipHover?: (fixtureId: string | null) => void;
  addToSelection: boolean;
  onAddToSelectionChange: (next: boolean) => void;
  previewMode: boolean;
  highlightActive: boolean;
  soloActive: boolean;
  findRunning: boolean;
  onToggleHighlight: () => void;
  onToggleSolo: () => void;
  onIdentifyFind: () => void;
  onStopFind: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  viewBookmarks: ViewBookmarks;
  onRecallView: (slot: ViewBookmarkSlot) => void;
  plotMenu: LightingMenu;
  arm: MenuContent["arm"];
}

export function StagePlotBar({
  selectedFixtures,
  onRemoveFromSelection,
  onClearSelection,
  onChipHover,
  addToSelection,
  onAddToSelectionChange,
  previewMode,
  highlightActive,
  soloActive,
  findRunning,
  onToggleHighlight,
  onToggleSolo,
  onIdentifyFind,
  onStopFind,
  zoom,
  onZoomIn,
  onZoomOut,
  viewBookmarks,
  onRecallView,
  plotMenu,
  arm,
}: StagePlotBarProps) {
  const count = selectedFixtures.length;
  const hasSelection = count > 0;
  const shown = selectedFixtures.slice(0, CHIPS_SHOWN);
  const rest = selectedFixtures.slice(CHIPS_SHOWN);
  const moreRef = useRef<HTMLSpanElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems: MenuEntry[] = rest.map((fixture) => ({
    id: `take-out-${fixture.id}`,
    label: `Take ${fixture.name} out`,
    onSelect: () => onRemoveFromSelection(fixture.id),
  }));

  // A key the selection drives says why it is locked while nothing is
  // selected; lit, it always switches off (in Preview too).
  const selectionReason = previewMode
    ? "Leave preview to use the live rig."
    : hasSelection
      ? undefined
      : "Select fixtures on the plot first.";

  return (
    <div className={styles.bar} data-testid="lighting-plot-bar" data-toolbar-primary="bar">
      <div className={styles.selection} role="region" aria-label="Selected fixtures">
        <span className={styles.summary}>
          {hasSelection ? (
            <>
              <strong>{count}</strong> {count === 1 ? "fixture selected" : "fixtures selected"}
            </>
          ) : (
            "Nothing selected"
          )}
        </span>
        {hasSelection ? (
          <ul className={styles.chips} aria-label={`${count} selected fixture${count === 1 ? "" : "s"}`}>
            {shown.map((fixture) => (
              <li
                key={fixture.id}
                className={styles.chip}
                onPointerEnter={onChipHover ? () => onChipHover(fixture.id) : undefined}
                onPointerLeave={onChipHover ? () => onChipHover(null) : undefined}
              >
                <span
                  aria-hidden="true"
                  className={styles.chipLamp}
                  style={{ background: lightingFixtureColorHex(fixture.cct, fixture.on) }}
                />
                <span className={styles.chipName}>{fixture.name}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove ${fixture.name} from selection`}
                  onClick={() => onRemoveFromSelection(fixture.id)}
                >
                  ×
                </button>
              </li>
            ))}
            {rest.length > 0 ? (
              <li className={styles.more}>
                <span ref={moreRef} className={styles.moreAnchor}>
                  <Key
                    size="small"
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((open) => !open)}
                  >
                    +{rest.length}
                  </Key>
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <div className={styles.group}>
        <Key
          mode="toggle"
          engaged={addToSelection}
          aria-pressed={addToSelection}
          testId="lighting-add-to-selection"
          onClick={() => onAddToSelectionChange(!addToSelection)}
        >
          Add to selection
        </Key>
        <Key
          aria-label="Clear the selection"
          locked={!hasSelection}
          reason="Nothing is selected."
          onClick={onClearSelection}
        >
          Clear
        </Key>
      </div>

      <div className={styles.group} role="group" aria-label="The selection on the rig">
        <Key
          mode="toggle"
          size="large"
          engaged={highlightActive}
          aria-pressed={highlightActive}
          locked={!highlightActive && Boolean(selectionReason)}
          reason={selectionReason}
          take
          testId="lighting-highlight-toggle"
          onClick={onToggleHighlight}
        >
          Highlight
        </Key>
        <Key
          mode="toggle"
          size="large"
          engaged={soloActive}
          aria-pressed={soloActive}
          locked={!soloActive && Boolean(selectionReason)}
          reason={selectionReason}
          take
          testId="lighting-solo-toggle"
          onClick={onToggleSolo}
        >
          Solo
        </Key>
        <Key
          size="large"
          live={findRunning}
          locked={!findRunning && Boolean(selectionReason)}
          reason={selectionReason}
          take
          testId="lighting-identify-find"
          onClick={findRunning ? onStopFind : onIdentifyFind}
        >
          {findRunning ? "Stop" : "Find"}
        </Key>
      </div>

      <div className={styles.view} role="toolbar" aria-label="Stage plot view">
        <Key aria-label="Zoom out" onClick={onZoomOut}>
          −
        </Key>
        <span className={styles.zoom} aria-live="polite">
          {Math.round(zoom * 100)} %
        </span>
        <Key aria-label="Zoom in" onClick={onZoomIn}>
          +
        </Key>
        <span className={styles.views} role="group" aria-label="Saved views">
          {([0, 1, 2] as const).map((slot) => {
            const filled = Boolean(viewBookmarks[slot]);
            return (
              <Key
                key={slot}
                className={filled ? undefined : styles.emptyView}
                aria-label={filled ? `Recall view ${slot + 1}` : `View ${slot + 1} is empty`}
                aria-pressed={filled}
                title={filled ? undefined : "Save the view into it from the plot's menu"}
                testId={`lighting-view-${slot + 1}`}
                onClick={filled ? () => onRecallView(slot) : undefined}
              >
                {slot + 1}
              </Key>
            );
          })}
        </span>
        <MenuButton buttonLabel="Stage plot menu" buttonTestId="lighting-plot-menu" menu={{ ...plotMenu, arm }} />
      </div>

      <Menu
        open={moreOpen && rest.length > 0}
        anchor={moreRef.current}
        onClose={() => setMoreOpen(false)}
        head={{ title: "Selected fixtures", detail: `${rest.length} more` }}
        items={moreItems}
        ignoreOutside={[moreRef]}
      />
    </div>
  );
}
