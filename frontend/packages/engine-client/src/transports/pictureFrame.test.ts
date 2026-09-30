/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  FRAME_HEADER_LEN,
  FULL_PICTURE,
  SMALL_PICTURE,
  readFrames,
  testCardUyvy,
  uyvyToRgba,
  writeFrame,
} from "./pictureFrame";

// A camera picture's frame as the shell hands it to the page, held to the protocol crate's
// `FrameHeader` (`native/protocol/rust/src/pictures.rs`), and the double's test card to the
// helper's (`native/pictures-link/src/card.rs`): the same numbers, read from the Rust
// source, so a change on one side only fails here.

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../native");
/** Frames back to back, as one take of the shell's answers them. */
const concat = (frames: ArrayBuffer[]): ArrayBuffer => {
  const answer = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
  let at = 0;
  for (const frame of frames) {
    answer.set(new Uint8Array(frame), at);
    at += frame.byteLength;
  }
  return answer.buffer;
};
const rust = (path: string) => readFileSync(resolve(NATIVE, path), "utf-8");

describe("a picture's frame", () => {
  it("reads back what the helper writes", () => {
    const pixels = new Uint8Array(544 * 306 * 2).map((_, index) => index % 251);
    const frames = readFrames(writeFrame(2, "uyvy", 544, 306, 77, pixels));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ camera: 2, format: "uyvy", width: 544, height: 306, sequence: 77 });
    expect(frames[0]!.pixels).toEqual(pixels);
    expect(readFrames(new ArrayBuffer(0)), "an empty answer: no new frame").toEqual([]);
  });

  // 2026-09-29: one take brings the three cameras' newest frames, back to back.
  it("reads the frames of one answer back to back, each picture where it lies", () => {
    const small = (seed: number) => new Uint8Array(544 * 306 * 2).map((_, index) => (index + seed) % 251);
    const big = new Uint8Array(1920 * 1080 * 2).map((_, index) => index % 241);
    const answer = concat([
      writeFrame(1, "uyvy", 1920, 1080, 5, big),
      writeFrame(2, "uyvy", 544, 306, 6, small(2)),
      writeFrame(3, "uyvy", 544, 306, 7, small(3)),
    ]);
    const frames = readFrames(answer);
    expect(frames.map(({ camera, width, sequence }) => [camera, width, sequence])).toEqual([
      [1, 1920, 5],
      [2, 544, 6],
      [3, 544, 7],
    ]);
    // Compared as buffers: toEqual walks 4 MB byte by byte, past the test's time.
    const same = (view: Uint8Array, expected: Uint8Array) =>
      Buffer.from(view.buffer, view.byteOffset, view.byteLength).equals(Buffer.from(expected));
    expect(same(frames[0]!.pixels, big), "CAM 1's picture").toBe(true);
    expect(same(frames[1]!.pixels, small(2)), "CAM 2's picture").toBe(true);
    expect(same(frames[2]!.pixels, small(3)), "CAM 3's picture").toBe(true);
    // Views into the one answer: nothing copied.
    for (const frame of frames) expect(frame.pixels.buffer).toBe(answer);
  });

  it("refuses what is not a frame before it looks at the picture", () => {
    const good = writeFrame(1, "uyvy", 16, 2, 1, new Uint8Array(16 * 2 * 2));
    const changed = (at: number, value: number) => {
      const copy = good.slice(0);
      new DataView(copy).setUint8(at, value);
      return copy;
    };
    // Each refusal, alone and as the second frame of an answer: the whole answer is refused.
    const second = writeFrame(2, "uyvy", 16, 2, 1, new Uint8Array(16 * 2 * 2));
    const refused = (why: string, bad: ArrayBuffer, message?: string) => {
      expect(() => readFrames(bad), why).toThrow(message);
      expect(() => readFrames(concat([second, bad])), `${why}, second`).toThrow(message);
    };
    refused("the magic", changed(0, 0x58), "not a frame");
    refused("the version", changed(4, 2), "version");
    refused("camera 4", changed(5, 4), "camera 4");
    refused("a format", changed(6, 9), "format 9");
    // An odd width with the length that fits it: only UYVY's pairs of pixels refuse it.
    const odd = (format: "uyvy" | "rgba8", size: number) =>
      writeFrame(1, format, 17, 2, 1, new Uint8Array(17 * 2 * size));
    refused("an odd UYVY width", odd("uyvy", 2), "17 × 2");
    expect(readFrames(odd("rgba8", 4)), "an odd RGBA width").toHaveLength(1);
    refused("a picture cut short", good.slice(0, good.byteLength - 1));
    refused("a header cut short", new ArrayBuffer(10), "too short");
    const huge = writeFrame(1, "rgba8", 1, 1, 1, new Uint8Array(4));
    new DataView(huge).setUint16(8, 1921, true);
    refused("wider than the picture", huge, "1921");
    // An answer holds each camera once.
    expect(() => readFrames(concat([good, good])), "a camera twice").toThrow("camera 1 twice");
  });

  it("has the protocol crate's header, word for word", () => {
    const source = rust("protocol/rust/src/pictures.rs");
    expect(source).toContain(`pub const FRAME_HEADER_LEN: usize = ${FRAME_HEADER_LEN};`);
    expect(source).toContain('pub const FRAME_MAGIC: [u8; 4] = *b"SCPF";');
    expect(source).toContain("pub const FRAME_VERSION: u8 = 1;");
    expect(source).toContain(`pub const FRAME_MAX_WIDTH: u16 = ${FULL_PICTURE.width};`);
    expect(source).toContain(`pub const FRAME_MAX_HEIGHT: u16 = ${FULL_PICTURE.height};`);
    for (const [format, code] of [
      ["Uyvy", 1],
      ["Rgba8", 2],
      ["Jpeg", 3],
    ] as const) {
      expect(source).toContain(`Self::${format} => ${code},`);
    }
    // The fields' places, as `encode` writes them.
    for (const place of [
      "bytes[4] = FRAME_VERSION;",
      "bytes[5] = self.camera;",
      "bytes[6] = self.format.code();",
      "bytes[8..10].copy_from_slice(&self.width.to_le_bytes());",
      "bytes[10..12].copy_from_slice(&self.height.to_le_bytes());",
      "bytes[12..20].copy_from_slice(&self.sequence.to_le_bytes());",
      "bytes[20..24].copy_from_slice(&self.length.to_le_bytes());",
    ]) {
      expect(source).toContain(place);
    }
  });
});

