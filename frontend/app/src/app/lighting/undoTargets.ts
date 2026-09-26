import type { LightingSnapshot, ShellStore } from "@sse/engine-client";

// New pages program, Slice 3 review, finding 17. An undo step acted on the id
// its scene or fixture had when the step was taken. Undoing Delete scene or
// Delete fixture brings it back under a new id, and the hardware link gives a
// freed id to the next scene or fixture it creates (the highest in use plus
// one), so by the time an older step was undone its id could name nothing — the
// step failed, went back on top and the Undo key stuck on it — or another scene
// or fixture, which it then deleted. Here every step that names the same scene
// or fixture shares one target, and the steps that delete it or bring it back
// move that target: an older step acts on the scene or fixture it named, under
// the id it has now, or is refused when it is gone. A map from old ids to new
// ones cannot do this: the same id names different scenes at different times
// (Scene 4 comes back as scene-custom-1 while Scene 3's steps still say
// scene-custom-1).

export type UndoTargetKind = "scene" | "fixture";

export interface UndoTarget {
  readonly kind: UndoTargetKind;
  /** Its id now, or null while it is deleted. */
  id: string | null;
}

export class UndoTargets {
  private readonly byId = new Map<string, UndoTarget>();

  /** The target of the scene or fixture that has this id now, shared by every
   *  step that names it. */
  of(kind: UndoTargetKind, id: string): UndoTarget {
    const existing = this.byId.get(`${kind}:${id}`);
    if (existing) return existing;
    const target: UndoTarget = { kind, id };
    this.byId.set(`${kind}:${id}`, target);
    return target;
  }

  /** A step created a scene or a fixture under this id. */
  created(kind: UndoTargetKind, id: string): UndoTarget {
    const target: UndoTarget = { kind, id: null };
    this.place(target, id);
    return target;
  }

  /** An undo brought a deleted scene or fixture back under this id. */
  restored(target: UndoTarget, id: string): void {
    this.place(target, id);
  }

  /** A step deleted it: the steps that name it are refused until an undo
   *  brings it back. */
  deleted(target: UndoTarget): void {
    if (target.id !== null && this.byId.get(`${target.kind}:${target.id}`) === target) {
      this.byId.delete(`${target.kind}:${target.id}`);
    }
    target.id = null;
  }

  private place(target: UndoTarget, id: string): void {
    this.deleted(target);
    // Whatever had this id before has gone, or the hardware link would not
    // have given it out again.
    const previous = this.byId.get(`${target.kind}:${id}`);
    if (previous) previous.id = null;
    target.id = id;
    this.byId.set(`${target.kind}:${id}`, target);
  }
}

/** The rig as the hardware link last reported it. An undo step checks its
 *  target against this, not against the page's own copy, which the shell hands
 *  Lighting deferred: checked against that, a scene an undo has just brought
 *  back could look deleted, and the step would be dropped. */
export function rigNow(store: ShellStore): LightingSnapshot {
  const snapshot = store.getSnapshot().lightingSnapshot;
  // Not read yet: a plain failure, so the step stays in place to try again.
  if (!snapshot) throw new Error("The rig has not been read yet.");
  return snapshot;
}
