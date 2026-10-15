import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tokenValues } from "@sse/tokens";

import styles from "./Sheet.module.css";
import { useModalFocus } from "./useModalFocus";

// The sheet (D51; docs/design/session.md, board 2): a window on the floating
// layer that opens from what it came from, the Session page's window from
// its Room. Modal: the focus moves in, stays inside on Tab and goes back to
// where it came from (`useModalFocus`), and the page under it is dimmed. Its
// scrim starts under the header, as the drawer does, so the header stays live
// above it: a press on a tab leaves the page, and the window with it.
//
// Esc closes it wherever the focus is, unless a layer above took the Esc
// first (one Esc, one layer), and so does a press on the dimmed page. The
// sheet only asks (`onClose`); its owner closes it by `open`.
//
// The motion (Web Animations, lifted from board 2): opening, the face grows
// from the outline of `from` to its own while the art travels from there into
// the sheet's left side at the same proportions, and the body fades in beside
// it (340 ms, the program's ease); closing runs it back (260 ms) and then the
// sheet leaves (`onClosed`). The art is drawn at its own size: only the
// travel is a transform. Every animation ends or is cancelled, so nothing
// runs at idle. With `prefers-reduced-motion`, or with nothing to come from,
// the sheet only fades (200 · 120 ms).
//
// It stands with the drawer on the page's floating layer (`--z-overlay`), so
// a toast, the shell's own dialog, a menu and a tooltip stand above it.
export type SheetCloseReason = "escape" | "scrim";

export interface SheetProps {
  /** Open, or closing: `false` runs the close, and the sheet leaves at its end. */
  open: boolean;
  /** Its name, when nothing in it names it. */
  title?: string;
  /** The id of what names it (a kicker in its body). */
  labelledBy?: string;
  width: number;
  height: number;
  /** A picture at its left, as high as the sheet: the Session page's Room at the window's size. */
  art?: ReactNode;
  artWidth?: number;
  /** What it opens from and closes into: the Room on the page. */
  from?: () => Element | null;
  /** Esc, or a press on the dimmed page: the owner closes it by `open`. */
  onClose: (reason: SheetCloseReason) => void;
  /** The close has run and the sheet has left: the page shows its Room again. */
  onClosed?: () => void;
  /** Where the focus goes when it has closed; by default what had it when it opened. */
  returnFocusTo?: HTMLElement | null;
  testId?: string;
  children?: ReactNode;
}

const ms = (value: string) => Number.parseFloat(value);
const OPEN_MS = ms(tokenValues.MotionDurationOpen);
const CLOSE_MS = ms(tokenValues.MotionDurationClose);
const FADE_IN_MS = ms(tokenValues.MotionDurationEnter);
const FADE_OUT_MS = ms(tokenValues.MotionDurationExit);
const EASE = tokenValues.MotionEasingMech;
// Board 2's timings inside the open and the close: the body fades in as the
// face reaches its size, and fades out first; the scrim follows the face.
const BODY_IN_DELAY_MS = 210;
const BODY_OUT_MS = 100;
const SCRIM_IN_MS = 260;
const SCRIM_OUT_MS = 240;

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function play(element: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  return element && typeof element.animate === "function" ? element.animate(keyframes, options) : null;
}

/** The sheet's parts the motion moves. */
interface Parts {
  section: HTMLElement;
  scrim: HTMLElement | null;
  face: HTMLElement | null;
  art: HTMLElement | null;
  body: HTMLElement | null;
}

/** Where `from` stands, as the face's box and the art's travel inside the sheet. */
function travel(parts: Parts, from: Element | null | undefined) {
  if (!from || prefersReducedMotion()) return null;
  const to = parts.section.getBoundingClientRect();
  const at = from.getBoundingClientRect();
  if (!to.height || !at.height) return null;
  const left = at.left - to.left;
  const top = at.top - to.top;
  return {
    box: { left: `${left}px`, top: `${top}px`, width: `${at.width}px`, height: `${at.height}px` },
    own: { left: "0px", top: "0px", width: `${to.width}px`, height: `${to.height}px` },
    art: `translate(${left}px, ${top}px) scale(${at.height / to.height})`,
  };
}

