import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { Key, type MenuContent } from "@sse/design-system";
import type { LightingSceneSnapshot } from "@sse/engine-client";

import type { LightingMenu } from "../lightingMenus";
import { SceneRow, type SceneRowWord } from "./SceneRow";
import styles from "./SceneRail.module.css";

// The visual overhaul's Lighting page (2026-10-04): the scenes as rows that
// fill the room the cluster leaves them, and never scroll (DESIGN.md §1). When
// there are more than fit, they come in pages, with the page's keys under the
// last row, and the page that holds the scene on the rig is the one shown
// when that scene changes. The Save row stands under them, always in the same
// place in the list.

const ROW_HEIGHT = 48;
const PAGER_HEIGHT = 36;
const GAP = 8;

export interface SceneRailProps {
  scenes: readonly LightingSceneSnapshot[];
  /** The scene the rig holds or held (the hardware link's live scene). */
  liveSceneId: string | null;
  /** Its word: `on rig` or `unsaved`; null when it is only chosen. */
  liveWord: Extract<SceneRowWord, "on rig" | "unsaved"> | null;
  previewMode?: boolean;
  previewSceneId?: string | null;
  /** The scene the plate shows. */
  selectedSceneId?: string | null;
  searchQuery?: string;
  onClearSearch?: () => void;
  /** Patch mode: recalls and edits are refused, and the row says why. */
  lockedReason?: string | null;
  onRecall: (sceneId: string) => void;
  onReorderScene?: (sceneId: string, beforeSceneId: string | null) => void;
  onRenameScene?: (sceneId: string, newName: string) => void | Promise<void>;
  renamingSceneIds?: ReadonlySet<string>;
  onSetSceneColor?: (sceneId: string, colorIndex: number | null) => void;
  onHoverPreview?: (sceneId: string) => void;
  onHoverPreviewClear?: (sceneId: string) => void;
  /** Each row's menu; `rename` and `colour` ask the row for its inline editor. */
  buildMenu: (scene: LightingSceneSnapshot, ask: { rename: () => void; colour: () => void }) => LightingMenu;
  arm: MenuContent["arm"];
  /** The Save row, under the scenes. */
  footer: ReactNode;
}

function factsOf(scene: LightingSceneSnapshot) {
  const lit = scene.fixtureStates.filter((state) => state.on);
  if (lit.length === 0) return "all off";
  const cct = Math.round(lit.reduce((sum, state) => sum + state.cct, 0) / lit.length);
  return `${lit.length} on · ${cct} K`;
}

/** How many rows the rail's box holds, read as the box is laid out. */
function useRowsThatFit(count: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setHeight(node.clientHeight);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Before the box is measured (and where nothing lays it out) every row shows.
  if (height === null || height <= 0) return { ref, perPage: Math.max(1, count) };
  const footer = ROW_HEIGHT + GAP;
  if (count * ROW_HEIGHT + footer <= height) return { ref, perPage: Math.max(1, count) };
  return { ref, perPage: Math.max(1, Math.floor((height - footer - PAGER_HEIGHT - GAP) / ROW_HEIGHT)) };
}

