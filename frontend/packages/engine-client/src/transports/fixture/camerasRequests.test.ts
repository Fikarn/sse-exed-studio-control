/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonObject, RequestMethod } from "../../generated/protocol";
import { DIAL_BANKS, DIAL_BANK_SETS } from "./camerasModel";
import { CAMERAS_RECENT_LIMIT } from "./camerasState";
import { ALL_SET_UP, CAM2_ADDRESS, openCamerasDouble } from "./camerasTestSupport";

// The fixture double's `cameras.*` requests (new pages program, Slice 8), held to what the
// hardware link answers (`native/rust-engine/src/cameras/commands.rs`; `v1.md`'s
// "Cameras"): each request's answer and its `cameras.changed`, every refusal's code and
// sentence in the hardware link's order of checks, a refused request that changes, raises
// and sends nothing, D12's rule that only a press sends anything to a camera, and the
// Recent actions rows.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const NOT_CONFIRMED = { code: "CAMERA_CHANGE_NOT_CONFIRMED", sentence: "This change needs a second press to confirm." };

/** A double with all three cameras held, its opening events seen. */
function held() {
  const double = openCamerasDouble(ALL_SET_UP);
  double.events.length = 0;
  return double;
}

describe("the fixture double's cameras: one press (set, step, auto)", () => {
  it("sets a value from the camera's options, answers what it then reports, and records no row", async () => {
    const { call, seen, camera, cameras, rows } = held();
    const before = (await rows()).length;
    expect(await call("cameras.set", { camera: 1, setting: "iso", value: "800" })).toEqual({
      camera: 1,
      setting: "iso",
      value: "800",
    });
    expect(seen()).toEqual([["cameras.changed", "setting", 1]]);
    expect((await camera(1)).values.iso.value).toBe("800");
    expect(await call("cameras.set", { camera: 1, setting: "whiteBalance", value: 4350 })).toMatchObject({
      value: 4350,
    });
    expect(await call("cameras.set", { camera: 1, setting: "tint", value: -50 })).toMatchObject({ value: -50 });
    expect(await call("cameras.set", { camera: 2, setting: "shutter", value: "1/100" })).toMatchObject({
      camera: 2,
      value: "1/100",
    });
    expect(cameras.sent(1)).toBe(3);
    expect(cameras.sent(2)).toBe(1);
    expect((await rows()).length, "a press on a setting is not a Recent action").toBe(before);
  });

  it("refuses a setting the camera does not report and a value it does not allow, changing and sending nothing", async () => {
    const { refused, seen, camera, cameras } = held();
    const cases: Array<[number, string, string | number, string, string]> = [
      [2, "nd", "Clear", "CAMERA_SETTING_UNSUPPORTED", "The BGH1 has no ND filter."],
      [2, "tint", 0, "CAMERA_SETTING_UNSUPPORTED", "CAM 2 does not report tint."],
      [3, "focus", 0.5, "CAMERA_SETTING_UNSUPPORTED", "CAM 3 does not report a focus position."],
      [1, "iso", "450", "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow ISO 450."],
      [1, "shutter", "1/50", "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow shutter 1/50."],
      [2, "iris", "f/2.8", "CAMERA_VALUE_NOT_ALLOWED", "CAM 2 does not allow iris f/2.8."],
      [1, "nd", "8 stops", "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow ND 8 stops."],
      [1, "whiteBalance", 5625, "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow white balance 5625."],
      [2, "whiteBalance", 5650, "CAMERA_VALUE_NOT_ALLOWED", "CAM 2 does not allow white balance 5650."],
      [1, "whiteBalance", 12000, "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow white balance 12000."],
      [1, "tint", -51, "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow tint -51."],
      [
        1,
        "focus",
        0.5,
        "CAMERA_SETTING_UNSUPPORTED",
        "CAM 1's EF lens reports no focus position and takes none: it moves focus by offsets. Autofocus once works.",
      ],
    ];
    for (const [number, setting, value, code, sentence] of cases) {
      expect(await refused("cameras.set", { camera: number, setting, value }), `${setting} ${value}`).toEqual({
        code,
        sentence,
      });
    }
    expect(seen(), "a refused request raises nothing").toEqual([]);
    expect([cameras.sent(1), cameras.sent(2), cameras.sent(3)]).toEqual([0, 0, 0]);
    expect((await camera(1)).values.iso.value).toBe("400");
  });

  it("refuses a request of the wrong shape as INVALID_PARAMS, before it looks at the camera", async () => {
    const { refused } = openCamerasDouble();
    const invalid = (sentence: string) => ({ code: "INVALID_PARAMS", sentence });
    expect(await refused("cameras.set", { camera: 4, setting: "iso", value: "400" })).toEqual(
      invalid("camera must be 1, 2 or 3.")
    );
    expect(await refused("cameras.set", { camera: "1", setting: "iso", value: "400" })).toEqual(
      invalid("camera must be 1, 2 or 3.")
    );
    expect(await refused("cameras.set", { camera: 1, setting: "resolution", value: "HD" })).toEqual(
      invalid("setting must be iso, shutter, iris, nd, whiteBalance, tint or focus.")
    );
    expect(await refused("cameras.set", { camera: 1, setting: "iso", value: 400 })).toEqual(
      invalid("value must be one of the camera's values, as text, for iso.")
    );
    expect(await refused("cameras.set", { camera: 1, setting: "whiteBalance", value: "5600" })).toEqual(
      invalid("value must be a number for whiteBalance.")
    );
    for (const step of [0, 1.5, 1001, "1"]) {
      expect(await refused("cameras.step", { camera: 1, setting: "iso", step }), String(step)).toEqual(
        invalid("step must be a whole number of steps, not 0.")
      );
    }
    expect(await refused("cameras.auto", { camera: 1, what: "zoom" })).toEqual(
      invalid("what must be focus, whiteBalance or iris.")
    );
    // The shape first: CAM 1 is not set up, and that is not what this refusal says.
    expect((await refused("cameras.set", { camera: 1, setting: "iso", value: 1 })).code).toBe("INVALID_PARAMS");
  });

  it("steps in the camera's own steps, stopping at the ends; a BGH1's focus moves without a position", async () => {
    const { call, refused, cameras } = held();
    const step = (camera: number, setting: string, steps: number) =>
      call("cameras.step", { camera, setting, step: steps });
    expect(await step(1, "iso", 2)).toEqual({ camera: 1, setting: "iso", value: "640" });
    expect((await step(1, "iso", -100)).value, "stops at the lowest").toBe("100");
    expect((await step(1, "shutter", 100)).value, "stops at the highest").toBe("360°");
    expect((await step(1, "whiteBalance", 3)).value).toBe(5750);
    expect((await step(1, "tint", -5)).value).toBe(-3);
    expect((await step(2, "whiteBalance", -2)).value).toBe(5400);
    expect(await step(2, "focus", -3)).toEqual({ camera: 2, setting: "focus", value: null });
    expect(cameras.sent(2)).toBe(2);
    expect(await refused("cameras.step", { camera: 2, setting: "tint", step: 1 })).toEqual({
      code: "CAMERA_SETTING_UNSUPPORTED",
      sentence: "CAM 2 does not report tint.",
    });
    expect(await refused("cameras.step", { camera: 3, setting: "nd", step: 1 })).toEqual({
      code: "CAMERA_SETTING_UNSUPPORTED",
      sentence: "The BGH1 has no ND filter.",
    });
  });

  it("runs a one-shot auto the camera offers, and refuses one it does not", async () => {
    const { call, refused, seen } = held();
    await call("cameras.set", { camera: 1, setting: "whiteBalance", value: 3200 });
    await call("cameras.set", { camera: 1, setting: "iris", value: "f/8.0" });
    seen();
    // Autofocus once works on CAM 1, whose EF lens reports no position back (finding 15).
    expect(await call("cameras.auto", { camera: 1, what: "focus" })).toEqual({
      camera: 1,
      setting: "focus",
      value: null,
    });
    expect(await call("cameras.auto", { camera: 1, what: "whiteBalance" })).toEqual({
      camera: 1,
      setting: "whiteBalance",
      value: 5600,
    });
    expect(await call("cameras.auto", { camera: 1, what: "iris" })).toEqual({
      camera: 1,
      setting: "iris",
      value: "f/4.0",
    });
    expect(await call("cameras.auto", { camera: 3, what: "focus" })).toEqual({
      camera: 3,
      setting: "focus",
      value: null,
    });
    expect(seen()).toEqual([
      ["cameras.changed", "setting", 1],
      ["cameras.changed", "setting", 1],
      ["cameras.changed", "setting", 1],
      ["cameras.changed", "setting", 3],
    ]);
    expect(await refused("cameras.auto", { camera: 2, what: "whiteBalance" })).toEqual({
      code: "CAMERA_SETTING_UNSUPPORTED",
      sentence: "CAM 2 does not offer auto white balance once.",
    });
    expect(await refused("cameras.auto", { camera: 3, what: "iris" })).toEqual({
      code: "CAMERA_SETTING_UNSUPPORTED",
      sentence: "CAM 3 does not offer auto iris once.",
    });
  });
});

