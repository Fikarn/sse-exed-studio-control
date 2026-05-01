import { Plus, Save } from "lucide-react";
import { type CSSProperties } from "react";
import { AutoSizer, type Size } from "react-virtualized-auto-sizer";
import { Grid } from "react-window";
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { EmptyState } from "@sse/design-system";
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
const EMPTY_RENAME_IDS: ReadonlySet<string> = new Set();

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
  /** Drag-to-reorder handler. When omitted, tiles aren't sortable. */
  onReorderScene?: (sceneId: string, beforeSceneId: string | null) => void;
  /** Pin / unpin handler. When omitted, the inline pin chip isn't rendered. */
  onPinScene?: (sceneId: string, pinned: boolean) => void;
  /** Inline-rename commit handler. When omitted, scene tiles aren't renamable. */
  onRenameScene?: (sceneId: string, newName: string) => void | Promise<void>;
  /** Set of scene ids whose rename is currently in flight. Used by tiles to
   *  show the busy treatment on the inline rename. */
  renamingSceneIds?: ReadonlySet<string>;
  /** Right-click delete request. Parent owns the confirm dialog + IPC call. */
  onRequestDeleteScene?: (sceneId: string, sceneName: string) => void;
  /** Set color tag handler. When omitted, the rail's tiles don't surface a
   *  Color… context-menu item. Receives `null` (clear) or `0..7` (set). */
  onSetSceneColor?: (sceneId: string, colorIndex: number | null) => void;
  /** Hover-preview wiring. Tile fires onHoverPreview after 300 ms (the timer
   *  is owned by the parent so it can be cancelled on click / unmount). */
  onHoverPreview?: (sceneId: string) => void;
  onHoverPreviewClear?: (sceneId: string) => void;
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
  onPin?: (sceneId: string, pinned: boolean) => void;
  onRename?: (sceneId: string, newName: string) => void | Promise<void>;
  renamingSceneIds: ReadonlySet<string>;
  onRequestDelete?: (sceneId: string, sceneName: string) => void;
  onSetColor?: (sceneId: string, colorIndex: number | null) => void;
  onHoverPreview?: (sceneId: string) => void;
  onHoverPreviewClear?: (sceneId: string) => void;
  onAddScene?: () => void;
  showAddTile: boolean;
  totalCellCount: number;
  sortable: boolean;
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
  onPin,
  onRename,
  renamingSceneIds,
  onRequestDelete,
  onSetColor,
  onHoverPreview,
  onHoverPreviewClear,
  onAddScene,
  showAddTile,
  totalCellCount,
  sortable,
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
      <div style={innerStyle}>
        <SceneTile
          id={scene.id}
          name={scene.name}
          onCount={stats.onCount}
          avgCct={stats.avgCct}
          isActive={scene.id === activeSceneId}
          isModified={scene.id === modifiedSceneId}
          bridgeReachable={bridgeReachable}
          lastRecalledLabel={lastRecalledLabel}
          fadeProgress={scene.fadeProgress}
          thumbDataUri={sceneThumbs[scene.id]}
          pinned={scene.pinned}
          colorIndex={scene.colorIndex}
          sortable={sortable}
          onRecall={onRecall}
          onPin={onPin}
          onRename={onRename}
          renameBusy={renamingSceneIds.has(scene.id)}
          onRequestDelete={onRequestDelete}
          onSetColor={onSetColor}
          onHoverPreview={onHoverPreview}
          onHoverPreviewClear={onHoverPreviewClear}
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
  onRenameScene,
  renamingSceneIds,
  onRequestDeleteScene,
  onSetSceneColor,
  onHoverPreview,
  onHoverPreviewClear,
}: SceneRailProps) {
  // Default to an empty Set so callers without an in-flight rename tracker
  // don't have to construct one. Memoized so consumers can stably pass
  // `undefined` without re-creating it per render.
  const effectiveRenamingIds = renamingSceneIds ?? EMPTY_RENAME_IDS;
  const needle = searchQuery.trim().toLowerCase();
  const filteredScenes = needle ? scenes.filter((scene) => scene.name.toLowerCase().includes(needle)) : scenes;

  // dnd-kit sensors:
  // - PointerSensor for mouse / touch / pen drag, with an 8 px activation
  //   distance so plain clicks (recall) don't accidentally start a drag.
  // - KeyboardSensor for accessibility — Tab to the tile, Space to pick up,
  //   arrow keys to move, Space to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortable = Boolean(onReorderScene) && !needle;
  const sortableIds = filteredScenes.map((scene) => scene.id);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!onReorderScene) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = sortableIds.indexOf(String(active.id));
    const toIndex = sortableIds.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    // Compute the new order and translate to the engine's
    // "reorder before id" contract: the dragged scene is inserted such
    // that the next scene (if any) becomes the anchor.
    const newOrder = arrayMove(sortableIds, fromIndex, toIndex);
    const draggedNewIdx = newOrder.indexOf(String(active.id));
    const beforeId = draggedNewIdx + 1 < newOrder.length ? newOrder[draggedNewIdx + 1]! : null;
    onReorderScene(String(active.id), beforeId);
  };

  if (scenes.length === 0) {
    // F10 — empty state CTA. Use EmptyState's structured `action` prop so
    // the primary "Save first scene" affordance is consistent across rails.
    if (onAddScene) {
      return (
        <div className={styles.sceneEmptyShell}>
          <EmptyState
            icon={Save}
            title="No scenes saved yet"
            message="Adjust fixtures, then save the current rig state as a scene to recall later."
            action={{ label: "Save first scene", onClick: onAddScene, icon: Save }}
          />
        </div>
      );
    }
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

  // dnd-kit context wraps both the flat and virtualized renders. The
  // SortableContext's strategy is `rectSortingStrategy` which animates
  // tiles into their previewed positions in a 2-D grid (the standard
  // Notion / Trello "cards push aside" feel).
  const railBody =
    filteredScenes.length > VIRTUALIZE_THRESHOLD ? (
      (() => {
        const totalCellCount = filteredScenes.length + (showAddTile ? 1 : 0);
        const rowCount = Math.ceil(totalCellCount / 2);
        const cellProps: CellPayload = {
          filteredScenes,
          activeSceneId,
          modifiedSceneId,
          sceneThumbs,
          bridgeReachable,
          onRecall,
          onPin: onPinScene,
          onRename: onRenameScene,
          renamingSceneIds: effectiveRenamingIds,
          onRequestDelete: onRequestDeleteScene,
          onSetColor: onSetSceneColor,
          onHoverPreview,
          onHoverPreviewClear,
          onAddScene,
          showAddTile,
          totalCellCount,
          sortable,
        };
        return (
          <div className={styles.sceneGridVirtualized} aria-label="Saved scenes">
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
      })()
    ) : (
      <div className={styles.sceneGrid} aria-label="Saved scenes">
        {filteredScenes.map((scene) => {
          const stats = statsForScene(scene);
          const lastRecalledLabel = scene.lastRecalledAt ? formatLightingRelativeTime(scene.lastRecalledAt) : undefined;
          return (
            <SceneTile
              key={scene.id}
              id={scene.id}
              name={scene.name}
              onCount={stats.onCount}
              avgCct={stats.avgCct}
              isActive={scene.id === activeSceneId}
              isModified={scene.id === modifiedSceneId}
              bridgeReachable={bridgeReachable}
              lastRecalledLabel={lastRecalledLabel}
              fadeProgress={scene.fadeProgress}
              thumbDataUri={sceneThumbs[scene.id]}
              pinned={scene.pinned}
              colorIndex={scene.colorIndex}
              sortable={sortable}
              onRecall={onRecall}
              onPin={onPinScene}
              onRename={onRenameScene}
              renameBusy={effectiveRenamingIds.has(scene.id)}
              onRequestDelete={onRequestDeleteScene}
              onSetColor={onSetSceneColor}
              onHoverPreview={onHoverPreview}
              onHoverPreviewClear={onHoverPreviewClear}
            />
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

  if (!sortable) return railBody;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        {railBody}
      </SortableContext>
    </DndContext>
  );
}
