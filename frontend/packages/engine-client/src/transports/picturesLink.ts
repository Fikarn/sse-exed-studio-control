import { invoke } from "@tauri-apps/api/core";

import { readFrame, type PictureFrame } from "./pictureFrame";

// How the Cameras page takes the cameras' pictures (the camera pictures, D28, route b).
// The frames come from the pictures helper to the shell, never through the hardware
// link; the shell keeps each camera's newest, and the page takes it with the shell's one
// picture command, `pictures_next`, over the IPC it already has. The page never learns
// where the frames come from, and holds no secret. Only the operator's window may call
// the command (`shell_commands.rs`): the prompter's window never names it.

export type PictureCamera = 1 | 2 | 3;

export interface PicturesLink {
  /**
   * Camera `camera`'s newest frame since the last take; `null` when none came. The
   * shell hands a frame once: the next take has the next.
   */
  next(camera: PictureCamera): Promise<PictureFrame | null>;
}

/** The link in the app's window: the shell's `pictures_next`. */
export function createTauriPicturesLink(): PicturesLink {
  return {
    async next(camera) {
      return readFrame(await invoke<ArrayBuffer>("pictures_next", { camera }));
    },
  };
}
