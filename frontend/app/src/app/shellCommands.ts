import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { JsonValue } from "@sse/engine-client";

/** Raised by the native shell when a window close still needs confirming. */
export const SHELL_CLOSE_REQUESTED_EVENT = "shell://close-requested";

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

/**
 * 2026-09 audit Slice 11: the native shell prevents a window close until the
 * operator confirms and raises this event instead. Outside Tauri (browser,
 * fixtures) nothing is subscribed; the returned function always unsubscribes
 * safely, even if the subscription has not resolved yet.
 */
export function onShellCloseRequested(listener: () => void): () => void {
  if (!tauriAvailable()) {
    return () => {};
  }
  let disposed = false;
  let unlisten: UnlistenFn | null = null;
  void listen(SHELL_CLOSE_REQUESTED_EVENT, () => listener()).then((stop) => {
    if (disposed) {
      stop();
    } else {
      unlisten = stop;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** The operator confirmed the close: the shell stops the engine gracefully and closes. */
export async function confirmShellClose() {
  if (tauriAvailable()) {
    await invoke("shell_confirm_close");
  }
}

export async function resetWindowLayout() {
  if (tauriAvailable()) {
    await invoke("shell_reset_window_layout");
  }
}
