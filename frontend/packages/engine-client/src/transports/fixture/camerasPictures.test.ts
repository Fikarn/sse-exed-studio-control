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
      note: "Test pictures stand in for vMix inputs 1 to 4. The cameras' own come with a later version, over NDI from vMix on this PC.",
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

  it("has no pictures yet without the simulated cameras, as the studio's build", async () => {
    const { snapshot, health } = openCamerasDouble({ simulated: false });
    const shown = await snapshot();
    expect(shown.pictures).toEqual({
      state: "no-pictures",
      word: "NO PICTURES",
      tone: "attention",
      sentence: "Studio Control shows no pictures yet: they come with a later version, over NDI from vMix on this PC.",
      source: "not built yet",
      note: "The cameras' own pictures come with a later version, over NDI from vMix on this PC.",
    });
    for (const camera of shown.cameras) {
      expect(camera.picture).toEqual({
        state: "no-pictures",
        word: "NO PICTURE",
        tone: "attention",
        detail: "not built yet",
        sentence: "No picture yet: the cameras' pictures come with a later version.",
        advice: null,
      });
    }
    expect((await health()).check.word).toBe("NOT SET UP");
  });
});
