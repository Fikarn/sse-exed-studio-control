import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject, WheelEvent as ReactWheelEvent } from "react";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_STEP = 1.0015;
const CLICK_PX_THRESHOLD = 4;

// Wave 31 — saved view bookmarks (I7). Three numbered slots persisted to
// localStorage. Empty slots stay null so consumers can render a "save" hint.
// Animation easing matches `reset()` so recall feels familiar.
export const VIEW_BOOKMARK_SLOT_COUNT = 3;
const BOOKMARK_STORAGE_KEY = "app.lighting.stagePlotViewBookmarks";
const BOOKMARK_ANIMATION_MS = 200;

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

export type ViewBookmarkSlot = 0 | 1 | 2;
export type ViewBookmarks = readonly (ViewportState | null)[];

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
  /** Wave 31 — view bookmarks (I7). Three numbered slots; null when empty. */
  viewBookmarks: ViewBookmarks;
  /** Save current zoom + pan to slot. Persists to localStorage. */
  saveViewBookmark: (slot: ViewBookmarkSlot) => void;
  /** Recall slot. Animates from current viewport to the slot's stored state
   *  over 200 ms (matching `reset()` easing). No-op if slot is empty. */
  recallViewBookmark: (slot: ViewBookmarkSlot) => void;
  /** Clear a slot. Persists to localStorage. */
  clearViewBookmark: (slot: ViewBookmarkSlot) => void;
}

export interface UseStagePlotViewportOptions {
  /** Called when a middle-mouse pointerup is registered as a click (no drag).
   *  Plain left-click clearing is owned by the marquee hook; middle-click
   *  rarely fires this path but is preserved for completeness. */
  onBackgroundClick?: () => void;
}

function readBookmarks(): ViewBookmarks {
  if (typeof window === "undefined") return EMPTY_BOOKMARKS;
  try {
    const raw = window.localStorage.getItem(BOOKMARK_STORAGE_KEY);
    if (!raw) return EMPTY_BOOKMARKS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY_BOOKMARKS;
    return parsed.slice(0, VIEW_BOOKMARK_SLOT_COUNT).map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as { zoom?: unknown; panX?: unknown; panY?: unknown };
      const zoom = typeof candidate.zoom === "number" ? candidate.zoom : null;
      const panX = typeof candidate.panX === "number" ? candidate.panX : null;
      const panY = typeof candidate.panY === "number" ? candidate.panY : null;
      if (zoom === null || panX === null || panY === null) return null;
      // Defensive clamp so a corrupted blob can't drive the viewport out of bounds.
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      return { zoom: clampedZoom, panX, panY };
    }) as ViewBookmarks;
  } catch {
    return EMPTY_BOOKMARKS;
  }
}

function writeBookmarks(next: ViewBookmarks): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort write — operator can re-save in this session.
  }
}

const EMPTY_BOOKMARKS: ViewBookmarks = Object.freeze([null, null, null]);

export function useStagePlotViewport(options: UseStagePlotViewportOptions = {}): StagePlotViewport {
  const { onBackgroundClick } = options;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<ViewportState>(IDENTITY);
  const [isPanning, setIsPanning] = useState(false);
  const [viewBookmarks, setViewBookmarks] = useState<ViewBookmarks>(EMPTY_BOOKMARKS);
  // Hydrate from localStorage on mount only — avoids SSR-time storage access
  // and keeps the initial render deterministic.
  useEffect(() => {
    setViewBookmarks(readBookmarks());
  }, []);
  // Pan is bound to middle-mouse (button 1) only since Wave 26's marquee-
  // selection took over plain left-drag. Wheel-zoom and double-click-reset
  // remain on their default gestures.
  const PAN_BUTTON = 1;

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
      if (event.button !== PAN_BUTTON) return;
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

  // Tween the viewport from its current state to a target ViewportState.
  // Shared by `reset()` (target = IDENTITY) and `recallViewBookmark()` (target =
  // the stored slot). Honors prefers-reduced-motion by snapping immediately.
  const animateTo = useCallback((target: ViewportState, durationMs: number) => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState(target);
      return;
    }
    setState((current) => {
      const startZoom = current.zoom;
      const startPanX = current.panX;
      const startPanY = current.panY;
      if (startZoom === target.zoom && startPanX === target.panX && startPanY === target.panY) {
        return current;
      }
      const startTime = performance.now();
      // Approximates cubic-bezier(0.22, 1, 0.36, 1) — same easing token used in the design system.
      const ease = (t: number) => 1 - Math.pow(1 - t, 4);
      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / durationMs);
        const eased = ease(t);
        setState({
          zoom: startZoom + (target.zoom - startZoom) * eased,
          panX: startPanX + (target.panX - startPanX) * eased,
          panY: startPanY + (target.panY - startPanY) * eased,
        });
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return current;
    });
  }, []);

  const reset = useCallback(() => {
    animateTo(IDENTITY, 250);
  }, [animateTo]);

  const saveViewBookmark = useCallback(
    (slot: ViewBookmarkSlot) => {
      setViewBookmarks((prev) => {
        const next = [...prev] as (ViewportState | null)[];
        next[slot] = { zoom: state.zoom, panX: state.panX, panY: state.panY };
        const frozen = next as ViewBookmarks;
        writeBookmarks(frozen);
        return frozen;
      });
    },
    [state.zoom, state.panX, state.panY]
  );

  const recallViewBookmark = useCallback(
    (slot: ViewBookmarkSlot) => {
      const target = viewBookmarks[slot];
      if (!target) return;
      animateTo(target, BOOKMARK_ANIMATION_MS);
    },
    [animateTo, viewBookmarks]
  );

  const clearViewBookmark = useCallback((slot: ViewBookmarkSlot) => {
    setViewBookmarks((prev) => {
      const next = [...prev] as (ViewportState | null)[];
      next[slot] = null;
      const frozen = next as ViewBookmarks;
      writeBookmarks(frozen);
      return frozen;
    });
  }, []);

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
    viewBookmarks,
    saveViewBookmark,
    recallViewBookmark,
    clearViewBookmark,
  };
}

function svgCenter(svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  const point = clientToSvg(svg, rect.left + rect.width / 2, rect.top + rect.height / 2);
  return point ? { x: point.x, y: point.y } : { x: 0, y: 0 };
}
