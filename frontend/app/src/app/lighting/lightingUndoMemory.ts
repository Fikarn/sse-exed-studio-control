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
// another scene that now has its id. The deck can delete a scene and save one
// that takes its id while the page is closed: the memory forgets the targets
// that left the rig, and Undo of Save scene deletes only a scene that still
// has the name it was saved under.

export interface LightingUndoMemory {
  history: UndoHistory;
  targets: UndoTargets;
}

const memories = new WeakMap<ShellStore, LightingUndoMemory>();

export function lightingUndoMemory(store: ShellStore): LightingUndoMemory {
  const known = memories.get(store);
  if (known) return known;

  const memory: LightingUndoMemory = {
    history: new UndoHistory(),
    targets: new UndoTargets(),
  };
  let restoreCount = store.getSnapshot().restoreCount;
  let rig = store.getSnapshot().lightingSnapshot;
  store.subscribe(() => {
    const now = store.getSnapshot();
    if (now.lifecycle !== "ready" || now.restoreCount !== restoreCount) {
      restoreCount = now.restoreCount;
      memory.history.clear();
      memory.targets.clear();
    }
    // A scene or a fixture that left the rig, the deck's doing while the page
    // was closed or the screen's, is forgotten as a target (the review of
    // #263): a scene the deck saves later under its id is not the one a step
    // named.
    if (now.lightingSnapshot && now.lightingSnapshot !== rig) {
      rig = now.lightingSnapshot;
      memory.targets.forgetMissing("scene", new Set(rig.scenes.map((scene) => scene.id)));
      memory.targets.forgetMissing("fixture", new Set(rig.fixtures.map((fixture) => fixture.id)));
    }
  });
  memories.set(store, memory);
  return memory;
}
