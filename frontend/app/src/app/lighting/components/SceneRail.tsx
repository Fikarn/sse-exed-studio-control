import { Plus } from "lucide-react";
import { type CSSProperties } from "react";
import { AutoSizer, type Size } from "react-virtualized-auto-sizer";
import { Grid } from "react-window";

import type { LightingSceneSnapshot } from "@sse/engine-client";

import { formatLightingRelativeTime } from "../lightingHelpers";
import { SceneTile } from "./SceneTile";
import styles from "./LightingRail.module.css";

// Above this many *visible* scenes (after search filter), the rail switches
// to react-window virtualization. Below it, the natural-flow layout wins
// because it composes with the rail's outer scroll and avoids nested
// scrolling. Threshold per Waves 19-22 plan §23.A.
const VIRTUALIZE_THRESHOLD = 30;
const ROW_HEIGHT = 168;

export interface SceneRailProps {
  scenes: readonly LightingSceneSnapshot[];
  activeSceneId: string | null;
  modifiedSceneId: string | null;
  sceneThumbs: Record<string, string>;
  searchQuery?: string;
  bridgeReachable?: boolean;
  onRecall: (sceneId: string) => void;
  onAddScene?: () => void;
  onClearSearch?: () => void;
  /** Drag-to-reorder handler. When omitted, tiles aren't draggable. */
  onReorderScene?: (sceneId: string, beforeSceneId: string | null) => void;
  /** Pin / unpin handler. When omitted, the inline pin chip isn't rendered. */
  onPinScene?: (sceneId: string, pinned: boolean) => void;
}

interface SceneStats {
  onCount: number;
  avgCct: number;
}

function statsForScene(scene: LightingSceneSnapshot): SceneStats {
  const onStates = scene.fixtureStates.filter((state) => state.on);
  if (onStates.length === 0) {
    return { onCount: 0, avgCct: 0 };
  }
  const cctSum = onStates.reduce((sum, state) => sum + state.cct, 0);
  return {
    onCount: onStates.length,
    avgCct: cctSum / onStates.length,
  };
}

interface CellPayload {
  filteredScenes: readonly LightingSceneSnapshot[];
  activeSceneId: string | null;
  modifiedSceneId: string | null;
  sceneThumbs: Record<string, string>;
  bridgeReachable: boolean;
  onRecall: (sceneId: string) => void;
  onReorder?: (draggedSceneId: string, beforeSceneId: string) => void;
  onPin?: (sceneId: string, pinned: boolean) => void;
  onAddScene?: () => void;
  showAddTile: boolean;
  totalCellCount: number;
}

function VirtualizedCell({
  columnIndex,
  rowIndex,
  style,
  filteredScenes,
  activeSceneId,
  modifiedSceneId,
  sceneThumbs,
  bridgeReachable,
  onRecall,
  onReorder,
  onPin,
  onAddScene,
  showAddTile,
  totalCellCount,
}: { columnIndex: number; rowIndex: number; style: CSSProperties } & CellPayload) {
  const cellIndex = rowIndex * 2 + columnIndex;
  if (cellIndex >= totalCellCount) return null;

  // Inset the cell content by the same 4px so the visible gap between
  // cells totals 8px (matches .sceneGrid's gap).
  const innerStyle: CSSProperties = {
    ...style,
    boxSizing: "border-box",
    padding: 4,
  };

  if (cellIndex < filteredScenes.length) {
    const scene = filteredScenes[cellIndex]!;
    const stats = statsForScene(scene);
    const lastRecalledLabel = scene.lastRecalledAt ? formatLightingRelativeTime(scene.lastRecalledAt) : undefined;
    return (
      <div role="listitem" style={innerStyle}>
        <SceneTile
          id={scene.id}
          name={scene.name}
          onCount={stats.onCount}
          avgCct={stats.avgCct}
          isActive={scene.id === activeSceneId}
          isModified={scene.id === modifiedSceneId}
          bridgeReachable={bridgeReachable}
          lastRecalledLabel={lastRecalledLabel}
          thumbDataUri={sceneThumbs[scene.id]}
          pinned={scene.pinned}
          onRecall={onRecall}
          onReorder={onReorder}
          onPin={onPin}
        />
      </div>
    );
  }

  if (showAddTile && onAddScene) {
    return (
      <div style={innerStyle}>
        <button
          type="button"
          className={styles.tileAdd}
          onClick={onAddScene}
          aria-label="Save current state as a new scene"
        >
          <Plus aria-hidden="true" size={18} strokeWidth={1.75} />
          <span>New scene</span>
        </button>
      </div>
    );
  }

  return null;
}

