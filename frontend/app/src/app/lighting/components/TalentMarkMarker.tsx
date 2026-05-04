import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { StudioTalentMark } from "../studioLayout";

const CLICK_PX_THRESHOLD = 4;
const SNAP_METERS = 0.5;
const KEY_NUDGE_METERS = 0.1;
const KEY_NUDGE_FAST_METERS = 0.5;

const TALENT_FILL = "rgba(232, 213, 97, 0.12)";
const TALENT_STROKE = "var(--color-studio-talent-ring)";
const TALENT_DOT = "var(--color-studio-talent-dot)";

interface TalentMarkMarkerProps {
  depthCm: number;
  mark: StudioTalentMark;
  onPositionCommit?: (id: string, xMeters: number, yMeters: number) => void;
  widthCm: number;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  movedPx: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function snapMeters(value: number) {
  return Math.round(value / SNAP_METERS) * SNAP_METERS;
}

function formatMeters(valueCm: number) {
  return (valueCm / 100).toFixed(1);
}

export function TalentMarkMarker({ depthCm, mark, onPositionCommit, widthCm }: TalentMarkMarkerProps) {
  const markerRef = useRef<SVGGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const ghostRef = useRef<{ x: number; y: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const centerX = mark.xMeters * 100;
  const centerY = mark.yMeters * 100;
  const renderX = ghost?.x ?? centerX;
  const renderY = ghost?.y ?? centerY;
  const draggable = Boolean(onPositionCommit);
  const displayLabel = mark.label.length > 16 ? `${mark.label.slice(0, 15)}…` : mark.label;

  const clientToInner = (clientX: number, clientY: number) => {
    const target = markerRef.current;
    const parent = target?.parentNode;
    const owner = target?.ownerSVGElement;
    if (!(parent instanceof SVGGraphicsElement) || !owner) return null;
    const ctm = parent.getScreenCTM();
    if (!ctm) return null;
    const point = owner.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(ctm.inverse());
  };

  const updateDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !draggable) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    drag.movedPx = Math.max(drag.movedPx, Math.hypot(dx, dy));
    if (drag.movedPx < CLICK_PX_THRESHOLD) return;

    const startInner = clientToInner(drag.startClientX, drag.startClientY);
    const nowInner = clientToInner(event.clientX, event.clientY);
    if (!startInner || !nowInner) return;
    const nextGhost = {
      x: clamp(drag.startX + (nowInner.x - startInner.x), 0, widthCm),
      y: clamp(drag.startY + (nowInner.y - startInner.y), 0, depthCm),
    };
    ghostRef.current = nextGhost;
    setGhost(nextGhost);
  };

  const finishDrag = (event: ReactPointerEvent<SVGGElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort for SVG nodes in the webview.
    }
    dragRef.current = null;
    const wasDrag = drag.movedPx >= CLICK_PX_THRESHOLD;
    const ghostNow = ghostRef.current;
    ghostRef.current = null;
    setGhost(null);

    if (cancelled || !wasDrag || !ghostNow || !onPositionCommit) return;
    const xMeters = event.altKey ? ghostNow.x / 100 : snapMeters(ghostNow.x / 100);
    const yMeters = event.altKey ? ghostNow.y / 100 : snapMeters(ghostNow.y / 100);
    onPositionCommit(mark.id, clamp(xMeters, 0, widthCm / 100), clamp(yMeters, 0, depthCm / 100));
  };

  const commitKeyboardMove = (event: ReactKeyboardEvent<SVGGElement>) => {
    if (!onPositionCommit) return;
    const step = event.shiftKey ? KEY_NUDGE_FAST_METERS : KEY_NUDGE_METERS;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    if (event.key === "ArrowRight") dx = step;
    if (event.key === "ArrowUp") dy = -step;
    if (event.key === "ArrowDown") dy = step;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onPositionCommit(
      mark.id,
      clamp(Math.round((mark.xMeters + dx) * 10) / 10, 0, widthCm / 100),
      clamp(Math.round((mark.yMeters + dy) * 10) / 10, 0, depthCm / 100)
    );
  };

  return (
    <g
      ref={markerRef}
      role="button"
      tabIndex={0}
      aria-label={`${mark.label} talent mark at ${mark.xMeters.toFixed(1)} meters by ${mark.yMeters.toFixed(1)} meters`}
      data-testid={`talent-mark-${mark.id}`}
      onKeyDown={commitKeyboardMove}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startX: centerX,
          startY: centerY,
          movedPx: 0,
        };
        if (!draggable) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is best-effort for SVG nodes in the webview.
        }
      }}
      onPointerMove={updateDrag}
      onPointerUp={(event) => finishDrag(event)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{ cursor: draggable ? (ghost ? "grabbing" : "grab") : "default", outline: "none" }}
    >
      {ghost ? (
        <circle cx={centerX} cy={centerY} r={16} fill="none" strokeDasharray="3 3" style={{ stroke: TALENT_STROKE }} />
      ) : null}
      <g transform={`translate(${renderX}, ${renderY})`}>
        <circle
          r={17}
          style={{ fill: TALENT_FILL, stroke: TALENT_STROKE, strokeWidth: hovered || ghost ? 1.8 : 1.2 }}
        />
        <circle cy={-6} r={3.2} style={{ fill: TALENT_DOT }} />
        <path
          d="M -8 4 C -5 -2, 5 -2, 8 4"
          fill="none"
          strokeLinecap="round"
          style={{ stroke: TALENT_DOT, strokeWidth: 2 }}
        />
        <ellipse cx={-4.5} cy={9} rx={2.2} ry={4.4} transform="rotate(-13 -4.5 9)" style={{ fill: TALENT_DOT }} />
        <ellipse cx={4.5} cy={9} rx={2.2} ry={4.4} transform="rotate(13 4.5 9)" style={{ fill: TALENT_DOT }} />
        <rect
          x={-31}
          y={20}
          width={62}
          height={16}
          rx={3}
          style={{ fill: "var(--color-bg-canvas)", stroke: TALENT_STROKE }}
        />
        <text
          x={0}
          y={31}
          textAnchor="middle"
          fontSize={8.5}
          fontWeight={700}
          letterSpacing={0}
          pointerEvents="none"
          style={{
            fill: "var(--color-brand-text-primary)",
            fontFamily: "var(--font-family-mono)",
            textTransform: "uppercase",
          }}
        >
          {displayLabel}
        </text>
      </g>
      {ghost ? (
        <g pointerEvents="none">
          <rect
            x={ghost.x + 12}
            y={ghost.y - 31}
            width={70}
            height={18}
            rx={3}
            style={{ fill: "var(--color-bg-canvas)", stroke: TALENT_STROKE, strokeWidth: 0.8 }}
          />
          <text
            x={ghost.x + 47}
            y={ghost.y - 19}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            style={{ fill: "var(--color-brand-text-primary)", fontFamily: "var(--font-family-mono)" }}
          >
            {formatMeters(ghost.x)} m, {formatMeters(ghost.y)} m
          </text>
        </g>
      ) : null}
    </g>
  );
}
