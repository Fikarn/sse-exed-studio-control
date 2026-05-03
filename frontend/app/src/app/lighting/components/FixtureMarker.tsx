import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Pencil, Sparkles, Trash2 } from "lucide-react";

import { ContextMenu, type ContextMenuItem } from "@sse/design-system";

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
  /** Fires when drag ends (commit or cancel) so the parent can clear its
   *  drag-tracking state for this fixture. */
  onDragEnd?: (id: string) => void;
}

// I1 — intensity bar geometry. Anchored to the bottom edge of the marker
// shape so all mountings share a consistent visual rhythm. Width / height are
// in viewBox cm units; the bar doesn't rotate with the marker (lives outside
// the rotated <g> like the text labels).
const BAR_WIDTH = 4;
const BAR_HEIGHT = 24;
const BAR_ANCHOR_Y: Record<FixtureMounting, number> = {
  "grid-panel": 11,
  "grid-soft": 11,
  "wall-bar": 5,
  stand: 11,
};

const SHELL_FILL = "var(--color-fixture-shell-fill)";
const SHELL_STROKE = "var(--color-fixture-shell-stroke)";
const SELECTED_STROKE = "var(--color-brand-green)";
const HIGHLIGHT_OVERLAY_STROKE = "var(--color-status-warning, #ff6b35)";
const GHOST_STROKE = "var(--color-fixture-ghost-stroke)";

const LABEL_NAME_FILL = "var(--color-brand-text-secondary)";
const LABEL_META_FILL = "var(--color-brand-text-muted)";

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
        <rect
          x={-9}
          y={-9}
          width={18}
          height={18}
          rx={2}
          style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}
        />
      );
    case "grid-soft":
      return (
        <rect
          x={-13}
          y={-9}
          width={26}
          height={18}
          rx={4}
          style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}
        />
      );
    case "wall-bar":
      return (
        <rect
          x={-22}
          y={-3}
          width={44}
          height={6}
          rx={1}
          style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}
        />
      );
    case "stand":
    default:
      return <circle r={9} style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }} />;
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
  identifying = false,
  highlightOverlay = false,
  chipHovered = false,
  onSelect,
  onPositionCommit,
  onRequestRename,
  onIdentify,
  onRequestDelete,
  onDragMove,
  onDragEnd,
}: FixtureMarkerProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const color = lightingFixtureColor(cct, on);
  const dotOpacity = on ? Math.max(0.3, intensity / 100) : 0.18;

  const dragRef = useRef<DragState | null>(null);
  // Ghost position in cm — set during an active drag once the threshold is
  // crossed, cleared on pointerup. Rendered at the new position so the
  // visual follows the cursor; the original (centerX, centerY) gets a
  // dashed shadow to anchor the move.
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<{ x: number; y: number } | null>(null);
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

  // Wall-bar markers are wide; lift labels slightly to clear the bar.
  const nameOffsetY = mounting === "wall-bar" ? -16 : -32;
  const metaOffsetY = mounting === "wall-bar" ? -28 : -46;

  const draggable = Boolean(onPositionCommit);
  const renderX = ghost?.x ?? centerX;
  const renderY = ghost?.y ?? centerY;
  const cursorStyle = draggable ? (ghost ? "grabbing" : "grab") : "pointer";
  const intensityBarX = renderX - BAR_WIDTH / 2;
  const intensityBarY = renderY + BAR_ANCHOR_Y[mounting];
  const intensityBarFillFrac = on ? Math.max(0, Math.min(1, intensity / 100)) : 0;
  const intensityBarFillHeight = BAR_HEIGHT * intensityBarFillFrac;
  const intensityBarFillY = intensityBarY + (BAR_HEIGHT - intensityBarFillHeight);
  const intensityBarFillColor = lightingFixtureColor(cct, true);

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

    const nextX = drag.startCenterX + (nowInner.x - startInner.x);
    const nextY = drag.startCenterY + (nowInner.y - startInner.y);
    const nextGhost = { x: nextX, y: nextY };
    ghostRef.current = nextGhost;
    setGhost(nextGhost);
    // F9 — surface live drag position to the parent so the smart-guide layer
    // can compute alignment lines vs. other fixtures. Pre-snap meters; the
    // commit handler still applies the 0.5 m snap on pointerup.
    onDragMove?.(id, nextX / 100, nextY / 100, event.altKey);
  };

  const finishDrag = (event: ReactPointerEvent<SVGGElement>, kind: "up" | "cancel") => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const wasDrag = drag.movedPx >= CLICK_PX_THRESHOLD;
    const ghostNow = ghostRef.current;
    dragRef.current = null;
    ghostRef.current = null;
    setGhost(null);
    onDragEnd?.(id);

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
              r={mounting === "wall-bar" ? 26 : 14}
              fill="none"
              strokeDasharray="3 3"
              style={{ stroke: GHOST_STROKE, strokeWidth: 1 }}
            />
          </g>
        ) : null}
        <g transform={`translate(${renderX}, ${renderY}) rotate(${rotationDegrees})`} filter="url(#sse-fixture-shadow)">
          {shapeForMounting(mounting)}
          <circle r={3.6} fill={color} fillOpacity={dotOpacity} />
          {selected ? (
            <circle
              r={mounting === "wall-bar" ? 26 : 14}
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
              r={mounting === "wall-bar" ? 30 : 17}
              fill="none"
              style={{ stroke: HIGHLIGHT_OVERLAY_STROKE, strokeWidth: 2 }}
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
            r={mounting === "wall-bar" ? 32 : 19}
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
            r={mounting === "wall-bar" ? 36 : 22}
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
