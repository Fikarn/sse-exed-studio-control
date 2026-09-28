import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cameraKeyView,
  cameraOf,
  camerasFingerprint,
  camerasStateView,
  choiceStepLock,
  clockTime,
  colourRows,
  controlsLock,
  DIAL_BANKS,
  dialsView,
  exposureRows,
  formatTakeLength,
  heldWord,
  levelStepLock,
  levelText,
  linkLabel,
  recentRows,
  recKeyView,
  recordingWord,
  sectionDetail,
  selectedCamera,
  shutterUnit,
  takeReadouts,
  unavailableReason,
  valuesLine,
  worstCamera,
} from "./camerasModel";
import { ALL_SET_UP, openCameras } from "./camerasTestData";

// The Cameras page's model: what the page shows, read from what the hardware
// link reports. The cameras are the test double's, so each case stands on the
// words and figures the page is given.

// 09:11 in the studio (the page tests' clock), so the times read as they will there.
const NOW = Date.parse("2026-04-23T09:11:00+02:00");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubEnv("TZ", "Europe/Stockholm");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the state display", () => {
  it("speaks of the selected camera while every camera is held", async () => {
    const { transport, read } = openCameras();
    const held = camerasStateView(await read())!;
    expect(held).toMatchObject({
      camera: 1,
      tone: "ok",
      word: "HELD",
      sentence: "CAM 1 is held: Studio Control reads it and sends only what you press.",
      meta: "3 of 3 held · CAM 1 not recording",
      wayOut: null,
    });
    await transport.request("cameras.select", { camera: 3 });
    expect(camerasStateView(await read())).toMatchObject({
      camera: 3,
      sentence: "CAM 3 is held: Studio Control reads it and sends only what you press.",
    });
  });

  it("speaks of the worst camera, whichever is selected, with its way out", async () => {
    const released = openCameras({
      ...ALL_SET_UP,
      cameras: [
        ...ALL_SET_UP.cameras!.slice(0, 1),
        { camera: 2, address: "172.16.16.85", released: true },
        ALL_SET_UP.cameras![2]!,
      ],
    });
    expect(camerasStateView(await released.read())).toMatchObject({
      camera: 2,
      tone: "attention",
      word: "RELEASED",
      sentence:
        "CAM 2 is released to LUMIX Tether. Studio Control does not read it or send it anything until you connect it again.",
      meta: "2 of 3 held · CAM 1 not recording",
      wayOut: { kind: "connect", camera: 2, label: "Connect CAM 2" },
    });

    const lost = openCameras();
    lost.hooks.stopAnswering(3);
    const view = camerasStateView(await lost.read())!;
    expect(view).toMatchObject({
      camera: 3,
      tone: "error",
      word: "UNREACHABLE",
      sentence: "CAM 3 does not answer at 172.16.16.30. Check that it is on and on the network.",
      wayOut: { kind: "read-again", camera: 3, label: "Try CAM 3 again" },
    });
    expect(view.meta).toBe("Last answer 09:11 · 2 of 3 held · CAM 1 not recording");
  });

  it("sends a camera that is not set up to Setup, and counts what is held", async () => {
    const { read } = openCameras({ cameras: [{ camera: 1, paired: true }] });
    expect(camerasStateView(await read())).toMatchObject({
      camera: 2,
      tone: "attention",
      word: "NOT SET UP",
      sentence: "CAM 2 has no address. Enter it in Setup.",
      meta: "1 of 3 held · CAM 1 not recording",
      wayOut: { kind: "setup", label: "Camera setup" },
    });
  });

  it("takes the selected camera among equals, then the lowest number", async () => {
    const { transport, read } = openCameras({ cameras: [] });
    expect(worstCamera(await read())?.camera).toBe(1);
    await transport.request("cameras.select", { camera: 3 });
    expect(worstCamera(await read())?.camera).toBe(3);
  });

  it("says what CAM 1's take is known to do", async () => {
    const recording = openCameras({
      cameras: [{ camera: 1, paired: true, recording: true }, ...ALL_SET_UP.cameras!.slice(1)],
    });
    expect(camerasStateView(await recording.read())?.meta).toBe("3 of 3 held · CAM 1 recording");
    recording.hooks.stopAnswering(1);
    expect(camerasStateView(await recording.read())?.meta).toBe(
      "Last answer 09:11 · 2 of 3 held · CAM 1 last known recording"
    );

    const released = openCameras({
      cameras: [{ camera: 1, paired: true, released: true }, ...ALL_SET_UP.cameras!.slice(1)],
    });
    expect(camerasStateView(await released.read())?.meta).toBe("2 of 3 held · CAM 1 not read");
  });
});

