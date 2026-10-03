// Visual overhaul B (DESIGN.md §7, §9): where a floating layer goes. The
// menu, the popover and the tooltip each sit beside something: a key, an
// object, or the pointer. They prefer one side, flip to the other when it has
// no room, slide along their side to stay on the screen, and a tooltip also
// refuses any place that would cover a take-time control. Pure geometry, so
// it is tested without a browser; the components measure and call it.

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-start` | `${Side}-end`;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlaceOptions {
  /** The thing the layer sits beside; a pointer is a 0 × 0 rectangle. */
  anchor: Rect;
  floating: Size;
  viewport: Size;
  placement: Placement;
  /** The gap between the anchor and the layer. */
  offset?: number;
  /** The room the layer keeps from the screen's edges. */
  margin?: number;
  /**
   * Rectangles the layer must never cover (the tooltip's take-time
   * controls). When every place covers one, nothing fits and the result is
   * `null`; without `avoid` the layer always gets a place.
   */
  avoid?: readonly Rect[];
  /** Sides tried after the preferred side and its opposite. */
  fallbackSides?: readonly Side[];
}

export interface PlaceResult {
  left: number;
  top: number;
  placement: Placement;
  side: Side;
  /** Where the anchor's centre falls along the layer's edge (a tooltip's arrow). */
  arrow: number;
  /** True when the layer had to be squeezed onto the screen (no side had room). */
  clamped: boolean;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export function splitPlacement(placement: Placement): { side: Side; align: Align } {
  const [side, align] = placement.split("-") as [Side, Align | undefined];
  return { side, align: align ?? "center" };
}

function joinPlacement(side: Side, align: Align): Placement {
  return (align === "center" ? side : `${side}-${align}`) as Placement;
}

function isVertical(side: Side): boolean {
  return side === "top" || side === "bottom";
}

/** The layer's corner for one side and alignment, before any sliding. */
function rawPosition(
  anchor: Rect,
  floating: Size,
  side: Side,
  align: Align,
  offset: number
): { left: number; top: number } {
  let left: number;
  let top: number;
  if (isVertical(side)) {
    top = side === "bottom" ? anchor.top + anchor.height + offset : anchor.top - offset - floating.height;
    left =
      align === "start"
        ? anchor.left
        : align === "end"
          ? anchor.left + anchor.width - floating.width
          : anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    left = side === "right" ? anchor.left + anchor.width + offset : anchor.left - offset - floating.width;
    top =
      align === "start"
        ? anchor.top
        : align === "end"
          ? anchor.top + anchor.height - floating.height
          : anchor.top + anchor.height / 2 - floating.height / 2;
  }
  return { left, top };
}

/** Room on a side, from the anchor to the screen's edge less the margin. */
function roomOn(side: Side, anchor: Rect, viewport: Size, offset: number, margin: number): number {
  switch (side) {
    case "top":
      return anchor.top - offset - margin;
    case "bottom":
      return viewport.height - margin - (anchor.top + anchor.height + offset);
    case "left":
      return anchor.left - offset - margin;
    case "right":
      return viewport.width - margin - (anchor.left + anchor.width + offset);
  }
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * Places a floating layer beside its anchor: the preferred side first, then
 * the opposite side, then `fallbackSides`; along the side, a `start` or `end`
 * alignment that would leave the screen swaps for the other before the layer
 * slides. Returns `null` only when `avoid` is given and every place covers
 * one of its rectangles.
 */
export function placeFloating({
  anchor,
  floating,
  viewport,
  placement,
  offset = 4,
  margin = 8,
  avoid,
  fallbackSides = [],
}: PlaceOptions): PlaceResult | null {
  const preferred = splitPlacement(placement);
  const sides: Side[] = [];
  for (const side of [preferred.side, OPPOSITE[preferred.side], ...fallbackSides]) {
    if (!sides.includes(side)) sides.push(side);
  }

  const place = (side: Side, align: Align): PlaceResult => {
    let { left, top } = rawPosition(anchor, floating, side, align, offset);
    // A start or end alignment that runs off the screen takes the other end
    // before it slides (a menu at the pointer near the right edge opens to the
    // pointer's left, as every program's does).
    if (align !== "center") {
      const crossStart = isVertical(side) ? left : top;
      const crossSize = isVertical(side) ? floating.width : floating.height;
      const crossMax = (isVertical(side) ? viewport.width : viewport.height) - margin;
      if (crossStart + crossSize > crossMax || crossStart < margin) {
        const other: Align = align === "start" ? "end" : "start";
        const swapped = rawPosition(anchor, floating, side, other, offset);
        const swappedStart = isVertical(side) ? swapped.left : swapped.top;
        if (swappedStart >= margin && swappedStart + crossSize <= crossMax) {
          left = swapped.left;
          top = swapped.top;
          align = other;
        }
      }
    }
    const maxLeft = viewport.width - margin - floating.width;
    const maxTop = viewport.height - margin - floating.height;
    const slidLeft = clamp(left, margin, maxLeft);
    const slidTop = clamp(top, margin, maxTop);
    const arrow = isVertical(side)
      ? clamp(anchor.left + anchor.width / 2 - slidLeft, 8, floating.width - 8)
      : clamp(anchor.top + anchor.height / 2 - slidTop, 8, floating.height - 8);
    return {
      left: Math.round(slidLeft),
      top: Math.round(slidTop),
      placement: joinPlacement(side, align),
      side,
      arrow: Math.round(arrow),
      clamped: false,
    };
  };

  const covers = (result: PlaceResult): boolean => {
    if (!avoid || avoid.length === 0) return false;
    const box = { left: result.left, top: result.top, width: floating.width, height: floating.height };
    return avoid.some((rect) => intersects(box, rect));
  };

  for (const side of sides) {
    const need = isVertical(side) ? floating.height : floating.width;
    if (roomOn(side, anchor, viewport, offset, margin) < need) continue;
    const alignments: Align[] = [
      preferred.align,
      ...(["center", "start", "end"] as Align[]).filter((a) => a !== preferred.align),
    ];
    // Without rectangles to avoid, the preferred alignment is the answer; a
    // tooltip may slide to another alignment to clear a take-time control.
    for (const align of avoid && avoid.length > 0 ? alignments : [preferred.align]) {
      const result = place(side, align);
      if (!covers(result)) return result;
    }
  }

  if (avoid && avoid.length > 0) return null;

  // No side has room: the side with the most room, squeezed onto the screen.
  const roomiest = [...sides].sort(
    (a, b) => roomOn(b, anchor, viewport, offset, margin) - roomOn(a, anchor, viewport, offset, margin)
  )[0];
  return { ...place(roomiest, preferred.align), clamped: true };
}

/** A rectangle from a DOMRect-like value. */
export function rectOf(r: { left: number; top: number; width: number; height: number }): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** The pointer as an anchor. */
export function pointRect(x: number, y: number): Rect {
  return { left: x, top: y, width: 0, height: 0 };
}