export function SceneRail({
  scenes,
  activeSceneId,
  modifiedSceneId,
  sceneThumbs,
  searchQuery = "",
  bridgeReachable = true,
  onRecall,
  onAddScene,
  onClearSearch,
  onReorderScene,
  onPinScene,
}: SceneRailProps) {
  // Adapter — the SceneTile drop handler emits "drop on tile X"; the
  // engine IPC takes "before scene id". They match shape exactly.
  const onTileReorder = onReorderScene
    ? (draggedSceneId: string, beforeSceneId: string) => onReorderScene(draggedSceneId, beforeSceneId)
    : undefined;
  const needle = searchQuery.trim().toLowerCase();
  const filteredScenes = needle ? scenes.filter((scene) => scene.name.toLowerCase().includes(needle)) : scenes;

  if (scenes.length === 0 && !onAddScene) {
    return (
      <p className={styles.empty}>No scenes saved yet. Press S after editing fixtures to save the current state.</p>
    );
  }

  if (needle && filteredScenes.length === 0) {
    return (
      <p className={styles.empty}>
        No scenes match “{searchQuery}”.
        {onClearSearch ? (
          <>
            {" "}
            <button type="button" className={styles.emptyAction} onClick={onClearSearch}>
              Clear search
            </button>
          </>
        ) : null}
      </p>
    );
  }

  const showAddTile = Boolean(onAddScene) && !needle;

  if (filteredScenes.length > VIRTUALIZE_THRESHOLD) {
    const totalCellCount = filteredScenes.length + (showAddTile ? 1 : 0);
    const rowCount = Math.ceil(totalCellCount / 2);
    const cellProps: CellPayload = {
      filteredScenes,
      activeSceneId,
      modifiedSceneId,
      sceneThumbs,
      bridgeReachable,
      onRecall,
      onReorder: onTileReorder,
      onPin: onPinScene,
      onAddScene,
      showAddTile,
      totalCellCount,
    };
    return (
      <div className={styles.sceneGridVirtualized} role="list" aria-label="Saved scenes">
        <AutoSizer
          renderProp={({ width, height }: Partial<Size>) => {
            if (!width || !height) return null;
            return (
              <Grid<CellPayload>
                cellComponent={VirtualizedCell}
                cellProps={cellProps}
                columnCount={2}
                columnWidth={Math.floor(width / 2)}
                rowCount={rowCount}
                rowHeight={ROW_HEIGHT}
                defaultHeight={height}
                defaultWidth={width}
                overscanCount={2}
              />
            );
          }}
        />
      </div>
    );
  }

  // Drop on the rail container (outside any tile) reorders the dragged
  // scene to the end of the list. Plain "+ New scene" tile clicks still
  // fire normally; the drop event lives on the wrapper div.
  const containerDragOver = onReorderScene
    ? (event: React.DragEvent<HTMLDivElement>) => {
        if (event.dataTransfer.types.includes("application/x-sse-scene-id")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }
    : undefined;
  const containerDrop = onReorderScene
    ? (event: React.DragEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) return;
        if (!event.dataTransfer.types.includes("application/x-sse-scene-id")) return;
        event.preventDefault();
        const draggedId = event.dataTransfer.getData("application/x-sse-scene-id");
        if (draggedId) onReorderScene(draggedId, null);
      }
    : undefined;

  return (
    <div
      className={styles.sceneGrid}
      role="list"
      aria-label="Saved scenes"
      onDragOver={containerDragOver}
      onDrop={containerDrop}
    >
      {filteredScenes.map((scene) => {
        const stats = statsForScene(scene);
        const lastRecalledLabel = scene.lastRecalledAt ? formatLightingRelativeTime(scene.lastRecalledAt) : undefined;
        return (
          <div key={scene.id} role="listitem">
            <SceneTile
              id={scene.id}
              name={scene.name}
              onCount={stats.onCount}
              avgCct={stats.avgCct}
              isActive={scene.id === activeSceneId}
              isModified={scene.id === modifiedSceneId}
              bridgeReachable={bridgeReachable}
              lastRecalledLabel={lastRecalledLabel}
              thumbDataUri={sceneThumbs[scene.id]}
              pinned={scene.pinned}
              onRecall={onRecall}
              onReorder={onTileReorder}
              onPin={onPinScene}
            />
          </div>
        );
      })}
      {showAddTile ? (
        <button
          type="button"
          className={styles.tileAdd}
          onClick={onAddScene}
          aria-label="Save current state as a new scene"
        >
          <Plus aria-hidden="true" size={18} strokeWidth={1.75} />
          <span>New scene</span>
        </button>
      ) : null}
    </div>
  );
}
