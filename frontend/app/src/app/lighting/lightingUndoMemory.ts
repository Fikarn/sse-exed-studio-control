import type { ShellStore } from "@sse/engine-client";

import { UndoTargets } from "./undoTargets";
import { UndoHistory } from "./useUndoStack";

// Found, to check (2026-09-28): Lighting's Undo forgot its steps when the page
// was left, since they lived in the page's own hooks. They live here, one
// memory for each store, and outlive the page: leave Lighting for the Console
// and come back, and Undo still reaches the last 25 steps.
//
// A step names scenes and fixtures by the ids the saved data had when it was
// taken (`undoTargets.ts`). The memory forgets every step when the saved data
// may no longer be the one they named: when the hardware link is not ready
// (it restarts, a database restore included, or it failed) and when a restore
// was made (an archive's does not restart it). Until 2026-09-29 leaving the
// page did that by accident; a step kept past a restore could have deleted
// another scene that now has its id.

export interface LightingUndoMemory {
  history: UndoHistory;
  targets: UndoTargets;
  /** The scenes' thumbnails as last written, shared by every visit to the
   *  page: a step taken on an earlier visit writes them from here, not from
   *  what that visit last saw. */
  sceneThumbs: { current: Record<string, string> };
}

const memories = new WeakMap<ShellStore, LightingUndoMemory>();

export function lightingUndoMemory(store: ShellStore): LightingUndoMemory {
  const known = memories.get(store);
  if (known) return known;

  const memory: LightingUndoMemory = {
    history: new UndoHistory(),
    targets: new UndoTargets(),
    sceneThumbs: { current: {} },
  };
  let restoreCount = store.getSnapshot().restoreCount;
  store.subscribe(() => {
    const now = store.getSnapshot();
    if (now.lifecycle !== "ready" || now.restoreCount !== restoreCount) {
      restoreCount = now.restoreCount;
      memory.history.clear();
      memory.targets.clear();
    }
  });
  memories.set(store, memory);
  return memory;
}
