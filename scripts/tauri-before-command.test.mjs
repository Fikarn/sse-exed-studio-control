import assert from "node:assert/strict";
import test from "node:test";

import { engineBuildArgs } from "./tauri-before-command.mjs";

const PACKAGES = ["build", "--package", "studio-control-engine", "--package", "studio-control-pictures"];

test("the engine and the pictures helper are built in the shell's profile", () => {
  // `tauri build`, and so `npm run release`: the release profile, whatever
  // Tauri says.
  assert.deepEqual(engineBuildArgs("build", {}), [...PACKAGES, "--release"]);
  assert.deepEqual(engineBuildArgs("build", { TAURI_ENV_DEBUG: "true" }), [...PACKAGES, "--release"]);

  // `tauri dev`: the debug profile, as `npm run app` has always built; the
  // release profile when Tauri says so, for `npm run app -- --release`.
  assert.deepEqual(engineBuildArgs("dev", {}), PACKAGES);
  assert.deepEqual(engineBuildArgs("dev", { TAURI_ENV_DEBUG: "true" }), PACKAGES);
  assert.deepEqual(engineBuildArgs("dev", { TAURI_ENV_DEBUG: "false" }), [...PACKAGES, "--release"]);
});
