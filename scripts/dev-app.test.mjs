import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEV_RUN_RELEASE_ENV,
  DEVELOPMENT_BRIDGE_PORT,
  developmentEnv,
  RELEASE_TARGET_DIR,
  runOptionsFrom,
  STUDIO_BRIDGE_PORT,
} from "./dev-app.mjs";
import { laneEnvRefusal } from "./native-runtime-harness.mjs";

const repositoryRoot = path.resolve("/work/studio-control");
/** A commit as `npm run release` hands it to the compiler (`SSE_STUDIO_BUILD`). */
const STUDIO_COMMIT = "0123456789abcdef0123456789abcdef01234567";

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
  assert.equal(env[DEV_RUN_RELEASE_ENV], "0");
  assert.equal(env.SSE_VMIX_PICTURES, "0", "no run takes vMix's pictures unasked");
  assert.equal(env.SSE_CAMERA_BLUETOOTH, "0", "no run opens Bluetooth unasked");
  assert.ok(!Object.keys(env).some((name) => name.toUpperCase() === "SSE_NDI_LIBRARY"));
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
      [DEV_RUN_RELEASE_ENV]: "1",
      // The marker that makes a studio build of a release build is never
      // handed on (`npm run release` refuses to start with it set).
      SSE_STUDIO_BUILD: STUDIO_COMMIT,
      // Windows reads a variable's name without regard to case, so a twin in
      // another case is left out as well.
      sse_safe_start: "0",
      Sse_Lights_Simulated: "0",
      sse_studio_build: STUDIO_COMMIT,
      // vMix's switch and NDI's library are the run's own to set (D33).
      SSE_VMIX_PICTURES: "1",
      sse_vmix_pictures: "1",
      SSE_NDI_LIBRARY: "C:/elsewhere/Processing.NDI.Lib.x64.dll",
      Sse_Ndi_Library: "C:/elsewhere/Processing.NDI.Lib.x64.dll",
      // Bluetooth's switch too (D41).
      SSE_CAMERA_BLUETOOTH: "1",
      sse_camera_bluetooth: "1",
    },
    { repositoryRoot }
  );

  assert.deepEqual(env, developmentEnv({}, { repositoryRoot }));
});

test("`--data=<folder>` names the saved data, and `--release` and `--vmix-pictures` are the only other arguments", () => {
  const dataFolderFrom = (args) => runOptionsFrom(args).dataFolder;
  assert.equal(dataFolderFrom([]), null);
  const copy = path.resolve("/work/a copy of the studio data");
  assert.equal(dataFolderFrom([`--data=${copy}`]), copy);
  assert.equal(dataFolderFrom(["--data=relative/folder"]), path.resolve("relative/folder"));

  const env = developmentEnv({}, { dataFolder: copy, repositoryRoot });
  assert.equal(env.SSE_APP_DATA_DIR, copy);
  assert.equal(env.SSE_LOG_DIR, path.join(copy, "logs"));
  assert.equal(env.SSE_SAFE_START, "1");

  // `--config` can change the identity, `--` hands arguments to the app, and
  // a profile by another spelling would build where `npm run release` does.
  for (const refused of [
    "--config=other.json",
    "--",
    "--data",
    "--data=",
    "data=x",
    "--features",
    "--release=1",
    "--profile=release",
  ]) {
    assert.throws(() => runOptionsFrom([refused]), /is not an argument of `npm run app`/, refused);
    assert.throws(() => runOptionsFrom([`--data=${copy}`, refused]), /is not an argument/, refused);
  }
});

