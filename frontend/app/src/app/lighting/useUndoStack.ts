import { useState, useSyncExternalStore } from "react";

/** How many steps the Undo key reaches back. */
export const UNDO_STACK_LIMIT = 25;

export interface UndoEntry {
  /** Stable identifier; only used internally for React keys / debugging. */
  id: string;
  /** Short label of the step, e.g. "Add fixture Stand 4". The Undo key prints
   *  it as its small print, and the message after an undo names it. */
  label: string;
  /** Reverses the step. May reject — callers should show feedback. */
  undo: () => Promise<void>;
}

export type UndoOutcome =
  | { kind: "ok"; label: string }
  | { kind: "noop" }
  | { kind: "rejected"; label: string; reason: string }
  | { kind: "error"; label: string; error: unknown };

export interface UndoStack {
  push: (entry: Omit<UndoEntry, "id">) => void;
  /** Undoes the newest step. */
  undo: () => Promise<UndoOutcome>;
  canUndo: boolean;
  /** The label of the step the next undo reverses, or null when there is none. */
  nextLabel: string | null;
}

/**
 * Reject `undo()` from inside an undo-fn body to indicate the step cannot be
 * reversed (e.g. a referential constraint changed). The stack surfaces a
 * `rejected` outcome instead of an error and drops the entry.
 */
export class UndoRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UndoRefusedError";
  }
}

// New pages program, Slice 3 (decision 5): the Undo key in the Rig section
// undoes the newest of the last 25 steps — Save scene, Delete scene, Add
// fixture, Delete fixture — and its small print names that step. There is no
// redo: to do a step again, the operator saves, adds or deletes again.
//
// Found, to check (2026-09-28): the steps lived in the Lighting page's own
// hook and were forgotten when the page was left. They live here, outside the
// page, so the Lighting page keeps one history for the whole session
// (`lightingUndoMemory.ts`), and the page reads it through `useUndoStack`.
export class UndoHistory {
  private entries: UndoEntry[] = [];
  private idCounter = 0;
  /** Raised by every `clear`: an undo that was running then does not put its
   *  step back into the history that forgot it (the review of #263). */
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  /** The label of the step the next undo reverses, or null when there is none. */
  readonly nextLabel = (): string | null => this.entries[this.entries.length - 1]?.label ?? null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly push = (entry: Omit<UndoEntry, "id">): void => {
    this.idCounter += 1;
    this.entries.push({ id: `u${this.idCounter}`, ...entry });
    if (this.entries.length > UNDO_STACK_LIMIT) {
      this.entries.shift();
    }
    this.announce();
  };

  /** Undoes the newest step. */
  readonly undo = async (): Promise<UndoOutcome> => {
    const entry = this.entries.pop();
    const generation = this.generation;
    this.announce();
    if (!entry) return { kind: "noop" };
    try {
      await entry.undo();
      return { kind: "ok", label: entry.label };
    } catch (error) {
      if (error instanceof UndoRefusedError) {
        return { kind: "rejected", label: entry.label, reason: error.message };
      }
      // Put the entry back so the operator can try again, unless the history
      // was cleared while it ran: the saved data it names may be gone.
      if (generation === this.generation) {
        this.entries.push(entry);
        this.announce();
      }
      return { kind: "error", label: entry.label, error };
    }
  };

  /** Forgets every step: the saved data they name is not the saved data now. */
  readonly clear = (): void => {
    this.generation += 1;
    if (this.entries.length === 0) return;
    this.entries = [];
    this.announce();
  };

  private announce() {
    for (const listener of this.listeners) listener();
  }
}

/** The Undo key's view of a history: `history` when the page keeps one beyond
 *  itself, else one of this component's own. */
export function useUndoStack(history?: UndoHistory): UndoStack {
  const [own] = useState(() => new UndoHistory());
  const active = history ?? own;
  const nextLabel = useSyncExternalStore(active.subscribe, active.nextLabel);
  return { push: active.push, undo: active.undo, canUndo: nextLabel !== null, nextLabel };
}
