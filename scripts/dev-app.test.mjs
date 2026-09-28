import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEVELOPMENT_BRIDGE_PORT, developmentEnv, STUDIO_BRIDGE_PORT } from "./dev-app.mjs";
import { laneEnvRefusal } from "./native-runtime-harness.mjs";

const repository = path.resolve("/work/studio-control");

test("a development run has its own data and port and reaches no device", () => {
  const env = developmentEnv({ PATH: "/bin" }, repository);

  assert.equal(env.PATH, "/bin");
  assert.equal(env.SSE_APP_DATA_DIR, path.join(repository, ".dev", "app-data"));
  assert.equal(env.SSE_LOG_DIR, path.join(repository, ".dev", "app-data", "logs"));
  assert.equal(env.SSE_CONTROL_SURFACE_PORT, String(DEVELOPMENT_BRIDGE_PORT));
  assert.notEqual(DEVELOPMENT_BRIDGE_PORT, STUDIO_BRIDGE_PORT);
  assert.equal(env.SSE_SAFE_START, "1");
  assert.equal(env.SSE_AUDIO_SIMULATED_INPUT_MODE, "1");
  assert.equal(env.SSE_CAMERAS_SIMULATED, "1");
});

test("a development run keeps its switches whatever the caller's environment holds", () => {
  const env = developmentEnv(
    {
      SSE_APP_DATA_DIR: "  ",
      SSE_LOG_DIR: "C:/Users/operator/AppData/Roaming/ExEd Studio Control Native/logs",
      SSE_CONTROL_SURFACE_PORT: String(STUDIO_BRIDGE_PORT),
      SSE_SAFE_START: "0",
      SSE_AUDIO_SIMULATED_INPUT_MODE: "0",
      SSE_CAMERAS_SIMULATED: "0",
    },
    repository
  );

  assert.deepEqual(env, developmentEnv({}, repository));
});

test("a development run opens the folder the caller names, with its logs inside", () => {
  const copy = path.resolve("/work/a-copy-of-the-studio-data");
  const env = developmentEnv({ SSE_APP_DATA_DIR: copy }, repository);

  assert.equal(env.SSE_APP_DATA_DIR, copy);
  assert.equal(env.SSE_LOG_DIR, path.join(copy, "logs"));
  assert.equal(env.SSE_SAFE_START, "1");
});

test("a development run is hardened the way a lane is, and the studio's folder is refused", () => {
  // The lanes' own reading of the variables, which `npm run app` asks before
  // it starts anything.
  assert.equal(laneEnvRefusal(developmentEnv({}, repository), { liveConsole: false }), null);
  const scratch = path.join(os.tmpdir(), "sse-dev-app-test");
  assert.equal(laneEnvRefusal(developmentEnv({ SSE_APP_DATA_DIR: scratch }, repository), { liveConsole: false }), null);

  // The studio's folder under this platform's base, as the caller's
  // environment gives it.
  const base =
    process.platform === "win32"
      ? { APPDATA: "C:\\Users\\operator\\AppData\\Roaming" }
      : { HOME: "/home/operator", XDG_DATA_HOME: "/home/operator/.local/share" };
  const studio = path.join(Object.values(base).at(-1), "ExEd Studio Control Native");
  for (const named of [studio, path.join(studio, "inside")]) {
    const refusal = laneEnvRefusal(developmentEnv({ ...base, SSE_APP_DATA_DIR: named }, repository), {
      liveConsole: false,
    });
    assert.match(refusal ?? "", /SSE_APP_DATA_DIR is inside the real app data/, named);
  }
});
