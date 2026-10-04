import { useLayoutEffect, useState, type RefObject } from "react";

import styles from "./StagePlot.module.css";

// The visual overhaul's Lighting page (2026-10-04): the plot's words and its
// rulers, drawn in the screen's pixels over the picture, so a name is 13 px
// (the tick size, DESIGN.md §3) at any zoom and the rulers read in metres.
// The picture itself stays in centimetres (`StagePlot`'s viewBox, the room
// 1200 × 800 cm, met into its box); the projection here maps a point of it to
// the box's pixels the way the browser does. Names are placed beside their
// fixture where there is room; where fixtures stand too close for that, their
// names stand in a column beside the group, each joined to its fixture by a
// hairline (a leader). Nothing here takes a pointer.

export const ROOM_VIEWBOX = { widthCm: 1200, depthCm: 800 } as const;

export interface PlotProjection {
  width: number;
  height: number;
  /** Pixels per centimetre at zoom 1. */
  scale: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
  panX: number;
  panY: number;
}

/** The picture's projection into its box: `meet`, centred, then the viewport's pan and zoom. */
export function usePlotProjection(
  svgRef: RefObject<SVGSVGElement | null>,
  view: { zoom: number; panX: number; panY: number }
): PlotProjection | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;
    const read = () => {
      const box = node.getBoundingClientRect();
      setSize((current) =>
        current && current.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height }
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [svgRef]);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const scale = Math.min(size.width / ROOM_VIEWBOX.widthCm, size.height / ROOM_VIEWBOX.depthCm);
  return {
    width: size.width,
    height: size.height,
    scale,
    offsetX: (size.width - ROOM_VIEWBOX.widthCm * scale) / 2,
    offsetY: (size.height - ROOM_VIEWBOX.depthCm * scale) / 2,
    ...view,
  };
}

export function toScreen(projection: PlotProjection, xCm: number, yCm: number) {
  const { scale, offsetX, offsetY, zoom, panX, panY } = projection;
  return { x: offsetX + scale * (panX + zoom * xCm), y: offsetY + scale * (panY + zoom * yCm) };
}

// ---------------------------------------------------------------- the rulers

/** The step between numbered marks: the smallest of 0.5, 1, 2 and 5 m that
 *  leaves 48 px between them. */
function rulerStep(pixelsPerMetre: number) {
  for (const step of [0.5, 1, 2, 5]) {
    if (step * pixelsPerMetre >= 48) return step;
  }
  return 10;
}

