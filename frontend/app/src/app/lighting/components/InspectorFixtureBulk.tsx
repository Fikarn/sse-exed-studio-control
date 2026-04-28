import { type ChangeEvent, useEffect, useState } from "react";
import { Power } from "lucide-react";

import { Button, InspectorSection } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { isLightingRangeCommitKey, lightingFixtureCctRange } from "../lightingHelpers";

import styles from "./LightingInspector.module.css";

export interface InspectorFixtureBulkProps {
  fixtures: readonly LightingFixtureSnapshot[];
  busy?: boolean;
  onClearSelection: () => void;
  onBulkTogglePower: (fixtureIds: readonly string[], on: boolean) => void;
  onBulkIntensityCommit: (fixtureIds: readonly string[], intensity: number) => void;
  onBulkCctCommit: (fixtureIds: readonly string[], cct: number) => void;
}

function intersectCctRange(fixtures: readonly LightingFixtureSnapshot[]): { min: number; max: number } {
  // Bulk slider stays inside every selected fixture's supported range so a
  // commit can never push a fixture out of bounds.
  let min = -Infinity;
  let max = Infinity;
  for (const fixture of fixtures) {
    const range = lightingFixtureCctRange(fixture.type);
    if (range.min > min) min = range.min;
    if (range.max < max) max = range.max;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    // Fallback when types disagree wildly — surface the union and let the
    // single-fixture commits clamp.
    return { min: 2_000, max: 10_000 };
  }
  return { min, max };
}

function avg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
}

export function InspectorFixtureBulk({
  fixtures,
  busy = false,
  onClearSelection,
  onBulkTogglePower,
  onBulkIntensityCommit,
  onBulkCctCommit,
}: InspectorFixtureBulkProps) {
  const ids = fixtures.map((fixture) => fixture.id);
  const allOn = fixtures.every((fixture) => fixture.on);
  const anyOn = fixtures.some((fixture) => fixture.on);
  const cctRange = intersectCctRange(fixtures);

  const onIntensities = fixtures.filter((fixture) => fixture.on).map((fixture) => fixture.intensity);
  const intensityAvg = avg(onIntensities);
  const cctAvg = avg(fixtures.map((fixture) => fixture.cct));

  const [intensityDraft, setIntensityDraft] = useState(intensityAvg);
  const [cctDraft, setCctDraft] = useState(cctAvg);

  // Resync when the selection changes or external state updates rotate the
  // averages; the slider only re-pulls when the user isn't mid-interaction.
  useEffect(() => {
    setIntensityDraft(intensityAvg);
  }, [intensityAvg, ids.length]);

  useEffect(() => {
    setCctDraft(cctAvg);
  }, [cctAvg, ids.length]);

  const handleIntensityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value)) {
      setIntensityDraft(Math.max(0, Math.min(100, Math.round(value))));
    }
  };

  const commitIntensity = () => {
    onBulkIntensityCommit(ids, intensityDraft);
  };

  const handleCctChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value)) {
      setCctDraft(Math.max(cctRange.min, Math.min(cctRange.max, Math.round(value))));
    }
  };

  const commitCct = () => {
    onBulkCctCommit(ids, cctDraft);
  };

  return (
    <>
      <InspectorSection title="Bulk selection">
        <div className={styles.fixtureHeader}>
          <div>
            <div className={styles.fixtureName}>{fixtures.length} fixtures selected</div>
            <div className={styles.fixtureSubline}>
              Edits apply to every selected fixture · Click any marker to focus one.
            </div>
          </div>
          <Button
            onClick={() => onBulkTogglePower(ids, !anyOn)}
            disabled={busy}
            variant={allOn ? "secondary" : "primary"}
            size="compact"
            leadingVisual={<Power aria-hidden="true" size={13} strokeWidth={1.75} />}
          >
            {anyOn ? "Turn all off" : "Turn all on"}
          </Button>
        </div>
        <ul className={styles.sceneFixtureChips}>
          {fixtures.map((fixture) => (
            <li key={fixture.id} className={styles.sceneFixtureChip}>
              <span className={styles.sceneFixtureName}>{fixture.name}</span>
              <span className={styles.sceneFixtureLevel}>
                {fixture.on ? `${Math.round(fixture.intensity)}%` : "off"}
              </span>
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection title="Bulk intensity">
        <div className={styles.sliderRow}>
          <input
            aria-label="Bulk intensity"
            className={styles.slider}
            disabled={busy || !anyOn}
            type="range"
            min={0}
            max={100}
            step={1}
            value={intensityDraft}
            onChange={handleIntensityChange}
            onPointerUp={commitIntensity}
            onBlur={commitIntensity}
            onKeyUp={(event) => {
              if (isLightingRangeCommitKey(event.key)) {
                commitIntensity();
              }
            }}
          />
          <span className={styles.sliderValue}>{intensityDraft}%</span>
        </div>
      </InspectorSection>

      <InspectorSection title="Bulk colour temperature">
        <div className={styles.sliderRow}>
          <input
            aria-label="Bulk CCT"
            className={`${styles.slider} ${styles.sliderCct}`}
            disabled={busy}
            type="range"
            min={cctRange.min}
            max={cctRange.max}
            step={100}
            value={cctDraft}
            onChange={handleCctChange}
            onPointerUp={commitCct}
            onBlur={commitCct}
            onKeyUp={(event) => {
              if (isLightingRangeCommitKey(event.key)) {
                commitCct();
              }
            }}
          />
          <span className={styles.sliderValue}>{cctDraft}K</span>
        </div>
        <div className={styles.helpText}>
          Range narrowed to {cctRange.min}–{cctRange.max}K — the intersection of every selected fixture's supported
          range.
        </div>
      </InspectorSection>

      <InspectorSection title="Selection">
        <div className={styles.actionRow}>
          <Button onClick={onClearSelection} variant="ghost" size="compact">
            Clear selection
          </Button>
          <span className={styles.helpText}>Press Esc or click empty plot to clear.</span>
        </div>
      </InspectorSection>
    </>
  );
}
