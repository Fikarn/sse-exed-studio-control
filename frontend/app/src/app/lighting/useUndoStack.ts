import { useCallback, useRef, useState } from "react";

const STACK_LIMIT = 25;

export interface UndoEntry {
  /** Stable identifier; only used internally for React keys / debugging. */
  id: string;
  /** Short past-tense label of the operation, e.g. "Add fixture Stand 4". */
  label: string;
  /** Reverses the operation. May reject — callers should show feedback. */
  undo: () => Promise<void>;
  /** Re-applies the operation. */
  redo: () => Promise<void>;
}

export type UndoOutcome =
  | { kind: "ok"; label: string; canRedo: boolean }
  | { kind: "noop" }
  | { kind: "rejected"; label: string; reason: string }
  | { kind: "error"; label: string; error: unknown };

export interface UndoStack {
  push: (entry: Omit<UndoEntry, "id">) => void;
  undo: () => Promise<UndoOutcome>;
  redo: () => Promise<UndoOutcome>;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Reject `undo()` from inside an undo-fn body to indicate the operation
 * cannot be reversed (e.g. a referential constraint changed). The stack
 * surfaces a `rejected` outcome instead of an error and drops the entry.
 */
export class UndoRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UndoRefusedError";
  }
}

export function useUndoStack(): UndoStack {
  // Two stacks. Mutating refs avoid re-render churn while a redo/undo runs;
  // a small canUndo/canRedo state keeps the consumer (button enable, toast
  // copy) reactive.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const idCounterRef = useRef(0);

  const sync = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const push = useCallback(
    (entry: Omit<UndoEntry, "id">) => {
      idCounterRef.current += 1;
      const full: UndoEntry = { id: `u${idCounterRef.current}`, ...entry };
      undoStackRef.current.push(full);
      if (undoStackRef.current.length > STACK_LIMIT) {
        undoStackRef.current.shift();
      }
      // Any new operation invalidates the redo stack.
      redoStackRef.current = [];
      sync();
    },
    [sync]
  );

  const undo = useCallback(async (): Promise<UndoOutcome> => {
    const entry = undoStackRef.current.pop();
    sync();
    if (!entry) return { kind: "noop" };
    try {
      await entry.undo();
      redoStackRef.current.push(entry);
      if (redoStackRef.current.length > STACK_LIMIT) {
        redoStackRef.current.shift();
      }
      sync();
      return { kind: "ok", label: entry.label, canRedo: true };
    } catch (error) {
      if (error instanceof UndoRefusedError) {
        sync();
        return { kind: "rejected", label: entry.label, reason: error.message };
      }
      // Restore the entry so the user can retry; treat as soft error.
      undoStackRef.current.push(entry);
      sync();
      return { kind: "error", label: entry.label, error };
    }
  }, [sync]);

  const redo = useCallback(async (): Promise<UndoOutcome> => {
    const entry = redoStackRef.current.pop();
    sync();
    if (!entry) return { kind: "noop" };
    try {
      await entry.redo();
      undoStackRef.current.push(entry);
      if (undoStackRef.current.length > STACK_LIMIT) {
        undoStackRef.current.shift();
      }
      sync();
      return { kind: "ok", label: entry.label, canRedo: false };
    } catch (error) {
      redoStackRef.current.push(entry);
      sync();
      return { kind: "error", label: entry.label, error };
    }
  }, [sync]);

  return { push, undo, redo, canUndo, canRedo };
}