describe("the fixture double's cameras: armed changes (format, look)", () => {
  it("changes the format with a second press, and says what changed", async () => {
    const { call, refused, seen, rows, cameras } = held();
    expect(await refused("cameras.format.set", { camera: 1, frameRate: "50" })).toEqual(NOT_CONFIRMED);
    expect(await refused("cameras.format.set", { camera: 1, frameRate: "50", confirm: false })).toEqual(NOT_CONFIRMED);
    expect(cameras.sent(1), "an unconfirmed change sends nothing").toBe(0);
    expect(await call("cameras.format.set", { camera: 1, frameRate: "50", confirm: true })).toEqual({
      camera: 1,
      sentence: "CAM 1: 25p → 50p.",
    });
    expect(seen()).toEqual([["cameras.changed", "format", 1]]);
    expect((await call("cameras.format.set", { camera: 1, resolution: "UHD", confirm: true })).sentence).toBe(
      "CAM 1: 6K → UHD."
    );
    expect(
      (await call("cameras.format.set", { camera: 1, resolution: "4K DCI", frameRate: "24", confirm: true })).sentence
    ).toBe("CAM 1: UHD 50p → 4K DCI 24p.");
    expect(
      (await call("cameras.format.set", { camera: 2, resolution: "UHD", frameRate: "50", confirm: true })).sentence
    ).toBe("CAM 2: FHD 25p → UHD 50p.");
    expect((await rows()).slice(0, 2).map((row) => [row.domain, row.action, row.target, row.detail])).toEqual([
      ["cameras", "format-changed", "CAM 2", "CAM 2: FHD 25p → UHD 50p."],
      ["cameras", "format-changed", "CAM 1", "CAM 1: UHD 50p → 4K DCI 24p."],
    ]);
  });

  it("refuses a format the camera does not allow, before the second press", async () => {
    const { call, refused } = held();
    expect(await refused("cameras.format.set", { camera: 1, frameRate: "60" })).toEqual({
      code: "CAMERA_FORMAT_NOT_ALLOWED",
      sentence: "CAM 1 does not allow 60p at 6K.",
    });
    await call("cameras.format.set", { camera: 1, resolution: "UHD", frameRate: "60", confirm: true });
    expect(await refused("cameras.format.set", { camera: 1, resolution: "6K", confirm: true })).toEqual({
      code: "CAMERA_FORMAT_NOT_ALLOWED",
      sentence: "CAM 1 does not allow 60p at 6K.",
    });
    expect(await refused("cameras.format.set", { camera: 1, resolution: "8K" })).toEqual({
      code: "CAMERA_VALUE_NOT_ALLOWED",
      sentence: "CAM 1 does not allow resolution 8K.",
    });
    expect(await refused("cameras.format.set", { camera: 2, frameRate: "30", confirm: true })).toEqual({
      code: "CAMERA_VALUE_NOT_ALLOWED",
      sentence: "CAM 2 does not allow frame rate 30.",
    });
    expect(await refused("cameras.format.set", { camera: 1, confirm: true })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "Send resolution, frameRate or both.",
    });
    expect(await refused("cameras.format.set", { camera: 1, frameRate: 50, confirm: true })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "frameRate must be one of the camera's values, as text.",
    });
    expect(await refused("cameras.format.set", { camera: 1, frameRate: "50", confirm: "yes" })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "confirm must be true or false.",
    });
  });

  it("changes the look with a second press, each part of it in the sentence", async () => {
    const { call, refused, seen, rows } = held();
    expect(await refused("cameras.look.set", { camera: 1, dynamicRange: "Video" })).toEqual(NOT_CONFIRMED);
    expect(await call("cameras.look.set", { camera: 1, dynamicRange: "Video", confirm: true })).toEqual({
      camera: 1,
      sentence: "CAM 1: dynamic range Film → Video.",
    });
    expect(seen()).toEqual([["cameras.changed", "look", 1]]);
    // CAM 1's display LUT is read-only (finding 16): the lock, before the list.
    const lutLock = "CAM 1's display LUT is the camera's own menu's: it reports it and takes no change over Bluetooth.";
    expect(await refused("cameras.look.set", { camera: 1, displayLut: "Custom", confirm: true })).toEqual({
      code: "CAMERA_VALUE_NOT_ALLOWED",
      sentence: lutLock,
    });
    expect(await refused("cameras.look.set", { camera: 1, displayLutOn: true, confirm: true })).toEqual({
      code: "CAMERA_VALUE_NOT_ALLOWED",
      sentence: lutLock,
    });
    expect((await rows())[0]).toMatchObject({
      source: "ui",
      domain: "cameras",
      action: "look-changed",
      target: "CAM 1",
      detail: "CAM 1: dynamic range Film → Video.",
    });
    expect(await refused("cameras.look.set", { camera: 2, dynamicRange: "Video", confirm: true })).toEqual({
      code: "CAMERA_SETTING_UNSUPPORTED",
      sentence: "CAM 2 does not report its dynamic range.",
    });
    expect(await refused("cameras.look.set", { camera: 3, displayLutOn: true, confirm: true })).toEqual({
      code: "CAMERA_SETTING_UNSUPPORTED",
      sentence: "CAM 3 does not report a display LUT.",
    });
    expect(await refused("cameras.look.set", { camera: 1, displayLut: "Rec 709" })).toEqual({
      code: "CAMERA_VALUE_NOT_ALLOWED",
      sentence: lutLock,
    });
    expect(await refused("cameras.look.set", { camera: 1, confirm: true })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "Send dynamicRange, displayLut, displayLutOn or several.",
    });
    expect(await refused("cameras.look.set", { camera: 1, displayLutOn: "off", confirm: true })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "displayLutOn must be true or false.",
    });
  });
});