test("`--release` builds the run in the release profile, in a folder of its own, and changes nothing else", () => {
  const copy = path.resolve("/work/a copy of the studio data");
  assert.deepEqual(runOptionsFrom([]), { dataFolder: null, release: false, vmixPictures: false, bluetooth: false });
  assert.deepEqual(runOptionsFrom(["--release"]), {
    dataFolder: null,
    release: true,
    vmixPictures: false,
    bluetooth: false,
  });
  assert.deepEqual(runOptionsFrom(["--release", `--data=${copy}`]), {
    dataFolder: copy,
    release: true,
    vmixPictures: false,
    bluetooth: false,
  });

  // The build folder is the run's own, whatever the caller's environment
  // holds, and never the one `npm run release` builds the studio's app in.
  // A caller's studio-build marker is left out: with it, the release build
  // would be a studio build.
  const env = developmentEnv(
    { CARGO_TARGET_DIR: "C:/elsewhere", cargo_target_dir: "C:/elsewhere", SSE_STUDIO_BUILD: STUDIO_COMMIT },
    { release: true, repositoryRoot }
  );
  const target = path.join(repositoryRoot, RELEASE_TARGET_DIR);
  assert.equal(env.CARGO_TARGET_DIR, target);
  const studioBuilds = path.join(repositoryRoot, "native", "target", "release");
  assert.notEqual(target, studioBuilds);
  assert.ok(!target.startsWith(studioBuilds + path.sep), target);
  assert.equal(env[DEV_RUN_RELEASE_ENV], "1");
  assert.ok(!Object.keys(env).some((name) => name.toUpperCase() === "SSE_STUDIO_BUILD"));

  // The rest is a development run's, hardened the same way.
  const rest = { ...env, [DEV_RUN_RELEASE_ENV]: "0" };
  delete rest.CARGO_TARGET_DIR;
  assert.deepEqual(rest, developmentEnv({}, { repositoryRoot }));
  assert.equal(laneEnvRefusal(env, { liveConsole: false }), null);

  // Without it, the caller's own build folder is left as it was.
  assert.equal(
    developmentEnv({ CARGO_TARGET_DIR: "C:/elsewhere" }, { repositoryRoot }).CARGO_TARGET_DIR,
    "C:/elsewhere"
  );
});

