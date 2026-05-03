import type { ReactElement } from "react";

import type { FixtureVisualModel, StagePlotRenderMode } from "../fixtureVisuals";
import { lightingFixtureColor } from "../lightingHelpers";

export interface FixtureSymbolProps {
  cct: number;
  intensity: number;
  on: boolean;
  renderMode: StagePlotRenderMode;
  visual: FixtureVisualModel;
}

const SHELL_FILL = "var(--color-fixture-shell-fill)";
const SHELL_STROKE = "var(--color-fixture-shell-stroke)";
const EMITTER_FILL = "rgba(240, 230, 198, 0.1)";
const PIXEL_STROKE = "var(--color-brand-green)";

function segmentCount(visual: FixtureVisualModel, max: number) {
  return Math.max(0, Math.min(max, Math.round(visual.emitterLayout?.segments ?? 0)));
}

function seamLines(width: number, height: number, columns: number, rows: number, emphasis: boolean) {
  const lines: ReactElement[] = [];
  const safeColumns = Math.max(1, Math.min(12, Math.round(columns)));
  const safeRows = Math.max(1, Math.min(6, Math.round(rows)));
  for (let index = 1; index < safeColumns; index += 1) {
    const x = -width / 2 + (index * width) / safeColumns;
    lines.push(
      <line
        key={`v-${index}`}
        x1={x}
        x2={x}
        y1={-height / 2 + 1.5}
        y2={height / 2 - 1.5}
        data-emitter-segment="true"
        style={{ opacity: emphasis ? 0.9 : 0.52, stroke: emphasis ? PIXEL_STROKE : SHELL_STROKE, strokeWidth: 0.45 }}
      />
    );
  }
  for (let index = 1; index < safeRows; index += 1) {
    const y = -height / 2 + (index * height) / safeRows;
    lines.push(
      <line
        key={`h-${index}`}
        x1={-width / 2 + 1.5}
        x2={width / 2 - 1.5}
        y1={y}
        y2={y}
        data-emitter-segment="true"
        style={{ opacity: emphasis ? 0.9 : 0.52, stroke: emphasis ? PIXEL_STROKE : SHELL_STROKE, strokeWidth: 0.45 }}
      />
    );
  }
  return lines;
}

function renderPanel(visual: FixtureVisualModel, color: string, pixelMode: boolean) {
  const { height, width } = visual.body;
  return (
    <g>
      <path
        d={`M ${-width / 2 + 4} ${-height / 2 - 5} L ${width / 2 - 4} ${-height / 2 - 5}`}
        style={{ fill: "none", stroke: SHELL_STROKE, strokeLinecap: "round", strokeWidth: 1.2 }}
      />
      <path
        d={`M ${-width / 2 + 5} ${-height / 2 - 4} L ${-width / 2 + 5} ${-height / 2 + 5} M ${
          width / 2 - 5
        } ${-height / 2 - 4} L ${width / 2 - 5} ${-height / 2 + 5}`}
        style={{ fill: "none", stroke: SHELL_STROKE, strokeLinecap: "round", strokeWidth: 1 }}
      />
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={2.4}
        style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}
      />
      <rect
        x={-width / 2 + 3}
        y={-height / 2 + 3}
        width={width - 6}
        height={height - 6}
        rx={1.6}
        style={{ fill: color, fillOpacity: 0.12, stroke: SHELL_STROKE, strokeWidth: 0.45 }}
      />
      {visual.emitterLayout
        ? seamLines(width - 6, height - 6, visual.emitterLayout.columns, visual.emitterLayout.rows, pixelMode)
        : null}
    </g>
  );
}

function renderSoftMat(visual: FixtureVisualModel, color: string, pixelMode: boolean) {
  const { height, width } = visual.body;
  return (
    <g>
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={4}
        style={{ fill: "rgba(166, 157, 125, 0.1)", stroke: SHELL_STROKE, strokeWidth: 1 }}
      />
      <rect
        x={-width / 2 + 2.4}
        y={-height / 2 + 2.4}
        width={width - 4.8}
        height={height - 4.8}
        rx={3}
        style={{ fill: color, fillOpacity: 0.1, stroke: "rgba(235, 220, 180, 0.18)", strokeWidth: 0.45 }}
      />
      {seamLines(width - 5, height - 5, visual.emitterLayout?.columns ?? 4, visual.emitterLayout?.rows ?? 1, pixelMode)}
    </g>
  );
}

