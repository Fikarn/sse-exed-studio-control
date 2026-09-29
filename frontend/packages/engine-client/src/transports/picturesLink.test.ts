import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeFrame } from "./pictureFrame";
import { createTauriPicturesLink } from "./picturesLink";

// The Cameras page's link to the shell's pictures: one command, `pictures_next`, whose raw
// answer is a frame or nothing. The shell gives it to the operator's window alone
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
  it("takes a camera's newest frame with pictures_next, and nothing when none came", async () => {
    const link = createTauriPicturesLink();
    answers.push(writeFrame(3, "uyvy", 544, 306, 9, new Uint8Array(544 * 306 * 2)));
    const frame = await link.next(3);
    expect(frame).toMatchObject({ camera: 3, format: "uyvy", width: 544, height: 306, sequence: 9 });
    expect(await link.next(1)).toBeNull();
    expect(invoked).toEqual([
      { command: "pictures_next", args: { camera: 3 } },
      { command: "pictures_next", args: { camera: 1 } },
    ]);
  });

  it("refuses an answer that is not a frame", async () => {
    answers.push(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]).buffer
    );
    await expect(createTauriPicturesLink().next(2)).rejects.toThrow("not a frame");
  });

  it("names no command of the shell's but pictures_next", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "picturesLink.ts"), "utf8");
    const commands = [...source.matchAll(/invoke(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((match) => match[1]);
    expect([...new Set(commands)]).toEqual(["pictures_next"]);
  });
});
