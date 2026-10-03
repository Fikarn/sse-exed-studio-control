// Visual overhaul B (DESIGN.md §7): what counts as a floating layer, in one
// place. The Cameras page's pictures are drawn by a native layer over the
// page, which leaves a hole for every floating layer that stands over a
// picture (at most eight) and hides every picture while a dialog is open. So
// every overlay the design system draws over a page is one of these — a menu,
// a list of values, a tooltip, or an element on the floating layer — and none
// of them is a dialog: the menu, the popover and the tooltip never take
// `role="dialog"`.

/** A floating layer: the native picture layer leaves a hole where one stands. */
export const FLOATING_LAYER_SELECTOR =
  '[data-picture-hole], [data-level="float"], [role="tooltip"][data-visible], [role="menu"], [role="listbox"]';

/** A layer that blocks the page: the native picture layer hides while one is open. */
export const COVERING_LAYER_SELECTOR = '[role="dialog"]';

/**
 * The floating layers under `root`, each once: a menu list inside its floating
 * panel is the panel's hole, not a second one.
 */
export function floatingLayers(root: ParentNode = document): Element[] {
  return Array.from(root.querySelectorAll(FLOATING_LAYER_SELECTOR)).filter(
    (element) => !element.parentElement?.closest(FLOATING_LAYER_SELECTOR)
  );
}