describe("the fixture double's cameras: the record (CAM 1, D14)", () => {
  it("starts with one press and stops with two, on CAM 1 whichever camera is selected", async () => {
    const { call, refused, seen, rows, camera, cameras } = held();
    await call("cameras.select", { camera: 3 });
    seen();
    expect(await call("cameras.record.start")).toEqual({
      camera: 1,
      recording: true,
      sentence: "CAM 1 started recording.",
    });
    expect(seen(), "the Cameras check says CAM 1 records now").toEqual([
      ["cameras.changed", "record", 1],
      ["app.changed", "health"],
    ]);
    expect((await camera(1)).recording.recording).toBe(true);
    expect(await refused("cameras.record.start")).toEqual({
      code: "CAMERA_ALREADY_RECORDING",
      sentence: "CAM 1 is already recording.",
    });
    expect(await refused("cameras.record.stop")).toEqual(NOT_CONFIRMED);
    expect(await call("cameras.record.stop", { confirm: true })).toEqual({
      camera: 1,
      recording: false,
      sentence: "CAM 1 stopped recording.",
    });
    expect(await refused("cameras.record.stop", { confirm: true })).toEqual({
      code: "CAMERA_NOT_RECORDING",
      sentence: "CAM 1 is not recording.",
    });
    expect(await refused("cameras.record.stop", { confirm: 1 })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "confirm must be true or false.",
    });
    expect((await rows()).slice(0, 2).map((row) => [row.action, row.target, row.detail])).toEqual([
      ["recording-stopped", "CAM 1", "CAM 1 stopped recording."],
      ["recording-started", "CAM 1", "CAM 1 started recording."],
    ]);
    expect(cameras.sent(1)).toBe(2);
    expect(cameras.sent(3)).toBe(0);
  });

  it("refuses the record while CAM 1 is not set up, released or unreachable", async () => {
    const notPaired = openCamerasDouble({ cameras: [{ camera: 2, address: CAM2_ADDRESS }], selected: 2 });
    expect(await notPaired.refused("cameras.record.start")).toEqual({
      code: "CAMERA_NOT_SET_UP",
      sentence: "CAM 1 is not paired. Pair it in Setup, with the camera beside you.",
    });
    const { call, refused, cameras } = held();
    await call("cameras.release", { camera: 1, confirm: true });
    expect(await refused("cameras.record.start")).toEqual({
      code: "CAMERA_RELEASED",
      sentence: "CAM 1 is released. Connect it to set it from here.",
    });
    await call("cameras.connect", { camera: 1 });
    cameras.stopAnswering(1);
    expect(await refused("cameras.record.stop", { confirm: true })).toEqual({
      code: "CAMERA_UNREACHABLE",
      sentence: "CAM 1 does not answer over Bluetooth. Check it is on and within reach.",
    });
  });
});

