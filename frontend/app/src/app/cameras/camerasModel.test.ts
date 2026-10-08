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
  levelStepLock,
  levelText,
  linkLabel,
  pictureLock,
  pictureRows,
  picturesWord,
  pictureShows,
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
      meta: "3 of 3 held",
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
      sentence: "CAM 2 is released to LUMIX Tether. Connect it to control it here.",
      meta: "2 of 3 held",
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
    // When it last answered: the camera list says which are held.
    expect(view.meta).toBe("Last answer 09:11");
  });

  it("sends a camera that is not set up to Setup, and counts what is held", async () => {
    const { read } = openCameras({ cameras: [{ camera: 1, paired: true }] });
    expect(camerasStateView(await read())).toMatchObject({
      camera: 2,
      tone: "attention",
      word: "NOT SET UP",
      sentence: "CAM 2 has no address. Enter it in Setup.",
      meta: "1 of 3 held",
      wayOut: { kind: "setup", label: "Camera setup" },
    });
  });

  it("takes the selected camera among equals, then the lowest number", async () => {
    const { transport, read } = openCameras({ cameras: [] });
    expect(worstCamera(await read())?.camera).toBe(1);
    await transport.request("cameras.select", { camera: 3 });
    expect(worstCamera(await read())?.camera).toBe(3);
  });

  // The visual overhaul's polish (2026-10-05): the meta stands beside the way-out
  // key, which leaves it about 30 characters. CAM 1's take is the REC section's
  // and the header tally's, so the meta does not repeat it.
  it("leaves CAM 1's take to REC, and keeps the meta to 30 characters beside a way out", async () => {
    const recording = openCameras({
      cameras: [{ camera: 1, paired: true, recording: true }, ...ALL_SET_UP.cameras!.slice(1)],
    });
    expect(camerasStateView(await recording.read())?.meta).toBe("3 of 3 held");
    recording.hooks.stopAnswering(1);
    const lost = camerasStateView(await recording.read())!;
    expect(lost.meta).toBe("Last answer 09:11");

    const released = openCameras({
      cameras: [{ camera: 1, paired: true, released: true }, ...ALL_SET_UP.cameras!.slice(1)],
    });
    const handedOver = camerasStateView(await released.read())!;
    expect(handedOver.meta).toBe("2 of 3 held");

    const unset = camerasStateView(await openCameras({ cameras: [] }).read())!;
    expect(unset.meta).toBe("0 of 3 held");

    const picture = openCameras();
    await picture.transport.request("cameras.setup.update", { camera: 2, vmixInput: 7 });
    const missing = camerasStateView(await picture.read())!;

    for (const view of [lost, handedOver, unset, missing]) {
      expect(view.wayOut, view.word).not.toBeNull();
      expect(view.meta.length, `${view.word}: ${view.meta}`).toBeLessThanOrEqual(30);
    }
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
    // One line under the cap: when it was last known, and why STOP is locked.
    expect(recKeyView(await cam1())).toEqual({
      kind: "last-known",
      hint: "last known 09:11 · STOP is locked until CAM 1 answers",
      reason: "STOP is locked until CAM 1 answers. The take is left as it was.",
    });
  });

  it("is locked, with the reason, while CAM 1 is not held", async () => {
    const lost = await main(ALL_SET_UP);
    lost.hooks.stopAnswering(1);
    expect(recKeyView(await lost.cam1())).toEqual({
      kind: "locked",
      hint: "locked · CAM 1 does not answer",
      reason: "CAM 1 does not answer over Bluetooth. Check it is on and within reach.",
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
      {
        id: "length",
        label: "Take length",
        value: "12:41",
        note: "counted here since 09:11",
        doubt: false,
        explain: null,
      },
      { id: "timecode", label: "Timecode", value: "07:11:00:00", note: "", doubt: false, explain: null },
      // The hardware link's sentence is the row's tooltip; the row says it in two words.
      {
        id: "card",
        label: "Card time left",
        value: null,
        note: "not reported",
        doubt: false,
        explain: "CAM 1 does not report its card time over Bluetooth.",
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
      note: "not known",
      explain: "The take started before Studio Control looked, so its length is not known.",
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
      [null, "not reported"],
    ]);
    expect(recordingWord(cam1, false, NOW)).toBe("CAM 1 · not read while released");

    const unpaired = cameraOf(await openCameras({ cameras: [] }).read(), 1);
    expect(takeReadouts(unpaired, NOW)[0]).toMatchObject({ value: null, note: "CAM 1 is not set up" });
    expect(recordingWord(unpaired, false, NOW)).toBe("CAM 1 · not set up");
  });

  // The footer says it in the take row's word (the polish, 2026-10-05).
  it("says not recording while CAM 1 is held and does not record, in the take and the footer alike", async () => {
    const cam1 = cameraOf(await openCameras().read(), 1);
    expect(takeReadouts(cam1, NOW)[0]).toMatchObject({ value: null, note: "not recording" });
    expect(recordingWord(cam1, false, NOW)).toBe("CAM 1 · not recording");
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
        word: "HELD",
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
        word: "HELD",
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
        word: "HELD",
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

  // Finding 19 of the walk of 2026-10-07: a held camera whose link has
  // brought no setting since it connected shows what it last reported as
  // doubt, with the tag, until it reports.
  it("shows a held camera's last-read values as doubt, with the tag, until it reports", async () => {
    const { hooks, read } = openCameras({ cameras: [{ camera: 1, paired: true }] });
    hooks.changeOnBody(1, { recording: true });
    hooks.reportNothing(1);
    let snapshot = await read();
    expect(snapshot.cameras[0]!.valuesLastRead).toBe(true);
    // A take the kept reading says is running: last known on the key and the
    // REC key, the timecode as doubt; STOP stays live.
    expect(cameraKeyView(snapshot.cameras[0]!, snapshot.selected).rec).toBe("last-known");
    const rec = recKeyView(snapshot.cameras[0]!);
    expect(rec.kind).toBe("recording");
    expect(rec.hint).toMatch(/^last read/);
    expect(takeReadouts(snapshot.cameras[0]!, Date.now()).find((row) => row.id === "timecode")).toMatchObject({
      note: "last read",
      doubt: true,
    });
    expect(snapshot.cameras[0]!.sentence).toBe(
      "CAM 1 is held and has reported nothing since it connected: its values are the last read, until it does."
    );
    expect(cameraKeyView(snapshot.cameras[0]!, snapshot.selected)).toMatchObject({
      word: "HELD",
      values: "ISO 400 · 180° · f/2.8 · 5600 K",
      valuesKind: "doubt",
      valuesTag: "last read",
    });
    hooks.reportAgain(1);
    snapshot = await read();
    expect(snapshot.cameras[0]!.valuesLastRead).toBe(false);
    expect(cameraKeyView(snapshot.cameras[0]!, snapshot.selected)).toMatchObject({
      valuesKind: "values",
      valuesTag: null,
    });
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
      word: "UNREACHABLE",
      tone: "error",
      values: "ISO 400 · 180° · f/2.8 · 5600 K",
      valuesKind: "doubt",
      valuesTag: "last read",
      rec: "last-known",
      selected: false,
    });
    expect(cam2).toMatchObject({
      word: "RELEASED",
      values: "not read while released",
      valuesKind: "plain",
      valuesTag: null,
      selected: true,
    });
    expect(cam3).toMatchObject({
      word: "NOT SET UP",
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
});

describe("the pictures", () => {
  it("shows every test picture, alone in its row, and says where they come from", async () => {
    const { read } = openCameras();
    const snapshot = await read();
    expect(snapshot.cameras.every(pictureShows)).toBe(true);
    expect(pictureRows(snapshot)).toEqual([
      { camera: 1, tag: "CAM 1", detail: "test picture", word: "LIVE", tone: "ok" },
      { camera: 2, tag: "CAM 2", detail: "test picture", word: "LIVE", tone: "ok" },
      { camera: 3, tag: "CAM 3", detail: "test picture", word: "LIVE", tone: "ok" },
    ]);
    expect(picturesWord(snapshot)).toBe("test pictures · 3 of 3");
    expect(pictureLock(snapshot.cameras[0]!)).toBeNull();
    expect(camerasStateView(snapshot)?.word).toBe("HELD");
  });

  it("speaks of a missing picture while every camera is held, and the controls still work", async () => {
    const { transport, read } = openCameras();
    await transport.request("cameras.setup.update", { camera: 2, vmixInput: 7 });
    const snapshot = await read();
    expect(camerasStateView(snapshot)).toEqual({
      camera: 2,
      tone: "attention",
      word: "PICTURE MISSING",
      sentence: "vMix sends no picture for CAM 2. Check that vMix input 7 is still there and live.",
      meta: "Camera controls still work",
      wayOut: { kind: "look-again", label: "Look again" },
    });
    expect(pictureRows(snapshot)[1]).toEqual({
      camera: 2,
      tag: "CAM 2",
      detail: "nothing received",
      word: "NO PICTURE",
      tone: "attention",
    });
    expect(picturesWord(snapshot)).toBe("test pictures · 2 of 3 · CAM 2 missing");
    const cam2 = cameraOf(snapshot, 2)!;
    expect(pictureShows(cam2)).toBe(false);
    expect(pictureLock(cam2)).toBe("CAM 2 has no picture to show.");
    expect(controlsLock(cam2), "its controls are not the picture's").toBeNull();

    // A camera that is not held speaks first.
    await transport.request("cameras.release", { camera: 3, confirm: true });
    expect(camerasStateView(await read())?.word).toBe("RELEASED");
  });

  it("says NO PICTURES when none arrives, and a read tells two pictures apart", async () => {
    const { transport, read } = openCameras();
    const showing = await read();
    // Held cameras and no picture from vMix: the page is ready for it all the same.
    const none = {
      ...showing,
      pictures: {
        ...showing.pictures,
        state: "no-pictures" as const,
        word: "NO PICTURES",
        tone: "attention" as const,
        sentence: "No pictures from vMix. Open vMix and send Outputs 2, 3 and 4 over NDI.",
        source: "vMix Outputs 2 to 4",
      },
    };
    expect(camerasStateView(none)).toMatchObject({ camera: 1, word: "NO PICTURES", tone: "attention" });
    expect(picturesWord(none)).toBe("none · vMix Outputs 2 to 4");

    const before = camerasFingerprint(showing);
    await transport.request("cameras.setup.update", { camera: 3, vmixInput: 9 });
    expect(camerasFingerprint(await read())).not.toBe(before);
  });

  it("reads the studio's build with vMix sending nothing, without the simulated cameras", async () => {
    const { read } = openCameras({ simulated: false });
    const snapshot = await read();
    expect(snapshot.cameras.some(pictureShows)).toBe(false);
    expect(pictureRows(snapshot)[0]).toMatchObject({ detail: "vMix Output 2 · nothing received", word: "NO PICTURE" });
    expect(picturesWord(snapshot)).toBe("none · vMix Outputs 2 to 4");
    expect(camerasStateView(snapshot)?.word, "the cameras speak first").toBe("NOT SET UP");
  });
});
