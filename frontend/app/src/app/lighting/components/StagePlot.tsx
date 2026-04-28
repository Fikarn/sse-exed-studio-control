import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { deriveMounting } from "../fixtureMounting";
import { lightingFixtureBeamLength, lightingFixtureBeamWidth } from "../lightingHelpers";
import { STUDIO_LAYOUT, type StudioLayout } from "../studioLayout";

import { FixtureMarker } from "./FixtureMarker";
import { LightPool } from "./LightPool";
import { PatchAddressTag } from "./PatchAddressTag";
import { PatchOverlay } from "./PatchOverlay";
import { StagePlotGrid } from "./StagePlotGrid";
import { StudioFloor } from "./StudioFloor";

import styles from "./StagePlot.module.css";

export interface StagePlotProps {
  fixtures: readonly LightingFixtureSnapshot[];
  layout?: StudioLayout;
  selectedFixtureId: string | null;
  patchMode: boolean;
  activeSceneName?: string;
  isSceneModified?: boolean;
  onSelectFixture: (id: string | null) => void;
}

const FALLBACK_X_STEP = 1.5;
const FALLBACK_Y = 4.0;

function meterPositionFor(fixture: LightingFixtureSnapshot, index: number) {
  const x = fixture.spatialX ?? Math.min(11, FALLBACK_X_STEP * (index + 1));
  const y = fixture.spatialY ?? FALLBACK_Y;
  return { xMeters: x, yMeters: y };
}

export function StagePlot({
  fixtures,
  layout = STUDIO_LAYOUT,
  selectedFixtureId,
  patchMode,
  activeSceneName,
  isSceneModified = false,
  onSelectFixture,
}: StagePlotProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;

  const selectedFixture = selectedFixtureId
    ? (fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null)
    : null;

  return (
    <div
      className={`${styles.plotShell} ${patchMode ? styles.plotShellPatch : ""}`}
      role="application"
      aria-label="Lighting stage plot"
    >
      {!patchMode && activeSceneName ? (
        <div className={`${styles.plotPill} ${isSceneModified ? styles.plotPillModified : ""}`}>
          <span className={styles.plotPillDot} aria-hidden="true" />
          <span className={styles.plotPillLabel}>Active scene</span>
          <span className={styles.plotPillName}>{activeSceneName}</span>
          {isSceneModified ? <span className={styles.plotPillMod}>· Modified</span> : null}
        </div>
      ) : null}

      <div className={styles.plotOverlays} aria-hidden="true">
        {selectedFixture ? (
          <div className={`${styles.plotMeta} ${styles.plotMetaSelected}`}>
            <span className={styles.plotMetaLabel}>Selected</span>
            <span className={styles.plotMetaValue}>{selectedFixture.name}</span>
          </div>
        ) : null}
        <div className={styles.plotMeta}>
          <span className={styles.plotMetaLabel}>Floor</span>
          <span className={styles.plotMetaValue}>
            {layout.roomWidthMeters} m × {layout.roomDepthMeters} m
          </span>
        </div>
        <div className={styles.plotMeta}>
          <span className={styles.plotMetaLabel}>Grid</span>
          <span className={styles.plotMetaValue}>0.5 / 1 / 5 m</span>
        </div>
      </div>

      <svg
        className={styles.plotSvg}
        viewBox={`0 0 ${widthCm} ${depthCm}`}
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        onClick={() => onSelectFixture(null)}
      >
        <StudioFloor layout={layout} />
        <StagePlotGrid layout={layout} />

        {/* Beam pools (under markers so markers stay legible) */}
        {fixtures.map((fixture, index) => {
          const { xMeters, yMeters } = meterPositionFor(fixture, index);
          const beamWidth = lightingFixtureBeamWidth(fixture.beamAngleDegrees ?? 50, fixture.rigZ ?? 3);
          const radius = Math.max(40, beamWidth * 50);
          return (
            <LightPool
              key={`pool-${fixture.id}`}
              id={fixture.id}
              centerX={xMeters * 100}
              centerY={yMeters * 100}
              radius={radius}
              intensity={fixture.intensity}
              cct={fixture.cct}
              on={fixture.on}
            />
          );
        })}

        {/* Beam length indicator (vertical line forward from rig point) */}
        {fixtures.map((fixture, index) => {
          if (!fixture.on) return null;
          const { xMeters, yMeters } = meterPositionFor(fixture, index);
          const length = lightingFixtureBeamLength(fixture.kind ?? fixture.type) * 100;
          return (
            <line
              key={`beam-${fixture.id}`}
              x1={xMeters * 100}
              y1={yMeters * 100}
              x2={xMeters * 100}
              y2={yMeters * 100 + length}
              stroke="rgba(212, 205, 179, 0.18)"
              strokeWidth={0.6}
              strokeDasharray="4 4"
            />
          );
        })}

        {/* Fixture markers */}
        {fixtures.map((fixture, index) => {
          const { xMeters, yMeters } = meterPositionFor(fixture, index);
          return (
            <FixtureMarker
              key={fixture.id}
              id={fixture.id}
              name={fixture.name}
              centerX={xMeters * 100}
              centerY={yMeters * 100}
              rotationDegrees={fixture.spatialRotation}
              mounting={deriveMounting(fixture.type)}
              intensity={fixture.intensity}
              cct={fixture.cct}
              on={fixture.on}
              selected={fixture.id === selectedFixtureId}
              onSelect={onSelectFixture}
            />
          );
        })}

        {/* Patch overlay — DMX address tags above each fixture */}
        <PatchOverlay active={patchMode}>
          {fixtures.map((fixture, index) => {
            const { xMeters, yMeters } = meterPositionFor(fixture, index);
            return (
              <PatchAddressTag
                key={`addr-${fixture.id}`}
                centerX={xMeters * 100}
                centerY={yMeters * 100}
                dmxStartAddress={fixture.dmxStartAddress}
              />
            );
          })}
        </PatchOverlay>
      </svg>
    </div>
  );
}