describe("the fixture double's cameras: who holds a camera (D13)", () => {
  it("releases with a second press and connects again, sending nothing either way", async () => {
    const { call, refused, seen, rows, camera, cameras } = held();
    expect(await refused("cameras.release", { camera: 2 })).toEqual(NOT_CONFIRMED);
    expect(await call("cameras.release", { camera: 2, confirm: true })).toEqual({
      camera: 2,
      state: "released",
      sentence: "CAM 2 released to LUMIX Tether.",
    });
    expect(seen()).toEqual([
      ["cameras.changed", "release", 2],
      ["app.changed", "health"],
    ]);
    expect(await camera(2)).toMatchObject({
      state: "released",
      word: "RELEASED",
      tone: "attention",
      sentence: "CAM 2 is released to LUMIX Tether. Connect it to control it here.",
      readAt: null,
    });
    expect(await refused("cameras.release", { camera: 2, confirm: true })).toEqual({
      code: "CAMERA_RELEASED",
      sentence: "CAM 2 is released. Connect it to set it from here.",
    });
    expect(await refused("cameras.set", { camera: 2, setting: "iso", value: "800" })).toEqual({
      code: "CAMERA_RELEASED",
      sentence: "CAM 2 is released. Connect it to set it from here.",
    });
    expect(await call("cameras.connect", { camera: 2 })).toEqual({
      camera: 2,
      state: "held",
      sentence: "CAM 2 held again.",
    });
    expect(seen()).toEqual([
      ["cameras.changed", "connect", 2],
      ["app.changed", "health"],
    ]);
    expect((await camera(2)).values.iso.value, "read again").toBe("800");
    expect(await refused("cameras.connect", { camera: 2 })).toEqual({
      code: "CAMERA_ALREADY_HELD",
      sentence: "CAM 2 is already held.",
    });
    expect(await call("cameras.release", { camera: 1, confirm: true })).toMatchObject({
      sentence: "CAM 1 released.",
    });
    expect((await rows()).slice(0, 3).map((row) => [row.action, row.target, row.detail])).toEqual([
      ["released", "CAM 1", "CAM 1 released."],
      ["held-again", "CAM 2", "CAM 2 held again."],
      ["released", "CAM 2", "CAM 2 released to LUMIX Tether."],
    ]);
    expect([cameras.sent(1), cameras.sent(2)]).toEqual([0, 0]);
  });

  it("refuses to release or connect a camera that is not set up", async () => {
    const { refused } = openCamerasDouble();
    expect(await refused("cameras.release", { camera: 3, confirm: true })).toEqual({
      code: "CAMERA_NOT_SET_UP",
      sentence: "CAM 3 has no address. Enter it in Setup.",
    });
    expect(await refused("cameras.connect", { camera: 1 })).toEqual({
      code: "CAMERA_NOT_SET_UP",
      sentence: "CAM 1 is not paired. Pair it in Setup, with the camera beside you.",
    });
    expect((await refused("cameras.connect", { camera: 0 })).code).toBe("INVALID_PARAMS");
  });

  it("lets a recording CAM 1 go on recording when it is released, and finds the take when it connects", async () => {
    const { call, camera, health } = held();
    await call("cameras.record.start");
    await call("cameras.release", { camera: 1, confirm: true });
    const released = await camera(1);
    expect(released.recording.recording, "not read, so not shown").toBeNull();
    expect((await health()).check.recording).toBe(false);
    await call("cameras.connect", { camera: 1 });
    expect((await camera(1)).recording).toMatchObject({ recording: true, startedAt: null });
    expect((await health()).check.recording).toBe(true);
  });

  it("tries an unreachable camera again on connect and answers its state; it can be released", async () => {
    const { call, refused, cameras, rows } = held();
    cameras.stopAnswering(2);
    const before = (await rows()).length;
    expect(await refused("cameras.set", { camera: 2, setting: "iso", value: "800" })).toEqual({
      code: "CAMERA_UNREACHABLE",
      sentence: `CAM 2 does not answer at ${CAM2_ADDRESS}. Check that it is on and on the network.`,
    });
    expect(await call("cameras.connect", { camera: 2 })).toEqual({
      camera: 2,
      state: "unreachable",
      sentence: `CAM 2 does not answer at ${CAM2_ADDRESS}. Check that it is on and on the network.`,
    });
    // Finding 18: the press is a row, even when the camera does not answer yet.
    expect((await rows()).length, "a connected row at the press").toBe(before + 1);
    expect((await rows())[0]).toMatchObject({
      action: "connected",
      detail: "CAM 2 taken back; it is held again when it answers.",
    });
    expect(await call("cameras.release", { camera: 2, confirm: true })).toMatchObject({ state: "released" });
    cameras.answerAgain(2);
    expect(await call("cameras.connect", { camera: 2 })).toMatchObject({
      state: "held",
      sentence: "CAM 2 held again.",
    });
  });
});

