import type { LightingSceneFixtureSnapshot } from "@sse/engine-client";

import { lightingFixtureColorHex } from "../lightingHelpers";

import styles from "./LightingRail.module.css";

const BAR_COUNT = 8;

export interface SceneShapeMiniGraphProps {
  sceneName: string;
  fixtureStates: readonly LightingSceneFixtureSnapshot[];
}

export function SceneShapeMiniGraph({ sceneName, fixtureStates }: SceneShapeMiniGraphProps) {
  const bars = fixtureStates
    .map((state) => ({
      intensity: state.on ? Math.max(0, Math.min(100, state.intensity)) : 0,
      cct: state.cct,
      on: state.on,
    }))
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, BAR_COUNT);

  while (bars.length < BAR_COUNT) {
    bars.push({ intensity: 0, cct: 4400, on: false });
  }

  return (
    <span className={styles.sceneShapeMiniGraph} role="img" aria-label={`Scene intensity shape for ${sceneName}`}>
      {bars.map((bar, index) => (
        <span
          // Index is stable because this is an aggregate sparkline, not fixture identity.
          key={index}
          className={styles.sceneShapeBar}
          style={{
            height: `${Math.max(2, Math.round((bar.intensity / 100) * 12))}px`,
            background: bar.intensity > 0 ? lightingFixtureColorHex(bar.cct, bar.on) : "rgba(250, 246, 230, 0.22)",
          }}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
