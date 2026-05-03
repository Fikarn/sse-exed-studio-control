import { useCallback, useMemo, useState } from "react";
import { Plus, Sun } from "lucide-react";

import { EmptyState, PlotMeta, PlotPill } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

import { deriveMounting } from "../fixtureMounting";
import { lightingFixtureBeamLength, lightingFixtureBeamWidth } from "../lightingHelpers";
import { STUDIO_LAYOUT, type StudioLayout } from "../studioLayout";
import { useMarqueeSelection } from "../useMarqueeSelection";
import type { StagePlotViewport } from "../useStagePlotViewport";

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
  previewMode?: boolean;
  liveFixtures?: readonly LightingFixtureSnapshot[];
  activeSceneName?: string;
  isSceneModified?: boolean;
  /**
   * When false, the plot's "modified" treatment is downgraded to neutral —
   * drift detection in degraded states compares live state to a preview-only
   * recall, not a scene actually driving the rig.
   */
  bridgeReachable?: boolean;
  searchQuery?: string;
  /** Fixture ids currently mid-identify-burst — markers animate a pulse ring. */
  identifyingFixtureIds?: ReadonlySet<string>;
  /** Fixture ids the operator has placed under Highlight or Solo overlay —
   *  markers render a sustained orange ring so the selection is unambiguous
   *  even when the engine snapshot's intensity overlay coincidentally matches
   *  another fixture's stored values. */
  highlightOverlayFixtureIds?: ReadonlySet<string>;
  onSelectFixture: (id: string | null, options?: { additive?: boolean }) => void;
  onPositionCommit?: (fixtureId: string, xMeters: number, yMeters: number) => void;
  /** Right-click "Rename" — selects the fixture for inspection and triggers
   *  the inspector's inline rename. */
  onRequestRenameFixture?: (id: string) => void;
  /** Right-click "Identify" — fires an identify burst on the fixture. */
  onIdentifyFixture?: (id: string, name: string) => void;
  /** Right-click "Delete" — parent shows the confirm dialog. */
  onRequestDeleteFixture?: (id: string, name: string) => void;
  /** Marquee result — fixture ids inside the released selection rectangle.
   *  When `additive`, the parent merges with the existing multi-select. */
  onMarqueeSelect?: (fixtureIds: readonly string[], options: { additive: boolean }) => void;
  /** F10 — empty-state CTA. When provided and `fixtures.length === 0`, the
   *  empty state renders a primary "Add fixture" button that fires this. */
  onAddFixture?: () => void;
  /** Wave 31 — viewport hook lifted to the workspace so keyboard shortcuts
   *  can reach the bookmark API. Required. */
  viewport: StagePlotViewport;
  /** Wave 31 — I9 chip-hover signal. When set, the matching marker
   *  renders a soft pulse so the chip ↔ marker pairing reads at a
   *  glance. Null when no chip is hovered. */
  chipHoverFixtureId?: string | null;
}

const FALLBACK_X_STEP = 1.5;
const FALLBACK_Y = 4.0;
const PLOT_TOP_GUTTER_CM = 56;

function meterPositionFor(fixture: LightingFixtureSnapshot, index: number) {
  const x = fixture.spatialX ?? Math.min(11, FALLBACK_X_STEP * (index + 1));
  const y = fixture.spatialY ?? FALLBACK_Y;
  return { xMeters: x, yMeters: y };
}

function previewDiffersFromLive(preview: LightingFixtureSnapshot, live: LightingFixtureSnapshot | null): boolean {
  if (!live) return false;
  if (preview.on !== live.on) return true;
  if (Math.abs(preview.intensity - live.intensity) > 0.5) return true;
  if (Math.abs(preview.cct - live.cct) > 25) return true;
  return false;
}

