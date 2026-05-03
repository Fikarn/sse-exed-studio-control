import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Pencil, Sparkles, Trash2 } from "lucide-react";

import { ContextMenu, type ContextMenuItem } from "@sse/design-system";

import type { FixtureMounting } from "../fixtureMounting";
import type { FixtureVisualModel, StagePlotRenderMode } from "../fixtureVisuals";
import { lightingFixtureColor } from "../lightingHelpers";

import { FixtureSymbol } from "./FixtureSymbol";

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
  renderMode: StagePlotRenderMode;
  visual: FixtureVisualModel;
  intensity: number;
  cct: number;
  on: boolean;
  selected: boolean;
  dimmed?: boolean;
  /** Render an animated pulse ring while the engine identify burst is live. */
  identifying?: boolean;
  /** Wave 29 — operator-selected target of the active Highlight or Solo
   *  overlay. Renders a sustained orange outline ring distinct from the
   *  green selection ring. Engine-driven brightness changes (snapshot
   *  on/intensity/cct) handle the actual fixture rendering; this prop
   *  marks "this is what I picked" so the selection is unambiguous when
   *  the operator's eye scans the plot. */
  highlightOverlay?: boolean;
  /** Wave 31 — I9 chip-hover signal. When the operator hovers the
   *  matching chip in the SelectionChipStrip, this fixture's marker
   *  gets a single-pulse ring so the chip ↔ marker pairing is clear. */
  chipHovered?: boolean;
  onSelect: (id: string, options: { additive: boolean }) => void;
  /**
   * Optional commit callback when the marker is dragged. xMeters / yMeters
   * are already snapped to the 0.5 m grid unless Alt was held on pointerup.
   * When omitted the marker is non-draggable; pointerdown still stops
   * propagation so a click selects the fixture.
   */
  onPositionCommit?: (id: string, xMeters: number, yMeters: number) => void;
  /** Optional commit callback when the selected marker's rotate handle is dragged. */
  onRotationCommit?: (id: string, rotationDegrees: number) => void;
  /** Right-click "Rename" — selects the fixture for inspection and triggers
   *  the inspector's inline rename. Parent owns the signal plumbing. */
  onRequestRename?: (id: string) => void;
  /** Right-click "Identify" — fires an identify burst on the fixture. */
  onIdentify?: (id: string, name: string) => void;
  /** Right-click "Delete" — parent shows the confirm dialog. */
  onRequestDelete?: (id: string, name: string) => void;
  /** Live drag callback for the parent's smart-guide layer. Fires on every
   *  pointermove past the click threshold with the in-flight (xMeters, yMeters)
   *  in studio coordinates and whether Alt is held (free-positioning, snap off). */
  onDragMove?: (id: string, xMeters: number, yMeters: number, altKey: boolean) => void;
  /** Fires when drag ends (commit or cancel) so the parent can hold the
   *  snapped drop position until the engine snapshot refresh catches up. */
  onDragEnd?: (id: string, committedPosition: { xMeters: number; yMeters: number } | null) => void;
  /** Live rotation callback for render-only layers such as beam footprints. */
  onRotationMove?: (id: string, rotationDegrees: number) => void;
  /** Fires when rotation ends so the parent can hold the snapped angle until
   *  the engine snapshot refresh catches up. */
  onRotationEnd?: (id: string, committedRotationDegrees: number | null) => void;
}

// I1 — intensity bar geometry. Anchored to the bottom edge of the marker
// shape so all mountings share a consistent visual rhythm. Width / height are
// in viewBox cm units; the bar doesn't rotate with the marker (lives outside
// the rotated <g> like the text labels).
const BAR_WIDTH = 4;
const BAR_HEIGHT = 24;

const SHELL_STROKE = "var(--color-fixture-shell-stroke)";
const SELECTED_STROKE = "var(--color-brand-green)";
const HIGHLIGHT_OVERLAY_STROKE = "var(--color-status-warning, #ff6b35)";
const GHOST_STROKE = "var(--color-fixture-ghost-stroke)";

