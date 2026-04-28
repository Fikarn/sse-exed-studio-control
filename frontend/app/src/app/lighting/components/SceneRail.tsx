import type { LightingSceneSnapshot } from "@sse/engine-client";

import { SceneTile } from "./SceneTile";
import styles from "./LightingRail.module.css";

export interface SceneRailProps {
  scenes: readonly LightingSceneSnapshot[];
  activeSceneId: string | null;
  modifiedSceneId: string | null;
  sceneThumbs: Record<string, string>;
  lastRecalledLabel?: (scene: LightingSceneSnapshot) => string | undefined;
  onRecall: (sceneId: string) => void;
}

export function SceneRail({
  scenes,
  activeSceneId,
  modifiedSceneId,
  sceneThumbs,
  lastRecalledLabel,
  onRecall,
}: SceneRailProps) {
  if (scenes.length === 0) {
    return <p className={styles.empty}>No scenes saved yet. Press S after editing fixtures to save the current state.</p>;
  }

  return (
    <ul className={styles.sceneList} aria-label="Saved scenes">
      {scenes.map((scene) => (
        <li key={scene.id}>
          <SceneTile
            id={scene.id}
            name={scene.name}
            fixtureCount={scene.fixtureCount}
            isActive={scene.id === activeSceneId}
            isModified={scene.id === modifiedSceneId}
            thumbDataUri={sceneThumbs[scene.id]}
            lastRecalledLabel={lastRecalledLabel?.(scene)}
            onRecall={onRecall}
          />
        </li>
      ))}
    </ul>
  );
}