describe("the fixture double's cameras: the selection (D19)", () => {
  it("selects any camera, set up or not, in memory and without a Recent actions row", async () => {
    const { call, refused, seen, snapshot, rows } = openCamerasDouble();
    expect((await snapshot()).selected).toBe(1);
    const before = (await rows()).length;
    expect(await call("cameras.select", { camera: 3 })).toEqual({ selected: 3 });
    expect(seen()).toEqual([["cameras.changed", "select", 3]]);
    expect((await snapshot()).selected).toBe(3);
    expect(seen(), "a read raises nothing").toEqual([]);
    expect(await refused("cameras.select", { camera: 4 })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "camera must be 1, 2 or 3.",
    });
    expect((await rows()).length).toBe(before);
    expect((await openCamerasDouble({ selected: 2 }).snapshot()).selected).toBe(2);
  });
});

describe("the fixture double's cameras: the dials' bank (D14)", () => {
  it("puts the deck's dials on a bank, in memory, and says what each dial sets", async () => {
    const { call, refused, seen, snapshot, rows, cameras } = held();
    expect((await snapshot()).dials).toEqual({ bank: "exposure", sets: ["iso", "shutter", "iris", "nd"] });
    const before = (await rows()).length;
    expect(await call("cameras.bank.set", { bank: "colour" })).toEqual({
      bank: "colour",
      dials: { bank: "colour", sets: ["whiteBalance", "tint", null, null] },
    });
    expect(seen()).toEqual([["cameras.changed", "bank", null]]);
    expect(await call("cameras.bank.set", { bank: "focus" })).toMatchObject({
      dials: { sets: ["focus", null, null, null] },
    });
    expect((await snapshot()).dials.bank).toBe("focus");
    for (const bank of ["iris", "", 2, null]) {
      expect(await refused("cameras.bank.set", { bank })).toEqual({
        code: "INVALID_PARAMS",
        sentence: "bank must be exposure, colour or focus.",
      });
    }
    expect(await refused("cameras.bank.set", {})).toMatchObject({ code: "INVALID_PARAMS" });
    expect((await snapshot()).dials.bank, "a refused request changes nothing").toBe("focus");
    expect((await rows()).length, "the bank is not a Recent action").toBe(before);
    expect(
      ([1, 2, 3] as const).map((camera) => cameras.sent(camera)),
      "the bank reaches no camera"
    ).toEqual([0, 0, 0]);
    expect((await openCamerasDouble({ bank: "colour" }).snapshot()).dials.bank).toBe("colour");
  });

  // `CameraDialBank::dials` in the hardware link's `model.rs`: the double gives each dial
  // the same setting, bank by bank.
  it("gives each dial what the hardware link gives it", () => {
    const model = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../native/rust-engine/src/cameras/model.rs"),
      "utf-8"
    );
    const body = /fn dials\(self\)[^{]*\{([\s\S]*?)\n {4}\}\n/.exec(model)?.[1];
    expect(body, "model.rs has no fn dials any more; update this test").toBeDefined();
    const banks: Record<string, Array<string | null>> = {};
    for (const [, bank, dials] of body!.matchAll(/Self::(\w+) => \[([^\]]*)\]/g)) {
      banks[bank!.toLowerCase()] = [...dials!.matchAll(/Some\(Setting::(\w+)\)|None/g)].map(([, setting]) =>
        setting === undefined ? null : setting[0]!.toLowerCase() + setting.slice(1)
      );
    }
    expect(Object.keys(banks)).toEqual([...DIAL_BANKS]);
    expect(banks).toEqual(DIAL_BANK_SETS);
  });
});

