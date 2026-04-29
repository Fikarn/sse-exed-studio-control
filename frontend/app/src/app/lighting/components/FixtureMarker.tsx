import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import type { FixtureMounting } from "../fixtureMounting";
import { lightingFixtureColor } from "../lightingHelpers";

const SNAP_METERS = 0.5;
const CLICK_PX_THRESHOLD = 4;

export interface FixtureMarkerProps {
  id: string;
  name: string;
  /** Center in viewBox cm (= meters * 100). */
  centerX: number;
  /** Center in viewBox cm (= meters * 100). */
  centerY: number;
  rotationDegrees: number;
  mounting: FixtureMounting;
  intensity: number;
  cct: number;
  on: boolean;
  selected: boolean;
  dimmed?: boolean;
  onSelect: (id: string, options: { additive: boolean }) => void;
  /**
   * Optional commit callback when the marker is dragged. xMeters / yMeters
   * are already snapped to the 0.5 m grid unless Alt was held on pointerup.
   * When omitted the marker is non-draggable; pointerdown still stops
   * propagation so a click selects the fixture.
   */
  onPositionCommit?: (id: string, xMeters: number, yMeters: number) => void;
}

const SHELL_FILL = "rgba(8, 9, 10, 0.92)";
const SHELL_STROKE = "rgba(212, 205, 179, 0.4)";
const SELECTED_STROKE = "#99BA92";
const GHOST_STROKE = "rgba(153, 186, 146, 0.45)";

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

function snapMeter(value: number): number {
  return Math.round(value / SNAP_METERS) * SNAP_METERS;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCenterX: number;
  startCenterY: number;
  movedPx: number;
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
  onPositionCommit,
}: FixtureMarkerProps) {
  const color = lightingFixtureColor(cct, on);
  const dotOpacity = on ? Math.max(0.3, intensity / 100) : 0.18;

  const dragRef = useRef<DragState | null>(null);
  // Ghost position in cm — set during an active drag once the threshold is
  // crossed, cleared on pointerup. Rendered at the new position so the
  // visual follows the cursor; the original (centerX, centerY) gets a
  // dashed shadow to anchor the move.
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  // Show a green focus ring around the marker when keyboard focus lands on
  // it (and only on keyboard focus — pointer interactions don't trigger).
  const [keyboardFocused, setKeyboardFocused] = useState(false);

  // Per the v6 prototype: name + meta lines sit above the marker, not rotated
  // with the fixture body. Label upper-cased to match the prototype's
  // "APOLLO L" / "ASTRA L" style.
  const displayName = name.toUpperCase();
  const intensityLabel = on ? `${Math.round(intensity)}%` : "OFF";
  const metaLabel = `${intensityLabel} · ${Math.round(cct)} K · ${MOUNTING_SHORT_LABEL[mounting]}`;

  // Wall-bar markers are wide; lift labels slightly to clear the bar.
  const nameOffsetY = mounting === "wall-bar" ? -16 : -32;
  const metaOffsetY = mounting === "wall-bar" ? -28 : -46;

  const draggable = Boolean(onPositionCommit);
  const renderX = ghost?.x ?? centerX;
  const renderY = ghost?.y ?? centerY;
  const cursorStyle = draggable ? (ghost ? "grabbing" : "grab") : "pointer";

  const handlePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    event.stopPropagation();
    if (!draggable || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCenterX: centerX,
      startCenterY: centerY,
      movedPx: 0,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    drag.movedPx = Math.max(drag.movedPx, Math.hypot(dx, dy));
    if (drag.movedPx < CLICK_PX_THRESHOLD) return;

    // Use the marker's parent <g> CTM (which includes the viewport
    // pan+zoom transform) to convert client px → inner cm. This keeps the
    // drag math correct under any zoom level without exposing zoom/pan.
    const parent = event.currentTarget.parentNode;
    const owner = event.currentTarget.ownerSVGElement;
    if (!(parent instanceof SVGGraphicsElement) || !owner) return;
    const ctm = parent.getScreenCTM();
    if (!ctm) return;
    const inverse = ctm.inverse();

    const startPt = owner.createSVGPoint();
    startPt.x = drag.startClientX;
    startPt.y = drag.startClientY;
    const nowPt = owner.createSVGPoint();
    nowPt.x = event.clientX;
    nowPt.y = event.clientY;
    const startInner = startPt.matrixTransform(inverse);
    const nowInner = nowPt.matrixTransform(inverse);

    setGhost({
      x: drag.startCenterX + (nowInner.x - startInner.x),
      y: drag.startCenterY + (nowInner.y - startInner.y),
    });
  };

  const finishDrag = (event: ReactPointerEvent<SVGGElement>, kind: "up" | "cancel") => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const wasDrag = drag.movedPx >= CLICK_PX_THRESHOLD;
    const ghostNow = ghost;
    dragRef.current = null;
    setGhost(null);

    if (kind === "cancel") return;

    if (wasDrag && ghostNow && onPositionCommit) {
      const altHeld = event.altKey;
      let xMeters = ghostNow.x / 100;
      let yMeters = ghostNow.y / 100;
      if (!altHeld) {
        xMeters = snapMeter(xMeters);
        yMeters = snapMeter(yMeters);
      }
      onPositionCommit(id, xMeters, yMeters);
    } else {
      onSelect(id, { additive: event.shiftKey });
    }
  };

  const intensityWord = on ? `${Math.round(intensity)} percent` : "off";
  const ariaLabel = `Fixture ${name}, ${intensityWord}, ${Math.round(cct)} kelvin, ${MOUNTING_SHORT_LABEL[mounting]} mount`;

  const handleKeyDown = (event: ReactKeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      onSelect(id, { additive: event.shiftKey });
    }
  };

  return (
    <g
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishDrag(event, "up")}
      onPointerCancel={(event) => finishDrag(event, "cancel")}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        // Only treat focus as keyboard-driven when :focus-visible matches —
        // pointer-driven focus shouldn't surface the keyboard ring. Browsers
        // without :focus-visible on SVG nodes fall back to always showing
        // the ring on focus, which is still accessible if a touch noisier.
        try {
          if (typeof event.currentTarget.matches === "function" && !event.currentTarget.matches(":focus-visible")) {
            return;
          }
        } catch {
          // Ignore — show the ring anyway.
        }
        setKeyboardFocused(true);
      }}
      onBlur={() => setKeyboardFocused(false)}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      style={{ cursor: cursorStyle, opacity: dimmed ? 0.35 : 1, outline: "none" }}
      data-fixture-id={id}
    >
      {ghost ? (
        <g transform={`translate(${centerX}, ${centerY}) rotate(${rotationDegrees})`} opacity={0.35}>
          <circle
            r={mounting === "wall-bar" ? 26 : 14}
            fill="none"
            stroke={GHOST_STROKE}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </g>
      ) : null}
      <g transform={`translate(${renderX}, ${renderY}) rotate(${rotationDegrees})`}>
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
      {/* Focus ring — only visible on keyboard focus, mirrors SELECTED_STROKE
          in green so screen-magnifier users can spot the focused marker. */}
      {keyboardFocused ? (
        <circle
          cx={renderX}
          cy={renderY}
          r={mounting === "wall-bar" ? 30 : 18}
          fill="none"
          stroke={SELECTED_STROKE}
          strokeWidth={2}
          pointerEvents="none"
        />
      ) : null}
      <text
        x={renderX}
        y={renderY + nameOffsetY}
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
        x={renderX}
        y={renderY + metaOffsetY}
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