function metres(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export interface PlotRulerProps {
  projection: PlotProjection | null;
  axis: "x" | "y";
  /** The room's length along the axis, in metres. */
  lengthMetres: number;
  /** The band's size across the axis, in pixels. */
  thickness: number;
}

export function PlotRuler({ projection, axis, lengthMetres, thickness }: PlotRulerProps) {
  if (!projection) return <svg className={styles.ruler} aria-hidden="true" />;
  const pixelsPerMetre = 100 * projection.scale * projection.zoom;
  const step = rulerStep(pixelsPerMetre);
  const along = axis === "x" ? projection.width : projection.height;
  const marks: Array<{ at: number; value: number; major: boolean }> = [];
  for (let value = 0; value <= lengthMetres + 1e-6; value += step / 2) {
    const point = axis === "x" ? toScreen(projection, value * 100, 0).x : toScreen(projection, 0, value * 100).y;
    if (point < -1 || point > along + 1) continue;
    const major = Math.abs(value / step - Math.round(value / step)) < 1e-6;
    if (!major && (step / 2) * pixelsPerMetre < 8) continue;
    marks.push({ at: point, value, major });
  }
  const last = marks.filter((mark) => mark.major).at(-1);
  return (
    <svg
      className={styles.ruler}
      data-axis={axis}
      aria-hidden="true"
      width={axis === "x" ? projection.width : thickness}
      height={axis === "x" ? thickness : projection.height}
    >
      {marks.map((mark) =>
        axis === "x" ? (
          <g key={mark.value}>
            <line
              className={mark.major ? styles.rulerMajor : styles.rulerMinor}
              x1={mark.at}
              x2={mark.at}
              y1={thickness}
              y2={thickness - (mark.major ? 7 : 4)}
            />
            {mark.major ? (
              <text
                className={styles.rulerText}
                x={mark.at}
                y={thickness - 10}
                // A number at the band's ends stands inside it, not half over its edge.
                textAnchor={mark.at < 12 ? "start" : mark.at > projection.width - 24 ? "end" : "middle"}
              >
                {metres(mark.value)}
                {mark === last ? " m" : ""}
              </text>
            ) : null}
          </g>
        ) : (
          <g key={mark.value}>
            <line
              className={mark.major ? styles.rulerMajor : styles.rulerMinor}
              x1={thickness}
              x2={thickness - (mark.major ? 7 : 4)}
              y1={mark.at}
              y2={mark.at}
            />
            {mark.major ? (
              <text className={styles.rulerText} x={thickness - 10} y={mark.at + 4} textAnchor="end">
                {metres(mark.value)}
              </text>
            ) : null}
          </g>
        )
      )}
    </svg>
  );
}

// ---------------------------------------------------------------- the names

export interface PlotLabel {
  id: string;
  /** The point it names, in the picture's centimetres. */
  xCm: number;
  yCm: number;
  /** How far round the point its mark reaches, in centimetres. */
  radiusCm: number;
  name: string;
  /** A second, quieter line (`76 % · 3200 K`, `DMX 001`). */
  detail?: string | null;
  /** The selected fixture's name is bold. */
  strong?: boolean;
  /** A fixture's name avoids the others and may take a leader; a fixed word
   *  (a talent mark, the bench, a camera) stands under its mark. */
  kind: "fixture" | "fixed";
  dimmed?: boolean;
}

const LINE_HEIGHT = 16;
const GAP = 8;
const LEADER_PITCH = 36;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** A word's width at the tick size in PT Sans, regular or bold. */
function textWidth(text: string, strong: boolean) {
  if (measureContext === undefined) {
    try {
      measureContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      measureContext = null;
    }
  }
  if (!measureContext) return text.length * 7;
  measureContext.font = `${strong ? 700 : 400} 13px "PT Sans", "Segoe UI", sans-serif`;
  return measureContext.measureText(text).width;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

interface PlacedLabel {
  label: PlotLabel;
  box: Box;
  anchor: { x: number; y: number };
  /** Where a leader meets the name, when the name stands away from its mark. */
  leader: { x: number; y: number } | null;
}

/** Places every name: fixed words under their marks, then each fixture's name
 *  beside it (right, left, below, above) where it covers no other name and no
 *  mark, and the rest in a column beside their group with a leader each. */
export function placeLabels(labels: readonly PlotLabel[], projection: PlotProjection): PlacedLabel[] {
  const pixelsPerCm = projection.scale * projection.zoom;
  const inside = (box: Box) =>
    box.x >= 2 && box.y >= 2 && box.x + box.w <= projection.width - 2 && box.y + box.h <= projection.height - 2;
  const marks: Box[] = labels.map((label) => {
    const centre = toScreen(projection, label.xCm, label.yCm);
    const r = Math.max(6, label.radiusCm * pixelsPerCm);
    return { x: centre.x - r, y: centre.y - r, w: r * 2, h: r * 2 };
  });
  const placed: PlacedLabel[] = [];
  const taken: Box[] = [];
  const pending: Array<{ label: PlotLabel; anchor: { x: number; y: number }; w: number; h: number; r: number }> = [];

  labels.forEach((label) => {
    const anchor = toScreen(projection, label.xCm, label.yCm);
    const r = Math.max(6, label.radiusCm * pixelsPerCm);
    const w = Math.ceil(
      Math.max(textWidth(label.name, label.strong === true), label.detail ? textWidth(label.detail, false) : 0)
    );
    const h = label.detail ? LINE_HEIGHT * 2 : LINE_HEIGHT;
    if (label.kind === "fixed") {
      const box = { x: anchor.x - w / 2, y: anchor.y + r + 4, w, h };
      placed.push({ label, box, anchor, leader: null });
      taken.push(box);
      return;
    }
    pending.push({ label, anchor, w, h, r });
  });

  const leftovers: typeof pending = [];
  // Top to bottom, left to right, so neighbours settle the same way each time.
  pending.sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
  for (const item of pending) {
    const { anchor, w, h, r } = item;
    const candidates: Box[] = [
      { x: anchor.x + r + GAP, y: anchor.y - h / 2, w, h },
      { x: anchor.x - r - GAP - w, y: anchor.y - h / 2, w, h },
      { x: anchor.x - w / 2, y: anchor.y + r + 4, w, h },
      { x: anchor.x - w / 2, y: anchor.y - r - 4 - h, w, h },
    ];
    const ownMark = labels.indexOf(item.label);
    const fits = candidates.find(
      (box) =>
        inside(box) &&
        !taken.some((other) => overlaps(box, other)) &&
        !marks.some((mark, index) => index !== ownMark && overlaps(box, mark))
    );
    if (fits) {
      placed.push({ label: item.label, box: fits, anchor, leader: null });
      taken.push(fits);
    } else {
      leftovers.push(item);
    }
  }

  if (leftovers.length > 0) {
    // The names that found no room stand in a column right of their group
    // (left of it where the right has no room), in the order of their marks
    // from the top, each joined to its mark by a leader.
    const right = Math.max(...leftovers.map((item) => item.anchor.x + item.r));
    const left = Math.min(...leftovers.map((item) => item.anchor.x - item.r));
    const widest = Math.max(...leftovers.map((item) => item.w));
    const onRight = right + LEADER_PITCH + widest <= projection.width - 2;
    const columnX = onRight ? right + LEADER_PITCH : left - LEADER_PITCH - widest;
    let y = Math.max(2, Math.min(...leftovers.map((item) => item.anchor.y)) - leftovers[0]!.h / 2);
    for (const item of leftovers.sort((a, b) => a.anchor.y - b.anchor.y)) {
      let box = { x: onRight ? columnX : columnX + widest - item.w, y, w: item.w, h: item.h };
      while (taken.some((other) => overlaps(box, other)) && box.y + box.h < projection.height) {
        box = { ...box, y: box.y + 4 };
      }
      placed.push({
        label: item.label,
        box,
        anchor: item.anchor,
        leader: { x: onRight ? box.x - 4 : box.x + box.w + 4, y: box.y + LINE_HEIGHT / 2 },
      });
      taken.push(box);
      y = box.y + box.h + 4;
    }
  }
  return placed;
}

export interface StagePlotLabelsProps {
  projection: PlotProjection | null;
  labels: readonly PlotLabel[];
}

export function StagePlotLabels({ projection, labels }: StagePlotLabelsProps) {
  if (!projection) return null;
  const placed = placeLabels(labels, projection);
  return (
    <svg
      className={styles.labels}
      width={projection.width}
      height={projection.height}
      aria-hidden="true"
      data-testid="lighting-plot-labels"
    >
      {placed.map(({ label, box, anchor, leader }) => (
        <g
          key={label.id}
          data-label-for={label.id}
          data-leader={leader ? "" : undefined}
          opacity={label.dimmed ? 0.4 : 1}
        >
          {leader ? (
            <>
              <line className={styles.leader} x1={anchor.x} y1={anchor.y} x2={leader.x} y2={leader.y} />
              <circle className={styles.leaderDot} cx={anchor.x} cy={anchor.y} r={2} />
            </>
          ) : null}
          <text
            className={label.strong ? styles.labelStrong : label.kind === "fixed" ? styles.labelFixed : styles.label}
            x={label.kind === "fixed" ? box.x + box.w / 2 : box.x}
            y={box.y + 12}
            textAnchor={label.kind === "fixed" ? "middle" : "start"}
          >
            {label.name}
          </text>
          {label.detail ? (
            <text
              className={styles.labelDetail}
              x={label.kind === "fixed" ? box.x + box.w / 2 : box.x}
              y={box.y + 12 + LINE_HEIGHT}
              textAnchor={label.kind === "fixed" ? "middle" : "start"}
            >
              {label.detail}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
