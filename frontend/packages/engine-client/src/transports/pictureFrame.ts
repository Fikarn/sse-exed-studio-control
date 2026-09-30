// A camera picture's frame as a page that draws the pictures itself takes it (a browser,
// on the double's test cards; in the app's window the pictures helper draws them, D30):
// a 24-byte header and the picture, the layout of the protocol crate's `FrameHeader`
// (`native/protocol/rust/src/pictures.rs`), little-endian:
//
//   0  "SCPF"     4  version (1)   5  camera (1–3)   6  format   7  (spare)
//   8  width u16  10 height u16    12 sequence u64   20 length u32
//
// The format is UYVY (two pixels in four bytes, U Y0 V Y1, BT.709 video range: NDI's
// own), RGBA8, or JPEG (reserved: no encoder yet). A header is held to what a frame may
// be before its picture is looked at.

export type FrameFormat = "uyvy" | "rgba8" | "jpeg";

export interface PictureFrame {
  camera: 1 | 2 | 3;
  format: FrameFormat;
  width: number;
  height: number;
  /** Counts this camera's frames from 1: a gap is a frame skipped. */
  sequence: number;
  /** The picture's bytes, a view into the frame. */
  pixels: Uint8Array;
}

export const FRAME_HEADER_LEN = 24;
export const FRAME_MAX_WIDTH = 1920;
export const FRAME_MAX_HEIGHT = 1080;
const FRAME_MAX_JPEG_BYTES = 8 * 1024 * 1024;
const MAGIC = [0x53, 0x43, 0x50, 0x46] as const; // "SCPF"
const VERSION = 1;
const FORMAT_CODES: Record<FrameFormat, number> = { uyvy: 1, rgba8: 2, jpeg: 3 };

function formatOf(code: number): FrameFormat | null {
  return (Object.keys(FORMAT_CODES) as FrameFormat[]).find((format) => FORMAT_CODES[format] === code) ?? null;
}

function rawLength(format: FrameFormat, width: number, height: number): number {
  return width * height * (format === "uyvy" ? 2 : 4);
}

/**
 * The frames of the shell's answer, back to back (one take brings the three cameras'
 * newest); none for an empty answer. Throws when any part of it is not a frame, or a
 * camera comes twice: the whole answer is refused.
 */
export function readFrames(buffer: ArrayBuffer): PictureFrame[] {
  const frames: PictureFrame[] = [];
  let at = 0;
  while (at < buffer.byteLength) {
    const frame = readFrameAt(buffer, at);
    if (frames.some((kept) => kept.camera === frame.camera)) {
      throw new Error(`not an answer: camera ${frame.camera} twice`);
    }
    frames.push(frame);
    at += FRAME_HEADER_LEN + frame.pixels.byteLength;
  }
  return frames;
}

/** The frame that begins `at` bytes into the answer. Throws on a frame that is not one. */
function readFrameAt(buffer: ArrayBuffer, at: number): PictureFrame {
  if (buffer.byteLength - at < FRAME_HEADER_LEN) throw new Error("not a frame: too short");
  const view = new DataView(buffer, at);
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (view.getUint8(index) !== MAGIC[index]) throw new Error("not a frame");
  }
  if (view.getUint8(4) !== VERSION) throw new Error("not a frame of this version");
  const camera = view.getUint8(5);
  if (camera !== 1 && camera !== 2 && camera !== 3) throw new Error(`not a frame: camera ${camera}`);
  const format = formatOf(view.getUint8(6));
  if (!format) throw new Error(`not a frame: format ${view.getUint8(6)}`);
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  if (width === 0 || height === 0 || width > FRAME_MAX_WIDTH || height > FRAME_MAX_HEIGHT) {
    throw new Error(`not a frame: a picture of ${width} × ${height}`);
  }
  const sequence = Number(view.getBigUint64(12, true));
  const length = view.getUint32(20, true);
  const fits =
    format === "jpeg"
      ? length > 0 && length <= FRAME_MAX_JPEG_BYTES
      : length === rawLength(format, width, height) && (format !== "uyvy" || width % 2 === 0);
  if (!fits || buffer.byteLength - at < FRAME_HEADER_LEN + length) {
    throw new Error(`not a frame: ${length} bytes for a ${format} picture of ${width} × ${height}`);
  }
  return { camera, format, width, height, sequence, pixels: new Uint8Array(buffer, at + FRAME_HEADER_LEN, length) };
}

