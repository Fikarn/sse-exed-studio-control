import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Palette, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  ColorPicker,
  ContextMenu,
  InlineRename,
  type ContextMenuItem,
  type InlineRenameHandle,
} from "@sse/design-system";

import { LIGHTING_COLOR_TAG_PALETTE, lightingColorTagHex } from "../lightingColorTags";

import { SceneThumbnail } from "./SceneThumbnail";
import styles from "./LightingRail.module.css";

export interface SceneTileProps {
  id: string;
  name: string;
  /** Count of fixtures currently `on` in the scene's saved state. */
  onCount: number;
  /** Average CCT across fixtures `on` in the scene's saved state. */
  avgCct: number;
  isActive: boolean;
  isModified: boolean;
  /**
   * When false, drift detection is comparing live state to a preview-only
   * recall, not a scene actually driving the rig. Modified state is shown as
   * "Preview" with a neutral border to avoid alarming the operator.
   */
  bridgeReachable?: boolean;
  /** Optional last-recalled timestamp surfaced as a third subline. */
  lastRecalledLabel?: string;
  thumbDataUri?: string;
  pinned?: boolean;
  /** When true, dnd-kit sortable hooks are wired in. The parent
   *  <SortableContext> still has to be present for sorting to actually
   *  work — this prop only controls whether THIS tile participates. */
  sortable?: boolean;
  onRecall: (sceneId: string) => void;
  /** When provided, renders an inline pin / unpin button. */
  onPin?: (sceneId: string, pinned: boolean) => void;
  /** Inline-rename commit handler. When provided, double-click on the tile
   *  name (or pressing F2 when the tile is focused) opens an inline editor. */
  onRename?: (sceneId: string, newName: string) => void | Promise<void>;
  /** When true, marks this tile's rename action as in-flight. */
  renameBusy?: boolean;
  /** Right-click delete handler. When provided, the context menu surfaces a
   *  Delete item that fires this callback (parent owns the confirm dialog). */
  onRequestDelete?: (sceneId: string, sceneName: string) => void;
  /** Operator-assigned color tag index (0..7) or null for no tag.
   *  Renders a 4 px left accent bar when set. */
  colorIndex?: number | null;
  /** Set color tag handler. When provided, the context menu surfaces a
   *  Color… item that opens a `<ColorPicker>` popover. */
  onSetColor?: (sceneId: string, colorIndex: number | null) => void;
  /** Hover preview signal. When provided, hovering the tile for ~300 ms
   *  fires this callback so the inspector can preview the scene contents
   *  without recall. Cleared by mouseout / click via the parent. */
  onHoverPreview?: (sceneId: string) => void;
  /** Hover preview cleanup signal. Fires on mouseout / leave. */
  onHoverPreviewClear?: (sceneId: string) => void;
}

