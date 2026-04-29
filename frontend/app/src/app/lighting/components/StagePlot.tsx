import { Sun } from "lucide-react";

import { EmptyState } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { deriveMounting } from "../fixtureMounting";
import { lightingFixtureBeamLength, lightingFixtureBeamWidth } from "../lightingHelpers";
import { STUDIO_LAYOUT, type StudioLayout } from "../studioLayout";
import { useStagePlotViewport } from "../useStagePlotViewport";

import { FixtureMarker } from "./FixtureMarker";
import { LightPool } from "./LightPool";
import { PatchAddressTag } from "./PatchAddressTag";
import { PatchOverlay } from "./PatchOverlay";
import { StagePlotControls } from "./StagePlotControls";
import { StagePlotGrid } from "./StagePlotGrid";
import { StudioFloor } from "./StudioFloor";

import styles from "./StagePlot.module.css";

export interface StagePlotProps {
  fixtures: readonly LightingFixtureSnapshot[];
  layout?: StudioLayout;
  selectedFixtureId: string | null;
  /** Frontend-only multi-select. Includes selectedFixtureId when present. */
  selectedFixtureIds?: ReadonlySet<string>;
  patchMode: boolean;
  activeSceneName?: string;
  isSceneModified?: boolean;
  /**
   * When false, the plot's "modified" treatment is downgraded to neutral —
   * drift detection in degraded states compares live state to a preview-only
   * recall, not a scene actually driving the rig.
   */
  bridgeReachable?: boolean;
  searchQuery?: string;
  onSelectFixture: (id: string | null, options?: { additive?: boolean }) => void;
  onPositionCommit?: (fixtureId: string, xMeters: number, yMeters: number) => void;
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
  selectedFixtureIds,
  patchMode,
  activeSceneName,
  isSceneModified = false,
  bridgeReachable = true,
  searchQuery = "",
  onSelectFixture,
  onPositionCommit,
}: StagePlotProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;

  const viewport = useStagePlotViewport({
    onBackgroundClick: () => onSelectFixture(null),
  });

  const needle = searchQuery.trim().toLowerCase();
  const fixtureMatches = (fixture: LightingFixtureSnapshot) =>
    !needle || fixture.name.toLowerCase().includes(needle) || fixture.type.toLowerCase().includes(needle);

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
        <div className={`${styles.plotPill} ${isSceneModified && bridgeReachable ? styles.plotPillModified : ""}`}>
          <span className={styles.plotPillDot} aria-hidden="true" />
          <span className={styles.plotPillLabel}>Active scene</span>
          <span className={styles.plotPillName}>{activeSceneName}</span>
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
        ref={viewport.svgRef}
        className={`${styles.plotSvg} ${viewport.isPanning ? styles.plotSvgPanning : ""}`}
        viewBox={`0 0 ${widthCm} ${depthCm}`}
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        onPointerDown={viewport.onPointerDown}
        onPointerMove={viewport.onPointerMove}
        onPointerUp={viewport.onPointerUp}
        onPointerCancel={viewport.onPointerUp}
        onWheel={viewport.onWheel}
        onDoubleClick={viewport.reset}
      >
        <g transform={viewport.transform}>
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
                strokeWidth={0.6}
                strokeDasharray="4 4"
                style={{ stroke: "var(--color-stage-beam-line)" }}
              />
            );
          })}

          {/* Fixture markers — reorder so the selected fixture paints last
              (above its siblings), giving the in-flight drag a clear z-stack
              without interfering with React reconciliation (key-stable). */}
          {(() => {
            const ordered =
              selectedFixtureId && fixtures.some((fixture) => fixture.id === selectedFixtureId)
                ? [
                    ...fixtures.filter((fixture) => fixture.id !== selectedFixtureId),
                    fixtures.find((fixture) => fixture.id === selectedFixtureId)!,
                  ]
                : fixtures;
            return ordered.map((fixture) => {
              const originalIndex = fixtures.indexOf(fixture);
              const { xMeters, yMeters } = meterPositionFor(fixture, originalIndex);
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
                  selected={selectedFixtureIds ? selectedFixtureIds.has(fixture.id) : fixture.id === selectedFixtureId}
                  dimmed={!fixtureMatches(fixture)}
                  onSelect={(id, options) => onSelectFixture(id, options)}
                  onPositionCommit={onPositionCommit}
                />
              );
            });
          })()}

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
        </g>
      </svg>

      <StagePlotControls
        zoom={viewport.zoom}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        onReset={viewport.reset}
      />

      {fixtures.length === 0 ? (
        <div className={styles.plotEmpty}>
          <EmptyState
            icon={Sun}
            title="No fixtures on the rig yet"
            message="Add your first fixture with the + Fixture button in the toolbar to start patching DMX addresses and saving scenes."
          />
        </div>
      ) : null}
    </div>
  );
}