describe("the double's test card", () => {
  it("is the helper's card: its size and its numbers, read from card.rs", () => {
    const card = rust("pictures-link/src/card.rs");
    expect(card).toContain(`pub const FULL: (u16, u16) = (${FULL_PICTURE.width}, ${FULL_PICTURE.height});`);
    expect(card.replace(/\s+/g, " ")).toContain(
      "const BARS: [u32; 7] = [ 0xbfbfbf, 0xbfbf00, 0x00bfbf, 0x00bf00, 0xbf00bf, 0xbf0000, 0x0000bf, ];"
    );
    expect(card).toContain("const FIELD_LEFT: usize = 120;");
    expect(card).toContain("const FIELD_RIGHT: usize = 1800;");
    expect(card).toContain("const LINE_WIDTHS: [usize; 4] = [8, 4, 2, 1];");
  });

  it("holds the bars, the steps and the white patch, through UYVY and back", () => {
    const { width, height } = FULL_PICTURE;
    const rgba = uyvyToRgba(testCardUyvy(1, true), width, height);
    const at = (x: number, y: number) => Array.from(rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
    for (const channel of at(200, 300)) expect(Math.abs(channel - 191)).toBeLessThanOrEqual(1);
    expect(at(1700, 780), "the last step").toEqual([255, 255, 255]);
    expect(at(1050, 900), "the white patch").toEqual([255, 255, 255]);
    // 18 % grey, 46, comes back a level up from video range's rounding.
    for (const channel of at(1250, 900)) expect(Math.abs(channel - 46)).toBeLessThanOrEqual(1);
    const small = testCardUyvy(3, false);
    expect(small.length).toBe(SMALL_PICTURE.width * SMALL_PICTURE.height * 2);
    expect(testCardUyvy(3, false), "made once").toBe(small);
  });
});
