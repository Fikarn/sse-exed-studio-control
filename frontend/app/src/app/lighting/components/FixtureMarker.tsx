import type { ReactElement } from "react";

import type { FixtureMounting } from "../fixtureMounting";
import { lightingFixtureColor } from "../lightingHelpers";

export interface FixtureMarkerProps {
  id: string;
  centerX: number;
  centerY: number;
  rotationDegrees: number;
  mounting: FixtureMounting;
  intensity: number;
  cct: number;
  on: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

const SHELL_FILL = "rgba(8, 9, 10, 0.92)";
const SHELL_STROKE = "rgba(212, 205, 179, 0.4)";
const SELECTED_STROKE = "#99BA92";

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
  centerX,
  centerY,
  rotationDegrees,
  mounting,
  intensity,
  cct,
  on,
  selected,
  onSelect,
}: FixtureMarkerProps) {
  const color = lightingFixtureColor(cct, on);
  const dotOpacity = on ? Math.max(0.3, intensity / 100) : 0.18;

  return (
    <g
      transform={`translate(${centerX}, ${centerY}) rotate(${rotationDegrees})`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(id);
      }}
      style={{ cursor: "pointer" }}
      data-fixture-id={id}
    >
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
  );
}
