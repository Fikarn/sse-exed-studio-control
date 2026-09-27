// What the fixture double's cameras tests share (`cameras*.test.ts`), as the hardware link's
// cameras tests share their own: a double of its own, the requests a Cameras page would
// send it, its simulated cameras, and what the health snapshot says. Test-only.
import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import type { CameraSnapshot } from "../../generated/snapshots/CameraSnapshot";
import type { CamerasSnapshot } from "../../generated/snapshots/CamerasSnapshot";
import type { FixtureCamerasSeed, FixtureScenario } from "../../types";
import { EngineRequestError } from "../engineRequestError";
import { createFixtureTransport } from "../fixtureTransport";
import { simulatedCameras } from "./camerasRequests";

/** CAM 2's and CAM 3's addresses in the tests: this PC's own. */
export const CAM2_ADDRESS = "127.0.0.2";
export const CAM3_ADDRESS = "127.0.0.3";

/** All three cameras set up: CAM 1 paired, CAM 2 and CAM 3 at their addresses. */
export const ALL_SET_UP: FixtureCamerasSeed = {
  cameras: [
    { camera: 1, paired: true },
    { camera: 2, address: CAM2_ADDRESS },
    { camera: 3, address: CAM3_ADDRESS },
  ],
};

/** `setup-ready` with the cameras `seed` says (none set up without one). */
export function camerasScenario(seed?: FixtureCamerasSeed, id = "setup-ready"): FixtureScenario {
  const scenario = getFixtureScenario(id);
  return seed === undefined ? scenario : { ...scenario, cameras: seed };
}

/** A double with the cameras `seed` says, and what a test does with it. */
export function openCamerasDouble(seed?: FixtureCamerasSeed, id?: string) {
  const transport = createFixtureTransport(camerasScenario(seed, id));
  const events: Array<{ event: string; payload: JsonObject }> = [];
  transport.subscribe((envelope) => events.push({ event: envelope.event, payload: envelope.payload }));

  const call = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;

  /** A request that must be refused: its code and its sentence, as the Tauri transport throws them. */
  const refused = async (method: RequestMethod, params: JsonObject = {}) => {
    let answered: JsonValue;
    try {
      answered = await transport.request(method, params);
    } catch (error) {
      if (!(error instanceof EngineRequestError)) throw error;
      return { code: error.code, sentence: error.message };
    }
    throw new Error(`${method} should be refused, answered ${JSON.stringify(answered)}`);
  };

  const snapshot = async () => (await call("cameras.snapshot")) as unknown as CamerasSnapshot;
  const camera = async (number: number) => (await snapshot()).cameras[number - 1] as CameraSnapshot;

  const health = async () => {
    const snapshot = await call("health.snapshot");
    return {
      status: snapshot.status as string,
      summary: snapshot.summary as string,
      check: (snapshot.checks as JsonObject).cameras as JsonObject,
    };
  };

  /** The events since the last look, as `[event, reason, camera]` (`camera` for `cameras.changed` only). */
  const seen = () =>
    events
      .splice(0)
      .map(({ event, payload }) =>
        event === "cameras.changed" ? [event, payload.reason, payload.camera] : [event, payload.reason]
      );

  const rows = async () => ((await call("support.snapshot")).recentEvents ?? []) as JsonObject[];

  return {
    transport,
    events,
    call,
    refused,
    snapshot,
    camera,
    health,
    seen,
    rows,
    cameras: simulatedCameras(transport),
  };
}
