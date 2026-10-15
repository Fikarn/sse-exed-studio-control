import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// A modal layer's focus (DESIGN.md section 9), shared by the Dialog and the
// Sheet: the focus moves in once per opening, to the element marked
// `data-autofocus`, else the first that takes it, else the layer itself; Tab
// and Shift+Tab stay inside; and when the layer closes the focus goes back,
// to `returnTo` or to what had it before. With `onClose`, an Esc while the
// focus is inside calls it; without, the layer leaves Esc to its owner.
//
// New pages program, Slice 3 review (the Dialog's): the focus moves in once
// per opening. Callers pass an inline `onClose` that is new on every render
// (the shell's clock draws the page again every 15 s), so Esc reads the
// latest from a ref and never moves the focus again.

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** The elements in `container` that take the focus now, in order. */
export function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );
}

export interface ModalFocusOptions {
  /** The layer is open: the focus is moved in while it is, and given back when it stops being. */
  active?: boolean;
  /** Esc with the focus inside the layer calls it. */
  onClose?: () => void;
  /** Where the focus goes when the layer closes: by default what had it when it opened. */
  returnTo?: HTMLElement | null;
}

export function useModalFocus(
  layerRef: RefObject<HTMLElement | null>,
  { active = true, onClose, returnTo }: ModalFocusOptions = {}
): void {
  const onCloseRef = useRef(onClose);
  const returnToRef = useRef(returnTo);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    returnToRef.current = returnTo;
  });

  useEffect(() => {
    if (!active) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    if (!layer) return undefined;

    const first = layer.querySelector<HTMLElement>("[data-autofocus]") ?? focusableElements(layer)[0] ?? layer;
    first.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      const close = onCloseRef.current;
      if (event.key === "Escape" && close) {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusables = focusableElements(layer);
      if (focusables.length === 0) {
        event.preventDefault();
        layer.focus();
        return;
      }

      const firstFocusable = focusables[0]!;
      const lastFocusable = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    layer.addEventListener("keydown", handleKeyDown);
    return () => {
      layer.removeEventListener("keydown", handleKeyDown);
      (returnToRef.current ?? previouslyFocused)?.focus({ preventScroll: true });
    };
  }, [active, layerRef]);
}