describe("the fixture double's cameras: Setup", () => {
  it("saves an address: the camera is set up, held and read at once, and sent nothing", async () => {
    const { call, seen, camera, cameras, rows } = openCamerasDouble();
    const before = (await rows()).length;
    expect(await call("cameras.setup.update", { camera: 2, address: " 010.000.000.002 " })).toEqual({
      camera: 2,
      setup: {
        setUp: true,
        address: "10.0.0.2",
        paired: false,
        vmixInput: 2,
        vmixOutput: 3,
        noLink: null,
        pairing: null,
      },
    });
    expect(seen()).toEqual([
      ["cameras.changed", "setup", 2],
      ["app.changed", "health"],
    ]);
    expect(await camera(2)).toMatchObject({ state: "held", readAt: new Date(NOW).toISOString() });
    expect((await camera(2)).values.iso.value).toBe("800");
    expect(await call("cameras.setup.update", { camera: 2, vmixInput: 7 })).toEqual({
      camera: 2,
      setup: {
        setUp: true,
        address: "10.0.0.2",
        paired: false,
        vmixInput: 7,
        vmixOutput: 3,
        noLink: null,
        pairing: null,
      },
    });
    expect(await call("cameras.setup.update", { camera: 1, vmixInput: 1000 })).toMatchObject({
      setup: { setUp: false, vmixInput: 1000 },
    });
    expect(await call("cameras.setup.update", { camera: 2, address: null })).toEqual({
      camera: 2,
      setup: { setUp: false, address: null, paired: false, vmixInput: 7, vmixOutput: 3, noLink: null, pairing: null },
    });
    expect((await camera(2)).state).toBe("not-set-up");
    expect(cameras.sent(2)).toBe(0);
    expect((await rows()).length, "Setup's requests are not Recent actions").toBe(before);
  });

  it("refuses an address that is not one machine's, and a request of the wrong shape", async () => {
    const { refused, seen } = openCamerasDouble();
    for (const address of [
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.1",
      "239.255.255.250",
      "256.1.1.1",
      "1.2.3",
      "1.2.3.4.5",
      "+1.2.3.4",
      "1.2.3.-4",
      "1.2.3.0004",
      "cam2.local",
    ]) {
      expect(await refused("cameras.setup.update", { camera: 3, address: ` ${address} ` }), address).toEqual({
        code: "CAMERA_ADDRESS_INVALID",
        sentence: `${address} is not the address of one machine. Enter the camera's IPv4 address: four numbers from 0 to 255, such as 172.16.16.85.`,
      });
    }
    const invalid = (sentence: string) => ({ code: "INVALID_PARAMS", sentence });
    expect(await refused("cameras.setup.update", { camera: 1, address: "10.0.0.1" })).toEqual(
      invalid("CAM 1 has no address: it is paired over Bluetooth.")
    );
    for (const address of ["", "  ", 5]) {
      expect(await refused("cameras.setup.update", { camera: 2, address }), String(address)).toEqual(
        invalid("address must be the camera's IPv4 address, or null to take it away.")
      );
    }
    for (const vmixInput of [0, 1001, 2.5, null, "3"]) {
      expect(await refused("cameras.setup.update", { camera: 2, vmixInput }), String(vmixInput)).toEqual(
        invalid("vmixInput must be a whole number from 1 to 1000.")
      );
    }
    // The shape before the address: a bad vMix input beside a bad address is INVALID_PARAMS.
    expect((await refused("cameras.setup.update", { camera: 2, address: "0.0.0.0", vmixInput: 0 })).code).toBe(
      "INVALID_PARAMS"
    );
    expect(await refused("cameras.setup.update", { camera: 2 })).toEqual(invalid("Send address, vmixInput or both."));
    expect(seen()).toEqual([]);
  });

  it("holds a released camera again when its address is saved, and keeps it released for a new vMix input", async () => {
    const { call, camera } = held();
    await call("cameras.release", { camera: 3, confirm: true });
    await call("cameras.setup.update", { camera: 3, vmixInput: 9 });
    expect((await camera(3)).state).toBe("released");
    await call("cameras.setup.update", { camera: 3, address: "127.0.0.9" });
    expect(await camera(3)).toMatchObject({ state: "held", setup: { address: "127.0.0.9", vmixInput: 9 } });
  });

  it("pairs CAM 1 at the PIN it shows, and forgets a camera's address or pairing", async () => {
    const { call, refused, seen, camera, cameras } = openCamerasDouble();
    const wanted = { state: "pin", sentence: "CAM 1 shows a 6-digit PIN. Enter it here within 30 seconds." };
    expect(await call("cameras.setup.pair", { camera: 1 })).toEqual({
      camera: 1,
      setup: { setUp: false, address: null, paired: false, vmixInput: 1, vmixOutput: 2, noLink: null, pairing: wanted },
    });
    expect(seen()).toEqual([["cameras.changed", "pairing", 1]]);
    expect((await camera(1)).state, "nothing is saved yet").toBe("not-set-up");
    expect(await call("cameras.setup.pair", { camera: 1, pin: " 123456 " })).toEqual({
      camera: 1,
      setup: { setUp: true, address: null, paired: true, vmixInput: 1, vmixOutput: 2, noLink: null, pairing: null },
    });
    expect(seen()).toEqual([
      ["cameras.changed", "setup", 1],
      ["app.changed", "health"],
    ]);
    expect((await camera(1)).state).toBe("held");
    expect(await refused("cameras.setup.pair", { camera: 2 })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "Only CAM 1 is paired; CAM 2 and CAM 3 take an address.",
    });
    await call("cameras.setup.update", { camera: 1, vmixInput: 4 });
    expect(await call("cameras.setup.forget", { camera: 1 })).toEqual({
      camera: 1,
      setup: { setUp: false, address: null, paired: false, vmixInput: 4, vmixOutput: 2, noLink: null, pairing: null },
    });
    expect((await camera(1)).state).toBe("not-set-up");
    expect(cameras.sent(1)).toBe(0);
  });

  it("fails a PIN that is not the camera's, saves nothing, and takes a PIN only while one is wanted", async () => {
    const { call, refused, seen, camera, cameras } = openCamerasDouble();
    const notWanted = {
      code: "CAMERA_PAIRING_NOT_WANTED",
      sentence: "CAM 1's pairing does not wait for a PIN now. Press Pair CAM 1 first.",
    };
    expect(await refused("cameras.setup.pair", { camera: 1, pin: "123456" })).toEqual(notWanted);
    await call("cameras.setup.pair", { camera: 1 });
    seen();
    for (const pin of ["12345", "1234567", "12a456", "12 456", "", 123456, true]) {
      expect(await refused("cameras.setup.pair", { camera: 1, pin }), String(pin)).toEqual({
        code: "INVALID_PARAMS",
        sentence: "pin must be the 6 digits CAM 1 shows.",
      });
    }
    expect(seen(), "a refused request raises nothing").toEqual([]);
    expect(await call("cameras.setup.pair", { camera: 1, pin: "654321" })).toMatchObject({
      setup: {
        paired: false,
        pairing: { state: "failed", sentence: "CAM 1 did not accept the PIN. Press Pair CAM 1 to try again." },
      },
    });
    expect(seen()).toEqual([["cameras.changed", "pairing", 1]]);
    expect(await refused("cameras.setup.pair", { camera: 1, pin: "123456" })).toEqual(notWanted);
    expect((await camera(1)).state).toBe("not-set-up");
    // A new pairing starts over; Forget stops one that runs.
    expect(await call("cameras.setup.pair", { camera: 1 })).toMatchObject({ setup: { pairing: { state: "pin" } } });
    expect(await call("cameras.setup.forget", { camera: 1 })).toMatchObject({ setup: { pairing: null } });
    expect(await refused("cameras.setup.pair", { camera: 1, pin: "123456" })).toEqual(notWanted);
    expect(cameras.sent(1)).toBe(0);
  });

  it("takes no address without a link to CAM 2 and CAM 3, and CAM 1's pairing in the studio's build", async () => {
    const { call, refused, seen, snapshot, health, cameras } = openCamerasDouble({ simulated: false });
    const notPaired = "CAM 1 is not paired. Pair it in Setup, with the camera beside you.";
    const cannotTake = "Studio Control cannot take CAM 2's address yet: its network link comes with a later version.";
    expect(await refused("cameras.setup.update", { camera: 2, address: "127.0.0.1" })).toEqual({
      code: "CAMERA_NO_LINK",
      sentence: cannotTake,
    });
    // Nothing of a refused request is saved, the vMix input beside the address included.
    expect(await refused("cameras.setup.update", { camera: 2, address: "127.0.0.1", vmixInput: 9 })).toEqual({
      code: "CAMERA_NO_LINK",
      sentence: cannotTake,
    });
    // The request's shape and the address's form are checked first.
    expect((await refused("cameras.setup.update", { camera: 2, address: "" })).code).toBe("INVALID_PARAMS");
    expect((await refused("cameras.setup.update", { camera: 2, address: "1.2.3" })).code).toBe(
      "CAMERA_ADDRESS_INVALID"
    );
    expect(seen()).toEqual([]);

    const shown = await snapshot();
    expect(shown.cameras.map((camera) => [camera.state, camera.sentence, camera.setup])).toEqual([
      [
        "not-set-up",
        notPaired,
        { setUp: false, address: null, paired: false, vmixInput: 1, vmixOutput: 2, noLink: null, pairing: null },
      ],
      [
        "not-set-up",
        "Studio Control has no link to CAM 2 yet: it comes with a later version.",
        { setUp: false, address: null, paired: false, vmixInput: 2, vmixOutput: 3, noLink: cannotTake, pairing: null },
      ],
      [
        "not-set-up",
        "Studio Control has no link to CAM 3 yet: it comes with a later version.",
        {
          setUp: false,
          address: null,
          paired: false,
          vmixInput: 3,
          vmixOutput: 4,
          noLink: "Studio Control cannot take CAM 3's address yet: its network link comes with a later version.",
          pairing: null,
        },
      ],
    ]);
    const { summary, check } = await health();
    expect(check).toMatchObject({ word: "NOT SET UP", summary: notPaired });
    expect(summary, "the Cameras lamp only").not.toContain("Cameras:");
    expect(await refused("cameras.set", { camera: 2, setting: "iso", value: "800" })).toEqual({
      code: "CAMERA_NOT_SET_UP",
      sentence: "Studio Control has no link to CAM 2 yet: it comes with a later version.",
    });

    // The vMix input, taking an address away and Forget stay.
    expect(await call("cameras.setup.update", { camera: 2, vmixInput: 9 })).toMatchObject({
      setup: { vmixInput: 9 },
    });
    expect(await call("cameras.setup.update", { camera: 2, address: null })).toMatchObject({
      setup: { setUp: false },
    });
    // CAM 1's link is the studio build's own; the double has no Pocket, so its pairing looks
    // for one and finds none, and takes no PIN.
    expect(await call("cameras.setup.pair", { camera: 1 })).toMatchObject({
      setup: {
        noLink: null,
        pairing: {
          state: "finding",
          sentence: "Looking for CAM 1. Switch its Bluetooth on, with no other controller connected to it.",
        },
      },
    });
    expect((await refused("cameras.setup.pair", { camera: 1, pin: "123456" })).code).toBe("CAMERA_PAIRING_NOT_WANTED");
    expect(await call("cameras.setup.forget", { camera: 1 })).toMatchObject({ setup: { noLink: null, pairing: null } });
    expect([cameras.sent(1), cameras.sent(2), cameras.sent(3)]).toEqual([0, 0, 0]);
  });

  it("reads a camera the saved data holds without a link as having no link yet, until its address is taken away", async () => {
    // Saved data that holds an address all the same: a database backup restored whole.
    const { call, refused, camera, health } = openCamerasDouble({
      simulated: false,
      cameras: [{ camera: 2, address: CAM2_ADDRESS }],
    });
    expect(await camera(2)).toMatchObject({
      state: "unreachable",
      sentence: "Studio Control has no link to CAM 2 yet: it comes with a later version.",
      readAt: null,
    });
    expect(await refused("cameras.step", { camera: 2, setting: "iso", step: 1 })).toEqual({
      code: "CAMERA_UNREACHABLE",
      sentence: "Studio Control has no link to CAM 2 yet: it comes with a later version.",
    });
    expect((await health()).summary).toContain("Cameras:");
    await call("cameras.setup.update", { camera: 2, address: null });
    expect((await camera(2)).state).toBe("not-set-up");
    expect((await health()).summary).not.toContain("Cameras:");
  });
});

