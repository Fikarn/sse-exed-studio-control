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
  zoomMode: StagePlotZoomMode;
}

export type StagePlotZoomMode = "fitRoom" | "fillDesk" | "actual";

const IDENTITY: ViewportState = { zoom: 1, panX: 0, panY: 0, zoomMode: "fillDesk" };

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
  zoomMode: StagePlotZoomMode;
  isPanning: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onWheel: (event: ReactWheelEvent<SVGSVGElement>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fitRoom: () => void;
  fillDesk: () => void;
  actualSize: () => void;
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
  defaultZoomMode?: StagePlotZoomMode;
  storageScope?: string;
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
      const candidate = entry as { zoom?: unknown; panX?: unknown; panY?: unknown; zoomMode?: unknown };
      const zoom = typeof candidate.zoom === "number" ? candidate.zoom : null;
      const panX = typeof candidate.panX === "number" ? candidate.panX : null;
      const panY = typeof candidate.panY === "number" ? candidate.panY : null;
      if (zoom === null || panX === null || panY === null) return null;
      const zoomMode = isStagePlotZoomMode(candidate.zoomMode) ? candidate.zoomMode : "fillDesk";
      // Defensive clamp so a corrupted blob can't drive the viewport out of bounds.
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      return { zoom: clampedZoom, panX, panY, zoomMode };
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

function isStagePlotZoomMode(value: unknown): value is StagePlotZoomMode {
  return value === "fitRoom" || value === "fillDesk" || value === "actual";
}

function zoomModeStorageKey(scope: string) {
  return `app.lighting.stagePlotZoomMode.${scope}`;
}

function readStoredZoomMode(scope: string, fallback: StagePlotZoomMode): StagePlotZoomMode {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(zoomModeStorageKey(scope));
  return isStagePlotZoomMode(raw) ? raw : fallback;
}

function writeStoredZoomMode(scope: string, mode: StagePlotZoomMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(zoomModeStorageKey(scope), mode);
  } catch {
    // Best-effort preference; the in-session mode still applies.
  }
}

export function useStagePlotViewport(options: UseStagePlotViewportOptions = {}): StagePlotViewport {
  const { defaultZoomMode = "fillDesk", onBackgroundClick, storageScope = "default" } = options;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const initialState = { ...IDENTITY, zoomMode: readStoredZoomMode(storageScope, defaultZoomMode) };
  const [state, setState] = useState<ViewportState>(initialState);
  const stateRef = useRef<ViewportState>(initialState);
  const pendingStateRef = useRef<ViewportState | null>(null);
  const stateRafRef = useRef<number | null>(null);
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

  const setViewportState = useCallback((next: ViewportState | ((prev: ViewportState) => ViewportState)) => {
    if (stateRafRef.current !== null) {
      cancelAnimationFrame(stateRafRef.current);
      stateRafRef.current = null;
      pendingStateRef.current = null;
    }
    setState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      stateRef.current = resolved;
      return resolved;
    });
  }, []);

  useEffect(() => {
    const next = readStoredZoomMode(storageScope, defaultZoomMode);
    setViewportState((current) => ({ ...current, zoomMode: next }));
  }, [defaultZoomMode, setViewportState, storageScope]);

  const scheduleViewportState = useCallback((next: ViewportState) => {
    stateRef.current = next;
    pendingStateRef.current = next;
    if (stateRafRef.current !== null) return;
    stateRafRef.current = requestAnimationFrame(() => {
      stateRafRef.current = null;
      const pending = pendingStateRef.current;
      pendingStateRef.current = null;
      if (pending) {
        setState(pending);
      }
    });
  }, []);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    movedPx: number;
  } | null>(null);

  const setZoomAt = useCallback(
    (nextZoom: number, anchorSvg: { x: number; y: number }) => {
      const prev = stateRef.current;
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
      if (clamped === prev.zoom) return;
      const contentX = (anchorSvg.x - prev.panX) / prev.zoom;
      const contentY = (anchorSvg.y - prev.panY) / prev.zoom;
      scheduleViewportState({
        zoom: clamped,
        panX: anchorSvg.x - contentX * clamped,
        panY: anchorSvg.y - contentY * clamped,
        zoomMode: prev.zoomMode,
      });
    },
    [scheduleViewportState]
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      event.preventDefault();
      const anchor = clientToSvg(svg, event.clientX, event.clientY);
      if (!anchor) return;
      const factor = Math.pow(WHEEL_ZOOM_STEP, -event.deltaY);
      setZoomAt(stateRef.current.zoom * factor, anchor);
    },
    [setZoomAt]
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== PAN_BUTTON) return;
    const svg = svgRef.current;
    if (!svg) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: stateRef.current.panX,
      startPanY: stateRef.current.panY,
      movedPx: 0,
    };
    svg.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
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

      scheduleViewportState({
        ...stateRef.current,
        panX: drag.startPanX + (nowSvg.x - startSvg.x),
        panY: drag.startPanY + (nowSvg.y - startSvg.y),
      });
    },
    [scheduleViewportState]
  );

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
    setZoomAt(stateRef.current.zoom * ZOOM_STEP, anchor);
  }, [setZoomAt]);

  const zoomOut = useCallback(() => {
    const svg = svgRef.current;
    const anchor = svg ? svgCenter(svg) : { x: 0, y: 0 };
    setZoomAt(stateRef.current.zoom / ZOOM_STEP, anchor);
  }, [setZoomAt]);

  // Tween the viewport from its current state to a target ViewportState.
  // Shared by `reset()` (target = IDENTITY) and `recallViewBookmark()` (target =
  // the stored slot). Honors prefers-reduced-motion by snapping immediately.
  const animateTo = useCallback(
    (target: ViewportState, durationMs: number) => {
      if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setViewportState(target);
        return;
      }
      setViewportState((current) => {
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
          setViewportState({
            zoom: startZoom + (target.zoom - startZoom) * eased,
            panX: startPanX + (target.panX - startPanX) * eased,
            panY: startPanY + (target.panY - startPanY) * eased,
            zoomMode: target.zoomMode,
          });
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return current;
      });
    },
    [setViewportState]
  );

  const reset = useCallback(() => {
    animateTo({ ...IDENTITY, zoomMode: stateRef.current.zoomMode }, 250);
  }, [animateTo]);

  const setZoomMode = useCallback(
    (zoomMode: StagePlotZoomMode) => {
      writeStoredZoomMode(storageScope, zoomMode);
      animateTo({ ...IDENTITY, zoomMode }, 200);
    },
    [animateTo, storageScope]
  );

  const fitRoom = useCallback(() => setZoomMode("fitRoom"), [setZoomMode]);
  const fillDesk = useCallback(() => setZoomMode("fillDesk"), [setZoomMode]);
  const actualSize = useCallback(() => setZoomMode("actual"), [setZoomMode]);

  const saveViewBookmark = useCallback((slot: ViewBookmarkSlot) => {
    setViewBookmarks((prev) => {
      const next = [...prev] as (ViewportState | null)[];
      next[slot] = stateRef.current;
      const frozen = next as ViewBookmarks;
      writeBookmarks(frozen);
      return frozen;
    });
  }, []);

  useEffect(
    () => () => {
      if (stateRafRef.current !== null) {
        cancelAnimationFrame(stateRafRef.current);
      }
    },
    []
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
    zoomMode: state.zoomMode,
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    zoomIn,
    zoomOut,
    reset,
    fitRoom,
    fillDesk,
    actualSize,
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