const LABEL_NAME_FILL = "var(--color-brand-text-secondary)";
const LABEL_META_FILL = "var(--color-brand-text-muted)";

const MOUNTING_SHORT_LABEL: Record<FixtureMounting, string> = {
  bar: "bar",
  "control-node": "node",
  fresnel: "spot",
  mat: "mat",
  panel: "panel",
};

function ringRadius(visual: FixtureVisualModel, padding: number) {
  return Math.max(14, Math.min(40, Math.max(visual.body.width, visual.body.height) / 2 + padding));
}

function snapMeter(value: number): number {
  return Math.round(value / SNAP_METERS) * SNAP_METERS;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function roundedDegrees(value: number): number {
  return Math.round(normalizeDegrees(value)) % 360;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCenterX: number;
  startCenterY: number;
  movedPx: number;
}

interface RotationDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  movedPx: number;
  latestDegrees: number;
}

export function FixtureMarker({
  id,
  name,
  centerX,
  centerY,
  rotationDegrees,
  mounting,
  renderMode,
  visual,
  intensity,
  cct,
  on,
  selected,
  dimmed = false,
  identifying = false,
  highlightOverlay = false,
  chipHovered = false,
  onSelect,
  onPositionCommit,
  onRotationCommit,
  onRequestRename,
  onIdentify,
  onRequestDelete,
  onDragMove,
  onDragEnd,
  onRotationMove,
  onRotationEnd,
}: FixtureMarkerProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const color = lightingFixtureColor(cct, on);
  const dotOpacity = on ? Math.max(0.3, intensity / 100) : 0.18;

  const dragRef = useRef<DragState | null>(null);
  const rotationDragRef = useRef<RotationDragState | null>(null);
  const markerRef = useRef<SVGGElement | null>(null);
  const rotateHandleRef = useRef<SVGCircleElement | null>(null);
  const globalDragCleanupRef = useRef<(() => void) | null>(null);
  // Ghost position in cm — set during an active drag once the threshold is
  // crossed, cleared on pointerup. Rendered at the new position so the
  // visual follows the cursor; the original (centerX, centerY) gets a
  // dashed shadow to anchor the move.
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<{ x: number; y: number } | null>(null);
  const [rotationGhost, setRotationGhost] = useState<number | null>(null);
  const rotationGhostRef = useRef<number | null>(null);
  const [pointerHovered, setPointerHovered] = useState(false);
  // Show a green focus ring around the marker when keyboard focus lands on
  // it (and only on keyboard focus — pointer interactions don't trigger).
  // The :focus-visible CSS pseudo-class is unreliable on SVG <g> in Chromium
  // webviews, so we shim with matches(":focus-visible") inside onFocus and a
  // try/catch fallback for older engines. Retained intentionally per
  // audit-fix-plan #29 / Wave 21 finding #30.
  const [keyboardFocused, setKeyboardFocused] = useState(false);

  // Per the v6 prototype: name + meta lines sit above the marker, not rotated
  // with the fixture body. Uppercase styling lives in CSS so the aria-label
  // can reuse the original mixed-case name for screen readers (closes #35).
  const displayName = name.length > 18 ? `${name.slice(0, 17)}…` : name;
  const intensityLabel = on ? `${Math.round(intensity)}%` : "OFF";
  const metaLabel = `${intensityLabel} · ${Math.round(cct)} K · ${MOUNTING_SHORT_LABEL[mounting]}`;

  const nameOffsetY = -Math.max(16, visual.body.height / 2 + 14);
  const metaOffsetY = nameOffsetY - 14;

  const draggable = Boolean(onPositionCommit);
  const renderX = ghost?.x ?? centerX;
  const renderY = ghost?.y ?? centerY;
  const rotationRenderDegrees = rotationGhost ?? rotationDegrees;
  const canRotate = Boolean(onRotationCommit);
  const cursorStyle = draggable ? (ghost ? "grabbing" : "grab") : "pointer";
  const intensityBarX = renderX - BAR_WIDTH / 2;
  const intensityBarY = renderY + visual.body.height / 2 + 4;
  const intensityBarFillFrac = on ? Math.max(0, Math.min(1, intensity / 100)) : 0;
  const intensityBarFillHeight = BAR_HEIGHT * intensityBarFillFrac;
  const intensityBarFillY = intensityBarY + (BAR_HEIGHT - intensityBarFillHeight);
  const intensityBarFillColor = lightingFixtureColor(cct, true);
  const hitWidth = Math.max(44, visual.body.width + 18);
  const hitHeight = Math.max(44, visual.body.height + 18);
  const rotateHandleRadius = ringRadius(visual, 15);
  const rotateHandleVisible = canRotate && (selected || pointerHovered || keyboardFocused || rotationGhost !== null);

  const clearGlobalDragListeners = () => {
    globalDragCleanupRef.current?.();
    globalDragCleanupRef.current = null;
  };

  useEffect(
    () => () => {
      globalDragCleanupRef.current?.();
      globalDragCleanupRef.current = null;
    },
    []
  );

  const updateDragFromPointer = (pointerId: number, clientX: number, clientY: number, altKey: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId || !draggable) return;
    const dx = clientX - drag.startClientX;
    const dy = clientY - drag.startClientY;
    drag.movedPx = Math.max(drag.movedPx, Math.hypot(dx, dy));
    if (drag.movedPx < CLICK_PX_THRESHOLD) return;

    // Use the marker's parent <g> CTM (which includes the viewport
    // pan+zoom transform) to convert client px → inner cm. This keeps the
    // drag math correct under any zoom level without exposing zoom/pan.
    const target = markerRef.current;
    const parent = target?.parentNode;
    const owner = target?.ownerSVGElement;
    if (!(parent instanceof SVGGraphicsElement) || !owner) return;
    const ctm = parent.getScreenCTM();
    if (!ctm) return;
    const inverse = ctm.inverse();

    const startPt = owner.createSVGPoint();
    startPt.x = drag.startClientX;
    startPt.y = drag.startClientY;
    const nowPt = owner.createSVGPoint();
    nowPt.x = clientX;
    nowPt.y = clientY;
    const startInner = startPt.matrixTransform(inverse);
    const nowInner = nowPt.matrixTransform(inverse);

    const nextX = drag.startCenterX + (nowInner.x - startInner.x);
    const nextY = drag.startCenterY + (nowInner.y - startInner.y);
    const nextGhost = { x: nextX, y: nextY };
    ghostRef.current = nextGhost;
    setGhost(nextGhost);
    // F9 — surface live drag position to the parent so the smart-guide layer
    // can compute alignment lines vs. other fixtures. Pre-snap meters; the
    // commit handler still applies the 0.5 m snap on pointerup.
    onDragMove?.(id, nextX / 100, nextY / 100, altKey);
  };

  const finishDragFromPointer = (pointerId: number, altKey: boolean, shiftKey: boolean, kind: "up" | "cancel") => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const target = markerRef.current;
    try {
      if (target?.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture is best-effort on SVG nodes across webviews.
    }
    clearGlobalDragListeners();
    const wasDrag = drag.movedPx >= CLICK_PX_THRESHOLD;
    const ghostNow = ghostRef.current;
    let committedPosition: { xMeters: number; yMeters: number } | null = null;

    if (kind !== "cancel" && wasDrag && ghostNow && onPositionCommit) {
      let xMeters = ghostNow.x / 100;
      let yMeters = ghostNow.y / 100;
      if (!altKey) {
        xMeters = snapMeter(xMeters);
        yMeters = snapMeter(yMeters);
      }
      committedPosition = { xMeters, yMeters };
    }

    onDragEnd?.(id, committedPosition);
    dragRef.current = null;
    ghostRef.current = null;
    setGhost(null);

    if (kind === "cancel") return;

    if (committedPosition && onPositionCommit) {
      onPositionCommit(id, committedPosition.xMeters, committedPosition.yMeters);
    } else {
      onSelect(id, { additive: shiftKey });
    }
  };

  const bindGlobalDragListeners = (ownerDocument: Document) => {
    const view = ownerDocument.defaultView;
    if (!view) return;
    clearGlobalDragListeners();
    const handleMove = (event: PointerEvent) => {
      updateDragFromPointer(event.pointerId, event.clientX, event.clientY, event.altKey);
    };
    const handleUp = (event: PointerEvent) => {
      finishDragFromPointer(event.pointerId, event.altKey, event.shiftKey, "up");
    };
    const handleCancel = (event: PointerEvent) => {
      finishDragFromPointer(event.pointerId, event.altKey, event.shiftKey, "cancel");
    };
    view.addEventListener("pointermove", handleMove);
    view.addEventListener("pointerup", handleUp);
    view.addEventListener("pointercancel", handleCancel);
    globalDragCleanupRef.current = () => {
      view.removeEventListener("pointermove", handleMove);
      view.removeEventListener("pointerup", handleUp);
      view.removeEventListener("pointercancel", handleCancel);
    };
  };

  const clientPointToInner = (clientX: number, clientY: number) => {
    const fallbackTarget = rotateHandleRef.current?.closest("[data-fixture-id]");
    const target = markerRef.current ?? (fallbackTarget instanceof SVGGraphicsElement ? fallbackTarget : null);
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

  const updateRotationFromPointer = (pointerId: number, clientX: number, clientY: number) => {
    const drag = rotationDragRef.current;
    if (!drag || drag.pointerId !== pointerId || !canRotate) return;
    const dx = clientX - drag.startClientX;
    const dy = clientY - drag.startClientY;
    drag.movedPx = Math.max(drag.movedPx, Math.hypot(dx, dy));

    const point = clientPointToInner(clientX, clientY);
    if (!point) return;
    const rawDegrees = (Math.atan2(point.y - centerY, point.x - centerX) * 180) / Math.PI + 90;
    const nextDegrees = normalizeDegrees(rawDegrees);
    drag.latestDegrees = nextDegrees;
    rotationGhostRef.current = nextDegrees;
    setRotationGhost(nextDegrees);
    onRotationMove?.(id, nextDegrees);
  };

  const finishRotationFromPointer = (pointerId: number, kind: "up" | "cancel") => {
    const drag = rotationDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const target = markerRef.current;
    try {
      if (target?.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture is best-effort on SVG nodes across webviews.
    }
    clearGlobalDragListeners();
    const wasDrag = drag.movedPx >= CLICK_PX_THRESHOLD;
    const rotationNow = rotationGhostRef.current;
    const committedRotationDegrees =
      kind === "up" && wasDrag && rotationNow !== null && onRotationCommit ? roundedDegrees(rotationNow) : null;
    onRotationEnd?.(id, committedRotationDegrees);
    rotationDragRef.current = null;
    rotationGhostRef.current = null;
    setRotationGhost(null);

    if (committedRotationDegrees !== null && onRotationCommit) {
      onRotationCommit(id, committedRotationDegrees);
    }
  };

  const bindGlobalRotationListeners = (ownerDocument: Document) => {
    const view = ownerDocument.defaultView;
    if (!view) return;
    clearGlobalDragListeners();
    const handleMove = (event: PointerEvent) => {
      updateRotationFromPointer(event.pointerId, event.clientX, event.clientY);
    };
    const handleUp = (event: PointerEvent) => {
      finishRotationFromPointer(event.pointerId, "up");
    };
    const handleCancel = (event: PointerEvent) => {
      finishRotationFromPointer(event.pointerId, "cancel");
    };
    view.addEventListener("pointermove", handleMove);
    view.addEventListener("pointerup", handleUp);
    view.addEventListener("pointercancel", handleCancel);
    globalDragCleanupRef.current = () => {
      view.removeEventListener("pointermove", handleMove);
      view.removeEventListener("pointerup", handleUp);
      view.removeEventListener("pointercancel", handleCancel);
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    event.stopPropagation();
    markerRef.current = event.currentTarget;
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCenterX: centerX,
      startCenterY: centerY,
      movedPx: 0,
    };
    if (!draggable) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window-level listeners below keep drag working where SVG capture is unavailable.
    }
    bindGlobalDragListeners(event.currentTarget.ownerDocument);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    updateDragFromPointer(event.pointerId, event.clientX, event.clientY, event.altKey);
  };

  const finishDrag = (event: ReactPointerEvent<SVGGElement>, kind: "up" | "cancel") => {
    finishDragFromPointer(event.pointerId, event.altKey, event.shiftKey, kind);
  };

  useEffect(() => {
    const node = rotateHandleRef.current;
    if (!node || !canRotate) return undefined;

    const handleNativePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const marker = node.closest("[data-fixture-id]");
      if (marker instanceof SVGGraphicsElement) {
        markerRef.current = marker;
      }
      if (event.button !== 0) return;
      rotationDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        movedPx: 0,
        latestDegrees: normalizeDegrees(rotationDegrees),
      };
      rotationGhostRef.current = normalizeDegrees(rotationDegrees);
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // Window-level listeners below keep rotation working where SVG capture is unavailable.
      }
      bindGlobalRotationListeners(node.ownerDocument);
    };

    node.addEventListener("pointerdown", handleNativePointerDown);
    return () => node.removeEventListener("pointerdown", handleNativePointerDown);
  });

  const intensityWord = on ? `${Math.round(intensity)} percent` : "off";
  const ariaLabel = `Fixture ${name}, ${intensityWord}, ${Math.round(cct)} kelvin, ${MOUNTING_SHORT_LABEL[mounting]} mount, ${roundedDegrees(rotationDegrees)} degrees`;
  const labelVisible =
    selected || pointerHovered || keyboardFocused || identifying || highlightOverlay || chipHovered || ghost !== null;

  const handleKeyDown = (event: ReactKeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      onSelect(id, { additive: event.shiftKey });
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<SVGGElement>) => {
    if (!onRequestRename && !onIdentify && !onRequestDelete) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const menuItems: ContextMenuItem[] = [];
  if (onRequestRename) {
    menuItems.push({
      id: "rename",
      label: "Rename",
      icon: Pencil,
      onSelect: () => onRequestRename(id),
    });
  }
  if (onIdentify) {
    menuItems.push({
      id: "identify",
      label: "Identify (1.2 s burst)",
      icon: Sparkles,
      onSelect: () => onIdentify(id, name),
    });
  }
  if (onRequestDelete) {
    menuItems.push({
      id: "delete",
      label: "Delete fixture…",
      icon: Trash2,
      tone: "danger",
      onSelect: () => onRequestDelete(id, name),
    });
  }

  return (
    <>
      <g
        ref={markerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event, "up")}
        onPointerCancel={(event) => finishDrag(event, "cancel")}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onPointerEnter={() => setPointerHovered(true)}
        onPointerLeave={() => setPointerHovered(false)}
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
              r={ringRadius(visual, 4)}
              fill="none"
              strokeDasharray="3 3"
              style={{ stroke: GHOST_STROKE, strokeWidth: 1 }}
            />
          </g>
        ) : null}
        <g
          transform={`translate(${renderX}, ${renderY}) rotate(${rotationRenderDegrees})`}
          filter="url(#sse-fixture-shadow)"
        >
          <rect
            x={-hitWidth / 2}
            y={-hitHeight / 2}
            width={hitWidth}
            height={hitHeight}
            rx={4}
            fill="transparent"
            pointerEvents="all"
          />
          <FixtureSymbol cct={cct} intensity={intensity} on={on} renderMode={renderMode} visual={visual} />
          <circle r={3.6} fill={color} fillOpacity={dotOpacity} />
          {selected ? (
            <circle
              r={ringRadius(visual, 4)}
              fill="none"
              strokeDasharray="4 3"
              style={{ stroke: SELECTED_STROKE, strokeWidth: 1.5 }}
            />
          ) : null}
          {/* Wave 29 — Highlight / Solo target ring. Sustained (not
              dashed) orange outline so it reads at a glance even on
              fixtures that are also `selected`. Sits at a slightly
              larger radius than the selection ring so both can render
              without overlap when both prop are set. */}
          {highlightOverlay ? (
            <circle
              r={ringRadius(visual, 7)}
              fill="none"
              style={{ stroke: HIGHLIGHT_OVERLAY_STROKE, strokeWidth: 2 }}
            />
          ) : null}
        </g>
        {rotateHandleVisible ? (
          <g
            data-fixture-rotate-handle={id}
            transform={`translate(${renderX}, ${renderY}) rotate(${rotationRenderDegrees})`}
            style={{ cursor: rotationGhost === null ? "grab" : "grabbing" }}
          >
            <line
              x1={0}
              x2={0}
              y1={-ringRadius(visual, 8)}
              y2={-rotateHandleRadius}
              pointerEvents="none"
              style={{ stroke: SELECTED_STROKE, strokeWidth: 1.1, opacity: 0.78 }}
            />
            <circle
              ref={rotateHandleRef}
              cx={0}
              cy={-rotateHandleRadius}
              r={5}
              fill="var(--color-bg-canvas)"
              pointerEvents="all"
              style={{ stroke: SELECTED_STROKE, strokeWidth: 1.4 }}
            />
            <path
              d={`M -2 ${-rotateHandleRadius - 1.5} A 3 3 0 1 1 1.8 ${-rotateHandleRadius + 2.4}`}
              fill="none"
              pointerEvents="none"
              strokeLinecap="round"
              style={{ stroke: SELECTED_STROKE, strokeWidth: 0.9 }}
            />
          </g>
        ) : null}
        {/* Focus ring — only visible on keyboard focus, mirrors SELECTED_STROKE
          in green so screen-magnifier users can spot the focused marker. */}
        {keyboardFocused ? (
          <circle
            cx={renderX}
            cy={renderY}
            r={ringRadius(visual, 8)}
            fill="none"
            pointerEvents="none"
            style={{ stroke: SELECTED_STROKE, strokeWidth: 2 }}
          />
        ) : null}
        {/* I1 — glanceable intensity bar at marker base. Vertical, 4×24 cm,
            CCT-tinted fill rising from the bottom. When fixture is off the
            empty outline still renders at low opacity so the bar's presence
            stays consistent across the rig (fades in cleanly when the
            fixture comes on). */}
        <g pointerEvents="none" opacity={on ? 1 : 0.4}>
          <rect
            x={intensityBarX}
            y={intensityBarY}
            width={BAR_WIDTH}
            height={BAR_HEIGHT}
            rx={1.2}
            style={{ fill: "var(--color-bg-soft)", stroke: SHELL_STROKE, strokeWidth: 0.6 }}
            opacity={0.65}
          />
          {intensityBarFillFrac > 0 ? (
            <rect
              x={intensityBarX}
              y={intensityBarFillY}
              width={BAR_WIDTH}
              height={intensityBarFillHeight}
              rx={1.2}
              style={{ fill: intensityBarFillColor }}
            />
          ) : null}
        </g>
        {/* Wave 31 — I9 chip-hover ring. A single soft pulse echoes the
            ChipStrip's hover signal so the chip ↔ marker pairing is
            unambiguous. Distinct from `selected` (dashed green ring) and
            `highlightOverlay` (sustained orange) because hover is a
            transient, non-committing gesture. */}
        {chipHovered ? (
          <circle
            cx={renderX}
            cy={renderY}
            r={ringRadius(visual, 9)}
            fill="none"
            strokeWidth={1.6}
            pointerEvents="none"
            style={{ stroke: SELECTED_STROKE, opacity: 0.85 }}
          >
            <animate attributeName="r" values="16;22;16" dur="0.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.85;0.35;0.85" dur="0.6s" repeatCount="indefinite" />
          </circle>
        ) : null}
        {/* Identify-burst pulse ring — total 1.2 s matches engine
          identify.rs default duration_ms. SVG <animate> runs natively;
          we don't gate on prefers-reduced-motion because the burst is the
          point of the gesture (user-initiated, opt-in). */}
        {identifying ? (
          <circle
            cx={renderX}
            cy={renderY}
            r={ringRadius(visual, 12)}
            fill="none"
            strokeWidth={2}
            pointerEvents="none"
            style={{ stroke: SELECTED_STROKE }}
          >
            <animate attributeName="r" values="14;28;14" dur="0.4s" repeatCount="3" />
            <animate attributeName="opacity" values="1;0.3;1" dur="0.4s" repeatCount="3" />
          </circle>
        ) : null}
        {labelVisible ? (
          <>
            <text
              x={renderX}
              y={renderY + nameOffsetY}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              letterSpacing={0}
              pointerEvents="none"
              style={{ fill: LABEL_NAME_FILL, fontFamily: "var(--font-family-mono)", textTransform: "uppercase" }}
            >
              {displayName}
            </text>
            <text
              x={renderX}
              y={renderY + metaOffsetY}
              textAnchor="middle"
              fontSize={9}
              letterSpacing={0}
              pointerEvents="none"
              style={{ fill: LABEL_META_FILL, fontFamily: "var(--font-family-mono)" }}
            >
              {metaLabel}
            </text>
          </>
        ) : null}
        {/* F4 — live position chip during drag. Renders the in-flight meters
            offset down-right from the ghost so it follows the cursor without
            occluding the marker. Sits inside the rotated viewport <g> so
            zoom/pan transforms apply uniformly with the rest of the plot. */}
        {ghost ? (
          <g pointerEvents="none">
            <rect
              x={ghost.x + 12}
              y={ghost.y + 4}
              width={70}
              height={18}
              rx={3}
              style={{ fill: "var(--color-bg-canvas)", stroke: SELECTED_STROKE, strokeWidth: 0.8 }}
            />
            <text
              x={ghost.x + 47}
              y={ghost.y + 16}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              style={{ fill: "var(--color-brand-text-primary)", fontFamily: "var(--font-family-mono)" }}
            >
              {(ghost.x / 100).toFixed(1)} m, {(ghost.y / 100).toFixed(1)} m
            </text>
          </g>
        ) : null}
        {rotationGhost !== null ? (
          <g pointerEvents="none">
            <rect
              x={renderX + 12}
              y={renderY - rotateHandleRadius - 16}
              width={42}
              height={18}
              rx={3}
              style={{ fill: "var(--color-bg-canvas)", stroke: SELECTED_STROKE, strokeWidth: 0.8 }}
            />
            <text
              x={renderX + 33}
              y={renderY - rotateHandleRadius - 4}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              style={{ fill: "var(--color-brand-text-primary)", fontFamily: "var(--font-family-mono)" }}
            >
              {roundedDegrees(rotationGhost)}°
            </text>
          </g>
        ) : null}
      </g>
      {menuPos && menuItems.length > 0 ? (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
          ariaLabel={`Fixture ${name} actions`}
        />
      ) : null}
    </>
  );
}