// D47, the Overview's footer: CAM 1's takes since local midnight, from the action log, as
// `action_log::takes_today` counts them.
describe("the fixture double's cameras: the day's takes in the read", () => {
  it("pairs CAM 1's starts with the next stop, and counts a running take with its seconds so far", async () => {
    const { call, snapshot } = held();
    expect((await snapshot()).takesToday).toEqual({ count: 0, recordedSeconds: 0 });
    await call("cameras.record.start");
    vi.setSystemTime(NOW + 90_500);
    expect((await snapshot()).takesToday).toEqual({ count: 1, recordedSeconds: 90 });
    await call("cameras.record.stop", { confirm: true });
    vi.setSystemTime(NOW + 600_000);
    expect((await snapshot()).takesToday, "a stopped take keeps its length").toEqual({
      count: 1,
      recordedSeconds: 90,
    });
    await call("cameras.record.start");
    vi.setSystemTime(NOW + 610_000);
    await call("cameras.record.stop", { confirm: true });
    expect((await snapshot()).takesToday).toEqual({ count: 2, recordedSeconds: 100 });
  });

  it("leaves out a take begun before local midnight, its stop included", async () => {
    const { call, snapshot } = held();
    await call("cameras.record.start");
    vi.setSystemTime(NOW + 24 * 3_600_000);
    expect((await snapshot()).takesToday).toEqual({ count: 0, recordedSeconds: 0 });
    await call("cameras.record.stop", { confirm: true });
    expect((await snapshot()).takesToday).toEqual({ count: 0, recordedSeconds: 0 });
  });
});

