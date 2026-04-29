import { type CSSProperties, type KeyboardEvent } from "react";
import { Pin, PinOff } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
}: SceneTileProps) {
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
      onClick={() => onRecall(id)}
      onKeyDown={handleKeyDown}
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
      <SceneThumbnail src={thumbDataUri} alt={`${name} preview`} />
      <span className={styles.tileBody}>
        <span className={styles.tileNameRow}>
          <span className={styles.tileName}>{name}</span>
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
    </div>
  );
}