export function StagePlot({
  fixtures,
  layout = STUDIO_LAYOUT,
  selectedFixtureId,
  selectedFixtureIds,
  patchMode,
  previewMode = false,
  liveFixtures = [],
  activeSceneName,
  isSceneModified = false,
  bridgeReachable = true,
  searchQuery = "",
  identifyingFixtureIds,
  highlightOverlayFixtureIds,
  onSelectFixture,
  onPositionCommit,
  onRequestRenameFixture,
  onIdentifyFixture,
  onRequestDeleteFixture,
  onMarqueeSelect,
  onAddFixture,
  viewport,
  chipHoverFixtureId,
}: StagePlotProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;

  // F9 — track in-flight fixture-drag state so we can render alignment
  // guides against other fixtures' axes. Driven by FixtureMarker's
  // onDragMove / onDragEnd callbacks. Cleared on commit / cancel.
  const [dragState, setDragState] = useState<{
    id: string;
    xMeters: number;
    yMeters: number;
    altKey: boolean;
  } | null>(null);
  const handleFixtureDragMove = useCallback((id: string, xMeters: number, yMeters: number, altKey: boolean) => {
    setDragState({ id, xMeters, yMeters, altKey });
  }, []);
  const handleFixtureDragEnd = useCallback((_id: string) => {
    setDragState(null);
  }, []);

  // F2 — marquee selection on plain left-drag. Pan is now middle-mouse only.
  // Hit-test resolves on pointerup against the current fixture positions.
  const marquee = useMarqueeSelection({
    svgRef: viewport.svgRef,
    onCommit: (ids, options) => {
      onMarqueeSelect?.(ids, options);
    },
    onBackgroundClick: () => onSelectFixture(null),
    resolveTargets: () =>
      fixtures.map((fixture, index) => {
        const { xMeters, yMeters } = meterPositionFor(fixture, index);
        return { id: fixture.id, xCm: xMeters * 100, yCm: yMeters * 100 };
      }),
  });

  // F9 — alignment guide derivation. When a drag is in progress and the
  // user isn't holding Alt (free-positioning), surface horizontal +
  // vertical lines through any other fixture whose axis falls within 0.1 m
  // of the dragged fixture. The guides are advisory; the snap-to-0.5 m
  // semantic in FixtureMarker.finishDrag still wins on commit.
  const alignmentGuides = useMemo(() => {
    if (!dragState || dragState.altKey) return { vertical: [], horizontal: [] };
    const verticalSet = new Set<number>();
    const horizontalSet = new Set<number>();
    for (let i = 0; i < fixtures.length; i += 1) {
      const fixture = fixtures[i]!;
      if (fixture.id === dragState.id) continue;
      const { xMeters, yMeters } = meterPositionFor(fixture, i);
      if (Math.abs(xMeters - dragState.xMeters) < 0.1) verticalSet.add(xMeters);
      if (Math.abs(yMeters - dragState.yMeters) < 0.1) horizontalSet.add(yMeters);
    }
    return {
      vertical: Array.from(verticalSet),
      horizontal: Array.from(horizontalSet),
    };
  }, [dragState, fixtures]);

  const needle = searchQuery.trim().toLowerCase();
  const fixtureMatches = (fixture: LightingFixtureSnapshot) =>
    !needle || fixture.name.toLowerCase().includes(needle) || fixture.type.toLowerCase().includes(needle);

  const selectedFixture = selectedFixtureId
    ? (fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null)
    : null;
  const orderedFixtures = selectedFixture
    ? [...fixtures.filter((fixture) => fixture.id !== selectedFixture.id), selectedFixture]
    : fixtures;

  return (
    <div
      className={`${styles.plotShell} ${patchMode ? styles.plotShellPatch : ""} ${previewMode ? styles.plotShellPreview : ""}`}
      role="application"
      aria-label="Lighting stage plot"
    >
      <div className={styles.srOnly}>
        Stage plot. Use Tab to focus a fixture, then arrow keys to nudge its position. Hold Shift for 0.5 m steps.
      </div>
      <div className={styles.plotToneOverlay} aria-hidden="true" />
      {!patchMode && activeSceneName ? (
        <div className={styles.plotPillSlot}>
          <PlotPill
            state={
              previewMode
                ? isSceneModified
                  ? "modified"
                  : "patch"
                : isSceneModified && bridgeReachable
                  ? "modified"
                  : "default"
            }
          >
            <span className={styles.plotPillLabel}>
              {previewMode
                ? isSceneModified
                  ? "Preview · offline edits"
                  : "Preview"
                : isSceneModified && bridgeReachable
                  ? "Active scene · modified"
                  : "Active scene"}
            </span>
            <span className={styles.plotPillName}>{activeSceneName}</span>
          </PlotPill>
        </div>
      ) : null}

      <div className={styles.plotOverlaysSlot} role="region" aria-label="Stage plot context">
        {selectedFixture ? <PlotMeta label="Selected" value={selectedFixture.name} tone="blue" /> : null}
        <PlotMeta label="Floor" value={`${layout.roomWidthMeters} m × ${layout.roomDepthMeters} m`} />
        <PlotMeta label="Grid" value="0.5 / 1 / 5 m" />
      </div>

      <svg
        ref={viewport.svgRef}
        className={`${styles.plotSvg} ${viewport.isPanning ? styles.plotSvgPanning : ""} ${marquee.rect ? styles.plotSvgMarqueeing : ""}`}
        viewBox={`0 -${PLOT_TOP_GUTTER_CM} ${widthCm} ${depthCm + PLOT_TOP_GUTTER_CM}`}
        // Fill the container instead of letterboxing. The top gutter keeps
        // fixture labels and marker rings out from under the fixed chrome
        // while preserving a full-room glanceable plot.
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        onPointerDown={(event) => {
          // Route by mouse button: middle (1) drives pan, left (0) drives
          // marquee selection. Both hooks no-op for the other button so
          // co-binding is safe.
          viewport.onPointerDown(event);
          marquee.onPointerDown(event);
        }}
        onPointerMove={(event) => {
          viewport.onPointerMove(event);
          marquee.onPointerMove(event);
        }}
        onPointerUp={(event) => {
          viewport.onPointerUp(event);
          marquee.onPointerUp(event);
        }}
        onPointerCancel={(event) => {
          viewport.onPointerUp(event);
          marquee.onPointerUp(event);
        }}
        onWheel={viewport.onWheel}
        onDoubleClick={viewport.reset}
      >
        <g data-inner-content="true" transform={viewport.transform}>
          <defs>
            <filter id="sse-fixture-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" />
              <feOffset dx="0" dy="1" result="offsetblur" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.45" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
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
              <g key={`beam-${fixture.id}`}>
                <defs>
                  <linearGradient
                    id={`beam-grad-${fixture.id}`}
                    x1={xMeters * 100}
                    y1={yMeters * 100}
                    x2={xMeters * 100}
                    y2={yMeters * 100 + length}
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" style={{ stopColor: "var(--color-stage-beam-line)", stopOpacity: 0.6 }} />
                    <stop offset="100%" style={{ stopColor: "var(--color-stage-beam-line)", stopOpacity: 0 }} />
                  </linearGradient>
                </defs>
                <line
                  x1={xMeters * 100}
                  y1={yMeters * 100}
                  x2={xMeters * 100}
                  y2={yMeters * 100 + length}
                  stroke={`url(#beam-grad-${fixture.id})`}
                  strokeWidth={1}
                />
              </g>
            );
          })}

          {previewMode ? (
            <g className={styles.liveGhostLayer} pointerEvents="none" aria-hidden="true">
              {liveFixtures.map((liveFixture, index) => {
                const previewFixture = fixtures.find((fixture) => fixture.id === liveFixture.id) ?? null;
                if (!previewFixture || !previewDiffersFromLive(previewFixture, liveFixture)) return null;
                const { xMeters, yMeters } = meterPositionFor(liveFixture, index);
                const mounting = deriveMounting(liveFixture.type);
                if (mounting === "wall-bar") {
                  return (
                    <rect
                      key={`live-ghost-${liveFixture.id}`}
                      x={xMeters * 100 - 18}
                      y={yMeters * 100 - 5}
                      width={36}
                      height={10}
                      rx={3}
                      className={styles.liveGhostShape}
                      transform={`rotate(${liveFixture.spatialRotation ?? 0} ${xMeters * 100} ${yMeters * 100})`}
                    />
                  );
                }
                return (
                  <circle
                    key={`live-ghost-${liveFixture.id}`}
                    cx={xMeters * 100}
                    cy={yMeters * 100}
                    r={mounting === "grid-soft" ? 15 : 12}
                    className={styles.liveGhostShape}
                  />
                );
              })}
            </g>
          ) : null}

          {/* Fixture markers — reorder so the selected fixture paints last
              (above its siblings), giving the in-flight drag a clear z-stack
              without interfering with React reconciliation (key-stable). */}
          {orderedFixtures.map((fixture) => {
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
                identifying={identifyingFixtureIds?.has(fixture.id) ?? false}
                highlightOverlay={highlightOverlayFixtureIds?.has(fixture.id) ?? false}
                chipHovered={chipHoverFixtureId === fixture.id}
                onSelect={(id, options) => onSelectFixture(id, options)}
                onPositionCommit={onPositionCommit}
                onRequestRename={onRequestRenameFixture}
                onIdentify={onIdentifyFixture}
                onRequestDelete={onRequestDeleteFixture}
                onDragMove={handleFixtureDragMove}
                onDragEnd={handleFixtureDragEnd}
              />
            );
          })}

          {/* F9 — smart-guide alignment lines. Only render when a fixture
              drag is in progress and Alt isn't held. Stroke is non-scaling
              so the guides remain crisp under any zoom level. */}
          {dragState && !dragState.altKey ? (
            <g pointerEvents="none">
              {alignmentGuides.vertical.map((xMeters) => (
                <line
                  key={`vguide-${xMeters}`}
                  x1={xMeters * 100}
                  y1={0}
                  x2={xMeters * 100}
                  y2={depthCm}
                  style={{ stroke: "var(--color-brand-green)", strokeDasharray: "3 3", opacity: 0.65 }}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {alignmentGuides.horizontal.map((yMeters) => (
                <line
                  key={`hguide-${yMeters}`}
                  x1={0}
                  y1={yMeters * 100}
                  x2={widthCm}
                  y2={yMeters * 100}
                  style={{ stroke: "var(--color-brand-green)", strokeDasharray: "3 3", opacity: 0.65 }}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ) : null}

          {/* F2 — marquee selection rectangle. Rendered inside the inner
              transformed group so the rect coordinates stay aligned with
              the fixture markers under zoom/pan. */}
          {marquee.rect ? (
            <rect
              pointerEvents="none"
              x={marquee.rect.x}
              y={marquee.rect.y}
              width={marquee.rect.width}
              height={marquee.rect.height}
              rx={2}
              style={{
                fill: marquee.additive ? "var(--color-brand-green-glow)" : "var(--color-brand-green-soft)",
                stroke: "var(--color-brand-green)",
                strokeDasharray: "4 3",
                opacity: 0.5,
              }}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

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
        viewBookmarks={viewport.viewBookmarks}
        onSaveViewBookmark={viewport.saveViewBookmark}
        onRecallViewBookmark={viewport.recallViewBookmark}
        onClearViewBookmark={viewport.clearViewBookmark}
      />

      {fixtures.length === 0 ? (
        <div className={styles.plotEmpty}>
          <EmptyState
            icon={Sun}
            title="No fixtures on the rig yet"
            message="Add your first fixture with the Add fixture button in the toolbar to start patching DMX addresses and saving scenes."
            action={onAddFixture ? { label: "Add fixture", onClick: onAddFixture, icon: Plus } : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