function opening(parts: Parts, from: Element | null | undefined): Animation[] {
  const way = travel(parts, from);
  if (!way) {
    const fade = { duration: FADE_IN_MS, easing: "ease-out" };
    return [
      play(parts.section, [{ opacity: 0 }, { opacity: 1 }], fade),
      play(parts.scrim, [{ opacity: 0 }, { opacity: 1 }], fade),
    ].filter((animation): animation is Animation => animation !== null);
  }
  return [
    play(parts.face, [way.box, way.own], { duration: OPEN_MS, easing: EASE }),
    play(parts.art, [{ transform: way.art }, { transform: "none" }], { duration: OPEN_MS, easing: EASE }),
    play(
      parts.body,
      [
        { opacity: 0, transform: "translateX(-16px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: FADE_IN_MS, delay: BODY_IN_DELAY_MS, easing: EASE, fill: "backwards" }
    ),
    play(parts.scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: SCRIM_IN_MS, easing: "ease-out" }),
  ].filter((animation): animation is Animation => animation !== null);
}

function closing(parts: Parts, from: Element | null | undefined): Animation[] {
  const way = travel(parts, from);
  if (!way) {
    const fade = { duration: FADE_OUT_MS, easing: "ease-in", fill: "forwards" } as const;
    return [
      play(parts.section, [{ opacity: 1 }, { opacity: 0 }], fade),
      play(parts.scrim, [{ opacity: 1 }, { opacity: 0 }], fade),
    ].filter((animation): animation is Animation => animation !== null);
  }
  return [
    play(parts.body, [{ opacity: 1 }, { opacity: 0 }], { duration: BODY_OUT_MS, fill: "forwards" }),
    play(parts.scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: SCRIM_OUT_MS, fill: "forwards" }),
    play(parts.face, [way.own, way.box], { duration: CLOSE_MS, easing: EASE, fill: "forwards" }),
    play(parts.art, [{ transform: "none" }, { transform: way.art }], {
      duration: CLOSE_MS,
      easing: EASE,
      fill: "forwards",
    }),
  ].filter((animation): animation is Animation => animation !== null);
}

export function Sheet({
  open,
  title,
  labelledBy,
  width,
  height,
  art,
  artWidth = 0,
  from,
  onClose,
  onClosed,
  returnFocusTo,
  testId,
  children,
}: SheetProps) {
  // Open, then closing until the close has run: the sheet stays drawn through it.
  const [wasOpen, setWasOpen] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setIsClosing(!open);
  }
  const present = open || isClosing;

  const sectionRef = useRef<HTMLElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onClosedRef = useRef(onClosed);
  const fromRef = useRef(from);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    onClosedRef.current = onClosed;
    fromRef.current = from;
  });

  useModalFocus(sectionRef, { active: present, returnTo: returnFocusTo });

  const parts = (): Parts | null =>
    sectionRef.current
      ? {
          section: sectionRef.current,
          scrim: scrimRef.current,
          face: faceRef.current,
          art: artRef.current,
          body: bodyRef.current,
        }
      : null;

  // Opening: drawn in its place, then moved from `from` before the first paint.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const sheet = parts();
    if (!sheet) return undefined;
    const animations = opening(sheet, fromRef.current?.());
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [open]);

  // Closing: run back into `from`, and hold the last frame (the art where
  // the Room stands) until the sheet leaves in the same render that shows the
  // Room again, so nothing is drawn twice or not at all; leaving cancels it.
  useLayoutEffect(() => {
    if (!isClosing) return undefined;
    const sheet = parts();
    const animations = sheet ? closing(sheet, fromRef.current?.()) : [];
    const end = () => {
      setIsClosing(false);
      onClosedRef.current?.();
    };
    if (animations.length === 0) {
      end();
      return undefined;
    }
    let live = true;
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (live) end();
      },
      () => undefined
    );
    return () => {
      live = false;
      for (const animation of animations) animation.cancel();
    };
  }, [isClosing]);

  // Esc closes it wherever the focus is, unless a layer above took it first.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current("escape");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!present || typeof document === "undefined") return null;

  const size = {
    "--sheet-width": `${width}px`,
    "--sheet-height": `${height}px`,
    "--sheet-art-width": `${art ? artWidth : 0}px`,
  } as CSSProperties;

  return createPortal(
    <>
      <div
        ref={scrimRef}
        className={styles.scrim}
        data-sheet-scrim=""
        data-testid={testId ? `${testId}-scrim` : undefined}
        onClick={() => {
          if (open) onCloseRef.current("scrim");
        }}
      />
      <section
        ref={sectionRef}
        className={styles.sheet}
        style={size}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        data-level="float"
        data-material="plate"
        data-closing={isClosing ? "" : undefined}
        data-testid={testId}
        tabIndex={-1}
      >
        <div ref={faceRef} className={styles.face} data-sheet-face="" />
        {art ? (
          <div ref={artRef} className={styles.art} data-sheet-art="">
            {art}
          </div>
        ) : null}
        <div ref={bodyRef} className={styles.body} data-sheet-body="">
          {children}
        </div>
      </section>
    </>,
    document.body
  );
}
