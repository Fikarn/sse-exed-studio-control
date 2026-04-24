import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedRuntimes = new Set(["tauri"]);

function normalizeRuntime(value, source) {
  if (supportedRuntimes.has(value)) {
    return value;
  }

  if (value === "qt") {
    throw new Error(
      `${source}=qt is retired for native release packaging. Use npm run native:qt:foundation for Checkpoint D fallback validation before source removal.`
    );
  }

  throw new Error(`${source} must be: tauri.`);
}

export function resolveNativeReleaseRuntime(rootDir = defaultRootDir) {
  if (process.env.SSE_NATIVE_RELEASE_RUNTIME) {
    return normalizeRuntime(process.env.SSE_NATIVE_RELEASE_RUNTIME, "SSE_NATIVE_RELEASE_RUNTIME");
  }

  const configPath = path.join(rootDir, "scripts", "native-release-runtime.json");
  if (!existsSync(configPath)) {
    return "tauri";
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return normalizeRuntime(config.shippingRuntime ?? "tauri", `${configPath} shippingRuntime`);
}

export function nativeReleaseRuntimeLabel(runtime) {
  normalizeRuntime(runtime, "native release runtime");
  return "Tauri";
}

export function nativeReleaseShellExecutableName(target, runtime) {
  normalizeRuntime(runtime, "native release runtime");
  return target === "windows" ? "sse-exed-tauri-shell.exe" : "sse-exed-tauri-shell";
}

export function nativeReleaseSmokeArgs(target, runtime, statusPath) {
  normalizeRuntime(runtime, "native release runtime");
  return ["--smoke-test", `--smoke-status-path=${statusPath}`];
}

export function nativeReleaseRequiresOperatorUiReady(runtime) {
  normalizeRuntime(runtime, "native release runtime");
  return false;
}

export function nativeReleaseAppIdentifier() {
  return "com.sse.exedstudiocontrol";
}
