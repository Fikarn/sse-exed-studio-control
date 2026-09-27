import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";
import { simulatedCameras } from "./camerasRequests";
import { ALL_SET_UP, CAM2_ADDRESS, CAM3_ADDRESS, openCamerasDouble } from "./camerasTestSupport";
import { withCamerasStatus } from "./state";

// The Cameras lamp in the fixture double (new pages program, Slice 8), held to the hardware
// link's (`native/rust-engine/src/cameras/report.rs`, `runtime.rs` and `health.rs`):
// `checks.cameras` is the worst camera's state and sentence and whether CAM 1 records; a
// held camera that does not answer takes the whole status to attention at most and ends
// the summary with ` Cameras: ` and its sentence, while a camera not set up or released
// lights the lamp only; `app.changed { reason: "health" }` follows `cameras.changed` when
// the check changed. What the simulated cameras do themselves — a value changed on the
// body, a camera that stops answering or answers again — is noticed as the link notices
// it, whoever is first.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const CAM2_UNREACHABLE = `CAM 2 does not answer at ${CAM2_ADDRESS}. Check that it is on and on the network.`;
const CAM3_UNREACHABLE = `CAM 3 does not answer at ${CAM3_ADDRESS}. Check that it is on and on the network.`;

describe("the fixture double's Cameras lamp: the check", () => {
  it("reads every camera, and takes the worst one's state and sentence, the lowest number among equals", async () => {
    const { call, health } = openCamerasDouble(ALL_SET_UP);
    const { check } = await health();
    expect(check).toEqual({
      ok: true,
      status: "ok",
      word: "HELD",
      summary: "CAM 1 is held: Studio Control reads it and sends only what you press.",
      recording: false,
      cameras: [1, 2, 3].map((camera) => ({
        camera,
        tag: `CAM ${camera}`,
        state: "held",
        word: "HELD",
        tone: "ok",
        sentence: `CAM ${camera} is held: Studio Control reads it and sends only what you press.`,
      })),
    });

    await call("cameras.release", { camera: 3, confirm: true });
    expect((await health()).check).toMatchObject({ ok: false, status: "attention", word: "RELEASED" });
    await call("cameras.setup.forget", { camera: 2 });
    // NOT SET UP comes after RELEASED in `CameraState`'s order.
    expect((await health()).check).toMatchObject({
      status: "attention",
      word: "NOT SET UP",
      summary: "CAM 2 has no address. Enter it in Setup.",
    });
    await call("cameras.release", { camera: 1, confirm: true });
    await call("cameras.setup.forget", { camera: 1 });
    expect((await health()).check.summary, "among equals, the lowest number").toBe(
      "CAM 1 is not paired. Pair it in Setup, with the camera beside you."
    );
  });

  it("says whether CAM 1 records, as it reports it", async () => {
    const { call, health } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.record.start");
    expect((await health()).check.recording).toBe(true);
    await call("cameras.record.stop", { confirm: true });
    expect((await health()).check.recording).toBe(false);
  });

  it("raises the whole status no further than attention, and never lowers it", () => {
    expect(withCamerasStatus("ok", "ok")).toBe("ok");
    expect(withCamerasStatus("ok", "attention")).toBe("attention");
    expect(withCamerasStatus("warning", "attention")).toBe("attention");
    expect(withCamerasStatus("attention", "attention")).toBe("attention");
    expect(withCamerasStatus("error", "attention")).toBe("error");
    expect(withCamerasStatus("error", "ok")).toBe("error");
    expect(withCamerasStatus("warning", "ok")).toBe("warning");
  });
});

