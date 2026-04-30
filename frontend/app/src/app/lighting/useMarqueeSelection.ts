import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

const CLICK_PX_THRESHOLD = 4;

export interface MarqueeRect {
  /** Left edge in viewBox cm. */
  x: number;
  /** Top edge in viewBox cm. */
  y: number;
  /** Width in viewBox cm. */
  width: number;
  /** Height in viewBox cm. */
  height: number;
}

export interface FixtureHitTarget {
  id: string;
  /** Center x in viewBox cm. */
  xCm: number;
  /** Center y in viewBox cm. */
  yCm: number;
}

export interface UseMarqueeSelectionOptions {
  /** SVG ref used to convert client px → inner viewBox cm. The marquee
   *  rectangle is computed in viewBox space so it stays correct under any
   *  zoom/pan applied to the inner <g>. */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Called once on pointerup with the ids inside the rectangle and whether
   *  Shift was held (= additive merge with existing selection). Empty `ids`
   *  with `additive: false` means "clear selection". */
  onCommit: (ids: readonly string[], options: { additive: boolean }) => void;
  /** Pure-click clear — fired when pointerup happens without crossing the
   *  click threshold AND Shift was not held. Lets the parent reset the
   *  single-selection without depending on a 0-result marquee. */
  onBackgroundClick?: () => void;
  /** Provides the current fixture hit-targets for hit-testing on commit.
   *  Called only on pointerup so it's cheap to recompute. */
  resolveTargets: () => readonly FixtureHitTarget[];
}

export interface MarqueeSelection {
  /** Spread on the SVG element. Returns marquee state via `rect` + `additive`. */
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  /** Currently active marquee rectangle (viewBox coords). null when not dragging. */
  rect: MarqueeRect | null;
  /** Whether the active marquee was started with Shift (additive). Useful for
   *  rendering a slightly different visual when adding to selection. */
  additive: boolean;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startInnerX: number;
  startInnerY: number;
  movedPx: number;
  additive: boolean;
}

/**
 * Marquee (rubber-band) selection on the stage plot. Plain left-drag in
 * empty space draws a rectangle and selects all fixtures whose centers
 * fall inside it on release. Shift+left-drag merges with existing selection.
 *
 * Math runs in viewBox cm via `svg.getScreenCTM()` so the rectangle stays
 * correct under any zoom/pan transform applied to the inner content <g> —
 * same trick as the fixture-drag handler in FixtureMarker.
 *
 * Pan / right-click context menus / fixture marker pointerdown handlers
 * stop propagation so this hook only receives true background events.
 */
export function useMarqueeSelection(options: UseMarqueeSelectionOptions): MarqueeSelection {
  const { svgRef, onCommit, onBackgroundClick, resolveTargets } = options;
  const dragRef = useRef<DragState | null>(null);
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const [additive, setAdditive] = useState(false);

  const clientToInner = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const innerGroup = svg.querySelector<SVGGraphicsElement>("g[data-inner-content]");
      const target = innerGroup ?? svg;
      const ctm = target.getScreenCTM();
      if (!ctm) return null;
      const inverse = ctm.inverse();
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      return point.matrixTransform(inverse);
    },
    [svgRef]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      // Left button only; middle / right go to viewport-pan / context-menu paths.
      if (event.button !== 0) return;
      const inner = clientToInner(event.clientX, event.clientY);
      if (!inner) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startInnerX: inner.x,
        startInnerY: inner.y,
        movedPx: 0,
        additive: event.shiftKey,
      };
      setAdditive(event.shiftKey);
    },
    [clientToInner]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      drag.movedPx = Math.max(drag.movedPx, Math.hypot(dx, dy));
      if (drag.movedPx < CLICK_PX_THRESHOLD) return;

      const inner = clientToInner(event.clientX, event.clientY);
      if (!inner) return;
      const x = Math.min(drag.startInnerX, inner.x);
      const y = Math.min(drag.startInnerY, inner.y);
      const width = Math.abs(inner.x - drag.startInnerX);
      const height = Math.abs(inner.y - drag.startInnerY);
      setRect({ x, y, width, height });
    },
    [clientToInner]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const releasedRect = rect;
      const wasClick = drag.movedPx < CLICK_PX_THRESHOLD;
      const wasAdditive = drag.additive;
      dragRef.current = null;
      setRect(null);
      setAdditive(false);

      if (wasClick) {
        // Plain click on background (no rectangle): treat as deselect unless
        // Shift was held (additive click is a no-op — leaves selection alone).
        if (!wasAdditive) {
          onBackgroundClick?.();
        }
        return;
      }
      if (!releasedRect) return;
      const ids = resolveTargets()
        .filter(
          (target) =>
            target.xCm >= releasedRect.x &&
            target.xCm <= releasedRect.x + releasedRect.width &&
            target.yCm >= releasedRect.y &&
            target.yCm <= releasedRect.y + releasedRect.height
        )
        .map((target) => target.id);
      onCommit(ids, { additive: wasAdditive });
    },
    [onBackgroundClick, onCommit, rect, resolveTargets]
  );

  return { onPointerDown, onPointerMove, onPointerUp, rect, additive };
}
