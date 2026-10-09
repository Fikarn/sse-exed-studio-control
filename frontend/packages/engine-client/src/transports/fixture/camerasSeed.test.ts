import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtureIds, getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject } from "../../generated/protocol";
import type { FixtureCamerasSeed, FixtureScenario } from "../../types";
import { createFixtureTransport } from "../fixtureTransport";
import { CAM2_ADDRESS, CAM3_ADDRESS, camerasScenario, openCamerasDouble } from "./camerasTestSupport";

// The cameras a scenario starts with (new pages program, Slice 8; `camerasSeed.ts`): which
// are set up, their vMix inputs, which are released or do not answer, CAM 1 recording,
// values that differ from board 2's, the selection, and a hardware link with no link to a
// camera yet. The seed is the start: every held camera read at once, nothing sent, no
// event. A seed the hardware link could not hold is the scenario's mistake, and says so.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the fixture double's cameras seed", () => {
  it("starts every fixture scenario with no camera set up (D15 rule 1), and moves no board's status", async () => {
    for (const id of fixtureIds) {
      const scenario: FixtureScenario = getFixtureScenario(id);
      if (scenario.cameras !== undefined) continue;
      const transport = createFixtureTransport(scenario);
      const snapshot = (await transport.request("cameras.snapshot", {})) as JsonObject;
      expect(
        (snapshot.cameras as JsonObject[]).map((camera) => camera.state),
        id
      ).toEqual(["not-set-up", "not-set-up", "not-set-up"]);
      const health = (await transport.request("health.snapshot", {})) as JsonObject;
      expect(String(health.summary), id).not.toMatch(/Cameras:/);
    }
  });

  it("starts with the cameras it names, as the start reads them, and raises nothing", async () => {
    const seed: FixtureCamerasSeed = {
      selected: 3,
      cameras: [
        {
          camera: 1,
          paired: true,
          recording: true,
          vmixInput: 11,
          values: { iso: "800", tint: 5, displayLutOn: false },
        },
        { camera: 2, address: CAM2_ADDRESS, released: true, values: { shutter: "1/100" } },
        { camera: 3, address: ` ${CAM3_ADDRESS} `, unreachable: true, vmixInput: 1000, values: { whiteBalance: 3200 } },
      ],
    };
    const { snapshot, events, health, call, cameras } = openCamerasDouble(seed);
    const shown = await snapshot();
    expect(shown.selected).toBe(3);
    const [cam1, cam2, cam3] = shown.cameras;
    expect(cam1).toMatchObject({
      state: "held",
      setup: { setUp: true, paired: true, vmixInput: 11 },
      readAt: new Date(NOW).toISOString(),
      recording: { recording: true, startedAt: null },
    });
    expect([cam1!.values.iso.value, cam1!.values.tint.value, cam1!.values.displayLutOn.value]).toEqual([
      "800",
      5,
      false,
    ]);
    expect(cam2).toMatchObject({ state: "released", setup: { address: CAM2_ADDRESS }, readAt: null });
    expect(cam3).toMatchObject({
      state: "unreachable",
      setup: { address: CAM3_ADDRESS, vmixInput: 1000 },
      readAt: new Date(NOW).toISOString(),
    });
    expect(cam3!.values.whiteBalance.value, "what it reported before it stopped answering").toBe(3200);
    expect(events, "the scenario starts that way").toEqual([]);
    expect([cameras.sent(1), cameras.sent(2), cameras.sent(3)]).toEqual([0, 0, 0]);
    expect(await health()).toMatchObject({ status: "attention", check: { word: "UNREACHABLE", recording: true } });

    // The released camera's body kept its own value, and shows it once connected.
    await call("cameras.connect", { camera: 2 });
    expect((await snapshot()).cameras[1]!.values.shutter.value).toBe("1/100");
  });

  // Test-only (the Overview's take, D47): a take the hardware link saw start that long before
  // the start, so the page counts its length; the reads after it keep the start while the
  // take runs, and so does a camera that stops answering.
  it("counts CAM 1's take from recordingForSeconds before the start", async () => {
    const started = new Date(NOW - 90_000).toISOString();
    const { camera, events } = openCamerasDouble({
      cameras: [{ camera: 1, paired: true, recording: true, recordingForSeconds: 90 }],
    });
    expect((await camera(1)).recording).toMatchObject({ recording: true, startedAt: started });
    vi.setSystemTime(NOW + 5_000);
    expect((await camera(1)).recording.startedAt, "kept while the take runs").toBe(started);
    expect(events, "the scenario starts that way").toEqual([]);

    const lost = openCamerasDouble({
      cameras: [{ camera: 1, paired: true, recording: true, unreachable: true, recordingForSeconds: 30 }],
    });
    expect(await lost.camera(1)).toMatchObject({
      state: "unreachable",
      recording: { recording: true, startedAt: new Date(NOW + 5_000 - 30_000).toISOString() },
    });
  });

  // Saved data that holds a pairing and an address in a build with no link, as a database
  // backup restored whole brings them: Setup itself would take neither.
  it("starts a hardware link with no link to a camera yet, when the scenario says so", async () => {
    const { camera } = openCamerasDouble({
      simulated: false,
      cameras: [
        { camera: 1, paired: true },
        { camera: 3, address: CAM3_ADDRESS },
      ],
    });
    // CAM 1's link is the studio build's own, and the double has no Pocket for it to reach.
    expect((await camera(1)).sentence).toBe("CAM 1 does not answer over Bluetooth. Check it is on and within reach.");
    expect((await camera(3)).sentence).toBe("Studio Control has no link to CAM 3 yet: it comes with a later version.");
    expect((await camera(2)).state).toBe("not-set-up");
  });

  it("refuses a seed the hardware link could not hold", () => {
    const mistake = (seed: unknown, message: string) =>
      expect(() => createFixtureTransport(camerasScenario(seed as FixtureCamerasSeed)), message).toThrow(message);
    mistake([], "cameras: the seed must be an object.");
    mistake({ cameras: {} }, "cameras: cameras must be a list.");
    mistake({ selected: 4 }, "cameras: selected must be 1, 2 or 3.");
    mistake({ simulated: "yes" }, "cameras: simulated must be true or false.");
    mistake({ cameras: [null] }, "cameras: cameras[0] must be an object.");
    mistake({ cameras: [{ camera: 4 }] }, "cameras: cameras[0].camera must be 1, 2 or 3.");
    mistake({ cameras: [{ camera: 2 }, { camera: 2 }] }, "cameras: CAM 2 is seeded twice.");
    mistake({ selectd: 2 }, "cameras: the seed has selectd, which a seed does not have.");
    mistake(
      { cameras: [{ camera: 2, adress: "10.0.0.2" }] },
      "cameras: CAM 2's seed has adress, which a seed does not have."
    );
    mistake(
      { cameras: [{ camera: 1, address: "10.0.0.1" }] },
      "cameras: CAM 1 has no address: it is paired (paired: true)."
    );
    mistake({ cameras: [{ camera: 2, paired: true }] }, "cameras: CAM 2 is not paired: it has an address.");
    mistake(
      { cameras: [{ camera: 3, address: "0.0.0.0" }] },
      "cameras: CAM 3's address 0.0.0.0 is not the address of one machine."
    );
    mistake(
      { cameras: [{ camera: 2, vmixInput: 0 }] },
      "cameras: CAM 2's vmixInput must be a whole number from 1 to 1000."
    );
    mistake(
      { cameras: [{ camera: 1, released: true }] },
      "cameras: CAM 1 is released, so it must be set up: give it paired: true."
    );
    mistake(
      { cameras: [{ camera: 2, unreachable: true }] },
      "cameras: CAM 2 does not answer, so it must be set up: give it an address."
    );
    mistake({ cameras: [{ camera: 3, recording: true }] }, "cameras: CAM 3 does not record here: only CAM 1 records.");
    mistake(
      { cameras: [{ camera: 2, address: CAM2_ADDRESS, recordingForSeconds: 90 }] },
      "cameras: CAM 2 does not record here: only CAM 1 records."
    );
    for (const recording of [undefined, false]) {
      mistake(
        { cameras: [{ camera: 1, paired: true, recording, recordingForSeconds: 90 }] },
        "cameras: CAM 1's recordingForSeconds needs a take: give it recording: true."
      );
    }
    for (const seconds of [0, 1.5, "90"]) {
      mistake(
        { cameras: [{ camera: 1, paired: true, recording: true, recordingForSeconds: seconds }] },
        "cameras: CAM 1's recordingForSeconds must be a whole number of seconds, 1 or more."
      );
    }
    mistake(
      { cameras: [{ camera: 1, paired: true, recording: true, released: true, recordingForSeconds: 90 }] },
      "cameras: CAM 1's recordingForSeconds is not counted while it is released."
    );
    mistake({ cameras: [{ camera: 1, paired: 1 }] }, "cameras: CAM 1's paired must be true or false.");
    mistake(
      { cameras: [{ camera: 2, values: { tint: 3 } }] },
      "cameras: CAM 2's values: tint is not reported: CAM 2 does not report tint."
    );
    mistake(
      { cameras: [{ camera: 1, values: { iso: "450" } }] },
      "cameras: CAM 1's values: iso must be one of 100, 125, 160"
    );
    mistake(
      { cameras: [{ camera: 1, values: { whiteBalance: 5625 } }] },
      "cameras: CAM 1's values: whiteBalance must be 2500–10000 in steps of 50; got 5625."
    );
    mistake(
      { cameras: [{ camera: 1, values: { displayLutOn: "on" } }] },
      "cameras: CAM 1's values: displayLutOn must be true or false."
    );
    mistake(
      { cameras: [{ camera: 3, values: { displayLutOn: true } }] },
      "cameras: CAM 3's values: displayLutOn is not reported: CAM 3 does not report a display LUT."
    );
    mistake(
      { cameras: [{ camera: 1, values: { zoom: 2 } }] },
      "cameras: CAM 1's values: zoom is not a camera setting."
    );
    mistake({ cameras: [{ camera: 1, values: [] }] }, "cameras: CAM 1's values: they must be an object.");
    mistake(
      { cameras: [{ camera: 1, values: { frameRate: "60" } }] },
      "cameras: CAM 1's values: frameRate 60 is not at 6K."
    );
  });
});
