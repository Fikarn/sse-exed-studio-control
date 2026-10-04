import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  ColorPicker,
  InlineRename,
  LampWord,
  MenuButton,
  type InlineRenameHandle,
  type MenuContent,
} from "@sse/design-system";

import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex } from "../lightingColorTags";
import type { LightingMenu } from "../lightingMenus";
import styles from "./SceneRail.module.css";

// The visual overhaul's Lighting page (2026-10-04): a scene is a calm row, 48
// px, one line: its colour, its name, and at the right either its word on the
// rig (ON RIG, UNSAVED, PREVIEW: the deck's RECALL words) or what it holds,
// quietly. A press recalls it (take-time); the ⋯ at its end, and a right-click
// on it, open its menu. Thumbnails, the level graph and the hover pin are gone:
// the plot shows what a scene holds, the menu pins it.

/** The scene's word, as the deck's RECALL says it (`lights.rs`). */
export type SceneRowWord = "on rig" | "unsaved" | "preview";

const WORD_TONE = { "on rig": "ok", unsaved: "attention", preview: "info" } as const;

export interface SceneRowProps {
  id: string;
  name: string;
  /** What it holds, quietly (`3 on · 3500 K`). */
  facts: string;
  word: SceneRowWord | null;
  /** The scene the plate shows: the Beige keyline. */
  selected?: boolean;
  pinned?: boolean;
  colorIndex?: number | null;
  /** 0..1 while a recall fades to it. */
  fadeProgress?: number | null;
  sortable?: boolean;
  /** Recalls are refused (Patch mode): the row says why and does nothing. */
  lockedReason?: string | null;
  onRecall: (sceneId: string) => void;
  /** The row's menu (the shared builder); the page's arm is passed in it. */
  menu: LightingMenu;
  arm: MenuContent["arm"];
  /** The menu's Rename… asks the row for its inline rename. */
  renameRequest?: number;
  onRename?: (sceneId: string, name: string) => void | Promise<void>;
  renameBusy?: boolean;
  /** The menu's Colour… opens the swatches at the row. */
  colourRequest?: number;
  onSetColor?: (sceneId: string, colorIndex: number | null) => void;
  onHoverPreview?: (sceneId: string) => void;
  onHoverPreviewClear?: (sceneId: string) => void;
}

export function SceneRow({
  id,
  name,
  facts,
  word,
  selected = false,
  pinned = false,
  colorIndex = null,
  fadeProgress = null,
  sortable = false,
  lockedReason = null,
  onRecall,
  menu,
  arm,
  renameRequest = 0,
  onRename,
  renameBusy = false,
  colourRequest = 0,
  onSetColor,
  onHoverPreview,
  onHoverPreviewClear,
}: SceneRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const renameRef = useRef<InlineRenameHandle | null>(null);
  const [colourAt, setColourAt] = useState<{ x: number; y: number } | null>(null);
  const colourHex = lightingColorTagHex(colorIndex);
  const fading = typeof fadeProgress === "number" && fadeProgress > 0 && fadeProgress < 1 ? fadeProgress : null;

  // A request from the menu (Rename…, Colour…) arrives as a new number, so
  // asking twice for the same row asks twice.
  const seenRename = useRef(renameRequest);
  useEffect(() => {
    if (renameRequest === seenRename.current) return;
    seenRename.current = renameRequest;
    renameRef.current?.beginEdit();
  }, [renameRequest]);
  const seenColour = useRef(colourRequest);
  useEffect(() => {
    if (colourRequest === seenColour.current) return;
    seenColour.current = colourRequest;
    const box = rowRef.current?.getBoundingClientRect();
    if (box) setColourAt({ x: box.left + 24, y: box.bottom });
  }, [colourRequest]);

  const ariaLabel = `Recall scene ${name}${word ? ` (${word})` : ""}${pinned ? ", pinned" : ""}`;

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 2 : undefined,
  };

  // Enter recalls, as a press does; Space recalls too unless the row is
  // sortable, when it picks the row up (dnd-kit's keyboard sensor). The row's
  // own keys go first; the sensor sees only the keys they leave alone, and
  // only on the row at rest (a key typed into the rename is the input's).
  const { onKeyDown: sortableKeyDown, ...sortableListeners } = listeners ?? {};
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || isDragging) return;
    if (event.key === "Enter" || (event.key === " " && !sortable)) {
      event.preventDefault();
      if (!lockedReason) onRecall(id);
    }
    if (!event.defaultPrevented) sortableKeyDown?.(event);
  };

  return (
    <div
      ref={(node) => {
        rowRef.current = node;
        setNodeRef(node);
      }}
      className={styles.row}
      style={style}
      data-scene-row={id}
      data-selected={selected ? "true" : undefined}
      data-word={word ?? undefined}
      data-dragging={isDragging || undefined}
      onMouseEnter={onHoverPreview ? () => onHoverPreview(id) : undefined}
      onMouseLeave={onHoverPreviewClear ? () => onHoverPreviewClear(id) : undefined}
    >
      <div
        ref={setActivatorNodeRef}
        className={styles.recall}
        aria-label={ariaLabel}
        aria-current={word === "on rig" || word === "unsaved" ? "true" : undefined}
        title={lockedReason ?? undefined}
        data-selected={selected || undefined}
        data-pinned={pinned || undefined}
        data-dragging={isDragging || undefined}
        data-fading={fading !== null || undefined}
        data-take=""
        onClick={() => {
          onHoverPreviewClear?.(id);
          if (!lockedReason) onRecall(id);
        }}
        onKeyDown={handleKeyDown}
        {...attributes}
        {...sortableListeners}
        aria-disabled={lockedReason ? "true" : undefined}
        role="button"
        tabIndex={0}
      >
        <span
          aria-hidden="true"
          className={styles.colour}
          style={colourHex ? ({ "--scene-colour": colourHex } as CSSProperties) : undefined}
          data-set={colourHex ? "" : undefined}
        />
        <span className={styles.name}>
          {onRename ? (
            <InlineRename
              ref={renameRef}
              value={name}
              onCommit={(next) => onRename(id, next)}
              busy={renameBusy}
              inputAriaLabel={`Rename scene ${name}`}
              maxLength={120}
            />
          ) : (
            name
          )}
        </span>
        <span className={styles.facts}>
          {word ? (
            <LampWord tone={WORD_TONE[word]} testId={`lighting-scene-word-${id}`}>
              {word}
            </LampWord>
          ) : (
            facts
          )}
        </span>
        {fading !== null ? (
          <span className={styles.fade} aria-hidden="true">
            <span className={styles.fadeBar} style={{ width: `${Math.round(fading * 100)}%` }} />
          </span>
        ) : null}
      </div>
      <span className={styles.menu}>
        <MenuButton
          buttonLabel={`${name} menu`}
          buttonTestId={`lighting-scene-menu-${id}`}
          contextTarget={rowRef}
          size="sm"
          menu={{ ...menu, arm }}
        />
      </span>
      {colourAt && onSetColor ? (
        <ColorPicker
          x={colourAt.x}
          y={colourAt.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={colorIndex}
          onSelect={(next) => onSetColor(id, next)}
          onClose={() => setColourAt(null)}
          ariaLabel={`Pick a colour for scene ${name}`}
        />
      ) : null}
    </div>
  );
}
