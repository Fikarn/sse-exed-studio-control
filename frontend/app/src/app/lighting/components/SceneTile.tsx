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
  thumbDataUri?: string;
  onRecall: (sceneId: string) => void;
}

export function SceneTile({ id, name, onCount, avgCct, isActive, isModified, thumbDataUri, onRecall }: SceneTileProps) {
  const stateClass = isActive
    ? isModified
      ? `${styles.tile} ${styles.tileActive} ${styles.tileModified}`
      : `${styles.tile} ${styles.tileActive}`
    : styles.tile;

  // Mirror the v6 prototype: "3 on · 3800 K". Drop the K when no fixtures are
  // on (avg CCT is meaningless on an all-off scene).
  const subLine = onCount > 0 ? `${onCount} on · ${Math.round(avgCct)} K` : `${onCount} on`;

  return (
    <button
      type="button"
      className={stateClass}
      onClick={() => onRecall(id)}
      aria-pressed={isActive}
      aria-label={`Recall scene ${name}`}
    >
      <SceneThumbnail src={thumbDataUri} alt={`${name} preview`} />
      <span className={styles.tileBody}>
        <span className={styles.tileNameRow}>
          <span className={styles.tileName}>{name}</span>
          {isActive ? (
            <span className={styles.tileBadge} aria-hidden="true">
              <span className={styles.tileBadgeDot} />
              {isModified ? "Modified" : "Active"}
            </span>
          ) : null}
        </span>
        <span className={styles.tileSub}>{subLine}</span>
      </span>
    </button>
  );
}
