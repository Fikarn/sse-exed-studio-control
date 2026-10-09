import { createShellStore, createTauriTransport, type PicturesLink, type WorkspaceId } from "@sse/engine-client";

import { placePictures } from "./shellCommands";
import { disarmWorkspaceCrash } from "./startup/WorkspaceCrashProbe";

declare global {
  interface Window {
    __SSE_FIXTURE_ID__?: string;
    /** Playwright: end the fault `?crash=` armed, so reloading the area succeeds. */
    __SSE_TEST_DISARM_CRASH__?: () => void;
  }
}

const CRASH_TARGETS: readonly WorkspaceId[] = ["overview", "setup", "lighting", "audio", "cameras", "teleprompter"];

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

  // In the app's window the pictures helper draws the cameras' pictures over the
  // page, which only says where they stand (the camera pictures, D30). In a
  // browser the page draws the double's test cards itself.
  let transport;
  let pictures: PicturesLink | null;
  if (useLiveTransport) {
    transport = createTauriTransport();
    pictures = tauriAvailable ? { drawnBy: "helper", place: placePictures } : null;
  } else {
    ({ transport, pictures } = (await import("./fixtureDouble")).createFixtureDouble(fixtureId));
  }

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

  // D47 (D1 amended): the app opens on the Overview at every start. On the
  // double a page test opens on its fixture's saved page, as the boards and
  // the captures do, unless the address asks for the landing with
  // `?landing=1` (as `?crash=` asks for a fault).
  const landing: WorkspaceId | undefined =
    useLiveTransport || url.searchParams.get("landing") === "1" ? "overview" : undefined;

  return {
    crashWorkspace,
    fixtureId,
    liveTransportRequested: useLiveTransport,
    pictures,
    // A development build refuses a malformed reply loudly (Slice 9 — F32);
    // the packaged build keeps the last good snapshot and records the failure.
    store: createShellStore(transport, { development: import.meta.env.DEV, landing }),
  };
}
