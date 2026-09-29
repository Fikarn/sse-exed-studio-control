/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  FRAME_HEADER_LEN,
  FULL_PICTURE,
  SMALL_PICTURE,
  readFrame,
  testCardUyvy,
  uyvyToRgba,
  writeFrame,
} from "./pictureFrame";

// A camera picture's frame as the shell hands it to the page, held to the protocol crate's
// `FrameHeader` (`native/protocol/rust/src/pictures.rs`), and the double's test card to the
// helper's (`native/pictures-link/src/card.rs`): the same numbers, read from the Rust
// source, so a change on one side only fails here.

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../native");
const rust = (path: string) => readFileSync(resolve(NATIVE, path), "utf-8");

describe("a picture's frame", () => {
  it("reads back what the helper writes", () => {
    const pixels = new Uint8Array(544 * 306 * 2).map((_, index) => index % 251);
    const frame = readFrame(writeFrame(2, "uyvy", 544, 306, 77, pixels))!;
    expect(frame).toMatchObject({ camera: 2, format: "uyvy", width: 544, height: 306, sequence: 77 });
    expect(frame.pixels).toEqual(pixels);
    expect(readFrame(new ArrayBuffer(0)), "an empty answer: no new frame").toBeNull();
  });

  it("refuses what is not a frame before it looks at the picture", () => {
    const good = writeFrame(1, "uyvy", 16, 2, 1, new Uint8Array(16 * 2 * 2));
    const changed = (at: number, value: number) => {
      const copy = good.slice(0);
      new DataView(copy).setUint8(at, value);
      return copy;
    };
    expect(() => readFrame(changed(0, 0x58)), "the magic").toThrow("not a frame");
    expect(() => readFrame(changed(4, 2)), "the version").toThrow("version");
    expect(() => readFrame(changed(5, 4)), "camera 4").toThrow("camera 4");
    expect(() => readFrame(changed(6, 9)), "a format").toThrow("format 9");
    expect(() => readFrame(changed(8, 17)), "an odd UYVY width").toThrow();
    expect(() => readFrame(good.slice(0, good.byteLength - 1)), "a picture cut short").toThrow();
    expect(() => readFrame(new ArrayBuffer(10)), "a header cut short").toThrow("too short");
    const huge = writeFrame(1, "rgba8", 1, 1, 1, new Uint8Array(4));
    new DataView(huge).setUint16(8, 1921, true);
    expect(() => readFrame(huge), "wider than the picture").toThrow("1921");
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
  it("is the helper's card: its sizes and its numbers, read from card.rs", () => {
    const card = rust("pictures-link/src/card.rs");
    expect(card).toContain(`pub const FULL: (u16, u16) = (${FULL_PICTURE.width}, ${FULL_PICTURE.height});`);
    expect(card).toContain(`pub const SMALL: (u16, u16) = (${SMALL_PICTURE.width}, ${SMALL_PICTURE.height});`);
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
