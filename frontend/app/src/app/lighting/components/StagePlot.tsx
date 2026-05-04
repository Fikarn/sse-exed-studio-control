import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Plus, Sun } from "lucide-react";

import { EmptyState, PlotMeta, PlotPill } from "@sse/design-system";
import type { LightingFixtureCatalogSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import { deriveMounting } from "../fixtureMounting";
import { getFixtureVisualModel, type StagePlotRenderMode } from "../fixtureVisuals";
import { STUDIO_LAYOUT, type StudioLayout } from "../studioLayout";
import { useMarqueeSelection } from "../useMarqueeSelection";
import type { StagePlotViewport } from "../useStagePlotViewport";

import { FixtureOutputFootprint } from "./FixtureOutputFootprint";
import { FixtureMarker } from "./FixtureMarker";
import { FixtureSymbolKey } from "./FixtureSymbolKey";
import { PatchAddressTag } from "./PatchAddressTag";
import { PatchOverlay } from "./PatchOverlay";
import { StagePlotControls } from "./StagePlotControls";
import { StagePlotGrid } from "./StagePlotGrid";
import { StudioFloor } from "./StudioFloor";
import { TalentMarkMarker } from "./TalentMarkMarker";

import styles from "./StagePlot.module.css";

export interface StagePlotProps {
  fixtures: readonly LightingFixtureSnapshot[];
  catalog?: LightingFixtureCatalogSnapshot | null;
  layout?: StudioLayout;
  selectedFixtureId: string | null;
  /** Frontend-only multi-select. Includes selectedFixtureId when present. */
  selectedFixtureIds?: ReadonlySet<string>;
  patchMode: boolean;
  previewMode?: boolean;
  liveFixtures?: readonly LightingFixtureSnapshot[];
  activeSceneName?: string;
  isSceneModified?: boolean;
  renderMode: StagePlotRenderMode;
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
  onRotationCommit?: (fixtureId: string, rotationDegrees: number) => void;
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
  onTalentMarkPositionCommit?: (id: string, xMeters: number, yMeters: number) => void;
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
  onRenderModeChange: (mode: StagePlotRenderMode) => void;
}

const FALLBACK_X_STEP = 1.5;
const FALLBACK_Y = 4.0;
const PLOT_TOP_GUTTER_CM = 56;
const POSITION_MATCH_EPSILON_METERS = 0.01;
const ROTATION_MATCH_EPSILON_DEGREES = 0.5;
const COMMIT_PREVIEW_TIMEOUT_MS = 1800;

interface PlotPosition {
  xMeters: number;
  yMeters: number;
}

interface TransientFixturePosition extends PlotPosition {
  altKey: boolean;
  id: string;
  phase: "dragging" | "committing";
}

interface TransientFixtureRotation {
  id: string;
  phase: "dragging" | "committing";
  rotationDegrees: number;
}

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

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function rotationDistanceDegrees(a: number, b: number): number {
  const delta = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(delta, 360 - delta);
}

export function StagePlot({
  fixtures,
  catalog = null,
  layout = STUDIO_LAYOUT,
  selectedFixtureId,
  selectedFixtureIds,
  patchMode,
  previewMode = false,
  liveFixtures = [],
  activeSceneName,
  isSceneModified = false,
  renderMode,
  bridgeReachable = true,
  searchQuery = "",
  identifyingFixtureIds,
  highlightOverlayFixtureIds,
  onSelectFixture,
  onPositionCommit,
  onRotationCommit,
  onRequestRenameFixture,
  onIdentifyFixture,
  onRequestDeleteFixture,
  onMarqueeSelect,
  onTalentMarkPositionCommit,
  onAddFixture,
  viewport,
  chipHoverFixtureId,
  onRenderModeChange,
}: StagePlotProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;
  const floorClipId = `stage-floor-clip-${useId().replace(/:/g, "")}`;

  // Track the fixture position while a drag is in flight, then hold the
  // snapped drop position until the engine snapshot refresh lands. This keeps
  // marker + output movement visually continuous across the IPC round trip.
  const [transientPosition, setTransientPosition] = useState<TransientFixturePosition | null>(null);
  const [transientRotation, setTransientRotation] = useState<TransientFixtureRotation | null>(null);
  const dragState = transientPosition?.phase === "dragging" ? transientPosition : null;
  const handleFixtureDragMove = useCallback((id: string, xMeters: number, yMeters: number, altKey: boolean) => {
    setTransientPosition({ altKey, id, phase: "dragging", xMeters, yMeters });
  }, []);
  const handleFixtureDragEnd = useCallback((id: string, committedPosition: PlotPosition | null) => {
    if (!committedPosition) {
      setTransientPosition((current) => (current?.id === id ? null : current));
      return;
    }
    setTransientPosition({ altKey: false, id, phase: "committing", ...committedPosition });
  }, []);
  const handleFixtureRotationMove = useCallback((id: string, rotationDegrees: number) => {
    setTransientRotation({ id, phase: "dragging", rotationDegrees });
  }, []);
  const handleFixtureRotationEnd = useCallback((id: string, committedRotationDegrees: number | null) => {
    if (committedRotationDegrees === null) {
      setTransientRotation((current) => (current?.id === id ? null : current));
      return;
    }
    setTransientRotation({ id, phase: "committing", rotationDegrees: committedRotationDegrees });
  }, []);

  useEffect(() => {
    if (!transientPosition || transientPosition.phase !== "committing") return undefined;
    const fixtureIndex = fixtures.findIndex((fixture) => fixture.id === transientPosition.id);
    if (fixtureIndex < 0) {
      setTransientPosition(null);
      return undefined;
    }

    const snapshotPosition = meterPositionFor(fixtures[fixtureIndex]!, fixtureIndex);
    const snapshotMatches =
      Math.abs(snapshotPosition.xMeters - transientPosition.xMeters) <= POSITION_MATCH_EPSILON_METERS &&
      Math.abs(snapshotPosition.yMeters - transientPosition.yMeters) <= POSITION_MATCH_EPSILON_METERS;
    if (snapshotMatches) {
      setTransientPosition(null);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setTransientPosition((current) =>
        current?.phase === "committing" && current.id === transientPosition.id ? null : current
      );
    }, COMMIT_PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [fixtures, transientPosition]);

  useEffect(() => {
    if (!transientRotation || transientRotation.phase !== "committing") return undefined;
    const fixture = fixtures.find((candidate) => candidate.id === transientRotation.id);
    if (!fixture) {
      setTransientRotation(null);
      return undefined;
    }

    if (
      rotationDistanceDegrees(fixture.spatialRotation ?? 0, transientRotation.rotationDegrees) <=
      ROTATION_MATCH_EPSILON_DEGREES
    ) {
      setTransientRotation(null);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setTransientRotation((current) =>
        current?.phase === "committing" && current.id === transientRotation.id ? null : current
      );
    }, COMMIT_PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [fixtures, transientRotation]);

  const displayedPositionFor = useCallback(
    (fixture: LightingFixtureSnapshot, index: number, includeDragging: boolean): PlotPosition => {
      if (transientPosition?.id === fixture.id && (transientPosition.phase === "committing" || includeDragging)) {
        return { xMeters: transientPosition.xMeters, yMeters: transientPosition.yMeters };
      }
      return meterPositionFor(fixture, index);
    },
    [transientPosition]
  );

  const displayedRotationFor = useCallback(
    (fixture: LightingFixtureSnapshot, includeDragging: boolean): number => {
      if (transientRotation?.id === fixture.id && (transientRotation.phase === "committing" || includeDragging)) {
        return transientRotation.rotationDegrees;
      }
      return fixture.spatialRotation ?? 0;
    },
    [transientRotation]
  );

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
        const { xMeters, yMeters } = displayedPositionFor(fixture, index, false);
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
  const fixtureVisuals = useMemo(() => {
    const visualMap = new Map<string, ReturnType<typeof getFixtureVisualModel>>();
    for (const fixture of fixtures) {
      visualMap.set(fixture.id, getFixtureVisualModel(catalog, fixture));
    }
    return visualMap;
  }, [catalog, fixtures]);

  return (
    <div
      className={`${styles.plotShell} ${patchMode ? styles.plotShellPatch : ""} ${previewMode ? styles.plotShellPreview : ""}`}
      data-render-mode={renderMode}
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
        // Fill Desk preserves the current operator-familiar stretched plot.
        // Fit Room / 100% use SVG meet scaling so spatial proportions remain
        // accurate in compact utility windows.
        preserveAspectRatio={viewport.zoomMode === "fillDesk" ? "none" : "xMidYMid meet"}
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
            <clipPath id={floorClipId} clipPathUnits="userSpaceOnUse">
              <rect x={0} y={0} width={widthCm} height={depthCm} />
            </clipPath>
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

          {/* Output footprints sit under markers so marker identity and selection remain legible. */}
          <g clipPath={`url(#${floorClipId})`} data-testid="fixture-output-layer">
            {fixtures.map((fixture, index) => {
              const { xMeters, yMeters } = displayedPositionFor(fixture, index, true);
              const visual = fixtureVisuals.get(fixture.id) ?? getFixtureVisualModel(catalog, fixture);
              return (
                <FixtureOutputFootprint
                  key={`output-${fixture.id}`}
                  fixtureId={fixture.id}
                  centerX={xMeters * 100}
                  centerY={yMeters * 100}
                  rotationDegrees={displayedRotationFor(fixture, true)}
                  rigHeightMeters={fixture.rigZ}
                  beamAngle={visual.output.beamAngle}
                  fieldAngle={visual.output.fieldAngle}
                  intensity={fixture.intensity}
                  cct={fixture.cct}
                  on={fixture.on}
                  visual={visual}
                  renderMode={renderMode}
                />
              );
            })}
          </g>

          <g aria-label="Talent marks" role="group">
            {layout.talentMarks.map((mark) => (
              <TalentMarkMarker
                key={mark.id}
                mark={mark}
                widthCm={widthCm}
                depthCm={depthCm}
                onPositionCommit={onTalentMarkPositionCommit}
              />
            ))}
          </g>

          {previewMode ? (
            <g className={styles.liveGhostLayer} pointerEvents="none" aria-hidden="true">
              {liveFixtures.map((liveFixture, index) => {
                const previewFixture = fixtures.find((fixture) => fixture.id === liveFixture.id) ?? null;
                if (!previewFixture || !previewDiffersFromLive(previewFixture, liveFixture)) return null;
                const { xMeters, yMeters } = meterPositionFor(liveFixture, index);
                const mounting = deriveMounting(liveFixture, catalog);
                if (mounting === "bar") {
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
                    r={mounting === "mat" ? 15 : 12}
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
            const { xMeters, yMeters } = displayedPositionFor(fixture, originalIndex, false);
            const visual = fixtureVisuals.get(fixture.id) ?? getFixtureVisualModel(catalog, fixture);
            return (
              <FixtureMarker
                key={fixture.id}
                id={fixture.id}
                name={fixture.name}
                centerX={xMeters * 100}
                centerY={yMeters * 100}
                rotationDegrees={displayedRotationFor(fixture, false)}
                mounting={visual.mounting}
                renderMode={renderMode}
                visual={visual}
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
                onRotationCommit={onRotationCommit}
                onRequestRename={onRequestRenameFixture}
                onIdentify={onIdentifyFixture}
                onRequestDelete={onRequestDeleteFixture}
                onDragMove={handleFixtureDragMove}
                onDragEnd={handleFixtureDragEnd}
                onRotationMove={handleFixtureRotationMove}
                onRotationEnd={handleFixtureRotationEnd}
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
              const { xMeters, yMeters } = displayedPositionFor(fixture, index, true);
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

      <FixtureSymbolKey catalog={catalog} fixtures={fixtures} renderMode={renderMode} />

      <StagePlotControls
        zoom={viewport.zoom}
        zoomMode={viewport.zoomMode}
        renderMode={renderMode}
        onZoomIn={viewport.zoomIn}
        onZoomOut={viewport.zoomOut}
        onReset={viewport.reset}
        onFitRoom={viewport.fitRoom}
        onFillDesk={viewport.fillDesk}
        onActualSize={viewport.actualSize}
        onRenderModeChange={onRenderModeChange}
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