describe("the REC key", () => {
  const main = async (seed: Parameters<typeof openCameras>[0]) => {
    const cameras = openCameras(seed);
    return { ...cameras, cam1: async () => cameraOf(await cameras.read(), 1) };
  };

  it("starts with one press, and stops with two while CAM 1 reports recording", async () => {
    const { transport, cam1 } = await main(ALL_SET_UP);
    expect(recKeyView(await cam1())).toEqual({ kind: "start", hint: "CAM 1 · one press starts" });
    await transport.request("cameras.record.start");
    expect(recKeyView(await cam1())).toEqual({
      kind: "recording",
      hint: "CAM 1 reports recording · press twice to stop",
    });
  });

  it("shows the last report as doubt when CAM 1 stops answering mid-take, and locks STOP", async () => {
    const { transport, hooks, cam1 } = await main(ALL_SET_UP);
    await transport.request("cameras.record.start");
    hooks.stopAnswering(1);
    expect(recKeyView(await cam1())).toEqual({
      kind: "last-known",
      hint: "last known: recording · 09:11",
      reason: "STOP is locked until CAM 1 answers. The take is left as it was.",
    });
  });

  it("is locked, with the reason, while CAM 1 is not held", async () => {
    const lost = await main(ALL_SET_UP);
    lost.hooks.stopAnswering(1);
    expect(recKeyView(await lost.cam1())).toEqual({
      kind: "locked",
      hint: "locked · CAM 1 does not answer",
      reason: "CAM 1 does not answer over Bluetooth. Check that it is on and within reach of this PC.",
    });

    const released = await main({ cameras: [{ camera: 1, paired: true, released: true }] });
    expect(recKeyView(await released.cam1())).toMatchObject({
      kind: "locked",
      hint: "locked · CAM 1 is released to the iPad",
    });

    const unpaired = await main({ cameras: [] });
    expect(recKeyView(await unpaired.cam1())).toEqual({
      kind: "locked",
      hint: "locked · CAM 1 is not set up",
      reason: "CAM 1 is not paired. Pair it in Setup, with the camera beside you.",
    });
    expect(recKeyView(null).kind).toBe("locked");
  });
});