/** A frame as the helper writes it: the fixture double's pictures, and the tests'. */
export function writeFrame(
  camera: 1 | 2 | 3,
  format: FrameFormat,
  width: number,
  height: number,
  sequence: number,
  pixels: Uint8Array
): ArrayBuffer {
  const buffer = new ArrayBuffer(FRAME_HEADER_LEN + pixels.length);
  const view = new DataView(buffer);
  MAGIC.forEach((byte, index) => view.setUint8(index, byte));
  view.setUint8(4, VERSION);
  view.setUint8(5, camera);
  view.setUint8(6, FORMAT_CODES[format]);
  view.setUint16(8, width, true);
  view.setUint16(10, height, true);
  view.setBigUint64(12, BigInt(sequence), true);
  view.setUint32(20, pixels.length, true);
  new Uint8Array(buffer, FRAME_HEADER_LEN).set(pixels);
  return buffer;
}

// ---------------------------------------------------------------------------
// The test card, as the pictures helper draws it (`native/pictures-link/src/card.rs`)
// ---------------------------------------------------------------------------

/** The picture's size, and the small pictures'. */
export const FULL_PICTURE = { width: 1920, height: 1080 } as const;
export const SMALL_PICTURE = { width: 544, height: 306 } as const;

const BARS = [0xbfbfbf, 0xbfbf00, 0x00bfbf, 0x00bf00, 0xbf00bf, 0xbf0000, 0x0000bf] as const;
const FIELD_LEFT = 120;
const FIELD_RIGHT = 1800;
const LINE_WIDTHS = [8, 4, 2, 1] as const;

type Rgb = readonly [number, number, number];

const hex = (value: number): Rgb => [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const grey = (share: number): Rgb => {
  const level = Math.round(Math.max(0, Math.min(1, share)) * 255);
  return [level, level, level];
};

/** A picture in full-range RGB, three bytes a pixel, row by row. */
interface Canvas {
  width: number;
  height: number;
  rgb: Uint8Array;
}

function rect(canvas: Canvas, left: number, top: number, width: number, height: number, colour: Rgb) {
  for (let y = top; y < Math.min(top + height, canvas.height); y += 1) {
    for (let x = left; x < Math.min(left + width, canvas.width); x += 1) {
      const at = (y * canvas.width + x) * 3;
      canvas.rgb[at] = colour[0];
      canvas.rgb[at + 1] = colour[1];
      canvas.rgb[at + 2] = colour[2];
    }
  }
}

/** Camera `camera`'s card, pixel for pixel the helper's. */
export function testCardRgb(camera: 1 | 2 | 3): Canvas {
  const { width, height } = FULL_PICTURE;
  const canvas: Canvas = { width, height, rgb: new Uint8Array(width * height * 3) };
  rect(canvas, 0, 0, width, height, hex(0x1c1c1f));
  const fieldWidth = FIELD_RIGHT - FIELD_LEFT;
  for (let index = 0; index < camera; index += 1) rect(canvas, FIELD_LEFT + index * 64, 40, 48, 48, hex(0xbfbfbf));
  const bar = fieldWidth / BARS.length;
  BARS.forEach((colour, index) => {
    const left = Math.round(FIELD_LEFT + index * bar);
    const right = Math.round(FIELD_LEFT + (index + 1) * bar);
    rect(canvas, left, 120, right - left, 440, hex(colour));
  });
  for (let x = FIELD_LEFT; x < FIELD_RIGHT; x += 1) {
    rect(canvas, x, 600, 1, 120, grey((x - FIELD_LEFT) / (fieldWidth - 1)));
  }
  const step = fieldWidth / 11;
  for (let index = 0; index <= 10; index += 1) {
    rect(canvas, Math.round(FIELD_LEFT + index * step), 740, Math.ceil(step), 80, grey(index / 10));
  }
  rect(canvas, FIELD_LEFT, 860, 800, 140, hex(0x000000));
  LINE_WIDTHS.forEach((lineWidth, block) => {
    const left = FIELD_LEFT + block * 200 + 12;
    for (let x = 0; x + lineWidth <= 176; x += lineWidth * 2)
      rect(canvas, left + x, 872, lineWidth, 116, hex(0xffffff));
  });
  [hex(0xffffff), grey(0.18), hex(0xc08b6d), hex(0x000000)].forEach((colour, index) => {
    rect(canvas, 1000 + index * 200, 860, 184, 140, colour);
  });
  for (let y = 150; y < 530; y += 1) {
    for (let x = 770; x < 1150; x += 1) {
      const distance = Math.hypot(x + 0.5 - 960, y + 0.5 - 340);
      if (Math.abs(distance - 180) <= 2) rect(canvas, x, y, 1, 1, hex(0xbfbfbf));
    }
  }
  for (const [left, top, w, h] of [
    [0, 0, width, 4],
    [0, height - 4, width, 4],
    [0, 0, 4, height],
    [width - 4, 0, 4, height],
  ] as const) {
    rect(canvas, left, top, w, h, hex(0xbfbfbf));
  }
  return canvas;
}

/** The card at the small pictures' size: each small pixel the average of those it covers. */
function shrink(canvas: Canvas, width: number, height: number): Canvas {
  const small: Canvas = { width, height, rgb: new Uint8Array(width * height * 3) };
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor((y * canvas.height) / height);
    const bottom = Math.max(Math.floor(((y + 1) * canvas.height) / height), top + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor((x * canvas.width) / width);
      const right = Math.max(Math.floor(((x + 1) * canvas.width) / width), left + 1);
      const sum = [0, 0, 0];
      for (let sy = top; sy < bottom; sy += 1) {
        for (let sx = left; sx < right; sx += 1) {
          const at = (sy * canvas.width + sx) * 3;
          sum[0] += canvas.rgb[at]!;
          sum[1] += canvas.rgb[at + 1]!;
          sum[2] += canvas.rgb[at + 2]!;
        }
      }
      const count = (bottom - top) * (right - left);
      const at = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        small.rgb[at + channel] = Math.floor((sum[channel]! + Math.floor(count / 2)) / count);
      }
    }
  }
  return small;
}

