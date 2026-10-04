import type { StudioLayout } from "../studioLayout";

export interface StudioFloorProps {
  layout: StudioLayout;
}

// The visual overhaul's Lighting page (2026-10-04): the room in the plot's
// neutral inks; the bench's and the cameras' names are drawn by the plot's
// overlay at one size (`StagePlotOverlay`), not here in centimetres.
const WALL_COLOR = "var(--material-line2)";
const WALL_STROKE = "var(--text-text4)";
const FLOOR_COLOR = "var(--material-floor)";
const ELEMENT_FILL = "var(--material-key)";
const ELEMENT_STROKE = "var(--material-line2)";

export function StudioFloor({ layout }: StudioFloorProps) {
  const widthCm = layout.roomWidthMeters * 100;
  const depthCm = layout.roomDepthMeters * 100;

  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={widthCm} height={depthCm} style={{ fill: FLOOR_COLOR }} />
      <rect
        x={0}
        y={0}
        width={widthCm}
        height={depthCm}
        fill="none"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: WALL_STROKE, strokeWidth: 1 }}
      />
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
          style={{ fill: FLOOR_COLOR, stroke: ELEMENT_STROKE, strokeWidth: 1 }}
        />
      ) : null}
      {layout.walls.controlBoothWindow ? (
        <rect
          x={layout.walls.controlBoothWindow.offsetMeters * 100}
          y={depthCm - 10}
          width={layout.walls.controlBoothWindow.widthMeters * 100}
          height={10}
          style={{
            // LGS-02: de-blued control-booth window -> the neutral set-element
            // family (matches the bench/structure treatment), no retired hue.
            fill: ELEMENT_FILL,
            stroke: ELEMENT_STROKE,
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
            </g>
          );
        }
        return null;
      })}
      {layout.cameras.map((camera) => (
        <g
          key={camera.id}
          transform={`translate(${camera.xMeters * 100}, ${camera.yMeters * 100}) rotate(${camera.rotationDegrees})`}
        >
          <polygon
            points="-10,8 10,8 0,-12"
            style={{ fill: ELEMENT_FILL, stroke: "var(--text-text3)", strokeWidth: 1 }}
          />
        </g>
      ))}
    </g>
  );
}
