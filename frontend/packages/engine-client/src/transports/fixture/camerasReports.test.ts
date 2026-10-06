import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CameraChoice } from "../../generated/snapshots/CameraChoice";
import type { CameraLevel } from "../../generated/snapshots/CameraLevel";
import { CAMERA_MODELS } from "./camerasModel";
import { ALL_SET_UP, CAM2_ADDRESS, openCamerasDouble } from "./camerasTestSupport";

// What the fixture double's cameras report (new pages program, Slice 8), held to board 2's
// assumptions as the ledger records them (the slice's first step 4) and as the hardware
// link's simulated cameras hold them (`native/rust-engine/src/cameras/model.rs`, `simulated.rs`,
// `report.rs`): CAM 1 every value D10 lists, CAM 2 and CAM 3 no tint, focus position, ND,
// dynamic range or display LUT and no recording; a camera never read, or released, shows
// no value; an unreachable one keeps what it last reported, and when.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const AT = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const ISO_CAM1 =
  "100 125 160 200 250 320 400 500 640 800 1000 1250 1600 2000 2500 3200 4000 5000 6400 8000 10000 12800 16000 20000 25600".split(
    " "
  );
const IRIS_F28 = "f/2.8 f/3.2 f/3.5 f/4.0 f/4.5 f/5.0 f/5.6 f/6.3 f/7.1 f/8.0 f/9.0 f/10 f/11 f/13 f/14 f/16".split(
  " "
);

const choice = (options: string[], value: string | null): CameraChoice => ({
  reported: true,
  value,
  options,
  unavailable: [],
  notReported: null,
});
const notReportedChoice = (sentence: string): CameraChoice => ({
  reported: false,
  value: null,
  options: [],
  unavailable: [],
  notReported: sentence,
});
const level = (min: number, max: number, step: number, unit: string, value: number | null): CameraLevel => ({
  reported: true,
  value,
  min,
  max,
  step,
  unit,
  notReported: null,
});
const notReportedLevel = (sentence: string): CameraLevel => ({
  reported: false,
  value: null,
  min: 0,
  max: 0,
  step: 0,
  unit: "",
  notReported: sentence,
});

describe("the fixture double's cameras: where they start", () => {
  it("holds none without a seed (new saved data, D15 rule 1): every camera NOT SET UP, CAM 1 selected", async () => {
    const { snapshot, health, cameras } = openCamerasDouble();
    const shown = await snapshot();
    expect(shown.selected).toBe(1);
    expect(shown.cameras.map((camera) => [camera.tag, camera.state, camera.word, camera.tone])).toEqual([
      ["CAM 1", "not-set-up", "NOT SET UP", "attention"],
      ["CAM 2", "not-set-up", "NOT SET UP", "attention"],
      ["CAM 3", "not-set-up", "NOT SET UP", "attention"],
    ]);
    expect(shown.cameras.map((camera) => camera.sentence)).toEqual([
      "CAM 1 is not paired. Pair it in Setup, with the camera beside you.",
      "CAM 2 has no address. Enter it in Setup.",
      "CAM 3 has no address. Enter it in Setup.",
    ]);
    for (const camera of shown.cameras) {
      expect(camera.setup).toEqual({
        setUp: false,
        address: null,
        paired: false,
        vmixInput: camera.camera,
        vmixOutput: camera.camera + 1,
        noLink: null,
        pairing: null,
      });
      expect(camera.readAt).toBeNull();
      // Never read: no value, but the camera's model — its options — stays.
      expect(Object.values(camera.values).every((value) => value.value === null)).toBe(true);
      expect(camera.recording.recording).toBeNull();
      expect(camera.recording.timecode).toBeNull();
      expect(cameras.sent(camera.camera as 1 | 2 | 3), "a fresh start contacts nothing").toBe(0);
    }
    expect(shown.cameras[0]?.values.iso.options).toEqual(ISO_CAM1);

    // The Cameras lamp only: the whole status is the studio's own.
    const { status, summary, check } = await health();
    expect(check).toMatchObject({
      ok: false,
      status: "attention",
      word: "NOT SET UP",
      summary: "CAM 1 is not paired. Pair it in Setup, with the camera beside you.",
      recording: false,
    });
    expect(status).toBe("ok");
    expect(summary).not.toMatch(/Cameras:/);
  });
});

