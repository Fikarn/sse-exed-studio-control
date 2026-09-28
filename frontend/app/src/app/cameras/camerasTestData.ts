import type { CamerasSnapshot, EngineTransport, FixtureCamerasSeed, FixtureScenario } from "@sse/engine-client";
import { createFixtureTransport, simulatedCameras } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

// What the Cameras page's tests read: the cameras as the hardware link's test
// double reports them, so a test's data is what the page will be given. Test-only.

/** All three cameras set up: CAM 1 paired, CAM 2 and CAM 3 at their addresses. */
export const ALL_SET_UP: FixtureCamerasSeed = {
  cameras: [
    { camera: 1, paired: true },
    { camera: 2, address: "172.16.16.85" },
    { camera: 3, address: "172.16.16.30" },
  ],
};

/** A double with the cameras `seed` says, its simulated cameras' hooks, and a read of `cameras.snapshot`. */
export function openCameras(seed: FixtureCamerasSeed = ALL_SET_UP, scenario: Partial<FixtureScenario> = {}) {
  const transport: EngineTransport = createFixtureTransport({
    ...getFixtureScenario("setup-ready"),
    ...scenario,
    cameras: seed,
  });
  return {
    transport,
    hooks: simulatedCameras(transport),
    read: async () => (await transport.request("cameras.snapshot")) as unknown as CamerasSnapshot,
  };
}
