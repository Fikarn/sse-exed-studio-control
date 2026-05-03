import { invoke } from "@tauri-apps/api/core";

import type { JsonValue } from "@sse/engine-client";

function tauriAvailable() {
  return "__TAURI_INTERNALS__" in window;
}

export async function openShellPath(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    throw new Error("Path unavailable.");
  }

  if (tauriAvailable()) {
    await invoke("shell_open_path", { path: normalizedPath });
  }

  return normalizedPath;
}

export async function exportShellDiagnostics(report: Record<string, JsonValue>, directory?: string) {
  const normalizedDirectory = directory?.trim();
  if (tauriAvailable()) {
    return invoke<string>("shell_export_diagnostics", {
      directory: normalizedDirectory ?? null,
      report,
    });
  }

  return normalizedDirectory
    ? `${normalizedDirectory.replace(/\/$/, "")}/shell-diagnostics-fixture.json`
    : "shell-diagnostics-fixture.json";
}

export async function enterStudioFullscreen() {
  if (tauriAvailable()) {
    await invoke("shell_enter_studio_fullscreen");
  }
}

export async function switchToWindowedLayout() {
  if (tauriAvailable()) {
    await invoke("shell_use_windowed_layout");
  }
}

export async function resetWindowLayout() {
  if (tauriAvailable()) {
    await invoke("shell_reset_window_layout");
  }
}