describe("what is known about the take", () => {
  it("counts the take from the start it saw, and says that it is its own count", async () => {
    const { transport, read } = openCameras();
    await transport.request("cameras.record.start");
    const cam1 = cameraOf(await read(), 1);
    const later = NOW + (12 * 60 + 41) * 1000;
    expect(takeReadouts(cam1, later)).toEqual([
      { id: "length", label: "Take length", value: "12:41", note: "counted here since 09:11", doubt: false },
      { id: "timecode", label: "Timecode", value: "07:11:00:00", note: "", doubt: false },
      {
        id: "card",
        label: "Card time left",
        value: null,
        note: "CAM 1 does not report its card time over Bluetooth.",
        doubt: false,
      },
    ]);
    expect(recordingWord(cam1, false, later)).toBe("CAM 1 · recording · 12:41 counted here");
    expect(recordingWord(cam1, true, later)).toBe("CAM 1 · recording · stop armed");
  });

  it("does not know the length of a take that ran before it looked", async () => {
    const { read } = openCameras({ cameras: [{ camera: 1, paired: true, recording: true }] });
    const cam1 = cameraOf(await read(), 1);
    expect(takeReadouts(cam1, NOW)[0]).toMatchObject({
      value: null,
      note: "not known · started before Studio Control looked",
    });
    expect(recordingWord(cam1, false, NOW)).toBe("CAM 1 · recording · length not known");
  });

  it("keeps the timecode as last read, as doubt, when CAM 1 stops answering", async () => {
    const { transport, hooks, read } = openCameras();
    await transport.request("cameras.record.start");
    hooks.stopAnswering(1);
    const cam1 = cameraOf(await read(), 1);
    const [length, timecode] = takeReadouts(cam1, NOW + 60_000);
    expect(length).toMatchObject({ value: null, note: "not counted · CAM 1 does not answer" });
    expect(timecode).toMatchObject({ value: "07:11:00:00", note: "last read", doubt: true });
    expect(recordingWord(cam1, false, NOW)).toBe("CAM 1 · last known recording at 09:11");
  });

  it("reads nothing while CAM 1 is released or not set up, and says which", async () => {
    const released = openCameras({ cameras: [{ camera: 1, paired: true, released: true }] });
    const cam1 = cameraOf(await released.read(), 1);
    expect(takeReadouts(cam1, NOW).map((row) => [row.value, row.note])).toEqual([
      [null, "not read while released"],
      [null, "not read while released"],
      [null, "CAM 1 does not report its card time over Bluetooth."],
    ]);
    expect(recordingWord(cam1, false, NOW)).toBe("CAM 1 · not read while released");

    const unpaired = cameraOf(await openCameras({ cameras: [] }).read(), 1);
    expect(takeReadouts(unpaired, NOW)[0]).toMatchObject({ value: null, note: "CAM 1 is not set up" });
    expect(recordingWord(unpaired, false, NOW)).toBe("CAM 1 · not set up");
  });

  it("says stopped while CAM 1 is held and does not record", async () => {
    const cam1 = cameraOf(await openCameras().read(), 1);
    expect(takeReadouts(cam1, NOW)[0]).toMatchObject({ value: null, note: "not recording" });
    expect(recordingWord(cam1, false, NOW)).toBe("CAM 1 · stopped");
  });

  it("prints lengths whole, minutes unpadded below the hour", () => {
    expect(formatTakeLength(0)).toBe("0:00");
    expect(formatTakeLength(37.9)).toBe("0:37");
    expect(formatTakeLength(761)).toBe("12:41");
    expect(formatTakeLength(3725)).toBe("1:02:05");
    expect(formatTakeLength(-4)).toBe("0:00");
  });
});

