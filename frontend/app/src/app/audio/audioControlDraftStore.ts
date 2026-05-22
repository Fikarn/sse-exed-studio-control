import { useSyncExternalStore } from "react";

import { AUDIO_DRAFT_CLEAR_MS } from "./audioConstants";

type DraftListener = () => void;

export interface AudioControlDraftStore {
  clear(key: string): void;
  clearLater(key: string, delayMs?: number): void;
  dispose(): void;
  get(key: string): number | null;
  set(key: string, value: number): void;
  subscribe(key: string, listener: DraftListener): () => void;
}

export function createAudioControlDraftStore(): AudioControlDraftStore {
  const drafts = new Map<string, number>();
  const timers = new Map<string, number>();
  const listeners = new Map<string, Set<DraftListener>>();

  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) {
      // Why: listeners are external subscribers (React `useSyncExternalStore`
      // callbacks today, anything else in future). A throw in one listener
      // must not stop the rest from being notified, and must not leave the
      // store with a stale internal map. Log so a misbehaving subscriber is
      // visible in dev consoles, but never re-raise.
      try {
        listener();
      } catch (error) {
        console.warn("[audio] draft listener threw; isolated:", error);
      }
    }
  };

  const cancelTimer = (key: string) => {
    const timer = timers.get(key);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timers.delete(key);
  };

  return {
    clear(key) {
      cancelTimer(key);
      if (!drafts.delete(key)) return;
      notify(key);
    },
    clearLater(key, delayMs = AUDIO_DRAFT_CLEAR_MS) {
      cancelTimer(key);
      timers.set(
        key,
        window.setTimeout(() => {
          timers.delete(key);
          if (!drafts.delete(key)) return;
          notify(key);
        }, delayMs)
      );
    },
    dispose() {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
      drafts.clear();
      listeners.clear();
    },
    get(key) {
      return drafts.get(key) ?? null;
    },
    set(key, value) {
      cancelTimer(key);
      drafts.set(key, value);
      notify(key);
    },
    subscribe(key, listener) {
      let keyListeners = listeners.get(key);
      if (!keyListeners) {
        keyListeners = new Set();
        listeners.set(key, keyListeners);
      }
      keyListeners.add(listener);
      return () => {
        keyListeners?.delete(listener);
        if (keyListeners?.size === 0) {
          listeners.delete(key);
        }
      };
    },
  };
}

export function useAudioControlDraftValue(store: AudioControlDraftStore, key: string, fallback: number) {
  return useSyncExternalStore(
    (listener) => store.subscribe(key, listener),
    () => store.get(key) ?? fallback,
    () => fallback
  );
}
