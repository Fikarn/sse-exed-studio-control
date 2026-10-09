import { useCallback, useSyncExternalStore } from "react";

import type { CameraNumber, ShellStore } from "@sse/engine-client";

import { NO_AIDS, type PictureAids } from "./CameraPicture";
import { CENTRE, type LoupeZoom, type Point } from "./pictureGeometry";

// How the operator looks at the pictures: the aids, the loupe's zoom and each
// camera's loupe point. The Cameras page and the Overview (D47) show the same
// pictures, so they share it (2026-10-09; until then it was the Cameras
// page's and went with it): a point set on Cameras is the one the Overview's
// loupe shows. It is the screen's alone, never sent to a camera, and off
// again at every start: one memory for each store, as Lighting's Undo keeps
// its steps (`lightingUndoMemory.ts`), and a start makes a new store.

export interface PictureView {
  aids: PictureAids;
  zoom: LoupeZoom;
  /** Each camera keeps its own point. */
  points: Record<CameraNumber, Point>;
}

const AT_START: PictureView = { aids: NO_AIDS, zoom: 2, points: { 1: CENTRE, 2: CENTRE, 3: CENTRE } };

class PictureViewMemory {
  private value = AT_START;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  current = () => this.value;

  update(change: (held: PictureView) => PictureView) {
    this.value = change(this.value);
    for (const listener of this.listeners) listener();
  }
}

const memories = new WeakMap<ShellStore, PictureViewMemory>();

function memoryOf(store: ShellStore): PictureViewMemory {
  const known = memories.get(store);
  if (known) return known;
  const memory = new PictureViewMemory();
  memories.set(store, memory);
  return memory;
}

export interface PictureViewControls {
  view: PictureView;
  toggleAid: (aid: keyof PictureAids) => void;
  setZoom: (zoom: LoupeZoom) => void;
  setPoint: (camera: CameraNumber, point: Point) => void;
}

/** The operator's way of looking at the pictures, shared by the pages that show them. */
export function usePictureView(store: ShellStore): PictureViewControls {
  const memory = memoryOf(store);
  const view = useSyncExternalStore(memory.subscribe, memory.current);
  const toggleAid = useCallback(
    (aid: keyof PictureAids) => memory.update((held) => ({ ...held, aids: { ...held.aids, [aid]: !held.aids[aid] } })),
    [memory]
  );
  const setZoom = useCallback((zoom: LoupeZoom) => memory.update((held) => ({ ...held, zoom })), [memory]);
  const setPoint = useCallback(
    (camera: CameraNumber, point: Point) =>
      memory.update((held) => ({ ...held, points: { ...held.points, [camera]: point } })),
    [memory]
  );
  return { view, toggleAid, setZoom, setPoint };
}