describe("the three cameras' keys", () => {
  it("prints what each camera reports, in its own words", async () => {
    const snapshot = await openCameras().read();
    expect(snapshot.cameras.map((camera) => cameraKeyView(camera, snapshot.selected))).toEqual([
      {
        camera: 1,
        tag: "CAM 1",
        meta: "Blackmagic Pocket Cinema Camera 6K Pro · Bluetooth",
        state: "held",
        word: "held",
        tone: "ok",
        values: "ISO 400 · 180° · f/2.8 · 5600 K",
        valuesKind: "values",
        valuesTag: null,
        rec: null,
        selected: true,
      },
      {
        camera: 2,
        tag: "CAM 2",
        meta: "Panasonic LUMIX BGH1 · network · 172.16.16.85",
        state: "held",
        word: "held",
        tone: "ok",
        values: "ISO 800 · 1/50 · f/4.0 · 5600 K",
        valuesKind: "values",
        valuesTag: null,
        rec: null,
        selected: false,
      },
      {
        camera: 3,
        tag: "CAM 3",
        meta: "Panasonic LUMIX BGH1 · network · 172.16.16.30",
        state: "held",
        word: "held",
        tone: "ok",
        values: "ISO 1600 · 1/50 · f/2.8 · 4300 K",
        valuesKind: "values",
        valuesTag: null,
        rec: null,
        selected: false,
      },
    ]);
  });

  // The key prints the line whole, with `last read` at its end when the camera
  // does not answer. The page test "no line is cut" measures the key with a
  // line of 36 characters: a longer value in a camera's lists is a key to
  // measure again, not a line to cut.
  it("has room for the longest line a camera reports", async () => {
    const snapshot = await openCameras().read();
    const longest = (options: string[]) => options.reduce((a, b) => (b.length > a.length ? b : a), "");
    for (const camera of snapshot.cameras) {
      const { iso, shutter, iris, whiteBalance } = camera.values;
      const line = [
        `ISO ${longest(iso.options)}`,
        longest(shutter.options),
        longest(iris.options),
        `${whiteBalance.max} ${whiteBalance.unit}`,
      ].join(" · ");
      expect(line.length, `${camera.tag}: ${line}`).toBeLessThanOrEqual(36);
    }
  });

  it("shows an unreachable camera's last values as doubt, and none for one not read", async () => {
    const { transport, hooks, read } = openCameras({
      cameras: [
        { camera: 1, paired: true, recording: true },
        { camera: 2, address: "172.16.16.85", released: true },
      ],
    });
    hooks.stopAnswering(1);
    await transport.request("cameras.select", { camera: 2 });
    const snapshot = await read();
    const [cam1, cam2, cam3] = snapshot.cameras.map((camera) => cameraKeyView(camera, snapshot.selected));
    expect(cam1).toMatchObject({
      word: "unreachable",
      tone: "error",
      values: "ISO 400 · 180° · f/2.8 · 5600 K",
      valuesKind: "doubt",
      valuesTag: "last read",
      rec: "last-known",
      selected: false,
    });
    expect(cam2).toMatchObject({
      word: "released",
      values: "not read while released",
      valuesKind: "plain",
      valuesTag: null,
      selected: true,
    });
    expect(cam3).toMatchObject({
      word: "not set up",
      meta: "Panasonic LUMIX BGH1 · network",
      values: "no address",
      valuesKind: "plain",
    });
    expect(valuesLine(snapshot.cameras[1]!)).toBe("");
    expect(linkLabel(snapshot.cameras[0]!)).toBe("Bluetooth");
  });

  it("marks CAM 1 while it reports recording", async () => {
    const { transport, read } = openCameras();
    await transport.request("cameras.record.start");
    const snapshot = await read();
    expect(cameraKeyView(snapshot.cameras[0]!, 1).rec).toBe("recording");
    expect(cameraKeyView(snapshot.cameras[1]!, 1).rec).toBeNull();
  });

  it("takes CAM 1 as selected when the selection names no camera", async () => {
    const snapshot = await openCameras().read();
    expect(selectedCamera({ ...snapshot, selected: 9 })?.camera).toBe(1);
    expect(selectedCamera({ ...snapshot, cameras: [] })).toBeNull();
  });
});

