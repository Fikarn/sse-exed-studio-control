import { useCallback, useEffect, useId, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import { Key, Tooltip } from "@sse/design-system";
import type { LightingFixtureCatalogSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import { deriveMounting } from "../fixtureMounting";
import { getFixtureVisualModel, type StagePlotRenderMode } from "../fixtureVisuals";
import { STUDIO_LAYOUT, type StudioLayout } from "../studioLayout";
import { useMarqueeSelection } from "../useMarqueeSelection";
import {
  computeContentFitTransform,
  type ContentBBox,
  type StagePlotFitTransform,
  type StagePlotViewport,
} from "../useStagePlotViewport";

import { FixtureOutputFootprint } from "./FixtureOutputFootprint";
import { FixtureMarker } from "./FixtureMarker";
import { FixtureSymbolKey } from "./FixtureSymbolKey";
import { StagePlotGrid } from "./StagePlotGrid";
import { PlotRuler, StagePlotLabels, usePlotProjection, type PlotLabel } from "./StagePlotOverlay";
import { StudioFloor } from "./StudioFloor";
import { TalentMarkMarker } from "./TalentMarkMarker";

import styles from "./StagePlot.module.css";

// The visual overhaul's Lighting page (2026-10-04): the plot is the room at
// its real metres, with a metre ruler along its top and its left edge, every
// fixture where the saved data puts it, and every name at 13 px in an overlay
// (with a leader where fixtures stand close). It never changes height: the
// keys that act on it are the bar under it (`StagePlotBar`), and its framing,
// its views, its render mode and its symbol key are in its menu (the bar's ⋯,
// or a right-click on its floor). Nothing floats in its corners any more.

/** The rulers' bands, in pixels. */
const RULER_TOP = 24;
const RULER_LEFT = 40;

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
  renderMode: StagePlotRenderMode;
  /** The symbol key over the floor's corner (the plot menu's "Symbol key"). */
  showSymbolKey?: boolean;
  searchQuery?: string;
  /** Fixture ids currently mid-identify-burst — markers animate a pulse ring. */
  identifyingFixtureIds?: ReadonlySet<string>;
  /** Fixture ids the operator has placed under Highlight or Solo overlay —
   *  markers render a sustained orange ring so the selection is unambiguous
   *  even when the engine snapshot's intensity overlay coincidentally matches
   *  another fixture's stored values. */
  highlightOverlayFixtureIds?: ReadonlySet<string>;
  /** New pages program, Slice 3 (decision 10): the toolbar's Add to selection
   *  key. While it is lit, a click (or Enter / Space) on a marker is additive —
   *  it adds the fixture to the selection or takes it out — and so is a box
   *  drag; a click on the empty plot clears the selection either way. */
  addToSelection?: boolean;
  onSelectFixture: (id: string | null, options?: { additive?: boolean }) => void;
  onPositionCommit?: (fixtureId: string, xMeters: number, yMeters: number) => void;
  onRotationCommit?: (fixtureId: string, rotationDegrees: number) => void;
  /** A right-click on a fixture: its menu at the pointer. */
  onOpenFixtureMenu?: (id: string, at: { x: number; y: number }) => void;
  /** A right-click on the floor: the plot's menu at the pointer. */
  onOpenPlotMenu?: (at: { x: number; y: number }) => void;
  /** Marquee result — fixture ids inside the released selection rectangle.
   *  When `additive` (Add to selection lit), the parent merges with the
   *  existing multi-select. */
  onMarqueeSelect?: (fixtureIds: readonly string[], options: { additive: boolean }) => void;
  onTalentMarkPositionCommit?: (id: string, xMeters: number, yMeters: number) => void;
  /** With no fixtures, the plot offers Add fixture. */
  onAddFixture?: () => void;
  /** The framing the plot menu's "Frame the rig" asks for, handed up so the
   *  menu and the double-click reach the same one. */
  onFitTargetChange?: (target: StagePlotFitTransform) => void;
  /** Wave 31 — viewport hook lifted to the workspace; the toolbar's view slots
   *  reach the bookmark API through it. Required. */
  viewport: StagePlotViewport;
  /** Wave 31 — I9 chip-hover signal. When set, the matching marker
   *  renders a soft pulse so the chip ↔ marker pairing reads at a
   *  glance. Null when no chip is hovered. */
  chipHoverFixtureId?: string | null;
}

const FALLBACK_X_STEP = 1.5;
const FALLBACK_Y = 4.0;
// DENSITY-04 — half-extent pads (cm) so markers/glyphs aren't clipped at the
// content-frame edge when fitContent computes the bounding box.
const FIXTURE_PAD_CM = 22;
const MARK_PAD_CM = 14;
const POSITION_MATCH_EPSILON_METERS = 0.01;
const ROTATION_MATCH_EPSILON_DEGREES = 0.5;
const COMMIT_PREVIEW_TIMEOUT_MS = 1800;

interface PlotPosition {
  xMeters: number;
  yMeters: number;
}

interface TransientFixturePosition extends PlotPosition {
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
  renderMode,
  showSymbolKey = false,
  searchQuery = "",
  identifyingFixtureIds,
  highlightOverlayFixtureIds,
  addToSelection = false,
  onSelectFixture,
  onPositionCommit,
  onRotationCommit,
  onOpenFixtureMenu,
  onOpenPlotMenu,
  onMarqueeSelect,
  onTalentMarkPositionCommit,
  onAddFixture,
  onFitTargetChange,
  viewport,
  chipHoverFixtureId,
}: StagePlotProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;
  const floorClipId = `stage-floor-clip-${useId().replace(/:/g, "")}`;

  // DENSITY-04 — bounding box (cm) of the populated rig: fixtures + talent marks +
  // set elements. Cameras + room walls/booth are excluded so the frame tightens onto
  // the lit/scanned content rather than re-expanding to the back of the room. Null
  // when there are no fixtures → fitContent falls back to the full-room frame so the
  // empty-state CTA reads over the whole studio.
  const contentBBox = useMemo<ContentBBox | null>(() => {
    if (fixtures.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (cmX: number, cmY: number, padX: number, padY: number) => {
      minX = Math.min(minX, cmX - padX);
      minY = Math.min(minY, cmY - padY);
      maxX = Math.max(maxX, cmX + padX);
      maxY = Math.max(maxY, cmY + padY);
    };
    fixtures.forEach((fixture, index) => {
      const { xMeters, yMeters } = meterPositionFor(fixture, index);
      include(xMeters * 100, yMeters * 100, FIXTURE_PAD_CM, FIXTURE_PAD_CM);
    });
    layout.talentMarks.forEach((mark) => include(mark.xMeters * 100, mark.yMeters * 100, MARK_PAD_CM, MARK_PAD_CM));
    layout.setElements.forEach((element) =>
      include(
        element.xMeters * 100,
        element.yMeters * 100,
        (element.widthMeters * 100) / 2,
        (element.depthMeters * 100) / 2
      )
    );
    return { minX, minY, maxX, maxY };
  }, [fixtures, layout]);

  const fitTarget = useMemo(
    () => computeContentFitTransform(contentBBox, { widthCm, depthCm, gutterCm: 0 }),
    [contentBBox, widthCm, depthCm]
  );
  useEffect(() => {
    onFitTargetChange?.(fitTarget);
  }, [fitTarget, onFitTargetChange]);

  // DENSITY-04 — apply the content frame on first paint when fitContent is the
  // resting mode, and whenever the operator re-selects Frame. Intentionally keyed
  // ONLY on zoomMode (not fitTarget/fixtures) so adding / moving / deleting a fixture
  // does NOT yank the view out from under the operator mid-edit — the Frame button is
  // the explicit "re-frame now" affordance, exactly like Fit Room / Fill Desk / 100%.
  useEffect(() => {
    if (viewport.zoomMode === "fitContent") viewport.fitContent(fitTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-frame only on mode (re)select, see comment above
  }, [viewport.zoomMode]);

  // DENSITY-04 — double-click / reset returns to the CURRENT mode's resting view. For
  // fitContent that resting view is the framed transform (not identity), so re-fit
  // rather than zeroing the transform (which would un-frame while Frame stays active).
  const handleResetView = () => {
    if (viewport.zoomMode === "fitContent") viewport.fitContent(fitTarget);
    else viewport.reset();
  };

  // Track the fixture position while a drag is in flight, then hold the
  // snapped drop position until the engine snapshot refresh lands. This keeps
  // marker + output movement visually continuous across the IPC round trip.
  const [transientPosition, setTransientPosition] = useState<TransientFixturePosition | null>(null);
  const [transientRotation, setTransientRotation] = useState<TransientFixtureRotation | null>(null);
  const dragState = transientPosition?.phase === "dragging" ? transientPosition : null;
  const handleFixtureDragMove = useCallback((id: string, xMeters: number, yMeters: number) => {
    setTransientPosition({ id, phase: "dragging", xMeters, yMeters });
  }, []);
  const handleFixtureDragEnd = useCallback((id: string, committedPosition: PlotPosition | null) => {
    if (!committedPosition) {
      setTransientPosition((current) => (current?.id === id ? null : current));
      return;
    }
    setTransientPosition({ id, phase: "committing", ...committedPosition });
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
  // Hit-test resolves on pointerup against the current fixture positions. With
  // Add to selection lit the box adds to the selection instead of replacing it.
  const marquee = useMarqueeSelection({
    svgRef: viewport.svgRef,
    additive: addToSelection,
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

  // F9 — alignment guide derivation. When a drag is in progress, surface
  // horizontal + vertical lines through any other fixture whose axis falls
  // within 0.1 m of the dragged fixture. The guides are advisory; the
  // snap-to-0.5 m semantic in FixtureMarker.finishDrag still wins on commit
  // (every drag snaps: new pages program, Slice 3, decision 10).
  const alignmentGuides = useMemo(() => {
    if (!dragState) return { vertical: [], horizontal: [] };
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

  const projection = usePlotProjection(viewport.svgRef, viewport);
  const labels = useMemo<PlotLabel[]>(() => {
    const entries: PlotLabel[] = [];
    for (const mark of layout.talentMarks) {
      entries.push({
        id: `talent-${mark.id}`,
        xCm: mark.xMeters * 100,
        yCm: mark.yMeters * 100,
        radiusCm: 18,
        name: mark.label,
        kind: "fixed",
      });
    }
    layout.setElements.forEach((element, index) => {
      entries.push({
        id: `set-${index}`,
        xCm: element.xMeters * 100,
        yCm: element.yMeters * 100,
        radiusCm: (element.depthMeters * 100) / 2,
        name: element.label,
        kind: "fixed",
      });
    });
    for (const camera of layout.cameras) {
      entries.push({
        id: `camera-${camera.id}`,
        xCm: camera.xMeters * 100,
        yCm: camera.yMeters * 100,
        radiusCm: 12,
        name: camera.label,
        kind: "fixed",
      });
    }
    // The visual overhaul's polish (2026-10-05): every shape on the floor has
    // its name. The door and the booth window are named on the room's side of
    // their wall; the backdrop's band reads as the wall and stays unnamed, so
    // no word covers a fixture hung along it.
    const { door, controlBoothWindow } = layout.walls;
    if (door && (door.wall === "east" || door.wall === "west")) {
      entries.push({
        id: "wall-door",
        xCm: door.wall === "east" ? widthCm - 4 : 4,
        yCm: (door.offsetMeters + door.widthMeters / 2) * 100,
        radiusCm: 4,
        name: "Door",
        kind: "fixed",
        side: door.wall === "east" ? "left" : "right",
      });
    }
    if (controlBoothWindow) {
      entries.push({
        id: "wall-booth-window",
        xCm: (controlBoothWindow.offsetMeters + controlBoothWindow.widthMeters / 2) * 100,
        yCm: depthCm - 5,
        radiusCm: 5,
        name: "Booth window",
        kind: "fixed",
        side: "above",
      });
    }
    fixtures.forEach((fixture, index) => {
      const { xMeters, yMeters } = displayedPositionFor(fixture, index, true);
      const visual = fixtureVisuals.get(fixture.id) ?? getFixtureVisualModel(catalog, fixture);
      const selected = selectedFixtureIds ? selectedFixtureIds.has(fixture.id) : fixture.id === selectedFixtureId;
      const detail = patchMode
        ? fixture.dmxStartAddress > 0
          ? `DMX ${String(fixture.dmxStartAddress).padStart(3, "0")}`
          : "not patched"
        : selected
          ? fixture.on
            ? `${Math.round(fixture.intensity)} % · ${Math.round(fixture.cct)} K`
            : "off"
          : null;
      entries.push({
        id: fixture.id,
        xCm: xMeters * 100,
        yCm: yMeters * 100,
        radiusCm: Math.max(14, Math.min(40, Math.max(visual.body.width, visual.body.height) / 2 + 4)),
        name: fixture.name,
        detail,
        strong: selected,
        kind: "fixture",
        dimmed: !fixtureMatches(fixture),
      });
    });
    return entries;
    // fixtureMatches reads the search, which is in its own deps through `needle`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalog,
    depthCm,
    displayedPositionFor,
    fixtureVisuals,
    fixtures,
    layout,
    needle,
    patchMode,
    selectedFixtureId,
    selectedFixtureIds,
    widthCm,
  ]);

  // A right-click on the floor opens the plot's menu; one on a fixture its own
  // (the marker stops it), and one on a talent mark the plot's.
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onOpenPlotMenu || event.defaultPrevented) return;
    event.preventDefault();
    onOpenPlotMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <div
      className={styles.plotShell}
      data-render-mode={renderMode}
      data-patch={patchMode ? "" : undefined}
      role="application"
      aria-label="Lighting stage plot"
      onContextMenu={handleContextMenu}
    >
      <div className={styles.rulerTop} style={{ height: RULER_TOP }}>
        <PlotRuler projection={projection} axis="x" lengthMetres={layout.roomWidthMeters} thickness={RULER_TOP} />
      </div>
      <div className={styles.rulerLeft} style={{ width: RULER_LEFT }}>
        <PlotRuler projection={projection} axis="y" lengthMetres={layout.roomDepthMeters} thickness={RULER_LEFT} />
      </div>
      <div className={styles.plotArea}>
        <svg
          ref={viewport.svgRef}
          className={`${styles.plotSvg} ${viewport.isPanning ? styles.plotSvgPanning : ""} ${marquee.rect ? styles.plotSvgMarqueeing : ""}`}
          viewBox={`0 0 ${widthCm} ${depthCm}`}
          preserveAspectRatio="xMidYMid meet"
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
          onDoubleClick={handleResetView}
        >
          <g data-inner-content="true" transform={viewport.transform}>
            <defs>
              <clipPath id={floorClipId} clipPathUnits="userSpaceOnUse">
                <rect x={0} y={0} width={widthCm} height={depthCm} />
              </clipPath>
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
                  onSelect={(id) => onSelectFixture(id, { additive: addToSelection })}
                  onPositionCommit={onPositionCommit}
                  onRotationCommit={onRotationCommit}
                  onOpenMenu={onOpenFixtureMenu}
                  onDragMove={handleFixtureDragMove}
                  onDragEnd={handleFixtureDragEnd}
                  onRotationMove={handleFixtureRotationMove}
                  onRotationEnd={handleFixtureRotationEnd}
                />
              );
            })}

            {/* F9 — smart-guide alignment lines. Only render when a fixture
              drag is in progress. Stroke is non-scaling so the guides remain
              crisp under any zoom level. */}
            {dragState ? (
              <g pointerEvents="none">
                {alignmentGuides.vertical.map((xMeters) => (
                  <line
                    key={`vguide-${xMeters}`}
                    x1={xMeters * 100}
                    y1={0}
                    x2={xMeters * 100}
                    y2={depthCm}
                    style={{ stroke: "var(--text-text2)", strokeDasharray: "3 3", opacity: 0.65 }}
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
                    style={{ stroke: "var(--text-text2)", strokeDasharray: "3 3", opacity: 0.65 }}
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
                style={{
                  fill: "var(--accent)",
                  fillOpacity: marquee.additive ? 0.14 : 0.08,
                  stroke: "var(--accent)",
                  strokeDasharray: "4 3",
                }}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </g>
        </svg>

        <StagePlotLabels projection={projection} labels={labels} />
        {showSymbolKey ? <FixtureSymbolKey catalog={catalog} fixtures={fixtures} renderMode={renderMode} /> : null}

        {/* The visual overhaul's polish (2026-10-05): the empty rig's words
            stand in the room's area, centred on its axis and lifted into the
            band between the bench and the talent marks; the grid stops behind
            the title. The helper sentence is the key's tooltip (DESIGN.md §9).
            Until then the block was centred on the whole well, rulers
            included, and printed straight over the grid. */}
        {fixtures.length === 0 ? (
          <div className={styles.plotEmpty}>
            <p className={styles.plotEmptyTitle}>No fixtures on the rig yet</p>
            {onAddFixture ? (
              <Tooltip content="Add the first fixture, then place it where it hangs in the room.">
                <Key mode="primary" onClick={onAddFixture}>
                  Add fixture…
                </Key>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
