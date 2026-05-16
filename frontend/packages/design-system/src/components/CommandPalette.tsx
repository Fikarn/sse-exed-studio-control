import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import fuzzysort from "fuzzysort";

import styles from "./CommandPalette.module.css";

export interface PaletteAction {
  /** Stable id for keyboard nav + recency tracking. */
  id: string;
  /** Display label, also the primary fuzzy-search target. */
  label: string;
  /** Optional group heading (e.g. "Scene", "Workspace"). */
  group?: string;
  /** Extra search keywords merged with `label` for fuzzy matching. */
  keywords?: readonly string[];
  /** Activation handler. Palette closes immediately after this fires. */
  action: () => void;
  /** Optional accelerator hint shown on the right (e.g. "⌘S"). Display only — the
   *  palette doesn't bind shortcuts itself. */
  shortcut?: string;
  /** Visibility predicate evaluated at filter time. Returning false hides
   *  the action from the current pass. Defaults to always-visible. */
  when?: () => boolean;
}

export interface CommandPaletteProps {
  /** Controlled open state. */
  open: boolean;
  /** Fires when the palette wants to close (Esc, backdrop click, action run). */
  onClose: () => void;
  /** Full action set across all workspaces. */
  actions: readonly PaletteAction[];
  /** Optional ordered list of recent action ids. When the search input is
   *  empty, the palette surfaces these at the top under a "Recent" heading
   *  (most recent first). */
  recentActionIds?: readonly string[];
  /** Optional placeholder for the search input. */
  placeholder?: string;
  /** Optional empty-state message when the query yields no matches. */
  emptyMessage?: ReactNode;
}

interface SortedAction {
  action: PaletteAction;
  score: number;
}

const RECENT_GROUP = "Recent";

/**
 * Floating command palette (⌘K). Renders a search input + grouped result
 * list inside a portal at document.body. Keyboard nav: ↑/↓ moves focus,
 * Enter activates, Esc closes. Click on backdrop closes. Empty query
 * surfaces a "Recent" group from `recentActionIds` so frequent actions
 * (recall scene N) are one keystroke away.
 *
 * The action registry is owned by the consumer. Mount once at the shell
 * root; workspaces inject their actions via `actions` (typically gathered
 * through a context provider so registration is composable).
 */