describe("the fixture double's cameras: what each reports (board 2)", () => {
  it("reads CAM 1, the Pocket 6K Pro, with every value D10 lists", async () => {
    const { camera } = openCamerasDouble(ALL_SET_UP);
    expect(await camera(1)).toEqual({
      camera: 1,
      tag: "CAM 1",
      model: "Blackmagic Pocket Cinema Camera 6K Pro",
      link: "bluetooth",
      setup: { setUp: true, address: null, paired: true, vmixInput: 1, vmixOutput: 2, noLink: null, pairing: null },
      state: "held",
      word: "HELD",
      tone: "ok",
      sentence: "CAM 1 is held: Studio Control reads it and sends only what you press.",
      readAt: AT(NOW),
      values: {
        iso: choice(ISO_CAM1, "400"),
        shutter: choice("45° 90° 120° 144° 172.8° 180° 216° 270° 360°".split(" "), "180°"),
        iris: choice(IRIS_F28, "f/2.8"),
        nd: choice(["Clear", "2 stops", "4 stops", "6 stops"], "2 stops"),
        whiteBalance: level(2500, 10000, 50, "K", 5600),
        tint: level(-50, 50, 1, "", 2),
        focus: level(0, 1, 0.01, "", 0.62),
        resolution: choice(["HD", "UHD", "4K DCI", "6K"], "6K"),
        frameRate: {
          ...choice(["24", "25", "30", "50", "60"], "25"),
          unavailable: [{ value: "60", reason: "not at 6K" }],
        },
        dynamicRange: choice(["Film", "Extended video", "Video"], "Film"),
        displayLut: choice(["None", "Custom", "Film → Video", "Film → Ext. video"], "Film → Ext. video"),
        displayLutOn: { reported: true, value: true, notReported: null },
      },
      auto: { focus: true, whiteBalance: true, iris: true },
      focusSteps: false,
      recording: {
        records: true,
        recording: false,
        timecode: "12:00:00:00",
        timecodeReported: true,
        startedAt: null,
        cardTimeLeft: null,
        cardTimeNotReported: "CAM 1 does not report its card time over Bluetooth.",
      },
      picture: { state: "showing", word: "LIVE", tone: "ok", detail: "test picture", sentence: null, advice: null },
    });
  });

  it("reads CAM 2 and CAM 3, the BGH1s, without tint, focus position, ND, dynamic range, display LUT or recording", async () => {
    const { camera } = openCamerasDouble(ALL_SET_UP);
    const bgh1Iso = [...ISO_CAM1, "32000", "40000", "51200"];
    const shutter =
      "1/25 1/30 1/40 1/50 1/60 1/80 1/100 1/120 1/125 1/160 1/200 1/250 1/320 1/400 1/500 1/640 1/800 1/1000".split(
        " "
      );
    expect(await camera(2)).toEqual({
      camera: 2,
      tag: "CAM 2",
      model: "Panasonic LUMIX BGH1",
      link: "network",
      setup: {
        setUp: true,
        address: CAM2_ADDRESS,
        paired: false,
        vmixInput: 2,
        vmixOutput: 3,
        noLink: null,
        pairing: null,
      },
      state: "held",
      word: "HELD",
      tone: "ok",
      sentence: "CAM 2 is held: Studio Control reads it and sends only what you press.",
      readAt: AT(NOW),
      values: {
        iso: choice(bgh1Iso, "800"),
        shutter: choice(shutter, "1/50"),
        iris: choice([...IRIS_F28.slice(3), "f/18", "f/20", "f/22"], "f/4.0"),
        nd: notReportedChoice("The BGH1 has no ND filter."),
        whiteBalance: level(2500, 10000, 100, "K", 5600),
        tint: notReportedLevel("CAM 2 does not report tint."),
        focus: notReportedLevel("CAM 2 does not report a focus position."),
        resolution: choice(["FHD", "UHD", "C4K"], "FHD"),
        frameRate: choice(["25", "50"], "25"),
        dynamicRange: notReportedChoice("CAM 2 does not report its dynamic range."),
        displayLut: notReportedChoice("CAM 2 does not report a display LUT."),
        displayLutOn: { reported: false, value: null, notReported: "CAM 2 does not report a display LUT." },
      },
      auto: { focus: true, whiteBalance: false, iris: false },
      focusSteps: true,
      recording: {
        records: false,
        recording: null,
        timecode: null,
        timecodeReported: false,
        startedAt: null,
        cardTimeLeft: null,
        cardTimeNotReported: null,
      },
      picture: { state: "showing", word: "LIVE", tone: "ok", detail: "test picture", sentence: null, advice: null },
    });
    const cam3 = await camera(3);
    expect(cam3.values.iso.value).toBe("1600");
    expect(cam3.values.iris).toEqual(choice(IRIS_F28, "f/2.8"));
    expect(cam3.values.whiteBalance.value).toBe(4300);
    expect(cam3.values.tint.notReported).toBe("CAM 3 does not report tint.");
    expect(cam3.values.dynamicRange.notReported).toBe("CAM 3 does not report its dynamic range.");
    expect(cam3.values.displayLut.notReported).toBe("CAM 3 does not report a display LUT.");
  });

  it("keeps each camera's model in one place: the three cameras' tags, models and links", () => {
    expect(Object.values(CAMERA_MODELS).map((model) => [model.tag, model.model, model.link, model.app])).toEqual([
      ["CAM 1", "Blackmagic Pocket Cinema Camera 6K Pro", "bluetooth", "the iPad"],
      ["CAM 2", "Panasonic LUMIX BGH1", "network", "LUMIX Tether"],
      ["CAM 3", "Panasonic LUMIX BGH1", "network", "LUMIX Tether"],
    ]);
  });

  it("lists 60p as not at 6K, and nothing unavailable at another resolution", async () => {
    const { call, camera } = openCamerasDouble(ALL_SET_UP);
    expect((await camera(1)).values.frameRate.unavailable).toEqual([{ value: "60", reason: "not at 6K" }]);
    await call("cameras.format.set", { camera: 1, resolution: "UHD", confirm: true });
    expect((await camera(1)).values.frameRate.unavailable).toEqual([]);
    await call("cameras.format.set", { camera: 1, frameRate: "60", confirm: true });
    expect((await camera(1)).values.frameRate.value).toBe("60");
  });

  it("reads a time-of-day timecode at 25 frames a second from the clock", async () => {
    const { camera } = openCamerasDouble(ALL_SET_UP);
    expect((await camera(1)).recording.timecode).toBe("12:00:00:00");
    vi.setSystemTime(NOW + 3_600_000 + 61_520);
    const cam1 = await camera(1);
    expect(cam1.recording.timecode).toBe("13:01:01:13");
    expect(cam1.readAt, "read again, sending nothing").toBe(AT(NOW + 3_600_000 + 61_520));
  });
});

