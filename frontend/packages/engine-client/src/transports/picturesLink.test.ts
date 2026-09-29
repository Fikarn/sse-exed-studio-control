import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeFrame } from "./pictureFrame";
import { createTauriPicturesLink } from "./picturesLink";

// The Cameras page's link to the shell's pictures: one command, `pictures_next`, whose raw
// answer is the three cameras' newest frames back to back, or nothing. The shell gives it to the operator's window alone
// (`shell_commands.rs`); this file holds the page to that one command.

const { invoked, answers } = vi.hoisted(() => ({
  invoked: [] as Array<{ command: string; args: Record<string, unknown> | undefined }>,
  answers: [] as ArrayBuffer[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    return answers.shift() ?? new ArrayBuffer(0);
  }),
}));

beforeEach(() => {
  invoked.length = 0;
  answers.length = 0;
});

describe("the pictures link", () => {
  it("takes the cameras' newest frames with one pictures_next, and none when none came", async () => {
    const link = createTauriPicturesLink();
    const small = (camera: 1 | 2 | 3, sequence: number) =>
      new Uint8Array(writeFrame(camera, "uyvy", 544, 306, sequence, new Uint8Array(544 * 306 * 2)));
    const three = new Uint8Array(3 * small(1, 1).byteLength);
    [small(1, 4), small(2, 5), small(3, 9)].forEach((frame, index) => three.set(frame, index * frame.byteLength));
    answers.push(three.buffer);
    const frames = await link.next();
    expect(frames.map(({ camera, sequence }) => [camera, sequence])).toEqual([
      [1, 4],
      [2, 5],
      [3, 9],
    ]);
    expect(frames[2]).toMatchObject({ camera: 3, format: "uyvy", width: 544, height: 306, sequence: 9 });
    expect(await link.next()).toEqual([]);
    // The page chooses neither the cameras nor the wait: the take names nothing.
    expect(invoked).toEqual([
      { command: "pictures_next", args: undefined },
      { command: "pictures_next", args: undefined },
    ]);
  });

  it("refuses an answer that is not a frame", async () => {
    answers.push(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]).buffer
    );
    await expect(createTauriPicturesLink().next()).rejects.toThrow("not a frame");
  });

  it("names no command of the shell's but pictures_next", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "picturesLink.ts"), "utf8");
    const commands = [...source.matchAll(/invoke(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((match) => match[1]);
    expect([...new Set(commands)]).toEqual(["pictures_next"]);
  });
});