export function CommandPalette({
  open,
  onClose,
  actions,
  recentActionIds,
  placeholder = "Type a command — try: recall, save, patch, identify",
  emptyMessage = "No matching commands.",
}: CommandPaletteProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);

  // Reset query + focus on open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFocusIndex(0);
    // Focus the input after the portal mounts.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Close on Esc or backdrop click handled inline. Escape captured in panel
  // onKeyDown so it doesn't leak past the palette to other shortcuts.

  const visibleActions = useMemo(() => actions.filter((a) => (a.when ? a.when() : true)), [actions]);

  const sortedResults: ReadonlyArray<{ group: string; entries: readonly SortedAction[] }> = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // Empty query: prepend Recent (preserving order), then the rest grouped
      // by `group` in registration order.
      const byId = new Map(visibleActions.map((a) => [a.id, a]));
      const recents: SortedAction[] = [];
      for (const id of recentActionIds ?? []) {
        const action = byId.get(id);
        if (action) recents.push({ action, score: 0 });
      }
      const seenRecent = new Set(recents.map((r) => r.action.id));
      const groups = new Map<string, SortedAction[]>();
      const groupOrder: string[] = [];
      if (recents.length > 0) {
        groups.set(RECENT_GROUP, recents);
        groupOrder.push(RECENT_GROUP);
      }
      for (const action of visibleActions) {
        if (seenRecent.has(action.id)) continue;
        const groupKey = action.group ?? "Commands";
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
          groupOrder.push(groupKey);
        }
        groups.get(groupKey)!.push({ action, score: 0 });
      }
      return groupOrder.map((g) => ({ group: g, entries: groups.get(g) ?? [] }));
    }
    // Typed query: fuzzy-rank across label + keywords. Higher score wins.
    const targets = visibleActions.map((action) => ({
      ...action,
      _label: fuzzysort.prepare(action.label),
      _keywords: (action.keywords ?? []).map((k) => fuzzysort.prepare(k)),
    }));
    type Scored = { action: PaletteAction; score: number };
    const scored: Scored[] = [];
    for (const target of targets) {
      const labelHit = fuzzysort.single(trimmed, target._label);
      let bestKeyword = -Infinity;
      for (const kwTarget of target._keywords) {
        const kHit = fuzzysort.single(trimmed, kwTarget);
        if (kHit && kHit.score > bestKeyword) bestKeyword = kHit.score;
      }
      const labelScore = labelHit ? labelHit.score : -Infinity;
      const score = Math.max(labelScore, bestKeyword);
      if (Number.isFinite(score)) {
        scored.push({ action: target as unknown as PaletteAction, score });
      }
    }
    const groupOrder: string[] = [];
    for (const action of visibleActions) {
      const groupKey = action.group ?? "Commands";
      if (!groupOrder.includes(groupKey)) {
        groupOrder.push(groupKey);
      }
    }
    const groups = new Map<string, SortedAction[]>();
    for (const entry of scored) {
      const groupKey = entry.action.group ?? "Commands";
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(entry);
    }
    for (const entries of groups.values()) {
      entries.sort((a, b) => b.score - a.score);
    }
    return groupOrder
      .map((group) => ({ group, entries: groups.get(group) ?? [] }))
      .filter((group) => group.entries.length > 0);
  }, [query, recentActionIds, visibleActions]);

  // Flatten for keyboard navigation; focusIndex is into this flat list.
  const flatList = useMemo(() => sortedResults.flatMap((g) => g.entries), [sortedResults]);

  // Clamp focusIndex when results length changes.
  useEffect(() => {
    if (focusIndex >= flatList.length) {
      setFocusIndex(flatList.length === 0 ? 0 : flatList.length - 1);
    }
  }, [flatList.length, focusIndex]);

  // Reset focus to top on query change.
  useEffect(() => {
    setFocusIndex(0);
  }, [query]);

  const activate = useCallback(
    (entry: SortedAction | undefined) => {
      if (!entry) return;
      onClose();
      // Run after close so the action's UI side-effects happen on a clean
      // post-paint frame. Avoids the palette's portal still being mounted
      // when the action opens another modal.
      window.setTimeout(() => entry.action.action(), 0);
    },
    [onClose]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusIndex((i) => Math.min(flatList.length - 1, i + 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          setFocusIndex((i) => Math.max(0, i - 1));
          return;
        case "Home":
          event.preventDefault();
          setFocusIndex(0);
          return;
        case "End":
          event.preventDefault();
          setFocusIndex(Math.max(0, flatList.length - 1));
          return;
        case "Enter":
          event.preventDefault();
          activate(flatList[focusIndex]);
          return;
        case "Escape":
          event.preventDefault();
          onClose();
          return;
        default:
          return;
      }
    },
    [activate, flatList, focusIndex, onClose]
  );

  if (!open || typeof document === "undefined") return null;

  // Build a map of (action.id → flat index) so per-row click handlers can set
  // the right focus + activation reliably.
  const flatIndexById = new Map<string, number>();
  flatList.forEach((entry, i) => flatIndexById.set(entry.action.id, i));

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        // Click on backdrop (not on the panel) closes. mousedown beats click
        // so the palette disappears before the parent app sees the click.
        if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className={styles.input}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
          aria-controls={`${inputId}-list`}
          aria-activedescendant={
            flatList[focusIndex] ? `${inputId}-item-${flatList[focusIndex]!.action.id}` : undefined
          }
        />
        <ul id={`${inputId}-list`} role="listbox" className={styles.list}>
          {flatList.length === 0 ? (
            <li className={styles.empty}>{emptyMessage}</li>
          ) : (
            sortedResults.map((group) => (
              <li key={group.group} className={styles.group}>
                <div className={styles.groupHeader}>{group.group}</div>
                <ul className={styles.groupList}>
                  {group.entries.map((entry) => {
                    const idx = flatIndexById.get(entry.action.id) ?? 0;
                    const focused = idx === focusIndex;
                    return (
                      <li
                        key={entry.action.id}
                        id={`${inputId}-item-${entry.action.id}`}
                        role="option"
                        aria-selected={focused}
                        className={[styles.item, focused ? styles.itemFocused : ""].filter(Boolean).join(" ")}
                        onMouseEnter={() => setFocusIndex(idx)}
                        onMouseDown={(event) => {
                          event.preventDefault(); // keep input focused during click
                          activate(entry);
                        }}
                      >
                        <span className={styles.label}>{entry.action.label}</span>
                        {entry.action.shortcut ? (
                          <span className={styles.shortcut}>{entry.action.shortcut}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body
  );
}