test("`--vmix-pictures` alone takes vMix's pictures, with NDI's library, and the lanes' check lets it pass only when asked", () => {
  assert.deepEqual(runOptionsFrom(["--vmix-pictures"]), {
    dataFolder: null,
    release: false,
    vmixPictures: true,
    bluetooth: false,
  });
  assert.deepEqual(runOptionsFrom(["--release", "--vmix-pictures"]), {
    dataFolder: null,
    release: true,
    vmixPictures: true,
    bluetooth: false,
  });
  for (const refused of ["--vmix-pictures=1", "--vmix", "--pictures=vmix", "--ndi-library=x"]) {
    assert.throws(() => runOptionsFrom([refused]), /is not an argument of `npm run app`/, refused);
  }

  const library = "C:\\Program Files\\NDI\\NDI 6 SDK\\Bin\\x64\\Processing.NDI.Lib.x64.dll";
  const env = developmentEnv(
    { SSE_NDI_LIBRARY: "C:/elsewhere/Processing.NDI.Lib.x64.dll" },
    { vmixPictures: true, ndiLibrary: library, repositoryRoot }
  );
  assert.equal(env.SSE_VMIX_PICTURES, "1");
  assert.equal(env.SSE_NDI_LIBRARY, library, "the checked library, not the caller's");
  assert.equal(env.SSE_CAMERAS_SIMULATED, "1", "the cameras' links stay simulated");
  assert.equal(env.SSE_SAFE_START, "1");
  assert.equal(laneEnvRefusal(env, { liveConsole: false, vmixPictures: true }), null);
  assert.match(laneEnvRefusal(env, { liveConsole: false }) ?? "", /SSE_VMIX_PICTURES is set/);

  // The switch without a library checked is no run at all.
  assert.throws(() => developmentEnv({}, { vmixPictures: true, repositoryRoot }), /NDI's library/);
  // Without the switch a library is never handed on.
  const plain = developmentEnv({}, { ndiLibrary: library, repositoryRoot });
  assert.equal(plain.SSE_VMIX_PICTURES, "0");
  assert.ok(!Object.hasOwn(plain, "SSE_NDI_LIBRARY"));
});

test("`--bluetooth` makes CAM 1 the real Pocket over Windows' Bluetooth, and the lanes' check lets it pass only when asked", () => {
  assert.deepEqual(runOptionsFrom(["--bluetooth"]), {
    dataFolder: null,
    release: false,
    vmixPictures: false,
    bluetooth: true,
  });
  for (const refused of ["--bluetooth=1", "--ble", "--cameras=real", "--pocket"]) {
    assert.throws(() => runOptionsFrom([refused]), /is not an argument of `npm run app`/, refused);
  }

  // The switch is set, the cameras are not simulated, and everything else is
  // a development run's (D41).
  const env = developmentEnv(
    { SSE_CAMERA_BLUETOOTH: "0", sse_camera_bluetooth: "0", SSE_CAMERAS_SIMULATED: "1" },
    { bluetooth: true, repositoryRoot }
  );
  assert.equal(env.SSE_CAMERA_BLUETOOTH, "1");
  assert.equal(env.SSE_CAMERAS_SIMULATED, "0", "CAM 1 is the real camera; CAM 2 and CAM 3 have no link");
  assert.equal(env.SSE_SAFE_START, "1");
  assert.equal(env.SSE_LIGHTS_SIMULATED, "1");
  assert.equal(env.SSE_AUDIO_SIMULATED_INPUT_MODE, "1");
  assert.equal(env.SSE_VMIX_PICTURES, "0");
  const rest = { ...env, SSE_CAMERA_BLUETOOTH: "0", SSE_CAMERAS_SIMULATED: "1" };
  assert.deepEqual(rest, developmentEnv({}, { repositoryRoot }));

  // The lanes' check lets the run pass only when asked: a lane with the same
  // environment is refused, at the cameras first, then at the switch.
  assert.equal(laneEnvRefusal(env, { liveConsole: false, bluetooth: true }), null);
  assert.match(laneEnvRefusal(env, { liveConsole: false }) ?? "", /SSE_CAMERAS_SIMULATED must be 1/);
  const simulatedWithSwitch = { ...env, SSE_CAMERAS_SIMULATED: "1" };
  assert.match(laneEnvRefusal(simulatedWithSwitch, { liveConsole: false }) ?? "", /SSE_CAMERA_BLUETOOTH is set/);
  assert.match(
    laneEnvRefusal({ ...developmentEnv({}, { repositoryRoot }), sse_camera_bluetooth: "1" }, { liveConsole: false }) ??
      "",
    /SSE_CAMERA_BLUETOOTH is set/,
    "under the name in any case"
  );

  // Without the argument the switch is off, whatever the caller's environment holds.
  assert.equal(developmentEnv({ SSE_CAMERA_BLUETOOTH: "1" }, { repositoryRoot }).SSE_CAMERA_BLUETOOTH, "0");

  // Both hardware tests at once: CAM 1 over Bluetooth, the pictures from vMix.
  const library = "C:\\Program Files\\NDI\\NDI 6 SDK\\Bin\\x64\\Processing.NDI.Lib.x64.dll";
  const both = developmentEnv({}, { bluetooth: true, vmixPictures: true, ndiLibrary: library, repositoryRoot });
  assert.equal(both.SSE_CAMERA_BLUETOOTH, "1");
  assert.equal(both.SSE_VMIX_PICTURES, "1");
  assert.equal(both.SSE_CAMERAS_SIMULATED, "0");
  assert.equal(laneEnvRefusal(both, { liveConsole: false, vmixPictures: true, bluetooth: true }), null);
  assert.match(laneEnvRefusal(both, { liveConsole: false, bluetooth: true }) ?? "", /SSE_VMIX_PICTURES is set/);
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
