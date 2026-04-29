import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject, WheelEvent as ReactWheelEvent } from "react";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_STEP = 1.0015;
const CLICK_PX_THRESHOLD = 4;

interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

const IDENTITY: ViewportState = { zoom: 1, panX: 0, panY: 0 };

function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(ctm.inverse());
}

export interface StagePlotViewport {
  svgRef: RefObject<SVGSVGElement | null>;
  transform: string;
  zoom: number;
  isPanning: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onWheel: (event: ReactWheelEvent<SVGSVGElement>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export interface UseStagePlotViewportOptions {
  /** Called when a pointerup is registered as a click (no drag). Used to clear selection. */
  onBackgroundClick?: () => void;
}

export function useStagePlotViewport(options: UseStagePlotViewportOptions = {}): StagePlotViewport {
  const { onBackgroundClick } = options;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<ViewportState>(IDENTITY);
  const [isPanning, setIsPanning] = useState(false);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    movedPx: number;
  } | null>(null);

  const setZoomAt = useCallback((nextZoom: number, anchorSvg: { x: number; y: number }) => {
    setState((prev) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      if (clamped === prev.zoom) return prev;
      const contentX = (anchorSvg.x - prev.panX) / prev.zoom;
      const contentY = (anchorSvg.y - prev.panY) / prev.zoom;
      return {
        zoom: clamped,
        panX: anchorSvg.x - contentX * clamped,
        panY: anchorSvg.y - contentY * clamped,
      };
    });
  }, []);

  const onWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      event.preventDefault();
      const anchor = clientToSvg(svg, event.clientX, event.clientY);
      if (!anchor) return;
      const factor = Math.pow(WHEEL_ZOOM_STEP, -event.deltaY);
      setZoomAt(state.zoom * factor, anchor);
    },
    [setZoomAt, state.zoom]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: state.panX,
        startPanY: state.panY,
        movedPx: 0,
      };
      svg.setPointerCapture(event.pointerId);
      setIsPanning(true);
    },
    [state.panX, state.panY]
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const svg = svgRef.current;
    if (!svg) return;

    const dxClient = event.clientX - drag.startClientX;
    const dyClient = event.clientY - drag.startClientY;
    drag.movedPx = Math.max(drag.movedPx, Math.hypot(dxClient, dyClient));

    const startSvg = clientToSvg(svg, drag.startClientX, drag.startClientY);
    const nowSvg = clientToSvg(svg, event.clientX, event.clientY);
    if (!startSvg || !nowSvg) return;

    setState((prev) => ({
      ...prev,
      panX: drag.startPanX + (nowSvg.x - startSvg.x),
      panY: drag.startPanY + (nowSvg.y - startSvg.y),
    }));
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const svg = svgRef.current;
      svg?.releasePointerCapture(event.pointerId);
      const wasClick = drag.movedPx < CLICK_PX_THRESHOLD;
      dragRef.current = null;
      setIsPanning(false);
      if (wasClick) onBackgroundClick?.();
    },
    [onBackgroundClick]
  );

  const zoomIn = useCallback(() => {
    const svg = svgRef.current;
    const anchor = svg ? svgCenter(svg) : { x: 0, y: 0 };
    setZoomAt(state.zoom * ZOOM_STEP, anchor);
  }, [setZoomAt, state.zoom]);

  const zoomOut = useCallback(() => {
    const svg = svgRef.current;
    const anchor = svg ? svgCenter(svg) : { x: 0, y: 0 };
    setZoomAt(state.zoom / ZOOM_STEP, anchor);
  }, [setZoomAt, state.zoom]);

  const reset = useCallback(() => setState(IDENTITY), []);

  return {
    svgRef,
    transform: `translate(${state.panX} ${state.panY}) scale(${state.zoom})`,
    zoom: state.zoom,
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    zoomIn,
    zoomOut,
    reset,
  };
}

function svgCenter(svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  const point = clientToSvg(svg, rect.left + rect.width / 2, rect.top + rect.height / 2);
  return point ? { x: point.x, y: point.y } : { x: 0, y: 0 };
}