describe("the fixture double's Cameras lamp: the whole status", () => {
  it("counts a held camera that does not answer, and says which in the summary", async () => {
    const { health, cameras } = openCamerasDouble(ALL_SET_UP);
    const ready = await health();
    expect(ready.status).toBe("ok");
    const before = ready.summary;

    cameras.stopAnswering(3);
    cameras.stopAnswering(2);
    const { status, summary, check } = await health();
    expect(check).toMatchObject({ ok: false, status: "error", word: "UNREACHABLE", summary: CAM2_UNREACHABLE });
    expect(status, "no further than attention").toBe("attention");
    expect(summary).toBe(`${before} Cameras: ${CAM2_UNREACHABLE}`);

    cameras.answerAgain(2);
    expect((await health()).summary).toBe(`${before} Cameras: ${CAM3_UNREACHABLE}`);
    cameras.answerAgain(3);
    expect(await health()).toMatchObject({ status: "ok", summary: before });
  });

  it("lights the lamp only for a camera not set up or released", async () => {
    const { call, health } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.release", { camera: 1, confirm: true });
    await call("cameras.setup.forget", { camera: 2 });
    const { status, summary, check } = await health();
    expect(check.status).toBe("attention");
    expect(status).toBe("ok");
    expect(summary).not.toMatch(/Cameras:/);
  });

  it("counts a set-up camera with no link yet, as the live app has until Slices 11 and 13", async () => {
    const { health } = openCamerasDouble({ simulated: false, cameras: [{ camera: 1, paired: true }] });
    const { status, summary } = await health();
    expect(status).toBe("attention");
    expect(summary).toMatch(/ Cameras: Studio Control has no link to CAM 1 yet: it comes with a later version\.$/);
  });

  it("ends the summary with the Prompter XL's sentence, then the cameras'", async () => {
    const scenario = { ...getFixtureScenario("setup-ready"), prompterScreen: { found: false }, cameras: ALL_SET_UP };
    const transport = createFixtureTransport(scenario);
    simulatedCameras(transport).stopAnswering(2);
    const health = (await transport.request("health.snapshot", {})) as JsonObject;
    expect(health.status).toBe("attention");
    // Plain text, not a pattern built from the sentence: the Prompter XL's part first, the cameras' last.
    const summary = String(health.summary);
    const prompter = summary.indexOf(" Prompter: Windows does not see the Prompter XL.");
    expect(prompter).toBeGreaterThanOrEqual(0);
    expect(summary.endsWith(` Cameras: ${CAM2_UNREACHABLE}`)).toBe(true);
    expect(summary.lastIndexOf(" Cameras: ")).toBeGreaterThan(prompter);
  });

  it("leaves a whole status that was already attention as it was, and keeps the check through a sync", async () => {
    const { call, health, cameras } = openCamerasDouble(ALL_SET_UP, "setup-degraded");
    expect((await health()).status).toBe("attention");
    cameras.stopAnswering(1);
    expect(await health()).toMatchObject({ status: "attention", check: { word: "UNREACHABLE" } });
    // Another request syncs the double; the cameras' check and summary are worked out again, not lost.
    await call("settings.update", { setup: { activeSection: "support" } });
    const after = await health();
    expect(after.check.word).toBe("UNREACHABLE");
    expect(after.summary).toMatch(/ Cameras: CAM 1 does not answer over Bluetooth\./);
  });
});