export function SceneTile({
  id,
  name,
  onCount,
  avgCct,
  isActive,
  isModified,
  bridgeReachable = true,
  lastRecalledLabel,
  thumbDataUri,
  pinned = false,
  sortable = false,
  onRecall,
  onPin,
  onRename,
  renameBusy = false,
  onRequestDelete,
  colorIndex = null,
  onSetColor,
  onHoverPreview,
  onHoverPreviewClear,
}: SceneTileProps) {
  const renameRef = useRef<InlineRenameHandle | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number } | null>(null);
  const colorHex = lightingColorTagHex(colorIndex);
  // When the bridge is unreachable, "modified" is comparing live state to a
  // preview — downgrade the visual to active to avoid false alarm.
  const showAsModified = isModified && bridgeReachable;
  const baseClass = isActive
    ? showAsModified
      ? `${styles.tile} ${styles.tileActive} ${styles.tileModified}`
      : `${styles.tile} ${styles.tileActive}`
    : styles.tile;
  const stateClass = pinned ? `${baseClass} ${styles.tilePinned}` : baseClass;

  const subLine = onCount > 0 ? `${onCount} on · ${Math.round(avgCct)} K` : `${onCount} on`;
  const badgeText = isActive ? (showAsModified ? "Modified" : isModified ? "Preview" : "Active") : null;
  const ariaLabel = `Recall scene ${name}${badgeText ? ` (${badgeText.toLowerCase()})` : ""}${pinned ? ", pinned" : ""}`;

  // dnd-kit sortable hook. Provides setNodeRef, transform/transition that
  // animate the tile to its previewed position as siblings shift around,
  // attributes (role, aria-*), and listeners (pointer + keyboard) that
  // drive the drag gesture. When `sortable` is false the hook still runs
  // (rules-of-hooks) but we skip wiring its outputs.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
  });

  const tileStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // While picked up: dim the resting tile so the operator can see the
    // displacement preview clearly. dnd-kit doesn't render a drag image —
    // it transforms the tile itself — so reducing opacity here is the
    // standard sortable pattern. Lift via z-index so the dragged tile
    // paints above its siblings (the OS doesn't do this for us when the
    // tile is just being CSS-transformed, not picked up by a real drag).
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 2 : undefined,
    cursor: sortable ? (isDragging ? "grabbing" : "grab") : "pointer",
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!onRename && !onPin && !onRequestDelete && !onSetColor) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const menuItems: ContextMenuItem[] = [];
  if (onRename) {
    menuItems.push({
      id: "rename",
      label: "Rename",
      icon: Pencil,
      onSelect: () => renameRef.current?.beginEdit(),
    });
  }
  if (onPin) {
    menuItems.push({
      id: "pin",
      label: pinned ? "Unpin" : "Pin",
      icon: pinned ? PinOff : Pin,
      onSelect: () => onPin(id, !pinned),
    });
  }
  if (onSetColor) {
    menuItems.push({
      id: "color",
      label: "Color…",
      icon: Palette,
      onSelect: () => {
        // Re-open at the same position the context menu sat at — the
        // ContextMenu portal mounts at (menuPos.x, menuPos.y), so the
        // ColorPicker continues that anchor.
        if (menuPos) setColorPickerPos(menuPos);
      },
    });
  }
  if (onRequestDelete) {
    menuItems.push({
      id: "delete",
      label: "Delete scene…",
      icon: Trash2,
      tone: "danger",
      onSelect: () => onRequestDelete(id, name),
    });
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // F2 mirrors the desktop convention for "rename selected row" (Linear,
    // Notion, every file manager). Works when the tile has keyboard focus
    // and an onRename handler is wired.
    if (onRename && event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      renameRef.current?.beginEdit();
      return;
    }
    // Space inside dnd-kit's sortable enters keyboard-drag mode, so don't
    // intercept it here when sortable is enabled.
    if (event.key === "Enter" || (event.key === " " && !sortable)) {
      event.preventDefault();
      onRecall(id);
    }
  };

  // Rendered as <div role="button"> instead of <button> — dnd-kit's
  // listeners include drag-start handlers that want to be free of the
  // browser's button keyboard activation semantics. Keyboard activation
  // (Enter / Space-when-not-sortable) and aria attributes preserve
  // button-like semantics for screen readers.
  return (
    <div
      ref={setNodeRef}
      className={stateClass}
      style={tileStyle}
      onClick={() => {
        // Click cancels any pending hover preview (the timer is owned by the
        // parent — the clear callback is the contract).
        onHoverPreviewClear?.(id);
        onRecall(id);
      }}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      onMouseEnter={onHoverPreview ? () => onHoverPreview(id) : undefined}
      onMouseLeave={onHoverPreviewClear ? () => onHoverPreviewClear(id) : undefined}
      aria-current={isActive ? "true" : undefined}
      aria-label={ariaLabel}
      data-pinned={pinned || undefined}
      data-dragging={isDragging || undefined}
      {...attributes}
      {...listeners}
      // dnd-kit's `attributes` already provides role="button" and
      // tabIndex={0}; spreading them earlier would conflict with
      // setting them explicitly below. Override role only after the
      // spread so we keep sortable-aware aria semantics from dnd-kit
      // but pin the role to "button" for screen-reader expectations.
      role="button"
      tabIndex={0}
    >
      {colorHex ? <span aria-hidden="true" className={styles.tileColorBar} style={{ background: colorHex }} /> : null}
      <SceneThumbnail src={thumbDataUri} alt={`${name} preview`} />
      <span className={styles.tileBody}>
        <span className={styles.tileNameRow}>
          <span className={styles.tileName}>
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
          {badgeText ? (
            <span className={styles.tileBadge}>
              <span className={styles.tileBadgeDot} aria-hidden="true" />
              {badgeText}
            </span>
          ) : null}
        </span>
        <span className={styles.tileSub}>{subLine}</span>
        {lastRecalledLabel ? <span className={styles.tileSub}>last {lastRecalledLabel}</span> : null}
      </span>
      {onPin ? (
        <span
          className={styles.tilePinAction}
          role="button"
          tabIndex={0}
          aria-label={pinned ? `Unpin scene ${name}` : `Pin scene ${name}`}
          aria-pressed={pinned}
          onPointerDown={(event) => {
            // Stop the pointer event from initiating a drag on the parent
            // sortable wrapper — pin and drag share the same starting
            // gesture otherwise.
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onPin(id, !pinned);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onPin(id, !pinned);
            }
          }}
        >
          {pinned ? (
            <PinOff aria-hidden="true" size={12} strokeWidth={2} />
          ) : (
            <Pin aria-hidden="true" size={12} strokeWidth={2} />
          )}
        </span>
      ) : null}
      {menuPos && menuItems.length > 0 ? (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
          ariaLabel={`Scene ${name} actions`}
        />
      ) : null}
      {colorPickerPos && onSetColor ? (
        <ColorPicker
          x={colorPickerPos.x}
          y={colorPickerPos.y}
          swatches={LIGHTING_COLOR_TAG_PALETTE}
          selectedIndex={colorIndex}
          onSelect={(next) => onSetColor(id, next)}
          onClose={() => setColorPickerPos(null)}
          ariaLabel={`Pick a color tag for scene ${name}`}
        />
      ) : null}
    </div>
  );
}
