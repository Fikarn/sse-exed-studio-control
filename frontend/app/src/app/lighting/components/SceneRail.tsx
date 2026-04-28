import { Plus } from "lucide-react";

import type { LightingSceneSnapshot } from "@sse/engine-client";

import { SceneTile } from "./SceneTile";
import styles from "./LightingRail.module.css";

export interface SceneRailProps {
  scenes: readonly LightingSceneSnapshot[];
  activeSceneId: string | null;
  modifiedSceneId: string | null;
  sceneThumbs: Record<string, string>;
  onRecall: (sceneId: string) => void;
  onAddScene?: () => void;
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

export function SceneRail({
  scenes,
  activeSceneId,
  modifiedSceneId,
  sceneThumbs,
  onRecall,
  onAddScene,
}: SceneRailProps) {
  if (scenes.length === 0 && !onAddScene) {
    return (
      <p className={styles.empty}>No scenes saved yet. Press S after editing fixtures to save the current state.</p>
    );
  }

  return (
    <div className={styles.sceneGrid} role="list" aria-label="Saved scenes">
      {scenes.map((scene) => {
        const stats = statsForScene(scene);
        return (
          <div key={scene.id} role="listitem">
            <SceneTile
              id={scene.id}
              name={scene.name}
              onCount={stats.onCount}
              avgCct={stats.avgCct}
              isActive={scene.id === activeSceneId}
              isModified={scene.id === modifiedSceneId}
              thumbDataUri={sceneThumbs[scene.id]}
              onRecall={onRecall}
            />
          </div>
        );
      })}
      {onAddScene ? (
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
}
