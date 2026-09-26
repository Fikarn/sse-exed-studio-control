import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UNDO_STACK_LIMIT, UndoRefusedError, useUndoStack, type UndoOutcome } from "./useUndoStack";

// New pages program, Slice 3 (decision 5): Ctrl+Z and Ctrl+Shift+Z went with the
// keyboard shortcuts. The Undo key in the Rig section undoes the newest of the
// last 25 steps and its small print names that step, so the stack says which
// step is next; there is no redo.

afterEach(() => {
  cleanup();
});

function step(label: string, log: string[]) {
  return {
    label,
    undo: async () => {
      log.push(label);
    },
  };
}

async function undo(hook: { result: { current: ReturnType<typeof useUndoStack> } }): Promise<UndoOutcome> {
  let outcome: UndoOutcome = { kind: "noop" };
  await act(async () => {
    outcome = await hook.result.current.undo();
  });
  return outcome;
}

describe("useUndoStack", () => {
  it("names the newest step, undoes the newest first, and has no redo", async () => {
    const log: string[] = [];
    const hook = renderHook(() => useUndoStack());
    expect(hook.result.current.nextLabel).toBeNull();
    expect(hook.result.current.canUndo).toBe(false);
    expect("redo" in hook.result.current).toBe(false);
    expect("canRedo" in hook.result.current).toBe(false);

    act(() => {
      hook.result.current.push(step("Save scene Wide", log));
      hook.result.current.push(step("Delete fixture Key", log));
    });
    expect(hook.result.current.nextLabel).toBe("Delete fixture Key");
    expect(hook.result.current.canUndo).toBe(true);

    expect(await undo(hook)).toEqual({ kind: "ok", label: "Delete fixture Key" });
    expect(hook.result.current.nextLabel).toBe("Save scene Wide");
    expect(await undo(hook)).toEqual({ kind: "ok", label: "Save scene Wide" });
    expect(log).toEqual(["Delete fixture Key", "Save scene Wide"]);

    expect(hook.result.current.nextLabel).toBeNull();
    expect(hook.result.current.canUndo).toBe(false);
    expect(await undo(hook)).toEqual({ kind: "noop" });
  });

  it("reaches back 25 steps: the 26th oldest is gone", async () => {
    const log: string[] = [];
    const hook = renderHook(() => useUndoStack());
    act(() => {
      for (let index = 1; index <= UNDO_STACK_LIMIT + 5; index += 1) {
        hook.result.current.push(step(`Add fixture Stand ${index}`, log));
      }
    });
    expect(hook.result.current.nextLabel).toBe(`Add fixture Stand ${UNDO_STACK_LIMIT + 5}`);

    for (let count = 0; count < UNDO_STACK_LIMIT; count += 1) {
      expect((await undo(hook)).kind).toBe("ok");
    }
    expect(log[log.length - 1]).toBe("Add fixture Stand 6");
    expect(hook.result.current.nextLabel).toBeNull();
    expect(await undo(hook)).toEqual({ kind: "noop" });
  });

  it("drops a refused step and keeps a failed one to try again", async () => {
    const hook = renderHook(() => useUndoStack());
    act(() => {
      hook.result.current.push({ label: "Save scene Wide", undo: async () => {} });
      hook.result.current.push({
        label: "Add fixture Stand 4",
        undo: async () => {
          throw new UndoRefusedError("fixture is referenced by 1 scene saved after it was added");
        },
      });
    });
    expect(await undo(hook)).toEqual({
      kind: "rejected",
      label: "Add fixture Stand 4",
      reason: "fixture is referenced by 1 scene saved after it was added",
    });
    expect(hook.result.current.nextLabel).toBe("Save scene Wide");

    const failure = new Error("the bridge did not answer");
    act(() => {
      hook.result.current.push({
        label: "Delete scene Interview",
        undo: async () => {
          throw failure;
        },
      });
    });
    expect(await undo(hook)).toEqual({ kind: "error", label: "Delete scene Interview", error: failure });
    expect(hook.result.current.nextLabel).toBe("Delete scene Interview");
  });
});
