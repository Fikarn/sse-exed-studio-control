import { useCallback, useRef, useState } from "react";

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
export function useUndoStack(): UndoStack {
  // A mutating ref avoids re-render churn while an undo runs; the newest
  // label is state so the Undo key re-renders when the history changes.
  const entriesRef = useRef<UndoEntry[]>([]);
  const [nextLabel, setNextLabel] = useState<string | null>(null);
  const idCounterRef = useRef(0);

  const sync = useCallback(() => {
    const newest = entriesRef.current[entriesRef.current.length - 1];
    setNextLabel(newest ? newest.label : null);
  }, []);

  const push = useCallback(
    (entry: Omit<UndoEntry, "id">) => {
      idCounterRef.current += 1;
      entriesRef.current.push({ id: `u${idCounterRef.current}`, ...entry });
      if (entriesRef.current.length > UNDO_STACK_LIMIT) {
        entriesRef.current.shift();
      }
      sync();
    },
    [sync]
  );

  const undo = useCallback(async (): Promise<UndoOutcome> => {
    const entry = entriesRef.current.pop();
    sync();
    if (!entry) return { kind: "noop" };
    try {
      await entry.undo();
      return { kind: "ok", label: entry.label };
    } catch (error) {
      if (error instanceof UndoRefusedError) {
        return { kind: "rejected", label: entry.label, reason: error.message };
      }
      // Put the entry back so the operator can try again.
      entriesRef.current.push(entry);
      sync();
      return { kind: "error", label: entry.label, error };
    }
  }, [sync]);

  return { push, undo, canUndo: nextLabel !== null, nextLabel };
}
