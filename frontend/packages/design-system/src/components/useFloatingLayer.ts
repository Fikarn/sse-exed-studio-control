import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { placeFloating, pointRect, rectOf, type Placement, type Rect, type Side } from "./anchoredPosition";

// Visual overhaul B (DESIGN.md §7, §9): what every floating layer the pages
// open beside something shares — the menu, the popover. It measures the layer
// and its anchor and places it (anchoredPosition.ts), closes it on a press
// outside, and gives the focus back where it came from. The tooltip places
// itself the same way but never takes the focus.

/** What a layer sits beside: an element, or the pointer (a right-click). */
export type FloatingAnchor = HTMLElement | { x: number; y: number } | null;

export function anchorRect(anchor: FloatingAnchor): Rect | null {
  if (!anchor) return null;
  if ("x" in anchor && "y" in anchor && !(anchor instanceof HTMLElement)) return pointRect(anchor.x, anchor.y);
  return rectOf((anchor as HTMLElement).getBoundingClientRect());
}

export interface FloatingPosition {
  style: CSSProperties;
  side: Side;
  placement: Placement;
  ready: boolean;
}

/**
 * Places `layerRef` beside `anchor` once it is drawn, before paint, and again
 * when the window changes size. Until it is placed it is drawn hidden at the
 * corner, so it never shows in the wrong place for a frame.
 */
export function useFloatingPosition(
  layerRef: RefObject<HTMLElement | null>,
  anchor: FloatingAnchor,
  placement: Placement,
  { offset = 4, open = true, deps = [] as readonly unknown[] } = {}
): FloatingPosition {
  const [position, setPosition] = useState<{ left: number; top: number; side: Side; placement: Placement } | null>(
    null
  );

  const place = useCallback(() => {
    const layer = layerRef.current;
    const rect = anchorRect(anchor);
    if (!layer || !rect) return;
    const result = placeFloating({
      anchor: rect,
      floating: { width: layer.offsetWidth, height: layer.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement,
      offset,
    });
    if (!result) return;
    // Placed again where it already stands, it keeps its state: no new render.
    setPosition((previous) =>
      previous &&
      previous.left === result.left &&
      previous.top === result.top &&
      previous.side === result.side &&
      previous.placement === result.placement
        ? previous
        : { left: result.left, top: result.top, side: result.side, placement: result.placement }
    );
    // The anchor and the deps are what move the layer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerRef, anchor, placement, offset, ...deps]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, place]);

  // Placed again when the window changes size, when the layer's own size
  // changes (an item arms in place, its words change), and once the fonts are
  // in (a width measured in the fallback face is not the width drawn).
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("resize", place);
    const layer = layerRef.current;
    const sizes = typeof ResizeObserver === "undefined" || !layer ? null : new ResizeObserver(() => place());
    if (sizes && layer) sizes.observe(layer);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) place();
    });
    return () => {
      live = false;
      window.removeEventListener("resize", place);
      sizes?.disconnect();
    };
  }, [open, place, layerRef]);

  const preferred = placement.split("-")[0] as Side;
  if (!position) {
    return {
      style: { position: "fixed", left: 0, top: 0, visibility: "hidden" },
      side: preferred,
      placement,
      ready: false,
    };
  }
  return {
    style: { position: "fixed", left: position.left, top: position.top },
    side: position.side,
    placement: position.placement,
    ready: true,
  };
}

/**
 * Calls `onDismiss` when a press lands outside the layer (and outside every
 * `ignore` element, such as the key that toggles it), on a right-click
 * elsewhere, and when something under it scrolls. The press is seen on its
 * way down, before the element under the pointer acts on it, so a right-click
 * on another object closes this menu before that object's menu opens.
 */
export function useDismissOnOutside(
  layerRef: RefObject<HTMLElement | null>,
  onDismiss: (reason: "outside" | "scroll") => void,
  { open = true, ignore = [] as ReadonlyArray<RefObject<HTMLElement | null>> } = {}
): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;

  useEffect(() => {
    if (!open) return undefined;
    const inside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (layerRef.current?.contains(target)) return true;
      return ignoreRef.current.some((ref) => ref.current?.contains(target));
    };
    const onPress = (event: Event) => {
      if (!inside(event.target)) onDismissRef.current("outside");
    };
    const onScroll = (event: Event) => {
      if (!inside(event.target)) onDismissRef.current("scroll");
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("contextmenu", onPress, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("contextmenu", onPress, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, layerRef]);
}

/**
 * Remembers what had the focus when the layer opened and gives it back when
 * the layer closes, if the focus is still inside the layer or nowhere (a press
 * outside that moved the focus elsewhere keeps it there).
 */
export function useReturnFocus(
  layerRef: RefObject<HTMLElement | null>,
  open: boolean,
  returnTo?: HTMLElement | null
): void {
  const returnRef = useRef<HTMLElement | null>(null);
  const explicitRef = useRef(returnTo);
  explicitRef.current = returnTo;

  useLayoutEffect(() => {
    if (!open) return undefined;
    const active = document.activeElement;
    returnRef.current = explicitRef.current ?? (active instanceof HTMLElement ? active : null);
    const layer = layerRef.current;
    return () => {
      const target = explicitRef.current ?? returnRef.current;
      const focused = document.activeElement;
      const focusLeftWithLayer =
        !focused || focused === document.body || (layer !== null && layer.contains(focused)) || !focused.isConnected;
      if (target && target.isConnected && focusLeftWithLayer) target.focus({ preventScroll: true });
    };
  }, [open, layerRef]);
}
