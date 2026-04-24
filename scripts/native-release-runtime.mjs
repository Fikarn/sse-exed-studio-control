import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedRuntimes = new Set(["qt", "tauri"]);

function normalizeRuntime(value, source) {
  if (supportedRuntimes.has(value)) {
    return value;
  }

  throw new Error(`${source} must be one of: ${Array.from(supportedRuntimes).join(", ")}.`);
}

export function resolveNativeReleaseRuntime(rootDir = defaultRootDir) {
  if (process.env.SSE_NATIVE_RELEASE_RUNTIME) {
    return normalizeRuntime(process.env.SSE_NATIVE_RELEASE_RUNTIME, "SSE_NATIVE_RELEASE_RUNTIME");
  }

  const configPath = path.join(rootDir, "scripts", "native-release-runtime.json");
  if (!existsSync(configPath)) {
    return "qt";
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return normalizeRuntime(config.shippingRuntime ?? "qt", `${configPath} shippingRuntime`);
}

export function nativeReleaseRuntimeLabel(runtime) {
  return runtime === "tauri" ? "Tauri" : "Qt";
}

export function nativeReleaseShellExecutableName(target, runtime) {
  if (runtime === "tauri") {
    return target === "windows" ? "sse-exed-tauri-shell.exe" : "sse-exed-tauri-shell";
  }

  return target === "windows" ? "sse_exed_native.exe" : "sse_exed_native";
}

export function nativeReleaseSmokeArgs(target, runtime, statusPath) {
  if (runtime === "tauri") {
    return ["--smoke-test", `--smoke-status-path=${statusPath}`];
  }

  return target === "macos"
    ? ["-platform", "offscreen", "--smoke-test", `--smoke-status-path=${statusPath}`]
    : ["--smoke-test", `--smoke-status-path=${statusPath}`];
}

export function nativeReleaseRequiresOperatorUiReady(runtime) {
  return runtime !== "tauri";
}

export function nativeReleaseAppIdentifier() {
  return "com.sse.exedstudiocontrol";
}
