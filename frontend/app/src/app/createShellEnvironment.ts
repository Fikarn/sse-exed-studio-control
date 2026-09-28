import { createShellStore, createTauriTransport, type WorkspaceId } from "@sse/engine-client";

import { disarmWorkspaceCrash } from "./startup/WorkspaceCrashProbe";

declare global {
  interface Window {
    __SSE_FIXTURE_ID__?: string;
    /** Playwright: end the fault `?crash=` armed, so reloading the area succeeds. */
    __SSE_TEST_DISARM_CRASH__?: () => void;
  }
}

const CRASH_TARGETS: readonly WorkspaceId[] = ["setup", "lighting", "audio", "teleprompter"];

/**
 * The store the shell runs on. In the app's window it talks to the hardware
 * link, whatever the address says. In a browser it runs on the engine's test
 * double, which is loaded then and only then (2026-09-28: it was part of the
 * app's main bundle, and `?transport=fixture` could put the app's window on
 * test data).
 */
export async function createShellEnvironment() {
  const url = new URL(window.location.href);
  const fixtureId = window.__SSE_FIXTURE_ID__ ?? url.searchParams.get("fixture") ?? "setup-required";
  const tauriAvailable = "__TAURI_INTERNALS__" in window;
  const useLiveTransport = tauriAvailable || url.searchParams.get("transport") === "live";

  const transport = useLiveTransport
    ? createTauriTransport()
    : (await import("./fixtureDouble")).createFixtureDouble(fixtureId);

  // 2026-09 production readiness, Slice 9 (finding F10): `?crash=lighting`
  // makes that workspace throw while it renders, so Playwright can watch the
  // shell survive it. The fixture double only — the parameter means nothing
  // to a shell that has a hardware link, and nothing inside the Tauri runtime.
  const crashParameter = url.searchParams.get("crash");
  const crashWorkspace =
    !useLiveTransport && !tauriAvailable ? (CRASH_TARGETS.find((target) => target === crashParameter) ?? null) : null;
  if (crashWorkspace) {
    window.__SSE_TEST_DISARM_CRASH__ = disarmWorkspaceCrash;
  }

  return {
    crashWorkspace,
    fixtureId,
    liveTransportRequested: useLiveTransport,
    // A development build refuses a malformed reply loudly (Slice 9 — F32);
    // the packaged build keeps the last good snapshot and records the failure.
    store: createShellStore(transport, { development: import.meta.env.DEV }),
  };
}
