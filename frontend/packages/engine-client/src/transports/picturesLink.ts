import { invoke } from "@tauri-apps/api/core";

import { readFrames, type PictureFrame } from "./pictureFrame";

// How the Cameras page takes the cameras' pictures (the camera pictures, D28, route b).
// The frames come from the pictures helper to the shell, never through the hardware
// link; the shell keeps each camera's newest, and the page takes them with the shell's
// one picture command, `pictures_next`, over the IPC it already has. One take brings the
// three cameras' newest frames, and waits in the shell for the next when none is new, so
// the page asks about once a frame and the pages' requests to the hardware link do not
// wait behind its takes. The page never learns where the frames come from, and holds no
// secret. Only the operator's window may call the command (`shell_commands.rs`): the
// prompter's window never names it.

export type PictureCamera = 1 | 2 | 3;

export interface PicturesLink {
  /**
   * The cameras' newest frames since the last take, each once, in camera order; none when
   * none came while the shell waited. The page chooses neither the cameras nor the wait.
   */
  next(): Promise<PictureFrame[]>;
}

/** The link in the app's window: the shell's `pictures_next`. */
export function createTauriPicturesLink(): PicturesLink {
  return {
    async next() {
      return readFrames(await invoke<ArrayBuffer>("pictures_next"));
    },
  };
}
