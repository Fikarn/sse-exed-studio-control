import assert from "node:assert/strict";
import test from "node:test";

import { DEV_RUN_RELEASE_ENV, developmentEnv } from "./dev-app.mjs";
import { engineBuildArgs } from "./tauri-before-command.mjs";

const PACKAGES = ["build", "--package", "studio-control-engine", "--package", "studio-control-pictures"];

test("the engine and the pictures helper are built in the shell's profile", () => {
  // `tauri build`, and so `npm run release`: the release profile, whatever
  // the environment holds.
  assert.deepEqual(engineBuildArgs("build", {}), [...PACKAGES, "--release"]);
  assert.deepEqual(engineBuildArgs("build", { [DEV_RUN_RELEASE_ENV]: "0" }), [...PACKAGES, "--release"]);

  // `tauri dev`: the debug profile, as `npm run app` has always built; the
  // release profile when the run says so.
  assert.deepEqual(engineBuildArgs("dev", {}), PACKAGES);
  assert.deepEqual(engineBuildArgs("dev", { [DEV_RUN_RELEASE_ENV]: "0" }), PACKAGES);
  assert.deepEqual(engineBuildArgs("dev", { [DEV_RUN_RELEASE_ENV]: "1" }), [...PACKAGES, "--release"]);
});

test("`npm run app` and its before-command agree on the profile, whatever the caller's environment holds", () => {
  const caller = { [DEV_RUN_RELEASE_ENV]: "1", sse_dev_run_release: "1", PATH: "/bin" };
  assert.deepEqual(engineBuildArgs("dev", developmentEnv(caller, { release: false })), PACKAGES);
  assert.deepEqual(engineBuildArgs("dev", developmentEnv({}, { release: true })), [...PACKAGES, "--release"]);
});
