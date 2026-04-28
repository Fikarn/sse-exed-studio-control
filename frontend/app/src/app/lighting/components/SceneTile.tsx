import { SceneThumbnail } from "./SceneThumbnail";
import styles from "./LightingRail.module.css";

export interface SceneTileProps {
  id: string;
  name: string;
  fixtureCount: number;
  isActive: boolean;
  isModified: boolean;
  thumbDataUri?: string;
  lastRecalledLabel?: string;
  onRecall: (sceneId: string) => void;
}

export function SceneTile({
  id,
  name,
  fixtureCount,
  isActive,
  isModified,
  thumbDataUri,
  lastRecalledLabel,
  onRecall,
}: SceneTileProps) {
  const stateClass = isActive
    ? isModified
      ? `${styles.tile} ${styles.tileActive} ${styles.tileModified}`
      : `${styles.tile} ${styles.tileActive}`
    : styles.tile;

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
        <span className={styles.tileName}>{name}</span>
        <span className={styles.tileMeta}>
          {fixtureCount} fixture{fixtureCount === 1 ? "" : "s"}
          {lastRecalledLabel ? ` · ${lastRecalledLabel}` : ""}
        </span>
      </span>
      {isActive ? (
        <span className={styles.tileTag} aria-hidden="true">
          {isModified ? "Modified" : "Active"}
        </span>
      ) : null}
    </button>
  );
}