function renderLinearBar(visual: FixtureVisualModel, color: string, pixelMode: boolean) {
  const { height, width } = visual.body;
  const segments = segmentCount(visual, pixelMode ? 32 : 18);
  return (
    <g>
      <polygon
        points={`${-width / 2 + 3},${-height / 2} ${width / 2 - 3},${-height / 2} ${width / 2},${
          -height / 2 + 3
        } ${width / 2},${height / 2 - 3} ${width / 2 - 3},${height / 2} ${-width / 2 + 3},${height / 2} ${
          -width / 2
        },${height / 2 - 3} ${-width / 2},${-height / 2 + 3}`}
        style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}
      />
      <rect
        x={-width / 2 + 4}
        y={-height / 2 + 3}
        width={width - 8}
        height={height - 6}
        rx={1.5}
        style={{ fill: color, fillOpacity: 0.12, stroke: "rgba(235, 220, 180, 0.14)", strokeWidth: 0.35 }}
      />
      <rect
        x={-width / 2 + 1.5}
        y={-height / 2 + 2}
        width={3}
        height={height - 4}
        rx={0.8}
        style={{ fill: "rgba(0, 0, 0, 0.22)" }}
      />
      <path
        d={`M ${width / 2 - 7} 0 l 3 -2.8 v 5.6 z`}
        style={{ fill: pixelMode ? PIXEL_STROKE : SHELL_STROKE, opacity: pixelMode ? 0.85 : 0.62 }}
      />
      {segments > 1
        ? Array.from({ length: segments - 1 }, (_, index) => {
            const x = -width / 2 + 5 + ((index + 1) * (width - 10)) / segments;
            return (
              <line
                key={`bar-segment-${index}`}
                x1={x}
                x2={x}
                y1={-height / 2 + 3}
                y2={height / 2 - 3}
                data-emitter-segment="true"
                style={{
                  opacity: pixelMode ? 0.95 : 0.62,
                  stroke: pixelMode ? PIXEL_STROKE : SHELL_STROKE,
                  strokeWidth: pixelMode ? 0.55 : 0.38,
                }}
              />
            );
          })
        : null}
    </g>
  );
}

function renderFresnel(visual: FixtureVisualModel, color: string) {
  const { height, width } = visual.body;
  const radius = Math.min(width, height) / 2;
  return (
    <g>
      <path
        d={`M ${-radius - 4} ${-radius * 0.75} L ${-radius - 4} ${radius * 0.75} M ${radius + 4} ${
          -radius * 0.75
        } L ${radius + 4} ${radius * 0.75}`}
        style={{ fill: "none", stroke: SHELL_STROKE, strokeLinecap: "round", strokeWidth: 1.2 }}
      />
      <ellipse
        cx={0}
        cy={2}
        rx={radius * 0.92}
        ry={radius * 0.76}
        style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}
      />
      <circle
        r={radius * 0.72}
        style={{ fill: color, fillOpacity: 0.12, stroke: "rgba(235, 220, 180, 0.22)", strokeWidth: 0.55 }}
      />
      <circle r={radius * 0.44} style={{ fill: EMITTER_FILL, stroke: SHELL_STROKE, strokeWidth: 0.4 }} />
      <line
        x1={0}
        x2={0}
        y1={radius * 0.25}
        y2={radius + 7}
        style={{ stroke: SHELL_STROKE, strokeLinecap: "round", strokeWidth: 1.1 }}
      />
    </g>
  );
}

function renderControlNode(visual: FixtureVisualModel, color: string, on: boolean) {
  const { height, width } = visual.body;
  const size = Math.min(width, height);
  return (
    <g>
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={3}
        style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}
      />
      <circle
        r={size * 0.28}
        style={{ fill: color, fillOpacity: on ? 0.18 : 0.04, stroke: SHELL_STROKE, strokeWidth: 0.65 }}
      />
      <path
        d={`M ${-size * 0.26} ${-size * 0.06} Q 0 ${-size * 0.32} ${size * 0.26} ${-size * 0.06} M ${
          -size * 0.34
        } ${size * 0.12} Q 0 ${-size * 0.2} ${size * 0.34} ${size * 0.12}`}
        style={{ fill: "none", stroke: SHELL_STROKE, strokeLinecap: "round", strokeWidth: 0.8 }}
      />
      <line
        x1={width / 2 - 3}
        x2={width / 2 + 5}
        y1={-height / 2 + 3}
        y2={-height / 2 - 5}
        style={{ stroke: SHELL_STROKE, strokeLinecap: "round", strokeWidth: 1 }}
      />
    </g>
  );
}

export function FixtureSymbol({ cct, intensity, on, renderMode, visual }: FixtureSymbolProps) {
  const color = lightingFixtureColor(cct, on);
  const pixelMode = renderMode === "pixel" && visual.emitterLayout !== null;
  const opacity = on ? Math.max(0.72, Math.min(1, 0.68 + intensity / 250)) : 0.72;
  let body: ReactElement;

  switch (visual.symbolKind) {
    case "panel":
      body = renderPanel(visual, color, pixelMode);
      break;
    case "soft-mat":
      body = renderSoftMat(visual, color, pixelMode);
      break;
    case "linear-bar":
      body = renderLinearBar(visual, color, pixelMode);
      break;
    case "control-node":
      body = renderControlNode(visual, color, on);
      break;
    case "fresnel":
    default:
      body = renderFresnel(visual, color);
      break;
  }

  return (
    <g
      data-render-mode={renderMode}
      data-symbol-kind={visual.symbolKind}
      data-symbol-variant={visual.symbolVariant}
      opacity={opacity}
    >
      {body}
    </g>
  );
}