describe("the fixture double's cameras: what the link notices", () => {
  it("says a held camera stopped answering and answers again, with the health after it", async () => {
    const { seen, cameras, camera } = openCamerasDouble(ALL_SET_UP);
    seen();
    cameras.stopAnswering(2);
    expect(seen()).toEqual([
      ["cameras.changed", "unreachable", 2],
      ["app.changed", "health"],
    ]);
    cameras.stopAnswering(2);
    expect(seen(), "said once").toEqual([]);
    cameras.answerAgain(2);
    expect(seen()).toEqual([
      ["cameras.changed", "reachable", 2],
      ["app.changed", "health"],
    ]);
    expect((await camera(2)).state).toBe("held");
  });

  it("lets the camera win: a value changed on its body comes back as reported, and nothing when nothing changed", async () => {
    const { seen, cameras, camera, call } = openCamerasDouble(ALL_SET_UP);
    seen();
    cameras.changeOnBody(1, { iso: "1600", whiteBalance: 3200 });
    expect(seen(), "the check says nothing else").toEqual([["cameras.changed", "reported", 1]]);
    expect((await camera(1)).values.iso.value).toBe("1600");
    expect((await camera(1)).values.whiteBalance.value).toBe(3200);
    cameras.changeOnBody(1, { iso: "1600" });
    vi.setSystemTime(NOW + 5_000);
    await call("cameras.snapshot");
    expect(seen(), "the same values, and a timecode that moved, are no change").toEqual([]);

    cameras.changeOnBody(1, { recording: true });
    expect(seen(), "a take started from the iPad moves the lamp").toEqual([
      ["cameras.changed", "reported", 1],
      ["app.changed", "health"],
    ]);
  });

  it("does not see what a released or unanswering camera does until it reads it again", async () => {
    const { seen, cameras, camera, call } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.release", { camera: 2, confirm: true });
    seen();
    cameras.changeOnBody(2, { iso: "3200" });
    cameras.stopAnswering(2);
    cameras.answerAgain(2);
    expect(seen()).toEqual([]);
    await call("cameras.connect", { camera: 2 });
    expect((await camera(2)).values.iso.value).toBe("3200");
  });

  it("leaves a recording CAM 1 that stops answering recording, as doubt", async () => {
    const { call, camera, cameras, health } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.record.start");
    cameras.stopAnswering(1);
    expect((await camera(1)).recording.recording).toBe(true);
    expect((await health()).check.recording).toBe(true);
  });

  it("refuses a body value the camera would not report, as the test's own mistake", () => {
    const { cameras } = openCamerasDouble(ALL_SET_UP);
    expect(() => cameras.changeOnBody(2, { nd: "Clear" })).toThrow(
      "CAM 2's values: nd is not reported: The BGH1 has no ND filter."
    );
    expect(() => cameras.changeOnBody(2, { recording: true })).toThrow("CAM 2 does not record here.");
    expect(() => simulatedCameras({ request: async () => null, subscribe: () => () => {} })).toThrow(
      "simulatedCameras needs a transport made by createFixtureTransport"
    );
  });
});

describe("the fixture double's cameras: the backup (format 7)", () => {
  it("restores the addresses and vMix inputs, keeps this PC's pairing, sends nothing and says so", async () => {
    const { call, seen, camera, cameras } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.setup.update", { camera: 2, vmixInput: 12 });
    const path = (await call("support.backup.export")).path as string;
    await call("cameras.setup.update", { camera: 2, address: "127.0.0.20", vmixInput: 5 });
    await call("cameras.setup.forget", { camera: 3 });
    await call("cameras.setup.forget", { camera: 1 });
    await call("cameras.release", { camera: 2, confirm: true });
    seen();

    await call("support.backup.restore", { path });
    expect(seen().filter(([event]) => event !== "support.changed" && event !== "commissioning.changed")).toEqual([
      ["app.changed", "backup-restored"],
      ["prompter.changed", "backup-restored"],
      ["cameras.changed", "restore", null],
      ["app.changed", "health"],
    ]);
    expect((await camera(1)).setup, "the pairing is this PC's own").toEqual({
      setUp: false,
      address: null,
      paired: false,
      vmixInput: 1,
    });
    expect(await camera(2)).toMatchObject({ state: "held", setup: { address: CAM2_ADDRESS, vmixInput: 12 } });
    expect(await camera(3)).toMatchObject({ state: "held", setup: { address: CAM3_ADDRESS, vmixInput: 3 } });
    expect([cameras.sent(1), cameras.sent(2), cameras.sent(3)]).toEqual([0, 0, 0]);
  });

  it("leaves the cameras' setup as it is for an archive of format 6 or older", async () => {
    const { call, seen, camera } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.release", { camera: 2, confirm: true });
    const older = ((await call("support.snapshot")).backups as JsonObject[]).find((entry) =>
      String(entry.name).endsWith(".json")
    );
    seen();
    await call("support.backup.restore", { path: older!.path as string });
    expect(seen()).toContainEqual(["cameras.changed", "restore", null]);
    expect(await camera(2)).toMatchObject({ state: "released", setup: { address: CAM2_ADDRESS } });
  });
});
