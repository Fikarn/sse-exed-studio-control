import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nativeReleaseRuntimeLabel, resolveNativeReleaseRuntime } from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);
const buildScript = releaseRuntime === "tauri" ? "tauri:foundation" : "native:build";

console.log(`Building ${nativeReleaseRuntimeLabel(releaseRuntime)} shipping runtime via npm run ${buildScript}.`);

const result = spawnSync(npmCommand, ["run", buildScript], {
  cwd: rootDir,
  shell: process.platform === "win32",
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}

if ((result.status ?? 1) !== 0) {
  throw new Error(`npm run ${buildScript} failed with exit code ${result.status ?? 1}.`);
}