describe("the fixture double's cameras: what a camera not read shows", () => {
  it("shows no value for a released camera, and keeps the last values and readAt of an unreachable one", async () => {
    const { call, camera, cameras } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.release", { camera: 1, confirm: true });
    const released = await camera(1);
    expect(released).toMatchObject({ state: "released", readAt: null, recording: { recording: null, timecode: null } });
    expect(Object.values(released.values).every((value) => value.value === null)).toBe(true);
    expect(released.values.iso.options).toEqual(ISO_CAM1);

    await call("cameras.set", { camera: 2, setting: "iso", value: "1250" });
    vi.setSystemTime(NOW + 5_000);
    cameras.stopAnswering(2);
    vi.setSystemTime(NOW + 60_000);
    const unreachable = await camera(2);
    expect(unreachable).toMatchObject({ state: "unreachable", word: "UNREACHABLE", tone: "error", readAt: AT(NOW) });
    expect(unreachable.values.iso.value, "the values it last reported, as doubt").toBe("1250");
    expect(unreachable.sentence).toBe(
      `CAM 2 does not answer at ${CAM2_ADDRESS}. Check that it is on and on the network.`
    );
  });

  it("says when the take started only when the hardware link saw it start", async () => {
    const recording = openCamerasDouble({ cameras: [{ camera: 1, paired: true, recording: true }] });
    expect((await recording.camera(1)).recording).toMatchObject({ recording: true, startedAt: null });

    const { call, camera, cameras } = openCamerasDouble(ALL_SET_UP);
    vi.setSystemTime(NOW + 1_000);
    await call("cameras.record.start");
    expect((await camera(1)).recording).toMatchObject({ recording: true, startedAt: AT(NOW + 1_000) });
    vi.setSystemTime(NOW + 9_000);
    expect((await camera(1)).recording.startedAt, "kept while the take runs").toBe(AT(NOW + 1_000));
    await call("cameras.record.stop", { confirm: true });
    expect((await camera(1)).recording).toMatchObject({ recording: false, startedAt: null });

    // Started on the camera's body while the hardware link reads it: seen when it noticed.
    vi.setSystemTime(NOW + 20_000);
    cameras.changeOnBody(1, { recording: true });
    expect((await camera(1)).recording.startedAt).toBe(AT(NOW + 20_000));

    // A take running when the camera answers again after an unreachable spell started before it looked.
    cameras.changeOnBody(1, { recording: false });
    cameras.stopAnswering(1);
    cameras.changeOnBody(1, { recording: true });
    cameras.answerAgain(1);
    expect((await camera(1)).recording).toMatchObject({ recording: true, startedAt: null });

    // So does one running before the spell and after it: the hardware link was not looking,
    // and the take may have stopped and started again in between.
    vi.setSystemTime(NOW + 30_000);
    cameras.changeOnBody(1, { recording: false });
    await camera(1);
    cameras.changeOnBody(1, { recording: true });
    expect((await camera(1)).recording.startedAt).toBe(AT(NOW + 30_000));
    cameras.stopAnswering(1);
    await camera(1);
    cameras.answerAgain(1);
    expect((await camera(1)).recording).toMatchObject({ recording: true, startedAt: null });
  });
});