export function SceneRail({
  scenes,
  liveSceneId,
  liveWord,
  previewMode = false,
  previewSceneId = null,
  selectedSceneId = null,
  searchQuery = "",
  onClearSearch,
  lockedReason = null,
  onRecall,
  onReorderScene,
  onRenameScene,
  renamingSceneIds,
  onSetSceneColor,
  onHoverPreview,
  onHoverPreviewClear,
  buildMenu,
  arm,
  footer,
}: SceneRailProps) {
  const needle = searchQuery.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? scenes.filter((scene) => scene.name.toLowerCase().includes(needle)) : scenes),
    [needle, scenes]
  );
  const { ref, perPage } = useRowsThatFit(filtered.length);
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const [page, setPage] = useState(0);
  const shownPage = Math.min(page, pageCount - 1);

  // A new search starts at its first page; a new scene on the rig (a recall
  // here or on the deck) shows its page.
  useEffect(() => setPage(0), [needle]);
  useEffect(() => {
    if (!liveSceneId) return;
    const index = filtered.findIndex((scene) => scene.id === liveSceneId);
    if (index >= 0) setPage(Math.floor(index / perPage));
    // Only a change of the live scene, or of the rows that fit (the first
    // measure, a resize), moves the page, never the operator's paging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSceneId, perPage]);

  const [renameRequests, setRenameRequests] = useState<Record<string, number>>({});
  const [colourRequests, setColourRequests] = useState<Record<string, number>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const shown = filtered.slice(shownPage * perPage, shownPage * perPage + perPage);
  const sortable = Boolean(onReorderScene) && !needle && !lockedReason;
  const shownIds = shown.map((scene) => scene.id);
  const allIds = filtered.map((scene) => scene.id);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!onReorderScene) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = allIds.indexOf(String(active.id));
    const toIndex = allIds.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    // The engine's contract is "insert before id": the scene that follows the
    // dragged one in the new order is its anchor.
    const order = arrayMove(allIds, fromIndex, toIndex);
    const at = order.indexOf(String(active.id));
    onReorderScene(String(active.id), at + 1 < order.length ? order[at + 1]! : null);
  };

  const wordOf = (scene: LightingSceneSnapshot): SceneRowWord | null => {
    if (previewMode) return scene.id === previewSceneId ? "preview" : null;
    return scene.id === liveSceneId ? liveWord : null;
  };

  let body: ReactNode;
  if (scenes.length === 0) {
    body = <p className={styles.empty}>No scenes saved yet. Set the rig, then save it as a new scene.</p>;
  } else if (filtered.length === 0) {
    body = (
      <p className={styles.empty}>
        No scenes match “{searchQuery}”.
        {onClearSearch ? (
          <Key size="small" className={styles.emptyKey} onClick={onClearSearch}>
            Clear search
          </Key>
        ) : null}
      </p>
    );
  } else {
    const rows = (
      <div className={styles.rows} role="list" aria-label="Saved scenes">
        {shown.map((scene) => (
          <div role="listitem" key={scene.id} className={styles.item}>
            <SceneRow
              id={scene.id}
              name={scene.name}
              facts={factsOf(scene)}
              word={wordOf(scene)}
              selected={scene.id === selectedSceneId}
              pinned={scene.pinned}
              colorIndex={scene.colorIndex}
              fadeProgress={scene.fadeProgress}
              sortable={sortable}
              lockedReason={lockedReason}
              onRecall={onRecall}
              menu={buildMenu(scene, {
                rename: () =>
                  setRenameRequests((current) => ({ ...current, [scene.id]: (current[scene.id] ?? 0) + 1 })),
                colour: () =>
                  setColourRequests((current) => ({ ...current, [scene.id]: (current[scene.id] ?? 0) + 1 })),
              })}
              arm={arm}
              renameRequest={renameRequests[scene.id] ?? 0}
              onRename={lockedReason ? undefined : onRenameScene}
              renameBusy={renamingSceneIds?.has(scene.id) ?? false}
              colourRequest={colourRequests[scene.id] ?? 0}
              onSetColor={onSetSceneColor}
              onHoverPreview={onHoverPreview}
              onHoverPreviewClear={onHoverPreviewClear}
            />
          </div>
        ))}
      </div>
    );
    body = sortable ? (
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={shownIds} strategy={verticalListSortingStrategy}>
          {rows}
        </SortableContext>
      </DndContext>
    ) : (
      rows
    );
  }

  return (
    <div ref={ref} className={styles.rail} data-testid="lighting-scene-rail">
      {body}
      {pageCount > 1 ? (
        <div className={styles.pager} data-testid="lighting-scene-pager">
          <Key
            size="small"
            aria-label="Previous page of scenes"
            disabled={shownPage === 0}
            onClick={() => setPage(Math.max(0, shownPage - 1))}
          >
            ‹
          </Key>
          <span className={styles.pageWord}>
            {shownPage + 1} / {pageCount}
          </span>
          <Key
            size="small"
            aria-label="Next page of scenes"
            disabled={shownPage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, shownPage + 1))}
          >
            ›
          </Key>
        </div>
      ) : null}
      <div className={styles.footer}>{footer}</div>
    </div>
  );
}
