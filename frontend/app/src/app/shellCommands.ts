import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { JsonValue } from "@sse/engine-client";

/** Raised by the native shell when a window close still needs confirming. */
export const SHELL_CLOSE_REQUESTED_EVENT = "shell://close-requested";

function tauriAvailable() {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * A refused shell command rejects with the shell's sentence as a plain string;
 * the surfaces show `Error` messages and fall back to a generic line for
 * anything else, so the sentence (with its code, e.g. `PATH_OUTSIDE_APP_DATA`)
 * is wrapped here to reach the operator.
 */
function toError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" && error.trim() ? error : fallback);
}

/**
 * Opens a folder or file with the platform's opener. The shell only opens
 * paths inside its own folders — app data (with backups and exports), logs
 * and the update folder — and refuses everything else (2026-09 production
 * readiness, Slice 4 — finding F15).
 */
export async function openShellPath(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    throw new Error("Path unavailable.");
  }

  if (tauriAvailable()) {
    try {
      await invoke("shell_open_path", { path: normalizedPath });
    } catch (error) {
      throw toError(error, `Could not open ${normalizedPath}.`);
    }
  }

  return normalizedPath;
}

/**
 * Writes the diagnostics report to the app-data `exports` folder and returns
 * the file's path. The folder is the shell's choice, not the caller's
 * (2026-09 production readiness, Slice 4 — finding F15).
 */
export async function exportShellDiagnostics(report: Record<string, JsonValue>) {
  if (tauriAvailable()) {
    try {
      return await invoke<string>("shell_export_diagnostics", { report });
    } catch (error) {
      throw toError(error, "Diagnostics export did not finish.");
    }
  }

  return "diagnostics-fixture.json";
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
