import { useEffect, useMemo } from "react";

import type { PictureCamera, PictureFrame, PictureTakes } from "@sse/engine-client";

// The cameras' newest frames while the Cameras page is open in a browser, where the page
// draws the pictures itself (the double's test cards; in the app's window the pictures
// helper draws them and the page takes no frame, D30). The page takes the three cameras'
// newest, one take at a time, so a slow page skips frames and never queues them. A view
// that shows a camera hears of each new frame and draws it at once; nothing is drawn on
// a timer. The page never concludes from frames that a picture is missing (the hardware
// link says that, `picture`).

/** The rest after a take that brought nothing new: a link that answers at once (the double) would spin without it. */
const PULL_REST_MS = 8;
/** After a take that failed (an answer that is not frames, or the call refused), a longer rest. */
const PULL_FAILED_REST_MS = 500;

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
 * Takes the three cameras' frames through `link` into `frames`, one take at a time, until
 * the function it returns is called; a take that answers after that is not kept.
 */
export function takePictures(link: PictureTakes, frames: PictureFrames): () => void {
  let running = true;
  void (async () => {
    while (running) {
      let taken: PictureFrame[];
      try {
        taken = await link.next();
      } catch {
        await rest(PULL_FAILED_REST_MS);
        continue;
      }
      if (!running) return;
      // A new frame: ask again at once. Otherwise rest.
      // A view that throws while it draws costs its own frame, never the other cameras'
      // pictures: the one loop carries on.
      let anyNew = false;
      for (const frame of taken) {
        try {
          anyNew = frames.put(frame) || anyNew;
        } catch (error) {
          // The frame was kept before its view threw; the console still says why.
          console.error(`CAM ${frame.camera}'s picture could not be drawn:`, error);
          anyNew = true;
        }
      }
      if (!anyNew) await rest(PULL_REST_MS);
    }
  })();
  return () => {
    running = false;
  };
}

/**
 * The frames of the three cameras, taken through `link` for as long as the calling page
 * is mounted; nothing is taken without a link (a window that draws no picture itself).
 */
export function usePictureFrames(link: PictureTakes | null): PictureFrames {
  const frames = useMemo(() => new PictureFrames(), []);
  useEffect(() => (link ? takePictures(link, frames) : undefined), [link, frames]);
  return frames;
}
