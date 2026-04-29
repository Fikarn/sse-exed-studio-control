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
  onRecall: (sceneId: string) => void;
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
  onRecall,
}: SceneTileProps) {
  // When the bridge is unreachable, "modified" is comparing live state to a
  // preview — downgrade the visual to active to avoid false alarm.
  const showAsModified = isModified && bridgeReachable;
  const stateClass = isActive
    ? showAsModified
      ? `${styles.tile} ${styles.tileActive} ${styles.tileModified}`
      : `${styles.tile} ${styles.tileActive}`
    : styles.tile;

  const subLine = onCount > 0 ? `${onCount} on · ${Math.round(avgCct)} K` : `${onCount} on`;
  const badgeText = isActive ? (showAsModified ? "Modified" : isModified ? "Preview" : "Active") : null;
  const ariaLabel = `Recall scene ${name}${badgeText ? ` (${badgeText.toLowerCase()})` : ""}`;

  return (
    <button
      type="button"
      className={stateClass}
      onClick={() => onRecall(id)}
      aria-current={isActive ? "true" : undefined}
      aria-label={ariaLabel}
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
    </button>
  );
}
