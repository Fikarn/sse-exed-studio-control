import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { CommandPalette, type PaletteAction } from "@sse/design-system";

interface RegistrationEntry {
  id: number;
  actions: readonly PaletteAction[];
}

export interface PaletteApi {
  /** Whether the palette is currently visible. */
  open: boolean;
  /** Toggle / set the palette's visibility. */
  setOpen: (next: boolean) => void;
  /** Register a list of actions. Returns an unregister function — the caller
   *  is responsible for calling it on unmount via useEffect cleanup. Calling
   *  `register` again from the same effect (after a state change re-runs the
   *  effect) replaces the previous registration via the unregister fn. */
  register: (actions: readonly PaletteAction[]) => () => void;
  /** Push a recently-activated action id to the front of the recents ring.
   *  Workspaces typically wire this to specific user actions (e.g. recall scene). */
  pushRecent: (actionId: string) => void;
}

const RECENT_LIMIT = 8;

const PaletteContext = createContext<PaletteApi | null>(null);

/**
 * App-shell command palette provider. Owns:
 * - the open/close state (driven by ⌘K),
 * - the cross-workspace action registry (workspaces inject via `register`),
 * - the recent-action ring buffer (length 8, most-recent-first),
 * - the actual `<CommandPalette>` mount via portal.
 *
 * Mount once at the OperatorShell root. Workspaces consume via `usePalette()`
 * and call `register([...])` from a useEffect that depends on whatever state
 * the actions close over.
 */
export function PaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [registrations, setRegistrations] = useState<readonly RegistrationEntry[]>([]);
  const [recentIds, setRecentIds] = useState<readonly string[]>([]);
  const idCounterRef = useRef(0);

  const register = useCallback((actions: readonly PaletteAction[]) => {
    idCounterRef.current += 1;
    const id = idCounterRef.current;
    setRegistrations((prev) => [...prev, { id, actions }]);
    return () => {
      setRegistrations((prev) => prev.filter((entry) => entry.id !== id));
    };
  }, []);

  const pushRecent = useCallback((actionId: string) => {
    setRecentIds((prev) => {
      const filtered = prev.filter((id) => id !== actionId);
      return [actionId, ...filtered].slice(0, RECENT_LIMIT);
    });
  }, []);

  const flatActions = useMemo(() => registrations.flatMap((entry) => entry.actions), [registrations]);

  const handleClose = useCallback(() => setOpen(false), []);

  // Wrap each action so activation also pushes to the recents ring.
  const wrappedActions = useMemo<readonly PaletteAction[]>(
    () =>
      flatActions.map((action) => ({
        ...action,
        action: () => {
          pushRecent(action.id);
          action.action();
        },
      })),
    [flatActions, pushRecent]
  );

  const api = useMemo<PaletteApi>(() => ({ open, setOpen, register, pushRecent }), [open, register, pushRecent]);

  return (
    <PaletteContext.Provider value={api}>
      {children}
      <CommandPalette open={open} onClose={handleClose} actions={wrappedActions} recentActionIds={recentIds} />
    </PaletteContext.Provider>
  );
}

export function usePalette(): PaletteApi {
  const ctx = useContext(PaletteContext);
  if (!ctx) {
    throw new Error("usePalette must be used inside <PaletteProvider>");
  }
  return ctx;
}
