import { type DragEvent, useState } from "react";
import { Pin, PinOff } from "lucide-react";

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
  onRecall: (sceneId: string) => void;
  /** When provided, the tile is drag-reorder-enabled. Drop on tile X
   *  reorders the dragged scene to immediately before X. */
  onReorder?: (draggedSceneId: string, beforeSceneId: string) => void;
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
  onRecall,
  onReorder,
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

  const [isDragOver, setIsDragOver] = useState(false);
  const draggable = Boolean(onReorder);

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    if (!onReorder) return;
    event.dataTransfer.setData("application/x-sse-scene-id", id);
    event.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    if (!onReorder) return;
    if (event.dataTransfer.types.includes("application/x-sse-scene-id")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    }
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    if (!onReorder) return;
    event.preventDefault();
    setIsDragOver(false);
    const draggedId = event.dataTransfer.getData("application/x-sse-scene-id");
    if (draggedId && draggedId !== id) {
      onReorder(draggedId, id);
    }
  };

  return (
    <button
      type="button"
      className={stateClass}
      onClick={() => onRecall(id)}
      aria-current={isActive ? "true" : undefined}
      aria-label={ariaLabel}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragOver={draggable ? handleDragOver : undefined}
      onDragLeave={draggable ? handleDragLeave : undefined}
      onDrop={draggable ? handleDrop : undefined}
      data-drag-over={isDragOver || undefined}
      data-pinned={pinned || undefined}
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
    </button>
  );
}
