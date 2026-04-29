import { useEffect } from "react";

type LeaveGuard = () => Promise<boolean> | boolean;

let activeGuard: LeaveGuard | null = null;

/**
 * Imperative setter used by hook + tests. The active guard is asked for
 * permission before any cross-workspace navigation.
 */
export function setUnsavedChangesGuard(guard: LeaveGuard | null) {
  activeGuard = guard;
}

/**
 * Resolve the registered guard. Returns `true` when there is no guard or
 * when the guard allows the navigation.
 */
export async function attemptLeaveCurrentWorkspace(): Promise<boolean> {
  if (!activeGuard) return true;
  return Promise.resolve(activeGuard());
}

/**
 * Register a leave guard for as long as the calling component is mounted
 * AND the supplied guard is non-null. A null `guard` clears the slot.
 *
 * Currently single-slot — only one workspace at a time can register. Today
 * Lighting is the sole registrant so last-write-wins is fine; lift to a
 * stack model when other workspaces start needing this.
 *
 * Also wires a `beforeunload` listener while the guard is set so refresh /
 * close prompts the user as well as in-app navigation does.
 */
export function useUnsavedChangesGuard(guard: LeaveGuard | null) {
  useEffect(() => {
    setUnsavedChangesGuard(guard);

    if (!guard) return () => setUnsavedChangesGuard(null);

    const beforeUnload = (event: BeforeUnloadEvent) => {
      // Modern browsers ignore custom strings but require returnValue/preventDefault
      // to surface the native confirm.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      setUnsavedChangesGuard(null);
    };
  }, [guard]);
}
