// The page tests count the renders of a page's root and of its heavy parts
// through `window.__SSE_TEST_RENDER_COUNTS__`, which a test sets before the
// page loads: the Console's meter ticks must not render the Console, and a
// store change that is not a page's must not render that page, since every
// store change renders the shell (the audit of 2026-10-12). In the app the
// object is absent and nothing is counted.

export type RenderCountKey =
  "audioInspector" | "audioRail" | "audioSignalCanvas" | "audioWorkspace" | "lightingWorkspace" | "overviewWorkspace";

declare global {
  interface Window {
    __SSE_TEST_RENDER_COUNTS__?: Partial<Record<RenderCountKey, number>>;
  }
}

/** Counts one render of `key`: called from a component's effect with no dependencies. */
export function countRender(key: RenderCountKey) {
  const counts = window.__SSE_TEST_RENDER_COUNTS__;
  if (!counts) return;
  counts[key] = (counts[key] ?? 0) + 1;
}