describe("the plate", () => {
  it("lists the exposure and the colour in the camera's own words, or why not", async () => {
    const snapshot = await openCameras().read();
    const [cam1, cam2] = snapshot.cameras;
    expect(exposureRows(cam1!).map((row) => [row.label, row.choice.value])).toEqual([
      ["ISO", "400"],
      ["Shutter", "180°"],
      ["Iris", "f/2.8"],
      ["ND", "2 stops"],
    ]);
    expect(exposureRows(cam2!)[3]!.choice).toMatchObject({
      reported: false,
      notReported: "The BGH1 has no ND filter.",
    });
    expect(colourRows(cam1!).map((row) => levelText(row.level, row.setting === "tint"))).toEqual(["5600 K", "+2"]);
    expect(colourRows(cam2!)[1]!.level).toMatchObject({ reported: false, notReported: "CAM 2 does not report tint." });
    expect(levelText({ ...cam1!.values.tint, value: 2 }, true)).toBe("+2");
    expect(levelText({ ...cam1!.values.tint, value: -10 }, true)).toBe("-10");
    expect(levelText({ ...cam1!.values.tint, value: null }, true)).toBe("—");
    expect(shutterUnit("180°")).toBe("angle");
    expect(shutterUnit("1/50")).toBe("speed");
    expect(shutterUnit(null)).toBeNull();
  });

  it("locks a step at the ends of the camera's own values, and says why", async () => {
    const cam1 = (await openCameras({ cameras: [{ camera: 1, paired: true, values: { iso: "100" } }] }).read())
      .cameras[0]!;
    expect(choiceStepLock(cam1.values.iso, "CAM 1", "ISO", -1)).toBe("ISO is at the lowest value CAM 1 allows.");
    expect(choiceStepLock(cam1.values.iso, "CAM 1", "ISO", 1)).toBeNull();
    const top = { ...cam1.values.iso, value: cam1.values.iso.options.at(-1)! };
    expect(choiceStepLock(top, "CAM 1", "ISO", 1)).toBe("ISO is at the highest value CAM 1 allows.");
    const balance = cam1.values.whiteBalance;
    expect(levelStepLock({ ...balance, value: balance.min }, "CAM 1", "White balance", -1)).toBe(
      "White balance is at the lowest value CAM 1 allows."
    );
    expect(levelStepLock({ ...balance, value: balance.max }, "CAM 1", "White balance", 1)).toBe(
      "White balance is at the highest value CAM 1 allows."
    );
    expect(levelStepLock(balance, "CAM 1", "White balance", 1)).toBeNull();
  });

  it("says why a frame rate cannot be chosen at this resolution", async () => {
    const cam1 = (await openCameras().read()).cameras[0]!;
    expect(cam1.values.resolution.value).toBe("6K");
    expect(unavailableReason(cam1.values.frameRate, "60")).toBe("not at 6K");
    expect(unavailableReason(cam1.values.frameRate, "50")).toBeNull();
  });

  it("locks the controls of a camera that is not held, in its own sentence", async () => {
    const { hooks, read } = openCameras({
      cameras: [
        { camera: 1, paired: true },
        { camera: 2, address: "172.16.16.85", released: true },
        { camera: 3, address: "172.16.16.30" },
      ],
    });
    hooks.stopAnswering(3);
    const [cam1, cam2, cam3] = (await read()).cameras;
    expect(controlsLock(cam1!)).toBeNull();
    expect(controlsLock(cam2!)).toBe(cam2!.sentence);
    expect(sectionDetail(cam1!, "one press")).toBe("one press");
    expect(sectionDetail(cam2!, "one press")).toBe("not read while released");
    expect(sectionDetail(cam3!, "one press")).toBe("locked · last read 09:11");
    const never = (await openCameras({ cameras: [] }).read()).cameras[0]!;
    expect(sectionDetail(never, "one press")).toBe("not set up");
  });
});

