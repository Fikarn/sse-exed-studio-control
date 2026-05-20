import { useSyncExternalStore } from "react";

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
      listener();
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
    clearLater(key, delayMs = 250) {
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
