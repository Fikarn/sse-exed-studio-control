import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { placeFloating, rectOf, type Rect, type Side } from "./anchoredPosition";
import styles from "./Tooltip.module.css";

// Visual overhaul B (DESIGN.md §5, §9): the tooltip, where the helper
// sentences live now. The one light surface (Beige, black text), so it reads
// as a note. It opens after a short rest of the pointer (at once when the
// pointer comes from another tooltip, and at once on keyboard focus), stays
// while the pointer moves onto it, and closes on Esc or when the pointer
// leaves. It is drawn above everything, the meters' canvas included, and it
// never covers a control used during a take: those carry `data-take` (Key's,
// Slider's and Groove's `take`, which the page tests also measure), and a
// place that would cover one is refused; when every place would, the tooltip
// does not open (its sentence is still the trigger's description).
//
// Esc closes an open tooltip and goes on: an armed key under the focus is
// disarmed by the same Esc, so the tooltip never stands between the operator
// and a disarm.

export type TooltipPlacement = Side;

/** The marker on every control used during a take; a tooltip never covers one. */
export const TAKE_TIME_ATTRIBUTE = "data-take";

export const TOOLTIP_DELAY_MS = 500;
/** A tooltip that opens this soon after another closed opens at once. */
const WARM_MS = 300;
/** The pointer may cross the gap from the trigger to the tooltip in this time. */
const LEAVE_GRACE_MS = 100;

let lastClosedAt = Number.NEGATIVE_INFINITY;

export interface TooltipProps {
  /** Trigger element. Tooltip attaches to this single child. */
  children: ReactNode;
  /** Tooltip body. Kept short — a sentence, never a paragraph. */
  content: ReactNode;
  /** The preferred side; it flips or turns when that side has no room or covers a take-time control. */
  placement?: TooltipPlacement;
  /** Optional override for the tooltip's max width in px. */
  maxWidth?: number;
  /** The rest before it opens; default 500 ms. */
  delayMs?: number;
  /** Held open (a board shows it); without it the pointer and the focus open it. */
  open?: boolean;
  testId?: string;
}

const PERPENDICULAR: Record<Side, Side[]> = {
  top: ["right", "left"],
  bottom: ["right", "left"],
  left: ["top", "bottom"],
  right: ["top", "bottom"],
};

/** The take-time controls on screen, but those the trigger sits inside. */
function takeTimeRects(trigger: Element): Rect[] {
  return Array.from(document.querySelectorAll(`[${TAKE_TIME_ATTRIBUTE}]`))
    .filter((element) => !element.contains(trigger))
    .map((element) => rectOf(element.getBoundingClientRect()))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function keyboardFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function Tooltip({
  children,
  content,
  placement = "top",
  maxWidth,
  delayMs = TOOLTIP_DELAY_MS,
  open,
  testId,
}: TooltipProps) {
  const id = useId();
  const descriptionId = `tooltip-text-${id}`;
  const tooltipId = `tooltip-${id}`;
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const suppressUntilLeaveRef = useRef(false);
  const [hovered, setVisible] = useState(false);
  const visible = open ?? hovered;
  const [place, setPlace] = useState<{ left: number; top: number; side: Side; arrow: number } | null>(null);

  const clearTimers = () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  };

  const hideNow = useCallback(() => {
    clearTimers();
    setVisible((was) => {
      if (was) lastClosedAt = performance.now();
      return false;
    });
    setPlace(null);
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      if (suppressUntilLeaveRef.current) return;
      window.clearTimeout(hideTimer.current);
      if (immediate || performance.now() - lastClosedAt < WARM_MS || delayMs <= 0) {
        window.clearTimeout(showTimer.current);
        setVisible(true);
        return;
      }
      window.clearTimeout(showTimer.current);
      showTimer.current = window.setTimeout(() => setVisible(true), delayMs);
    },
    [delayMs]
  );

  const hideSoon = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(hideNow, LEAVE_GRACE_MS);
  }, [hideNow]);

  useEffect(() => () => clearTimers(), []);

  // Placed once drawn, before paint; refused when every place covers a
  // take-time control.
  useLayoutEffect(() => {
    if (!visible) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const result = placeFloating({
      anchor: rectOf(trigger.getBoundingClientRect()),
      floating: { width: bubble.offsetWidth, height: bubble.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement,
      offset: 8,
      avoid: takeTimeRects(trigger),
      fallbackSides: PERPENDICULAR[placement],
    });
    if (!result) {
      hideNow();
      return;
    }
    setPlace({ left: result.left, top: result.top, side: result.side, arrow: result.arrow });
  }, [visible, placement, content, maxWidth, hideNow]);

  // Esc closes an open tooltip and goes on to whatever else listens for it.
  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideNow();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [visible, hideNow]);

  const style: CSSProperties = place
    ? ({ left: place.left, top: place.top, maxWidth, "--tooltip-arrow": `${place.arrow}px` } as CSSProperties)
    : { left: 0, top: 0, maxWidth, visibility: "hidden" };

  return (
    <span
      className={styles.wrapper}
      onPointerEnter={() => show(false)}
      onPointerLeave={() => {
        suppressUntilLeaveRef.current = false;
        hideSoon();
      }}
      onPointerDownCapture={() => {
        // A press means the sentence has been read, or was not wanted.
        suppressUntilLeaveRef.current = true;
        hideNow();
      }}
      onFocusCapture={(event) => {
        if (keyboardFocus(event.target)) show(true);
      }}
      onBlurCapture={hideNow}
    >
      <span ref={triggerRef} aria-describedby={descriptionId} className={styles.trigger}>
        {children}
      </span>
      <span id={descriptionId} hidden>
        {content}
      </span>
      {visible && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={bubbleRef}
              id={tooltipId}
              role="tooltip"
              className={styles.bubble}
              data-level="float"
              data-side={place?.side}
              data-visible={place ? "true" : undefined}
              data-testid={testId}
              style={style}
              onPointerEnter={() => window.clearTimeout(hideTimer.current)}
              onPointerLeave={hideSoon}
            >
              {content}
              <span className={styles.arrow} aria-hidden="true" />
            </div>,
            document.body
          )
        : null}
    </span>
  );
}