describe("what the Stream Deck's dials set", () => {
  it("says what the bank's dials set on the selected camera, in the hardware link's own list", async () => {
    const { transport, read } = openCameras();
    expect(dialsView(await read())).toEqual({
      bank: "exposure",
      bankWord: "Exposure",
      hint: "The dials drive CAM 1: ISO · shutter · iris · ND.",
      live: true,
      footer: "CAM 1 · Exposure",
    });

    await transport.request("cameras.bank.set", { bank: "colour" });
    await transport.request("cameras.select", { camera: 2 });
    expect(dialsView(await read())).toMatchObject({
      bank: "colour",
      hint: "The dials drive CAM 2: white balance · tint.",
      footer: "CAM 2 · Colour",
    });

    await transport.request("cameras.bank.set", { bank: "focus" });
    expect(dialsView(await read())).toMatchObject({
      bank: "focus",
      hint: "The dials drive CAM 2: focus · a push is autofocus once.",
      footer: "CAM 2 · Focus",
    });
  });

  it("has a key for every bank the hardware link knows, in the deck's order", () => {
    expect(DIAL_BANKS.map((entry) => [entry.bank, entry.label])).toEqual([
      ["exposure", "Exposure"],
      ["colour", "Colour"],
      ["focus", "Focus"],
    ]);
  });

  it("says why the dials set nothing on a camera that is not held, and what brings them back", async () => {
    const { transport, hooks, read } = openCameras();
    await transport.request("cameras.select", { camera: 2 });
    await transport.request("cameras.release", { camera: 2, confirm: true });
    expect(dialsView(await read())).toMatchObject({
      hint: "CAM 2 is released: the dials set nothing until you press Connect.",
      live: false,
      footer: "CAM 2 · Exposure",
    });

    await transport.request("cameras.select", { camera: 3 });
    hooks.stopAnswering(3);
    expect(dialsView(await read())).toMatchObject({
      hint: "CAM 3 does not answer: the dials set nothing until it does.",
      live: false,
    });

    const bare = openCameras({ cameras: [] });
    expect(dialsView(await bare.read())).toMatchObject({
      hint: "CAM 1 is not set up: the dials set nothing until it is.",
      live: false,
    });
  });

  it("prints a setting it has no word for as the hardware link names it", async () => {
    const snapshot = await openCameras().read();
    expect(dialsView({ ...snapshot, dials: { bank: "exposure", sets: ["gain", null, null, null] } })?.hint).toBe(
      "The dials drive CAM 1: gain."
    );
    expect(dialsView({ ...snapshot, dials: { bank: "exposure", sets: [null, null, null, null] } })?.hint).toBe(
      "The dials set nothing on CAM 1."
    );
  });
});

describe("the Recent list and the footer", () => {
  it("prints the rows as they were written, with who did it", () => {
    expect(
      recentRows([
        {
          id: 7,
          at: "2026-04-23T07:10:00.000Z",
          source: "ui",
          action: "released",
          target: "CAM 2",
          detail: "CAM 2 released to LUMIX Tether.",
        },
        {
          id: 6,
          at: "2026-04-23T07:08:30.000Z",
          source: "deck",
          action: "recording-started",
          target: "CAM 1",
          detail: "CAM 1 started recording.",
        },
        { id: 5, at: "not a time", source: "body", action: "x", target: "CAM 1", detail: "Something else." },
      ])
    ).toEqual([
      { id: 7, time: "09:10", text: "CAM 2 released to LUMIX Tether.", source: "Screen" },
      { id: 6, time: "09:08", text: "CAM 1 started recording.", source: "Stream Deck" },
      { id: 5, time: "", text: "Something else.", source: "body" },
    ]);
    expect(clockTime(null)).toBe("");
  });

  it("knows two reads apart only by what a camera changed, not by the time of the read", async () => {
    const { transport, hooks, read } = openCameras();
    await transport.request("cameras.record.start");
    const first = camerasFingerprint(await read());
    vi.setSystemTime(NOW + 5000);
    expect(camerasFingerprint(await read())).toBe(first);
    hooks.changeOnBody(2, { iso: "1600" });
    const changed = camerasFingerprint(await read());
    expect(changed).not.toBe(first);
    hooks.stopAnswering(3);
    expect(camerasFingerprint(await read())).not.toBe(changed);
    expect(camerasFingerprint(null)).toBe("");
  });

  it("counts the held cameras and names the first that is not", async () => {
    const { hooks, read } = openCameras();
    expect(heldWord(await read())).toBe("3 / 3 held");
    hooks.stopAnswering(3);
    expect(heldWord(await read())).toBe("2 / 3 held · CAM 3 unreachable");
  });
});
