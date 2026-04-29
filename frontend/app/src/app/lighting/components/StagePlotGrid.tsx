import type { ReactElement } from "react";

import type { StudioLayout } from "../studioLayout";

export interface StagePlotGridProps {
  layout: StudioLayout;
}

export function StagePlotGrid({ layout }: StagePlotGridProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;
  const lines: ReactElement[] = [];
  const HALF_M = 50;
  const ONE_M = 100;
  const FIVE_M = 500;

  for (let x = 0; x <= widthCm; x += HALF_M) {
    const stroke =
      x % FIVE_M === 0
        ? "var(--color-stage-grid-major)"
        : x % ONE_M === 0
          ? "var(--color-stage-grid-minor)"
          : "var(--color-stage-grid-faint)";
    lines.push(
      <line
        key={`vx-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={depthCm}
        strokeWidth={x % FIVE_M === 0 ? 1.4 : 0.6}
        style={{ stroke }}
      />
    );
  }
  for (let y = 0; y <= depthCm; y += HALF_M) {
    const stroke =
      y % FIVE_M === 0
        ? "var(--color-stage-grid-major)"
        : y % ONE_M === 0
          ? "var(--color-stage-grid-minor)"
          : "var(--color-stage-grid-faint)";
    lines.push(
      <line
        key={`hy-${y}`}
        x1={0}
        y1={y}
        x2={widthCm}
        y2={y}
        strokeWidth={y % FIVE_M === 0 ? 1.4 : 0.6}
        style={{ stroke }}
      />
    );
  }
  return <g aria-hidden="true">{lines}</g>;
}
