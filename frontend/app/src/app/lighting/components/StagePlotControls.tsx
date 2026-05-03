import { useState, type MouseEvent } from "react";
import { Bookmark, Minus, Plus, RotateCcw } from "lucide-react";

import { ContextMenu, Tooltip, type ContextMenuItem } from "@sse/design-system";

import type { StagePlotZoomMode, ViewBookmarks, ViewBookmarkSlot } from "../useStagePlotViewport";

import styles from "./StagePlotControls.module.css";

export interface StagePlotControlsProps {
  zoom: number;
  zoomMode: StagePlotZoomMode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFitRoom: () => void;
  onFillDesk: () => void;
  onActualSize: () => void;
  /** Wave 31 — view bookmarks (I7). When omitted, the View slot row is not
   *  rendered. */
  viewBookmarks?: ViewBookmarks;
  onSaveViewBookmark?: (slot: ViewBookmarkSlot) => void;
  onRecallViewBookmark?: (slot: ViewBookmarkSlot) => void;
  onClearViewBookmark?: (slot: ViewBookmarkSlot) => void;
}

const SLOTS: readonly ViewBookmarkSlot[] = [0, 1, 2];

export function StagePlotControls({
  zoom,
  zoomMode,
  onZoomIn,
  onZoomOut,
  onReset,
  onFitRoom,
  onFillDesk,
  onActualSize,
  viewBookmarks,
  onSaveViewBookmark,
  onRecallViewBookmark,
  onClearViewBookmark,
}: StagePlotControlsProps) {
  const [menu, setMenu] = useState<{ slot: ViewBookmarkSlot; x: number; y: number } | null>(null);
  const bookmarksEnabled = Boolean(viewBookmarks && onSaveViewBookmark && onRecallViewBookmark);

  const openContextMenu = (slot: ViewBookmarkSlot, event: MouseEvent<HTMLButtonElement>) => {
    if (!bookmarksEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ slot, x: event.clientX, y: event.clientY });
  };

  const menuItems: ContextMenuItem[] = menu
    ? (() => {
        const items: ContextMenuItem[] = [
          {
            id: "save",
            label: `Save current view to ${menu.slot + 1}`,
            icon: Bookmark,
            onSelect: () => onSaveViewBookmark?.(menu.slot),
          },
        ];
        if (viewBookmarks?.[menu.slot]) {
          items.push({
            id: "clear",
            label: `Clear view ${menu.slot + 1}`,
            tone: "danger",
            onSelect: () => onClearViewBookmark?.(menu.slot),
          });
        }
        return items;
      })()
    : [];

  return (
    <div className={styles.controls} role="toolbar" aria-label="Stage plot view">
      <span className={styles.modeGroup} aria-label="Stage plot zoom mode">
        <Tooltip content="Fit the full room without stretching spatial proportions" placement="top">
          <button
            type="button"
            className={`${styles.modeButton} ${zoomMode === "fitRoom" ? styles.modeButtonActive : ""}`}
            onClick={onFitRoom}
            aria-pressed={zoomMode === "fitRoom"}
          >
            Fit Room
          </button>
        </Tooltip>
        <Tooltip content="Fill the desk surface using the current operator-familiar plot stretch" placement="top">
          <button
            type="button"
            className={`${styles.modeButton} ${zoomMode === "fillDesk" ? styles.modeButtonActive : ""}`}
            onClick={onFillDesk}
            aria-pressed={zoomMode === "fillDesk"}
          >
            Fill Desk
          </button>
        </Tooltip>
        <Tooltip content="Reset pan and content zoom to 100%" placement="top">
          <button
            type="button"
            className={`${styles.modeButton} ${zoomMode === "actual" ? styles.modeButtonActive : ""}`}
            onClick={onActualSize}
            aria-pressed={zoomMode === "actual"}
          >
            100%
          </button>
        </Tooltip>
      </span>
      <Tooltip content="Zoom out · scroll wheel works too" placement="top">
        <button type="button" className={styles.button} onClick={onZoomOut} aria-label="Zoom out">
          <Minus aria-hidden="true" size={14} strokeWidth={2} />
        </button>
      </Tooltip>
      <span className={styles.zoomLabel} aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <Tooltip content="Zoom in · scroll wheel works too" placement="top">
        <button type="button" className={styles.button} onClick={onZoomIn} aria-label="Zoom in">
          <Plus aria-hidden="true" size={14} strokeWidth={2} />
        </button>
      </Tooltip>
      <Tooltip content="Reset view · double-click the plot" placement="top">
        <button type="button" className={styles.button} onClick={onReset} aria-label="Reset view">
          <RotateCcw aria-hidden="true" size={14} strokeWidth={2} />
        </button>
      </Tooltip>
      {bookmarksEnabled ? (
        <span className={styles.bookmarkGroup} aria-label="View bookmarks">
          {SLOTS.map((slot) => {
            const filled = Boolean(viewBookmarks?.[slot]);
            const tooltip = filled
              ? `Recall view ${slot + 1} · Shift+${slot + 1}. Right-click for options.`
              : `Empty slot ${slot + 1}. Right-click to save current view · ⌘⇧${slot + 1}.`;
            return (
              <Tooltip key={slot} content={tooltip} placement="top">
                <button
                  type="button"
                  className={`${styles.bookmarkButton} ${filled ? styles.bookmarkButtonFilled : ""}`}
                  onClick={() => filled && onRecallViewBookmark?.(slot)}
                  onContextMenu={(event) => openContextMenu(slot, event)}
                  aria-label={tooltip}
                  aria-pressed={filled}
                >
                  {slot + 1}
                </button>
              </Tooltip>
            );
          })}
        </span>
      ) : null}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
          ariaLabel={`View slot ${menu.slot + 1} actions`}
        />
      ) : null}
    </div>
  );
}