/** Full-range RGB to BT.709 video-range Y, Cb and Cr, as NDI's UYVY holds them. */
function ycbcr(red: number, green: number, blue: number): [number, number, number] {
  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [16 + 219 * y, 128 + 224 * ((b - y) / 1.8556), 128 + 224 * ((r - y) / 1.5748)];
}

const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function uyvy(canvas: Canvas): Uint8Array {
  const out = new Uint8Array(canvas.width * canvas.height * 2);
  for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += 2) {
    const a = pixel * 3;
    const [y0, cb0, cr0] = ycbcr(canvas.rgb[a]!, canvas.rgb[a + 1]!, canvas.rgb[a + 2]!);
    const [y1, cb1, cr1] = ycbcr(canvas.rgb[a + 3]!, canvas.rgb[a + 4]!, canvas.rgb[a + 5]!);
    const at = pixel * 2;
    out[at] = byte((cb0 + cb1) / 2);
    out[at + 1] = byte(y0);
    out[at + 2] = byte((cr0 + cr1) / 2);
    out[at + 3] = byte(y1);
  }
  return out;
}

const cards = new Map<string, Uint8Array>();

/** Camera `camera`'s card as UYVY, big or small, made once. */
export function testCardUyvy(camera: 1 | 2 | 3, big: boolean): Uint8Array {
  const key = `${camera}:${big ? "full" : "small"}`;
  let kept = cards.get(key);
  if (!kept) {
    const full = testCardRgb(camera);
    kept = uyvy(big ? full : shrink(full, SMALL_PICTURE.width, SMALL_PICTURE.height));
    cards.set(key, kept);
  }
  return kept;
}

/**
 * A UYVY picture as 8-bit RGBA, BT.709 video range to full range: what the page's shader
 * does, for the tests to hold it to (`pictureAids.ts` takes RGBA).
 */
export function uyvyToRgba(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const pair = (pixel >> 1) * 4;
    const cb = (pixels[pair]! - 128) / 224;
    const cr = (pixels[pair + 2]! - 128) / 224;
    const y = ((pixel % 2 === 0 ? pixels[pair + 1]! : pixels[pair + 3]!) - 16) / 219;
    const at = pixel * 4;
    out[at] = Math.round(Math.max(0, Math.min(1, y + 1.5748 * cr)) * 255);
    out[at + 1] = Math.round(Math.max(0, Math.min(1, y - 0.1873 * cb - 0.4681 * cr)) * 255);
    out[at + 2] = Math.round(Math.max(0, Math.min(1, y + 1.8556 * cb)) * 255);
    out[at + 3] = 255;
  }
  return out;
}
