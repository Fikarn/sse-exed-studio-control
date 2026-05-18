import { useSyncExternalStore } from "react";

import type { JsonObject } from "../generated/protocol";

export interface MeterSample {
  l: number;
  r: number;
  peakL: number;
  peakR: number;
  clip: boolean;
  timestampMs: number;
}

export interface MeterStoreState {
  channels: Map<string, MeterSample>;
  mixTargets: Map<string, MeterSample>;
  lastTickMs: number;
}

export interface MeterStore {
  getState(): MeterStoreState;
  subscribe(listener: () => void): () => void;
  applyTick(payload: JsonObject): void;
  reset(): void;
}

function coerceNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function coerceString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readEntries(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  const result: JsonObject[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      result.push(entry as JsonObject);
    }
  }
  return result;
}

export function createMeterStore(): MeterStore {
  const state: MeterStoreState = {
    channels: new Map(),
    mixTargets: new Map(),
    lastTickMs: 0,
  };
  const listeners = new Set<() => void>();

  const applyEntry = (target: Map<string, MeterSample>, entry: JsonObject, timestampMs: number) => {
    const id = coerceString(entry.id);
    if (!id) return;
    const l = coerceNumber(entry.l, 0);
    const r = coerceNumber(entry.r, l);
    target.set(id, {
      l,
      r,
      peakL: coerceNumber(entry.peakL, l),
      peakR: coerceNumber(entry.peakR, r),
      clip: coerceBoolean(entry.clip, false),
      timestampMs,
    });
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyTick: (payload) => {
      const timestampMs = coerceNumber(payload.timestampMs, Date.now());
      for (const entry of readEntries(payload.channels)) {
        applyEntry(state.channels, entry, timestampMs);
      }
      for (const entry of readEntries(payload.mixTargets)) {
        applyEntry(state.mixTargets, entry, timestampMs);
      }
      state.lastTickMs = timestampMs;
      for (const listener of listeners) listener();
    },
    reset: () => {
      state.channels.clear();
      state.mixTargets.clear();
      state.lastTickMs = 0;
      for (const listener of listeners) listener();
    },
  };
}

const EMPTY_SAMPLE: MeterSample = { l: 0, r: 0, peakL: 0, peakR: 0, clip: false, timestampMs: 0 };

export function useChannelMeterSample(store: MeterStore, channelId: string): MeterSample {
  return useSyncExternalStore(store.subscribe, () => store.getState().channels.get(channelId) ?? EMPTY_SAMPLE);
}

export function useMixTargetMeterSample(store: MeterStore, mixTargetId: string): MeterSample {
  return useSyncExternalStore(store.subscribe, () => store.getState().mixTargets.get(mixTargetId) ?? EMPTY_SAMPLE);
}
