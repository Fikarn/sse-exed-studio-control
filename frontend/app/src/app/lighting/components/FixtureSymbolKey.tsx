import { useMemo } from "react";

import type { LightingFixtureCatalogSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import { getFixtureVisualModel, type FixtureVisualModel, type StagePlotRenderMode } from "../fixtureVisuals";

import { FixtureSymbol } from "./FixtureSymbol";

import styles from "./FixtureSymbolKey.module.css";

export interface FixtureSymbolKeyProps {
  catalog?: LightingFixtureCatalogSnapshot | null;
  fixtures: readonly LightingFixtureSnapshot[];
  renderMode: StagePlotRenderMode;
}

interface SymbolKeyRow {
  count: number;
  fixture: LightingFixtureSnapshot;
  visual: FixtureVisualModel;
}

export function FixtureSymbolKey({ catalog = null, fixtures, renderMode }: FixtureSymbolKeyProps) {
  const rows = useMemo(() => {
    const grouped = new Map<string, SymbolKeyRow>();
    for (const fixture of fixtures) {
      const visual = getFixtureVisualModel(catalog, fixture);
      const current = grouped.get(visual.definitionId);
      if (current) {
        current.count += 1;
      } else {
        grouped.set(visual.definitionId, { count: 1, fixture, visual });
      }
    }
    return Array.from(grouped.values()).sort((left, right) =>
      left.visual.displayName.localeCompare(right.visual.displayName)
    );
  }, [catalog, fixtures]);

  if (rows.length === 0) return null;

  return (
    <aside className={styles.key} aria-label="Fixture symbol key" data-testid="fixture-symbol-key">
      {rows.map(({ count, fixture, visual }) => (
        <div
          className={styles.row}
          data-definition-id={visual.definitionId}
          data-testid={`fixture-symbol-key-row-${visual.definitionId}`}
          key={visual.definitionId}
        >
          <svg className={styles.symbol} viewBox="-34 -24 68 48" aria-hidden="true" focusable="false">
            <FixtureSymbol
              cct={fixture.cct}
              intensity={Math.max(45, fixture.intensity)}
              on={fixture.on || visual.output.beamType === "none"}
              renderMode={renderMode}
              visual={visual}
            />
          </svg>
          <span className={styles.count}>{count}</span>
          <span className={styles.name}>{visual.displayName}</span>
          <span className={styles.meta}>{visual.modeFootprint}</span>
          {visual.beamSummary ? <span className={styles.meta}>{visual.beamSummary}</span> : null}
          <span className={styles.confidence}>{visual.confidenceLabel}</span>
        </div>
      ))}
    </aside>
  );
}