describe("the fixture double's cameras: their Recent actions in the read", () => {
  it("carries the newest five rows about the cameras, newest first, and no row of another page", async () => {
    const { call, snapshot, seen, rows } = held();
    expect((await snapshot()).recent).toEqual([]);
    await call("cameras.record.start");
    await call("cameras.format.set", { camera: 1, frameRate: "50", confirm: true });
    await call("prompter.script.create", { name: "Opening" });
    const script = (((await call("prompter.snapshot")).scripts as JsonObject[])[0] as JsonObject).id as string;
    await call("prompter.putOn", { scriptId: script });
    await call("cameras.record.stop", { confirm: true });
    await call("cameras.release", { camera: 2, confirm: true });
    await call("cameras.connect", { camera: 2 });
    await call("cameras.release", { camera: 3, confirm: true });
    // A press on a setting, the selection and Setup leave no row.
    await call("cameras.set", { camera: 1, setting: "iso", value: "800" });
    await call("cameras.select", { camera: 2 });
    await call("cameras.setup.update", { camera: 3, vmixInput: 4 });
    seen();

    const recent = (await snapshot()).recent!;
    expect(seen(), "a read raises nothing").toEqual([]);
    expect(recent.map((row) => [row.source, row.action, row.target, row.detail])).toEqual([
      ["ui", "released", "CAM 3", "CAM 3 released to LUMIX Tether."],
      ["ui", "held-again", "CAM 2", "CAM 2 held again."],
      ["ui", "released", "CAM 2", "CAM 2 released to LUMIX Tether."],
      ["ui", "recording-stopped", "CAM 1", "CAM 1 stopped recording."],
      ["ui", "format-changed", "CAM 1", "CAM 1: 25p → 50p."],
    ]);
    expect(Object.keys(recent[0]!).sort()).toEqual(["action", "at", "detail", "id", "source", "target"]);
    expect(recent[0]!.id).toBeGreaterThan(recent[1]!.id);
    expect(recent[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // They are the action log's own rows, as Setup / Support lists them.
    const logged = (await rows()).filter((row) => row.domain === "cameras");
    expect(logged.slice(0, 5).map((row) => row.id)).toEqual(recent.map((row) => row.id));
    expect(logged).toHaveLength(6);
  });

  it("answers no list, and everything else, while the action log cannot be read", async () => {
    const { call, snapshot, seen, cameras } = held();
    await call("cameras.record.start");
    seen();
    cameras.actionLogUnreadable(true);
    const unread = await snapshot();
    expect(unread.recent).toBeNull();
    expect(unread.takesToday).toBeNull();
    expect(unread.cameras[0]).toMatchObject({ state: "held", recording: { recording: true } });
    expect(seen(), "a read raises nothing").toEqual([]);
    cameras.actionLogUnreadable(false);
    expect((await snapshot()).recent).toHaveLength(1);
  });

  it("holds as many rows as the hardware link's read", () => {
    const commands = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../native/rust-engine/src/cameras/commands.rs"),
      "utf-8"
    );
    const limit = commands.match(/const CAMERAS_RECENT_LIMIT: usize = (\d+);/)?.[1];
    expect(Number(limit)).toBe(CAMERAS_RECENT_LIMIT);
  });
});

describe("the fixture double's cameras: nothing is sent by itself (D12)", () => {
  it("sends only a press: not a start, a read, a selection, a connect, Setup, a release or a restore", async () => {
    const { call, cameras } = held();
    const sent = () => [cameras.sent(1), cameras.sent(2), cameras.sent(3)];
    expect(sent(), "a start").toEqual([0, 0, 0]);
    const quiet: Array<[RequestMethod, Record<string, unknown>]> = [
      ["cameras.snapshot", {}],
      ["cameras.select", { camera: 2 }],
      ["cameras.release", { camera: 2, confirm: true }],
      ["cameras.connect", { camera: 2 }],
      ["cameras.setup.update", { camera: 3, vmixInput: 12 }],
      ["cameras.setup.update", { camera: 3, address: "127.0.0.13" }],
      ["cameras.setup.pair", { camera: 1 }],
      ["support.backup.export", {}],
    ];
    for (const [method, params] of quiet) await call(method, params as never);
    const path = ((await call("support.snapshot")).backups as Array<{ path: string }>)[0]!.path;
    await call("support.backup.restore", { path });
    expect(sent(), "none of those sends anything").toEqual([0, 0, 0]);

    await call("cameras.set", { camera: 1, setting: "iso", value: "800" });
    await call("cameras.step", { camera: 2, setting: "focus", step: 1 });
    await call("cameras.auto", { camera: 3, what: "focus" });
    await call("cameras.format.set", { camera: 1, frameRate: "24", confirm: true });
    await call("cameras.look.set", { camera: 1, dynamicRange: "Video", confirm: true });
    await call("cameras.record.start");
    await call("cameras.record.stop", { confirm: true });
    expect(sent(), "each press sends once").toEqual([5, 1, 1]);
  });
});
