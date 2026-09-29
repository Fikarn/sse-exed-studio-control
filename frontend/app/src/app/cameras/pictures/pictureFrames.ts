import { useEffect, useMemo } from "react";

import type { PictureCamera, PictureFrame, PicturesLink } from "@sse/engine-client";

// The cameras' newest frames while the Cameras page is open (the camera pictures, D28):
// the page takes each camera's newest from the shell, one take a camera at a time, so a
// slow page skips frames and never queues them. A view that shows a camera hears of each
// new frame and draws it at once; nothing is drawn on a timer. What arrives is the
// shell's to say: the page never concludes from frames that a picture is missing (the
// hardware link says that, `picture`).

/** How long a take waits before it asks again when no new frame came: a frame at 29.97 a second comes every 33 ms. */
const PULL_REST_MS = 8;
/** After a take that failed (the hardware link starting again), a longer rest. */
const PULL_FAILED_REST_MS = 500;

const CAMERAS: readonly PictureCamera[] = [1, 2, 3];

export class PictureFrames {
  private readonly newest = new Map<PictureCamera, PictureFrame>();
  private readonly listeners = new Map<PictureCamera, Set<() => void>>();

  /** Camera `camera`'s newest frame; `null` before the first. */
  latest(camera: PictureCamera): PictureFrame | null {
    return this.newest.get(camera) ?? null;
  }

  /** Keeps a frame and tells the views of its camera; says whether it was new. */
  put(frame: PictureFrame): boolean {
    const last = this.newest.get(frame.camera);
    if (last && last.sequence === frame.sequence && last.width === frame.width) return false;
    this.newest.set(frame.camera, frame);
    for (const listener of this.listeners.get(frame.camera) ?? []) listener();
    return true;
  }

  /** Hears of each new frame of `camera`; returns what stops it. */
  subscribe(camera: PictureCamera, listener: () => void): () => void {
    const listeners = this.listeners.get(camera) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(camera, listeners);
    return () => listeners.delete(listener);
  }
}

const rest = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * The frames of the three cameras, taken through `link` for as long as the calling page
 * is mounted; nothing is taken without a link (a window that has none).
 */
export function usePictureFrames(link: PicturesLink | null): PictureFrames {
  const frames = useMemo(() => new PictureFrames(), []);
  useEffect(() => {
    if (!link) return undefined;
    let running = true;
    for (const camera of CAMERAS) {
      void (async () => {
        while (running) {
          let frame: PictureFrame | null;
          try {
            frame = await link.next(camera);
          } catch {
            await rest(PULL_FAILED_REST_MS);
            continue;
          }
          if (!running) return;
          // A new frame: ask again at once, for the next may be there. Otherwise rest.
          if (!frame || !frames.put(frame)) await rest(PULL_REST_MS);
        }
      })();
    }
    return () => {
      running = false;
    };
  }, [link, frames]);
  return frames;
}
