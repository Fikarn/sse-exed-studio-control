import { describe, expect, it } from "vitest";

import { ALL_SET_UP, openCamerasDouble } from "./camerasTestSupport";

// The fixture double's pictures (D17, D28), as the hardware link reports them
// (`native/rust-engine/src/cameras/pictures.rs`, its tests `tests_pictures.rs`): a build
// without the simulated cameras reads NO PICTURES until the pictures are built; the
// simulated cameras' test pictures stand in for vMix inputs 1 to 4, so a camera on another
// input reads PICTURE MISSING. A picture is vMix's, not the camera's link's.

const LIVE = { state: "showing", word: "LIVE", tone: "ok", detail: "test picture", sentence: null, advice: null };

describe("the fixture double's pictures", () => {
  it("shows the simulated test pictures on vMix inputs 1 to 4", async () => {
    const { snapshot, health } = openCamerasDouble(ALL_SET_UP);
    const shown = await snapshot();
    expect(shown.pictures).toEqual({
      state: "showing",
      word: null,
      tone: "ok",
      sentence: null,
      source: "test pictures",
      note: "Test pictures stand in for vMix inputs 1 to 4. A studio build shows vMix's Outputs 2, 3 and 4 over NDI.",
    });
    expect(shown.cameras.map((camera) => camera.picture)).toEqual([LIVE, LIVE, LIVE]);
    expect((await health()).check.word).toBe("HELD");
  });

  it("reads PICTURE MISSING for a camera on an input the pictures do not carry, and lights the lamp only", async () => {
    const { call, snapshot, camera, health, seen } = openCamerasDouble(ALL_SET_UP);
    seen();
    await call("cameras.setup.update", { camera: 2, vmixInput: 7 });
    expect(seen()).toEqual([
      ["cameras.changed", "setup", 2],
      ["app.changed", "health"],
    ]);
    expect((await camera(2)).picture).toEqual({
      state: "missing",
      word: "NO PICTURE",
      tone: "attention",
      detail: "nothing received",
      sentence: "vMix is not sending CAM 2 over NDI.",
      advice: "vMix sends other inputs: check that vMix input 7 is still there and live.",
    });
    expect((await camera(2)).state).toBe("held");
    const shown = await snapshot();
    expect(shown.pictures).toMatchObject({
      state: "missing",
      word: "PICTURE MISSING",
      tone: "attention",
      sentence: "vMix sends no picture for CAM 2. Check that vMix input 7 is still there and live.",
    });
    const { status, check } = await health();
    expect(check).toMatchObject({
      ok: false,
      status: "attention",
      word: "PICTURE MISSING",
      summary: "vMix sends no picture for CAM 2. Check that vMix input 7 is still there and live.",
    });
    expect(status, "a missing picture lights the Cameras lamp only").toBe("ok");

    await call("cameras.setup.update", { camera: 2, vmixInput: 4 });
    expect((await camera(2)).picture).toEqual(LIVE);
    expect((await health()).check.word).toBe("HELD");
  });

  it("speaks of the selected camera first, and a camera that is not held before the pictures", async () => {
    const { call, snapshot, health } = openCamerasDouble(ALL_SET_UP);
    await call("cameras.setup.update", { camera: 2, vmixInput: 12 });
    await call("cameras.setup.update", { camera: 3, vmixInput: 13 });
    expect((await snapshot()).pictures.sentence).toBe(
      "vMix sends no picture for CAM 2. Check that vMix input 12 is still there and live."
    );
    await call("cameras.select", { camera: 3 });
    expect((await snapshot()).pictures.sentence).toBe(
      "vMix sends no picture for CAM 3. Check that vMix input 13 is still there and live."
    );
    await call("cameras.release", { camera: 1, confirm: true });
    expect((await health()).check.word).toBe("RELEASED");
    expect((await snapshot()).cameras[0]?.picture.state, "a released camera keeps its picture").toBe("showing");
  });

  it("is the studio's build with vMix sending none of its outputs without the simulated cameras", async () => {
    const { snapshot, health } = openCamerasDouble({ simulated: false });
    const shown = await snapshot();
    expect(shown.pictures).toEqual({
      state: "no-pictures",
      word: "NO PICTURES",
      tone: "attention",
      sentence: "No pictures from vMix. Open vMix and send Outputs 2, 3 and 4 over NDI.",
      source: "vMix Outputs 2 to 4",
      note: "Over NDI from vMix on this PC: CAM 1 from Output 2, CAM 2 from Output 3, CAM 3 from Output 4.",
    });
    for (const camera of shown.cameras) {
      expect(camera.picture).toEqual({
        state: "no-pictures",
        word: "NO PICTURE",
        tone: "attention",
        detail: `vMix Output ${camera.camera + 1} · nothing received`,
        sentence: `vMix is not sending ${camera.tag} over NDI.`,
        advice: "Either vMix is closed, or its Outputs 2, 3 and 4 are not sent over NDI (Settings › Outputs).",
      });
    }
    expect((await health()).check.word).toBe("NOT SET UP");
  });
});
