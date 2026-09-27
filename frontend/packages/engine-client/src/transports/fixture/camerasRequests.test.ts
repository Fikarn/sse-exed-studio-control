import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestMethod } from "../../generated/protocol";
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
    expect(await call("cameras.set", { camera: 1, setting: "focus", value: 0.57 })).toMatchObject({ value: 0.57 });
    expect(await call("cameras.set", { camera: 1, setting: "tint", value: -50 })).toMatchObject({ value: -50 });
    expect(await call("cameras.set", { camera: 2, setting: "shutter", value: "1/100" })).toMatchObject({
      camera: 2,
      value: "1/100",
    });
    expect(cameras.sent(1)).toBe(4);
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
      [1, "focus", 1.5, "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow focus 1.5."],
      [1, "focus", 0.625, "CAMERA_VALUE_NOT_ALLOWED", "CAM 1 does not allow focus 0.625."],
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
    expect((await step(1, "focus", -1)).value).toBe(0.61);
    expect((await step(1, "focus", 1000)).value).toBe(1);
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
    expect(await call("cameras.auto", { camera: 1, what: "focus" })).toEqual({
      camera: 1,
      setting: "focus",
      value: 0.5,
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
    expect(
      await call("cameras.look.set", { camera: 1, dynamicRange: "Video", displayLutOn: false, confirm: true })
    ).toEqual({ camera: 1, sentence: "CAM 1: dynamic range Film → Video; display LUT off." });
    expect(seen()).toEqual([["cameras.changed", "look", 1]]);
    expect((await call("cameras.look.set", { camera: 1, displayLut: "Custom", confirm: true })).sentence).toBe(
      "CAM 1: display LUT Film → Ext. video → Custom."
    );
    expect((await call("cameras.look.set", { camera: 1, displayLutOn: true, confirm: true })).sentence).toBe(
      "CAM 1: display LUT on."
    );
    expect((await rows())[0]).toMatchObject({
      source: "ui",
      domain: "cameras",
      action: "look-changed",
      target: "CAM 1",
      detail: "CAM 1: display LUT on.",
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
      sentence: "CAM 1 does not allow display LUT Rec 709.",
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
      sentence: "CAM 1 does not answer over Bluetooth. Check that it is on and within reach of this PC.",
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
      sentence:
        "CAM 2 is released to LUMIX Tether. Studio Control does not read it or send it anything until you connect it again.",
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
      sentence: "CAM 1 released to the iPad.",
    });
    expect((await rows()).slice(0, 3).map((row) => [row.action, row.target, row.detail])).toEqual([
      ["released", "CAM 1", "CAM 1 released to the iPad."],
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
    expect((await rows()).length, "not held again, so no row").toBe(before);
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

describe("the fixture double's cameras: Setup", () => {
  it("saves an address: the camera is set up, held and read at once, and sent nothing", async () => {
    const { call, seen, camera, cameras, rows } = openCamerasDouble();
    const before = (await rows()).length;
    expect(await call("cameras.setup.update", { camera: 2, address: " 010.000.000.002 " })).toEqual({
      camera: 2,
      setup: { setUp: true, address: "10.0.0.2", paired: false, vmixInput: 2 },
    });
    expect(seen()).toEqual([
      ["cameras.changed", "setup", 2],
      ["app.changed", "health"],
    ]);
    expect(await camera(2)).toMatchObject({ state: "held", readAt: new Date(NOW).toISOString() });
    expect((await camera(2)).values.iso.value).toBe("800");
    expect(await call("cameras.setup.update", { camera: 2, vmixInput: 7 })).toEqual({
      camera: 2,
      setup: { setUp: true, address: "10.0.0.2", paired: false, vmixInput: 7 },
    });
    expect(await call("cameras.setup.update", { camera: 1, vmixInput: 1000 })).toMatchObject({
      setup: { setUp: false, vmixInput: 1000 },
    });
    expect(await call("cameras.setup.update", { camera: 2, address: null })).toEqual({
      camera: 2,
      setup: { setUp: false, address: null, paired: false, vmixInput: 7 },
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

  it("pairs CAM 1 with the simulated link at once, and forgets a camera's address or pairing", async () => {
    const { call, refused, seen, camera, cameras } = openCamerasDouble();
    expect(await call("cameras.setup.pair", { camera: 1 })).toEqual({
      camera: 1,
      setup: { setUp: true, address: null, paired: true, vmixInput: 1 },
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
      setup: { setUp: false, address: null, paired: false, vmixInput: 4 },
    });
    expect((await camera(1)).state).toBe("not-set-up");
    expect(cameras.sent(1)).toBe(0);
  });

  it("answers CAMERA_NO_LINK for a pairing without the simulated link, and reads a set-up camera as having no link yet", async () => {
    const { refused, camera } = openCamerasDouble({
      simulated: false,
      cameras: [{ camera: 2, address: CAM2_ADDRESS }],
    });
    expect(await refused("cameras.setup.pair", { camera: 1 })).toEqual({
      code: "CAMERA_NO_LINK",
      sentence: "Studio Control cannot pair CAM 1 yet: its Bluetooth link comes with a later version.",
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
    await call("cameras.look.set", { camera: 1, displayLutOn: false, confirm: true });
    await call("cameras.record.start");
    await call("cameras.record.stop", { confirm: true });
    expect(sent(), "each press sends once").toEqual([5, 1, 1]);
  });
});
