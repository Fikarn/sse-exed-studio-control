import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dataFolderFrom, DEVELOPMENT_BRIDGE_PORT, developmentEnv, STUDIO_BRIDGE_PORT } from "./dev-app.mjs";
import { laneEnvRefusal } from "./native-runtime-harness.mjs";

const repositoryRoot = path.resolve("/work/studio-control");

test("a development run has its own data and port and reaches no device", () => {
  const env = developmentEnv({ PATH: "/bin" }, { repositoryRoot });

  assert.equal(env.PATH, "/bin");
  assert.equal(env.SSE_APP_DATA_DIR, path.join(repositoryRoot, ".dev", "app-data"));
  assert.equal(env.SSE_LOG_DIR, path.join(repositoryRoot, ".dev", "app-data", "logs"));
  assert.equal(env.SSE_CONTROL_SURFACE_PORT, String(DEVELOPMENT_BRIDGE_PORT));
  assert.notEqual(DEVELOPMENT_BRIDGE_PORT, STUDIO_BRIDGE_PORT);
  assert.equal(env.SSE_SAFE_START, "1");
  assert.equal(env.SSE_LIGHTS_SIMULATED, "1");
  assert.equal(env.SSE_AUDIO_SIMULATED_INPUT_MODE, "1");
  assert.equal(env.SSE_CAMERAS_SIMULATED, "1");
});

test("a development run keeps its folders and switches whatever the caller's environment holds", () => {
  const env = developmentEnv(
    {
      SSE_APP_DATA_DIR: "C:/Users/operator/AppData/Roaming/ExEd Studio Control Native",
      SSE_LOG_DIR: "C:/Users/operator/AppData/Roaming/ExEd Studio Control Native/logs",
      SSE_CONTROL_SURFACE_PORT: String(STUDIO_BRIDGE_PORT),
      SSE_SAFE_START: "0",
      SSE_LIGHTS_SIMULATED: "0",
      SSE_AUDIO_SIMULATED_INPUT_MODE: "0",
      SSE_CAMERAS_SIMULATED: "0",
      // Windows reads a variable's name without regard to case, so a twin in
      // another case is left out as well.
      sse_safe_start: "0",
      Sse_Lights_Simulated: "0",
    },
    { repositoryRoot }
  );

  assert.deepEqual(env, developmentEnv({}, { repositoryRoot }));
});

test("`--data=<folder>` is the one argument, and it names the saved data", () => {
  assert.equal(dataFolderFrom([]), null);
  const copy = path.resolve("/work/a copy of the studio data");
  assert.equal(dataFolderFrom([`--data=${copy}`]), copy);
  assert.equal(dataFolderFrom(["--data=relative/folder"]), path.resolve("relative/folder"));

  const env = developmentEnv({}, { dataFolder: copy, repositoryRoot });
  assert.equal(env.SSE_APP_DATA_DIR, copy);
  assert.equal(env.SSE_LOG_DIR, path.join(copy, "logs"));
  assert.equal(env.SSE_SAFE_START, "1");

  // `--release` would build the studio's kind of app from development code,
  // `--config` can change the identity, and `--` hands arguments to the app.
  for (const refused of ["--release", "--config=other.json", "--", "--data", "--data=", "data=x", "--features"]) {
    assert.throws(() => dataFolderFrom([refused]), /is not an argument of `npm run app`/, refused);
    assert.throws(() => dataFolderFrom([`--data=${copy}`, refused]), /is not an argument/, refused);
  }
});

test("a development run is hardened the way a lane is, and the studio's folder is refused", () => {
  // The lanes' own reading of the variables, which `npm run app` asks before
  // it starts anything.
  assert.equal(laneEnvRefusal(developmentEnv({}, { repositoryRoot }), { liveConsole: false }), null);
  const scratch = path.join(os.tmpdir(), "sse-dev-app-test");
  assert.equal(
    laneEnvRefusal(developmentEnv({}, { dataFolder: scratch, repositoryRoot }), { liveConsole: false }),
    null
  );

  // The studio's folder under this platform's base, as the caller's
  // environment gives it.
  const base =
    process.platform === "win32"
      ? { APPDATA: "C:\\Users\\operator\\AppData\\Roaming" }
      : { HOME: "/home/operator", XDG_DATA_HOME: "/home/operator/.local/share" };
  const studio = path.join(Object.values(base).at(-1), "ExEd Studio Control Native");
  for (const dataFolder of [studio, path.join(studio, "inside")]) {
    const refusal = laneEnvRefusal(developmentEnv(base, { dataFolder, repositoryRoot }), { liveConsole: false });
    assert.match(refusal ?? "", /SSE_APP_DATA_DIR is inside the real app data/, dataFolder);
  }
});
