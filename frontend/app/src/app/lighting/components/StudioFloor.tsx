import type { StudioLayout } from "../studioLayout";

export interface StudioFloorProps {
  layout: StudioLayout;
}

const WALL_COLOR = "#4d5544";
const WALL_STROKE = "#6b7560";
const FLOOR_COLOR = "#080a08";
const TEXT_MUTED = "#5a5547";
const ELEMENT_FILL = "rgba(108, 116, 96, 0.18)";
const ELEMENT_STROKE = "rgba(108, 116, 96, 0.5)";

export function StudioFloor({ layout }: StudioFloorProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;

  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={widthCm} height={depthCm} fill={FLOOR_COLOR} />
      <rect
        x={0}
        y={0}
        width={widthCm}
        height={depthCm}
        fill="none"
        stroke={WALL_STROKE}
        strokeWidth={2}
      />
      {layout.walls.backdrop ? (
        <rect x={0} y={0} width={widthCm} height={20} fill={WALL_COLOR} opacity={0.5} />
      ) : null}
      {layout.walls.door ? (
        <rect
          x={layout.walls.door.wall === "east" ? widthCm - 8 : 0}
          y={layout.walls.door.offsetMeters * 100}
          width={layout.walls.door.wall === "east" || layout.walls.door.wall === "west" ? 8 : layout.walls.door.widthMeters * 100}
          height={
            layout.walls.door.wall === "east" || layout.walls.door.wall === "west"
              ? layout.walls.door.widthMeters * 100
              : 8
          }
          fill={FLOOR_COLOR}
          stroke="rgba(212, 205, 179, 0.32)"
          strokeWidth={1}
          strokeDasharray="6 4"
        />
      ) : null}
      {layout.walls.controlBoothWindow ? (
        <rect
          x={layout.walls.controlBoothWindow.offsetMeters * 100}
          y={depthCm - 10}
          width={layout.walls.controlBoothWindow.widthMeters * 100}
          height={10}
          fill="rgba(63, 112, 200, 0.25)"
          stroke="rgba(63, 112, 200, 0.55)"
          strokeWidth={1}
        />
      ) : null}
      {layout.setElements.map((element, index) => {
        if (element.kind === "bench") {
          const w = element.widthMeters * 100;
          const d = element.depthMeters * 100;
          return (
            <g key={`set-${index}`} transform={`translate(${element.xMeters * 100 - w / 2}, ${element.yMeters * 100 - d / 2})`}>
              <rect width={w} height={d} fill={ELEMENT_FILL} stroke={ELEMENT_STROKE} rx={4} />
              <text x={w / 2} y={d / 2 + 4} fontSize={10} fill={TEXT_MUTED} textAnchor="middle" fontFamily="Inter, system-ui, sans-serif">
                {element.label}
              </text>
            </g>
          );
        }
        return null;
      })}
      {layout.talentMarks.map((mark, index) => (
        <g key={`talent-${index}`}>
          <circle cx={mark.xMeters * 100} cy={mark.yMeters * 100} r={6} fill="none" stroke="rgba(232, 213, 97, 0.45)" strokeWidth={1} strokeDasharray="3 3" />
          <circle cx={mark.xMeters * 100} cy={mark.yMeters * 100} r={1.5} fill="rgba(232, 213, 97, 0.7)" />
        </g>
      ))}
      {layout.cameras.map((camera) => (
        <g
          key={camera.id}
          transform={`translate(${camera.xMeters * 100}, ${camera.yMeters * 100}) rotate(${camera.rotationDegrees})`}
        >
          <polygon points="-10,8 10,8 0,-12" fill="rgba(108, 169, 209, 0.22)" stroke="rgba(108, 169, 209, 0.6)" strokeWidth={1} />
          <text y={20} fontSize={10} fill={TEXT_MUTED} textAnchor="middle" fontFamily="Inter, system-ui, sans-serif">
            {camera.label}
          </text>
        </g>
      ))}
    </g>
  );
}
