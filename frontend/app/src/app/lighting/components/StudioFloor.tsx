import type { StudioLayout } from "../studioLayout";

export interface StudioFloorProps {
  layout: StudioLayout;
}

const WALL_COLOR = "var(--color-studio-wall)";
const WALL_STROKE = "var(--color-studio-wall-stroke)";
const FLOOR_COLOR = "var(--color-bg-deep)";
const TEXT_MUTED = "var(--color-brand-text-faint)";
const ELEMENT_FILL = "var(--color-studio-element)";
const ELEMENT_STROKE = "var(--color-studio-element-stroke)";

export function StudioFloor({ layout }: StudioFloorProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;

  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={widthCm} height={depthCm} style={{ fill: FLOOR_COLOR }} />
      <rect x={0} y={0} width={widthCm} height={depthCm} fill="none" style={{ stroke: WALL_STROKE, strokeWidth: 2 }} />
      {layout.walls.backdrop ? (
        <rect x={0} y={0} width={widthCm} height={20} opacity={0.5} style={{ fill: WALL_COLOR }} />
      ) : null}
      {layout.walls.door ? (
        <rect
          x={layout.walls.door.wall === "east" ? widthCm - 8 : 0}
          y={layout.walls.door.offsetMeters * 100}
          width={
            layout.walls.door.wall === "east" || layout.walls.door.wall === "west"
              ? 8
              : layout.walls.door.widthMeters * 100
          }
          height={
            layout.walls.door.wall === "east" || layout.walls.door.wall === "west"
              ? layout.walls.door.widthMeters * 100
              : 8
          }
          strokeDasharray="6 4"
          style={{ fill: FLOOR_COLOR, stroke: "var(--color-stage-door-stroke)", strokeWidth: 1 }}
        />
      ) : null}
      {layout.walls.controlBoothWindow ? (
        <rect
          x={layout.walls.controlBoothWindow.offsetMeters * 100}
          y={depthCm - 10}
          width={layout.walls.controlBoothWindow.widthMeters * 100}
          height={10}
          style={{
            fill: "var(--color-brand-blue-soft)",
            stroke: "var(--color-brand-blue-border)",
            strokeWidth: 1,
          }}
        />
      ) : null}
      {layout.setElements.map((element, index) => {
        if (element.kind === "bench") {
          const w = element.widthMeters * 100;
          const d = element.depthMeters * 100;
          return (
            <g
              key={`set-${index}`}
              transform={`translate(${element.xMeters * 100 - w / 2}, ${element.yMeters * 100 - d / 2})`}
            >
              <rect width={w} height={d} rx={4} style={{ fill: ELEMENT_FILL, stroke: ELEMENT_STROKE }} />
              <text
                x={w / 2}
                y={d / 2 + 4}
                fontSize={10}
                textAnchor="middle"
                style={{ fill: TEXT_MUTED, fontFamily: "var(--font-family-ui)" }}
              >
                {element.label}
              </text>
            </g>
          );
        }
        return null;
      })}
      {layout.talentMarks.map((mark, index) => (
        <g key={`talent-${index}`}>
          <circle
            cx={mark.xMeters * 100}
            cy={mark.yMeters * 100}
            r={6}
            fill="none"
            strokeDasharray="3 3"
            style={{ stroke: "var(--color-studio-talent-ring)", strokeWidth: 1 }}
          />
          <circle
            cx={mark.xMeters * 100}
            cy={mark.yMeters * 100}
            r={1.5}
            style={{ fill: "var(--color-studio-talent-dot)" }}
          />
        </g>
      ))}
      {layout.cameras.map((camera) => (
        <g
          key={camera.id}
          transform={`translate(${camera.xMeters * 100}, ${camera.yMeters * 100}) rotate(${camera.rotationDegrees})`}
        >
          <polygon
            points="-10,8 10,8 0,-12"
            style={{
              fill: "var(--color-studio-camera-fill)",
              stroke: "var(--color-studio-camera-stroke)",
              strokeWidth: 1,
            }}
          />
          <text
            y={20}
            fontSize={10}
            textAnchor="middle"
            style={{ fill: TEXT_MUTED, fontFamily: "var(--font-family-ui)" }}
          >
            {camera.label}
          </text>
        </g>
      ))}
    </g>
  );
}
