import type { ReactElement } from "react";

import type { FixtureMounting } from "../fixtureMounting";
import { lightingFixtureColor } from "../lightingHelpers";

export interface FixtureMarkerProps {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  rotationDegrees: number;
  mounting: FixtureMounting;
  intensity: number;
  cct: number;
  on: boolean;
  selected: boolean;
  dimmed?: boolean;
  onSelect: (id: string) => void;
}

const SHELL_FILL = "rgba(8, 9, 10, 0.92)";
const SHELL_STROKE = "rgba(212, 205, 179, 0.4)";
const SELECTED_STROKE = "#99BA92";

const LABEL_NAME_FILL = "#d4cdb3";
const LABEL_META_FILL = "#8a8470";

const MOUNTING_SHORT_LABEL: Record<FixtureMounting, string> = {
  "grid-panel": "grid",
  "grid-soft": "grid",
  stand: "stand",
  "wall-bar": "wall",
};

function shapeForMounting(mounting: FixtureMounting): ReactElement {
  switch (mounting) {
    case "grid-panel":
      return (
        <rect x={-9} y={-9} width={18} height={18} rx={2} fill={SHELL_FILL} stroke={SHELL_STROKE} strokeWidth={1} />
      );
    case "grid-soft":
      return (
        <rect x={-13} y={-9} width={26} height={18} rx={4} fill={SHELL_FILL} stroke={SHELL_STROKE} strokeWidth={1} />
      );
    case "wall-bar":
      return (
        <rect x={-22} y={-3} width={44} height={6} rx={1} fill={SHELL_FILL} stroke={SHELL_STROKE} strokeWidth={1} />
      );
    case "stand":
    default:
      return <circle r={9} fill={SHELL_FILL} stroke={SHELL_STROKE} strokeWidth={1} />;
  }
}

export function FixtureMarker({
  id,
  name,
  centerX,
  centerY,
  rotationDegrees,
  mounting,
  intensity,
  cct,
  on,
  selected,
  dimmed = false,
  onSelect,
}: FixtureMarkerProps) {
  const color = lightingFixtureColor(cct, on);
  const dotOpacity = on ? Math.max(0.3, intensity / 100) : 0.18;

  // Per the v6 prototype: name + meta lines sit above the marker, not rotated
  // with the fixture body. Label upper-cased to match the prototype's
  // "APOLLO L" / "ASTRA L" style.
  const displayName = name.toUpperCase();
  const intensityLabel = on ? `${Math.round(intensity)}%` : "OFF";
  const metaLabel = `${intensityLabel} · ${Math.round(cct)} K · ${MOUNTING_SHORT_LABEL[mounting]}`;

  // Wall-bar markers are wide; lift labels slightly to clear the bar.
  const nameOffsetY = mounting === "wall-bar" ? -16 : -32;
  const metaOffsetY = mounting === "wall-bar" ? -28 : -46;

  return (
    <g
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(id);
      }}
      style={{ cursor: "pointer", opacity: dimmed ? 0.35 : 1 }}
      data-fixture-id={id}
    >
      <g transform={`translate(${centerX}, ${centerY}) rotate(${rotationDegrees})`}>
        {shapeForMounting(mounting)}
        <circle r={3.6} fill={color} fillOpacity={dotOpacity} />
        {selected ? (
          <circle
            r={mounting === "wall-bar" ? 26 : 14}
            fill="none"
            stroke={SELECTED_STROKE}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ) : null}
      </g>
      <text
        x={centerX}
        y={centerY + nameOffsetY}
        textAnchor="middle"
        fontFamily="var(--font-family-mono)"
        fontSize={10}
        fontWeight={600}
        letterSpacing={0.8}
        fill={LABEL_NAME_FILL}
        pointerEvents="none"
      >
        {displayName}
      </text>
      <text
        x={centerX}
        y={centerY + metaOffsetY}
        textAnchor="middle"
        fontFamily="var(--font-family-mono)"
        fontSize={9}
        letterSpacing={0.6}
        fill={LABEL_META_FILL}
        pointerEvents="none"
      >
        {metaLabel}
      </text>
    </g>
  );
}
