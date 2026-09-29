import type { PictureFrame, PicturesLink } from "@sse/engine-client";
import { describe, expect, it } from "vitest";

import { PictureFrames, takePictures } from "./pictureFrames";

// The Cameras page's one loop of takes (2026-09-29): one take for the three cameras at a
// time, the next asked at once after a new frame (the shell's take waits for the next),
// and nothing taken or kept once the page is gone.

function frame(camera: 1 | 2 | 3, sequence: number): PictureFrame {
  return { camera, format: "uyvy", width: 2, height: 1, sequence, pixels: new Uint8Array(4) };
}

/** Lets the loop run what it can before the test goes on. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A link whose takes wait until the test answers them. */
function heldLink() {
  const waiting: Array<(frames: PictureFrame[]) => void> = [];
  let asked = 0;
  let inFlight = 0;
  let most = 0;
  const link: PicturesLink = {
    next: () => {
      asked += 1;
      inFlight += 1;
      most = Math.max(most, inFlight);
      return new Promise((resolve) =>
        waiting.push((frames) => {
          inFlight -= 1;
          resolve(frames);
        })
      );
    },
  };
  return {
    link,
    async answer(frames: PictureFrame[]) {
      const take = waiting.shift();
      expect(take, "a take is waiting").toBeDefined();
      take!(frames);
      await settle();
    },
    asked: () => asked,
    most: () => most,
    waiting: () => waiting.length,
  };
}

describe("the page's takes", () => {
  it("takes one answer at a time, and asks again at once after a new frame", async () => {
    const held = heldLink();
    const frames = new PictureFrames();
    const drawn: number[] = [];
    frames.subscribe(1, () => drawn.push(frames.latest(1)!.sequence));
    const stop = takePictures(held.link, frames);
    await settle();
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      expect(held.waiting(), `before answer ${sequence}`).toBe(1);
      await held.answer([frame(1, sequence), frame(2, sequence)]);
    }
    expect(drawn, "each new frame reached its view").toEqual([1, 2, 3, 4, 5]);
    expect(frames.latest(2)?.sequence).toBe(5);
    expect(held.asked(), "five answers, and the sixth take asked").toBe(6);
    expect(held.most(), "never two takes at once").toBe(1);
    stop();
  });

  it("goes on when a view throws as it draws, and the other cameras still get their frames", async () => {
    const held = heldLink();
    const frames = new PictureFrames();
    frames.subscribe(1, () => {
      throw new Error("this view could not draw");
    });
    const stop = takePictures(held.link, frames);
    await settle();
    await held.answer([frame(1, 1), frame(2, 1)]);
    expect(frames.latest(2)?.sequence, "CAM 2's frame was kept").toBe(1);
    expect(held.asked(), "the loop asked again").toBe(2);
    stop();
  });

  it("stops: no take after it, and a take that answers late is not kept", async () => {
    const held = heldLink();
    const frames = new PictureFrames();
    const stop = takePictures(held.link, frames);
    await settle();
    expect(held.asked()).toBe(1);
    stop();
    await held.answer([frame(3, 1)]);
    await settle();
    expect(frames.latest(3), "the late answer is dropped").toBeNull();
    expect(held.asked(), "no take after the stop").toBe(1);
  });
});
